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
  const PREVIEW_SAMPLE_ROWS = 51;
  const EXCEL_METADATA_PREVIEW_NOTICE =
    'Excel metadata-sensitive transformations (Trim, Fix numbers, and Normalize headers) are not represented in this sample because trustworthy cell metadata is unavailable; they will be applied on upload.';

  function base64ToArrayBuffer(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

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
      this.previewMode = null;
      this.primaryActionOperation = null;
      this.mergeSheetMetadataLoading = false;
      this.mergeSheetMetadataPromise = null;
      this.docsLinkHistory = [];
      this._filesListData = [];
      this.whatsappIngestQueue = Promise.resolve();
      this.init();
    }

    invalidateProcessingCache() {
      this.cleanedSheetCache.clear();
      this.processedDataCache.clear();
    }

    markFilesChanged() {
      this.fileVersion++;
      // Invalidate any in-flight preview immediately. The next scheduled
      // refresh gets a new task id and cannot be overwritten by stale work.
      this.beginPreviewTask();
      this.smartMappingApproved = false;
      this.smartMappingDeclined = false;
      this.invalidateProcessingCache();
    }

    computeParsedStats(parsed) {
      const stats = {
        sheetCount: parsed?.sheets?.length || 0,
        rowCount: 0,
        dataRowCount: 0,
        colCount: 0,
        cellCount: 0,
        styledCellCount: 0,
      };

      for (const sheet of parsed?.sheets || []) {
        const rows = sheet.data?.length || 0;
        const cols = sheet.data?.[0]?.length || 0;
        stats.rowCount += rows;
        stats.dataRowCount += Math.max(rows - 1, 0);
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
      if (!item?.parsed) return null;
      item.stats = this.computeParsedStats(item.parsed);
      delete item.summaryStats;
      return item.stats;
    }

    getIncomingWorkloadHints(entries, options = this.getCleaningOptions()) {
      const items = entries || [];
      const totalBytes = items.reduce((sum, item) => sum + (item?.file?.size || item?.size || 0), 0);
      const fileCount = items.length;
      const excelCount = items.filter((item) => item?.ext === 'xlsx' || item?.ext === 'xls').length;
      const preserveFormatting = Boolean(options?.preserveFormatting ?? true);
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
        if (stats) {
          totalCells += stats.cellCount;
          totalStyledCells += stats.styledCellCount;
          maxFileCells = Math.max(maxFileCells, stats.cellCount);
        }
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

    createParsedFileEntry(file, ext, parsed, fileHandle) {
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
        fileHandle: fileHandle || null,
        handleId: null,
        selectedMergeSheetIndex: 0,
        sheetMetadata: null,
      };
    }

    createLazyFileEntry(file, ext, fileHandle) {
      return {
        file,
        parsed: null,
        name: file.name,
        ext,
        size: file.size || 0,
        stats: null,
        identityKey: this.computeFileIdentity(file, ext),
        lazy: true,
        fileHandle: fileHandle || null,
        handleId: null,
        selectedMergeSheetIndex: 0,
        sheetMetadata: null,
      };
    }

    /**
     * Return the worksheet currently selected for merge mode.
     *
     * The index is intentionally normalized here, at the boundary where a
     * file entry is converted into a worksheet. This keeps restored, legacy,
     * and reparsed entries safe without making separate-mode code depend on
     * merge selection state.
     */
    getSelectedMergeSheet(item) {
      if (item?.kind === 'reference') {
        // Reference entries have no parsed bytes; data is fetched on demand
        // and cached on the entry by ensureReferenceData().
        return item.refData || null;
      }

      const sheets = item?.parsed?.sheets;
      if (!Array.isArray(sheets) || sheets.length === 0) {
        if (item) item.selectedMergeSheetIndex = 0;
        return null;
      }

      const selectedIndex = this.normalizeMergeSheetIndex(item, sheets.length);
      return sheets[selectedIndex];
    }

    getStoredMergeSheetIndex(item) {
      const rawIndex = Number(item?.selectedMergeSheetIndex);
      return Number.isFinite(rawIndex) ? Math.trunc(rawIndex) : 0;
    }

    normalizeMergeSheetIndex(item, sheetCount) {
      if (!Number.isInteger(sheetCount) || sheetCount <= 0) {
        if (item) item.selectedMergeSheetIndex = 0;
        return 0;
      }

      const rawIndex = Number(item?.selectedMergeSheetIndex);
      const requestedIndex = Number.isFinite(rawIndex) ? Math.trunc(rawIndex) : 0;
      const selectedIndex = Math.max(0, Math.min(requestedIndex, sheetCount - 1));
      if (item) item.selectedMergeSheetIndex = selectedIndex;
      return selectedIndex;
    }

    getMergeSheetMetadata(item) {
      const parsedSheets = item?.parsed?.sheets;
      if (Array.isArray(parsedSheets)) {
        return parsedSheets.map((sheet) => ({
          name: sheet.name,
          rowCount: Number.isFinite(sheet.rowCount)
            ? sheet.rowCount
            : (Array.isArray(sheet.data) ? sheet.data.length : null),
          colCount: Number.isFinite(sheet.colCount)
            ? sheet.colCount
            : (Array.isArray(sheet.data?.[0]) ? sheet.data[0].length : null),
        }));
      }

      return Array.isArray(item?.sheetMetadata) ? item.sheetMetadata : null;
    }

    getSelectedMergeSheetStats(item) {
      const toStats = (sheet) => {
        if (!sheet) return null;
        const rowCount = Number.isFinite(sheet.rowCount)
          ? sheet.rowCount
          : (Array.isArray(sheet.data) ? sheet.data.length : null);
        const colCount = Number.isFinite(sheet.colCount)
          ? sheet.colCount
          : (Array.isArray(sheet.data?.[0]) ? sheet.data[0].length : null);
        if (!Number.isFinite(rowCount) || !Number.isFinite(colCount)) return null;
        return {
          rowCount,
          dataRowCount: Math.max(rowCount - 1, 0),
          colCount,
        };
      };

      const parsedSheetStats = toStats(this.getSelectedMergeSheet(item));
      if (parsedSheetStats) return parsedSheetStats;

      const metadata = this.getMergeSheetMetadata(item);
      if (!Array.isArray(metadata) || metadata.length === 0) return null;
      const selectedIndex = this.normalizeMergeSheetIndex(item, metadata.length);
      return toStats(metadata[selectedIndex]);
    }

    applySelectedMergePreviewMetadata(item, preview) {
      if (!preview?.previewMeta || !item) return preview;
      const stats = this.getSelectedMergeSheetStats(item);
      if (!stats) return preview;

      Object.assign(preview.previewMeta, {
        rowCount: stats.rowCount,
        dataRowCount: stats.dataRowCount,
        colCount: stats.colCount,
        sheetCount: 1,
      });
      return preview;
    }

    getPreviewCacheKey(item, merge = false) {
      const mode = merge ? 'merge' : 'separate';
      let sheetIndex = 0;
      if (merge) {
        const metadata = this.getMergeSheetMetadata(item);
        sheetIndex = Array.isArray(metadata) && metadata.length > 0
          ? this.normalizeMergeSheetIndex(item, metadata.length)
          : this.getStoredMergeSheetIndex(item);
      }
      return `${this.fileVersion}:${mode}:${sheetIndex}`;
    }

    getCachedPreview(item, cacheKey) {
      return item?.previewCache && Object.prototype.hasOwnProperty.call(item.previewCache, cacheKey)
        ? item.previewCache[cacheKey]
        : null;
    }

    cachePreview(item, cacheKey, preview) {
      if (!item) return preview;
      if (!item.previewCache || typeof item.previewCache !== 'object') {
        item.previewCache = {};
      }
      item.previewCache[cacheKey] = preview;
      return preview;
    }

    invalidatePreviewCache(item, mode = null) {
      if (!item?.previewCache || typeof item.previewCache !== 'object') return;
      if (!mode) {
        item.previewCache = {};
        return;
      }
      const modePrefix = `:${mode}:`;
      for (const key of Object.keys(item.previewCache)) {
        if (key.includes(modePrefix)) delete item.previewCache[key];
      }
    }

    restorePreviewSummary(item, preview) {
      if (item?.parsed) return;
      const exactSummary = this.buildStatsFromPreview(preview);
      if (exactSummary) item.summaryStats = exactSummary;
    }

    /**
     * Persist a FileSystemFileHandle for a file entry into IndexedDB.
     * The handleId is stored on the entry for later retrieval.
     */
    async storeFileHandle(entry) {
      if (!entry?.fileHandle || typeof FileHandleStore === 'undefined') return;
      try {
        const id = await FileHandleStore.saveHandle(entry.fileHandle);
        entry.handleId = id;
      } catch (err) {
        this._log('warn', 'Drag to Sheets: failed to store file handle:', err.message);
      }
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
      if (item?.parsed) {
        this.getSelectedMergeSheet(item);
        return item.parsed;
      }
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
      this.getSelectedMergeSheet(item);
      item.stats = this.computeParsedStats(parsed);
      delete item.summaryStats;
      item.lazy = false;
      item.contentFingerprint = this.computeFingerprint(parsed);
      this.fileFingerprints.add(item.contentFingerprint);

      this.logTiming(`hydrate file (${reason})`, startedAt, {
        file: item.name,
        preserveFormatting: Boolean(options.preserveFormatting),
      });

      this._updateSummaryCards();
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

      // Never leave the loading status behind once the parses have finished.
      this.setStatus(`${this.files.length} file(s) ready`, 'success');
    }

    async hydrateMergeSheetMetadata() {
      if (this.getOpenMode() !== 'merge') return;
      if (this.mergeSheetMetadataPromise) {
        // Re-run after the in-flight pass settles so files added mid-load
        // still receive worksheet metadata and selectors.
        return this.mergeSheetMetadataPromise.then(() => this.hydrateMergeSheetMetadata());
      }

      const pendingItems = this.files.filter((item) =>
        item && !item.parsed && item.file &&
        (item.ext === 'xlsx' || item.ext === 'xls') &&
        !Array.isArray(item.sheetMetadata)
      );

      if (pendingItems.length === 0) {
        this.renderFileList();
        await this.updateCustomMappingVisibility();
        return;
      }

      const hydration = (async () => {
        this.mergeSheetMetadataLoading = true;
        this.setStatus('Loading worksheet information\u2026', 'loading');
        this.renderFileList();

        try {
          const hints = this.getIncomingWorkloadHints(
            pendingItems.map((item) => ({ file: item.file, ext: item.ext, size: item.size })),
            { preserveFormatting: false }
          );

          await this.mapWithConcurrency(pendingItems, hints.parseConcurrency, async (item, index) => {
            this.setStatus(`Loading worksheets (${index + 1}/${pendingItems.length})\u2026`, 'loading');
            const metadata = await this.runProcessingTask(
              'workbookMetadata',
              { file: item.file },
              () => typeof Parser.getWorkbookMetadata === 'function'
                ? Parser.getWorkbookMetadata(item.file)
                : this.ensureParsedEntry(item, { preserveFormatting: false }, 'merge worksheet metadata')
            );

            item.sheetMetadata = Array.isArray(metadata?.sheets)
              ? metadata.sheets.map((sheet) => ({
                name: sheet.name,
                rowCount: Number.isFinite(sheet.rowCount) ? sheet.rowCount : null,
                colCount: Number.isFinite(sheet.colCount) ? sheet.colCount : null,
              }))
              : [];
            this.normalizeMergeSheetIndex(item, item.sheetMetadata.length);
          });

          if (this.getOpenMode() === 'merge') {
            this.renderFileList();
            this._updateSummaryCards();
            await this.updateCustomMappingVisibility();
            this.setStatus('Worksheet information loaded', 'info');
          }
        } catch (error) {
          if (this.getOpenMode() === 'merge') {
            this.renderFileList();
            this.setStatus(`Could not load worksheet information: ${error.message}`, 'warning');
          }
        } finally {
          this.mergeSheetMetadataLoading = false;
          this.renderFileList();
        }
      })();

      this.mergeSheetMetadataPromise = hydration.finally(() => {
        this.mergeSheetMetadataPromise = null;
      });
      return this.mergeSheetMetadataPromise;
    }

    buildStatsFromPreview(preview) {
      const meta = preview?.previewMeta || {};
      const rowCount = meta.rowCount ?? null;
      const dataRowCount = meta.dataRowCount ?? null;
      const colCount = meta.colCount ?? null;
      const sheetCount = meta.sheetCount ?? null;

      if (rowCount === null || dataRowCount === null || colCount === null || sheetCount === null) {
        return null;
      }

      return { sheetCount, rowCount, dataRowCount, colCount };
    }

    async ensurePreviewSample(item, { merge = false } = {}) {
      let cacheKey = this.getPreviewCacheKey(item, merge);
      let cachedPreview = this.getCachedPreview(item, cacheKey);
      if (cachedPreview) {
        this.restorePreviewSummary(item, cachedPreview);
        return cachedPreview;
      }
      if (item?.kind === 'reference') {
        return this.ensureReferencePreview(item, { merge });
      }
      if (merge && !item?.parsed && this.getStoredMergeSheetIndex(item) !== 0) {
        await this.ensureParsedEntry(item, { preserveFormatting: true }, 'merge preview');
        cacheKey = this.getPreviewCacheKey(item, merge);
        cachedPreview = this.getCachedPreview(item, cacheKey);
        if (cachedPreview) {
          this.restorePreviewSummary(item, cachedPreview);
          return cachedPreview;
        }
      }
      if (item?.parsed) {
        cacheKey = this.getPreviewCacheKey(item, merge);
        cachedPreview = this.getCachedPreview(item, cacheKey);
        if (cachedPreview) return cachedPreview;
        const sourceSheet = merge
          ? (this.getSelectedMergeSheet(item) || {})
          : (item.parsed.sheets[0] || {});
        const data = sourceSheet.data || [];
        const sourceMeta = sourceSheet.cellMeta;
        const rows = data.slice(0, PREVIEW_SAMPLE_ROWS);
        const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
        const sampledRows = rows.map((row) => row.slice(0, colCount));
        const sampledMeta = Array.isArray(sourceMeta)
          ? sourceMeta
            .slice(0, PREVIEW_SAMPLE_ROWS)
            .map((row) => (Array.isArray(row) ? row.slice(0, colCount) : row))
          : null;
        const previewSheet = {
          name: sourceSheet.name || item.name,
          data: sampledRows,
        };
        if (Array.isArray(sourceMeta)) previewSheet.cellMeta = sampledMeta;
        const isExcel = item.ext === 'xlsx' || item.ext === 'xls';
        const metadataTrusted = !isExcel || (
          Array.isArray(sampledMeta) &&
          Parser.hasTypedCellMetadata({ sheets: [{ data: sampledRows, cellMeta: sampledMeta }] })
        );
        const preview = {
          sheets: [previewSheet],
          previewMeta: {
            rowCount: merge ? data.length : (item.stats?.rowCount ?? data.length),
            dataRowCount: merge
              ? Math.max(data.length - 1, 0)
              : (item.stats?.dataRowCount ?? Math.max(data.length - 1, 0)),
            colCount: merge ? colCount : (item.stats?.colCount ?? colCount),
            sheetCount: item.stats?.sheetCount ?? item.parsed.sheets.length,
            sampled: data.length > sampledRows.length,
            sampleRows: sampledRows.length,
            fileSize: this.getFileSize(item),
            metadataTrusted,
          },
        };
        if (merge) this.applySelectedMergePreviewMetadata(item, preview);
        return this.cachePreview(item, cacheKey, preview);
      }
      if (!item?.file) {
        throw new Error(`Re-add ${item?.name || 'this file'} to preview it`);
      }

      const previewOptions = { sampleRows: 51 };
      if (merge && (item.ext === 'xlsx' || item.ext === 'xls')) {
        const metadata = this.getMergeSheetMetadata(item);
        const selectedIndex = Array.isArray(metadata)
          ? this.normalizeMergeSheetIndex(item, metadata.length)
          : this.getStoredMergeSheetIndex(item);
        previewOptions.sheetIndex = selectedIndex;
      }

      cacheKey = this.getPreviewCacheKey(item, merge);
      cachedPreview = this.getCachedPreview(item, cacheKey);
      if (cachedPreview) {
        this.restorePreviewSummary(item, cachedPreview);
        return cachedPreview;
      }

      const preview = await this.runProcessingTask(
        'preview',
        { file: item.file, options: previewOptions },
        () => Parser.preview(item.file, previewOptions)
      );
      if (merge) this.applySelectedMergePreviewMetadata(item, preview);
      this.cachePreview(item, cacheKey, preview);
      const exactSummary = this.buildStatsFromPreview(preview);
      if (exactSummary) {
        item.summaryStats = exactSummary;
      }
      this._updateSummaryCards();
      return preview;
    }

    async getResponsiveSeparatePreview(item) {
      const preview = await this.ensurePreviewSample(item);
      const options = this.getCleaningOptions();
      const rawData = preview.sheets[0]?.data || [];
      const isExcel = item.ext === 'xlsx' || item.ext === 'xls';

      let cellMeta = preview.sheets[0]?.cellMeta || null;
      if (!cellMeta && !isExcel) {
        cellMeta = rawData.map(row => row.map(v => Cleaner.tokenFromValue(v)));
      }

      const metadataTrusted = !isExcel || (
        preview.previewMeta?.metadataTrusted !== false &&
        Array.isArray(cellMeta) &&
        Parser.hasTypedCellMetadata({ sheets: [{ data: rawData, cellMeta }] })
      );

      const hasAnyOption = options.trim || options.removeEmptyRows || options.removeEmptyColumns ||
        options.removeDuplicates || options.fixNumbers || options.normalizeDates || options.normalizeHeaders;

      const structuralOps = options.removeEmptyRows || options.removeEmptyColumns || options.removeDuplicates;

      let cleanedData = rawData;
      let cleanedMeta = cellMeta;
      const notices = [];
      const cleaningOptions = { ...options };

      if (isExcel && !metadataTrusted) {
        notices.push(EXCEL_METADATA_PREVIEW_NOTICE);
        cleaningOptions.trim = false;
        cleaningOptions.fixNumbers = false;
        cleaningOptions.normalizeDates = false;
        cleaningOptions.normalizeHeaders = false;
      }

      if (structuralOps) {
        notices.push('Row/column removal and duplicate filtering not shown in preview — applied on upload.');
      }

      let cleaningStats = null;

      if (hasAnyOption) {
        const sanitized = {
          ...cleaningOptions,
          removeEmptyRows: false,
          removeEmptyColumns: false,
          removeDuplicates: false,
        };
        const hasEvaluatedOperation = sanitized.trim || sanitized.fixNumbers || sanitized.normalizeDates || sanitized.normalizeHeaders;

        if (hasEvaluatedOperation) {
          const cleaned = Cleaner.apply(rawData, sanitized, cellMeta);
          cleanedData = Array.isArray(cleaned) ? cleaned : cleaned.data;
          cleanedMeta = Array.isArray(cleaned) ? cellMeta : (cleaned.cellMeta || cellMeta);
          const stats = Array.isArray(cleaned) ? Cleaner.emptyStats() : cleaned.stats;

          cleaningStats = {
            stats,
            scope: 'sample',
            evaluatedOperations: {
              trim: sanitized.trim,
              removeEmptyRows: false,
              removeEmptyColumns: false,
              removeDuplicates: false,
              fixNumbers: sanitized.fixNumbers,
              normalizeDates: sanitized.normalizeDates,
              normalizeHeaders: sanitized.normalizeHeaders,
            },
          };
        }
      }

      return {
        data: cleanedData,
        cellMeta: cleanedMeta,
        notices,
        summary: {
          totalRows: preview.previewMeta?.rowCount,
          totalCols: preview.previewMeta?.colCount,
          sampled: Boolean(preview.previewMeta?.sampled),
          sampleRows: preview.previewMeta?.sampleRows,
          fileSize: preview.previewMeta?.fileSize || this.getFileSize(item),
        },
        cleaningStats,
      };
    }

    async getResponsiveMergePreview(options) {
      const smartMapping = this.isSmartMappingActive();
      const sampleFiles = [];
      let totalRows = 1;
      let totalRowsKnown = true;
      let hasUntrustedExcelMetadata = false;

      for (const item of this.files) {
        const preview = await this.ensurePreviewSample(item, { merge: true });
        const rawData = preview.sheets[0]?.data || [];
        const isExcel = item.ext === 'xlsx' || item.ext === 'xls';
        let cellMeta = preview.sheets[0]?.cellMeta || null;
        if (!cellMeta && !isExcel) {
          cellMeta = rawData.map(row => row.map(v => Cleaner.tokenFromValue(v)));
        }
        const metadataTrusted = !isExcel || (
          preview.previewMeta?.metadataTrusted !== false &&
          Array.isArray(cellMeta) &&
          Parser.hasTypedCellMetadata({ sheets: [{ data: rawData, cellMeta }] })
        );
        if (isExcel && !metadataTrusted) hasUntrustedExcelMetadata = true;
        sampleFiles.push({
          sheets: [{
            name: preview.sheets[0]?.name || item.name,
            data: rawData,
            cellMeta,
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

      // Apply non-structural cleaning to merged sample
      const hasAnyOption = options.trim || options.removeEmptyRows || options.removeEmptyColumns ||
        options.removeDuplicates || options.fixNumbers || options.normalizeDates || options.normalizeHeaders;
      const structuralOps = options.removeEmptyRows || options.removeEmptyColumns || options.removeDuplicates;
      const notices = [];
      const cleaningOptions = { ...options };

      if (hasUntrustedExcelMetadata) {
        notices.push(EXCEL_METADATA_PREVIEW_NOTICE);
        cleaningOptions.trim = false;
        cleaningOptions.fixNumbers = false;
        cleaningOptions.normalizeDates = false;
        cleaningOptions.normalizeHeaders = false;
      }

      if (structuralOps) {
        notices.push('Row/column removal and duplicate filtering not shown in preview — applied on upload.');
      }

      let cleaningStats = null;

      if (hasAnyOption && merged.sheets[0]?.data) {
        const sanitized = {
          ...cleaningOptions,
          removeEmptyRows: false,
          removeEmptyColumns: false,
          removeDuplicates: false,
        };
        const hasEvaluatedOperation = sanitized.trim || sanitized.fixNumbers || sanitized.normalizeDates || sanitized.normalizeHeaders;

        if (hasEvaluatedOperation) {
          const cleaned = Cleaner.apply(merged.sheets[0].data, sanitized, merged.sheets[0].cellMeta || null);
          merged.sheets[0].data = Array.isArray(cleaned) ? cleaned : cleaned.data;
          merged.sheets[0].cellMeta = Array.isArray(cleaned) ? (merged.sheets[0].cellMeta || null) : (cleaned.cellMeta || merged.sheets[0].cellMeta || null);
          const stats = Array.isArray(cleaned) ? Cleaner.emptyStats() : cleaned.stats;

          cleaningStats = {
            stats,
            scope: 'sample',
            evaluatedOperations: {
              trim: sanitized.trim,
              removeEmptyRows: false,
              removeEmptyColumns: false,
              removeDuplicates: false,
              fixNumbers: sanitized.fixNumbers,
              normalizeDates: sanitized.normalizeDates,
              normalizeHeaders: sanitized.normalizeHeaders,
            },
          };
        }
      }

      return {
        merged,
        notices,
        summary: {
          totalRows: totalRowsKnown ? totalRows : null,
          totalCols: merged.sheets[0]?.data?.[0]?.length || 0,
          sampled: true,
          fileSize: this.getLoadedWorkloadHints().totalBytes,
        },
        cleaningStats,
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

      if (!Array.isArray(item.sheetMetadata)) {
        item.sheetMetadata = this.getMergeSheetMetadata(item);
      }
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

    _log(level, ...args) {
      if (!this.isPerfDebugEnabled()) return;
      const fn = console[level];
      if (typeof fn === 'function') fn(...args);
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
        normalizeDates: options.normalizeDates,
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
        { data: sheet.data, options, cellMeta: sheet.cellMeta || null },
        () => Cleaner.apply(sheet.data, options, sheet.cellMeta || null)
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

    getSelectedMergeInput(item) {
      const sheet = this.getSelectedMergeSheet(item);
      return {
        sheets: sheet ? [{
          name: sheet.name,
          data: sheet.data,
          cellMeta: sheet.cellMeta || null,
        }] : [],
      };
    }

    async getMergedProcessedData(options = this.getCleaningOptions()) {
      await this.ensureReferenceDataForFiles(this.files);
      const smartMapping = this.isSmartMappingActive();
      const raw = this.files.map((item) => this.getSelectedMergeInput(item));
      const selectedSheetKey = this.files
        .map((item) => this.getStoredMergeSheetIndex(item))
        .join(',');
      const mappingContext = this.buildCustomMappingContextFromRawFiles(
        raw,
        this.files.map((item) => item.name),
        smartMapping
      );
      const activeCustomMappings = this.getActiveCustomMappingsForContext(mappingContext);
      const cmKey = JSON.stringify(activeCustomMappings);
      const cacheKey = `merge|${this.fileVersion}|${this.getCleaningCacheKey(options)}|sm:${smartMapping}|cm:${cmKey}|sheets:${selectedSheetKey}`;

      if (this.processedDataCache.has(cacheKey)) {
        return this.processedDataCache.get(cacheKey);
      }

      const mergeOpts = { smartMapping, customMappings: activeCustomMappings };
      const mergedPromise = this.runProcessingTask(
        'mergeAndClean',
        { files: raw, mergeOptions: mergeOpts, cleanOptions: options },
        () => {
          const merged = Merger.merge(raw, mergeOpts);
          let cleanStats = null;
          merged.sheets = merged.sheets.map((sheet) => {
            const cleaned = Cleaner.apply(sheet.data, options, sheet.cellMeta || null);
            if (Array.isArray(cleaned)) {
              return { name: sheet.name, data: cleaned, cellMeta: null };
            }
            if (!cleanStats) cleanStats = cleaned.stats;
            return { name: sheet.name, data: cleaned.data, cellMeta: cleaned.cellMeta || null };
          });
          merged.cleanStats = cleanStats;
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
      this.initTheme();
      this.renderIcons();
      this.setupDragDrop();
      this.setupEvents();
      this.checkExcelSupport();
      await this.restoreSession();
      this.announcePanelReady();
    }

    /**
     * Tell the background worker the panel is ready, so any files captured
     * from WhatsApp Web while it was closed are delivered now.
     */
    announcePanelReady() {
      try {
        chrome.runtime.sendMessage({ type: 'wa:panel-ready' }).catch(() => {});
      } catch (_) {
        // Background worker unavailable (e.g. in tests) — nothing to flush.
      }
    }

    /**
     * Add a file captured from WhatsApp Web through the normal file pipeline
     * (parse → preview → upload), exactly like a dropped local file.
     */
    ingestWhatsAppFile(message) {
      const name = String(message?.name || 'whatsapp-file');
      let bytes = message?.bytes;
      const bytesBase64 = message?.bytesBase64;

      // Chrome runtime messages are JSON-serialized, so the production relay
      // uses base64. Keep accepting an ArrayBuffer for older callers/tests.
      const isArrayBuffer =
        bytes instanceof ArrayBuffer ||
        Object.prototype.toString.call(bytes) === '[object ArrayBuffer]';
      if (!isArrayBuffer && typeof bytesBase64 === 'string' && bytesBase64) {
        try {
          bytes = base64ToArrayBuffer(bytesBase64);
        } catch (_) {
          bytes = null;
        }
      }

      const hasBytes = bytes && (
        bytes instanceof ArrayBuffer ||
        Object.prototype.toString.call(bytes) === '[object ArrayBuffer]'
      );
      console.info(
        '[Drag to Sheets] panel ingest:',
        name,
        hasBytes ? bytes.byteLength : message?.byteLength,
        'encoding:', typeof bytesBase64 === 'string' ? 'base64' : 'arraybuffer'
      );
      if (!hasBytes || bytes.byteLength === 0) return;

      const file = new File([bytes], name, { type: 'application/octet-stream' });
      this.setStatus(`Adding "${name}" from WhatsApp…`, 'loading');
      // WhatsApp messages can arrive twice while the panel is opening. Queue
      // them so the first parse registers its fingerprint before the next
      // delivery is checked for duplication. Keep this path eager so a small
      // workbook is not shown as "Ready on demand" before worksheet metadata
      // is available in Merge mode.
      return this.handleFiles([file], undefined, { forceEager: true });
    }

    enqueueWhatsAppFile(message) {
      this.whatsappIngestQueue = this.whatsappIngestQueue
        .catch(() => {})
        .then(() => this.ingestWhatsAppFile(message));
      return this.whatsappIngestQueue;
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
      this.cleanupResults = document.getElementById('cleanup-results');
      this.cleanupResultsList = document.getElementById('cleanup-results-list');
      this.cleanupResultsEmpty = document.getElementById('cleanup-results-empty');
      this.uploadBtn = document.getElementById('upload-btn');
      this.themeToggle = document.getElementById('theme-toggle');
      this.filesBtn = document.getElementById('files-btn');
      this.appView = document.getElementById('app-view');
      this.filesView = document.getElementById('files-view');
      this.filesBackBtn = document.getElementById('files-back-btn');
      this.filesStatus = document.getElementById('files-status');
      this.filesRefreshBtn = document.getElementById('files-refresh');
      this.filesList = document.getElementById('files-list');
      this.settingsBtn = document.getElementById('settings-btn');
      this.cleaningOptions = document.getElementById('cleaning-options');
      this.previewSelect = document.getElementById('preview-select');
      this.clearBtn = document.getElementById('clear-btn');
      this.loadingPanel = document.getElementById('loading-panel');
      this.loadingBar = document.getElementById('loading-panel-bar');
      this.loadingSpinner = document.getElementById('loading-spinner');
      this.loadingText = document.getElementById('loading-text');
      this.loadingSrStatus = document.getElementById('loading-sr-status');
      this.loadingSrAlert = document.getElementById('loading-sr-alert');
      this.urlToggle = document.getElementById('url-toggle');
      this.urlBar = document.getElementById('url-bar');
      this.urlInput = document.getElementById('url-input');
      this.urlFetchBtn = document.getElementById('url-fetch-btn');
      this.urlHint = document.querySelector('.url-hint');
      this.docsLinkHistorySection = document.getElementById('docs-link-history');
      this.docsLinkHistoryList = document.getElementById('docs-link-history-list');
      this.filesClearBtn = document.getElementById('files-clear');
      this.filesSearch = document.getElementById('files-search');
      this.smartMappingOption = document.getElementById('smart-mapping-option');
      this.smartMappingCheckbox = document.getElementById('opt-smart-mapping');
      this.mappingReview = document.getElementById('mapping-review');
      this.mappingReviewList = document.getElementById('mapping-review-list');
      this.mappingApproveBtn = document.getElementById('mapping-approve-btn');
      this.mappingDeclineBtn = document.getElementById('mapping-decline-btn');
      this.customMappingOption = document.getElementById('custom-mapping-option');
      this.customMappingList = document.getElementById('custom-mapping-list');
      this.customMappingAddBtn = document.getElementById('custom-mapping-add');

      this.uploading = false;
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
      this.dropZone.addEventListener('drop', async (e) => {
        unhighlight(e);
        // Capture files synchronously before DataTransfer expires
        const files = Array.from(e.dataTransfer.files);

        // Kick off all getAsFileSystemHandle() calls synchronously (before any await)
        // so the DataTransferItems remain valid.
        const handlePromises = [];
        if (e.dataTransfer.items) {
          for (const item of Array.from(e.dataTransfer.items)) {
            if (item.kind === 'file' && typeof item.getAsFileSystemHandle === 'function') {
              handlePromises.push(item.getAsFileSystemHandle().catch(() => null));
            } else {
              handlePromises.push(Promise.resolve(null));
            }
          }
        }

        // Resolve handles and request readwrite permission while user gesture is active
        const fileHandleMap = new Map();
        const handles = await Promise.all(handlePromises);
        for (let i = 0; i < handles.length && i < files.length; i++) {
          const handle = handles[i];
          if (handle && handle.kind === 'file') {
            try {
              await handle.requestPermission({ mode: 'readwrite' });
            } catch (_) { /* permission not granted — handle is still usable for read */ }
            fileHandleMap.set(files[i].name, handle);
          }
        }

        this.handleFiles(files, fileHandleMap);
      });

      // Click to browse — use showOpenFilePicker to capture FileSystemFileHandles
      const openFilePicker = async () => {
        if (typeof showOpenFilePicker === 'function') {
          try {
            const handles = await showOpenFilePicker({
              multiple: true,
              types: [{
                description: 'Spreadsheet files',
                accept: {
                  'text/csv': ['.csv'],
                  'text/tab-separated-values': ['.tsv'],
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
                  'application/vnd.ms-excel': ['.xls'],
                },
              }],
            });
            const fileHandleMap = new Map();
            const files = [];
            for (const handle of handles) {
              const file = await handle.getFile();
              try {
                await handle.requestPermission({ mode: 'readwrite' });
              } catch (_) { /* best effort */ }
              fileHandleMap.set(file.name, handle);
              files.push(file);
            }
            if (files.length > 0) this.handleFiles(files, fileHandleMap);
          } catch (err) {
            if (err.name !== 'AbortError') this._log('warn', 'File picker error:', err);
          }
        } else {
          this.fileInput.click();
        }
      };
      this.dropZone.addEventListener('click', openFilePicker);
      this.dropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openFilePicker();
        }
      });
      this.fileInput.addEventListener('change', () => {
        if (this.fileInput.files.length > 0) {
          this.handleFiles(this.fileInput.files);
          this.fileInput.value = '';
        }
      });

      // Prevent browser from opening dropped files
      document.addEventListener('dragover', (e) => e.preventDefault());
      document.addEventListener('drop', (e) => e.preventDefault());
    }

    setupEvents() {
      this.uploadBtn.addEventListener('click', () => this.handleUpload());
      this.clearBtn.addEventListener('click', () => this.clearFiles());

      // Theme toggle
      this.themeToggle.addEventListener('click', () => {
        const next = this.theme === 'dark' ? 'light' : 'dark';
        this._applyTheme(next);
        this.savePreferences();
      });

      // All-files view (inside the side panel)
      if (this.filesBtn) {
        this.filesBtn.addEventListener('click', () => this.toggleFilesView());
      }
      if (this.filesBackBtn) {
        this.filesBackBtn.addEventListener('click', () => this.closeFilesView());
      }
      if (this.filesRefreshBtn) {
        this.filesRefreshBtn.addEventListener('click', () => this.loadFilesList());
      }
      if (this.filesClearBtn) {
        this.filesClearBtn.addEventListener('click', () => this.clearDriveFiles());
      }
      if (this.filesSearch) {
        this.filesSearch.addEventListener('input', () => this.renderFilesList());
      }

      // Settings button toggles cleaning options
      this.settingsBtn.addEventListener('click', () => {
        const isOpen = !this.cleaningOptions.classList.contains('hidden');
        this.cleaningOptions.classList.toggle('hidden', isOpen);
        this.settingsBtn.classList.toggle('active', !isOpen);
        this.settingsBtn.setAttribute('aria-expanded', String(!isOpen));
        this.savePreferences();
      });

      // Refresh preview when user picks a different file
      this.previewSelect.addEventListener('change', () => {
        this.schedulePreviewRefresh();
      });

      // Refresh preview when open-mode changes (also toggles dropdown state)
      document.querySelectorAll('input[name="open-mode"]').forEach((radio) => {
        radio.addEventListener('change', () => {
          this._updateOpenModeCards();
          this.updateOpenModeState();
          this.schedulePreviewRefresh();
          this.savePreferences();
          this._updateSummaryCards();
          this._updatePrimaryAction();
        });
      });

      // Cards are <label> elements, so clicking activates the radio natively.
      // The radio 'change' handler above handles state, preview, and preferences.

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

      // Files captured from WhatsApp Web (relayed by the background worker)
      chrome.runtime.onMessage.addListener((message) => {
        if (message && message.type === 'wa:file') {
          void this.enqueueWhatsAppFile(message);
        }
      });

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
        this._log('info',
          'Drag to Sheets: SheetJS not loaded — .xlsx/.xls support disabled. CSV/TSV still work.'
        );
      }
    }

    // ---- URL Import ----

    async toggleUrlBar(forceOpen) {
      const isCurrentlyOpen = this.urlToggle.getAttribute('aria-expanded') === 'true';
      const open = forceOpen !== undefined ? forceOpen : !isCurrentlyOpen;

      this.urlBar.classList.toggle('hidden', !open);
      this.urlToggle.setAttribute('aria-expanded', String(open));
      if (open) {
        this.urlInput.focus();
      }
    }

    showUrlTooltip(message) {
      if (!this.urlHint) return;
      if (!this._urlHintOriginal) {
        this._urlHintOriginal = this.urlHint.textContent;
      }
      this.urlHint.textContent = message;
      this.urlHint.classList.add('url-hint--error');
      clearTimeout(this._urlTooltipTimer);
      this._urlTooltipTimer = setTimeout(() => {
        this.urlHint.textContent = this._urlHintOriginal;
        this.urlHint.classList.remove('url-hint--error');
      }, 2500);
    }

    async importFromUrl() {
      const raw = this.urlInput.value.trim();

      const parsed = this.parseDocsLink(raw);
      if (!parsed) {
        this.urlInput.classList.add('url-input--error');
        this.showUrlTooltip('Paste a Google Sheets link, e.g. https://docs.google.com/spreadsheets/d/…');
        return;
      }

      const refKey = `ref:${parsed.id}`;
      if (this.fileIdentityKeys.has(refKey)) {
        this.urlInput.classList.add('url-input--error');
        this.showUrlTooltip('This Google Sheet is already in your list');
        return;
      }

      this.urlFetchBtn.disabled = true;
      this.setStatus('Checking Google Sheet access…', 'loading');

      try {
        const entry = await this.addReferenceEntry(parsed.id, parsed.url);
        this.setStatus(`Added "${entry.name}" — linked to your Google Sheet`, 'success');
        this.urlInput.value = '';
        this.toggleUrlBar(false);
      } catch (err) {
        this.urlInput.classList.add('url-input--error');
        this.setStatus(this.referenceAccessErrorMessage(err), 'error');
      } finally {
        this.urlFetchBtn.disabled = false;
      }
    }

    /**
     * Validate access to a spreadsheet and add it to the app as a reference
     * (same instance — never a copy). Returns the new entry, or null when the
     * spreadsheet is already in the file list.
     */
    async addReferenceEntry(refId, refUrl) {
      const refKey = `ref:${refId}`;
      if (this.fileIdentityKeys.has(refKey)) return null;

      const info = await GoogleAPI.getSpreadsheetInfo(refId);
      const entry = this.createReferenceEntry(refId, refUrl, info);

      // Accurate used-range stats for the first sheet come from a values read;
      // remaining sheets use grid properties.
      try {
        const firstSheet = entry.sheetMetadata[0];
        if (firstSheet) {
          const values = await GoogleAPI.getSpreadsheetValues(
            entry.refId,
            this.escapeSheetNameForRange(firstSheet.name)
          );
          const rows = (values && values.values) || [];
          firstSheet.rowCount = rows.length;
          firstSheet.colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
          entry.stats = {
            sheetCount: 1,
            rowCount: rows.length,
            dataRowCount: Math.max(rows.length - 1, 0),
            colCount: firstSheet.colCount,
            cellCount: 0,
            styledCellCount: 0,
          };
        }
      } catch (_) {
        // Stats are best-effort; preview/merge will surface access errors.
      }

      this.fileIdentityKeys.add(refKey);
      this.files.push(entry);
      this.recordDocsLinkImport(entry);
      this.markFilesChanged();
      this.renderFileList();
      this.updateUI();
      this.saveFilesSession();
      return entry;
    }

    // ---- All-Files View ----

    async toggleFilesView() {
      if (!this.filesView) return;
      const isOpen = !this.filesView.classList.contains('hidden');
      if (isOpen) {
        this.closeFilesView();
        return;
      }
      this.filesView.classList.remove('hidden');
      if (this.appView) this.appView.classList.add('hidden');
      this.filesBtn.classList.add('active');
      await this.loadFilesList();
    }

    closeFilesView() {
      if (!this.filesView) return;
      this.filesView.classList.add('hidden');
      if (this.appView) this.appView.classList.remove('hidden');
      this.filesBtn.classList.remove('active');
      if (this.filesSearch) this.filesSearch.value = '';
      this.resetFilesClearButton();
    }

    formatFileDate(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      // Deterministic format ("Jul 1, 2026") — locale-dependent abbreviations
      // (e.g. "ago" for August in Spanish) are ambiguous for users.
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    }

    async loadFilesList() {
      const list = this.filesList;
      if (!list) return;
      this.resetFilesClearButton();
      list.innerHTML = '';
      if (this.filesRefreshBtn) this.filesRefreshBtn.disabled = true;
      this.filesStatus.textContent = 'Loading your files\u2026';
      this.filesStatus.classList.remove('files-status--error');

      try {
        const files = await GoogleAPI.listAppFiles();
        this._filesListData = files || [];

        if (this._filesListData.length === 0) {
          this.filesStatus.textContent =
            'No files yet. Upload a spreadsheet or import a Google Docs link to create one.';
          if (this.filesClearBtn) this.filesClearBtn.disabled = true;
          return;
        }

        this.renderFilesList();
      } catch (err) {
        this._filesListData = [];
        this.filesStatus.textContent = `Could not load your files: ${err.message}`;
        this.filesStatus.classList.add('files-status--error');
      } finally {
        if (this.filesRefreshBtn) this.filesRefreshBtn.disabled = false;
      }
    }

    /**
     * Render the files list, filtered by the current search query. The query
     * matches the filename case-insensitively.
     */
    renderFilesList() {
      const list = this.filesList;
      if (!list) return;
      list.innerHTML = '';

      const all = this._filesListData || [];
      const query = this.filesSearch ? this.filesSearch.value.trim().toLowerCase() : '';
      const files = query
        ? all.filter((file) => String(file.name || '').toLowerCase().includes(query))
        : all;

      if (all.length > 0 && files.length === 0) {
        this.filesStatus.textContent = 'No files match your search';
        if (this.filesClearBtn) this.filesClearBtn.disabled = true;
        return;
      }

      this.filesStatus.textContent = query && files.length < all.length
        ? `${files.length} of ${all.length} file(s)`
        : `${all.length} file(s) accessible to this app`;
      if (this.filesClearBtn) this.filesClearBtn.disabled = files.length === 0;

      for (const file of files) {
        const li = document.createElement('li');
        li.className = 'files-item';

        const a = document.createElement('a');
        a.className = 'files-item-link';
        a.href = file.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';

        const name = document.createElement('span');
        name.className = 'files-item-name';
        name.textContent = file.name;

        const date = document.createElement('span');
        date.className = 'files-item-date';
        date.textContent = this.formatFileDate(file.addedAt);

        a.appendChild(name);
        a.appendChild(date);

        const loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.className = 'btn-text files-load-btn';
        loadBtn.textContent = 'Load';
        loadBtn.title = `Add ${file.name} to the app`;
        loadBtn.setAttribute('aria-label', `Load ${file.name} in the app`);
        loadBtn.addEventListener('click', () => this.loadFileIntoApp(file));

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'file-action-btn remove-btn files-remove-btn';
        removeBtn.innerHTML = this.iconMarkup('x');
        removeBtn.title = `Remove ${file.name} from your files (moves it to the trash)`;
        removeBtn.setAttribute('aria-label', `Remove ${file.name}`);
        removeBtn.dataset.fileId = file.id;
        removeBtn.addEventListener('click', () => this.removeDriveFile(file));

        li.appendChild(a);
        li.appendChild(loadBtn);
        li.appendChild(removeBtn);
        list.appendChild(li);
      }
      this.renderIcons(list);
    }

    /**
     * Add a spreadsheet from the files view to the app as a reference, so it
     * can be previewed, merged, and merged into (same instance).
     */
    async loadFileIntoApp(file) {
      this.setStatus(`Loading "${file.name}" into the app…`, 'loading');
      try {
        const entry = await this.addReferenceEntry(file.id, file.url);
        if (entry) {
          this.setStatus(`Loaded "${entry.name}" into the app — it is now in your file list`, 'success');
        } else {
          this.setStatus(`"${file.name}" is already in your file list`, 'info');
        }
      } catch (err) {
        this.setStatus(this.referenceAccessErrorMessage(err), 'error');
      }
    }

    /**
     * Remove a spreadsheet from the files list by moving it to the trash.
     * Also drops any matching reference from the app's file list so it cannot
     * linger as a broken link.
     */
    async removeDriveFile(file) {
      try {
        await GoogleAPI.trashAppFile(file.id);
        this.removeReferenceFromApp(file.id);
        this.setStatus(`Removed "${file.name}" — it is now in your Google Drive trash`, 'success');
      } catch (err) {
        this.setStatus(`Could not remove "${file.name}": ${err.message}`, 'error');
        return;
      }
      await this.loadFilesList();
    }

    /**
     * Trash every file the app has access to, shown in the files list.
     * Two-step confirmation: the first click turns the button into "Confirm",
     * the second click performs the removal.
     */
    async clearDriveFiles() {
      const files = this._filesListData || [];
      if (files.length === 0) return;
      const count = files.length;

      if (!this._filesClearArmed) {
        this._filesClearArmed = true;
        this.filesClearBtn.textContent = 'Confirm';
        this.filesClearBtn.classList.add('files-clear-btn--armed');
        this.filesClearBtn.setAttribute('aria-label', 'Confirm removing all files');
        return;
      }

      this._filesClearArmed = false;
      this.setStatus(`Removing ${count} file(s)…`, 'loading');
      if (this.filesClearBtn) this.filesClearBtn.disabled = true;
      try {
        for (const file of files) {
          await GoogleAPI.trashAppFile(file.id);
          this.removeReferenceFromApp(file.id);
        }
        this.setStatus(`${count} file(s) removed — they are now in your Google Drive trash`, 'success');
      } catch (err) {
        this.setStatus(`Could not remove all files: ${err.message}`, 'error');
      }
      await this.loadFilesList();
    }

    /**
     * Reset the "Clear all" button to its unarmed state.
     */
    resetFilesClearButton() {
      this._filesClearArmed = false;
      if (this.filesClearBtn) {
        this.filesClearBtn.textContent = 'Clear all';
        this.filesClearBtn.classList.remove('files-clear-btn--armed');
        this.filesClearBtn.setAttribute('aria-label', 'Remove all files from your files (moves them to the trash)');
      }
    }

    removeReferenceFromApp(refId) {
      const index = this.files.findIndex(
        (item) => item.kind === 'reference' && item.refId === refId
      );
      if (index === -1) return;
      this.files.splice(index, 1);
      this.fileIdentityKeys.delete(`ref:${refId}`);
      this.markFilesChanged();
      this.renderFileList();
      this.updateUI();
      this.saveFilesSession();
    }

    /**
     * Remember the most recently imported Google Docs links (max 3, newest
     * first, deduplicated by spreadsheet). Persisted in chrome.storage.local
     * so the history survives browser and device restarts.
     */    recordDocsLinkImport(entry) {
      const next = [{
        url: entry.refUrl,
        name: entry.name,
      }];
      for (const item of this.docsLinkHistory || []) {
        if (item.url === entry.refUrl) continue;
        next.push(item);
      }
      this.docsLinkHistory = next.slice(0, 3);
      this.saveDocsLinkHistory();
      this.renderDocsLinkHistory();
    }

    saveDocsLinkHistory() {
      chrome.storage.local
        .set({ docsLinkHistory: this.docsLinkHistory })
        .catch((err) => this._log('warn', 'Drag to Sheets: docs link history save failed:', err.message));
    }

    renderDocsLinkHistory() {
      const list = this.docsLinkHistoryList;
      if (!list) return;
      list.innerHTML = '';
      const history = this.docsLinkHistory || [];
      if (this.docsLinkHistorySection) {
        this.docsLinkHistorySection.classList.toggle('hidden', history.length === 0);
      }
      for (const item of history) {
        const li = document.createElement('li');
        li.className = 'docs-link-history-item';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'docs-link-history-btn';
        btn.title = item.url;

        const name = document.createElement('span');
        name.className = 'docs-link-history-name';
        name.textContent = item.name || item.url;
        btn.appendChild(name);

        const host = document.createElement('span');
        host.className = 'docs-link-history-host';
        try {
          host.textContent = new URL(item.url).hostname;
        } catch (_) {
          host.textContent = '';
        }
        btn.appendChild(host);

        btn.addEventListener('click', () => {
          this.urlInput.value = item.url;
          void this.importFromUrl();
        });

        li.appendChild(btn);
        list.appendChild(li);
      }
    }

    /**
     * Parse a Google Docs/Drive link into a spreadsheet reference.
     * Returns { id, url } or null when the link is not a spreadsheet link.
     */
    parseDocsLink(raw) {
      let url;
      try {
        url = new URL(raw);
      } catch {
        return null;
      }
      if (url.protocol !== 'https:') return null;

      const host = url.hostname.toLowerCase();
      let id = null;

      if (host === 'docs.google.com' || host.endsWith('.docs.google.com')) {
        const m = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
        if (m) id = m[1];
      } else if (host === 'drive.google.com' || host.endsWith('.drive.google.com')) {
        const fileMatch = url.pathname.match(/^\/file\/d\/([^/]+)/);
        if (fileMatch) {
          id = fileMatch[1];
        } else {
          const queryId = url.searchParams.get('id');
          if (queryId) id = queryId;
        }
      }

      if (!id) return null;
      return {
        id,
        url: `https://docs.google.com/spreadsheets/d/${id}/edit`,
      };
    }

    /**
     * Build a file-list entry that references an existing Google Sheet.
     * The entry has no bytes: opening always opens the same spreadsheet
     * instance and merging writes back into it.
     */
    createReferenceEntry(refId, refUrl, info) {
      const sheets = Array.isArray(info?.sheets)
        ? info.sheets.map((s) => ({
          name: s.properties?.title || 'Sheet 1',
          rowCount: Number.isFinite(s.properties?.gridProperties?.rowCount)
            ? s.properties.gridProperties.rowCount
            : null,
          colCount: Number.isFinite(s.properties?.gridProperties?.columnCount)
            ? s.properties.gridProperties.columnCount
            : null,
        }))
        : [];

      return {
        kind: 'reference',
        refId,
        refUrl,
        name: info?.properties?.title || 'Google Sheet',
        ext: 'gsheet',
        size: 0,
        stats: null,
        summaryStats: null,
        sheetMetadata: sheets,
        selectedMergeSheetIndex: 0,
        refData: null,
        identityKey: `ref:${refId}`,
        contentFingerprint: null,
        lazy: true,
        file: null,
        parsed: null,
        fileHandle: null,
        handleId: null,
      };
    }

    /**
     * Human-readable explanation for reference access failures. The app holds
     * the per-file Google scope, so it can only reach sheets it created itself.
     */
    referenceAccessErrorMessage(err) {
      const detail = err?.message || '';
      if (/403|permission|insufficient/i.test(detail) || /404/.test(detail)) {
        return 'Drag to Sheets can only open Google Sheets it created itself (files uploaded through this extension). This file was not created by the app, so it cannot be previewed, merged, or edited.';
      }
      return `Cannot access this Google Sheet: ${detail}`;
    }

    escapeSheetNameForRange(name) {
      return "'" + String(name || 'Sheet1').replace(/'/g, "''") + "'";
    }

    colToLetter(i) {
      let s = '';
      let n = i + 1;
      while (n > 0) {
        n--;
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26);
      }
      return s;
    }

    /**
     * Fetch the full values of the selected worksheet of a referenced sheet
     * and cache them on the entry so merge/mapping can read synchronously.
     */
    async ensureReferenceData(item) {
      if (item?.kind !== 'reference') return;
      if (item.refData) return;

      const metadata = this.getMergeSheetMetadata(item);
      const selectedIndex = this.normalizeMergeSheetIndex(item, metadata.length);
      const sheetName = (metadata[selectedIndex] && metadata[selectedIndex].name) || 'Sheet1';

      let values;
      try {
        values = await GoogleAPI.getSpreadsheetValues(item.refId, this.escapeSheetNameForRange(sheetName));
      } catch (err) {
        throw new Error(this.referenceAccessErrorMessage(err));
      }

      const data = (values && values.values) || [];
      item.refData = { name: sheetName, data, cellMeta: null };
      item.stats = {
        sheetCount: 1,
        rowCount: data.length,
        dataRowCount: Math.max(data.length - 1, 0),
        colCount: data.reduce((max, r) => Math.max(max, r.length), 0),
        cellCount: 0,
        styledCellCount: 0,
      };
    }

    async ensureReferenceDataForFiles(items) {
      const pending = (items || []).filter((item) => item?.kind === 'reference' && !item.refData);
      if (pending.length === 0) return;
      await this.mapWithConcurrency(pending, 3, async (item) => {
        this.setStatus(`Reading ${item.name}…`, 'loading');
        await this.ensureReferenceData(item);
      });
      // Never leave the loading status behind once the reads have finished.
      this.setStatus(`${this.files.length} file(s) ready`, 'success');
    }

    /**
     * Preview a referenced spreadsheet by fetching only a bounded sample of
     * the selected worksheet (the app never downloads the whole file).
     */
    async ensureReferencePreview(item, { merge = false } = {}) {
      const cacheKey = this.getPreviewCacheKey(item, merge);
      const cachedPreview = this.getCachedPreview(item, cacheKey);
      if (cachedPreview) {
        this.restorePreviewSummary(item, cachedPreview);
        return cachedPreview;
      }

      const metadata = this.getMergeSheetMetadata(item);
      const selectedIndex = this.normalizeMergeSheetIndex(item, metadata.length);
      const sheet = metadata[selectedIndex] || { name: 'Sheet1', rowCount: null, colCount: null };
      const gridRows = Math.max(sheet.rowCount || PREVIEW_SAMPLE_ROWS, 1);
      const gridCols = Math.max(sheet.colCount || 20, 1);
      const rows = Math.min(PREVIEW_SAMPLE_ROWS, gridRows);
      const range = `${this.escapeSheetNameForRange(sheet.name)}!A1:${this.colToLetter(gridCols - 1)}${rows}`;

      let values;
      try {
        values = await GoogleAPI.getSpreadsheetValues(item.refId, range);
      } catch (err) {
        throw new Error(this.referenceAccessErrorMessage(err));
      }

      const data = ((values && values.values) || []).slice(0, PREVIEW_SAMPLE_ROWS);
      const preview = {
        sheets: [{
          name: sheet.name,
          data,
          cellMeta: null,
        }],
        previewMeta: {
          rowCount: gridRows,
          dataRowCount: Math.max(gridRows - 1, 0),
          colCount: gridCols,
          sheetCount: 1,
          sampled: data.length < gridRows,
          sampleRows: data.length,
          fileSize: 0,
          metadataTrusted: true,
        },
      };
      return this.cachePreview(item, cacheKey, preview);
    }

    // ---- Session Persistence ----

    /**
     * Serialize current state to chrome.storage.
     * Files go to storage.session (cleared on browser restart).
     * Preferences go to storage.local (persist across restarts).
     */
    saveFilesSession() {
      for (const item of this.files) {
        if (item?.parsed) {
          this.getSelectedMergeSheet(item);
        } else if (item) {
          item.selectedMergeSheetIndex = this.getStoredMergeSheetIndex(item);
        }
      }

      const serializedFiles = this.files.map((item) => ({
        kind: item.kind === 'reference' ? 'reference' : null,
        refId: item.refId || null,
        refUrl: item.refUrl || null,
        name: item.name,
        ext: item.ext,
        size: this.getFileSize(item),
        stats: item.stats || null,
        summaryStats: item.summaryStats || null,
        identityKey: item.identityKey || null,
        contentFingerprint: item.contentFingerprint || null,
        lazy: Boolean(item.lazy && !item.parsed),
        handleId: item.handleId || null,
        selectedMergeSheetIndex: this.getStoredMergeSheetIndex(item),
        sheetMetadata: item.sheetMetadata || null,
        sheets: item.parsed
          ? item.parsed.sheets.map(({ name, data, cellMeta }) => ({ name, data, cellMeta }))
          : null,
      }));
      const indexedDbFiles = this.files.map((item) => ({
        kind: item.kind === 'reference' ? 'reference' : null,
        refId: item.refId || null,
        refUrl: item.refUrl || null,
        name: item.name,
        ext: item.ext,
        size: this.getFileSize(item),
        stats: item.stats || null,
        summaryStats: item.summaryStats || null,
        identityKey: item.identityKey || null,
        contentFingerprint: item.contentFingerprint || null,
        lazy: Boolean(item.lazy && !item.parsed),
        handleId: item.handleId || null,
        selectedMergeSheetIndex: this.getStoredMergeSheetIndex(item),
        sheetMetadata: item.sheetMetadata || null,
        file: item.file || null,
        parsed: item.parsed
          ? {
            sheets: item.parsed.sheets.map(({ name, data, styles, cellMeta }) => ({ name, data, styles: styles || null, cellMeta: cellMeta || null })),
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
          .catch((err) => this._log('warn', 'Drag to Sheets: session save failed:', err.message));
        return;
      }

      chrome.storage.session
        .set({ files: serializedFiles, sessionSummary: null })
        .catch(async (err) => {
          this._log('warn', 'Drag to Sheets: session save failed:', err.message);
          if (this.canUseIndexedDb()) {
            try {
              await this.saveFilesToIndexedDb(indexedDbFiles);
            } catch (_) { /* best effort */ }
          }
        });

      void this.clearFilesFromIndexedDb().catch(() => {});
    }

    savePreferences() {
      const prefs = {
        theme: this.theme,
        openMode: this.getOpenMode(),
        cleaningOptions: this.getCleaningOptions(),
        settingsOpen: !this.cleaningOptions.classList.contains('hidden'),
        smartMapping: this.smartMappingCheckbox.checked,
        customMappings: this.customMappings,
      };

      chrome.storage.local
        .set({ prefs })
        .catch((err) => this._log('warn', 'Drag to Sheets: prefs save failed:', err.message));
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
      this._prunedDuringRestore = [];
      try {
        const [{ files: storedFiles, sessionSummary }, { prefs, docsLinkHistory }] = await Promise.all([
          chrome.storage.session.get(['files', 'sessionSummary']),
          chrome.storage.local.get(['prefs', 'docsLinkHistory']),
        ]);
        this.sessionSummary = sessionSummary || null;
        this.docsLinkHistory = Array.isArray(docsLinkHistory)
          ? docsLinkHistory.slice(0, 3)
          : [];

        let restoredFiles = storedFiles;
        if ((!Array.isArray(restoredFiles) || restoredFiles.length === 0) && sessionSummary?.persisted === 'indexeddb') {
          const indexedDbSession = await this.loadFilesFromIndexedDb().catch(() => null);
          restoredFiles = indexedDbSession?.files || [];
        }

        // Restore files
        if (Array.isArray(restoredFiles) && restoredFiles.length > 0) {
          const mapped = restoredFiles.map((item) => ({
            kind: item.kind === 'reference' ? 'reference' : null,
            refId: item.refId || null,
            refUrl: item.refUrl || null,
            file: item.file || null,
            parsed: item.parsed || (Array.isArray(item.sheets) ? { sheets: item.sheets } : null),
            name: item.name,
            ext: item.ext,
            size: item.size || 0,
            stats: item.stats || null,
            summaryStats: item.summaryStats || null,
            identityKey: item.identityKey || `${item.name}::${item.ext}::${item.size || 0}::0`,
            contentFingerprint: item.contentFingerprint || null,
            lazy: Boolean(item.lazy && !item.sheets),
            handleId: item.handleId || null,
            selectedMergeSheetIndex: this.getStoredMergeSheetIndex(item),
            sheetMetadata: Array.isArray(item.sheetMetadata) ? item.sheetMetadata : null,
            fileHandle: null,
          }));

          const validEntries = [];
          const prunedNames = [];

          for (const entry of mapped) {
            if (entry.kind === 'reference') {
              if (entry.refId && entry.refUrl) {
                validEntries.push(entry);
                continue;
              }
              prunedNames.push(entry.name);
              continue;
            }

            if (entry.parsed) {
              this.getSelectedMergeSheet(entry);
              const ext = entry.ext || '';
              if (ext === 'xlsx' || ext === 'xls') {
                if (Parser.hasTypedCellMetadata(entry.parsed)) {
                  validEntries.push(entry);
                  continue;
                }

                if (entry.file && entry.file.name) {
                  try {
                    entry.parsed = null;
                    entry.stats = null;
                    entry.lazy = true;
                    validEntries.push(entry);
                    continue;
                  } catch (_) { /* fall through */ }
                }

                if (entry.handleId && typeof FileHandleStore !== 'undefined') {
                  try {
                    const handle = await FileHandleStore.getHandle(entry.handleId);
                    if (handle && typeof handle.getFile === 'function') {
                      const file = await handle.getFile();
                      if (file && file.name) {
                        entry.file = file;
                        entry.fileHandle = handle;
                        entry.parsed = null;
                        entry.stats = null;
                        entry.lazy = true;
                        validEntries.push(entry);
                        continue;
                      }
                    }
                  } catch (_) { /* handle recovery not possible */ }
                }

                prunedNames.push(entry.name);
                continue;
              }

              validEntries.push(entry);
              continue;
            }

            if (entry.file && entry.file.name) {
              validEntries.push(entry);
              continue;
            }

            if (entry.handleId && typeof FileHandleStore !== 'undefined') {
              try {
                const handle = await FileHandleStore.getHandle(entry.handleId);
                if (handle && typeof handle.getFile === 'function') {
                  const file = await handle.getFile();
                  if (file && file.name) {
                    entry.file = file;
                    entry.fileHandle = handle;
                    validEntries.push(entry);
                    continue;
                  }
                }
              } catch (_) { /* handle recovery not possible */ }
            }

            prunedNames.push(entry.name);
          }

          this.files = validEntries;
          this._prunedDuringRestore = prunedNames;
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
          this._updateOpenModeCards();

          // Cleaning options
          const optMap = {
            trim: 'opt-trim',
            removeEmptyRows: 'opt-empty-rows',
            removeEmptyColumns: 'opt-empty-cols',
            removeDuplicates: 'opt-duplicates',
            fixNumbers: 'opt-numbers',
            normalizeDates: 'opt-dates',
            normalizeHeaders: 'opt-headers',
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

          // Theme (stored pref overrides system default set by initTheme)
          if (prefs.theme) {
            this._applyTheme(prefs.theme);
          }

          // Settings panel open state
          if (prefs.settingsOpen) {
            this.cleaningOptions.classList.remove('hidden');
            this.settingsBtn.classList.add('active');
            this.settingsBtn.setAttribute('aria-expanded', 'true');
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
        this._log('warn', 'Drag to Sheets: session restore failed:', err.message);
      }

      this.renderFileList();
      this.updateUI();
      this.renderDocsLinkHistory();

      const pruned = this._prunedDuringRestore || [];
      if (this.files.length > 0) {
        if (pruned.length > 0) {
          this.setStatus(
            `${this.files.length} file(s) restored. Re-add to continue: ${pruned.map((n) => `"${n}"`).join(', ')}`,
            'info'
          );
        } else {
          this.setStatus(`Restored ${this.files.length} file(s) from last session`, 'info');
        }
      } else if (pruned.length > 0) {
        this.setStatus(
          `Re-add to continue: ${pruned.map((n) => `"${n}"`).join(', ')}`,
          'info'
        );
      } else if (this.sessionSummary && this.sessionSummary.persisted === false) {
        this.setStatus(
          `Large batch (${this.sessionSummary.fileCount} file(s), ${this.formatBytes(this.sessionSummary.totalBytes)}) was not restored to keep memory usage stable`,
          'info'
        );
      }
    }

    // ---- File Handling ----

    async handleFiles(fileList, fileHandleMap, { forceEager = false } = {}) {
      const parseStart = this.now();
      const dropped = Array.from(fileList);
      const options = this.getCleaningOptions();
      const handleMap = fileHandleMap || new Map();
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

        acceptedFiles.push({ file, ext, fileHandle: handleMap.get(file.name) || null });
      }

      if (acceptedFiles.length === 0) {
        this.renderFileList();
        this.updateUI();
        return;
      }

      const incomingHints = this.getIncomingWorkloadHints(acceptedFiles, options);
      const useLazySeparate = !forceEager && this.shouldLazyLoadSeparateFiles(incomingHints);

      if (useLazySeparate) {
        let added = 0;
        let skippedDuplicates = 0;

        for (const { file, ext, fileHandle } of acceptedFiles) {
          const identityKey = this.computeFileIdentity(file, ext);
          if (this.fileIdentityKeys.has(identityKey)) {
            skippedDuplicates++;
            continue;
          }

          const entry = this.createLazyFileEntry(file, ext, fileHandle);
          await this.storeFileHandle(entry);
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
        } else if (skippedDuplicates > 0) {
          this.setStatus('File already loaded', 'info');
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
        const entry = this.createParsedFileEntry(result.file, result.ext, result.parsed, handleMap.get(result.file.name));
        await this.storeFileHandle(entry);
        this.files.push(entry);
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
      } else if (skippedDuplicates > 0) {
        this.setStatus('File already loaded', 'info');
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
          this.getSelectedMergeSheet(item);
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
      void this.updateCustomMappingVisibility();
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
      void this.updateCustomMappingVisibility();
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

    handleMergeSheetSelection(fileIndex, value) {
      if (this.uploading) return;
      const item = this.files[fileIndex];
      if (!item || this.getOpenMode() !== 'merge') return;

      const metadata = this.getMergeSheetMetadata(item);
      if (!Array.isArray(metadata) || metadata.length <= 1) return;

      const nextIndex = this.normalizeMergeSheetIndex(
        item,
        metadata.length
      );
      const requestedIndex = Number(value);
      const selectedIndex = Number.isFinite(requestedIndex)
        ? Math.trunc(requestedIndex)
        : nextIndex;
      const clampedIndex = Math.max(0, Math.min(selectedIndex, metadata.length - 1));
      if (clampedIndex === item.selectedMergeSheetIndex) return;

      item.selectedMergeSheetIndex = clampedIndex;
      this.invalidatePreviewCache(item, 'merge');
      item.refData = null;
      item.summaryStats = null;
      this.markFilesChanged();
      this.hidePreview();
      void this.updateCustomMappingVisibility();
      this.schedulePreviewRefresh();
      this._updateSummaryCards();
      this.saveFilesSession();
    }

    renderFileList() {
      this.fileList.innerHTML = '';
      const isMergeMode = this.getOpenMode() === 'merge';

      this.files.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'file-item';

        const stats = item.stats || (item.parsed ? this.getEntryStats(item) : null);
        const rows = stats?.rowCount || 0;
        const cols = stats?.colCount || 0;
        const sheetCount = stats?.sheetCount || item.parsed?.sheets?.length || 0;
        const metaText = item.kind === 'reference'
          ? `Linked Google Sheet${rows ? ` &middot; ${rows} rows &times; ${cols} cols` : ''}`
          : item.parsed
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
            <span class="file-name">${isMaster ? '<span class="master-badge">Master</span> ' : ''}${this.escapeHtml(item.name)}</span>
            <span class="file-meta">${metaText}</span>
          </div>
        `;

        const supportsWorksheetSelection =
          item.ext === 'xlsx' || item.ext === 'xls' || item.kind === 'reference';
        const sheetMetadata = isMergeMode && supportsWorksheetSelection
          ? this.getMergeSheetMetadata(item)
          : null;
        if (Array.isArray(sheetMetadata) && sheetMetadata.length > 1) {
          const sheetSelect = document.createElement('select');
          sheetSelect.className = 'merge-sheet-select';
          sheetSelect.id = `merge-sheet-select-${index}`;
          sheetSelect.setAttribute('aria-label', `Worksheet for ${item.name}`);
          sheetSelect.disabled = this.uploading || this.mergeSheetMetadataLoading;

          const selectedIndex = this.normalizeMergeSheetIndex(item, sheetMetadata.length);
          sheetMetadata.forEach((sheet, sheetIndex) => {
            const option = document.createElement('option');
            option.value = sheetIndex;
            const rowCount = Number.isFinite(sheet.rowCount) ? `${sheet.rowCount} rows` : null;
            const colCount = Number.isFinite(sheet.colCount) ? `${sheet.colCount} cols` : null;
            const dimensions = [rowCount, colCount].filter(Boolean).join(' × ');
            option.textContent = `${sheet.name || `Worksheet ${sheetIndex + 1}`}${dimensions ? ` (${dimensions})` : ''}`;
            sheetSelect.appendChild(option);
          });
          sheetSelect.value = String(selectedIndex);
          sheetSelect.addEventListener('change', () => {
            this.handleMergeSheetSelection(index, sheetSelect.value);
          });
          info.querySelector('.file-details').appendChild(sheetSelect);
        }

        const actions = document.createElement('div');
        actions.className = 'file-actions';

        const openBtn = document.createElement('button');
        openBtn.className = 'file-action-btn open-file-btn';
        openBtn.innerHTML = this.iconMarkup('square-arrow-out-up-right');
        openBtn.title = item.kind === 'reference'
          ? 'Open this Google Sheet (same instance)'
          : 'Open this file in Sheets';
        openBtn.setAttribute(
          'aria-label',
          item.kind === 'reference'
            ? `Open ${item.name} in Google Sheets (same instance)`
            : `Open ${item.name} in Sheets`
        );
        openBtn.disabled = this.uploading;
        openBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.uploadSingleFromList(index);
        });
        actions.appendChild(openBtn);

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
      this.clearBtn.disabled = !hasFiles;
      this._updatePrimaryAction();
      this.populatePreviewSelect();
      this.updateOpenModeState();
      if (hasFiles) {
        this.schedulePreviewRefresh();
      } else {
        this.hidePreview();
      }
      this._updateSummaryCards();
    }

    /** Compute the primary action label based on file count and open mode. */
    _getButtonLabel() {
      const count = this.files.length;
      if (count === 0) return 'Open in Sheets';
      if (count === 1) return 'Open in Sheets';
      if (this.getOpenMode() === 'merge') return 'Merge and open in Sheets';
      return 'Open files in Sheets';
    }

    /** Set the button's visible text and aria-label, preserving the icon. */
    _setButtonLabel(text) {
      if (!this.uploadBtn) return;
      const icon = this.uploadBtn.querySelector('.app-icon');
      if (icon) {
        this.uploadBtn.textContent = '';
        this.uploadBtn.appendChild(icon);
        this.uploadBtn.appendChild(document.createTextNode(' ' + text));
      } else {
        this.uploadBtn.textContent = text;
      }
      this.uploadBtn.setAttribute('aria-label', text);
    }

    /** Centralised primary-action update: derives label + disabled from current state. */
    _updatePrimaryAction() {
      if (!this.uploadBtn) return;
      const inProgress = this.uploading;
      let label;
      if (inProgress) {
        label = this.primaryActionOperation === 'merge' ? 'Merging\u2026' : 'Opening\u2026';
      } else {
        label = this._getButtonLabel();
      }
      this.uploadBtn.disabled = inProgress || this.files.length === 0;
      this._setButtonLabel(label);
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

    /** Update open-mode card selection visuals. */
    _updateOpenModeCards() {
      const mode = this.getOpenMode();
      const separateCard = document.getElementById('open-mode-separate-card');
      const mergeCard = document.getElementById('open-mode-merge-card');
      if (separateCard) {
        separateCard.classList.toggle('open-mode-card--selected', mode === 'separate');
      }
      if (mergeCard) {
        mergeCard.classList.toggle('open-mode-card--selected', mode === 'merge');
      }
    }

    /** Update the dataset-summary cards. */
    _updateSummaryCards() {
      const el = document.getElementById('dataset-summary');
      if (!el) return;

      const count = this.files.length;
      if (count === 0) {
        el.classList.add('hidden');
        return;
      }
      el.classList.remove('hidden');

      document.getElementById('summary-files').textContent = count;

      let totalRows = 0;
      let maxCols = 0;
      let hasAllStats = true;
      const isMergeMode = this.getOpenMode() === 'merge';

      for (const file of this.files) {
        const selectedSummary = isMergeMode ? this.getSelectedMergeSheetStats(file) : null;
        const summary = isMergeMode
          ? (selectedSummary || (file.summaryStats?.sheetCount === 1 ? file.summaryStats : null))
          : (file.stats || (file.parsed ? this.getEntryStats(file) : null) || file.summaryStats);
        if (!summary) {
          hasAllStats = false;
          continue;
        }
        // dataRowCount from full-parse stats or preview summary;
        // derive from parsed sheets for legacy stored stats without dataRowCount
        let dataRows = summary.dataRowCount;
        if (dataRows === undefined && file.parsed?.sheets) {
          dataRows = 0;
          for (const sheet of file.parsed.sheets) {
            dataRows += Math.max((sheet.data?.length || 0) - 1, 0);
          }
          summary.dataRowCount = dataRows;
        }
        if (!Number.isFinite(dataRows) || !Number.isFinite(summary.colCount)) {
          hasAllStats = false;
          continue;
        }
        totalRows += dataRows;
        maxCols = Math.max(maxCols, summary.colCount);
      }

      document.getElementById('summary-rows').textContent = hasAllStats ? totalRows.toLocaleString() : '\u2014';
      document.getElementById('summary-cols').textContent = hasAllStats ? maxCols.toLocaleString() : '\u2014';
    }

    /** Enable/disable and populate the dropdown based on open mode. */
    updateOpenModeState() {
      const isMerge = this.getOpenMode() === 'merge';
      const nextPreviewMode = isMerge ? 'merge' : 'separate';
      const changedFromMergeToSeparate = this.previewMode === 'merge' && !isMerge;
      this.previewMode = nextPreviewMode;
      this.previewSelect.disabled = isMerge || this.files.length === 0;
      this.smartMappingOption.classList.toggle('hidden', !isMerge);
      if (!isMerge) {
        if (changedFromMergeToSeparate) {
          for (const item of this.files) delete item.summaryStats;
          this._updateSummaryCards();
        }
        this.mappingReview.classList.add('hidden');
        this.customMappingOption.classList.add('hidden');
        this.customMappingList.innerHTML = '';
      }
      this.renderFileList();
      if (isMerge) {
        void this.hydrateMergeSheetMetadata();
      } else {
        void this.updateCustomMappingVisibility();
      }
      this._updateOpenModeCards();
    }

    fileIcon(ext) {
      return {
        csv: 'file-chart-column',
        tsv: 'file-chart-column',
        xlsx: 'file-spreadsheet',
        xls: 'file-spreadsheet',
        gsheet: 'file-spreadsheet',
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
        normalizeDates: document.getElementById('opt-dates').checked,
        normalizeHeaders: document.getElementById('opt-headers').checked,
        preserveFormatting: true,
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
          const result = await this.getCleanedSheetData(fileIndex, sheetIndex, options);
          const cleanedData = Array.isArray(result) ? result : result.data;
          const cleanedMeta = Array.isArray(result) ? null : result.cellMeta;
          sheets.push({
            name: sheet.name,
            data: cleanedData,
            cellMeta: cleanedMeta,
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
          const preview = await this.ensurePreviewSample(item, { merge: true });
          rawForDetection.push({
            sheets: [{
              name: preview.sheets[0]?.name || item.name,
              data: preview.sheets[0]?.data || [],
            }],
          });
          continue;
        }

        const sheet = this.getSelectedMergeSheet(item);
        rawForDetection.push({
          sheets: sheet ? [{ name: sheet.name, data: sheet.data }] : [],
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
      this.previewTable.innerHTML = `<div class="preview-notice">${this.escapeHtml(message)}</div>`;
      this.clearCleanupResults();
      this.previewPanel.classList.remove('hidden');
    }

    hasPreviewData(data) {
      return Array.isArray(data) && data.length > 0;
    }

    clearCleanupResults() {
      this.cleanupResults.classList.add('hidden');
      this.cleanupResultsEmpty.classList.add('hidden');
      this.cleanupResultsList.innerHTML = '';
    }

    renderNoDataPreview(detail = '') {
      this.renderPreviewNotice('No data found in the imported file(s).', detail);
    }

    /** Auto-called whenever files, mode, or options change. */
    async refreshPreview() {
      const previewStart = this.now();
      const previewTaskId = this.beginPreviewTask();
      this.clearCleanupResults();
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
            if (sheet && this.hasPreviewData(sheet.data)) {
              const mergeTypeCtx = {
                cellMeta: sheet.cellMeta || null,
                sourceSampled: true,
              };
              this.renderPreviewTable(sheet.data, `Merged (${this.files.length} files)`, samplePreview.summary, samplePreview.notices, samplePreview.cleaningStats, mergeTypeCtx);
              this.previewPanel.classList.remove('hidden');
              this.logTiming('refresh preview sample', previewStart, {
                mode,
                files: this.files.length,
                rows: samplePreview.summary.totalRows,
                cols: samplePreview.summary.totalCols,
              });
            } else {
              this.renderNoDataPreview();
              this.logTiming('refresh preview sample', previewStart, {
                mode,
                files: this.files.length,
                rows: 0,
                cols: 0,
                visible: true,
              });
            }
          } catch (error) {
            if (!this.isPreviewTaskCurrent(previewTaskId)) return;
            this.renderPreviewNotice(error.message);
            this.logTiming('refresh preview failed', previewStart, { error: error.message, mode });
          }
          return;
        }

        try {
          await this.ensureEntriesParsed(
            this.files.filter((item) => item?.kind !== 'reference'),
            { preserveFormatting: true },
            'merge preview'
          );
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
        if (sheet && this.hasPreviewData(sheet.data)) {
          const rawMergeStats = merged.cleanStats || null;
          const hasCleaning = options.trim || options.removeEmptyRows || options.removeEmptyColumns ||
            options.removeDuplicates || options.fixNumbers || options.normalizeDates || options.normalizeHeaders;
          const mergeStats = hasCleaning && rawMergeStats ? {
            stats: rawMergeStats,
            scope: 'exact',
            evaluatedOperations: {
              trim: options.trim,
              removeEmptyRows: options.removeEmptyRows,
              removeEmptyColumns: options.removeEmptyColumns,
              removeDuplicates: options.removeDuplicates,
              fixNumbers: options.fixNumbers,
              normalizeDates: options.normalizeDates,
              normalizeHeaders: options.normalizeHeaders,
            },
          } : null;
          const exactMergeTypeCtx = {
            cellMeta: sheet.cellMeta || null,
            sourceSampled: false,
          };
          this.renderPreviewTable(sheet.data, `Merged (${this.files.length} files)`, {}, [], mergeStats, exactMergeTypeCtx);
          this.previewPanel.classList.remove('hidden');
          this.logTiming('refresh preview', previewStart, {
            mode,
            files: this.files.length,
            rows: sheet.data.length,
            cols: sheet.data[0]?.length || 0,
            visible: true,
          });
        } else {
          this.renderNoDataPreview();
          this.logTiming('refresh preview', previewStart, {
            mode,
            files: this.files.length,
            rows: 0,
            cols: 0,
            visible: true,
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
        // Google Sheets references have no local File object. They must use
        // the bounded remote preview path even for a small separate-mode
        // workload; sending them through ensureParsedEntry() produces the
        // misleading "Re-add ..." message.
        if (useSamplePreview || item.kind === 'reference') {
          try {
            const samplePreview = await this.getResponsiveSeparatePreview(item);
            if (!this.isPreviewTaskCurrent(previewTaskId)) return;
            if (this.hasPreviewData(samplePreview.data)) {
              const sepTypeCtx = {
                cellMeta: samplePreview.cellMeta || null,
                sourceSampled: Boolean(samplePreview.summary.sampled),
              };
              this.renderPreviewTable(samplePreview.data, item.name, samplePreview.summary, samplePreview.notices, samplePreview.cleaningStats, sepTypeCtx);
              this.previewPanel.classList.remove('hidden');
            } else {
              this.renderNoDataPreview();
            }
            this.logTiming('refresh preview sample', previewStart, {
              mode,
              file: item.name,
              rows: this.hasPreviewData(samplePreview.data) ? samplePreview.summary.totalRows : 0,
              cols: this.hasPreviewData(samplePreview.data) ? samplePreview.summary.totalCols : 0,
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
          await this.ensureParsedEntry(item, { preserveFormatting: true }, 'preview');
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
        const cleanedResult = await this.getCleanedSheetData(isNaN(idx) ? 0 : idx, 0, options);
        const cleaned = Array.isArray(cleanedResult) ? cleanedResult : cleanedResult.data;
        const cleanedMeta = Array.isArray(cleanedResult) ? null : (cleanedResult.cellMeta || null);
        const rawStats = Array.isArray(cleanedResult) ? null : (cleanedResult.stats || null);
        const hasCleaning = options.trim || options.removeEmptyRows || options.removeEmptyColumns ||
          options.removeDuplicates || options.fixNumbers || options.normalizeDates || options.normalizeHeaders;
        const cleanedStats = hasCleaning && rawStats ? {
          stats: rawStats,
          scope: 'exact',
          evaluatedOperations: {
            trim: options.trim,
            removeEmptyRows: options.removeEmptyRows,
            removeEmptyColumns: options.removeEmptyColumns,
            removeDuplicates: options.removeDuplicates,
            fixNumbers: options.fixNumbers,
            normalizeDates: options.normalizeDates,
            normalizeHeaders: options.normalizeHeaders,
          },
        } : null;
        if (!this.isPreviewTaskCurrent(previewTaskId)) return;
        if (this.hasPreviewData(cleaned)) {
          const exactSepTypeCtx = {
            cellMeta: cleanedMeta || (item.parsed?.sheets?.[0]?.cellMeta || null),
            sourceSampled: false,
          };
          this.renderPreviewTable(cleaned, item.name, {}, [], cleanedStats, exactSepTypeCtx);
          this.previewPanel.classList.remove('hidden');
        } else {
          this.renderNoDataPreview();
        }
        this.logTiming('refresh preview', previewStart, {
          mode,
          file: item.name,
          rows: this.hasPreviewData(cleaned) ? cleaned.length : 0,
          cols: this.hasPreviewData(cleaned) ? (cleaned[0]?.length || 0) : 0,
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
      await this.ensureReferenceDataForFiles(this.files);
      const rawFiles = [];
      const fileNames = this.files.map((item) => item.name);

      for (const item of this.files) {
        if (item.parsed) {
          const sheet = this.getSelectedMergeSheet(item);
          rawFiles.push({
            sheets: [{
              name: sheet?.name || item.name,
              data: sheet?.data || [],
            }],
          });
          continue;
        }

        const preview = await this.ensurePreviewSample(item, { merge: true });
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

        this.syncCustomMappingsWithContext(context);
        this.customMappingOption.classList.toggle('hidden', !context.hasCandidateHeaders);
        this.customMappingAddBtn.disabled = !context.hasCandidateHeaders;

        if (context.hasCandidateHeaders) {
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

        const { field: fromField, select: fromSelect } = this.buildMappingField(
          'Source',
          this.buildGroupedHeaderSelect(resolvedContext.nonMasterGroups, mapping.from)
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
        const { field: toField, select: toSelect } = this.buildMappingField(
          'Master',
          this.buildMasterHeaderSelect(resolvedContext.masterGroup, mapping.to, allowedTargets)
        );
        toSelect.addEventListener('change', () => {
          const current = this.customMappings[index];
          if (current && !current.from) current.from = fromSelect.value;
          this.updateCustomMapping(index, 'to', toSelect.value);
        });

        const removeBtn = document.createElement('button');
        removeBtn.className = 'file-action-btn remove-btn';
        removeBtn.innerHTML = this.iconMarkup('x');
        removeBtn.title = 'Remove mapping';
        removeBtn.setAttribute('aria-label', 'Remove mapping');
        removeBtn.addEventListener('click', () => this.removeCustomMapping(index));

        row.appendChild(fromField);
        row.appendChild(arrow);
        row.appendChild(toField);
        row.appendChild(removeBtn);
        this.customMappingList.appendChild(row);
      });

      this.renderIcons(this.customMappingList);
    }

    buildMappingField(labelText, select) {
      const field = document.createElement('label');
      field.className = 'custom-mapping-field';
      const label = document.createElement('span');
      label.className = 'custom-mapping-label';
      label.textContent = labelText;
      field.appendChild(label);
      field.appendChild(select);
      return { field, select };
    }

    buildGroupedHeaderSelect(groups, selectedValue) {
      const select = document.createElement('select');
      select.className = 'custom-mapping-select';

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

    buildMasterHeaderSelect(masterGroup, selectedValue, allowedHeaders) {
      const select = document.createElement('select');
      select.className = 'custom-mapping-select';

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

    renderPreviewTable(data, label = '', summary = {}, notices = [], cleaningStats = null, typeContext = {}) {
      if (!this.hasPreviewData(data)) {
        this.renderNoDataPreview();
        return;
      }

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

      // Non-destructive column type detection — run against full data, not the display slice
      let colTypes = [];
      if (typeof TypeDetector !== 'undefined' && data.length > 1) {
        colTypes = TypeDetector.detect(data, {
          maxCols: colCount,
          sampleMax: 1000,
          cellMeta: typeContext.cellMeta || null,
          sourceSampled: Boolean(typeContext.sourceSampled),
          parseDateToken: typeof Cleaner !== 'undefined' ? Cleaner.parseDateToken : null,
        });
      }

      let html = '';
      if (notices && notices.length > 0) {
        html += '<div class="preview-notice">' + notices.map(n => this.escapeHtml(n)).join('<br>') + '</div>';
      }
      html += '<table>';

      // Column-letter header row: corner cell + A B C … + optional truncation
      if (display.length > 0) {
        html += '<thead>';
        html += '<tr class="col-label-row">';
        html += '<th class="gutter-corner"></th>'; // top-left corner
        for (let j = 0; j < colCount; j++) {
          html += `<th class="col-label" scope="col">${colLabel(j)}</th>`;
        }
        if (truncatedCols) html += '<th class="col-label">…</th>';
        html += '</tr>';

        // Type profiling row with accessible semantics
        if (colTypes.length > 0) {
          html += '<tr class="col-type-row">';
          html += '<td class="col-type-gutter" aria-hidden="true"></td>';
          for (let j = 0; j < colCount && j < colTypes.length; j++) {
            const ct = colTypes[j];
            const label = TypeDetector.labelFor(ct.type);
            const title = TypeDetector.titleFor(ct.type, ct.sampled, ct.note || null);
            const accessible = 'Detected type: ' + TypeDetector.descriptionFor(ct.type, ct.sampled);
            html += '<th scope="col" class="col-type-indicator" title="' + this.escapeHtml(title) + '">';
            html += '<span aria-hidden="true">' + this.escapeHtml(label) + '</span>';
            html += '<span class="sr-only">' + this.escapeHtml(accessible) + '</span>';
            html += '</th>';
          }
          if (truncatedCols) html += '<td class="col-type-indicator"></td>';
          html += '</tr>';
        }

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
      this.renderCleanupSummary(cleaningStats);
    }

    renderCleanupSummary(cleaningStats) {
      if (!cleaningStats) {
        this.cleanupResults.classList.add('hidden');
        return;
      }

      const { stats, scope, evaluatedOperations } = cleaningStats;
      const evaluated = evaluatedOperations || {};
      const hasEvaluatedOperation = Object.values(evaluated).some(Boolean);

      if (!hasEvaluatedOperation) {
        this.clearCleanupResults();
        return;
      }

      const isSample = scope === 'sample';
      const title = isSample ? 'Changes in preview sample' : 'Cleanup applied';
      const emptyMsg = isSample ? 'No changes detected in preview sample' : 'No cleanup changes detected';

      document.getElementById('cleanup-results-title').textContent = title;
      this.cleanupResultsEmpty.textContent = emptyMsg;

      const items = [];
      if (evaluated.removeEmptyRows && stats.emptyRowsRemoved > 0) {
        items.push({ count: stats.emptyRowsRemoved, label: `empty ${stats.emptyRowsRemoved === 1 ? 'row' : 'rows'} removed` });
      }
      if (evaluated.removeEmptyColumns && stats.emptyColumnsRemoved > 0) {
        items.push({ count: stats.emptyColumnsRemoved, label: `empty ${stats.emptyColumnsRemoved === 1 ? 'column' : 'columns'} removed` });
      }
      if (evaluated.removeDuplicates && stats.duplicateRowsRemoved > 0) {
        items.push({ count: stats.duplicateRowsRemoved, label: `duplicate ${stats.duplicateRowsRemoved === 1 ? 'row' : 'rows'} removed` });
      }
      if (evaluated.trim && stats.trimmedValues > 0) {
        items.push({ count: stats.trimmedValues, label: `${stats.trimmedValues === 1 ? 'value' : 'values'} trimmed` });
      }
      if (evaluated.fixNumbers && stats.numericValuesCorrected > 0) {
        items.push({ count: stats.numericValuesCorrected, label: `numeric ${stats.numericValuesCorrected === 1 ? 'value' : 'values'} corrected` });
      }
      if (evaluated.normalizeDates && stats.datesNormalized > 0) {
        items.push({ count: stats.datesNormalized, label: `${stats.datesNormalized === 1 ? 'date' : 'dates'} normalized` });
      }
      if (evaluated.normalizeHeaders && stats.headersNormalized > 0) {
        items.push({ count: stats.headersNormalized, label: `${stats.headersNormalized === 1 ? 'header' : 'headers'} normalized` });
      }

      if (items.length === 0) {
        this.cleanupResultsList.innerHTML = '';
        this.cleanupResultsEmpty.classList.remove('hidden');
      } else {
        this.cleanupResultsEmpty.classList.add('hidden');
        this.cleanupResultsList.innerHTML = items.map((item) =>
          `<li class="cleanup-results-item"><span class="cleanup-results-item-count">${item.count}</span> ${this.escapeHtml(item.label)}</li>`
        ).join('');
      }

      this.cleanupResults.classList.remove('hidden');
      this.renderIcons(this.cleanupResults);
    }

    hidePreview() {
      this.previewPanel.classList.add('hidden');
      this.mappingReview.classList.add('hidden');
      this.previewStats.textContent = '';
      this.previewTable.innerHTML = '';
      this.clearCleanupResults();
    }

    // ---- Upload ----

    async handleUpload() {
      if (this.files.length === 0 || this.uploading) return;

      const uploadStart = this.now();
      this.uploading = true;
      this.renderFileList();

      const mode = this.getOpenMode();
      this.primaryActionOperation = mode === 'merge' && this.files.length > 1 ? 'merge' : 'open';
      this._updatePrimaryAction();

      this.showProgress(0);

      try {
        const options = this.getCleaningOptions();
        const shouldTightenGrid = options.removeEmptyRows || options.removeEmptyColumns;
        const apiContext = { responseCache: new Map(), tightGrid: shouldTightenGrid };
        const hasCleaning =
          options.trim || options.removeEmptyRows || options.removeEmptyColumns ||
          options.removeDuplicates || options.fixNumbers || options.normalizeDates || options.normalizeHeaders;
        const results = [];
        let releasedParsedEntries = false;

        if (mode === 'merge' && this.files.length > 1) {
          const masterRef = this.files[0]?.kind === 'reference' ? this.files[0] : null;
          await this.ensureReferenceDataForFiles(this.files);
          await this.ensureEntriesParsed(
            this.files.filter((item) => item?.kind !== 'reference'),
            { preserveFormatting: true },
            'merge upload'
          );
          this.showProgress(5);

          // Merge mode — the result keeps the master file's name (and its
          // first sheet's name); it is never renamed to "Merged".
          const masterItem = this.files[0];
          const masterSheetName = this.getSelectedMergeSheet(masterItem)?.name || 'Sheet1';
          const title = masterRef
            ? masterRef.name
            : (masterItem.name.replace(/\.[^.]+$/, '') || masterItem.name);

          // Check which Excel files have raw data for formatting preservation
          const excelWithRaw = this.files.filter(
            (f) => (f.ext === 'xlsx' || f.ext === 'xls') && f.file
          );
          const hasSessionExcel = this.files.some(
            (f) => (f.ext === 'xlsx' || f.ext === 'xls') && !f.file
          );

          if (excelWithRaw.length > 0) {
            await this.ensureFormattingData(excelWithRaw);

            // Styles are already extracted during parsing — no API calls needed
            const fileStyles = this.files.map((item) => {
              const sheet = this.getSelectedMergeSheet(item);
              return (item.ext === 'xlsx' || item.ext === 'xls')
                ? sheet?.styles || null
                : null;
            });
            const fileThemeColors = this.files.map((item) =>
              (item.ext === 'xlsx' || item.ext === 'xls')
                ? item.parsed.themeColors || null
                : null
            );

            // Step 1: Merge raw data (without cleaning) to get sourceMap
            this.showProgress(10);
            const raw = this.files.map((item) => this.getSelectedMergeInput(item));
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
            const mergedMeta = merged.sheets[0]?.cellMeta || null;
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

            // Step 3: Write into the referenced spreadsheet, or create a new one
            this.showProgress(30);
            if (masterRef) {
              this.setStatus(`Merging into ${masterRef.name}…`, 'loading');
              await GoogleAPI.overwriteSpreadsheetWithTypedData(
                masterRef.refId,
                { name: masterSheetName, data: mergedData, cellMeta: mergedMeta },
                apiContext
              );
            } else {
              this.setStatus('Creating spreadsheet…', 'loading');
            }
            const result = masterRef
              ? { id: masterRef.refId, url: masterRef.refUrl, reference: true }
              : await GoogleAPI.createSpreadsheet(title, [{
                name: masterSheetName,
                data: mergedData,
                cellMeta: mergedMeta,
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
          } else if (hasSessionExcel) {
            // All Excel files are session-restored — no raw data available
            this.setStatus(
              'Re-add your files to preserve cell formatting (session-restored files lose raw data)',
              'warning'
            );
            return;
          } else {
            // No Excel files in the merge — process locally
            this.setStatus('Processing and merging data…', 'loading');
            this.showProgress(15);
            const processed = await this.getProcessedData();
            const mergedSheets = processed[0].sheets;
            if (mergedSheets[0]) mergedSheets[0].name = masterSheetName;
            this.showProgress(50);
            if (masterRef) {
              this.setStatus(`Merging into ${masterRef.name}…`, 'loading');
              await GoogleAPI.overwriteSpreadsheetWithTypedData(
                masterRef.refId,
                mergedSheets[0] || { name: 'Merged', data: [] },
                apiContext
              );
              results.push({ id: masterRef.refId, url: masterRef.refUrl, reference: true });
            } else {
              this.setStatus(`Creating "${title}" in Google Sheets…`, 'loading');
              const result = await GoogleAPI.createSpreadsheet(title, mergedSheets, apiContext);
              this.showProgress(90);
              results.push(result);
            }
          }
          this.showProgress(100);
        } else {
          // Separate mode: one spreadsheet per file
          for (let i = 0; i < this.files.length; i++) {
            const fileBase = (i / this.files.length) * 100;
            const fileSlice = 100 / this.files.length;
            const item = this.files[i];

            // Referenced sheets are not re-uploaded — open the same instance.
            if (item.kind === 'reference') {
              results.push({ id: item.refId, url: item.refUrl, reference: true });
              continue;
            }

            this.setStatus(`Creating "${item.name.replace(/\.[^.]+$/, '') || `Sheet ${i + 1}`}" in Google Sheets…`, 'loading');
            this.showProgress(fileBase);

            const { result, released } = await this.uploadOneFile(item, i, {
              options,
              hasCleaning,
              shouldTightenGrid,
              onProgress: (frac) => this.showProgress(fileBase + fileSlice * frac),
              onStatus: (msg) => this.setStatus(msg, 'loading'),
            });
            results.push(result);
            releasedParsedEntries = released || releasedParsedEntries;
            this.showProgress(fileBase + fileSlice);
          }
        }

        // Open all created spreadsheets in new tabs without flooding the browser.
        await this.openResultTabs(results);

        const allReferences = results.length > 0 && results.every((r) => r.reference);
        const msg = allReferences
          ? (results.length === 1
            ? 'Google Sheet opened — same instance'
            : `${results.length} Google Sheets opened — same instances`)
          : (results.length === 1
            ? 'Spreadsheet created and opened!'
            : `${results.length} spreadsheets created and opened!`);
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
        this._log('error', 'Upload failed:', err);
        this.logTiming('handle upload failed', uploadStart, {
          files: this.files.length,
          error: err.message,
        });
        this.setStatus(`Upload failed: ${err.message}`, 'error');
      } finally {
        this.uploading = false;
        this.primaryActionOperation = null;
        this.renderFileList();
        this._updatePrimaryAction();
        this.hideProgress();
      }
    }

    /**
     * Upload a single file from the list, independent of the bulk upload flow.
     * Uses the current cleaning options but always creates a separate spreadsheet
     * for the file (merge mode is a bulk-only concept).
     */
    async uploadSingleFromList(index) {
      if (this.uploading) return;
      if (index < 0 || index >= this.files.length) return;
      const item = this.files[index];
      if (!item) return;

      if (item.kind === 'reference') {
        this.uploading = true;
        this.renderFileList();
        this.primaryActionOperation = 'open';
        this._updatePrimaryAction();
        try {
          await chrome.tabs.create({ url: item.refUrl });
          this.setStatus(`Opened "${item.name}" — same Google Sheet instance`, 'success');
        } catch (err) {
          this.setStatus(`Could not open "${item.name}": ${err.message}`, 'error');
        } finally {
          this.uploading = false;
          this.renderFileList();
          this._updatePrimaryAction();
        }
        return;
      }

      const uploadStart = this.now();
      this.uploading = true;
      this.renderFileList();
      this.primaryActionOperation = 'open';
      this._updatePrimaryAction();
      this.showProgress(0);
      let releasedParsedEntries = false;

      try {
        const options = this.getCleaningOptions();
        const shouldTightenGrid = options.removeEmptyRows || options.removeEmptyColumns;
        const hasCleaning =
          options.trim || options.removeEmptyRows || options.removeEmptyColumns ||
          options.removeDuplicates || options.fixNumbers || options.normalizeDates || options.normalizeHeaders;
        const title = item.name.replace(/\.[^.]+$/, '') || `Sheet ${index + 1}`;

        this.setStatus(`Creating "${title}" in Google Sheets…`, 'loading');

        const { result, released } = await this.uploadOneFile(item, index, {
          options,
          hasCleaning,
          shouldTightenGrid,
          onProgress: (frac) => this.showProgress(frac * 100),
          onStatus: (msg) => this.setStatus(msg, 'loading'),
        });
        releasedParsedEntries = released;

        await this.openResultTabs([result]);

        this.showProgress(100);
        this.setStatus('Spreadsheet created and opened!', 'success');
        this.logTiming('single file upload', uploadStart, {
          file: item.name,
          preserveFormatting: options.preserveFormatting,
          hasCleaning,
        });
      } catch (err) {
        this._log('error', 'Single file upload failed:', err);
        this.logTiming('single file upload failed', uploadStart, {
          file: item?.name,
          error: err.message,
        });
        this.setStatus(`Upload failed: ${err.message}`, 'error');
      } finally {
        this.uploading = false;
        this.primaryActionOperation = null;
        if (releasedParsedEntries) this.renderFileList();
        this.renderFileList();
        this._updatePrimaryAction();
        this.hideProgress();
      }
    }

    /**
     * Internal helper that creates a single spreadsheet for one file.
     * Shared by the bulk separate-mode path and the per-file "Open" action.
     * Returns `{ result, released }` where `released` indicates whether the
     * parsed entry was freed after upload (so the caller can re-render / persist).
     */
    async uploadOneFile(item, index, { options, hasCleaning, shouldTightenGrid, onProgress, onStatus } = {}) {
      const title = item.name.replace(/\.[^.]+$/, '') || `Sheet ${index + 1}`;
      const useNativeImport = this.shouldUseNativeDriveImport(item);
      let released = false;

      if (useNativeImport) {
        // Path 1: Upload raw file to Drive — Google handles conversion/import natively.
        const fileContext = { responseCache: new Map(), tightGrid: shouldTightenGrid };
        onProgress?.(0.3);
        const result = await GoogleAPI.uploadFileToDrive(item.file, title, fileContext);
        if (hasCleaning) {
          onStatus?.(`Cleaning "${title}"…`);
          onProgress?.(0.7);
          await GoogleAPI.cleanUploadedSheet(result.id, options, fileContext);
        }
        if (this.shouldReleaseParsedAfterUpload(item)) {
          released = !!this.releaseParsedEntry(item);
        }
        return { result, released };
      }

      // Path 2: Parse locally, clean, create from data
      onProgress?.(0.1);
      await this.ensureParsedEntry(item, { preserveFormatting: true }, 'upload');
      onProgress?.(0.3);
      const sheetsData = [];
      for (let sheetIndex = 0; sheetIndex < item.parsed.sheets.length; sheetIndex++) {
        const sheet = item.parsed.sheets[sheetIndex];
        const result = await this.getCleanedSheetData(index, sheetIndex, options);
        const cleanedData = Array.isArray(result) ? result : result.data;
        const cleanedMeta = Array.isArray(result) ? null : result.cellMeta;
        sheetsData.push({
          name: sheet.name,
          data: cleanedData,
          cellMeta: cleanedMeta,
        });
      }
      onProgress?.(0.5);
      const fileContext = { responseCache: new Map(), tightGrid: shouldTightenGrid };
      const result = await GoogleAPI.createSpreadsheet(title, sheetsData, fileContext);
      if (this.shouldReleaseParsedAfterUpload(item)) {
        released = !!this.releaseParsedEntry(item);
      }
      return { result, released };
    }

    // ---- Progress & Status ----

    showProgress(percent) {
      const clamped = Math.max(0, Math.min(Math.round(percent), 100));
      this.loadingBar.value = clamped;
    }

    hideProgress() {
      setTimeout(() => {
        this.loadingBar.value = 0;
        this.loadingPanel.classList.remove('loading-panel--active');
        this.loadingSpinner.classList.add('hidden');
      }, 800);
    }

    setStatus(message, type = 'info', { announce = true } = {}) {
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

      if (announce) {
        this._announceStatus(message, type);
      } else {
        this._lastAnnouncedMessage = '';
        this._lastAnnouncedTime = 0;
      }
    }

    _announceStatus(message, type) {
      const now = Date.now();

      if (
        message === this._lastAnnouncedMessage &&
        type === this._lastAnnouncedType &&
        now - this._lastAnnouncedTime < 200
      ) {
        return;
      }

      const statusEl = this.loadingSrStatus;
      const alertEl = this.loadingSrAlert;
      if (!statusEl || !alertEl) return;

      if (type === 'error') {
        statusEl.textContent = '';
        alertEl.textContent = message;
      } else {
        alertEl.textContent = '';
        statusEl.textContent = message;
      }

      this._lastAnnouncedMessage = message;
      this._lastAnnouncedType = type;
      this._lastAnnouncedTime = now;
    }

    // ---- Helpers ----

    escapeHtml(str) {
      const el = document.createElement('span');
      el.textContent = str;
      return el.innerHTML;
    }

    initTheme() {
      const prefersDark = window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : false;
      this.theme = prefersDark ? 'dark' : 'light';
      this._applyTheme(this.theme);
    }

    _applyTheme(theme) {
      this.theme = theme;
      const isDark = theme === 'dark';
      if (isDark) {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
      const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
      if (this.themeToggle) {
        this.themeToggle.title = label;
        this.themeToggle.setAttribute('aria-label', label);
        const icon = this.themeToggle.querySelector('[data-lucide]');
        if (icon) {
          const nextIcon = isDark ? 'sun' : 'moon';
          icon.setAttribute('data-lucide', nextIcon);
          if (window.lucide?.createIcons) {
            window.lucide.createIcons({ root: this.themeToggle });
          }
        }
      }
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
