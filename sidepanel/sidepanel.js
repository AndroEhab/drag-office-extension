/**
 * Side panel main controller.
 * Orchestrates drag-and-drop → parse → clean → upload flow.
 */

(() => {
  'use strict';

  const WORKLOAD_HINTS = {
    persistMaxBytes: 12 * 1024 * 1024,
    persistMaxFiles: 12,
    persistMaxCells: 150000,
    previewMaxBytes: 18 * 1024 * 1024,
    previewMaxFiles: 15,
    previewMaxCells: 250000,
    previewMaxStyledCells: 80000,
    parseReduceBytes: 10 * 1024 * 1024,
    parseSingleThreadBytes: 40 * 1024 * 1024,
    parseReduceFiles: 8,
    tabYieldEvery: 5,
    tabYieldMs: 75,
  };

  class DragToSheetsApp {
    constructor() {
      /** @type {Array<{ file: File, parsed: Object, name: string, ext: string }>} */
      this.files = [];
      /** @type {Set<string>} Content fingerprints of loaded files for duplicate detection */
      this.fileFingerprints = new Set();
      this.fileIdentityKeys = new Set();
      this.fileVersion = 0;
      this.cleanedSheetCache = new Map();
      this.processedDataCache = new Map();
      this.previewRefreshHandle = null;
      this.smartMappingApproved = false;
      this.smartMappingDeclined = false;
      this.customMappings = [];
      this.sessionSummary = null;
      this.processingWorker = null;
      this.processingWorkerReady = false;
      this.workerTaskId = 0;
      this.workerPending = new Map();
      this.previewTaskId = 0;
      this.init();
    }

    invalidateProcessingCache() {
      this.cleanedSheetCache.clear();
      this.processedDataCache.clear();
    }

    markFilesChanged() {
      this.fileVersion++;
      this.smartMappingApproved = false;
      this.smartMappingDeclined = false;
      this.invalidateProcessingCache();
    }

    computeParsedStats(parsed) {
      const stats = {
        sheetCount: parsed?.sheets?.length || 0,
        rowCount: 0,
        colCount: 0,
        cellCount: 0,
        styledCellCount: 0,
      };

      for (const sheet of parsed?.sheets || []) {
        const rows = sheet.data?.length || 0;
        const cols = sheet.data?.[0]?.length || 0;
        stats.rowCount += rows;
        stats.colCount = Math.max(stats.colCount, cols);
        stats.cellCount += rows * cols;
        if (Array.isArray(sheet.styles)) {
          stats.styledCellCount += rows * cols;
        }
      }

      return stats;
    }

    getFileSize(item) {
      return item?.file?.size || item?.size || 0;
    }

    getEntryStats(item) {
      if (item?.stats) return item.stats;
      const stats = this.computeParsedStats(item?.parsed || { sheets: [] });
      if (item) item.stats = stats;
      return stats;
    }

    getIncomingWorkloadHints(entries, options = this.getCleaningOptions()) {
      const items = entries || [];
      const totalBytes = items.reduce((sum, item) => sum + (item?.file?.size || item?.size || 0), 0);
      const fileCount = items.length;
      const excelCount = items.filter((item) => item?.ext === 'xlsx' || item?.ext === 'xls').length;
      const preserveFormatting = Boolean(options?.preserveFormatting);
      const styleHeavy = preserveFormatting && excelCount > 0;

      let parseConcurrency = 3;
      if (styleHeavy || totalBytes >= WORKLOAD_HINTS.parseSingleThreadBytes) {
        parseConcurrency = 1;
      } else if (fileCount >= WORKLOAD_HINTS.parseReduceFiles || totalBytes >= WORKLOAD_HINTS.parseReduceBytes) {
        parseConcurrency = 2;
      }

      return {
        fileCount,
        totalBytes,
        excelCount,
        preserveFormatting,
        styleHeavy,
        parseConcurrency,
      };
    }

    shouldLazyLoadSeparateFiles(incomingHints) {
      return this.getOpenMode() === 'separate' && (
        incomingHints.styleHeavy ||
        incomingHints.fileCount >= WORKLOAD_HINTS.parseReduceFiles ||
        incomingHints.totalBytes >= WORKLOAD_HINTS.parseReduceBytes
      );
    }

    getLoadedWorkloadHints() {
      let totalBytes = 0;
      let totalCells = 0;
      let totalStyledCells = 0;
      let maxFileCells = 0;

      for (const item of this.files) {
        totalBytes += this.getFileSize(item);
        const stats = this.getEntryStats(item);
        totalCells += stats.cellCount;
        totalStyledCells += stats.styledCellCount;
        maxFileCells = Math.max(maxFileCells, stats.cellCount);
      }

      return {
        fileCount: this.files.length,
        totalBytes,
        totalCells,
        totalStyledCells,
        maxFileCells,
      };
    }

    shouldPersistFilesSession() {
      const workload = this.getLoadedWorkloadHints();
      return !(
        workload.fileCount >= WORKLOAD_HINTS.persistMaxFiles ||
        workload.totalBytes >= WORKLOAD_HINTS.persistMaxBytes ||
        workload.totalCells >= WORKLOAD_HINTS.persistMaxCells
      );
    }

    shouldDeferPreview() {
      const workload = this.getLoadedWorkloadHints();
      return (
        workload.fileCount >= WORKLOAD_HINTS.previewMaxFiles ||
        workload.totalBytes >= WORKLOAD_HINTS.previewMaxBytes ||
        workload.totalCells >= WORKLOAD_HINTS.previewMaxCells ||
        workload.totalStyledCells >= WORKLOAD_HINTS.previewMaxStyledCells
      );
    }

    formatBytes(bytes) {
      if (!bytes) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      let value = bytes;
      let unitIndex = 0;
      while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
      }
      const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
      return `${value.toFixed(digits)} ${units[unitIndex]}`;
    }

    pause(ms) {
      return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    async openResultTabs(results) {
      for (let i = 0; i < results.length; i++) {
        await chrome.tabs.create({ url: results[i].url });

        if ((i + 1) % WORKLOAD_HINTS.tabYieldEvery === 0 && i < results.length - 1) {
          await this.pause(WORKLOAD_HINTS.tabYieldMs);
        }
      }
    }

    createParsedFileEntry(file, ext, parsed) {
      const contentFingerprint = this.computeFingerprint(parsed);
      return {
        file,
        parsed,
        name: file.name,
        ext,
        size: file.size || 0,
        stats: this.computeParsedStats(parsed),
        identityKey: this.computeFileIdentity(file, ext),
        contentFingerprint,
      };
    }

    createLazyFileEntry(file, ext) {
      return {
        file,
        parsed: null,
        name: file.name,
        ext,
        size: file.size || 0,
        stats: null,
        identityKey: this.computeFileIdentity(file, ext),
        lazy: true,
      };
    }

    computeFileIdentity(file, extOverride) {
      const ext = extOverride || file?.name?.split('.').pop()?.toLowerCase() || '';
      return [file?.name || '', ext, file?.size || 0, file?.lastModified || 0].join('::');
    }

    beginPreviewTask() {
      this.previewTaskId += 1;
      return this.previewTaskId;
    }

    isPreviewTaskCurrent(taskId) {
      return taskId === this.previewTaskId;
    }

    canUseIndexedDb() {
      return typeof indexedDB !== 'undefined';
    }

    openSessionDb() {
      if (!this.canUseIndexedDb()) {
        return Promise.reject(new Error('IndexedDB not available'));
      }

      return new Promise((resolve, reject) => {
        const request = indexedDB.open('drag-to-sheets', 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('sessions')) {
            db.createObjectStore('sessions');
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
      });
    }

    async saveFilesToIndexedDb(serializedFiles) {
      const db = await this.openSessionDb();

      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('sessions', 'readwrite');
          tx.objectStore('sessions').put({
            files: serializedFiles,
            savedAt: Date.now(),
          }, 'latest-files');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
        });
      } finally {
        db.close();
      }
    }

    async loadFilesFromIndexedDb() {
      const db = await this.openSessionDb();

      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction('sessions', 'readonly');
          const request = tx.objectStore('sessions').get('latest-files');
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
        });
      } finally {
        db.close();
      }
    }

    async clearFilesFromIndexedDb() {
      if (!this.canUseIndexedDb()) return;
      const db = await this.openSessionDb();

      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('sessions', 'readwrite');
          tx.objectStore('sessions').delete('latest-files');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB delete aborted'));
        });
      } finally {
        db.close();
      }
    }

    ensureProcessingWorker() {
      if (this.processingWorkerReady && this.processingWorker) {
        return this.processingWorker;
      }

      if (typeof Worker === 'undefined') return null;

      try {
        const workerUrl = chrome.runtime?.getURL
          ? chrome.runtime.getURL('sidepanel/processing-worker.js')
          : 'processing-worker.js';
        const worker = new Worker(workerUrl);
        worker.onmessage = (event) => {
          const { id, ok, result, error } = event.data || {};
          const pending = this.workerPending.get(id);
          if (!pending) return;
          this.workerPending.delete(id);
          if (ok) pending.resolve(result);
          else pending.reject(new Error(error || 'Worker task failed'));
        };
        worker.onerror = () => {
          this.processingWorkerReady = false;
          this.processingWorker = null;
          for (const [, pending] of this.workerPending) {
            pending.reject(new Error('Processing worker failed'));
          }
          this.workerPending.clear();
        };
        this.processingWorker = worker;
        this.processingWorkerReady = true;
        return worker;
      } catch (_) {
        this.processingWorkerReady = false;
        this.processingWorker = null;
        return null;
      }
    }

    async runProcessingTask(type, payload, fallback) {
      const worker = this.ensureProcessingWorker();
      if (!worker) {
        return fallback();
      }

      const id = ++this.workerTaskId;
      const taskPromise = new Promise((resolve, reject) => {
        this.workerPending.set(id, { resolve, reject });
      });

      try {
        worker.postMessage({ id, type, payload });
        return await taskPromise;
      } catch (error) {
        this.workerPending.delete(id);
        return fallback(error);
      }
    }

    async ensureParsedEntry(item, options = {}, reason = 'parse') {
      if (item?.parsed) return item.parsed;
      if (!item?.file) {
        throw new Error(`Re-add ${item?.name || 'this file'} to continue`);
      }

      const startedAt = this.now();
      const parsed = await this.runProcessingTask(
        'parse',
        { file: item.file, options },
        () => Parser.parse(item.file, options)
      );

      item.parsed = parsed;
      item.stats = this.computeParsedStats(parsed);
      item.lazy = false;
      item.contentFingerprint = this.computeFingerprint(parsed);
      this.fileFingerprints.add(item.contentFingerprint);

      this.logTiming(`hydrate file (${reason})`, startedAt, {
        file: item.name,
        preserveFormatting: Boolean(options.preserveFormatting),
      });

      return parsed;
    }

    async ensureEntriesParsed(items, options = {}, reason = 'parse') {
      const pendingItems = (items || []).filter((item) => item && !item.parsed);
      if (pendingItems.length === 0) return;

      const hints = this.getIncomingWorkloadHints(
        pendingItems.map((item) => ({ file: item.file, ext: item.ext, size: item.size })),
        options
      );

      await this.mapWithConcurrency(pendingItems, hints.parseConcurrency, async (item, idx) => {
        this.setStatus(`Preparing ${item.name}…`, 'loading');
        this.showProgress(Math.round(((idx + 1) / pendingItems.length) * 100 * 0.3));
        await this.ensureParsedEntry(item, options, reason);
      });
    }

    buildStatsFromPreview(preview) {
      const meta = preview?.previewMeta || {};
      const rowCount = meta.rowCount || preview?.sheets?.[0]?.data?.length || 0;
      const colCount = meta.colCount || preview?.sheets?.[0]?.data?.[0]?.length || 0;
      return {
        sheetCount: meta.sheetCount || preview?.sheets?.length || 1,
        rowCount,
        colCount,
        cellCount: rowCount && colCount ? rowCount * colCount : 0,
        styledCellCount: 0,
      };
    }

    async ensurePreviewSample(item) {
      if (item?.previewSample) return item.previewSample;
      if (item?.parsed) {
        const data = item.parsed.sheets[0]?.data || [];
        const rows = data.slice(0, 51).map((row) => [...row]);
        const preview = {
          sheets: [{
            name: item.parsed.sheets[0]?.name || item.name,
            data: rows,
          }],
          previewMeta: {
            rowCount: item.stats?.rowCount || data.length,
            colCount: item.stats?.colCount || (data[0]?.length || 0),
            sheetCount: item.stats?.sheetCount || item.parsed.sheets.length,
            sampled: data.length > rows.length,
            sampleRows: rows.length,
            fileSize: this.getFileSize(item),
          },
        };
        item.previewSample = preview;
        return preview;
      }
      if (!item?.file) {
        throw new Error(`Re-add ${item?.name || 'this file'} to preview it`);
      }

      const preview = await this.runProcessingTask(
        'preview',
        { file: item.file, options: { sampleRows: 51 } },
        () => Parser.preview(item.file, { sampleRows: 51 })
      );
      item.previewSample = preview;
      if (!item.stats) {
        item.stats = this.buildStatsFromPreview(preview);
      }
      return preview;
    }

    async getResponsiveSeparatePreview(item) {
      const preview = await this.ensurePreviewSample(item);
      return {
        data: preview.sheets[0]?.data || [],
        summary: {
          totalRows: preview.previewMeta?.rowCount,
          totalCols: preview.previewMeta?.colCount,
          sampled: Boolean(preview.previewMeta?.sampled),
          sampleRows: preview.previewMeta?.sampleRows,
          fileSize: preview.previewMeta?.fileSize || this.getFileSize(item),
        },
      };
    }

    async getResponsiveMergePreview(options) {
      const smartMapping = this.isSmartMappingActive();
      const sampleFiles = [];
      let totalRows = 1;
      let totalRowsKnown = true;

      for (const item of this.files) {
        const preview = await this.ensurePreviewSample(item);
        const data = preview.sheets[0]?.data || [];
        sampleFiles.push({
          sheets: [{
            name: preview.sheets[0]?.name || item.name,
            data,
          }],
        });

        const rowCount = preview.previewMeta?.rowCount;
        if (typeof rowCount === 'number') {
          totalRows += Math.max(rowCount - 1, 0);
        } else {
          totalRowsKnown = false;
        }
      }

      const mappingContext = this.buildCustomMappingContextFromRawFiles(
        sampleFiles,
        this.files.map((item) => item.name),
        smartMapping
      );
      const activeCustomMappings = this.getActiveCustomMappingsForContext(mappingContext);
      const merged = await this.runProcessingTask(
        'merge',
        { files: sampleFiles, options: { smartMapping, customMappings: activeCustomMappings } },
        () => Merger.merge(sampleFiles, { smartMapping, customMappings: activeCustomMappings })
      );

      return {
        merged,
        summary: {
          totalRows: totalRowsKnown ? totalRows : null,
          totalCols: merged.sheets[0]?.data?.[0]?.length || 0,
          sampled: true,
          fileSize: this.getLoadedWorkloadHints().totalBytes,
        },
      };
    }

    shouldReleaseParsedAfterUpload(item) {
      if (!item?.file || !item?.parsed) return false;
      const workload = this.getLoadedWorkloadHints();
      return !this.shouldPersistFilesSession() || workload.fileCount >= WORKLOAD_HINTS.parseReduceFiles;
    }

    shouldUseNativeDriveImport(item) {
      if (!item?.file) return false;
      if (!['csv', 'tsv', 'xlsx', 'xls'].includes(item.ext)) return false;
      return true;
    }

    releaseParsedEntry(item) {
      if (!item?.file || !item?.parsed) return false;

      item.stats = item.stats || this.computeParsedStats(item.parsed);
      item.parsed = null;
      item.lazy = true;
      this.invalidateProcessingCache();
      return true;
    }

    /**
     * Compute a content fingerprint for a parsed file to detect duplicates.
     * Uses a fast 53-bit string hash (cyrb53) over stringified sheet data.
     * @param {Object} parsed  Parsed file object with sheets array
     * @returns {string} Hex fingerprint string
     */
    computeFingerprint(parsed) {
      let h1 = 0xdeadbeef, h2 = 0x41c6ce57;

      const pushChar = (code) => {
        h1 = Math.imul(h1 ^ code, 2654435761);
        h2 = Math.imul(h2 ^ code, 1597334677);
      };

      const pushText = (value) => {
        const text = String(value ?? '');
        for (let i = 0; i < text.length; i++) {
          pushChar(text.charCodeAt(i));
        }
      };

      for (const sheet of parsed.sheets) {
        pushText(sheet.name);
        pushChar(10);
        for (const row of sheet.data) {
          for (const cell of row) {
            pushText(cell);
            pushChar(9);
          }
          pushChar(10);
        }
        pushChar(30);
      }

      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
      h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
      h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

      return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
    }

    /** Rebuild fileFingerprints set from current this.files array. */
    rebuildFingerprints() {
      this.fileFingerprints.clear();
      this.fileIdentityKeys.clear();
      for (const entry of this.files) {
        if (entry.identityKey) {
          this.fileIdentityKeys.add(entry.identityKey);
        }
        if (entry.contentFingerprint) {
          this.fileFingerprints.add(entry.contentFingerprint);
        } else if (entry.parsed) {
          const fingerprint = this.computeFingerprint(entry.parsed);
          entry.contentFingerprint = fingerprint;
          this.fileFingerprints.add(fingerprint);
        }
      }
    }

    schedulePreviewRefresh() {
      if (this.previewRefreshHandle != null) return;

      const schedule = window.requestAnimationFrame
        ? window.requestAnimationFrame.bind(window)
        : (cb) => window.setTimeout(cb, 0);

      this.previewRefreshHandle = schedule(() => {
        this.previewRefreshHandle = null;
        void this.refreshPreview();
      });
    }

    async mapWithConcurrency(items, limit, worker) {
      const results = new Array(items.length);
      let nextIndex = 0;

      const runWorker = async () => {
        while (nextIndex < items.length) {
          const currentIndex = nextIndex++;
          results[currentIndex] = await worker(items[currentIndex], currentIndex);
        }
      };

      const workerCount = Math.min(limit, items.length);
      await Promise.all(Array.from({ length: workerCount }, runWorker));
      return results;
    }

    now() {
      return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    }

    isPerfDebugEnabled() {
      return window.DRAG_TO_SHEETS_DEBUG_PERF === true;
    }

    logTiming(label, startTime, details = {}) {
      const durationMs = Math.round((this.now() - startTime) * 10) / 10;
      const message = `Drag to Sheets perf: ${label} (${durationMs} ms)`;

      if (this.isPerfDebugEnabled()) {
        console.debug(message, details);
      }

      if (chrome.runtime?.sendMessage) {
        chrome.runtime
          .sendMessage({
            type: 'drag-to-sheets:perf-log',
            message,
            details,
          })
          .catch(() => {});
      }
    }

    getCleaningCacheKey(options = this.getCleaningOptions()) {
      return JSON.stringify({
        trim: options.trim,
        removeEmptyRows: options.removeEmptyRows,
        removeEmptyColumns: options.removeEmptyColumns,
        removeDuplicates: options.removeDuplicates,
        duplicateMode: options.removeDuplicates ? options.duplicateMode : 'keep-first',
        fixNumbers: options.fixNumbers,
        normalizeHeaders: options.normalizeHeaders,
      });
    }

    async getCleanedSheetData(fileIndex, sheetIndex, options = this.getCleaningOptions()) {
      const item = this.files[fileIndex];
      const sheet = item?.parsed?.sheets?.[sheetIndex];
      if (!sheet) return [];

      const cacheKey = [
        this.fileVersion,
        fileIndex,
        sheetIndex,
        this.getCleaningCacheKey(options),
      ].join('|');

      if (this.cleanedSheetCache.has(cacheKey)) {
        return this.cleanedSheetCache.get(cacheKey);
      }

      const cleanPromise = this.runProcessingTask(
        'clean',
        { data: sheet.data, options },
        () => Cleaner.apply(sheet.data, options)
      ).catch((error) => {
        this.cleanedSheetCache.delete(cacheKey);
        throw error;
      });

      this.cleanedSheetCache.set(cacheKey, cleanPromise);
      return cleanPromise;
    }

    isSmartMappingActive() {
      return this.smartMappingCheckbox.checked && this.smartMappingApproved;
    }

    async getMergedProcessedData(options = this.getCleaningOptions()) {
      const smartMapping = this.isSmartMappingActive();
      const raw = this.files.map((item) => ({
        sheets: item.parsed.sheets.map((sheet) => ({
          name: sheet.name,
          data: sheet.data,
        })),
      }));
      const mappingContext = this.buildCustomMappingContextFromRawFiles(
        raw,
        this.files.map((item) => item.name),
        smartMapping
      );
      const activeCustomMappings = this.getActiveCustomMappingsForContext(mappingContext);
      const cmKey = JSON.stringify(activeCustomMappings);
      const cacheKey = `merge|${this.fileVersion}|${this.getCleaningCacheKey(options)}|sm:${smartMapping}|cm:${cmKey}`;

      if (this.processedDataCache.has(cacheKey)) {
        return this.processedDataCache.get(cacheKey);
      }

      const mergeOpts = { smartMapping, customMappings: activeCustomMappings };
      const mergedPromise = this.runProcessingTask(
        'mergeAndClean',
        { files: raw, mergeOptions: mergeOpts, cleanOptions: options },
        () => {
          const merged = Merger.merge(raw, mergeOpts);
          merged.sheets = merged.sheets.map((sheet) => ({
            name: sheet.name,
            data: Cleaner.apply(sheet.data, options),
          }));
          return merged;
        }
      )
        .catch((error) => {
          this.processedDataCache.delete(cacheKey);
          throw error;
        });

      this.processedDataCache.set(cacheKey, mergedPromise);
      return mergedPromise;
    }

    // ---- Initialisation ----

    async init() {
      this.bindElements();
      this.renderIcons();
      this.setupDragDrop();
      this.setupEvents();
      this.checkExcelSupport();
      await this.restoreSession();
    }

    bindElements() {
      this.dropZone = document.getElementById('drop-zone');
      this.fileInput = document.getElementById('file-input');
      this.fileList = document.getElementById('file-list');
      this.fileCount = document.getElementById('file-count');
      this.optionsPanel = document.getElementById('options-panel');
      this.mergeOption = document.getElementById('merge-option');
      this.previewPanel = document.getElementById('preview-panel');
      this.previewTable = document.getElementById('preview-table');
      this.previewStats = document.getElementById('preview-stats');
      this.uploadBtn = document.getElementById('upload-btn');
      this.settingsBtn = document.getElementById('settings-btn');
      this.cleaningOptions = document.getElementById('cleaning-options');
      this.previewSelect = document.getElementById('preview-select');
      this.clearBtn = document.getElementById('clear-btn');
      this.loadingPanel = document.getElementById('loading-panel');
      this.loadingBar = document.getElementById('loading-panel-bar');
      this.loadingSpinner = document.getElementById('loading-spinner');
      this.loadingText = document.getElementById('loading-text');
      this.urlToggle = document.getElementById('url-toggle');
      this.urlBar = document.getElementById('url-bar');
      this.urlInput = document.getElementById('url-input');
      this.urlFetchBtn = document.getElementById('url-fetch-btn');
      this.smartMappingOption = document.getElementById('smart-mapping-option');
      this.smartMappingCheckbox = document.getElementById('opt-smart-mapping');
      this.mappingReview = document.getElementById('mapping-review');
      this.mappingReviewList = document.getElementById('mapping-review-list');
      this.mappingApproveBtn = document.getElementById('mapping-approve-btn');
      this.mappingDeclineBtn = document.getElementById('mapping-decline-btn');
      this.customMappingOption = document.getElementById('custom-mapping-option');
      this.customMappingList = document.getElementById('custom-mapping-list');
      this.customMappingAddBtn = document.getElementById('custom-mapping-add');
    }

    setupDragDrop() {
      // Highlight on drag enter/over
      const highlight = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.dropZone.classList.add('drag-over');
      };
      const unhighlight = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.dropZone.classList.remove('drag-over');
      };

      this.dropZone.addEventListener('dragenter', highlight);
      this.dropZone.addEventListener('dragover', highlight);
      this.dropZone.addEventListener('dragleave', unhighlight);
      this.dropZone.addEventListener('drop', (e) => {
        unhighlight(e);
        this.handleFiles(e.dataTransfer.files);
      });

      // Click to browse
      this.dropZone.addEventListener('click', () => this.fileInput.click());
      this.dropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.fileInput.click();
        }
      });
      this.fileInput.addEventListener('change', () => {
        if (this.fileInput.files.length > 0) {
          this.handleFiles(this.fileInput.files);
          this.fileInput.value = ''; // Reset for re-selection
        }
      });

      // Prevent browser from opening dropped files
      document.addEventListener('dragover', (e) => e.preventDefault());
      document.addEventListener('drop', (e) => e.preventDefault());
    }

    setupEvents() {
      this.uploadBtn.addEventListener('click', () => this.handleUpload());
      this.clearBtn.addEventListener('click', () => this.clearFiles());

      // Settings button toggles cleaning options
      this.settingsBtn.addEventListener('click', () => {
        const isOpen = !this.cleaningOptions.classList.contains('hidden');
        this.cleaningOptions.classList.toggle('hidden', isOpen);
        this.settingsBtn.classList.toggle('active', !isOpen);
        this.settingsBtn.setAttribute('aria-pressed', String(!isOpen));
        this.savePreferences();
      });

      // Refresh preview when user picks a different file
      this.previewSelect.addEventListener('change', () => this.schedulePreviewRefresh());

      // Refresh preview when open-mode changes (also toggles dropdown state)
      document.querySelectorAll('input[name="open-mode"]').forEach((radio) => {
        radio.addEventListener('change', () => {
          this.updateOpenModeState();
          this.schedulePreviewRefresh();
          this.savePreferences();
        });
      });

      // Refresh preview when any cleaning option changes
      document.querySelectorAll('#options-panel input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', () => {
          this.schedulePreviewRefresh();
          this.savePreferences();
        });
      });

      // Toggle duplicate sub-options visibility when duplicate checkbox changes
      const dupCheck = document.getElementById('opt-duplicates');
      const dupMode = document.getElementById('dup-mode');
      dupCheck.addEventListener('change', () => {
        dupMode.classList.toggle('hidden', !dupCheck.checked);
      });

      // Refresh preview when dup-mode radio changes
      document.querySelectorAll('input[name="dup-mode"]').forEach((radio) => {
        radio.addEventListener('change', () => {
          this.schedulePreviewRefresh();
          this.savePreferences();
        });
      });

      // Smart header mapping
      this.smartMappingCheckbox.addEventListener('change', () => {
        this.smartMappingApproved = false;
        this.smartMappingDeclined = false;
        this.invalidateProcessingCache();
        void this.updateCustomMappingVisibility();
        this.schedulePreviewRefresh();
        this.savePreferences();
      });
      this.mappingApproveBtn.addEventListener('click', () => {
        this.smartMappingApproved = true;
        this.mappingReview.classList.add('hidden');
        this.invalidateProcessingCache();
        void this.updateCustomMappingVisibility();
        this.schedulePreviewRefresh();
      });
      this.mappingDeclineBtn.addEventListener('click', () => {
        this.smartMappingDeclined = true;
        this.mappingReview.classList.add('hidden');
        void this.updateCustomMappingVisibility();
      });

      // Custom column mapping
      this.customMappingAddBtn.addEventListener('click', () => this.addCustomMapping());

      // URL import
      this.urlToggle.addEventListener('click', () => this.toggleUrlBar());
      this.urlFetchBtn.addEventListener('click', () => this.importFromUrl());
      this.urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.importFromUrl();
        if (e.key === 'Escape') this.toggleUrlBar(false);
      });
      this.urlInput.addEventListener('input', () => {
        this.urlInput.classList.remove('url-input--error');
      });
    }

    checkExcelSupport() {
      if (!Parser.isExcelSupported()) {
        console.info(
          'Drag to Sheets: SheetJS not loaded — .xlsx/.xls support disabled. CSV/TSV still work.'
        );
      }
    }

    // ---- URL Import ----

    toggleUrlBar(forceOpen) {
      const isCurrentlyOpen = this.urlToggle.getAttribute('aria-expanded') === 'true';
      const open = forceOpen !== undefined ? forceOpen : !isCurrentlyOpen;
      this.urlBar.classList.toggle('hidden', !open);
      this.urlToggle.setAttribute('aria-expanded', String(open));
      if (open) {
        this.urlInput.focus();
      } else {
        this.currentFetchController?.abort();
      }
    }

    async importFromUrl() {
      const raw = this.urlInput.value.trim();

      // Basic URL validation — must be http/https
      let url;
      try {
        url = new URL(raw);
      } catch {
        this.urlInput.classList.add('url-input--error');
        this.setStatus('Enter a valid http(s) URL', 'warning');
        return;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        this.urlInput.classList.add('url-input--error');
        this.setStatus('Only http and https URLs are supported', 'warning');
        return;
      }

      this.urlFetchBtn.disabled = true;
      this.setStatus(`Fetching ${url.hostname}…`, 'loading');

      const controller = new AbortController();
      this.currentFetchController = controller;
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(url.toString(), { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`Server returned ${response.status} ${response.statusText}`);
        }

        // Determine filename from URL, Content-Disposition header, or fallback
        const disposition = response.headers.get('content-disposition') || '';
        const contentType = response.headers.get('content-type') || '';
        const fileName = this.resolveFileName(raw, disposition, contentType);

        const ext = fileName.split('.').pop().toLowerCase();
        if (!Parser.isSupported(fileName)) {
          throw new Error(
            `Cannot import: unrecognised file type (.${ext}). Supported: csv, tsv, xlsx, xls`
          );
        }
        if ((ext === 'xlsx' || ext === 'xls') && !Parser.isExcelSupported()) {
          throw new Error('Excel support not installed. See README for setup.');
        }

        const blob = await response.blob();
        const file = new File([blob], fileName, { type: blob.type });

        // Reuse existing file handling pipeline
        await this.handleFiles([file]);

        // Clear input and collapse bar on success
        this.urlInput.value = '';
        this.toggleUrlBar(false);
      } catch (err) {
        this.urlInput.classList.add('url-input--error');
        if (err.name === 'AbortError') {
          this.setStatus('Import cancelled or timed out', 'error');
        } else {
          this.setStatus(`Import failed: ${err.message}`, 'error');
        }
      } finally {
        clearTimeout(timeoutId);
        this.currentFetchController = null;
        this.urlFetchBtn.disabled = false;
      }
    }

    /**
     * Derive a filename from URL path, Content-Disposition, or Content-Type.
     * @param {string} rawUrl
     * @param {string} disposition  Content-Disposition header value
     * @param {string} contentType  Content-Type header value
     * @returns {string}
     */
    resolveFileName(rawUrl, disposition, contentType) {
      // 1. Content-Disposition: attachment; filename="data.csv"
      const cdMatch = disposition.match(/filename\*?=['"]?(?:UTF-\d['"]*)?([^;\r\n"']+)['"]?/i);
      if (cdMatch && cdMatch[1]) {
        return decodeURIComponent(cdMatch[1].trim());
      }

      // 2. Last path segment of the URL
      try {
        const pathname = new URL(rawUrl).pathname;
        const segment = pathname.split('/').pop();
        if (segment && segment.includes('.')) {
          return decodeURIComponent(segment);
        }
      } catch { /* ignore */ }

      // 3. Infer from Content-Type
      const ctMap = {
        'text/csv': 'import.csv',
        'text/tab-separated-values': 'import.tsv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'import.xlsx',
        'application/vnd.ms-excel': 'import.xls',
      };
      for (const [mime, name] of Object.entries(ctMap)) {
        if (contentType.includes(mime)) return name;
      }

      return 'import.csv';
    }

    // ---- Session Persistence ----

    /**
     * Serialize current state to chrome.storage.
     * Files go to storage.session (cleared on browser restart).
     * Preferences go to storage.local (persist across restarts).
     */
    saveFilesSession() {
      const serializedFiles = this.files.map((item) => ({
        name: item.name,
        ext: item.ext,
        size: this.getFileSize(item),
        stats: item.stats || null,
        identityKey: item.identityKey || null,
        contentFingerprint: item.contentFingerprint || null,
        lazy: Boolean(item.lazy && !item.parsed),
        sheets: item.parsed
          ? item.parsed.sheets.map(({ name, data }) => ({ name, data }))
          : null,
      }));
      const indexedDbFiles = this.files.map((item) => ({
        name: item.name,
        ext: item.ext,
        size: this.getFileSize(item),
        stats: item.stats || null,
        identityKey: item.identityKey || null,
        contentFingerprint: item.contentFingerprint || null,
        lazy: Boolean(item.lazy && !item.parsed),
        file: item.file || null,
        parsed: item.parsed
          ? {
            sheets: item.parsed.sheets.map(({ name, data, styles }) => ({ name, data, styles: styles || null })),
            themeColors: item.parsed.themeColors || null,
          }
          : null,
      }));
      const persistFiles = this.shouldPersistFilesSession();

      if (!persistFiles) {
        const summary = {
          persisted: this.canUseIndexedDb() ? 'indexeddb' : false,
          fileCount: this.files.length,
          totalBytes: this.getLoadedWorkloadHints().totalBytes,
        };

        const persistPromise = this.canUseIndexedDb()
          ? this.saveFilesToIndexedDb(indexedDbFiles)
          : Promise.resolve();

        persistPromise
          .then(() => chrome.storage.session.set({ files: [], sessionSummary: summary }))
          .catch((err) => console.warn('Drag to Sheets: session save failed:', err.message));
        return;
      }

      chrome.storage.session
        .set({ files: serializedFiles, sessionSummary: null })
        .catch((err) => console.warn('Drag to Sheets: session save failed:', err.message));

      void this.clearFilesFromIndexedDb().catch(() => {});
    }

    savePreferences() {
      const prefs = {
        openMode: this.getOpenMode(),
        cleaningOptions: this.getCleaningOptions(),
        settingsOpen: !this.cleaningOptions.classList.contains('hidden'),
        smartMapping: this.smartMappingCheckbox.checked,
        customMappings: this.customMappings,
      };

      chrome.storage.local
        .set({ prefs })
        .catch((err) => console.warn('Drag to Sheets: prefs save failed:', err.message));
    }

    saveSession() {
      this.saveFilesSession();
      this.savePreferences();
    }

    /**
     * Rehydrate state from chrome.storage on panel open.
     * Restores files (without original File objects) and all preferences.
     */
    async restoreSession() {
      try {
        const [{ files: storedFiles, sessionSummary }, { prefs }] = await Promise.all([
          chrome.storage.session.get(['files', 'sessionSummary']),
          chrome.storage.local.get('prefs'),
        ]);
        this.sessionSummary = sessionSummary || null;

        let restoredFiles = storedFiles;
        if ((!Array.isArray(restoredFiles) || restoredFiles.length === 0) && sessionSummary?.persisted === 'indexeddb') {
          const indexedDbSession = await this.loadFilesFromIndexedDb().catch(() => null);
          restoredFiles = indexedDbSession?.files || [];
        }

        // Restore files
        if (Array.isArray(restoredFiles) && restoredFiles.length > 0) {
          this.files = restoredFiles.map((item) => ({
            file: item.file || null,
            parsed: item.parsed || (Array.isArray(item.sheets) ? { sheets: item.sheets } : null),
            name: item.name,
            ext: item.ext,
            size: item.size || 0,
            stats: item.stats || null,
            identityKey: item.identityKey || `${item.name}::${item.ext}::${item.size || 0}::0`,
            contentFingerprint: item.contentFingerprint || null,
            lazy: Boolean(item.lazy && !item.sheets),
          }));
          this.rebuildFingerprints();
          this.markFilesChanged();
        }

        // Restore preferences
        if (prefs) {
          // Open mode
          const modeRadio = document.querySelector(
            `input[name="open-mode"][value="${CSS.escape(prefs.openMode)}"]`
          );
          if (modeRadio) modeRadio.checked = true;

          // Cleaning options
          const optMap = {
            trim: 'opt-trim',
            removeEmptyRows: 'opt-empty-rows',
            removeEmptyColumns: 'opt-empty-cols',
            removeDuplicates: 'opt-duplicates',
            fixNumbers: 'opt-numbers',
            normalizeHeaders: 'opt-headers',
            preserveFormatting: 'opt-preserve-fmt',
          };
          const opts = prefs.cleaningOptions || {};
          for (const [key, id] of Object.entries(optMap)) {
            const el = document.getElementById(id);
            if (el && key in opts) el.checked = opts[key];
          }

          // Restore duplicate mode radio and sync sub-options visibility
          if (opts.duplicateMode) {
            const dupRadio = document.querySelector(`input[name="dup-mode"][value="${opts.duplicateMode}"]`);
            if (dupRadio) dupRadio.checked = true;
          }
          const dupChecked = document.getElementById('opt-duplicates')?.checked;
          document.getElementById('dup-mode')?.classList.toggle('hidden', !dupChecked);

          // Settings panel open state
          if (prefs.settingsOpen) {
            this.cleaningOptions.classList.remove('hidden');
            this.settingsBtn.classList.add('active');
            this.settingsBtn.setAttribute('aria-pressed', 'true');
          }

          // Smart mapping
          if (prefs.smartMapping) {
            this.smartMappingCheckbox.checked = true;
          }

          // Custom mappings
          if (Array.isArray(prefs.customMappings)) {
            this.customMappings = prefs.customMappings;
          }
        }
      } catch (err) {
        console.warn('Drag to Sheets: session restore failed:', err.message);
      }

      this.renderFileList();
      this.updateUI();

      if (this.files.length > 0) {
        this.setStatus(`Restored ${this.files.length} file(s) from last session`, 'info');
      } else if (this.sessionSummary && this.sessionSummary.persisted === false) {
        this.setStatus(
          `Large batch (${this.sessionSummary.fileCount} file(s), ${this.formatBytes(this.sessionSummary.totalBytes)}) was not restored to keep memory usage stable`,
          'info'
        );
      }
    }

    // ---- File Handling ----

    async handleFiles(fileList) {
      const parseStart = this.now();
      const dropped = Array.from(fileList);
      const options = this.getCleaningOptions();
      const acceptedFiles = [];

      for (const file of dropped) {
        if (!Parser.isSupported(file.name)) {
          this.setStatus(`Skipped unsupported file: ${file.name}`, 'warning');
          continue;
        }

        const ext = file.name.split('.').pop().toLowerCase();

        if ((ext === 'xlsx' || ext === 'xls') && !Parser.isExcelSupported()) {
          this.setStatus(
            `Cannot open ${file.name} — Excel support not installed. See README.`,
            'warning'
          );
          continue;
        }

        acceptedFiles.push({ file, ext });
      }

      if (acceptedFiles.length === 0) {
        this.renderFileList();
        this.updateUI();
        return;
      }

      const incomingHints = this.getIncomingWorkloadHints(acceptedFiles, options);
      const useLazySeparate = this.shouldLazyLoadSeparateFiles(incomingHints);

      if (useLazySeparate) {
        let added = 0;
        let skippedDuplicates = 0;

        for (const { file, ext } of acceptedFiles) {
          const identityKey = this.computeFileIdentity(file, ext);
          if (this.fileIdentityKeys.has(identityKey)) {
            skippedDuplicates++;
            continue;
          }

          const entry = this.createLazyFileEntry(file, ext);
          this.fileIdentityKeys.add(identityKey);
          this.files.push(entry);
          added++;
        }

        this.renderFileList();
        this.updateUI();

        if (added > 0) {
          this.markFilesChanged();
          this.setStatus(
            `${this.files.length} file(s) ready — parsing will happen on demand`,
            'success'
          );
          this.saveFilesSession();
        }

        this.logTiming('handle files (lazy separate)', parseStart, {
          dropped: dropped.length,
          accepted: acceptedFiles.length,
          added,
          skippedDuplicates,
          parseConcurrency: 0,
          totalBytes: incomingHints.totalBytes,
          mode: this.getOpenMode(),
        });
        return;
      }

      this.setStatus(
        acceptedFiles.length === 1
          ? `Parsing ${acceptedFiles[0].file.name}…`
          : `Parsing ${acceptedFiles.length} files…`,
        'loading'
      );

      const parsedResults = await this.mapWithConcurrency(
        acceptedFiles,
        incomingHints.parseConcurrency,
        async ({ file, ext }) => {
          const fileParseStart = this.now();
          try {
            const parsed = await this.runProcessingTask(
              'parse',
              { file, options: { preserveFormatting: options.preserveFormatting } },
              () => Parser.parse(file, { preserveFormatting: options.preserveFormatting })
            );
            this.logTiming('parse file', fileParseStart, {
              file: file.name,
              ext,
              sheets: parsed.sheets?.length || 0,
            });
            return { file, ext, parsed };
          } catch (err) {
            this.logTiming('parse file failed', fileParseStart, {
              file: file.name,
              ext,
              error: err.message,
            });
            return { file, ext, error: err };
          }
        }
      );

      let added = 0;
      let skippedDuplicates = 0;
      let lastError = null;

      for (const result of parsedResults) {
        if (!result) continue;
        if (result.error) {
          lastError = result.error;
          continue;
        }

        const identityKey = this.computeFileIdentity(result.file, result.ext);
        if (this.fileIdentityKeys.has(identityKey)) {
          skippedDuplicates++;
          continue;
        }

        const fingerprint = this.computeFingerprint(result.parsed);
        if (this.fileFingerprints.has(fingerprint)) {
          skippedDuplicates++;
          continue;
        }

        this.fileIdentityKeys.add(identityKey);
        this.fileFingerprints.add(fingerprint);
        this.files.push(this.createParsedFileEntry(result.file, result.ext, result.parsed));
        added++;
      }

      if (lastError && added === 0 && skippedDuplicates === 0) {
        this.setStatus(`Error: ${lastError.message}`, 'error');
      }

      this.renderFileList();
      this.updateUI();

      if (added > 0) {
        this.markFilesChanged();
        this.setStatus(`${this.files.length} file(s) ready`, 'success');
        this.saveFilesSession();
      }

      this.logTiming('handle files', parseStart, {
        dropped: dropped.length,
        accepted: acceptedFiles.length,
        added,
        skippedDuplicates,
        parseConcurrency: incomingHints.parseConcurrency,
        totalBytes: incomingHints.totalBytes,
        mode: this.getOpenMode(),
      });
    }

    async ensureFormattingData(items) {
      const excelItems = items.filter(
        (item) => (item.ext === 'xlsx' || item.ext === 'xls') && item.file
      );

      let hydrated = false;
      const pendingItems = excelItems.filter(
        (item) => item.parsed.sheets.some((sheet) => !Array.isArray(sheet.styles))
      );

      if (pendingItems.length > 0) {
        const hints = this.getIncomingWorkloadHints(
          pendingItems.map((item) => ({ file: item.file, ext: item.ext })),
          { preserveFormatting: true }
        );

        await this.mapWithConcurrency(pendingItems, hints.parseConcurrency, async (item) => {
          this.setStatus(`Preparing formatting for ${item.name}…`, 'loading');
          item.parsed = await this.runProcessingTask(
            'parse',
            { file: item.file, options: { preserveFormatting: true } },
            () => Parser.parse(item.file, { preserveFormatting: true })
          );
          item.stats = this.computeParsedStats(item.parsed);
          hydrated = true;
        });
      }

      if (hydrated) {
        this.invalidateProcessingCache();
      }
    }

    moveFile(index, direction) {
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= this.files.length) return;
      const [item] = this.files.splice(index, 1);
      this.files.splice(newIndex, 0, item);
      this.markFilesChanged();
      this.renderFileList();
      this.schedulePreviewRefresh();
      this.saveFilesSession();
    }

    removeFile(index) {
      // If removing the currently previewed file, fall back to index 0
      const currentIdx = parseInt(this.previewSelect.value, 10);
      this.files.splice(index, 1);
      this.rebuildFingerprints();
      this.markFilesChanged();
      this.renderFileList();
      // Adjust select value after removal
      if (this.files.length > 0) {
        this.previewSelect.value = Math.min(currentIdx, this.files.length - 1);
      }
      this.updateUI();
      this.setStatus(
        this.files.length > 0
          ? `${this.files.length} file(s) ready`
          : 'Drop files to get started',
        this.files.length > 0 ? 'success' : 'info'
      );
      this.saveFilesSession();
    }

    clearFiles() {
      this.files = [];
      this.fileFingerprints.clear();
      this.fileIdentityKeys.clear();
      this.customMappings = [];
      this.markFilesChanged();
      this.renderFileList();
      this.updateUI();
      this.setStatus('Drop files to get started', 'info');
      this.saveFilesSession();
    }

    // ---- UI Rendering ----

    renderFileList() {
      this.fileList.innerHTML = '';

      this.files.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'file-item';

        const stats = item.stats || (item.parsed ? this.getEntryStats(item) : null);
        const rows = stats?.rowCount || 0;
        const cols = stats?.colCount || 0;
        const sheetCount = stats?.sheetCount || item.parsed?.sheets?.length || 0;
        const metaText = item.parsed
          ? `${rows} rows &times; ${cols} cols${
            sheetCount > 1 ? ` &middot; ${sheetCount} sheets` : ''
          }`
          : `Ready on demand${item.size ? ` &middot; ${this.formatBytes(item.size)}` : ''}`;

        const info = document.createElement('div');
        info.className = 'file-info';
        const isMaster = index === 0 && this.files.length >= 2 && this.getOpenMode() === 'merge';
        info.innerHTML = `
          <span class="file-icon">
            <i data-lucide="${this.fileIcon(item.ext)}" class="app-icon" aria-hidden="true"></i>
          </span>
          <div class="file-details">
            <span class="file-name">${this.escapeHtml(item.name)}${isMaster ? ' <span class="master-badge">Master</span>' : ''}</span>
            <span class="file-meta">${metaText}</span>
          </div>
        `;

        const actions = document.createElement('div');
        actions.className = 'file-actions';

        if (this.files.length > 1) {
          const upBtn = document.createElement('button');
          upBtn.className = 'file-action-btn reorder-btn';
          upBtn.innerHTML = this.iconMarkup('arrow-up');
          upBtn.title = 'Move up';
          upBtn.setAttribute('aria-label', 'Move file up');
          upBtn.disabled = index === 0;
          upBtn.addEventListener('click', () => this.moveFile(index, -1));

          const downBtn = document.createElement('button');
          downBtn.className = 'file-action-btn reorder-btn';
          downBtn.innerHTML = this.iconMarkup('arrow-down');
          downBtn.title = 'Move down';
          downBtn.setAttribute('aria-label', 'Move file down');
          downBtn.disabled = index === this.files.length - 1;
          downBtn.addEventListener('click', () => this.moveFile(index, 1));

          actions.appendChild(upBtn);
          actions.appendChild(downBtn);
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = 'file-action-btn remove-btn';
        removeBtn.innerHTML = this.iconMarkup('x');
        removeBtn.title = 'Remove file';
        removeBtn.setAttribute('aria-label', 'Remove file');
        removeBtn.addEventListener('click', () => this.removeFile(index));

        actions.appendChild(removeBtn);
        li.appendChild(info);
        li.appendChild(actions);
        this.fileList.appendChild(li);
      });

      this.fileCount.textContent =
        this.files.length > 0 ? `(${this.files.length})` : '';
      this.renderIcons(this.fileList);
    }

    updateUI() {
      const hasFiles = this.files.length > 0;
      // options-panel is always visible so the gear button works without files
      this.mergeOption.classList.toggle('hidden', this.files.length < 2);
      this.uploadBtn.disabled = !hasFiles;
      this.clearBtn.disabled = !hasFiles;
      this.populatePreviewSelect();
      this.updateOpenModeState();
      if (hasFiles) {
        this.schedulePreviewRefresh();
      } else {
        this.hidePreview();
      }
    }

    /** Rebuild the dropdown options from the current files array. */
    populatePreviewSelect() {
      const select = this.previewSelect;
      const prevValue = select.value;
      select.innerHTML = '';

      this.files.forEach((item, index) => {
        const opt = document.createElement('option');
        opt.value = index;
        opt.textContent = item.name;
        select.appendChild(opt);
      });

      // Restore previous selection if still valid
      const prevIdx = parseInt(prevValue, 10);
      if (!isNaN(prevIdx) && prevIdx < this.files.length) {
        select.value = prevIdx;
      } else {
        select.value = this.files.length > 0 ? '0' : '';
      }
    }

    /** Enable/disable and populate the dropdown based on open mode. */
    updateOpenModeState() {
      const isMerge = this.getOpenMode() === 'merge';
      this.previewSelect.disabled = isMerge || this.files.length === 0;
      this.smartMappingOption.classList.toggle('hidden', !isMerge);
      if (!isMerge) {
        this.mappingReview.classList.add('hidden');
        this.customMappingOption.classList.add('hidden');
        this.customMappingList.innerHTML = '';
      }
      void this.updateCustomMappingVisibility();
    }

    fileIcon(ext) {
      return {
        csv: 'file-chart-column',
        tsv: 'file-chart-column',
        xlsx: 'file-spreadsheet',
        xls: 'file-spreadsheet',
      }[ext] || 'file';
    }

    // ---- Cleaning & Merging ----

    getCleaningOptions() {
      return {
        trim: document.getElementById('opt-trim').checked,
        removeEmptyRows: document.getElementById('opt-empty-rows').checked,
        removeEmptyColumns: document.getElementById('opt-empty-cols').checked,
        removeDuplicates: document.getElementById('opt-duplicates').checked,
        duplicateMode: document.querySelector('input[name="dup-mode"]:checked')?.value ?? 'keep-first',
        fixNumbers: document.getElementById('opt-numbers').checked,
        normalizeHeaders: document.getElementById('opt-headers').checked,
        preserveFormatting: document.getElementById('opt-preserve-fmt').checked,
      };
    }

    getOpenMode() {
      const selected = document.querySelector('input[name="open-mode"]:checked');
      return selected ? selected.value : 'separate';
    }

    /**
     * Run cleaning on all files and optionally merge.
     * Returns an array of { sheets } objects ready for upload.
     */
    async getProcessedData() {
      const options = this.getCleaningOptions();
      const mode = this.getOpenMode();

      if (mode === 'merge' && this.files.length > 1) {
        return [await this.getMergedProcessedData(options)];
      }

      const processed = [];
      for (let fileIndex = 0; fileIndex < this.files.length; fileIndex++) {
        const item = this.files[fileIndex];
        const sheets = [];
        for (let sheetIndex = 0; sheetIndex < item.parsed.sheets.length; sheetIndex++) {
          const sheet = item.parsed.sheets[sheetIndex];
          sheets.push({
            name: sheet.name,
            data: await this.getCleanedSheetData(fileIndex, sheetIndex, options),
          });
        }
        processed.push({ sheets });
      }

      return processed;
    }

    // ---- Preview ----

    async detectSmartMappings(usePreviewSamples = false) {
      const rawForDetection = [];

      for (const item of this.files) {
        if (usePreviewSamples || !item.parsed) {
          const preview = await this.ensurePreviewSample(item);
          rawForDetection.push({
            sheets: [{
              name: preview.sheets[0]?.name || item.name,
              data: preview.sheets[0]?.data || [],
            }],
          });
          continue;
        }

        rawForDetection.push({
          sheets: item.parsed.sheets.map((s) => ({ name: s.name, data: s.data })),
        });
      }

      return this.runProcessingTask(
        'detectMappings',
        { files: rawForDetection },
        () => Merger.detectMappings(rawForDetection)
      );
    }

    renderPreviewNotice(message, detail = '') {
      this.previewStats.textContent = detail;
      this.previewTable.innerHTML = `<div>${this.escapeHtml(message)}</div>`;
      this.previewPanel.classList.remove('hidden');
    }

    /** Auto-called whenever files, mode, or options change. */
    async refreshPreview() {
      const previewStart = this.now();
      const previewTaskId = this.beginPreviewTask();
      if (this.files.length === 0) {
        this.hidePreview();
        this.logTiming('refresh preview', previewStart, { files: 0, visible: false });
        return;
      }

      const mode = this.getOpenMode();
      const options = this.getCleaningOptions();
      const useSamplePreview = this.shouldDeferPreview();

      if (mode === 'merge') {
        if (useSamplePreview) {
          try {
            const samplePreview = await this.getResponsiveMergePreview(options);
            if (!this.isPreviewTaskCurrent(previewTaskId)) return;

            const mappings = await this.detectSmartMappings(true);
            if (!this.isPreviewTaskCurrent(previewTaskId)) return;

            const uncovered = this.filterUncoveredMappings(mappings);
            if (
              !this.smartMappingOption.classList.contains('hidden') &&
              this.smartMappingCheckbox.checked &&
              !this.smartMappingApproved &&
              !this.smartMappingDeclined &&
              uncovered.length > 0
            ) {
              this.showMappingReview(uncovered);
            } else if (
              this.smartMappingOption.classList.contains('hidden') ||
              !this.smartMappingCheckbox.checked ||
              uncovered.length === 0
            ) {
              this.mappingReview.classList.add('hidden');
            }

            const sheet = samplePreview.merged.sheets[0];
            if (sheet && sheet.data.length > 0) {
              this.renderPreviewTable(sheet.data, `Merged (${this.files.length} files)`, samplePreview.summary);
              this.previewPanel.classList.remove('hidden');
              this.logTiming('refresh preview sample', previewStart, {
                mode,
                files: this.files.length,
                rows: samplePreview.summary.totalRows,
                cols: samplePreview.summary.totalCols,
              });
            } else {
              this.hidePreview();
            }
          } catch (error) {
            if (!this.isPreviewTaskCurrent(previewTaskId)) return;
            this.renderPreviewNotice(error.message);
            this.logTiming('refresh preview failed', previewStart, { error: error.message, mode });
          }
          return;
        }

        try {
          await this.ensureEntriesParsed(this.files, { preserveFormatting: false }, 'merge preview');
        } catch (error) {
          if (!this.isPreviewTaskCurrent(previewTaskId)) return;
          this.renderPreviewNotice(error.message);
          this.logTiming('refresh preview failed', previewStart, { error: error.message, mode });
          return;
        }

        if (!this.isPreviewTaskCurrent(previewTaskId)) return;

        // Smart mapping detection
        if (
          !this.smartMappingOption.classList.contains('hidden') &&
          this.smartMappingCheckbox.checked &&
          !this.smartMappingApproved &&
          !this.smartMappingDeclined
        ) {
          const mappings = await this.detectSmartMappings();
          if (!this.isPreviewTaskCurrent(previewTaskId)) return;
          const uncovered = this.filterUncoveredMappings(mappings);
          if (uncovered.length > 0) {
            this.showMappingReview(uncovered);
          } else {
            this.smartMappingApproved = true;
            this.mappingReview.classList.add('hidden');
          }
        } else if (
          this.smartMappingOption.classList.contains('hidden') ||
          !this.smartMappingCheckbox.checked
        ) {
          this.mappingReview.classList.add('hidden');
        }

        const merged = await this.getMergedProcessedData(options);
        if (!this.isPreviewTaskCurrent(previewTaskId)) return;
        const sheet = merged.sheets[0];
        if (sheet && sheet.data.length > 0) {
          this.renderPreviewTable(sheet.data, `Merged (${this.files.length} files)`);
          this.previewPanel.classList.remove('hidden');
          this.logTiming('refresh preview', previewStart, {
            mode,
            files: this.files.length,
            rows: sheet.data.length,
            cols: sheet.data[0]?.length || 0,
            visible: true,
          });
        } else {
          this.hidePreview();
          this.logTiming('refresh preview', previewStart, {
            mode,
            files: this.files.length,
            visible: false,
          });
        }
      } else {
        this.mappingReview.classList.add('hidden');
        const idx = parseInt(this.previewSelect.value, 10);
        const item = this.files[isNaN(idx) ? 0 : idx];
        if (!item) {
          this.hidePreview();
          this.logTiming('refresh preview', previewStart, {
            mode,
            files: this.files.length,
            visible: false,
          });
          return;
        }
        if (useSamplePreview) {
          try {
            const samplePreview = await this.getResponsiveSeparatePreview(item);
            if (!this.isPreviewTaskCurrent(previewTaskId)) return;
            this.renderPreviewTable(samplePreview.data, item.name, samplePreview.summary);
            this.previewPanel.classList.remove('hidden');
            this.logTiming('refresh preview sample', previewStart, {
              mode,
              file: item.name,
              rows: samplePreview.summary.totalRows,
              cols: samplePreview.summary.totalCols,
              visible: true,
            });
          } catch (error) {
            if (!this.isPreviewTaskCurrent(previewTaskId)) return;
            this.renderPreviewNotice(error.message);
            this.logTiming('refresh preview failed', previewStart, {
              mode,
              file: item.name,
              error: error.message,
            });
          }
          return;
        }
        try {
          await this.ensureParsedEntry(item, { preserveFormatting: false }, 'preview');
        } catch (error) {
          if (!this.isPreviewTaskCurrent(previewTaskId)) return;
          this.renderPreviewNotice(error.message);
          this.logTiming('refresh preview failed', previewStart, {
            mode,
            file: item.name,
            error: error.message,
          });
          return;
        }
        if (!this.isPreviewTaskCurrent(previewTaskId)) return;
        const cleaned = await this.getCleanedSheetData(isNaN(idx) ? 0 : idx, 0, options);
        if (!this.isPreviewTaskCurrent(previewTaskId)) return;
        this.renderPreviewTable(cleaned, item.name);
        this.previewPanel.classList.remove('hidden');
        this.logTiming('refresh preview', previewStart, {
          mode,
          file: item.name,
          rows: cleaned.length,
          cols: cleaned[0]?.length || 0,
          visible: true,
        });
      }
    }

    showMappingReview(mappings) {
      let html = '';
      for (const mapping of mappings) {
        html += '<div class="mapping-group">';
        html += mapping.variants
          .map((v) => `<code>${this.escapeHtml(v)}</code>`)
          .join(', ');
        html += ` <span class="mapping-arrow">&rarr;</span> <strong>${this.escapeHtml(mapping.canonical)}</strong>`;
        html += '</div>';
      }
      this.mappingReviewList.innerHTML = html;
      this.mappingReview.classList.remove('hidden');
    }

    // ---- Custom Column Mapping ----

    normalizeHeaderKey(header) {
      return String(header ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    }

    fuzzyNormalizeHeaderKey(header) {
      let key = String(header ?? '')
        .trim()
        .toLowerCase()
        .replace(/[_\-]/g, ' ')
        .replace(/\s+/g, ' ');

      if (key.length > 3) {
        if (/ies$/.test(key)) {
          key = key.slice(0, -3) + 'y';
        } else if (/(?:s|x|z|ch|sh)es$/.test(key)) {
          key = key.slice(0, -2);
        } else if (/[^s]s$/.test(key)) {
          key = key.slice(0, -1);
        }
      }

      return key;
    }

    getHeaderKey(header, smartMapping = this.isSmartMappingActive()) {
      return smartMapping
        ? this.fuzzyNormalizeHeaderKey(header)
        : this.normalizeHeaderKey(header);
    }

    collectHeadersByFileFromRaw(rawFiles, fileNames) {
      if (typeof Merger?.collectHeadersByFile === 'function') {
        return Merger.collectHeadersByFile(rawFiles, fileNames);
      }

      const result = [];
      for (let i = 0; i < rawFiles.length; i++) {
        const sheet = rawFiles[i]?.sheets?.[0];
        const headers = [];
        for (const header of (sheet?.data?.[0] || [])) {
          const display = String(header ?? '').trim();
          if (display) headers.push(display);
        }
        result.push({
          fileName: (fileNames && fileNames[i]) || `File ${i + 1}`,
          headers,
        });
      }
      return result;
    }

    buildCustomMappingContextFromHeaders(headersByFile, smartMapping = this.isSmartMappingActive()) {
      const uniqueHeaders = (headers) => {
        const seenKeys = new Set();
        const result = [];

        for (const header of headers || []) {
          const display = String(header ?? '').trim();
          if (!display) continue;
          const key = this.getHeaderKey(display, smartMapping);
          if (!key || seenKeys.has(key)) continue;
          seenKeys.add(key);
          result.push({ display, key });
        }

        return result;
      };

      const masterGroup = headersByFile[0] || { fileName: 'File 1', headers: [] };
      const masterEntries = uniqueHeaders(masterGroup.headers);
      const masterHeaders = masterEntries.map(({ display }) => display);
      const masterKeySet = new Set(masterEntries.map(({ key }) => key));
      const availableTargetsBySource = new Map();
      const nonMasterGroups = [];

      for (const group of headersByFile.slice(1)) {
        const entries = uniqueHeaders(group.headers);
        const sourceKeySet = new Set(entries.map(({ key }) => key));
        const candidateHeaders = [];

        for (const entry of entries) {
          if (masterKeySet.has(entry.key)) continue;

          const availableTargets = masterEntries
            .filter((masterEntry) => !sourceKeySet.has(masterEntry.key))
            .map((masterEntry) => masterEntry.display);

          if (availableTargets.length === 0) continue;

          candidateHeaders.push(entry.display);
          const mergedTargets = availableTargetsBySource.get(entry.display) || new Set();
          for (const target of availableTargets) {
            mergedTargets.add(target);
          }
          availableTargetsBySource.set(entry.display, mergedTargets);
        }

        nonMasterGroups.push({
          fileName: group.fileName,
          headers: candidateHeaders,
        });
      }

      const normalizedTargets = new Map();
      for (const [sourceHeader, targets] of availableTargetsBySource.entries()) {
        normalizedTargets.set(sourceHeader, Array.from(targets));
      }

      const defaultTargetHeaders = Array.from(
        new Set(Array.from(normalizedTargets.values()).flat())
      );

      return {
        headersByFile,
        masterGroup: {
          fileName: masterGroup.fileName,
          headers: masterHeaders,
        },
        nonMasterGroups,
        availableTargetsBySource: normalizedTargets,
        defaultTargetHeaders,
        hasCandidateHeaders: normalizedTargets.size > 0,
      };
    }

    hasSmartMappingCandidatesFromHeaders(headersByFile) {
      const seen = new Set();
      const uniqueHeaders = [];

      for (const group of headersByFile || []) {
        for (const header of group.headers || []) {
          const display = String(header ?? '').trim();
          if (!display || seen.has(display)) continue;
          seen.add(display);
          uniqueHeaders.push(display);
        }
      }

      const groups = new Map();
      for (const header of uniqueHeaders) {
        const key = this.fuzzyNormalizeHeaderKey(header);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(header);
      }

      for (const headers of groups.values()) {
        if (headers.length < 2) continue;
        const exactKeys = new Set(headers.map((header) => this.normalizeHeaderKey(header)));
        if (exactKeys.size > 1) return true;
      }

      return false;
    }

    buildCustomMappingContextFromRawFiles(rawFiles, fileNames, smartMapping = this.isSmartMappingActive()) {
      const headersByFile = this.collectHeadersByFileFromRaw(rawFiles, fileNames);
      return this.buildCustomMappingContextFromHeaders(headersByFile, smartMapping);
    }

    async buildCustomMappingContextForCurrentFiles() {
      const rawFiles = [];
      const fileNames = this.files.map((item) => item.name);

      for (const item of this.files) {
        if (item.parsed) {
          rawFiles.push({
            sheets: [{
              name: item.parsed.sheets[0]?.name || item.name,
              data: item.parsed.sheets[0]?.data || [],
            }],
          });
          continue;
        }

        const preview = await this.ensurePreviewSample(item);
        rawFiles.push({
          sheets: [{
            name: preview.sheets[0]?.name || item.name,
            data: preview.sheets[0]?.data || [],
          }],
        });
      }

      return this.buildCustomMappingContextFromRawFiles(rawFiles, fileNames);
    }

    getActiveCustomMappingsForContext(context) {
      if (!context?.hasCandidateHeaders) return [];

      return this.customMappings
        .map((mapping) => ({
          from: String(mapping?.from ?? '').trim(),
          to: String(mapping?.to ?? '').trim(),
        }))
        .filter(({ from, to }) => {
          if (!from || !to) return false;
          const availableTargets = context.availableTargetsBySource.get(from) || [];
          return availableTargets.includes(to);
        });
    }

    syncCustomMappingsWithContext(context) {
      const nextMappings = [];

      for (const mapping of this.customMappings) {
        const from = String(mapping?.from ?? '').trim();
        const to = String(mapping?.to ?? '').trim();

        if (!from && !to) {
          nextMappings.push({ from: '', to: '' });
          continue;
        }

        if (!from) continue;

        const availableTargets = context.availableTargetsBySource.get(from);
        if (!availableTargets) continue;

        nextMappings.push({
          from,
          to: to && availableTargets.includes(to) ? to : '',
        });
      }

      if (JSON.stringify(nextMappings) !== JSON.stringify(this.customMappings)) {
        this.customMappings = nextMappings;
        this.invalidateProcessingCache();
        this.savePreferences();
      }
    }

    async updateCustomMappingVisibility() {
      const isMergeMode = this.getOpenMode() === 'merge' && this.files.length > 1;

      if (!isMergeMode) {
        this.smartMappingOption.classList.add('hidden');
        this.customMappingOption.classList.add('hidden');
        this.customMappingList.innerHTML = '';
        this.mappingReview.classList.add('hidden');
        return;
      }

      try {
        const context = await this.buildCustomMappingContextForCurrentFiles();
        const showHeaderMappingOption =
          context.hasCandidateHeaders ||
          this.hasSmartMappingCandidatesFromHeaders(context.headersByFile);

        this.smartMappingOption.classList.toggle('hidden', !showHeaderMappingOption);
        if (!showHeaderMappingOption) {
          this.customMappingOption.classList.add('hidden');
          this.customMappingList.innerHTML = '';
          this.mappingReview.classList.add('hidden');
          return;
        }

        const shouldShowSection = this.smartMappingCheckbox.checked;
        this.syncCustomMappingsWithContext(context);
        this.customMappingOption.classList.toggle(
          'hidden',
          !shouldShowSection || !context.hasCandidateHeaders
        );
        this.customMappingAddBtn.disabled = !context.hasCandidateHeaders;

        if (shouldShowSection && context.hasCandidateHeaders) {
          await this.renderCustomMappings(context);
        } else {
          this.customMappingList.innerHTML = '';
        }
      } catch (error) {
        this.customMappingOption.classList.remove('hidden');
        this.customMappingAddBtn.disabled = true;
        this.customMappingList.innerHTML = `<div>${this.escapeHtml(error.message)}</div>`;
      }
    }

    /**
     * Filter out detected smart mappings that are already covered by custom mappings.
     * A mapping is covered if every variant pair is linked by a custom mapping (either direction).
     */
    filterUncoveredMappings(mappings) {
      if (this.customMappings.length === 0) return mappings;

      const normalize = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
      const customPairs = new Set();
      for (const { from, to } of this.customMappings) {
        if (!from || !to) continue;
        const nf = normalize(from);
        const nt = normalize(to);
        customPairs.add(`${nf}\0${nt}`);
        customPairs.add(`${nt}\0${nf}`);
      }

      return mappings.filter((mapping) => {
        const variants = mapping.variants;
        for (let i = 0; i < variants.length; i++) {
          for (let j = i + 1; j < variants.length; j++) {
            const a = normalize(variants[i]);
            const b = normalize(variants[j]);
            if (!customPairs.has(`${a}\0${b}`)) return true;
          }
        }
        return false;
      });
    }

    addCustomMapping() {
      this.customMappings.push({ from: '', to: '' });
      void this.renderCustomMappings();
    }

    removeCustomMapping(index) {
      this.customMappings.splice(index, 1);
      this.invalidateProcessingCache();
      void this.renderCustomMappings();
      this.schedulePreviewRefresh();
      this.savePreferences();
    }

    updateCustomMapping(index, field, value) {
      this.customMappings[index][field] = value;
      this.invalidateProcessingCache();
      void this.renderCustomMappings();
      this.schedulePreviewRefresh();
      this.savePreferences();
    }

    async renderCustomMappings(context) {
      if (
        this.getOpenMode() !== 'merge' ||
        !this.smartMappingCheckbox.checked ||
        this.files.length <= 1
      ) {
        this.customMappingList.innerHTML = '';
        return;
      }

      let resolvedContext = context;
      if (!resolvedContext) {
        try {
          resolvedContext = await this.buildCustomMappingContextForCurrentFiles();
        } catch (error) {
          this.customMappingList.innerHTML = `<div>${this.escapeHtml(error.message)}</div>`;
          return;
        }
      }

      this.syncCustomMappingsWithContext(resolvedContext);
      if (!resolvedContext.hasCandidateHeaders) {
        this.customMappingList.innerHTML = '';
        return;
      }

      this.customMappingList.innerHTML = '';

      this.customMappings.forEach((mapping, index) => {
        const row = document.createElement('div');
        row.className = 'custom-mapping-row';

        const fromSelect = this.buildGroupedHeaderSelect(
          resolvedContext.nonMasterGroups,
          mapping.from,
          'Source\u2026'
        );
        fromSelect.addEventListener('change', () =>
          this.updateCustomMapping(index, 'from', fromSelect.value)
        );

        const arrow = document.createElement('span');
        arrow.className = 'custom-mapping-arrow';
        arrow.textContent = '\u2192';

        const allowedTargets = mapping.from
          ? (resolvedContext.availableTargetsBySource.get(mapping.from) || [])
          : resolvedContext.defaultTargetHeaders;
        const toSelect = this.buildMasterHeaderSelect(
          resolvedContext.masterGroup,
          mapping.to,
          'Master column\u2026',
          allowedTargets
        );
        toSelect.addEventListener('change', () =>
          this.updateCustomMapping(index, 'to', toSelect.value)
        );

        const removeBtn = document.createElement('button');
        removeBtn.className = 'file-action-btn remove-btn';
        removeBtn.innerHTML = this.iconMarkup('x');
        removeBtn.title = 'Remove mapping';
        removeBtn.setAttribute('aria-label', 'Remove mapping');
        removeBtn.addEventListener('click', () => this.removeCustomMapping(index));

        row.appendChild(fromSelect);
        row.appendChild(arrow);
        row.appendChild(toSelect);
        row.appendChild(removeBtn);
        this.customMappingList.appendChild(row);
      });

      this.renderIcons(this.customMappingList);
    }

    buildGroupedHeaderSelect(groups, selectedValue, placeholder) {
      const select = document.createElement('select');
      select.className = 'custom-mapping-select';

      const placeholderOpt = document.createElement('option');
      placeholderOpt.value = '';
      placeholderOpt.textContent = placeholder;
      select.appendChild(placeholderOpt);

      for (const group of groups) {
        if (!group.headers || group.headers.length === 0) continue;
        const optgroup = document.createElement('optgroup');
        optgroup.label = group.fileName;
        for (const h of group.headers) {
          const opt = document.createElement('option');
          opt.value = h;
          opt.textContent = h;
          if (h === selectedValue) opt.selected = true;
          optgroup.appendChild(opt);
        }
        select.appendChild(optgroup);
      }

      return select;
    }

    buildMasterHeaderSelect(masterGroup, selectedValue, placeholder, allowedHeaders) {
      const select = document.createElement('select');
      select.className = 'custom-mapping-select';

      const placeholderOpt = document.createElement('option');
      placeholderOpt.value = '';
      placeholderOpt.textContent = placeholder;
      select.appendChild(placeholderOpt);

      const allowed = new Set(allowedHeaders || masterGroup.headers || []);
      for (const h of (masterGroup.headers || [])) {
        if (!allowed.has(h)) continue;
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h;
        if (h === selectedValue) opt.selected = true;
        select.appendChild(opt);
      }

      return select;
    }

    renderPreviewTable(data, label = '', summary = {}) {
      const MAX_ROWS = 50;
      const MAX_COLS = 15;

      const display = data.slice(0, MAX_ROWS + 1); // +1 for header row
      const colCount = Math.min(data[0]?.length || 0, MAX_COLS);
      const totalCols = summary.totalCols || data[0]?.length || 0;
      const truncatedCols = totalCols > MAX_COLS;

      // Convert column index to spreadsheet letter(s): 0→A, 25→Z, 26→AA …
      const colLabel = (i) => {
        let s = '';
        let n = i + 1;
        while (n > 0) {
          n--;
          s = String.fromCharCode(65 + (n % 26)) + s;
          n = Math.floor(n / 26);
        }
        return s;
      };

      let html = '<table>';

      // Column-letter header row: corner cell + A B C … + optional truncation
      if (display.length > 0) {
        html += '<thead>';
        html += '<tr class="col-label-row">';
        html += '<th class="gutter-corner"></th>'; // top-left corner
        for (let j = 0; j < colCount; j++) {
          html += `<th class="col-label">${colLabel(j)}</th>`;
        }
        if (truncatedCols) html += '<th class="col-label">…</th>';
        html += '</tr>';

        // Data header row (row 1 of the spreadsheet)
        html += '<tr>';
        html += '<td class="row-num">1</td>';
        for (let j = 0; j < colCount; j++) {
          html += `<th>${this.escapeHtml(String(display[0][j] ?? ''))}</th>`;
        }
        if (truncatedCols) html += '<th>…</th>';
        html += '</tr>';
        html += '</thead>';
      }

      // Body rows (rows 2, 3, … in spreadsheet numbering)
      html += '<tbody>';
      for (let i = 1; i < display.length; i++) {
        html += '<tr>';
        html += `<td class="row-num">${i + 1}</td>`;
        for (let j = 0; j < colCount; j++) {
          html += `<td>${this.escapeHtml(String(display[i][j] ?? ''))}</td>`;
        }
        if (truncatedCols) html += '<td>…</td>';
        html += '</tr>';
      }
      html += '</tbody>';

      if (data.length > MAX_ROWS + 1) {
        html += `<tfoot><tr><td class="row-num"></td><td colspan="${colCount + (truncatedCols ? 1 : 0)}">… ${data.length - MAX_ROWS - 1} more rows</td></tr></tfoot>`;
      }

      html += '</table>';

      const totalRows = summary.totalRows;
      const visibleRows = Math.max(Math.min(data.length, MAX_ROWS + 1) - 1, 0);
      const exactRows = Math.max((typeof totalRows === 'number' ? totalRows : data.length) - 1, 0);
      const parts = [];

      if (summary.sampled) {
        if (typeof totalRows === 'number') {
          parts.push(`Showing ${visibleRows} of ${exactRows} rows × ${totalCols} columns`);
        } else {
          parts.push(`Showing first ${visibleRows} rows × ${totalCols} columns`);
        }
      } else {
        parts.push(`${exactRows} rows × ${totalCols} columns`);
      }

      if (summary.fileSize) {
        parts.push(this.formatBytes(summary.fileSize));
      }

      this.previewStats.textContent = parts.join(' • ');
      this.previewTable.innerHTML = html;
    }

    hidePreview() {
      this.previewPanel.classList.add('hidden');
      this.mappingReview.classList.add('hidden');
      this.previewStats.textContent = '';
      this.previewTable.innerHTML = '';
    }

    // ---- Upload ----

    async handleUpload() {
      if (this.files.length === 0) return;

      const uploadStart = this.now();
      this.uploadBtn.disabled = true;
      this.showProgress(0);

      try {
        const options = this.getCleaningOptions();
        const mode = this.getOpenMode();
        const shouldTightenGrid = options.removeEmptyRows || options.removeEmptyColumns;
        const apiContext = { responseCache: new Map(), tightGrid: shouldTightenGrid };
        const hasCleaning =
          options.trim || options.removeEmptyRows || options.removeEmptyColumns ||
          options.removeDuplicates || options.fixNumbers || options.normalizeHeaders;
        const results = [];
        let releasedParsedEntries = false;

        if (mode === 'merge' && this.files.length > 1) {
          await this.ensureEntriesParsed(this.files, { preserveFormatting: false }, 'merge upload');
          this.showProgress(5);

          // Merge mode
          const title = `Merged — ${new Date().toLocaleDateString()}`;

          // Check which Excel files have raw data for formatting preservation
          const excelWithRaw = this.files.filter(
            (f) => (f.ext === 'xlsx' || f.ext === 'xls') && f.file
          );
          const hasSessionExcel = this.files.some(
            (f) => (f.ext === 'xlsx' || f.ext === 'xls') && !f.file
          );

          if (options.preserveFormatting && excelWithRaw.length > 0) {
            await this.ensureFormattingData(excelWithRaw);

            // Styles are already extracted during parsing — no API calls needed
            const fileStyles = this.files.map((item) =>
              (item.ext === 'xlsx' || item.ext === 'xls')
                ? item.parsed.sheets[0]?.styles || null
                : null
            );
            const fileThemeColors = this.files.map((item) =>
              (item.ext === 'xlsx' || item.ext === 'xls')
                ? item.parsed.themeColors || null
                : null
            );

            // Step 1: Merge raw data (without cleaning) to get sourceMap
            this.showProgress(10);
            const raw = this.files.map((item) => ({
              sheets: item.parsed.sheets.map((s) => ({
                name: s.name,
                data: s.data,
              })),
            }));
            const smartMapping = this.isSmartMappingActive();
            const mappingContext = this.buildCustomMappingContextFromRawFiles(
              raw,
              this.files.map((item) => item.name),
              smartMapping
            );
            const activeCustomMappings = this.getActiveCustomMappingsForContext(mappingContext);
            const merged = Merger.merge(raw, {
              smartMapping,
              customMappings: activeCustomMappings,
              includeSourceMap: true,
            });
            const mergedData = merged.sheets[0]?.data || [];
            const sourceMap = merged.sourceMap || [];
            const colCount = mergedData[0]?.length || 0;

            // Step 2: Group sourceMap by contiguous file blocks, build formatting
            const formattingBlocks = [];
            let blockStart = -1;
            let blockFileIndex = -1;
            let blockRows = [];

            for (let i = 0; i < sourceMap.length; i++) {
              const { fileIndex, sourceRow, colMap } = sourceMap[i];

              if (fileIndex !== blockFileIndex) {
                // Flush previous block (only if it had source styles)
                if (blockRows.length > 0 && fileStyles[blockFileIndex]) {
                  formattingBlocks.push({ startRow: blockStart, rows: blockRows });
                }
                blockStart = i;
                blockFileIndex = fileIndex;
                blockRows = [];
              }

              const srcStyles = fileStyles[fileIndex];
              const newRow = new Array(colCount).fill(null);
              if (srcStyles && srcStyles[sourceRow]) {
                for (let j = 0; j < colMap.length; j++) {
                  const targetIdx = colMap[j];
                  if (targetIdx >= 0 && srcStyles[sourceRow][j]) {
                    newRow[targetIdx] = GoogleAPI.sheetJsToSheetsFormat(
                      srcStyles[sourceRow][j],
                      fileThemeColors[fileIndex]
                    );
                  }
                }
              }
              blockRows.push(newRow);
            }

            // Flush last block
            if (blockRows.length > 0 && fileStyles[blockFileIndex]) {
              formattingBlocks.push({ startRow: blockStart, rows: blockRows });
            }

            // Step 3: Create spreadsheet with raw merged data
            this.setStatus('Creating spreadsheet…', 'loading');
            this.showProgress(30);
            const result = await GoogleAPI.createSpreadsheet(title, [{
              name: 'Merged',
              data: mergedData,
            }], apiContext);

            // Step 4: Apply merged formatting
            if (formattingBlocks.length > 0) {
              this.setStatus('Applying formatting…', 'loading');
              this.showProgress(55);
              await GoogleAPI.applyFormatting(result.id, formattingBlocks, apiContext);
            }

            // Step 5: Clean via Sheets API (preserves formatting)
            if (hasCleaning) {
              this.setStatus('Cleaning…', 'loading');
              this.showProgress(75);
              await GoogleAPI.cleanUploadedSheet(result.id, options, apiContext);
            }

            results.push(result);
          } else if (options.preserveFormatting && hasSessionExcel && excelWithRaw.length === 0) {
            // All Excel files are session-restored — no raw data available
            this.setStatus(
              'Re-add your files to preserve formatting (session-restored files lose raw data)',
              'warning'
            );
            return;
          } else {
            // No formatting preservation — merge and clean locally
            this.setStatus('Processing and merging data…', 'loading');
            this.showProgress(15);
            const processed = await this.getProcessedData();
            const mergedSheets = processed[0].sheets;
            this.setStatus(`Creating "${title}" in Google Sheets…`, 'loading');
            this.showProgress(50);
            const result = await GoogleAPI.createSpreadsheet(title, mergedSheets, apiContext);
            this.showProgress(90);
            results.push(result);
          }
          this.showProgress(100);
        } else {
          // Separate mode: one spreadsheet per file
          for (let i = 0; i < this.files.length; i++) {
            const item = this.files[i];
            const title = item.name.replace(/\.[^.]+$/, '') || `Sheet ${i + 1}`;
            const useNativeImport = this.shouldUseNativeDriveImport(item);
            const fileBase = (i / this.files.length) * 100;
            const fileSlice = 100 / this.files.length;

            this.setStatus(`Creating "${title}" in Google Sheets…`, 'loading');
            this.showProgress(fileBase);

            if (useNativeImport) {
              // Path 1: Upload raw file to Drive — Google handles conversion/import natively.
              const fileContext = { responseCache: new Map(), tightGrid: shouldTightenGrid };
              this.showProgress(fileBase + fileSlice * 0.3);
              const result = await GoogleAPI.uploadFileToDrive(item.file, title, fileContext);
              if (hasCleaning) {
                this.setStatus(`Cleaning "${title}"…`, 'loading');
                this.showProgress(fileBase + fileSlice * 0.7);
                await GoogleAPI.cleanUploadedSheet(result.id, options, fileContext);
              }
              results.push(result);
              releasedParsedEntries = this.shouldReleaseParsedAfterUpload(item)
                ? this.releaseParsedEntry(item) || releasedParsedEntries
                : releasedParsedEntries;
            } else {
              // Path 2: Parse locally, clean, create from data
              this.showProgress(fileBase + fileSlice * 0.1);
              await this.ensureParsedEntry(item, { preserveFormatting: false }, 'upload');
              this.showProgress(fileBase + fileSlice * 0.3);
              const sheetsData = [];
              for (let sheetIndex = 0; sheetIndex < item.parsed.sheets.length; sheetIndex++) {
                const sheet = item.parsed.sheets[sheetIndex];
                sheetsData.push({
                  name: sheet.name,
                  data: await this.getCleanedSheetData(i, sheetIndex, options),
                });
              }
              this.showProgress(fileBase + fileSlice * 0.5);
              const fileContext = { responseCache: new Map(), tightGrid: shouldTightenGrid };
              const result = await GoogleAPI.createSpreadsheet(title, sheetsData, fileContext);
              results.push(result);
              releasedParsedEntries = this.shouldReleaseParsedAfterUpload(item)
                ? this.releaseParsedEntry(item) || releasedParsedEntries
                : releasedParsedEntries;
            }

            this.showProgress(fileBase + fileSlice);
          }
        }

        // Open all created spreadsheets in new tabs without flooding the browser.
        await this.openResultTabs(results);

        const msg =
          results.length === 1
            ? 'Spreadsheet created and opened!'
            : `${results.length} spreadsheets created and opened!`;
        this.setStatus(msg, 'success');
        this.logTiming('handle upload', uploadStart, {
          mode,
          files: this.files.length,
          created: results.length,
          preserveFormatting: options.preserveFormatting,
          hasCleaning,
        });

        if (releasedParsedEntries) {
          this.renderFileList();
          this.saveFilesSession();
        }
      } catch (err) {
        console.error('Upload failed:', err);
        this.logTiming('handle upload failed', uploadStart, {
          files: this.files.length,
          error: err.message,
        });
        this.setStatus(`Upload failed: ${err.message}`, 'error');
      } finally {
        this.uploadBtn.disabled = this.files.length === 0;
        this.hideProgress();
      }
    }

    // ---- Progress & Status ----

    showProgress(percent) {
      const clamped = Math.min(Math.round(percent), 100);
      this.loadingBar.style.width = `${clamped}%`;
    }

    hideProgress() {
      setTimeout(() => {
        this.loadingBar.style.width = '0%';
        this.loadingPanel.classList.remove('loading-panel--active');
        this.loadingSpinner.classList.add('hidden');
      }, 800);
    }

    setStatus(message, type = 'info') {
      this.loadingText.textContent = message;

      // Reset all modifier classes
      this.loadingPanel.classList.remove(
        'loading-panel--active',
        'loading-panel--success',
        'loading-panel--warning',
        'loading-panel--error'
      );

      if (type === 'loading') {
        this.loadingPanel.classList.add('loading-panel--active');
        this.loadingSpinner.classList.remove('hidden');
      } else {
        this.loadingSpinner.classList.add('hidden');
        if (type === 'success') this.loadingPanel.classList.add('loading-panel--success');
        else if (type === 'warning') this.loadingPanel.classList.add('loading-panel--warning');
        else if (type === 'error') this.loadingPanel.classList.add('loading-panel--error');
      }
    }

    // ---- Helpers ----

    escapeHtml(str) {
      const el = document.createElement('span');
      el.textContent = str;
      return el.innerHTML;
    }

    iconMarkup(name, className = 'app-icon') {
      return `<i data-lucide="${name}" class="${className}" aria-hidden="true"></i>`;
    }

    renderIcons(root = document) {
      if (!window.lucide?.createIcons || !root) return;
      window.lucide.createIcons({ root });
    }
  }

  // Boot
  document.addEventListener('DOMContentLoaded', () => new DragToSheetsApp());
})();
