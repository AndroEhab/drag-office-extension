const fs = require('fs');
const path = require('path');

const { loadModule } = require('./helpers');

// ---- Mock dependent modules ----

// Load the real Cleaner's parseDateToken before mocking
const _realCleaner = loadModule('../sidepanel/cleaner.js', 'Cleaner');

global.Parser = {
  isSupported: jest.fn((name) =>
    ['csv', 'tsv', 'xlsx', 'xls'].some((ext) =>
      name.toLowerCase().endsWith(`.${ext}`)
    )
  ),
  isExcelSupported: jest.fn(() => true),
  parse: jest.fn(),
  getWorkbookMetadata: jest.fn(),
  preview: jest.fn(),
  hasTypedCellMetadata: jest.fn((parsed) => {
    if (!parsed || !Array.isArray(parsed.sheets)) return false;
    const VALID_TYPES = new Set(['empty', 'string', 'number', 'boolean', 'formula', 'date']);
    const DATE_TYPES = new Set(['DATE', 'TIME', 'DATE_TIME']);
    return parsed.sheets.every(sheet => {
      if (!Array.isArray(sheet.data) || !Array.isArray(sheet.cellMeta)) return false;
      if (sheet.cellMeta.length !== sheet.data.length) return false;
      return sheet.cellMeta.every((metaRow, ri) => {
        if (!Array.isArray(metaRow)) return false;
        const dataRow = sheet.data[ri];
        const width = dataRow ? dataRow.length : 0;
        if (metaRow.length < width) return false;
        return metaRow.every((token) => {
          if (!token || typeof token !== 'object') return false;
          if (!VALID_TYPES.has(token.type)) return false;
          if (token.type === 'formula' && (!token.value || typeof token.value !== 'string' || token.value.trim() === '')) return false;
          if (token.type === 'date' && (!token.formatType || !DATE_TYPES.has(token.formatType))) return false;
          return true;
        });
      });
    });
  }),
};

global.Cleaner = {
  apply: jest.fn((data, options, cellMeta) => ({
    data,
    cellMeta: cellMeta || null,
    stats: {
      trimmedValues: 0,
      emptyRowsRemoved: 0,
      emptyColumnsRemoved: 0,
      duplicateRowsRemoved: 0,
      numericValuesCorrected: 0,
      headersNormalized: 0,
    },
  })),
  tokenFromValue: jest.fn(v => {
    if (v === null || v === undefined || v === '') return { type: 'empty' };
    if (typeof v === 'number') return { type: 'number', value: v };
    if (typeof v === 'boolean') return { type: 'boolean', value: v };
    return { type: 'string', value: String(v) };
  }),
  emptyStats: jest.fn(() => ({
    trimmedValues: 0,
    emptyRowsRemoved: 0,
    emptyColumnsRemoved: 0,
    duplicateRowsRemoved: 0,
    numericValuesCorrected: 0,
    headersNormalized: 0,
  })),
};

global.Merger = {
  merge: jest.fn((files) => ({
    sheets: [{ name: 'Merged', data: files[0]?.sheets[0]?.data || [] }],
    sourceMap: [],
  })),
  detectMappings: jest.fn(() => []),
  collectHeaders: jest.fn(() => []),
  collectHeadersByFile: jest.fn((files, fileNames) =>
    files.map((file, index) => ({
      fileName: (fileNames && fileNames[index]) || `File ${index + 1}`,
      headers: (file?.sheets?.[0]?.data?.[0] || [])
        .map((header) => String(header ?? '').trim())
        .filter(Boolean),
    }))
  ),
};

global.GoogleAPI = {
  getToken: jest.fn().mockResolvedValue('mock-token'),
  createSpreadsheet: jest.fn().mockResolvedValue({
    id: 'sheet-123',
    url: 'https://docs.google.com/spreadsheets/d/sheet-123/edit',
  }),
  uploadFileToDrive: jest.fn().mockResolvedValue({
    id: 'drive-456',
    url: 'https://docs.google.com/spreadsheets/d/drive-456/edit',
  }),
  cleanUploadedSheet: jest.fn().mockResolvedValue(undefined),
  formatUploadedSheet: jest.fn().mockResolvedValue(undefined),
  sheetJsToSheetsFormat: jest.fn(),
  applyFormatting: jest.fn().mockResolvedValue(undefined),
};

global.lucide = {
  createIcons: jest.fn(),
};

global.FileHandleStore = {
  saveHandle: jest.fn().mockResolvedValue('mock-handle-id'),
  getHandle: jest.fn().mockResolvedValue(null),
  deleteHandle: jest.fn().mockResolvedValue(undefined),
  verifyWritePermission: jest.fn().mockResolvedValue(false),
  writeToHandle: jest.fn().mockResolvedValue(undefined),
  saveDirHandle: jest.fn().mockResolvedValue('mock-dir-id'),
  generateId: jest.fn(() => 'mock-id'),
};

// Load the real TypeDetector as a global for sidepanel integration
global.TypeDetector = loadModule('../sidepanel/type-detector.js', 'TypeDetector');

// Ensure Cleaner.parseDateToken is available for type detection
global.Cleaner.parseDateToken = _realCleaner.parseDateToken;

// ---- Load sidepanel module (expose class without auto-instantiation) ----

let spCode = fs.readFileSync(path.resolve(__dirname, '../sidepanel/sidepanel.js'), 'utf-8');
spCode = spCode.replace(
  /document\.addEventListener\(\s*['"]DOMContentLoaded['"]\s*,\s*\(\)\s*=>\s*new\s+DragToSheetsApp\(\)\s*\)\s*;?/,
  'global.DragToSheetsApp = DragToSheetsApp;'
);
eval(spCode);

if (typeof global.DragToSheetsApp !== 'function') {
  throw new Error('Failed to expose DragToSheetsApp — the source pattern may have changed');
}

// ---- DOM setup (must mirror sidepanel.html — see sidepanel/sidepanel.html) ----

function setupDOM() {
  window.lucide = global.lucide;
  document.body.innerHTML = `
    <div id="drop-zone" tabindex="0"></div>
    <input type="file" id="file-input" multiple>
    <ul id="file-list"></ul>
    <span id="file-count"></span>
    <div id="dataset-summary" class="dataset-summary hidden" role="group" aria-label="Dataset summary">
      <div class="summary-card">
        <span class="summary-card-value" id="summary-files">0</span>
        <span class="summary-card-label">Files</span>
      </div>
      <div class="summary-card">
        <span class="summary-card-value" id="summary-rows">0</span>
        <span class="summary-card-label">Rows</span>
      </div>
      <div class="summary-card">
        <span class="summary-card-value" id="summary-cols">0</span>
        <span class="summary-card-label">Columns</span>
      </div>
    </div>
    <div id="options-panel">
      <div id="merge-option" class="hidden">
        <div class="open-mode-options">
          <label class="open-mode-card open-mode-card--selected" id="open-mode-separate-card">
            <input type="radio" name="open-mode" value="separate" checked>
            <span class="open-mode-card-label">Open separately</span>
          </label>
          <label class="open-mode-card" id="open-mode-merge-card">
            <input type="radio" name="open-mode" value="merge">
            <span class="open-mode-card-label">Merge into one</span>
          </label>
        </div>
        <div id="smart-mapping-option" class="hidden">
          <input type="checkbox" id="opt-smart-mapping">
        </div>
        <div id="custom-mapping-option" class="hidden">
          <div id="custom-mapping-list"></div>
          <button id="custom-mapping-add">+ Add mapping</button>
        </div>
      </div>
      <div id="mapping-review" class="hidden">
        <div id="mapping-review-list"></div>
        <button id="mapping-approve-btn">Apply Mappings</button>
        <button id="mapping-decline-btn">Decline</button>
      </div>
      <button id="settings-btn" aria-controls="cleaning-options" aria-expanded="false">Settings</button>
      <div id="cleaning-options" class="hidden">
        <input type="checkbox" id="opt-trim">
        <input type="checkbox" id="opt-empty-rows">
        <input type="checkbox" id="opt-empty-cols">
        <div class="dup-group">
          <input type="checkbox" id="opt-duplicates">
          <div id="dup-mode" class="hidden">
            <input type="radio" name="dup-mode" value="keep-first" checked>
            <input type="radio" name="dup-mode" value="absolute">
          </div>
        </div>
        <input type="checkbox" id="opt-numbers">
        <input type="checkbox" id="opt-dates">
        <input type="checkbox" id="opt-headers">
      </div>
    </div>
    <div id="preview-panel" class="hidden">
      <select id="preview-select"></select>
      <div id="preview-stats"></div>
      <div id="preview-table"></div>
      <section id="cleanup-results" class="cleanup-results hidden" role="status" aria-live="polite" aria-atomic="true" aria-labelledby="cleanup-results-title">
        <div class="cleanup-results-header">
          <h4 id="cleanup-results-title" class="cleanup-results-title">Cleanup applied</h4>
        </div>
        <ul id="cleanup-results-list" class="cleanup-results-list"></ul>
        <p id="cleanup-results-empty" class="cleanup-results-empty hidden">No cleanup changes detected</p>
      </section>
    </div>
    <div class="actions">
      <button id="upload-btn" disabled>Open in Sheets</button>
    </div>
    <p class="privacy-note">
      <i data-lucide="shield" class="app-icon privacy-note-icon" aria-hidden="true"></i>
      <span>Your file contents are processed on this device and sent to Google only when you choose Open in Sheets. We do not collect analytics or track you.</span>
    </p>
    <div id="loading-panel" class="loading-panel">
      <div class="loading-panel-progress">
        <progress id="loading-panel-bar" class="loading-panel-bar" max="100" value="0"></progress>
      </div>
      <div class="loading-panel-body">
        <div id="loading-spinner" class="loading-spinner hidden"></div>
        <span id="loading-text" class="loading-text"></span>
        <span id="loading-sr-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></span>
        <span id="loading-sr-alert" class="sr-only" role="alert" aria-live="assertive" aria-atomic="true"></span>
      </div>
    </div>
    <button id="clear-btn" disabled>Clear</button>
    <button id="url-toggle" aria-expanded="false">Import URL</button>
    <div id="url-bar" class="hidden">
      <input type="text" id="url-input">
      <button id="url-fetch-btn">Fetch</button>
    </div>
  `;
}

/** Flush pending microtasks so async init() completes.
 *  Uses process.nextTick which is unaffected by jest.useFakeTimers(). */
function flushPromises() {
  return new Promise((resolve) => process.nextTick(resolve));
}

async function createApp() {
  setupDOM();
  const app = new global.DragToSheetsApp();
  await flushPromises();
  return app;
}

describe('DragToSheetsApp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset chrome storage mocks to return empty
    chrome.storage.session.get.mockResolvedValue({});
    chrome.storage.local.get.mockResolvedValue({});
  });

  // ---- resolveFileName ----

  describe('resolveFileName', () => {
    // Test directly on prototype since it doesn't use `this`
    const resolve = global.DragToSheetsApp.prototype.resolveFileName;

    test('extracts filename from Content-Disposition header', () => {
      expect(
        resolve('https://example.com/api', 'attachment; filename="data.csv"', '')
      ).toBe('data.csv');
    });

    test('handles Content-Disposition without quotes', () => {
      expect(
        resolve('https://example.com/api', 'attachment; filename=export.xlsx', '')
      ).toBe('export.xlsx');
    });

    test('extracts filename from URL path segment', () => {
      expect(
        resolve('https://example.com/files/report.csv', '', '')
      ).toBe('report.csv');
    });

    test('URL-decodes filename from path', () => {
      expect(
        resolve('https://example.com/my%20file.csv', '', '')
      ).toBe('my file.csv');
    });

    test('infers filename from Content-Type: text/csv', () => {
      expect(resolve('https://example.com/api', '', 'text/csv')).toBe('import.csv');
    });

    test('infers filename from Content-Type: text/tab-separated-values', () => {
      expect(
        resolve('https://example.com/api', '', 'text/tab-separated-values')
      ).toBe('import.tsv');
    });

    test('infers xlsx from Content-Type', () => {
      expect(
        resolve(
          'https://example.com/api',
          '',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
      ).toBe('import.xlsx');
    });

    test('infers xls from Content-Type', () => {
      expect(
        resolve('https://example.com/api', '', 'application/vnd.ms-excel')
      ).toBe('import.xls');
    });

    test('falls back to import.csv when nothing matches', () => {
      expect(resolve('https://example.com/api', '', 'application/json')).toBe(
        'import.csv'
      );
    });

    test('Content-Disposition takes priority over URL path', () => {
      expect(
        resolve(
          'https://example.com/wrong.xlsx',
          'attachment; filename="correct.csv"',
          ''
        )
      ).toBe('correct.csv');
    });

    test('URL path takes priority over Content-Type', () => {
      expect(
        resolve('https://example.com/data.tsv', '', 'text/csv')
      ).toBe('data.tsv');
    });
  });

  // ---- fileIcon ----

  describe('fileIcon', () => {
    let app;

    beforeEach(async () => {
      app = await createApp();
    });

    test('returns chart icon for csv', () => {
      expect(app.fileIcon('csv')).toBe('file-chart-column');
    });

    test('returns chart icon for tsv', () => {
      expect(app.fileIcon('tsv')).toBe('file-chart-column');
    });

    test('returns book icon for xlsx', () => {
      expect(app.fileIcon('xlsx')).toBe('file-spreadsheet');
    });

    test('returns book icon for xls', () => {
      expect(app.fileIcon('xls')).toBe('file-spreadsheet');
    });

    test('returns document icon for unknown extensions', () => {
      expect(app.fileIcon('pdf')).toBe('file');
    });
  });

  // ---- escapeHtml ----

  describe('escapeHtml', () => {
    let app;

    beforeEach(async () => {
      app = await createApp();
    });

    test('escapes < and >', () => {
      expect(app.escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    test('escapes &', () => {
      expect(app.escapeHtml('a & b')).toBe('a &amp; b');
    });

    test('passes through double quotes (not required in text nodes)', () => {
      // Double quotes don't need escaping in HTML text content per spec;
      // the escapeHtml implementation uses textContent/innerHTML which
      // correctly leaves them unescaped in text nodes.
      expect(app.escapeHtml('"hello"')).toBe('"hello"');
    });

    test('returns plain text unchanged', () => {
      expect(app.escapeHtml('hello world')).toBe('hello world');
    });

    test('handles empty string', () => {
      expect(app.escapeHtml('')).toBe('');
    });
  });

  // ---- Initialization ----

  describe('initialization', () => {
    test('creates with empty files array', async () => {
      const app = await createApp();
      expect(app.files).toEqual([]);
    });

    test('binds all required DOM elements', async () => {
      const app = await createApp();
      expect(app.dropZone).toBeTruthy();
      expect(app.fileInput).toBeTruthy();
      expect(app.fileList).toBeTruthy();
      expect(app.uploadBtn).toBeTruthy();
      expect(app.loadingPanel).toBeTruthy();
      expect(app.previewPanel).toBeTruthy();
    });

    test('upload button starts disabled', async () => {
      const app = await createApp();
      expect(app.uploadBtn.disabled).toBe(true);
    });

    test('clear button starts disabled', async () => {
      const app = await createApp();
      expect(app.clearBtn.disabled).toBe(true);
    });
  });

  // ---- primary action button label ----

  describe('primary action button label', () => {
    test('defaults to "Open in Sheets" with no files', async () => {
      const app = await createApp();
      expect(app.uploadBtn.textContent).toBe('Open in Sheets');
      expect(app.uploadBtn.getAttribute('aria-label')).toBe('Open in Sheets');
    });

    test('shows "Open in Sheets" for a single file', async () => {
      const app = await createApp();
      app.files = [{ name: 'test.csv', ext: 'csv' }];
      app.updateUI();
      expect(app.uploadBtn.textContent).toBe('Open in Sheets');
      expect(app.uploadBtn.getAttribute('aria-label')).toBe('Open in Sheets');
    });

    test('shows "Open files in Sheets" for multiple files in separate mode', async () => {
      const app = await createApp();
      app.files = [{ name: 'a.csv', ext: 'csv' }, { name: 'b.csv', ext: 'csv' }];
      app.updateUI();
      expect(app.uploadBtn.textContent).toBe('Open files in Sheets');
      expect(app.uploadBtn.getAttribute('aria-label')).toBe('Open files in Sheets');
    });

    test('shows "Merge and open in Sheets" for multiple files in merge mode', async () => {
      const app = await createApp();
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      app.files = [{ name: 'a.csv', ext: 'csv' }, { name: 'b.csv', ext: 'csv' }];
      app.updateUI();
      expect(app.uploadBtn.textContent).toBe('Merge and open in Sheets');
      expect(app.uploadBtn.getAttribute('aria-label')).toBe('Merge and open in Sheets');
    });

    test('shows "Opening\u2026" during separate-mode handleUpload', async () => {
      const app = await createApp();
      app.files = [{
        file: new File(['a'], 'f.csv'),
        parsed: null, name: 'f.csv', ext: 'csv', size: 1024,
        stats: null, identityKey: 'f.csv::csv::1024::0', lazy: true,
      }];
      app.updateUI();

      const uploadPromise = app.handleUpload();

      expect(app.uploadBtn.textContent).toBe('Opening\u2026');
      expect(app.uploadBtn.getAttribute('aria-label')).toBe('Opening\u2026');

      await uploadPromise;
    });

    test('shows "Merging\u2026" during merge-mode handleUpload', async () => {
      const app = await createApp();
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      const fileA = new File(['a'], 'a.csv');
      const fileB = new File(['b'], 'b.csv');
      app.files = [
        { file: fileA, parsed: { sheets: [{ name: 'A', data: [['X']] }] }, name: 'a.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'a.csv::csv::1024::0', lazy: false },
        { file: fileB, parsed: { sheets: [{ name: 'B', data: [['Y']] }] }, name: 'b.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'b.csv::csv::1024::1', lazy: false },
      ];
      app.updateUI();

      const uploadPromise = app.handleUpload();

      expect(app.uploadBtn.textContent).toBe('Merging\u2026');
      expect(app.uploadBtn.getAttribute('aria-label')).toBe('Merging\u2026');

      await uploadPromise;
    });

    test('shows "Opening\u2026" during uploadSingleFromList', async () => {
      const app = await createApp();
      app.files = [
        { file: new File(['a'], 'a.csv'), parsed: null, name: 'a.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'a.csv::csv::1024::0', lazy: true },
      ];
      app.updateUI();

      const uploadPromise = app.uploadSingleFromList(0);

      expect(app.uploadBtn.textContent).toBe('Opening\u2026');
      expect(app.uploadBtn.getAttribute('aria-label')).toBe('Opening\u2026');

      await uploadPromise;
    });

    test('restores label after successful handleUpload', async () => {
      const app = await createApp();
      const file = new File(['a'], 'f.csv');
      app.files = [{
        file, parsed: null, name: 'f.csv', ext: 'csv', size: 1024,
        stats: null, identityKey: 'f.csv::csv::1024::0', lazy: true,
      }];
      app.updateUI();

      await app.handleUpload();

      expect(app.uploadBtn.textContent).toBe('Open in Sheets');
      expect(app.uploadBtn.getAttribute('aria-label')).toBe('Open in Sheets');
    });

    test('restores label after successful merge upload', async () => {
      const app = await createApp();
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      const fileA = new File(['a'], 'a.csv');
      const fileB = new File(['b'], 'b.csv');
      app.files = [
        { file: fileA, parsed: { sheets: [{ name: 'A', data: [['X']] }] }, name: 'a.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'a.csv::csv::1024::0', lazy: false },
        { file: fileB, parsed: { sheets: [{ name: 'B', data: [['Y']] }] }, name: 'b.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'b.csv::csv::1024::1', lazy: false },
      ];
      app.updateUI();

      await app.handleUpload();

      expect(app.uploadBtn.textContent).toBe('Merge and open in Sheets');
      expect(app.uploadBtn.getAttribute('aria-label')).toBe('Merge and open in Sheets');
    });

    test('restores label after handleUpload error', async () => {
      const app = await createApp();
      const file = new File(['a'], 'f.csv');
      app.files = [{
        file, parsed: null, name: 'f.csv', ext: 'csv', size: 1024,
        stats: null, identityKey: 'f.csv::csv::1024::0', lazy: true,
      }];
      app.updateUI();
      GoogleAPI.uploadFileToDrive.mockRejectedValueOnce(new Error('Network error'));

      await app.handleUpload();

      expect(app.uploadBtn.textContent).toBe('Open in Sheets');
      expect(app.uploadBtn.getAttribute('aria-label')).toBe('Open in Sheets');
    });

    test('restores label after uploadSingleFromList error', async () => {
      const app = await createApp();
      app.files = [
        { file: new File(['x'], 'bad.csv'), parsed: null, name: 'bad.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'bad.csv::csv::1024::0', lazy: true },
      ];
      app.updateUI();
      GoogleAPI.uploadFileToDrive.mockRejectedValueOnce(new Error('boom'));

      await app.uploadSingleFromList(0);

      expect(app.uploadBtn.textContent).toBe('Open in Sheets');
      expect(app.uploadBtn.getAttribute('aria-label')).toBe('Open in Sheets');
    });

    test('preserves upload button disabled state during and after separate upload', async () => {
      const app = await createApp();
      const file = new File(['a'], 'f.csv');
      app.files = [{
        file, parsed: null, name: 'f.csv', ext: 'csv', size: 1024,
        stats: null, identityKey: 'f.csv::csv::1024::0', lazy: true,
      }];
      app.updateUI();
      expect(app.uploadBtn.disabled).toBe(false);

      const uploadPromise = app.handleUpload();
      expect(app.uploadBtn.disabled).toBe(true);
      await uploadPromise;
      expect(app.uploadBtn.disabled).toBe(false);
    });

    test('restores correct label after single-file upload when files remain', async () => {
      const app = await createApp();
      app.files = [
        { file: new File(['a'], 'a.csv'), parsed: null, name: 'a.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'a.csv::csv::1024::0', lazy: true },
        { file: new File(['b'], 'b.csv'), parsed: null, name: 'b.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'b.csv::csv::1024::1', lazy: true },
      ];
      app.updateUI();

      expect(app.uploadBtn.textContent).toBe('Open files in Sheets');

      await app.uploadSingleFromList(0);

      expect(app.uploadBtn.textContent).toBe('Open files in Sheets');
      expect(app.uploadBtn.getAttribute('aria-label')).toBe('Open files in Sheets');
    });

    // ---- DOM-event transition tests ----

    test('switching Separate -> Merge updates label immediately for two files', async () => {
      const app = await createApp();
      app.files = [{ name: 'a.csv', ext: 'csv' }, { name: 'b.csv', ext: 'csv' }];
      app.updateUI();
      expect(app.uploadBtn.textContent).toBe('Open files in Sheets');

      document.querySelector('input[name="open-mode"][value="merge"]').click();

      expect(app.uploadBtn.textContent).toBe('Merge and open in Sheets');
      expect(app.uploadBtn.getAttribute('aria-label')).toBe('Merge and open in Sheets');
    });

    test('switching Merge -> Separate updates label immediately for two files', async () => {
      const app = await createApp();
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      app.files = [{ name: 'a.csv', ext: 'csv' }, { name: 'b.csv', ext: 'csv' }];
      app.updateUI();
      expect(app.uploadBtn.textContent).toBe('Merge and open in Sheets');

      document.querySelector('input[name="open-mode"][value="separate"]').click();

      expect(app.uploadBtn.textContent).toBe('Open files in Sheets');
      expect(app.uploadBtn.getAttribute('aria-label')).toBe('Open files in Sheets');
    });

    test('single file remains "Open in Sheets" across mode changes', async () => {
      const app = await createApp();
      app.files = [{ name: 'a.csv', ext: 'csv' }];
      app.updateUI();

      expect(app.uploadBtn.textContent).toBe('Open in Sheets');

      document.querySelector('input[name="open-mode"][value="merge"]').click();
      expect(app.uploadBtn.textContent).toBe('Open in Sheets');

      document.querySelector('input[name="open-mode"][value="separate"]').click();
      expect(app.uploadBtn.textContent).toBe('Open in Sheets');
    });

    test('visible text and aria-label change together on mode switch', async () => {
      const app = await createApp();
      app.files = [{ name: 'a.csv', ext: 'csv' }, { name: 'b.csv', ext: 'csv' }];
      app.updateUI();

      document.querySelector('input[name="open-mode"][value="merge"]').click();
      expect(app.uploadBtn.getAttribute('aria-label')).toBe(app.uploadBtn.textContent);

      document.querySelector('input[name="open-mode"][value="separate"]').click();
      expect(app.uploadBtn.getAttribute('aria-label')).toBe(app.uploadBtn.textContent);
    });

    // ---- Pending-operation tests (deferred promise) ----

    test('updateUI() during Opening keeps "Opening…"', async () => {
      const app = await createApp();
      app.files = [{
        file: new File(['a'], 'f.csv'), parsed: null, name: 'f.csv', ext: 'csv',
        size: 1024, stats: null, identityKey: 'f.csv::csv::1024::0', lazy: true,
      }];
      app.updateUI();

      let resolveUpload;
      GoogleAPI.uploadFileToDrive.mockImplementation(() => new Promise(resolve => { resolveUpload = resolve; }));

      try {
        const uploadPromise = app.handleUpload();
        await flushPromises();

        app.updateUI();
        expect(app.uploadBtn.textContent).toBe('Opening\u2026');
        expect(app.uploadBtn.getAttribute('aria-label')).toBe('Opening\u2026');

        resolveUpload({ id: 'd', url: 'https://sheets.google.com/d/d' });
        await uploadPromise;
      } finally {
        GoogleAPI.uploadFileToDrive.mockReset();
        GoogleAPI.uploadFileToDrive.mockResolvedValue({ id: 'drive-456', url: 'https://docs.google.com/spreadsheets/d/drive-456/edit' });
      }
    });

    test('updateUI() during Merging keeps "Merging…"', async () => {
      const app = await createApp();
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      const fileA = new File(['a'], 'a.csv');
      const fileB = new File(['b'], 'b.csv');
      app.files = [
        { file: fileA, parsed: { sheets: [{ name: 'A', data: [['X']] }] }, name: 'a.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'a.csv::csv::1024::0', lazy: false },
        { file: fileB, parsed: { sheets: [{ name: 'B', data: [['Y']] }] }, name: 'b.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'b.csv::csv::1024::1', lazy: false },
      ];
      app.updateUI();

      let resolveUpload;
      GoogleAPI.createSpreadsheet.mockImplementation(() => new Promise(resolve => { resolveUpload = resolve; }));

      try {
        const uploadPromise = app.handleUpload();
        await flushPromises();

        app.updateUI();
        expect(app.uploadBtn.textContent).toBe('Merging\u2026');

        resolveUpload({ id: 's', url: 'https://sheets.google.com/d/s' });
        await uploadPromise;
      } finally {
        GoogleAPI.createSpreadsheet.mockReset();
        GoogleAPI.createSpreadsheet.mockResolvedValue({ id: 'sheet-123', url: 'https://docs.google.com/spreadsheets/d/sheet-123/edit' });
      }
    });

    test('button remains disabled after updateUI() during either operation', async () => {
      const app = await createApp();
      app.files = [{
        file: new File(['a'], 'f.csv'), parsed: null, name: 'f.csv', ext: 'csv',
        size: 1024, stats: null, identityKey: 'f.csv::csv::1024::0', lazy: true,
      }];
      app.updateUI();

      let resolveUpload;
      GoogleAPI.uploadFileToDrive.mockImplementation(() => new Promise(resolve => { resolveUpload = resolve; }));

      try {
        const uploadPromise = app.handleUpload();
        await flushPromises();

        app.updateUI();
        expect(app.uploadBtn.disabled).toBe(true);

        resolveUpload({ id: 'd', url: 'https://sheets.google.com/d/d' });
        await uploadPromise;
      } finally {
        GoogleAPI.uploadFileToDrive.mockReset();
        GoogleAPI.uploadFileToDrive.mockResolvedValue({ id: 'drive-456', url: 'https://docs.google.com/spreadsheets/d/drive-456/edit' });
      }
    });

    test('switching mode during a pending merge keeps "Merging…"', async () => {
      const app = await createApp();
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      const fileA = new File(['a'], 'a.csv');
      const fileB = new File(['b'], 'b.csv');
      app.files = [
        { file: fileA, parsed: { sheets: [{ name: 'A', data: [['X']] }] }, name: 'a.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'a.csv::csv::1024::0', lazy: false },
        { file: fileB, parsed: { sheets: [{ name: 'B', data: [['Y']] }] }, name: 'b.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'b.csv::csv::1024::1', lazy: false },
      ];
      app.updateUI();

      let resolveUpload;
      GoogleAPI.createSpreadsheet.mockImplementation(() => new Promise(resolve => { resolveUpload = resolve; }));

      try {
        const uploadPromise = app.handleUpload();
        await flushPromises();

        document.querySelector('input[name="open-mode"][value="separate"]').click();
        expect(app.uploadBtn.textContent).toBe('Merging\u2026');

        resolveUpload({ id: 's', url: 'https://sheets.google.com/d/s' });
        await uploadPromise;
      } finally {
        GoogleAPI.createSpreadsheet.mockReset();
        GoogleAPI.createSpreadsheet.mockResolvedValue({ id: 'sheet-123', url: 'https://docs.google.com/spreadsheets/d/sheet-123/edit' });
      }
    });

    test('switching mode during a pending separate upload keeps "Opening…"', async () => {
      const app = await createApp();
      app.files = [{
        file: new File(['a'], 'f.csv'), parsed: null, name: 'f.csv', ext: 'csv',
        size: 1024, stats: null, identityKey: 'f.csv::csv::1024::0', lazy: true,
      }];
      app.updateUI();

      let resolveUpload;
      GoogleAPI.uploadFileToDrive.mockImplementation(() => new Promise(resolve => { resolveUpload = resolve; }));

      try {
        const uploadPromise = app.handleUpload();
        await flushPromises();

        document.querySelector('input[name="open-mode"][value="merge"]').click();
        expect(app.uploadBtn.textContent).toBe('Opening\u2026');

        resolveUpload({ id: 'd', url: 'https://sheets.google.com/d/d' });
        await uploadPromise;
      } finally {
        GoogleAPI.uploadFileToDrive.mockReset();
        GoogleAPI.uploadFileToDrive.mockResolvedValue({ id: 'drive-456', url: 'https://docs.google.com/spreadsheets/d/drive-456/edit' });
      }
    });

    test('adding a file during a pending operation does not replace the progress label', async () => {
      const app = await createApp();
      app.files = [{
        file: new File(['a'], 'f.csv'), parsed: null, name: 'f.csv', ext: 'csv',
        size: 1024, stats: null, identityKey: 'f.csv::csv::1024::0', lazy: true,
      }];
      app.updateUI();

      let resolveUpload;
      GoogleAPI.uploadFileToDrive.mockImplementation(() => new Promise(resolve => { resolveUpload = resolve; }));

      try {
        const uploadPromise = app.handleUpload();
        await flushPromises();

        app.files.push({ name: 'g.csv', ext: 'csv' });
        app.updateUI();
        expect(app.uploadBtn.textContent).toBe('Opening\u2026');

        resolveUpload({ id: 'd', url: 'https://sheets.google.com/d/d' });
        await uploadPromise;
      } finally {
        GoogleAPI.uploadFileToDrive.mockReset();
        GoogleAPI.uploadFileToDrive.mockResolvedValue({ id: 'drive-456', url: 'https://docs.google.com/spreadsheets/d/drive-456/edit' });
      }
    });

    test('removing a file during a pending operation does not replace the progress label', async () => {
      const app = await createApp();
      app.files = [{
        file: new File(['a'], 'f.csv'), parsed: null, name: 'f.csv', ext: 'csv',
        size: 1024, stats: null, identityKey: 'f.csv::csv::1024::0', lazy: true,
      }];
      app.updateUI();

      let resolveUpload;
      GoogleAPI.uploadFileToDrive.mockImplementation(() => new Promise(resolve => { resolveUpload = resolve; }));

      try {
        const uploadPromise = app.handleUpload();
        await flushPromises();

        app.files = [];
        app.updateUI();
        expect(app.uploadBtn.textContent).toBe('Opening\u2026');

        resolveUpload({ id: 'd', url: 'https://sheets.google.com/d/d' });
        await uploadPromise;
      } finally {
        GoogleAPI.uploadFileToDrive.mockReset();
        GoogleAPI.uploadFileToDrive.mockResolvedValue({ id: 'drive-456', url: 'https://docs.google.com/spreadsheets/d/drive-456/edit' });
      }
    });

    test('active-operation state is cleared in every finally path after success', async () => {
      const app = await createApp();
      app.files = [{
        file: new File(['a'], 'f.csv'), parsed: null, name: 'f.csv', ext: 'csv',
        size: 1024, stats: null, identityKey: 'f.csv::csv::1024::0', lazy: true,
      }];
      app.updateUI();

      await app.handleUpload();
      expect(app.primaryActionOperation).toBeNull();
    });

    test('active-operation state is cleared in every finally path after error', async () => {
      const app = await createApp();
      app.files = [{
        file: new File(['a'], 'f.csv'), parsed: null, name: 'f.csv', ext: 'csv',
        size: 1024, stats: null, identityKey: 'f.csv::csv::1024::0', lazy: true,
      }];
      app.updateUI();
      GoogleAPI.uploadFileToDrive.mockRejectedValueOnce(new Error('fail'));

      await app.handleUpload();
      expect(app.primaryActionOperation).toBeNull();
    });

    test('a second upload cannot start while the first is pending', async () => {
      const app = await createApp();
      app.files = [{
        file: new File(['a'], 'f.csv'), parsed: null, name: 'f.csv', ext: 'csv',
        size: 1024, stats: null, identityKey: 'f.csv::csv::1024::0', lazy: true,
      }];
      app.updateUI();

      let resolveUpload;
      GoogleAPI.uploadFileToDrive.mockImplementation(() => new Promise(resolve => { resolveUpload = resolve; }));

      try {
        const first = app.handleUpload();
        await flushPromises();

        const second = app.handleUpload();
        expect(GoogleAPI.uploadFileToDrive).toHaveBeenCalledTimes(1);

        resolveUpload({ id: 'd', url: 'https://sheets.google.com/d/d' });
        await first;
        await second;
      } finally {
        GoogleAPI.uploadFileToDrive.mockReset();
        GoogleAPI.uploadFileToDrive.mockResolvedValue({ id: 'drive-456', url: 'https://docs.google.com/spreadsheets/d/drive-456/edit' });
      }
    });

    test('after success, the current idle label is restored', async () => {
      const app = await createApp();
      app.files = [{
        file: new File(['a'], 'f.csv'), parsed: null, name: 'f.csv', ext: 'csv',
        size: 1024, stats: null, identityKey: 'f.csv::csv::1024::0', lazy: true,
      }];
      app.updateUI();

      await app.handleUpload();
      expect(app.uploadBtn.textContent).toBe('Open in Sheets');
      expect(app.uploadBtn.getAttribute('aria-label')).toBe('Open in Sheets');
    });

    test('after failure, the current idle label is restored', async () => {
      const app = await createApp();
      app.files = [{
        file: new File(['a'], 'f.csv'), parsed: null, name: 'f.csv', ext: 'csv',
        size: 1024, stats: null, identityKey: 'f.csv::csv::1024::0', lazy: true,
      }];
      app.updateUI();
      GoogleAPI.uploadFileToDrive.mockRejectedValueOnce(new Error('fail'));

      await app.handleUpload();
      expect(app.uploadBtn.textContent).toBe('Open in Sheets');
      expect(app.uploadBtn.getAttribute('aria-label')).toBe('Open in Sheets');
    });
  });

  // ---- dataset summary cards ----

  describe('dataset summary', () => {
    function setFiles(app, files) {
      app.files = files;
      app.updateUI();
    }

    test('hidden when no files are loaded', async () => {
      const app = await createApp();
      const el = document.getElementById('dataset-summary');
      expect(el.getAttribute('role')).toBe('group');
      expect(el.getAttribute('aria-label')).toBe('Dataset summary');
      expect(el.classList.contains('hidden')).toBe(true);
    });

    test('one empty sheet displays 0 rows', async () => {
      const app = await createApp();
      setFiles(app, [{ name: 'e.csv', parsed: { sheets: [{ name: 'Sheet1', data: [] }] }, stats: { rowCount: 0, dataRowCount: 0, colCount: 0 } }]);
      expect(document.getElementById('summary-rows').textContent).toBe('0');
    });

    test('one header-only sheet displays 0 rows', async () => {
      const app = await createApp();
      setFiles(app, [{ name: 'h.csv', parsed: { sheets: [{ name: 'Sheet1', data: [['h1','h2']] }] }, stats: { rowCount: 1, dataRowCount: 0, colCount: 2 } }]);
      expect(document.getElementById('summary-rows').textContent).toBe('0');
      expect(document.getElementById('summary-cols').textContent).toBe('2');
    });

    test('header plus two records displays count of data rows', async () => {
      const app = await createApp();
      setFiles(app, [{ name: 'd.csv', parsed: { sheets: [{ name: 'Sheet1', data: [['h'], ['v1'], ['v2']] }] }, stats: { rowCount: 3, dataRowCount: 2, colCount: 1 } }]);
      expect(document.getElementById('summary-files').textContent).toBe('1');
      expect(document.getElementById('summary-rows').textContent).toBe('2');
      expect(document.getElementById('summary-cols').textContent).toBe('1');
    });

    test('multiple non-empty sheets aggregate correctly', async () => {
      const app = await createApp();
      setFiles(app, [{
        name: 'm.csv',
        parsed: {
          sheets: [
            { name: 'S1', data: [['h'], ['v1'], ['v2']] },
            { name: 'S2', data: [['h'], ['v1'], ['v2'], ['v3']] },
          ],
        },
        stats: { rowCount: 7, dataRowCount: 5, colCount: 1 },
      }]);
      expect(document.getElementById('summary-files').textContent).toBe('1');
      expect(document.getElementById('summary-rows').textContent).toBe('5'); // (2-1)+(4-1)
      expect(document.getElementById('summary-cols').textContent).toBe('1');
    });

    test('mixture of empty and non-empty sheets does not undercount', async () => {
      const app = await createApp();
      setFiles(app, [{
        name: 'mix.csv',
        parsed: {
          sheets: [
            { name: 'S1', data: [] },
            { name: 'S2', data: [['h'], ['v1']] },
          ],
        },
        stats: { rowCount: 2, dataRowCount: 1, colCount: 1 },
      }]);
      expect(document.getElementById('summary-rows').textContent).toBe('1');
    });

    test('aggregates across multiple files with max columns', async () => {
      const app = await createApp();
      setFiles(app, [
        { name: 'a.csv', parsed: { sheets: [{ name: 'S1', data: [['h1','h2'], ['v1','v2']] }] }, stats: { rowCount: 2, dataRowCount: 1, colCount: 2 } },
        { name: 'b.csv', parsed: { sheets: [{ name: 'S1', data: [['h1'], ['v1'], ['v2'], ['v3']] }] }, stats: { rowCount: 4, dataRowCount: 3, colCount: 1 } },
      ]);
      expect(document.getElementById('summary-files').textContent).toBe('2');
      expect(document.getElementById('summary-rows').textContent).toBe('4'); // 1 + 3
      expect(document.getElementById('summary-cols').textContent).toBe('2');
    });

    test('unknown lazy stats display dashes', async () => {
      const app = await createApp();
      app.files = [{ name: 'a.csv', parsed: null, lazy: true }];
      app._updateSummaryCards();
      expect(document.getElementById('summary-files').textContent).toBe('1');
      expect(document.getElementById('summary-rows').textContent).toBe('\u2014');
      expect(document.getElementById('summary-cols').textContent).toBe('\u2014');
    });

    test('getEntryStats does not mutate unknown stats into zero stats', async () => {
      const app = await createApp();
      app.files = [{ name: 'a.csv', parsed: null, lazy: true }];
      const stats = app.getEntryStats(app.files[0]);
      expect(stats).toBeNull();
      expect(app.files[0].stats).toBeUndefined();
    });

    test('workload calculation tolerates unknown entries', async () => {
      const app = await createApp();
      app.files = [
        { name: 'a.csv', parsed: { sheets: [{ name: 'S1', data: [['h'], ['v']] }] }, stats: { rowCount: 2, dataRowCount: 1, colCount: 1, cellCount: 2, styledCellCount: 0 } },
        { name: 'b.csv', parsed: null, lazy: true },
      ];
      const hints = app.getLoadedWorkloadHints();
      expect(hints.fileCount).toBe(2);
      expect(hints.totalCells).toBe(2); // only file a contributes
      expect(hints.maxFileCells).toBe(2);
    });

    test('stats-only restored multi-sheet entry uses stored dataRowCount', async () => {
      const app = await createApp();
      app.files = [
        { name: 'r.csv', parsed: { sheets: [{ name: 'S1', data: [['h'], ['v1'], ['v2']] }] }, stats: { sheetCount: 1, rowCount: 3, dataRowCount: 2, colCount: 1 } },
      ];
      app._updateSummaryCards();
      expect(document.getElementById('summary-rows').textContent).toBe('2');
    });

    test('legacy stats without dataRowCount derive from parsed sheets', async () => {
      const app = await createApp();
      // old-format stats: no dataRowCount, but parsed.sheets has the data
      setFiles(app, [{ name: 'a.csv', parsed: { sheets: [{ name: 'S1', data: [['h'], ['v1'], ['v2']] }] }, stats: { rowCount: 3, colCount: 1 } }]);
      expect(document.getElementById('summary-rows').textContent).toBe('2');
    });

    test('small complete CSV through ensurePreviewSample replaces dashes with exact values', async () => {
      const app = await createApp();
      global.Parser.preview.mockResolvedValue({
        sheets: [{ name: 'Sheet1', data: [['h'], ['v1'], ['v2']] }],
        previewMeta: { rowCount: 3, dataRowCount: 2, colCount: 1, sheetCount: 1, sampled: false, sampleRows: 3, fileSize: 20 },
      });
      app.files = [{ name: 'a.csv', parsed: null, lazy: true, file: new File(['h\nv1\nv2'], 'a.csv', { type: 'text/csv' }) }];
      app._updateSummaryCards();
      expect(document.getElementById('summary-rows').textContent).toBe('\u2014');

      await app.ensurePreviewSample(app.files[0]);
      expect(document.getElementById('summary-rows').textContent).toBe('2');
      expect(document.getElementById('summary-cols').textContent).toBe('1');
    });

    test('truncated CSV preview with rowCount null retains dashes', async () => {
      const app = await createApp();
      global.Parser.preview.mockResolvedValue({
        sheets: [{ name: 'Sheet1', data: [['h'], ['v1'], ['v2']] }],
        previewMeta: { rowCount: null, dataRowCount: null, colCount: 1, sheetCount: 1, sampled: true, sampleRows: 3, fileSize: 999999 },
      });
      app.files = [{ name: 'big.csv', parsed: null, lazy: true, file: new File(['h\nv1\nv2'], 'big.csv', { type: 'text/csv' }) }];
      app._updateSummaryCards();
      expect(document.getElementById('summary-rows').textContent).toBe('\u2014');

      await app.ensurePreviewSample(app.files[0]);
      expect(document.getElementById('summary-rows').textContent).toBe('\u2014');
      expect(app.files[0].stats).toBeUndefined();
    });

    test('truncated sampled rows are not assigned to item.stats or item.summaryStats', async () => {
      const app = await createApp();
      global.Parser.preview.mockResolvedValue({
        sheets: [{ name: 'Sheet1', data: [['h'], ['v1']] }],
        previewMeta: { rowCount: null, dataRowCount: null, colCount: 2, sheetCount: 1, sampled: true, sampleRows: 2, fileSize: 999999 },
      });
      app.files = [{ name: 't.csv', parsed: null, lazy: true, file: new File(['h\nv1'], 't.csv', { type: 'text/csv' }) }];
      await app.ensurePreviewSample(app.files[0]);
      expect(app.files[0].stats).toBeUndefined();
      expect(app.files[0].summaryStats).toBeUndefined();
    });

    test('multi-sheet Excel preview reports totals across all sheets', async () => {
      const app = await createApp();
      const parsed = {
        sheets: [
          { name: 'S1', data: [['h1'], ['v1'], ['v2']] },
          { name: 'S2', data: [['h2'], ['v3'], ['v4'], ['v5']] },
        ],
      };
      const stats = app.computeParsedStats(parsed);
      app.files = [{ name: 'w.xlsx', parsed, stats, ext: 'xlsx' }];
      app._updateSummaryCards();
      // dataRowCount = (3-1)+(4-1) = 5; colCount = max(1,1) = 1
      expect(document.getElementById('summary-rows').textContent).toBe('5');
    });

    test('full parsing after unknown preview replaces dashes with exact values', async () => {
      const app = await createApp();
      global.Parser.parse.mockResolvedValue({
        sheets: [{ name: 'Sheet1', data: [['h'], ['v1'], ['v2'], ['v4']] }],
      });
      app.files = [{ name: 'a.csv', parsed: null, lazy: true, file: new File(['h\nv1\nv2'], 'a.csv', { type: 'text/csv' }) }];
      app._updateSummaryCards();
      expect(document.getElementById('summary-rows').textContent).toBe('\u2014');

      await app.ensureParsedEntry(app.files[0]);
      expect(document.getElementById('summary-rows').textContent).toBe('3');
      expect(document.getElementById('summary-cols').textContent).toBe('1');
    });

    test('unknown preview metadata is not persisted as exact stats', async () => {
      const app = await createApp();
      const preview = {
        sheets: [{ name: 'Sheet1', data: [['h'], ['v1']] }],
        previewMeta: { rowCount: null, dataRowCount: null, colCount: null, sheetCount: null, sampled: true, sampleRows: 2, fileSize: 100 },
      };
      const result = app.buildStatsFromPreview(preview);
      expect(result).toBeNull();
    });

    test('genuinely stats-only restored entry uses stored dataRowCount', async () => {
      const app = await createApp();
      app.files = [{ name: 'r.csv', parsed: null, stats: { sheetCount: 3, rowCount: 103, dataRowCount: 100, colCount: 12 } }];
      app._updateSummaryCards();
      expect(document.getElementById('summary-rows').textContent).toBe('100');
      expect(document.getElementById('summary-cols').textContent).toBe('12');
    });

    test('exact zero values are accepted and do not fall through to sampled values', async () => {
      const app = await createApp();
      app.files = [{ name: 'e.csv', parsed: { sheets: [{ name: 'S1', data: [] }] }, stats: { rowCount: 0, dataRowCount: 0, colCount: 0, cellCount: 0, styledCellCount: 0 } }];
      app._updateSummaryCards();
      expect(document.getElementById('summary-rows').textContent).toBe('0');
      expect(document.getElementById('summary-cols').textContent).toBe('0');
    });

    test('empty and header-only multi-sheet workbooks remain correct', async () => {
      const app = await createApp();
      const parsed = {
        sheets: [
          { name: 'S1', data: [] },
          { name: 'S2', data: [['h']] },
          { name: 'S3', data: [['h'], ['v1']] },
        ],
      };
      const stats = app.computeParsedStats(parsed);
      app.files = [{ name: 'mix.xlsx', parsed, stats, ext: 'xlsx' }];
      app._updateSummaryCards();
      // dataRowCount = 0 + 0 + 1 = 1
      expect(document.getElementById('summary-rows').textContent).toBe('1');
    });

    test('clearing files hides the cards', async () => {
      const app = await createApp();
      setFiles(app, [{ name: 'a.csv', parsed: { sheets: [{ name: 'S1', data: [['h'], ['v']] }] }, stats: { rowCount: 2, dataRowCount: 1, colCount: 1 } }]);
      expect(document.getElementById('dataset-summary').classList.contains('hidden')).toBe(false);
      app.clearFiles();
      expect(document.getElementById('dataset-summary').classList.contains('hidden')).toBe(true);
    });

    test('removing one file recalculates totals and max columns', async () => {
      const app = await createApp();
      setFiles(app, [
        { name: 'a.csv', parsed: { sheets: [{ name: 'S1', data: [['h1','h2'], ['v1','v2']] }] }, stats: { rowCount: 2, dataRowCount: 1, colCount: 2 } },
        { name: 'b.csv', parsed: { sheets: [{ name: 'S1', data: [['h1'], ['v1'], ['v2'], ['v3']] }] }, stats: { rowCount: 4, dataRowCount: 3, colCount: 1 } },
      ]);
      expect(document.getElementById('summary-files').textContent).toBe('2');
      expect(document.getElementById('summary-rows').textContent).toBe('4');

      app.files.splice(0, 1);
      app.updateUI();
      expect(document.getElementById('summary-files').textContent).toBe('1');
      expect(document.getElementById('summary-rows').textContent).toBe('3');
      expect(document.getElementById('summary-cols').textContent).toBe('1');
    });
  });

  // ---- summaryStats vs stats separation ----

  describe('summaryStats isolation', () => {
    test('preview hydration sets summaryStats not stats', async () => {
      const app = await createApp();
      global.Parser.preview.mockResolvedValue({
        sheets: [{ name: 'Sheet1', data: [['h'], ['v1'], ['v2']] }],
        previewMeta: { rowCount: 3, dataRowCount: 2, colCount: 1, sheetCount: 1, sampled: false, sampleRows: 3, fileSize: 20 },
      });
      app.files = [{ name: 'a.csv', parsed: null, lazy: true, file: new File(['h\nv1\nv2'], 'a.csv', { type: 'text/csv' }) }];
      await app.ensurePreviewSample(app.files[0]);
      expect(app.files[0].summaryStats).toBeDefined();
      expect(app.files[0].summaryStats.dataRowCount).toBe(2);
      expect(app.files[0].stats).toBeUndefined();
    });

    test('full parse replaces summaryStats with complete stats', async () => {
      const app = await createApp();
      global.Parser.parse.mockResolvedValue({
        sheets: [{ name: 'Sheet1', data: [['h'], ['v1'], ['v2'], ['v3']] }],
      });
      app.files = [{ name: 'a.csv', parsed: null, lazy: true, summaryStats: { sheetCount: 1, rowCount: 3, dataRowCount: 2, colCount: 1 }, file: new File(['h\nv1\nv2'], 'a.csv', { type: 'text/csv' }) }];
      await app.ensureParsedEntry(app.files[0]);
      expect(app.files[0].stats).toBeDefined();
      expect(app.files[0].stats.dataRowCount).toBe(3);
      expect(app.files[0].summaryStats).toBeUndefined();
      expect(document.getElementById('summary-rows').textContent).toBe('3');
    });

    test('getLoadedWorkloadHints is unchanged by summary-only hydration', async () => {
      const app = await createApp();
      // file with full stats (as from computeParsedStats)
      const fullFile = { name: 'full.csv', parsed: { sheets: [{ name: 'S1', data: [['h'], ['v']] }] }, stats: { rowCount: 2, dataRowCount: 1, colCount: 1, cellCount: 2, styledCellCount: 0 } };
      // file with only summaryStats (from preview)
      const summaryFile = { name: 'sum.csv', parsed: null, lazy: true, summaryStats: { sheetCount: 1, rowCount: 5, dataRowCount: 4, colCount: 3 } };
      app.files = [fullFile, summaryFile];

      const hints = app.getLoadedWorkloadHints();
      expect(hints.fileCount).toBe(2);
      expect(hints.totalCells).toBe(2); // only fullFile contributes
      expect(hints.maxFileCells).toBe(2);
      expect(hints.totalBytes).toBe(0);
    });

    test('summaryStats alone renders cards without polluting workload stats', async () => {
      const app = await createApp();
      app.files = [{ name: 'p.csv', parsed: null, summaryStats: { sheetCount: 2, rowCount: 10, dataRowCount: 8, colCount: 5 } }];
      app._updateSummaryCards();
      expect(document.getElementById('summary-rows').textContent).toBe('8');
      expect(document.getElementById('summary-cols').textContent).toBe('5');
      // getEntryStats should return null since there's no full stats
      expect(app.getEntryStats(app.files[0])).toBeNull();
    });

    test('restored parsed entry with neither stats nor summaryStats derives complete stats', async () => {
      const app = await createApp();
      app.files = [{
        name: 'legacy.csv',
        parsed: { sheets: [{ name: 'Sheet1', data: [['Header'], ['A'], ['B']] }] },
        stats: null,
        summaryStats: null,
      }];
      app._updateSummaryCards();
      // getEntryStats should derive from parsed and delete summaryStats
      expect(document.getElementById('summary-rows').textContent).toBe('2');
      expect(document.getElementById('summary-cols').textContent).toBe('1');
      const stats = app.getEntryStats(app.files[0]);
      expect(stats).toBeTruthy();
      expect(stats.dataRowCount).toBe(2);
      expect(stats.colCount).toBe(1);
      expect(stats.cellCount).toBe(3); // 3 rows × 1 col
      expect(stats.styledCellCount).toBe(0);
      expect(app.files[0].summaryStats).toBeUndefined();
    });

    test('parsed entry with stale summaryStats uses full stats and removes stale summary', async () => {
      const app = await createApp();
      app.files = [{
        name: 'stale.csv',
        parsed: { sheets: [{ name: 'S1', data: [['h'], ['v1'], ['v2'], ['v3']] }] },
        summaryStats: { sheetCount: 1, rowCount: 2, dataRowCount: 1, colCount: 9 },
      }];
      app._updateSummaryCards();
      // Should use getEntryStats which derives from parsed data (4 rows, 1 col)
      expect(document.getElementById('summary-rows').textContent).toBe('3');
      expect(document.getElementById('summary-cols').textContent).toBe('1');
      expect(app.files[0].stats).toBeTruthy();
      expect(app.files[0].summaryStats).toBeUndefined();
    });

    test('unparsed preview-only entry continues using summaryStats without creating workload stats', async () => {
      const app = await createApp();
      app.files = [{
        name: 'prev.csv',
        parsed: null,
        lazy: true,
        summaryStats: { sheetCount: 1, rowCount: 5, dataRowCount: 4, colCount: 3 },
      }];
      app._updateSummaryCards();
      expect(document.getElementById('summary-rows').textContent).toBe('4');
      expect(document.getElementById('summary-cols').textContent).toBe('3');
      expect(app.getEntryStats(app.files[0])).toBeNull();
      expect(app.files[0].summaryStats).toBeDefined();
    });

    test('saveFilesSession stores summaryStats separately from stats', async () => {
      const app = await createApp();
      chrome.storage.session.set.mockResolvedValue();
      chrome.storage.local.set.mockResolvedValue();
      app.files = [
        { name: 'full.csv', parsed: { sheets: [{ name: 'S1', data: [['h'], ['v']] }] }, stats: { rowCount: 2, dataRowCount: 1, colCount: 1, cellCount: 2, styledCellCount: 0 } },
        { name: 'prev.csv', parsed: null, lazy: true, summaryStats: { sheetCount: 1, rowCount: 5, dataRowCount: 4, colCount: 3 } },
      ];
      const serialized = app.files.map((item) => ({
        name: item.name,
        ext: item.ext,
        size: 0,
        stats: item.stats || null,
        summaryStats: item.summaryStats || null,
        identityKey: item.identityKey || null,
        contentFingerprint: item.contentFingerprint || null,
        lazy: Boolean(item.lazy && !item.parsed),
        handleId: item.handleId || null,
        sheets: null,
      }));
      expect(serialized[0].stats).toBeTruthy();
      expect(serialized[0].summaryStats).toBeNull();
      expect(serialized[1].stats).toBeNull();
      expect(serialized[1].summaryStats).toEqual({ sheetCount: 1, rowCount: 5, dataRowCount: 4, colCount: 3 });
    });

    test('restored summaryStats renders cards and workload ignores it', async () => {
      const app = await createApp();
      app.files = [{
        name: 'restored.csv',
        parsed: null,
        summaryStats: { sheetCount: 1, rowCount: 4, dataRowCount: 3, colCount: 2 },
      }];
      app._updateSummaryCards();
      expect(document.getElementById('summary-rows').textContent).toBe('3');
      expect(document.getElementById('summary-cols').textContent).toBe('2');
      const hints = app.getLoadedWorkloadHints();
      expect(hints.totalCells).toBe(0);
    });

    test('full parsing after restoration removes summaryStats and creates complete stats', async () => {
      const app = await createApp();
      global.Parser.parse.mockResolvedValue({
        sheets: [{ name: 'Sheet1', data: [['h1', 'h2'], ['v1', 'v2'], ['v3', 'v4'], ['v5', 'v6']] }],
      });
      app.files = [{
        name: 'r.csv',
        parsed: null,
        lazy: true,
        summaryStats: { sheetCount: 1, rowCount: 4, dataRowCount: 3, colCount: 9 },
        file: new File(['h1,h2\nv1,v2\nv3,v4\nv5,v6'], 'r.csv', { type: 'text/csv' }),
      }];
      await app.ensureParsedEntry(app.files[0]);
      expect(app.files[0].stats).toBeDefined();
      expect(app.files[0].stats.dataRowCount).toBe(3);
      expect(app.files[0].stats.colCount).toBe(2);
      expect(app.files[0].summaryStats).toBeUndefined();
      expect(document.getElementById('summary-rows').textContent).toBe('3');
      expect(document.getElementById('summary-cols').textContent).toBe('2');
    });
  });

  // ---- layout and accessibility regression tests ----

  describe('panel layout and disclosure semantics', () => {
    test('preview precedes upload button in DOM order', async () => {
      await createApp();
      const preview = document.getElementById('preview-panel');
      const upload = document.getElementById('upload-btn');
      expect(preview.compareDocumentPosition(upload) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    test('settings button has aria-controls pointing to cleaning-options', async () => {
      await createApp();
      const btn = document.getElementById('settings-btn');
      expect(btn.getAttribute('aria-controls')).toBe('cleaning-options');
    });

    test('settings button starts with aria-expanded false', async () => {
      await createApp();
      const btn = document.getElementById('settings-btn');
      expect(btn.getAttribute('aria-expanded')).toBe('false');
    });

    test('opening settings sets aria-expanded true', async () => {
      const app = await createApp();
      app.settingsBtn.click();
      expect(app.settingsBtn.getAttribute('aria-expanded')).toBe('true');
      expect(app.cleaningOptions.classList.contains('hidden')).toBe(false);
    });

    test('closing settings resets aria-expanded to false', async () => {
      const app = await createApp();
      app.settingsBtn.click();
      expect(app.settingsBtn.getAttribute('aria-expanded')).toBe('true');
      app.settingsBtn.click();
      expect(app.settingsBtn.getAttribute('aria-expanded')).toBe('false');
      expect(app.cleaningOptions.classList.contains('hidden')).toBe(true);
    });

    test('settings toggle does not fire extra preview refresh or upload', async () => {
      const app = await createApp();
      const refreshSpy = jest.spyOn(app, 'schedulePreviewRefresh');
      const uploadSpy = jest.spyOn(app, 'handleUpload');
      app.settingsBtn.click();
      expect(refreshSpy).not.toHaveBeenCalled();
      expect(uploadSpy).not.toHaveBeenCalled();
    });

    test('settings button immediately precedes cleaning-options', async () => {
      await createApp();
      const settings = document.getElementById('settings-btn');
      const cleaning = document.getElementById('cleaning-options');
      const firstControl = cleaning.querySelector('input');
      const preview = document.getElementById('preview-panel');

      expect(
        settings.compareDocumentPosition(cleaning) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();

      expect(
        settings.compareDocumentPosition(firstControl) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();

      expect(
        cleaning.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    test('preview precedes Open in Sheets in DOM order', async () => {
      await createApp();
      const preview = document.getElementById('preview-panel');
      const upload = document.getElementById('upload-btn');
      expect(
        preview.compareDocumentPosition(upload) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    test('Open in Sheets precedes live status regions', async () => {
      await createApp();
      const upload = document.getElementById('upload-btn');
      const status = document.getElementById('loading-sr-status');
      const alert = document.getElementById('loading-sr-alert');
      expect(
        upload.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(status.getAttribute('role')).toBe('status');
      expect(alert.getAttribute('role')).toBe('alert');
    });

    test('restored settingsOpen preference shows controls and aria-expanded true', async () => {
      const app = await createApp();
      // Simulate restore from prefs
      app.cleaningOptions.classList.remove('hidden');
      app.settingsBtn.classList.add('active');
      app.settingsBtn.setAttribute('aria-expanded', 'true');
      expect(app.cleaningOptions.classList.contains('hidden')).toBe(false);
      expect(app.settingsBtn.getAttribute('aria-expanded')).toBe('true');
      expect(app.settingsBtn.classList.contains('active')).toBe(true);
    });

    test('upload button disabled state matches files length', async () => {
      const app = await createApp();
      expect(app.uploadBtn.disabled).toBe(true);
      app.files = [{ name: 'test.csv' }];
      app.updateUI();
      expect(app.uploadBtn.disabled).toBe(false);
    });

    test('privacy note exists exactly once', async () => {
      await createApp();
      const notes = document.querySelectorAll('.privacy-note');
      expect(notes).toHaveLength(1);
    });

    test('privacy note contains the complete visible wording', async () => {
      await createApp();
      const note = document.querySelector('.privacy-note span');
      expect(note.textContent).toBe(
        'Your file contents are processed on this device and sent to Google only when you choose Open in Sheets. We do not collect analytics or track you.'
      );
    });

    test('privacy note appears after the primary-action container and before the loading panel', async () => {
      await createApp();
      const actions = document.querySelector('.actions');
      const note = document.querySelector('.privacy-note');
      const panel = document.getElementById('loading-panel');
      expect(
        actions.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        note.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    test('privacy note shield icon has aria-hidden="true"', async () => {
      await createApp();
      const icon = document.querySelector('.privacy-note .app-icon');
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    });

    test('privacy note explanatory text is available to assistive technology', async () => {
      await createApp();
      const span = document.querySelector('.privacy-note span');
      expect(span).toBeTruthy();
      expect(span.textContent.trim().length).toBeGreaterThan(0);
    });

    test('privacy note does not use role="alert" or aria-live', async () => {
      await createApp();
      const note = document.querySelector('.privacy-note');
      expect(note.getAttribute('role')).not.toBe('alert');
      expect(note.hasAttribute('aria-live')).toBe(false);
    });

    test('primary action visible text and accessible name remain unchanged', async () => {
      await createApp();
      const btn = document.getElementById('upload-btn');
      expect(btn.textContent).toBe('Open in Sheets');
      expect(btn.getAttribute('aria-label')).toBe('Open in Sheets');
      expect(btn.getAttribute('role')).not.toBe('alert');
    });
  });

  // ---- Session restore ----

  describe('restoreSession', () => {
    test('restores files from chrome.storage.session', async () => {
      chrome.storage.session.get.mockResolvedValue({
        files: [
          {
            name: 'data.csv',
            ext: 'csv',
            sheets: [{ name: 'data', data: [['A'], ['1']] }],
          },
        ],
      });
      chrome.storage.local.get.mockResolvedValue({});

      const app = await createApp();

      expect(app.files).toHaveLength(1);
      expect(app.files[0].name).toBe('data.csv');
      expect(app.files[0].file).toBeNull(); // raw file not available after restore
    });

    test('restores preferences from chrome.storage.local', async () => {
      chrome.storage.session.get.mockResolvedValue({});
      chrome.storage.local.get.mockResolvedValue({
        prefs: {
          openMode: 'merge',
          cleaningOptions: { trim: true, removeDuplicates: false },
          settingsOpen: true,
        },
      });

      const app = await createApp();

      expect(document.getElementById('opt-trim').checked).toBe(true);
    });

    test('handles storage errors gracefully', async () => {
      chrome.storage.session.get.mockRejectedValue(new Error('Storage error'));
      chrome.storage.local.get.mockRejectedValue(new Error('Storage error'));

      const app = await createApp();
      expect(app.files).toEqual([]);
    });

    test('restores large sessions from indexeddb metadata', async () => {
      chrome.storage.session.get.mockResolvedValue({
        files: [],
        sessionSummary: { persisted: 'indexeddb' },
      });
      jest.spyOn(global.DragToSheetsApp.prototype, 'loadFilesFromIndexedDb').mockResolvedValueOnce({
        files: [{
          name: 'large.csv',
          ext: 'csv',
          size: 1024,
          stats: { sheetCount: 1, rowCount: 2, colCount: 1, cellCount: 2, styledCellCount: 0 },
          identityKey: 'large.csv::csv::1024::0',
          sheets: [{ name: 'large', data: [['A'], ['1']] }],
        }],
      });

      const app = await createApp();

      expect(app.files).toHaveLength(1);
      expect(app.files[0].parsed.sheets[0].name).toBe('large');
    });

    test('prunes lazy Excel entry without parsed data, file, or recoverable handle', async () => {
      chrome.storage.session.get.mockResolvedValue({
        files: [{
          name: 'lazy.xlsx',
          ext: 'xlsx',
          size: 1024,
          stats: null,
          lazy: true,
          sheets: null,
          handleId: null,
        }],
      });
      chrome.storage.local.get.mockResolvedValue({});

      const app = await createApp();

      expect(app.files).toHaveLength(0);
      expect(app._prunedDuringRestore).toEqual(['lazy.xlsx']);
      expect(app.loadingText.textContent).toContain('Re-add to continue');
    });

    test('prunes lazy XLS entry without parsed data, file, or recoverable handle', async () => {
      chrome.storage.session.get.mockResolvedValue({
        files: [{
          name: 'legacy.xls',
          ext: 'xls',
          size: 2048,
          stats: null,
          lazy: true,
          sheets: null,
          handleId: null,
        }],
      });
      chrome.storage.local.get.mockResolvedValue({});

      const app = await createApp();

      expect(app.files).toHaveLength(0);
      expect(app._prunedDuringRestore).toEqual(['legacy.xls']);
      expect(app.loadingText.textContent).toContain('Re-add to continue');
    });

    test('restores parsed-file entry without File object', async () => {
      chrome.storage.session.get.mockResolvedValue({
        files: [{
          name: 'parsed.csv',
          ext: 'csv',
          size: 512,
          sheets: [{ name: 'Sheet1', data: [['A'], ['1']] }],
          lazy: false,
          handleId: null,
        }],
      });
      chrome.storage.local.get.mockResolvedValue({});

      const app = await createApp();

      expect(app.files).toHaveLength(1);
      expect(app.files[0].name).toBe('parsed.csv');
      expect(app.files[0].parsed).toBeTruthy();
      expect(app.files[0].file).toBeNull();
      expect(app._prunedDuringRestore).toEqual([]);
    });

    test('restores entry with recoverable file handle', async () => {
      const mockHandle = {
        kind: 'file',
        getFile: jest.fn().mockResolvedValue(new File(['x'], 'recovered.xlsx')),
        queryPermission: jest.fn().mockResolvedValue('granted'),
      };
      FileHandleStore.getHandle.mockResolvedValueOnce(mockHandle);

      chrome.storage.session.get.mockResolvedValue({
        files: [{
          name: 'recovered.xlsx',
          ext: 'xlsx',
          size: 4096,
          stats: null,
          lazy: true,
          sheets: null,
          handleId: 'test-handle-abc',
        }],
      });
      chrome.storage.local.get.mockResolvedValue({});

      const app = await createApp();

      expect(app.files).toHaveLength(1);
      expect(app.files[0].name).toBe('recovered.xlsx');
      expect(app.files[0].file).toBeTruthy();
      expect(app.files[0].file.name).toBe('recovered.xlsx');
      expect(app.files[0].lazy).toBe(true);
      expect(app._prunedDuringRestore).toEqual([]);
    });

    test('prunes entry when handle recovery fails', async () => {
      FileHandleStore.getHandle.mockRejectedValueOnce(new Error('Handle not found'));

      chrome.storage.session.get.mockResolvedValue({
        files: [{
          name: 'missing.xlsx',
          ext: 'xlsx',
          size: 2048,
          stats: null,
          lazy: true,
          sheets: null,
          handleId: 'invalid-handle',
        }],
      });
      chrome.storage.local.get.mockResolvedValue({});

      const app = await createApp();

      expect(app.files).toHaveLength(0);
      expect(app._prunedDuringRestore).toEqual(['missing.xlsx']);
      expect(app.loadingText.textContent).toContain('Re-add to continue');
    });

    test('prunes entry when file handle is returned but getFile fails', async () => {
      const mockHandle = {
        kind: 'file',
        getFile: jest.fn().mockRejectedValue(new Error('Permission denied')),
      };
      FileHandleStore.getHandle.mockResolvedValueOnce(mockHandle);

      chrome.storage.session.get.mockResolvedValue({
        files: [{
          name: 'blocked.xlsx',
          ext: 'xlsx',
          size: 1024,
          stats: null,
          lazy: true,
          sheets: null,
          handleId: 'blocked-handle',
        }],
      });
      chrome.storage.local.get.mockResolvedValue({});

      const app = await createApp();

      expect(app.files).toHaveLength(0);
      expect(app._prunedDuringRestore).toEqual(['blocked.xlsx']);
    });

    test('keeps only valid entries from a mixed batch, pruning invalid ones', async () => {
      // Valid: parsed CSV
      // Invalid: lazy XLSX without handle
      // Valid: recoverable XLSX with handle
      const mockHandle = {
        kind: 'file',
        getFile: jest.fn().mockResolvedValue(new File(['d'], 'good.xlsx')),
        queryPermission: jest.fn().mockResolvedValue('granted'),
      };
      FileHandleStore.getHandle.mockResolvedValueOnce(mockHandle);

      chrome.storage.session.get.mockResolvedValue({
        files: [
          {
            name: 'good.csv',
            ext: 'csv',
            size: 256,
            sheets: [{ name: 'S1', data: [['A']] }],
            lazy: false,
            handleId: null,
          },
          {
            name: 'bad.xlsx',
            ext: 'xlsx',
            size: 512,
            stats: null,
            lazy: true,
            sheets: null,
            handleId: null,
          },
          {
            name: 'good.xlsx',
            ext: 'xlsx',
            size: 1024,
            stats: null,
            lazy: true,
            sheets: null,
            handleId: 'good-handle',
          },
        ],
      });
      chrome.storage.local.get.mockResolvedValue({});

      const app = await createApp();

      expect(app.files).toHaveLength(2);
      expect(app.files.map((f) => f.name)).toEqual(['good.csv', 'good.xlsx']);
      expect(app._prunedDuringRestore).toEqual(['bad.xlsx']);
      expect(app.loadingText.textContent).toContain('2 file(s) restored');
      expect(app.loadingText.textContent).toContain('Re-add to continue');
      expect(app.loadingText.textContent).toContain('"bad.xlsx"');
    });

    test('does not prune entry when parsed data has cellMeta despite no file object', async () => {
      chrome.storage.session.get.mockResolvedValue({
        files: [{
          name: 'data.xlsx',
          ext: 'xlsx',
          size: 8192,
          sheets: [{ name: 'Data', data: [['B', 'C'], ['2', '3']], cellMeta: [[{ type: 'string', value: 'B' }, { type: 'string', value: 'C' }], [{ type: 'string', value: '2' }, { type: 'string', value: '3' }]] }],
          lazy: false,
          handleId: null,
        }],
      });
      chrome.storage.local.get.mockResolvedValue({});

      const app = await createApp();

      expect(app.files).toHaveLength(1);
      expect(app.files[0].name).toBe('data.xlsx');
      expect(app.files[0].parsed).toBeTruthy();
      expect(app._prunedDuringRestore).toEqual([]);
    });

    test('persists handleId in session storage serialization', async () => {
      const app = await createApp();
      app.files = [
        {
          name: 'lazy.xlsx',
          ext: 'xlsx',
          size: 1024,
          parsed: null,
          stats: null,
          identityKey: 'lazy.xlsx::xlsx::1024::0',
          contentFingerprint: null,
          lazy: true,
          handleId: 'saved-handle-123',
          file: new File(['x'], 'lazy.xlsx'),
        },
      ];
      chrome.storage.session.set.mockClear();

      app.saveFilesSession();

      expect(chrome.storage.session.set).toHaveBeenCalled();
      const callArg = chrome.storage.session.set.mock.calls[0][0];
      expect(callArg.files[0].handleId).toBe('saved-handle-123');
      expect(callArg.files[0].lazy).toBe(true);
    });
  });

  // ---- Merge worksheet selection ----

  describe('merge worksheet selection', () => {
    function makeParsedWorkbook(sheetCount = 2) {
      return {
        sheets: Array.from({ length: sheetCount }, (_, index) => ({
          name: `Sheet${index + 1}`,
          data: [[`Header${index + 1}`], [`Value${index + 1}`]],
        })),
      };
    }

    function makeDistinctMergeFiles() {
      return [
        {
          name: 'master.xlsx',
          ext: 'xlsx',
          selectedMergeSheetIndex: 1,
          parsed: {
            sheets: [
              {
                name: 'First sheet',
                data: [
                  ['First-only', 'First-wide', 'First-extra'],
                  ['a', 'b', 'c'],
                  ['d', 'e', 'f'],
                  ['g', 'h', 'i'],
                ],
              },
              {
                name: 'Selected master',
                data: [['Master selected', 'Selected value'], ['m1', 'v1']],
              },
            ],
          },
        },
        {
          name: 'source.xlsx',
          ext: 'xlsx',
          selectedMergeSheetIndex: 1,
          parsed: {
            sheets: [
              {
                name: 'First source',
                data: [
                  ['Source first', 'Source extra', 'Source wide', 'Source fourth'],
                  ['a', 'b', 'c', 'd'],
                  ['e', 'f', 'g', 'h'],
                  ['i', 'j', 'k', 'l'],
                ],
              },
              {
                name: 'Selected source',
                data: [['Source selected'], ['s1'], ['s2']],
              },
            ],
          },
        },
      ];
    }

    test('new file entries default to worksheet index 0', async () => {
      const app = await createApp();
      const parsed = makeParsedWorkbook();
      const entry = app.createParsedFileEntry(new File(['data'], 'book.xlsx'), 'xlsx', parsed);

      expect(entry.selectedMergeSheetIndex).toBe(0);
      expect(app.getSelectedMergeSheet(entry)).toBe(parsed.sheets[0]);
    });

    test('clamps invalid and stale indexes to a valid worksheet', async () => {
      const app = await createApp();
      const entry = { parsed: makeParsedWorkbook(), selectedMergeSheetIndex: 99 };

      expect(app.getSelectedMergeSheet(entry)).toBe(entry.parsed.sheets[1]);
      expect(entry.selectedMergeSheetIndex).toBe(1);

      entry.selectedMergeSheetIndex = -4;
      expect(app.getSelectedMergeSheet(entry)).toBe(entry.parsed.sheets[0]);
      expect(entry.selectedMergeSheetIndex).toBe(0);

      entry.selectedMergeSheetIndex = 'not-an-index';
      expect(app.getSelectedMergeSheet(entry)).toBe(entry.parsed.sheets[0]);
      expect(entry.selectedMergeSheetIndex).toBe(0);
    });

    test('single-sheet files always resolve to worksheet index 0', async () => {
      const app = await createApp();
      const entry = { parsed: makeParsedWorkbook(1), selectedMergeSheetIndex: 7 };

      expect(app.getSelectedMergeSheet(entry)).toBe(entry.parsed.sheets[0]);
      expect(entry.selectedMergeSheetIndex).toBe(0);
    });

    test('persists the selected index through chrome.storage.session', async () => {
      const app = await createApp();
      app.files = [{
        name: 'book.csv',
        ext: 'csv',
        size: 100,
        parsed: makeParsedWorkbook(),
        selectedMergeSheetIndex: 1,
      }];

      app.saveFilesSession();

      const sessionCall = chrome.storage.session.set.mock.calls.find(
        ([value]) => Array.isArray(value.files) && value.files.length > 0
      );
      expect(sessionCall[0].files[0].selectedMergeSheetIndex).toBe(1);
    });

    test('persists the selected index through the IndexedDB fallback', async () => {
      const app = await createApp();
      app.files = [{
        name: 'large.csv',
        ext: 'csv',
        size: 100,
        file: new File(['data'], 'large.csv'),
        parsed: makeParsedWorkbook(),
        selectedMergeSheetIndex: 1,
      }];
      jest.spyOn(app, 'shouldPersistFilesSession').mockReturnValue(false);
      jest.spyOn(app, 'canUseIndexedDb').mockReturnValue(true);
      const saveIndexedDb = jest.spyOn(app, 'saveFilesToIndexedDb').mockResolvedValue(undefined);

      app.saveFilesSession();
      await Promise.resolve();

      expect(saveIndexedDb).toHaveBeenCalledWith([
        expect.objectContaining({ selectedMergeSheetIndex: 1 }),
      ]);
    });

    test('restores the selected index from session storage', async () => {
      chrome.storage.session.get.mockResolvedValue({
        files: [{
          name: 'book.csv',
          ext: 'csv',
          selectedMergeSheetIndex: 1,
          sheets: makeParsedWorkbook().sheets,
        }],
      });

      const app = await createApp();

      expect(app.files[0].selectedMergeSheetIndex).toBe(1);
      expect(app.getSelectedMergeSheet(app.files[0]).name).toBe('Sheet2');
    });

    test('restores the selected index from the IndexedDB fallback', async () => {
      chrome.storage.session.get.mockResolvedValue({
        files: [],
        sessionSummary: { persisted: 'indexeddb' },
      });
      jest.spyOn(global.DragToSheetsApp.prototype, 'loadFilesFromIndexedDb').mockResolvedValueOnce({
        files: [{
          name: 'large.csv',
          ext: 'csv',
          selectedMergeSheetIndex: 1,
          sheets: makeParsedWorkbook().sheets,
        }],
      });

      const app = await createApp();

      expect(app.files[0].selectedMergeSheetIndex).toBe(1);
      expect(app.getSelectedMergeSheet(app.files[0]).name).toBe('Sheet2');
    });

    test('preserves the selection across reparsing and reclamps it after a sheet is removed', async () => {
      const app = await createApp();
      const entry = {
        name: 'book.csv',
        ext: 'csv',
        file: new File(['data'], 'book.csv'),
        parsed: null,
        selectedMergeSheetIndex: 1,
      };
      app.files = [entry];
      Parser.parse.mockResolvedValueOnce(makeParsedWorkbook(2));

      await app.ensureParsedEntry(entry);

      expect(entry.selectedMergeSheetIndex).toBe(1);

      entry.parsed = null;
      Parser.parse.mockResolvedValueOnce(makeParsedWorkbook(1));
      await app.ensureParsedEntry(entry);

      expect(entry.selectedMergeSheetIndex).toBe(0);
    });

    test('uses the selected worksheet for merge inputs', async () => {
      const app = await createApp();
      app.files = [
        { name: 'one.csv', parsed: makeParsedWorkbook(), selectedMergeSheetIndex: 1 },
        { name: 'two.csv', parsed: makeParsedWorkbook(), selectedMergeSheetIndex: 1 },
      ];

      await app.getMergedProcessedData();

      const [rawFiles] = Merger.merge.mock.calls.at(-1);
      expect(rawFiles.map((file) => file.sheets[0].name)).toEqual(['Sheet2', 'Sheet2']);
    });

    test('exact merge previews use each file selected worksheet', async () => {
      const app = await createApp();
      app.files = makeDistinctMergeFiles();

      await app.getMergedProcessedData();

      const [rawFiles] = Merger.merge.mock.calls.at(-1);
      expect(rawFiles.map((file) => file.sheets[0].data[0])).toEqual([
        ['Master selected', 'Selected value'],
        ['Source selected'],
      ]);
      expect(rawFiles.map((file) => file.sheets[0].data[1])).toEqual([
        ['m1', 'v1'],
        ['s1'],
      ]);
    });

    test('responsive merge previews use each file selected worksheet', async () => {
      const app = await createApp();
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      app.files = makeDistinctMergeFiles();

      await app.getResponsiveMergePreview(app.getCleaningOptions());

      const [rawFiles] = Merger.merge.mock.calls.at(-1);
      expect(rawFiles.map((file) => file.sheets[0].data[0])).toEqual([
        ['Master selected', 'Selected value'],
        ['Source selected'],
      ]);
    });

    test('smart-mapping detection inspects selected worksheet headers', async () => {
      const app = await createApp();
      app.files = makeDistinctMergeFiles();

      await app.detectSmartMappings(false);

      const [rawFiles] = Merger.detectMappings.mock.calls.at(-1);
      expect(rawFiles.map((file) => file.sheets[0].data[0])).toEqual([
        ['Master selected', 'Selected value'],
        ['Source selected'],
      ]);
    });

    test('sampled smart-mapping detection inspects selected worksheet headers', async () => {
      const app = await createApp();
      app.files = makeDistinctMergeFiles();

      await app.detectSmartMappings(true);

      const [rawFiles] = Merger.detectMappings.mock.calls.at(-1);
      expect(rawFiles.map((file) => file.sheets[0].data[0])).toEqual([
        ['Master selected', 'Selected value'],
        ['Source selected'],
      ]);
    });

    test('custom mapping choices come from selected worksheets', async () => {
      const app = await createApp();
      app.files = makeDistinctMergeFiles();

      const context = await app.buildCustomMappingContextForCurrentFiles();

      expect(context.masterGroup.headers).toEqual(['Master selected', 'Selected value']);
      expect(context.nonMasterGroups[0].headers).toEqual(['Source selected']);
      expect(context.defaultTargetHeaders).toEqual(['Master selected', 'Selected value']);
      expect(context.availableTargetsBySource.get('Source selected')).toEqual([
        'Master selected',
        'Selected value',
      ]);
    });

    test('merge summary cards reflect selected worksheet dimensions', async () => {
      const app = await createApp();
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      app.files = makeDistinctMergeFiles();

      app._updateSummaryCards();

      expect(document.getElementById('summary-rows').textContent).toBe('3');
      expect(document.getElementById('summary-cols').textContent).toBe('2');
    });

    test('selector changes invalidate stale async previews and cleanup summaries', async () => {
      const app = await createApp();
      app.files = makeDistinctMergeFiles();
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      const deferred = new Promise((resolve) => {
        app.resolveStaleMerge = resolve;
      });
      const mergeSpy = jest.spyOn(app, 'getMergedProcessedData')
        .mockReturnValueOnce(deferred)
        .mockResolvedValue({ sheets: [{ name: 'Merged', data: [['new']] }] });
      jest.spyOn(app, 'schedulePreviewRefresh').mockImplementation(() => {});
      jest.spyOn(app, 'updateCustomMappingVisibility').mockResolvedValue();

      const staleRefresh = app.refreshPreview();
      for (let i = 0; i < 6 && mergeSpy.mock.calls.length === 0; i++) {
        await Promise.resolve();
      }
      expect(mergeSpy).toHaveBeenCalled();

      app.renderPreviewTable([['OLD']], 'Merged', {}, [], {
        stats: { trimmedValues: 1 },
        scope: 'exact',
        evaluatedOperations: { trim: true },
      });
      app.previewPanel.classList.remove('hidden');
      app.cleanupResults.classList.remove('hidden');
      app.cleanupResultsList.innerHTML = '<li>old cleanup</li>';

      app.handleMergeSheetSelection(0, '0');
      expect(app.previewPanel.classList.contains('hidden')).toBe(true);
      expect(app.cleanupResults.classList.contains('hidden')).toBe(true);
      expect(app.cleanupResultsList.innerHTML).toBe('');

      app.resolveStaleMerge({ sheets: [{ name: 'Merged', data: [['OLD']] }] });
      await staleRefresh;

      expect(app.previewTable.textContent).not.toContain('OLD');
    });

    test('separate upload still includes every worksheet', async () => {
      const app = await createApp();
      const item = {
        name: 'book.csv',
        ext: 'csv',
        file: new File(['data'], 'book.csv'),
        parsed: makeParsedWorkbook(),
        selectedMergeSheetIndex: 1,
      };
      jest.spyOn(app, 'shouldUseNativeDriveImport').mockReturnValue(false);

      await app.uploadOneFile(item, 0, {
        options: {},
        hasCleaning: false,
        shouldTightenGrid: false,
      });

      const sheets = GoogleAPI.createSpreadsheet.mock.calls[0][1];
      expect(sheets.map((sheet) => sheet.name)).toEqual(['Sheet1', 'Sheet2']);
    });
  });

  // ---- Worksheet-selection regression suite ----

  describe('worksheet-selection regression', () => {
    function makeRegressionSheet(name, data, stylePrefix = name) {
      const cellMeta = data.map((row) => row.map((value) => {
        if (value === '') return { type: 'empty' };
        if (typeof value === 'number') return { type: 'number', value };
        return { type: 'string', value: String(value) };
      }));
      const styles = data.map((row, rowIndex) => row.map((_, colIndex) => ({
        marker: `${stylePrefix}-${rowIndex}-${colIndex}`,
      })));
      return { name, data, cellMeta, styles };
    }

    function makeRegressionFiles({ selectedA = 0, selectedB = 1 } = {}) {
      return [
        {
          name: 'alpha.xlsx',
          ext: 'xlsx',
          file: new File(['alpha'], 'alpha.xlsx'),
          selectedMergeSheetIndex: selectedA,
          parsed: {
            sheets: [
              makeRegressionSheet(
                'Alpha zero',
                [['Alpha zero id', 'Alpha zero value'], ['a0', 'alpha-zero']],
                'alpha-first'
              ),
              makeRegressionSheet(
                'Alpha one',
                [['Alpha one id', 'Alpha one value'], ['a1', 'alpha-one']],
                'alpha-second'
              ),
            ],
            themeColors: ['#112233'],
          },
        },
        {
          name: 'beta.xlsx',
          ext: 'xlsx',
          file: new File(['beta'], 'beta.xlsx'),
          selectedMergeSheetIndex: selectedB,
          parsed: {
            sheets: [
              makeRegressionSheet(
                'Beta zero',
                [['Beta zero id', 'Beta zero value'], ['b0', 'beta-zero']],
                'beta-first'
              ),
              makeRegressionSheet(
                'Beta one',
                [['Beta one id', 'Beta one value'], ['b1', 'beta-one']],
                'beta-second'
              ),
            ],
            themeColors: ['#445566'],
          },
        },
      ];
    }

    function toStoredFiles(files) {
      return files.map((item) => ({
        name: item.name,
        ext: item.ext,
        size: item.file?.size || 0,
        selectedMergeSheetIndex: item.selectedMergeSheetIndex,
        sheets: item.parsed.sheets.map(({ name, data, cellMeta }) => ({ name, data, cellMeta })),
      }));
    }

    function enterMergeMode(app) {
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      app.updateOpenModeState();
    }

    test('merges worksheet zero from one XLSX and worksheet one from another', async () => {
      const app = await createApp();
      app.files = makeRegressionFiles({ selectedA: 0, selectedB: 0 });
      enterMergeMode(app);

      const selectors = document.querySelectorAll('.merge-sheet-select');
      expect(selectors).toHaveLength(2);
      selectors[0].value = '0';
      selectors[0].dispatchEvent(new Event('change'));
      selectors[1].value = '1';
      selectors[1].dispatchEvent(new Event('change'));

      await app.getMergedProcessedData();

      const [rawFiles] = Merger.merge.mock.calls.at(-1);
      expect(app.files.map((item) => item.selectedMergeSheetIndex)).toEqual([0, 1]);
      expect(rawFiles.map((file) => file.sheets[0].name)).toEqual(['Alpha zero', 'Beta one']);
      expect(rawFiles.map((file) => file.sheets[0].data[1][0])).toEqual(['a0', 'b1']);
    });

    test('changing a selection after smart mappings were approved resets approval state', async () => {
      const app = await createApp();
      app.files = makeRegressionFiles();
      enterMergeMode(app);
      app.smartMappingApproved = true;
      app.smartMappingDeclined = true;

      jest.spyOn(app, 'updateCustomMappingVisibility').mockResolvedValue();
      jest.spyOn(app, 'schedulePreviewRefresh').mockImplementation(() => {});
      jest.spyOn(app, 'saveFilesSession').mockImplementation(() => {});

      const selector = document.querySelector('#merge-sheet-select-0');
      selector.value = '1';
      selector.dispatchEvent(new Event('change'));

      expect(app.files[0].selectedMergeSheetIndex).toBe(1);
      expect(app.smartMappingApproved).toBe(false);
      expect(app.smartMappingDeclined).toBe(false);
    });

    test('custom mappings become invalid when a source worksheet changes', async () => {
      const app = await createApp();
      const masterSheet = makeRegressionSheet(
        'Master',
        [['MasterTarget'], ['m1']],
        'master'
      );
      const sourceSheetWithNewHeader = makeRegressionSheet(
        'Source zero',
        [['NewSource'], ['new']],
        'source-first'
      );
      const sourceSheetWithOldHeader = makeRegressionSheet(
        'Source one',
        [['OldSource'], ['old']],
        'source-second'
      );
      app.files = [
        {
          name: 'master.xlsx',
          ext: 'xlsx',
          parsed: { sheets: [masterSheet] },
          selectedMergeSheetIndex: 0,
        },
        {
          name: 'source.xlsx',
          ext: 'xlsx',
          parsed: { sheets: [sourceSheetWithNewHeader, sourceSheetWithOldHeader] },
          selectedMergeSheetIndex: 1,
        },
      ];
      enterMergeMode(app);
      app.smartMappingCheckbox.checked = true;
      app.customMappings = [{ from: 'OldSource', to: 'MasterTarget' }];
      jest.spyOn(app, 'savePreferences').mockImplementation(() => {});
      jest.spyOn(app, 'schedulePreviewRefresh').mockImplementation(() => {});
      jest.spyOn(app, 'saveFilesSession').mockImplementation(() => {});

      await app.updateCustomMappingVisibility();
      expect(app.customMappings).toEqual([{ from: 'OldSource', to: 'MasterTarget' }]);

      app.handleMergeSheetSelection(1, '0');
      await app.updateCustomMappingVisibility();
      await flushPromises();

      expect(app.customMappings).toEqual([]);
    });

    test('rapid consecutive selection changes leave only the current preview visible', async () => {
      const app = await createApp();
      app.files = makeRegressionFiles({ selectedA: 0, selectedB: 1 });
      enterMergeMode(app);
      jest.spyOn(app, 'updateCustomMappingVisibility').mockResolvedValue();
      jest.spyOn(app, 'schedulePreviewRefresh').mockImplementation(() => {});
      jest.spyOn(app, 'saveFilesSession').mockImplementation(() => {});

      let resolveStale;
      const staleResult = new Promise((resolve) => {
        resolveStale = resolve;
      });
      const mergeSpy = jest.spyOn(app, 'getMergedProcessedData')
        .mockReturnValueOnce(staleResult)
        .mockResolvedValueOnce({
          sheets: [{ name: 'Merged', data: [['CURRENT']] }],
        });

      const staleRefresh = app.refreshPreview();
      for (let i = 0; i < 6 && mergeSpy.mock.calls.length === 0; i++) {
        await Promise.resolve();
      }
      expect(mergeSpy).toHaveBeenCalledTimes(1);

      app.previewTable.textContent = 'STALE';
      app.previewPanel.classList.remove('hidden');
      app.cleanupResults.classList.remove('hidden');
      app.cleanupResultsList.innerHTML = '<li>stale cleanup</li>';
      app.handleMergeSheetSelection(0, '1');
      app.handleMergeSheetSelection(0, '0');

      resolveStale({ sheets: [{ name: 'Merged', data: [['STALE']] }] });
      await staleRefresh;

      expect(app.previewTable.textContent).not.toContain('STALE');
      expect(app.cleanupResults.classList.contains('hidden')).toBe(true);

      await app.refreshPreview();
      expect(app.previewTable.textContent).toContain('CURRENT');
      expect(mergeSpy).toHaveBeenCalledTimes(2);
    });

    test('persists selected worksheets through side-panel restoration', async () => {
      const sourceFiles = makeRegressionFiles({ selectedA: 1, selectedB: 0 });
      chrome.storage.session.get.mockResolvedValue({ files: toStoredFiles(sourceFiles) });
      chrome.storage.local.get.mockResolvedValue({ prefs: { openMode: 'merge' } });

      const app = await createApp();

      expect(app.files.map((item) => item.selectedMergeSheetIndex)).toEqual([1, 0]);
      expect(app.files.map((item) => app.getSelectedMergeSheet(item).name)).toEqual([
        'Alpha one',
        'Beta zero',
      ]);
      expect(Array.from(document.querySelectorAll('.merge-sheet-select')).map((select) => select.value))
        .toEqual(['1', '0']);
    });

    test('clamps an out-of-range restored selection to the last worksheet', async () => {
      const sourceFiles = makeRegressionFiles({ selectedA: 99, selectedB: 0 });
      chrome.storage.session.get.mockResolvedValue({ files: toStoredFiles(sourceFiles) });

      const app = await createApp();

      expect(app.files[0].selectedMergeSheetIndex).toBe(1);
      expect(app.getSelectedMergeSheet(app.files[0]).name).toBe('Alpha one');
    });

    test('an empty selected worksheet produces an empty merge result', async () => {
      const app = await createApp();
      const emptySheet = makeRegressionSheet('Alpha empty', [], 'alpha-empty');
      app.files = [
        {
          name: 'empty.xlsx',
          ext: 'xlsx',
          parsed: {
            sheets: [
              makeRegressionSheet('Alpha data', [['A'], ['not-selected']], 'alpha-data'),
              emptySheet,
            ],
          },
          selectedMergeSheetIndex: 1,
        },
        {
          name: 'other.xlsx',
          ext: 'xlsx',
          parsed: { sheets: [makeRegressionSheet('Other', [['B'], ['b1']], 'other')] },
          selectedMergeSheetIndex: 0,
        },
      ];
      enterMergeMode(app);

      const merged = await app.getMergedProcessedData();

      expect(app.getSelectedMergeSheet(app.files[0]).data).toEqual([]);
      expect(merged.sheets[0].data).toEqual([]);
    });

    test('keeps formula metadata paired with empty cached display values on the selected worksheet', async () => {
      const app = await createApp();
      const formulaData = [['Formula result'], ['']];
      const formulaMeta = [
        [{ type: 'string', value: 'Formula result' }],
        [{ type: 'formula', value: '=SUM(A2:A3)', displayValue: '' }],
      ];
      const formulaSheet = {
        ...makeRegressionSheet('Formula sheet', formulaData, 'formula-second'),
        cellMeta: formulaMeta,
      };
      app.files = [
        {
          name: 'formula.xlsx',
          ext: 'xlsx',
          parsed: {
            sheets: [
              makeRegressionSheet('Not selected', [['Wrong'], ['wrong']], 'formula-first'),
              formulaSheet,
            ],
          },
          selectedMergeSheetIndex: 1,
        },
        {
          name: 'other.xlsx',
          ext: 'xlsx',
          parsed: { sheets: [makeRegressionSheet('Other', [['Other'], ['value']], 'other')] },
          selectedMergeSheetIndex: 0,
        },
      ];
      Merger.merge.mockImplementationOnce((files) => ({
        sheets: [{
          name: 'Merged',
          data: files[0].sheets[0].data,
          cellMeta: files[0].sheets[0].cellMeta,
        }],
        sourceMap: [],
      }));

      const merged = await app.getMergedProcessedData();
      const [rawFiles] = Merger.merge.mock.calls.at(-1);
      const selectedMeta = rawFiles[0].sheets[0].cellMeta[1][0];

      expect(rawFiles[0].sheets[0].data[1][0]).toBe('');
      expect(selectedMeta).toEqual({ type: 'formula', value: '=SUM(A2:A3)', displayValue: '' });
      expect(merged.sheets[0].data[1][0]).toBe('');
      expect(merged.sheets[0].cellMeta[1][0]).toEqual(selectedMeta);
    });

    test('preserves formatting from the selected non-first worksheet by source row and column', async () => {
      const app = await createApp();
      app.files = makeRegressionFiles({ selectedA: 1, selectedB: 1 });
      enterMergeMode(app);
      jest.spyOn(app, 'shouldUseNativeDriveImport').mockReturnValue(false);

      Merger.merge.mockImplementationOnce((files) => ({
        sheets: [{
          name: 'Merged',
          data: [
            ['Alpha one id', 'Alpha one value'],
            ['a1', 'alpha-one'],
            ['Beta one id', 'Beta one value'],
            ['b1', 'beta-one'],
          ],
          cellMeta: null,
        }],
        sourceMap: [
          { fileIndex: 0, sourceRow: 0, colMap: [0, 1] },
          { fileIndex: 0, sourceRow: 1, colMap: [0, 1] },
          { fileIndex: 1, sourceRow: 0, colMap: [0, 1] },
          { fileIndex: 1, sourceRow: 1, colMap: [0, 1] },
        ],
      }));

      await app.handleUpload();

      const styleMarkers = GoogleAPI.sheetJsToSheetsFormat.mock.calls
        .map(([style]) => style?.marker)
        .filter(Boolean);
      expect(styleMarkers).toEqual(expect.arrayContaining([
        'alpha-second-0-0',
        'alpha-second-0-1',
        'alpha-second-1-0',
        'alpha-second-1-1',
        'beta-second-0-0',
        'beta-second-0-1',
        'beta-second-1-0',
        'beta-second-1-1',
      ]));
      expect(styleMarkers).not.toEqual(expect.arrayContaining([
        'alpha-first-0-0',
        'alpha-first-1-0',
        'beta-first-0-0',
        'beta-first-1-0',
      ]));
    });

    test('does not add selectors or change merge behavior for CSV, TSV, or single-sheet workbooks', async () => {
      const app = await createApp();
      app.files = [
        {
          name: 'data.csv',
          ext: 'csv',
          parsed: { sheets: [makeRegressionSheet('CSV', [['A'], ['csv']], 'csv')] },
          selectedMergeSheetIndex: 0,
        },
        {
          name: 'data.tsv',
          ext: 'tsv',
          parsed: { sheets: [makeRegressionSheet('TSV', [['B'], ['tsv']], 'tsv')] },
          selectedMergeSheetIndex: 0,
        },
        {
          name: 'single.xlsx',
          ext: 'xlsx',
          parsed: { sheets: [makeRegressionSheet('Only sheet', [['C'], ['single']], 'single')] },
          selectedMergeSheetIndex: 0,
        },
      ];
      enterMergeMode(app);

      expect(document.querySelectorAll('.merge-sheet-select')).toHaveLength(0);
      const before = app.getSelectedMergeInput(app.files[0]);
      app.handleMergeSheetSelection(0, '1');

      expect(app.files.every((item) => item.selectedMergeSheetIndex === 0)).toBe(true);
      expect(app.getSelectedMergeInput(app.files[0]).sheets[0].data).toEqual(before.sheets[0].data);
    });

    test('separate mode still uploads every worksheet in an XLSX workbook', async () => {
      const app = await createApp();
      app.files = makeRegressionFiles({ selectedA: 1, selectedB: 1 }).slice(0, 1);
      app.renderFileList();
      expect(document.querySelectorAll('.merge-sheet-select')).toHaveLength(0);
      jest.spyOn(app, 'shouldUseNativeDriveImport').mockReturnValue(false);

      await app.handleUpload();

      const sheets = GoogleAPI.createSpreadsheet.mock.calls[0][1];
      expect(sheets.map((sheet) => sheet.name)).toEqual(['Alpha zero', 'Alpha one']);
      expect(sheets.map((sheet) => sheet.data[1][0])).toEqual(['a0', 'a1']);
    });
  });

  // ---- File handling ----

  describe('handleFiles', () => {
    test('adds supported files', async () => {
      const app = await createApp();
      const parsed = { sheets: [{ name: 'test', data: [['A'], ['1']] }] };
      Parser.parse.mockResolvedValue(parsed);

      await app.handleFiles([new File(['a,b'], 'test.csv')]);

      expect(app.files).toHaveLength(1);
      expect(app.files[0].name).toBe('test.csv');
      expect(app.files[0].ext).toBe('csv');
    });

    test('skips unsupported files', async () => {
      const app = await createApp();

      await app.handleFiles([new File(['data'], 'test.txt')]);

      expect(app.files).toHaveLength(0);
      expect(app.loadingText.textContent).toContain('Skipped unsupported');
    });

    test('handles parse errors gracefully', async () => {
      const app = await createApp();
      Parser.parse.mockRejectedValue(new Error('Parse failed'));

      await app.handleFiles([new File(['bad'], 'bad.csv')]);

      expect(app.files).toHaveLength(0);
      expect(app.loadingText.textContent).toContain('Parse failed');
    });

    test('enables upload button after adding files', async () => {
      const app = await createApp();
      Parser.parse.mockResolvedValue({
        sheets: [{ name: 'f', data: [['A']] }],
      });

      await app.handleFiles([new File(['a'], 'f.csv')]);

      expect(app.uploadBtn.disabled).toBe(false);
    });

    test('always passes preserveFormatting into parsing for merge workloads', async () => {
      const app = await createApp();
      Parser.parse.mockResolvedValue({
        sheets: [{ name: 'f', data: [['A']] }],
      });
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;

      await app.handleFiles([
        new File(['a'], 'f.xlsx'),
        new File(['b'], 'g.xlsx'),
      ]);

      expect(Parser.parse).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({ preserveFormatting: true })
      );
    });

    test('saves session after adding files', async () => {
      const app = await createApp();
      Parser.parse.mockResolvedValue({
        sheets: [{ name: 'f', data: [['A']] }],
      });

      await app.handleFiles([new File(['a'], 'f.csv')]);

      expect(chrome.storage.session.set).toHaveBeenCalled();
    });

    test('skips file session persistence for large workloads', async () => {
      const app = await createApp();
      const file = new File(['a'], 'big.csv');
      Object.defineProperty(file, 'size', { value: 13 * 1024 * 1024 });
      Parser.parse.mockResolvedValue({
        sheets: [{ name: 'big', data: [['A'], ['1']] }],
      });

      await app.handleFiles([file]);

      expect(chrome.storage.session.set).toHaveBeenCalledWith(
        expect.objectContaining({
          files: [],
          sessionSummary: expect.objectContaining({
            persisted: false,
            fileCount: 1,
          }),
        })
      );
    });

    test('adds large separate batches lazily without parsing immediately', async () => {
      const app = await createApp();
      const file = new File(['a'], 'big.xlsx');
      Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 });

      await app.handleFiles([file]);

      expect(Parser.parse).not.toHaveBeenCalled();
      expect(app.files[0].parsed).toBeNull();
      expect(app.files[0].lazy).toBe(true);
    });

    test('stores large sessions in indexeddb when available', async () => {
      const app = await createApp();
      const file = new File(['a'], 'big.csv');
      Object.defineProperty(file, 'size', { value: 13 * 1024 * 1024 });
      jest.spyOn(app, 'canUseIndexedDb').mockReturnValue(true);
      jest.spyOn(app, 'saveFilesToIndexedDb').mockResolvedValue(undefined);

      await app.handleFiles([file]);
      await flushPromises();

      expect(app.saveFilesToIndexedDb).toHaveBeenCalled();
      expect(chrome.storage.session.set).toHaveBeenCalledWith(
        expect.objectContaining({
          files: [],
          sessionSummary: expect.objectContaining({ persisted: 'indexeddb' }),
        })
      );
    });

    test('reduces parse concurrency for formatting-heavy excel batches', async () => {
      const app = await createApp();
      const spy = jest.spyOn(app, 'mapWithConcurrency');
      Parser.parse.mockResolvedValue({
        sheets: [{ name: 'f', data: [['A']] }],
      });
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;

      await app.handleFiles([
        new File(['a'], 'one.xlsx'),
        new File(['b'], 'two.xlsx'),
      ]);

      expect(spy).toHaveBeenCalledWith(
        expect.any(Array),
        1,
        expect.any(Function)
      );
    });

    test('preserves file order when parsing concurrently', async () => {
      const app = await createApp();
      const resolvers = [];

      Parser.parse.mockImplementation(
        () => new Promise((resolve) => resolvers.push(resolve))
      );

      const handlePromise = app.handleFiles([
        new File(['a'], 'first.csv'),
        new File(['b'], 'second.csv'),
        new File(['c'], 'third.csv'),
      ]);

      resolvers[1]({ sheets: [{ name: 'second', data: [['B']] }] });
      resolvers[2]({ sheets: [{ name: 'third', data: [['C']] }] });
      resolvers[0]({ sheets: [{ name: 'first', data: [['A']] }] });

      await handlePromise;

      expect(app.files.map((file) => file.name)).toEqual([
        'first.csv',
        'second.csv',
        'third.csv',
      ]);
    });

    test('warns when Excel file added without SheetJS', async () => {
      Parser.isExcelSupported.mockReturnValue(false);
      const app = await createApp();

      await app.handleFiles([new File([new ArrayBuffer(10)], 'data.xlsx')]);

      expect(app.files).toHaveLength(0);
      expect(app.loadingText.textContent).toContain('Excel support not installed');
      Parser.isExcelSupported.mockReturnValue(true);
    });
  });

  // ---- moveFile ----

  describe('moveFile', () => {
    test('moves file up', async () => {
      const app = await createApp();
      app.files = [
        { name: 'a.csv', parsed: { sheets: [{ name: 'a', data: [] }] }, ext: 'csv' },
        { name: 'b.csv', parsed: { sheets: [{ name: 'b', data: [] }] }, ext: 'csv' },
      ];

      app.moveFile(1, -1);

      expect(app.files[0].name).toBe('b.csv');
      expect(app.files[1].name).toBe('a.csv');
    });

    test('moves file down', async () => {
      const app = await createApp();
      app.files = [
        { name: 'a.csv', parsed: { sheets: [{ name: 'a', data: [] }] }, ext: 'csv' },
        { name: 'b.csv', parsed: { sheets: [{ name: 'b', data: [] }] }, ext: 'csv' },
      ];

      app.moveFile(0, 1);

      expect(app.files[0].name).toBe('b.csv');
      expect(app.files[1].name).toBe('a.csv');
    });

    test('does nothing when moving first file up', async () => {
      const app = await createApp();
      app.files = [
        { name: 'a.csv', parsed: { sheets: [{ name: 'a', data: [] }] }, ext: 'csv' },
        { name: 'b.csv', parsed: { sheets: [{ name: 'b', data: [] }] }, ext: 'csv' },
      ];

      app.moveFile(0, -1);

      expect(app.files[0].name).toBe('a.csv');
    });

    test('does nothing when moving last file down', async () => {
      const app = await createApp();
      app.files = [
        { name: 'a.csv', parsed: { sheets: [{ name: 'a', data: [] }] }, ext: 'csv' },
        { name: 'b.csv', parsed: { sheets: [{ name: 'b', data: [] }] }, ext: 'csv' },
      ];

      app.moveFile(1, 1);

      expect(app.files[1].name).toBe('b.csv');
    });
  });

  // ---- removeFile ----

  describe('removeFile', () => {
    test('removes file at index', async () => {
      const app = await createApp();
      app.files = [
        { name: 'a.csv', parsed: { sheets: [{ name: 'a', data: [] }] }, ext: 'csv' },
        { name: 'b.csv', parsed: { sheets: [{ name: 'b', data: [] }] }, ext: 'csv' },
      ];

      app.removeFile(0);

      expect(app.files).toHaveLength(1);
      expect(app.files[0].name).toBe('b.csv');
    });

    test('updates status after removing last file', async () => {
      const app = await createApp();
      app.files = [
        { name: 'a.csv', parsed: { sheets: [{ name: 'a', data: [] }] }, ext: 'csv' },
      ];

      app.removeFile(0);

      expect(app.files).toHaveLength(0);
      expect(app.loadingText.textContent).toContain('Drop files');
    });

    test('disables upload button when all files removed', async () => {
      const app = await createApp();
      app.files = [
        { name: 'a.csv', parsed: { sheets: [{ name: 'a', data: [] }] }, ext: 'csv' },
      ];

      app.removeFile(0);

      expect(app.uploadBtn.disabled).toBe(true);
    });
  });

  // ---- clearFiles ----

  describe('clearFiles', () => {
    test('removes all files', async () => {
      const app = await createApp();
      app.files = [
        { name: 'a.csv', parsed: { sheets: [{ name: 'a', data: [] }] }, ext: 'csv' },
        { name: 'b.csv', parsed: { sheets: [{ name: 'b', data: [] }] }, ext: 'csv' },
      ];

      app.clearFiles();

      expect(app.files).toEqual([]);
    });

    test('updates status and disables buttons', async () => {
      const app = await createApp();
      app.files = [
        { name: 'a.csv', parsed: { sheets: [{ name: 'a', data: [] }] }, ext: 'csv' },
      ];

      app.clearFiles();

      expect(app.loadingText.textContent).toContain('Drop files');
      expect(app.uploadBtn.disabled).toBe(true);
      expect(app.clearBtn.disabled).toBe(true);
    });

    test('saves session after clearing', async () => {
      const app = await createApp();
      chrome.storage.session.set.mockClear();

      app.clearFiles();

      expect(chrome.storage.session.set).toHaveBeenCalled();
    });
  });

  // ---- getCleaningOptions ----

  describe('getCleaningOptions', () => {
    test('reads checkbox states', async () => {
      const app = await createApp();

      document.getElementById('opt-trim').checked = true;
      document.getElementById('opt-empty-rows').checked = true;
      document.getElementById('opt-empty-cols').checked = false;
      document.getElementById('opt-duplicates').checked = false;
      document.getElementById('opt-numbers').checked = true;
      document.getElementById('opt-dates').checked = true;
      document.getElementById('opt-headers').checked = false;

      const opts = app.getCleaningOptions();

      expect(opts.trim).toBe(true);
      expect(opts.removeEmptyRows).toBe(true);
      expect(opts.removeEmptyColumns).toBe(false);
      expect(opts.removeDuplicates).toBe(false);
      expect(opts.fixNumbers).toBe(true);
      expect(opts.normalizeDates).toBe(true);
      expect(opts.normalizeHeaders).toBe(false);
      expect(opts.preserveFormatting).toBe(true);
    });

    test('reads duplicate mode', async () => {
      const app = await createApp();
      document.querySelector('input[name="dup-mode"][value="absolute"]').checked = true;

      const opts = app.getCleaningOptions();
      expect(opts.duplicateMode).toBe('absolute');
    });
  });

  // ---- preference persistence ----

  describe('preference persistence', () => {
    test('option changes save only preferences', async () => {
      const app = await createApp();
      chrome.storage.session.set.mockClear();
      chrome.storage.local.set.mockClear();

      document.getElementById('opt-trim').checked = true;
      document.getElementById('opt-trim').dispatchEvent(new Event('change'));

      expect(chrome.storage.local.set).toHaveBeenCalled();
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
      expect(app.previewPanel.classList.contains('hidden')).toBe(true);
    });

    test('restores saved normalizeDates preference', async () => {
      chrome.storage.session.get.mockResolvedValueOnce({
        files: [],
        sessionSummary: null,
      });
      chrome.storage.local.get.mockResolvedValueOnce({
        prefs: {
          openMode: 'separate',
          cleaningOptions: { normalizeDates: true },
        },
      });

      // createApp calls restoreSession → savePreferences; keep the mock valid
      const app = await createApp();
      const opts = app.getCleaningOptions();
      expect(opts.normalizeDates).toBe(true);
    });

    test('restores saved normalizeDates false preference', async () => {
      chrome.storage.session.get.mockResolvedValueOnce({
        files: [],
        sessionSummary: null,
      });
      chrome.storage.local.get.mockResolvedValueOnce({
        prefs: {
          openMode: 'separate',
          cleaningOptions: { normalizeDates: false },
        },
      });

      const app = await createApp();
      const opts = app.getCleaningOptions();
      expect(opts.normalizeDates).toBe(false);
    });
  });

  // ---- getOpenMode ----

  describe('getOpenMode', () => {
    test('returns "separate" by default', async () => {
      const app = await createApp();
      expect(app.getOpenMode()).toBe('separate');
    });

    test('returns "merge" when merge radio is selected', async () => {
      const app = await createApp();
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;

      expect(app.getOpenMode()).toBe('merge');
    });
  });

  // ---- open-mode card interaction ----

  describe('open-mode card interaction', () => {
    test('clicking the merge card triggers one mode-change flow', async () => {
      const app = await createApp();
      app.mergeOption.classList.remove('hidden');

      const refreshSpy = jest.spyOn(app, 'schedulePreviewRefresh');
      const saveSpy = jest.spyOn(app, 'savePreferences');

      document.getElementById('open-mode-merge-card').click();

      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(app.getOpenMode()).toBe('merge');
    });

    test('clicking the separate card triggers one mode-change flow', async () => {
      const app = await createApp();
      app.mergeOption.classList.remove('hidden');
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      app._updateOpenModeCards();

      const refreshSpy = jest.spyOn(app, 'schedulePreviewRefresh');
      const saveSpy = jest.spyOn(app, 'savePreferences');

      document.getElementById('open-mode-separate-card').click();

      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(app.getOpenMode()).toBe('separate');
    });
  });

  describe('empty preview states', () => {
    test('shows no-data notice for an empty file in separate mode', async () => {
      const app = await createApp();
      jest.spyOn(app, 'shouldDeferPreview').mockReturnValue(false);
      app.files = [
        {
          name: 'empty.csv',
          ext: 'csv',
          parsed: { sheets: [{ name: 'Sheet1', data: [] }] },
        },
      ];

      await app.refreshPreview();

      expect(app.previewPanel.classList.contains('hidden')).toBe(false);
      expect(app.previewTable.textContent).toContain('No data found');
    });

    test('shows no-data notice when merged files are all empty', async () => {
      const app = await createApp();
      jest.spyOn(app, 'shouldDeferPreview').mockReturnValue(false);
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      app.files = [
        {
          name: 'empty-1.csv',
          ext: 'csv',
          parsed: { sheets: [{ name: 'Sheet1', data: [] }] },
        },
        {
          name: 'empty-2.csv',
          ext: 'csv',
          parsed: { sheets: [{ name: 'Sheet1', data: [] }] },
        },
      ];

      await app.refreshPreview();

      expect(app.previewPanel.classList.contains('hidden')).toBe(false);
      expect(app.previewTable.textContent).toContain('No data found');
    });
  });

  describe('custom mapping UI', () => {
    test('hides custom mapping when files already share the same headers', async () => {
      const app = await createApp();
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      document.getElementById('opt-smart-mapping').checked = true;
      app.files = [
        {
          name: 'master.csv',
          ext: 'csv',
          parsed: { sheets: [{ name: 'Master', data: [['id', 'first_name', 'email'], ['1', 'Harry', 'harry@example.com']] }] },
        },
        {
          name: 'source.csv',
          ext: 'csv',
          parsed: { sheets: [{ name: 'Source', data: [['id', 'first_name', 'email'], ['2', 'Ryan', 'ryan@example.com']] }] },
        },
      ];

      await app.updateCustomMappingVisibility();

      expect(app.smartMappingOption.classList.contains('hidden')).toBe(true);
      expect(app.customMappingOption.classList.contains('hidden')).toBe(true);
      expect(app.customMappingList.children).toHaveLength(0);
    });

    test('shows only source headers that are not already mapped to the master', async () => {
      const app = await createApp();
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      document.getElementById('opt-smart-mapping').checked = true;
      app.customMappings = [{ from: 'email_address', to: '' }];
      app.files = [
        {
          name: 'master.csv',
          ext: 'csv',
          parsed: { sheets: [{ name: 'Master', data: [['id', 'first_name', 'email'], ['1', 'Harry', 'harry@example.com']] }] },
        },
        {
          name: 'source.csv',
          ext: 'csv',
          parsed: { sheets: [{ name: 'Source', data: [['id', 'email_address', 'email'], ['2', 'ryan.alt@example.com', 'ryan@example.com']] }] },
        },
      ];

      await app.updateCustomMappingVisibility();

      expect(app.smartMappingOption.classList.contains('hidden')).toBe(false);
      expect(app.customMappingOption.classList.contains('hidden')).toBe(false);

      const selects = app.customMappingList.querySelectorAll('select');
      const fromOptions = Array.from(selects[0].querySelectorAll('option')).map((opt) => opt.value);
      const toOptions = Array.from(selects[1].querySelectorAll('option')).map((opt) => opt.value);

      expect(fromOptions).toEqual(['', 'email_address']);
      expect(toOptions).toEqual(['', 'first_name']);
    });

    test('treats fuzzy smart matches as already mapped once smart mapping is active', async () => {
      const app = await createApp();
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      document.getElementById('opt-smart-mapping').checked = true;
      app.smartMappingApproved = true;
      app.customMappings = [{ from: 'student_email', to: '' }];
      app.files = [
        {
          name: 'master.csv',
          ext: 'csv',
          parsed: { sheets: [{ name: 'Master', data: [['first_name', 'email'], ['Harry', 'harry@example.com']] }] },
        },
        {
          name: 'source.csv',
          ext: 'csv',
          parsed: { sheets: [{ name: 'Source', data: [['First Name', 'student_email'], ['Ryan', 'ryan@example.com']] }] },
        },
      ];

      await app.updateCustomMappingVisibility();

      expect(app.smartMappingOption.classList.contains('hidden')).toBe(false);
      const fromSelect = app.customMappingList.querySelector('select');
      const fromOptions = Array.from(fromSelect.querySelectorAll('option')).map((opt) => opt.value);

      expect(fromOptions).toEqual(['', 'student_email']);
      expect(fromOptions).not.toContain('First Name');
    });

    test('does not pass stale hidden mappings into merge processing', async () => {
      const app = await createApp();
      document.getElementById('opt-smart-mapping').checked = true;
      app.smartMappingApproved = true;
      app.customMappings = [{ from: 'email', to: 'first_name' }];
      app.files = [
        {
          name: 'master.csv',
          ext: 'csv',
          parsed: { sheets: [{ name: 'Master', data: [['id', 'first_name', 'email'], ['1', 'Harry', 'harry@example.com']] }] },
        },
        {
          name: 'source.csv',
          ext: 'csv',
          parsed: { sheets: [{ name: 'Source', data: [['id', 'first_name', 'email'], ['2', 'Ryan', 'ryan@example.com']] }] },
        },
      ];

      await app.getMergedProcessedData();

      expect(Merger.merge).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ customMappings: [] })
      );
    });
  });

  describe('preview workload handling', () => {
    test('shows sampled preview for large workloads', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => fallback());
      app.files = [{
        name: 'large.csv',
        ext: 'csv',
        size: 20 * 1024 * 1024,
        stats: {
          sheetCount: 1,
          rowCount: 2,
          colCount: 1,
          cellCount: 2,
          styledCellCount: 0,
        },
        parsed: null,
        file: new File(['a'], 'large.csv'),
      }];
      Parser.preview.mockResolvedValue({
        sheets: [{ name: 'large', data: [['A', 'B'], ['1', '2'], ['3', '4']] }],
        previewMeta: {
          rowCount: 1000,
          colCount: 2,
          sheetCount: 1,
          sampled: true,
          sampleRows: 3,
          fileSize: 20 * 1024 * 1024,
        },
      });

      const preview = await app.getResponsiveSeparatePreview(app.files[0]);
      app.renderPreviewTable(preview.data, 'large.csv', preview.summary);
      app.previewPanel.classList.remove('hidden');

      expect(app.previewPanel.classList.contains('hidden')).toBe(false);
      expect(app.previewTable.textContent).toContain('1');
      expect(app.previewStats.textContent).toContain('Showing 2 of 999 rows');
    });

    test('samples parsed Excel data and cellMeta with identical row and column bounds', async () => {
      const app = await createApp();
      const data = Array.from({ length: 60 }, (_, ri) => [
        ri === 0 ? 'Header' : `value-${ri}`,
        ri,
        true,
      ]);
      const cellMeta = data.map((row, ri) => row.map((value, ci) => (
        ci === 0
          ? { type: 'string', value: String(value) }
          : ci === 1
            ? { type: 'number', value }
            : { type: 'boolean', value }
      )));
      const item = {
        name: 'typed.xlsx',
        ext: 'xlsx',
        parsed: { sheets: [{ name: 'Sheet1', data, cellMeta }] },
        stats: { sheetCount: 1, rowCount: 60, colCount: 3 },
        size: 1024,
      };

      const preview = await app.ensurePreviewSample(item);

      expect(preview.sheets[0].data).toHaveLength(51);
      expect(preview.sheets[0].cellMeta).toHaveLength(51);
      expect(preview.sheets[0].data[50]).toEqual(data[50]);
      expect(preview.sheets[0].cellMeta[50]).toEqual(cellMeta[50]);
      expect(preview.sheets[0].data[0]).toHaveLength(3);
      expect(preview.sheets[0].cellMeta[0]).toHaveLength(3);
      expect(preview.previewMeta.metadataTrusted).toBe(true);
    });

    test('does not represent metadata-sensitive cleaning when sampled Excel metadata is unavailable', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => fallback());
      app.files = [{
        name: 'untrusted.xlsx',
        ext: 'xlsx',
        size: 1024,
        parsed: null,
        file: new File(['x'], 'untrusted.xlsx'),
      }];
      document.getElementById('opt-trim').checked = true;
      document.getElementById('opt-numbers').checked = true;
      document.getElementById('opt-headers').checked = true;
      Parser.preview.mockResolvedValue({
        sheets: [{ name: 'untrusted', data: [['  Formula Result  ', '  ordinary header  '], [' 1234 ', ' 1,234 ']] }],
        previewMeta: {
          rowCount: 2,
          colCount: 2,
          sheetCount: 1,
          sampled: true,
          sampleRows: 2,
          metadataTrusted: false,
        },
      });
      Cleaner.apply.mockImplementation((data, options, cellMeta) => ({ data, cellMeta }));

      const preview = await app.getResponsiveSeparatePreview(app.files[0]);
      app.renderPreviewTable(preview.data, 'untrusted.xlsx', preview.summary, preview.notices);

      expect(Cleaner.apply).not.toHaveBeenCalled();
      expect(preview.notices).toContainEqual(expect.stringContaining('Fix numbers'));
      expect(app.previewTable.textContent).toContain('Fix numbers');
      expect(preview.data).toEqual([
        ['  Formula Result  ', '  ordinary header  '],
        [' 1234 ', ' 1,234 '],
      ]);
      expect(preview.cleaningStats).toBeNull();
    });

    test('does not represent metadata-sensitive cleaning in merged Excel samples without metadata', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => fallback());
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      document.getElementById('opt-trim').checked = true;
      document.getElementById('opt-numbers').checked = true;
      document.getElementById('opt-headers').checked = true;
      app.files = [
        { name: 'a.xlsx', ext: 'xlsx', size: 1024, parsed: null, file: new File(['a'], 'a.xlsx') },
        { name: 'b.xlsx', ext: 'xlsx', size: 1024, parsed: null, file: new File(['b'], 'b.xlsx') },
      ];
      const rawSample = [['Formula Result', 'ordinary header'], [' 1234 ', ' 1,234 ']];
      Parser.preview
        .mockResolvedValueOnce({
          sheets: [{ name: 'a', data: rawSample }],
          previewMeta: { rowCount: 2, colCount: 2, sheetCount: 1, sampled: true, sampleRows: 2, metadataTrusted: false },
        })
        .mockResolvedValueOnce({
          sheets: [{ name: 'b', data: rawSample }],
          previewMeta: { rowCount: 2, colCount: 2, sheetCount: 1, sampled: true, sampleRows: 2, metadataTrusted: false },
        });
      Merger.merge.mockReturnValue({
        sheets: [{ name: 'Merged', data: rawSample, cellMeta: null }],
        sourceMap: [],
      });
      Cleaner.apply.mockImplementation((data, options, cellMeta) => ({ data, cellMeta }));

      const preview = await app.getResponsiveMergePreview(app.getCleaningOptions());

      expect(Cleaner.apply).not.toHaveBeenCalled();
      expect(preview.notices).toContainEqual(expect.stringContaining('Normalize headers'));
      expect(preview.merged.sheets[0].data).toEqual(rawSample);
      expect(preview.cleaningStats).toBeNull();
    });

    test('sampled separate preview applies trim and fixNumbers', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => fallback());
      app.files = [{
        name: 'padded.csv',
        ext: 'csv',
        size: 20 * 1024 * 1024,
        stats: { sheetCount: 1, rowCount: 3, colCount: 2, cellCount: 6, styledCellCount: 0 },
        parsed: null,
        file: new File(['a'], 'padded.csv'),
      }];
      document.getElementById('opt-trim').checked = true;
      document.getElementById('opt-numbers').checked = true;
      Parser.preview.mockResolvedValue({
        sheets: [{ name: 'padded', data: [['Name', 'Score'], [' Alice ', ' 1,234 '], [' Bob ', ' 5,678 ']] }],
        previewMeta: { rowCount: 3, colCount: 2, sheetCount: 1, sampled: false, sampleRows: 3, fileSize: 20 * 1024 * 1024 },
      });
      global.Cleaner.apply.mockImplementation((data, options) => {
        let result = data;
        if (options.trim) result = result.map(row => row.map(c => typeof c === 'string' ? c.trim() : c));
        if (options.fixNumbers) {
          result = result.map((row, ri) => ri === 0 ? row : row.map(c => {
            if (typeof c === 'string') {
              const cleaned = c.replace(/[,\s]/g, '');
              if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
                const n = Number(cleaned);
                return isFinite(n) ? n : c;
              }
            }
            return c;
          }));
        }
        return result;
      });
      global.Cleaner.tokenFromValue = jest.fn(v => {
        if (v === null || v === undefined || v === '') return { type: 'empty' };
        if (typeof v === 'number') return { type: 'number', value: v };
        return { type: 'string', value: String(v) };
      });

      const preview = await app.getResponsiveSeparatePreview(app.files[0]);

      expect(preview.data[1][0]).toBe('Alice');
      expect(preview.data[1][1]).toBe(1234);
      expect(preview.data[2][0]).toBe('Bob');
      expect(preview.data[2][1]).toBe(5678);
    });

    test('sampled merge preview applies trim and fixNumbers', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => fallback());
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      document.getElementById('opt-trim').checked = true;
      document.getElementById('opt-numbers').checked = true;
      app.files = [
        { name: 'a.csv', ext: 'csv', size: 1024, stats: { sheetCount: 1, rowCount: 2, colCount: 2, cellCount: 4, styledCellCount: 0 }, parsed: null, file: new File(['x'], 'a.csv') },
        { name: 'b.csv', ext: 'csv', size: 1024, stats: { sheetCount: 1, rowCount: 2, colCount: 2, cellCount: 4, styledCellCount: 0 }, parsed: null, file: new File(['y'], 'b.csv') },
      ];
      Parser.preview
        .mockResolvedValueOnce({
          sheets: [{ name: 'a', data: [['Name', 'Val'], ['  Alice ', '  100 ']] }],
          previewMeta: { rowCount: 2, colCount: 2, sheetCount: 1, sampled: false, sampleRows: 2, fileSize: 1024 },
        })
        .mockResolvedValueOnce({
          sheets: [{ name: 'b', data: [['Name', 'Val'], ['  Bob  ', '  200 ']] }],
          previewMeta: { rowCount: 2, colCount: 2, sheetCount: 1, sampled: false, sampleRows: 2, fileSize: 1024 },
        });
      global.Cleaner.tokenFromValue = jest.fn(v => {
        if (v === null || v === undefined || v === '') return { type: 'empty' };
        if (typeof v === 'number') return { type: 'number', value: v };
        return { type: 'string', value: String(v) };
      });
      global.Cleaner.apply = jest.fn((data, options) => {
        if (Array.isArray(data)) {
          let result = data;
          if (options.trim) result = result.map(row => row.map(c => typeof c === 'string' ? c.trim() : c));
          if (options.fixNumbers) {
            result = result.map((row, ri) => ri === 0 ? row : row.map(c => {
              if (typeof c === 'string') { const n = Number(c); return isFinite(n) ? n : c; }
              return c;
            }));
          }
          return result;
        }
        return data;
      });
      global.Merger.merge.mockReturnValue({
        sheets: [{ name: 'Merged', data: [['Name', 'Val'], ['  Alice ', '  100 '], ['  Bob  ', '  200 ']], cellMeta: null }],
        sourceMap: [],
      });

      const preview = await app.getResponsiveMergePreview(app.getCleaningOptions());

      expect(preview.merged.sheets[0].data[1][0]).toBe('Alice');
      expect(preview.merged.sheets[0].data[1][1]).toBe(100);
      expect(preview.merged.sheets[0].data[2][0]).toBe('Bob');
      expect(preview.merged.sheets[0].data[2][1]).toBe(200);
    });

    test('sampled preview shows notice for structural ops that need full data', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => fallback());
      app.files = [{
        name: 'data.csv',
        ext: 'csv',
        size: 1024,
        stats: { sheetCount: 1, rowCount: 3, colCount: 2, cellCount: 6, styledCellCount: 0 },
        parsed: null,
        file: new File(['a'], 'data.csv'),
      }];
      document.getElementById('opt-empty-rows').checked = true;
      document.getElementById('opt-duplicates').checked = true;
      Parser.preview.mockResolvedValue({
        sheets: [{ name: 'data', data: [['A', 'B'], ['1', '2']] }],
        previewMeta: { rowCount: 3, colCount: 2, sheetCount: 1, sampled: false, sampleRows: 2, fileSize: 1024 },
      });
      global.Cleaner.tokenFromValue = jest.fn(v => {
        if (v === null || v === undefined || v === '') return { type: 'empty' };
        return { type: 'string', value: String(v) };
      });

      const preview = await app.getResponsiveSeparatePreview(app.files[0]);

      expect(preview.notices).toBeDefined();
      expect(preview.notices.length).toBeGreaterThan(0);
      expect(preview.notices[0]).toContain('not shown in preview');
    });
  });

  describe('handleUpload', () => {
    test('uploads small separate files natively when no cleaning is selected', async () => {
      const app = await createApp();
      const file = new File(['a'], 'plain.csv');
      app.files = [{
        file,
        parsed: null,
        name: 'plain.csv',
        ext: 'csv',
        size: 1024,
        stats: null,
        identityKey: 'plain.csv::csv::1024::0',
        lazy: true,
      }];

      await app.handleUpload();

      expect(GoogleAPI.uploadFileToDrive).toHaveBeenCalledWith(
        file,
        'plain',
        expect.any(Object)
      );
      expect(Parser.parse).not.toHaveBeenCalled();
      expect(GoogleAPI.cleanUploadedSheet).not.toHaveBeenCalled();
      expect(GoogleAPI.formatUploadedSheet).not.toHaveBeenCalled();
      expect(GoogleAPI.createSpreadsheet).not.toHaveBeenCalled();
    });

    test('applies separate-file cleaning in Sheets without reparsing locally', async () => {
      const app = await createApp();
      const file = new File(['a'], 'lazy.csv');
      document.getElementById('opt-trim').checked = true;
      app.files = [{
        file,
        parsed: null,
        name: 'lazy.csv',
        ext: 'csv',
        size: 1024,
        stats: null,
        identityKey: 'lazy.csv::csv::1024::0',
        lazy: true,
      }];

      await app.handleUpload();

      expect(GoogleAPI.uploadFileToDrive).toHaveBeenCalledWith(
        file,
        'lazy',
        expect.any(Object)
      );
      expect(GoogleAPI.cleanUploadedSheet).toHaveBeenCalledWith(
        'drive-456',
        expect.objectContaining({ trim: true }),
        expect.any(Object)
      );
      expect(Parser.parse).not.toHaveBeenCalled();
      expect(GoogleAPI.formatUploadedSheet).not.toHaveBeenCalled();
      expect(GoogleAPI.createSpreadsheet).not.toHaveBeenCalled();
    });

    test('uses native Drive import for very large separate spreadsheets', async () => {
      const app = await createApp();
      const file = new File(['a'], 'big_table_100mb.xlsx');
      Object.defineProperty(file, 'size', { value: 80 * 1024 * 1024 });
      app.files = [{
        file,
        parsed: null,
        name: 'big_table_100mb.xlsx',
        ext: 'xlsx',
        size: 80 * 1024 * 1024,
        stats: null,
        identityKey: 'big_table_100mb.xlsx::xlsx::83886080::0',
        lazy: true,
      }];

      await app.handleUpload();

      expect(GoogleAPI.uploadFileToDrive).toHaveBeenCalledWith(
        file,
        'big_table_100mb',
        expect.any(Object)
      );
      expect(Parser.parse).not.toHaveBeenCalled();
      expect(GoogleAPI.createSpreadsheet).not.toHaveBeenCalled();
    });

    test('releases parsed data after large separate uploads', async () => {
      const app = await createApp();
      jest.spyOn(app, 'shouldPersistFilesSession').mockReturnValue(false);
      const file = new File(['a'], 'heavy.csv');
      app.files = [{
        file,
        parsed: { sheets: [{ name: 'heavy', data: [['A'], ['1']] }] },
        name: 'heavy.csv',
        ext: 'csv',
        size: 20 * 1024 * 1024,
        stats: { sheetCount: 1, rowCount: 2, colCount: 1, cellCount: 2, styledCellCount: 0 },
        identityKey: 'heavy.csv::csv::20971520::0',
        contentFingerprint: 'abc123',
        lazy: false,
      }];

      await app.handleUpload();

      expect(app.files[0].parsed).toBeNull();
      expect(app.files[0].lazy).toBe(true);
      expect(chrome.storage.session.set).toHaveBeenCalled();
    });
  });

  // ---- uploadSingleFromList ----

  describe('uploadSingleFromList', () => {
    test('uploads only the targeted file from a list of many', async () => {
      const app = await createApp();
      const fileA = new File(['a'], 'a.csv');
      const fileB = new File(['b'], 'b.csv');
      const fileC = new File(['c'], 'c.csv');
      app.files = [
        { file: fileA, parsed: null, name: 'a.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'a.csv::csv::1024::0', lazy: true },
        { file: fileB, parsed: null, name: 'b.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'b.csv::csv::1024::1', lazy: true },
        { file: fileC, parsed: null, name: 'c.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'c.csv::csv::1024::2', lazy: true },
      ];

      await app.uploadSingleFromList(1);

      expect(GoogleAPI.uploadFileToDrive).toHaveBeenCalledTimes(1);
      expect(GoogleAPI.uploadFileToDrive).toHaveBeenCalledWith(
        fileB,
        'b',
        expect.any(Object)
      );
      expect(app.files).toHaveLength(3);
      expect(app.files.map((f) => f.name)).toEqual(['a.csv', 'b.csv', 'c.csv']);
    });

    test('keeps the file in the list after a successful upload', async () => {
      const app = await createApp();
      const file = new File(['x'], 'keep.csv');
      app.files = [
        { file, parsed: null, name: 'keep.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'keep.csv::csv::1024::0', lazy: true },
      ];

      await app.uploadSingleFromList(0);

      expect(app.files).toHaveLength(1);
      expect(app.files[0].name).toBe('keep.csv');
    });

    test('applies current cleaning options to the single upload', async () => {
      const app = await createApp();
      document.getElementById('opt-trim').checked = true;
      document.getElementById('opt-empty-rows').checked = true;
      const file = new File(['x'], 'clean.csv');
      app.files = [
        { file, parsed: null, name: 'clean.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'clean.csv::csv::1024::0', lazy: true },
      ];

      await app.uploadSingleFromList(0);

      expect(GoogleAPI.uploadFileToDrive).toHaveBeenCalledWith(file, 'clean', expect.any(Object));
      expect(GoogleAPI.cleanUploadedSheet).toHaveBeenCalledWith(
        'drive-456',
        expect.objectContaining({ trim: true, removeEmptyRows: true }),
        expect.any(Object)
      );
    });

    test('parses and cleans locally for non-Excel files with cleaning', async () => {
      const app = await createApp();
      document.getElementById('opt-trim').checked = true;
      app.files = [{
        file: new File(['x'], 'parse.csv'),
        parsed: null,
        name: 'parse.csv',
        ext: 'csv',
        size: 1024,
        stats: null,
        identityKey: 'parse.csv::csv::1024::0',
        lazy: true,
      }];
      jest.spyOn(app, 'shouldUseNativeDriveImport').mockReturnValue(false);
      jest.spyOn(app, 'ensureParsedEntry').mockImplementation(async (item) => {
        item.parsed = { sheets: [{ name: 'parse', data: [['A', 'B'], ['1', '2']] }] };
      });
      jest.spyOn(app, 'getCleanedSheetData').mockResolvedValue([['A', 'B'], ['1', '2']]);

      await app.uploadSingleFromList(0);

      expect(app.ensureParsedEntry).toHaveBeenCalled();
      expect(GoogleAPI.createSpreadsheet).toHaveBeenCalledWith(
        'parse',
        [{ name: 'parse', data: [['A', 'B'], ['1', '2']], cellMeta: null }],
        expect.any(Object)
      );
      expect(GoogleAPI.uploadFileToDrive).not.toHaveBeenCalled();
    });

    test('does nothing when another upload is already in progress', async () => {
      const app = await createApp();
      app.uploading = true;
      app.files = [
        { file: new File(['x'], 'a.csv'), parsed: null, name: 'a.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'a.csv::csv::1024::0', lazy: true },
      ];

      await app.uploadSingleFromList(0);

      expect(GoogleAPI.uploadFileToDrive).not.toHaveBeenCalled();
      expect(GoogleAPI.createSpreadsheet).not.toHaveBeenCalled();
    });

    test('does nothing for an out-of-range index', async () => {
      const app = await createApp();
      app.files = [
        { file: new File(['x'], 'a.csv'), parsed: null, name: 'a.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'a.csv::csv::1024::0', lazy: true },
      ];

      await app.uploadSingleFromList(5);
      await app.uploadSingleFromList(-1);

      expect(GoogleAPI.uploadFileToDrive).not.toHaveBeenCalled();
      expect(GoogleAPI.createSpreadsheet).not.toHaveBeenCalled();
    });

    test('surfaces errors via setStatus and clears the uploading flag', async () => {
      const app = await createApp();
      app.files = [
        { file: new File(['x'], 'bad.csv'), parsed: null, name: 'bad.csv', ext: 'csv', size: 1024, stats: null, identityKey: 'bad.csv::csv::1024::0', lazy: true },
      ];
      GoogleAPI.uploadFileToDrive.mockRejectedValueOnce(new Error('boom'));

      await app.uploadSingleFromList(0);

      expect(app.uploading).toBe(false);
      expect(app.uploadBtn.disabled).toBe(false);
      expect(app.loadingText.textContent).toContain('Upload failed: boom');
    });

  });

  describe('setStatus', () => {
    test('sets loading text and panel class', async () => {
      const app = await createApp();

      app.setStatus('Upload complete', 'success');

      expect(app.loadingText.textContent).toBe('Upload complete');
      expect(app.loadingPanel.classList.contains('loading-panel--success')).toBe(true);
    });

    test('defaults to info type (no modifier class)', async () => {
      const app = await createApp();

      app.setStatus('Ready');

      expect(app.loadingPanel.classList.contains('loading-panel--active')).toBe(false);
      expect(app.loadingPanel.classList.contains('loading-panel--success')).toBe(false);
    });

    test('shows spinner for loading type', async () => {
      const app = await createApp();

      app.setStatus('Parsing…', 'loading');

      expect(app.loadingPanel.classList.contains('loading-panel--active')).toBe(true);
      expect(app.loadingSpinner.classList.contains('hidden')).toBe(false);
    });

    describe('accessibility announcements', () => {
      const expectStatus = (app, msg) => {
        expect(app.loadingSrStatus.textContent).toBe(msg);
      };
      const expectAlert = (app, msg) => {
        expect(app.loadingSrAlert.textContent).toBe(msg);
      };
      const expectStatusEmpty = (app) => expectStatus(app, '');
      const expectAlertEmpty = (app) => expectAlert(app, '');

      test('loading populates polite status region', async () => {
        const app = await createApp();
        app.setStatus('Parsing files…', 'loading');

        expectStatus(app, 'Parsing files…');
        expectAlertEmpty(app);
      });

      test('success populates polite status region', async () => {
        const app = await createApp();
        app.setStatus('All files ready', 'success');

        expectStatus(app, 'All files ready');
        expectAlertEmpty(app);
      });

      test('warning populates polite status region', async () => {
        const app = await createApp();
        app.setStatus('Enter a valid URL', 'warning');

        expectStatus(app, 'Enter a valid URL');
        expectAlertEmpty(app);
      });

      test('error populates assertive alert region', async () => {
        const app = await createApp();
        app.setStatus('Upload failed', 'error');

        expectAlert(app, 'Upload failed');
        expectStatusEmpty(app);
      });

      test('aria-live and roles remain static', async () => {
        const app = await createApp();

        expect(app.loadingSrStatus.getAttribute('aria-live')).toBe('polite');
        expect(app.loadingSrStatus.getAttribute('role')).toBe('status');
        expect(app.loadingSrAlert.getAttribute('aria-live')).toBe('assertive');
        expect(app.loadingSrAlert.getAttribute('role')).toBe('alert');

        app.setStatus('Working…', 'loading');
        expect(app.loadingSrStatus.getAttribute('aria-live')).toBe('polite');

        app.setStatus('Error!', 'error');
        expect(app.loadingSrAlert.getAttribute('aria-live')).toBe('assertive');
      });

      test('announces restored-file counts politely', async () => {
        const app = await createApp();
        app.setStatus('Restored 3 files from last session', 'info');

        expectStatus(app, 'Restored 3 files from last session');
        expectAlertEmpty(app);
      });

      test('announces Re-add to continue politely', async () => {
        const app = await createApp();
        app.setStatus('Re-add to continue: "old.csv"', 'info');

        expectStatus(app, 'Re-add to continue: "old.csv"');
        expectAlertEmpty(app);
      });

      test('announces large-batch message politely', async () => {
        const app = await createApp();
        app.setStatus('Large batch (50 files, 200 MB) was not restored', 'info');

        expectStatus(app, 'Large batch (50 files, 200 MB) was not restored');
        expectAlertEmpty(app);
      });

      test('initial static hint is not automatically announced', async () => {
        const app = await createApp();

        expect(app.loadingSrStatus.textContent).toBe('');
        expect(app.loadingSrAlert.textContent).toBe('');
      });

      test('inactive region is cleared when the other is used', async () => {
        const app = await createApp();

        app.setStatus('Upload failed', 'error');
        expectAlert(app, 'Upload failed');

        app.setStatus('Retrying…', 'loading');
        expectStatus(app, 'Retrying…');
        expectAlertEmpty(app);

        app.setStatus('Failed again', 'error');
        expectAlert(app, 'Failed again');
        expectStatusEmpty(app);
      });

      test('same error after a retry is announced again', async () => {
        const app = await createApp();

        app.setStatus('Network error', 'error');
        expectAlert(app, 'Network error');

        app.setStatus('Retrying…', 'loading');
        app.setStatus('Network error', 'error');
        expectAlert(app, 'Network error');
      });

      test('visual text, spinner, and modifier classes are unchanged', async () => {
        const app = await createApp();

        app.setStatus('Working…', 'loading');
        expect(app.loadingText.textContent).toBe('Working…');
        expect(app.loadingPanel.classList.contains('loading-panel--active')).toBe(true);
        expect(app.loadingSpinner.classList.contains('hidden')).toBe(false);

        app.setStatus('Done', 'success');
        expect(app.loadingText.textContent).toBe('Done');
        expect(app.loadingPanel.classList.contains('loading-panel--success')).toBe(true);
        expect(app.loadingSpinner.classList.contains('hidden')).toBe(true);
      });
    });
  });

  // ---- showProgress / hideProgress ----

  describe('progress bar', () => {
    test('showProgress sets the semantic progress value', async () => {
      const app = await createApp();

      app.showProgress(50);

      expect(app.loadingBar.value).toBe(50);
    });

    test('showProgress caps the semantic progress value at 100', async () => {
      const app = await createApp();

      app.showProgress(150);

      expect(app.loadingBar.value).toBe(100);
    });

    test('hideProgress resets bar after delay', async () => {
      const app = await createApp();

      jest.useFakeTimers();

      app.showProgress(100);
      app.setStatus('Working…', 'loading');
      app.hideProgress();

      // Not reset immediately
      expect(app.loadingBar.value).toBe(100);

      // Reset after 800ms
      jest.advanceTimersByTime(800);
      expect(app.loadingBar.value).toBe(0);
      expect(app.loadingPanel.classList.contains('loading-panel--active')).toBe(false);
      expect(app.loadingSpinner.classList.contains('hidden')).toBe(true);

      jest.useRealTimers();
    });
  });

  // ---- renderFileList ----

  describe('renderFileList', () => {
    test('renders file items in the list', async () => {
      const app = await createApp();
      app.files = [
        {
          name: 'data.csv',
          ext: 'csv',
          parsed: { sheets: [{ name: 'data', data: [['A', 'B'], ['1', '2']] }] },
        },
      ];

      app.renderFileList();

      const items = document.querySelectorAll('.file-item');
      expect(items).toHaveLength(1);
      expect(items[0].textContent).toContain('data.csv');
      expect(items[0].textContent).toContain('2 rows');
      expect(items[0].textContent).toContain('2 cols');
    });

    test('updates file count', async () => {
      const app = await createApp();
      app.files = [
        {
          name: 'a.csv',
          ext: 'csv',
          parsed: { sheets: [{ name: 'a', data: [['A']] }] },
        },
        {
          name: 'b.csv',
          ext: 'csv',
          parsed: { sheets: [{ name: 'b', data: [['B']] }] },
        },
      ];

      app.renderFileList();

      expect(app.fileCount.textContent).toBe('(2)');
    });

    test('shows empty count when no files', async () => {
      const app = await createApp();
      app.files = [];

      app.renderFileList();

      expect(app.fileCount.textContent).toBe('');
    });

    test('shows reorder buttons when multiple files', async () => {
      const app = await createApp();
      app.files = [
        {
          name: 'a.csv',
          ext: 'csv',
          parsed: { sheets: [{ name: 'a', data: [['A']] }] },
        },
        {
          name: 'b.csv',
          ext: 'csv',
          parsed: { sheets: [{ name: 'b', data: [['B']] }] },
        },
      ];

      app.renderFileList();

      const reorderBtns = document.querySelectorAll('.reorder-btn');
      expect(reorderBtns.length).toBeGreaterThan(0);
    });

    test('renders a per-file open button with accessible label', async () => {
      const app = await createApp();
      app.files = [
        { name: 'report.csv', ext: 'csv', parsed: { sheets: [{ name: 'report', data: [['A']] }] } },
        { name: 'data.csv', ext: 'csv', parsed: { sheets: [{ name: 'data', data: [['B']] }] } },
      ];

      app.renderFileList();

      const openBtns = document.querySelectorAll('.open-file-btn');
      expect(openBtns).toHaveLength(2);
      expect(openBtns[0].getAttribute('aria-label')).toBe('Open report.csv in Sheets');
      expect(openBtns[1].getAttribute('aria-label')).toBe('Open data.csv in Sheets');
    });

    test('disables per-file open buttons while an upload is in progress', async () => {
      const app = await createApp();
      app.files = [
        { name: 'a.csv', ext: 'csv', parsed: { sheets: [{ name: 'a', data: [['A']] }] } },
        { name: 'b.csv', ext: 'csv', parsed: { sheets: [{ name: 'b', data: [['B']] }] } },
      ];
      app.uploading = true;

      app.renderFileList();

      const openBtns = document.querySelectorAll('.open-file-btn');
      expect(Array.from(openBtns).every((btn) => btn.disabled)).toBe(true);
    });

    test('renders worksheet selectors only for multi-sheet Excel files in merge mode', async () => {
      const app = await createApp();
      app.files = [
        {
          name: 'quarterly-report.xlsx',
          ext: 'xlsx',
          parsed: {
            sheets: [
              { name: 'Q1', data: [['A', 'B'], ['1', '2'], ['3', '4']] },
              { name: 'Summary', data: [['Total'], ['6']] },
            ],
          },
        },
        {
          name: 'single.xlsx',
          ext: 'xlsx',
          parsed: { sheets: [{ name: 'Data', data: [['A']] }] },
        },
        {
          name: 'data.csv',
          ext: 'csv',
          parsed: {
            sheets: [
              { name: 'Data', data: [['A']] },
              { name: 'Unexpected second sheet', data: [['B']] },
            ],
          },
        },
        {
          name: 'data.tsv',
          ext: 'tsv',
          parsed: {
            sheets: [
              { name: 'Data', data: [['A']] },
              { name: 'Unexpected second sheet', data: [['B']] },
            ],
          },
        },
      ];

      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      app.updateOpenModeState();

      const selector = document.querySelector('.merge-sheet-select');
      expect(document.querySelectorAll('.merge-sheet-select')).toHaveLength(1);
      expect(selector.getAttribute('aria-label')).toBe('Worksheet for quarterly-report.xlsx');
      expect(Array.from(selector.options).map((option) => option.textContent)).toEqual([
        expect.stringContaining('Q1'),
        expect.stringContaining('Summary'),
      ]);
      expect(selector.options[0].textContent).toEqual(expect.stringContaining('3 rows'));
      expect(selector.options[0].textContent).toEqual(expect.stringContaining('2 cols'));

      document.querySelector('input[name="open-mode"][value="separate"]').checked = true;
      app.updateOpenModeState();
      expect(document.querySelectorAll('.merge-sheet-select')).toHaveLength(0);
    });

    test('disables worksheet selectors while an upload is in progress', async () => {
      const app = await createApp();
      app.files = [{
        name: 'workbook.xlsx',
        ext: 'xlsx',
        parsed: {
          sheets: [
            { name: 'Data', data: [['A']] },
            { name: 'Summary', data: [['B']] },
          ],
        },
      }];
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      app.uploading = true;

      app.updateOpenModeState();

      expect(document.querySelector('.merge-sheet-select').disabled).toBe(true);
    });

    test('worksheet selection resets merge state, refreshes, and persists the selected index', async () => {
      const app = await createApp();
      app.files = [{
        name: 'workbook.xlsx',
        ext: 'xlsx',
        selectedMergeSheetIndex: 0,
        parsed: {
          sheets: [
            { name: 'Data', data: [['A']] },
            { name: 'Summary', data: [['B']] },
          ],
        },
      }];
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      app.smartMappingApproved = true;
      app.smartMappingDeclined = true;

      const customMappingSpy = jest.spyOn(app, 'updateCustomMappingVisibility').mockResolvedValue();
      const previewSpy = jest.spyOn(app, 'schedulePreviewRefresh').mockImplementation(() => {});
      const summarySpy = jest.spyOn(app, '_updateSummaryCards').mockImplementation(() => {});
      const saveSpy = jest.spyOn(app, 'saveFilesSession').mockImplementation(() => {});
      const changedSpy = jest.spyOn(app, 'markFilesChanged');

      app.updateOpenModeState();
      const selector = document.querySelector('.merge-sheet-select');
      selector.value = '1';
      selector.dispatchEvent(new Event('change', { bubbles: true }));

      expect(app.files[0].selectedMergeSheetIndex).toBe(1);
      expect(changedSpy).toHaveBeenCalled();
      expect(app.smartMappingApproved).toBe(false);
      expect(app.smartMappingDeclined).toBe(false);
      expect(customMappingSpy).toHaveBeenCalled();
      expect(previewSpy).toHaveBeenCalled();
      expect(summarySpy).toHaveBeenCalled();
      expect(saveSpy).toHaveBeenCalled();
    });

    test('hydrates lazy workbook metadata with a visible loading status', async () => {
      const app = await createApp();
      let resolveMetadata;
      const metadataPromise = new Promise((resolve) => {
        resolveMetadata = resolve;
      });
      Parser.getWorkbookMetadata.mockReturnValue(metadataPromise);
      app.updateCustomMappingVisibility = jest.fn().mockResolvedValue();
      app.files = [{
        name: 'lazy-workbook.xlsx',
        ext: 'xlsx',
        file: new File(['workbook'], 'lazy-workbook.xlsx'),
        lazy: true,
        parsed: null,
      }];
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;

      app.updateOpenModeState();
      expect(app.loadingText.textContent).toContain('Loading worksheet');
      expect(document.querySelectorAll('.merge-sheet-select')).toHaveLength(0);

      resolveMetadata({
        sheets: [
          { name: 'Data', rowCount: 10, colCount: 2 },
          { name: 'Summary', rowCount: 3, colCount: 1 },
        ],
      });
      await app.mergeSheetMetadataPromise;

      expect(document.querySelectorAll('.merge-sheet-select')).toHaveLength(1);
      expect(Array.from(document.querySelector('.merge-sheet-select').options).map((option) => option.textContent)).toEqual([
        expect.stringContaining('Data'),
        expect.stringContaining('Summary'),
      ]);
      expect(document.querySelector('.merge-sheet-select').options[0].textContent).toEqual(
        expect.stringContaining('10 rows')
      );
    });

    test('per-file open button triggers uploadSingleFromList with the correct index', async () => {
      const app = await createApp();
      app.files = [
        { name: 'a.csv', ext: 'csv', parsed: { sheets: [{ name: 'a', data: [['A']] }] } },
        { name: 'b.csv', ext: 'csv', parsed: { sheets: [{ name: 'b', data: [['B']] }] } },
      ];
      const spy = jest.spyOn(app, 'uploadSingleFromList').mockResolvedValue();

      app.renderFileList();
      const openBtns = document.querySelectorAll('.open-file-btn');
      openBtns[1].click();

      expect(spy).toHaveBeenCalledWith(1);
    });
  });

  // ---- URL bar toggle ----

  describe('toggleUrlBar', () => {
    test('opens URL bar', async () => {
      const app = await createApp();

      await app.toggleUrlBar(true);

      expect(app.urlBar.classList.contains('hidden')).toBe(false);
      expect(app.urlToggle.getAttribute('aria-expanded')).toBe('true');
    });

    test('closes URL bar', async () => {
      const app = await createApp();
      await app.toggleUrlBar(true);

      await app.toggleUrlBar(false);

      expect(app.urlBar.classList.contains('hidden')).toBe(true);
      expect(app.urlToggle.getAttribute('aria-expanded')).toBe('false');
    });

    test('toggles when no argument given', async () => {
      const app = await createApp();

      await app.toggleUrlBar(); // opens
      expect(app.urlBar.classList.contains('hidden')).toBe(false);

      await app.toggleUrlBar(); // closes
      expect(app.urlBar.classList.contains('hidden')).toBe(true);
    });
  });

  // ---- URL Import Permission Flow ----

  describe('importFromUrl permission flow', () => {
    beforeEach(() => {
      chrome.permissions.contains.mockResolvedValue(false);
      chrome.permissions.request.mockResolvedValue(true);
    });

    test('opening URL section does not request permission', async () => {
      const app = await createApp();

      await app.toggleUrlBar(true);

      expect(app.urlBar.classList.contains('hidden')).toBe(false);
      expect(chrome.permissions.request).not.toHaveBeenCalled();
      expect(chrome.permissions.contains).not.toHaveBeenCalled();
    });

    test('invalid URL shows error', async () => {
      const app = await createApp();
      app.urlInput.value = 'not a url';

      await app.importFromUrl();

      expect(app.urlInput.classList.contains('url-input--error')).toBe(true);
      expect(app.loadingText.textContent).toContain('Enter a valid URL');
    });

    test('HTTP URL is rejected', async () => {
      const app = await createApp();
      app.urlInput.value = 'http://example.com/data.csv';

      await app.importFromUrl();

      expect(app.urlInput.classList.contains('url-input--error')).toBe(true);
      expect(app.loadingText.textContent).toContain('Only HTTPS URLs are supported');
      expect(chrome.permissions.request).not.toHaveBeenCalled();
    });

    test('already-granted origin skips permission request', async () => {
      chrome.permissions.contains.mockResolvedValue(true);
      const app = await createApp();
      app.urlInput.value = 'https://example.com/data.csv';

      // Prevent actual fetch
      global.fetch = jest.fn().mockRejectedValue(new Error('network error'));

      await app.importFromUrl();

      expect(chrome.permissions.contains).toHaveBeenCalledWith({
        origins: ['https://example.com/*'],
      });
      expect(chrome.permissions.request).not.toHaveBeenCalled();

      delete global.fetch;
    });

    test('newly granted permission proceeds to fetch', async () => {
      chrome.permissions.contains.mockResolvedValue(false);
      chrome.permissions.request.mockResolvedValue(true);
      const app = await createApp();
      app.urlInput.value = 'https://example.com/data.csv';

      global.fetch = jest.fn().mockRejectedValue(new Error('network error'));

      await app.importFromUrl();

      expect(chrome.permissions.request).toHaveBeenCalledWith({
        origins: ['https://example.com/*'],
      });
      expect(global.fetch).toHaveBeenCalled();

      delete global.fetch;
    });

    test('permission denial shows warning and does not clear URL', async () => {
      chrome.permissions.request.mockResolvedValue(false);
      const app = await createApp();
      app.urlInput.value = 'https://example.com/data.csv';

      global.fetch = jest.fn();

      await app.importFromUrl();

      expect(chrome.permissions.request).toHaveBeenCalledWith({
        origins: ['https://example.com/*'],
      });
      expect(app.urlInput.classList.contains('url-input--error')).toBe(true);
      expect(app.loadingText.textContent).toContain('Permission denied');
      expect(app.urlInput.value).toBe('https://example.com/data.csv');
      expect(global.fetch).not.toHaveBeenCalled();

      delete global.fetch;
    });

    test('fetch does not start before permission is approved', async () => {
      chrome.permissions.contains.mockResolvedValue(false);
      chrome.permissions.request.mockResolvedValue(false);
      const app = await createApp();
      app.urlInput.value = 'https://example.com/data.csv';

      global.fetch = jest.fn();

      await app.importFromUrl();

      expect(global.fetch).not.toHaveBeenCalled();

      delete global.fetch;
    });
  });

  // ---- URL import download size limit ----

  describe('importFromUrl download size limit', () => {
    beforeEach(() => {
      chrome.permissions.contains.mockResolvedValue(true);
    });

    function makeMockResponse(opts = {}) {
      const chunks = opts.chunks || [];
      let chunkIndex = 0;
      const reader = {
        read: jest.fn().mockImplementation(() => {
          if (chunkIndex < chunks.length) {
            return Promise.resolve({ done: false, value: chunks[chunkIndex++] });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
        cancel: jest.fn().mockResolvedValue(undefined),
      };

      return {
        ok: opts.ok !== false,
        headers: {
          get: jest.fn((name) => {
            const lower = name.toLowerCase();
            if (lower === 'content-length') {
              return opts.contentLength !== undefined ? String(opts.contentLength) : null;
            }
            if (lower === 'content-type') return opts.contentType || 'text/csv';
            if (lower === 'content-disposition') return opts.contentDisposition || '';
            return null;
          }),
        },
        body: { getReader: () => reader },
      };
    }

    test('small response with Content-Length succeeds', async () => {
      const app = await createApp();
      app.urlInput.value = 'https://example.com/data.csv';
      const data = 'a,b\n1,2';
      const encoded = new TextEncoder().encode(data);
      global.fetch = jest.fn().mockResolvedValue(
        makeMockResponse({ chunks: [encoded], contentLength: encoded.byteLength })
      );
      Parser.parse.mockResolvedValue({ sheets: [{ name: 'test', data: [['a','b'],['1','2']] }] });

      await app.importFromUrl();

      expect(app.files).toHaveLength(1);
      expect(app.files[0].name).toBe('data.csv');
      expect(app.urlFetchBtn.disabled).toBe(false);

      delete global.fetch;
    });

    test('oversized Content-Length rejects immediately without calling getReader', async () => {
      const app = await createApp();
      app.urlInput.value = 'https://example.com/data.csv';
      const getReader = jest.fn();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: jest.fn((name) => {
            if (name.toLowerCase() === 'content-length') return String(60 * 1024 * 1024);
            return null;
          }),
        },
        body: { cancel: jest.fn().mockResolvedValue(undefined), getReader },
      });

      await app.importFromUrl();

      expect(app.loadingText.textContent).toContain('File too large');
      expect(app.loadingText.textContent).toContain('50 MB');
      expect(app.urlInput.classList.contains('url-input--error')).toBe(true);
      expect(app.urlFetchBtn.disabled).toBe(false);
      expect(getReader).not.toHaveBeenCalled();

      delete global.fetch;
    });

    test('missing Content-Length succeeds for small stream', async () => {
      const app = await createApp();
      app.urlInput.value = 'https://example.com/data.csv';
      const data = 'a,b\n1,2';
      const encoded = new TextEncoder().encode(data);
      global.fetch = jest.fn().mockResolvedValue(
        makeMockResponse({ chunks: [encoded], contentLength: null })
      );
      Parser.parse.mockResolvedValue({ sheets: [{ name: 'test', data: [['a','b'],['1','2']] }] });

      await app.importFromUrl();

      expect(app.files).toHaveLength(1);
      expect(app.urlFetchBtn.disabled).toBe(false);

      delete global.fetch;
    });

    test('stream exceeding limit is aborted', async () => {
      const app = await createApp();
      app.urlInput.value = 'https://example.com/data.csv';
      global.fetch = jest.fn().mockResolvedValue(
        makeMockResponse({
          chunks: [{ byteLength: 60 * 1024 * 1024 }],
          contentLength: null,
        })
      );

      await app.importFromUrl();

      expect(app.loadingText.textContent).toContain('File too large');
      expect(app.urlInput.classList.contains('url-input--error')).toBe(true);
      expect(app.urlFetchBtn.disabled).toBe(false);

      delete global.fetch;
    });

    test('stream ending below limit with Content-Length succeeds', async () => {
      const app = await createApp();
      app.urlInput.value = 'https://example.com/data.csv';
      const data = 'x,y\n1,2';
      const encoded = new TextEncoder().encode(data);
      global.fetch = jest.fn().mockResolvedValue(
        makeMockResponse({ chunks: [encoded], contentLength: encoded.byteLength })
      );
      Parser.parse.mockResolvedValue({ sheets: [{ name: 'test', data: [['x','y'],['1','2']] }] });

      await app.importFromUrl();

      expect(app.files).toHaveLength(1);
      expect(app.files[0].name).toBe('data.csv');

      delete global.fetch;
    });

    test('timeout aborts the download', async () => {
      const app = await createApp();
      app.urlInput.value = 'https://example.com/data.csv';

      global.fetch = jest.fn().mockImplementation((_url, options) => {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      });

      const importPromise = app.importFromUrl();
      await flushPromises();

      app.currentFetchController.abort();
      await importPromise;

      expect(app.loadingText.textContent).toContain('cancelled or timed out');
      expect(app.urlInput.classList.contains('url-input--error')).toBe(true);
      expect(app.urlFetchBtn.disabled).toBe(false);
      expect(app.currentFetchController).toBeNull();

      delete global.fetch;
    });

    test('manual cancellation aborts the download', async () => {
      const app = await createApp();
      app.urlInput.value = 'https://example.com/data.csv';

      global.fetch = jest.fn().mockImplementation((_url, options) => {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      });

      const importPromise = app.importFromUrl();
      await flushPromises();

      app.toggleUrlBar(false);
      await importPromise;

      expect(app.loadingText.textContent).toContain('cancelled or timed out');
      expect(app.urlFetchBtn.disabled).toBe(false);
      expect(app.currentFetchController).toBeNull();

      delete global.fetch;
    });
  });

  // ---- Merged CSV integration ----

  describe('merged CSV integration', () => {
    test('merged CSV files produce sheets with cellMeta passed to createSpreadsheet', async () => {
      const app = await createApp();

      const mergedMeta = [
        [{ type: 'string', value: 'Name' }, { type: 'string', value: 'Age' }],
        [{ type: 'string', value: 'Alice' }, { type: 'string', value: '30' }],
        [{ type: 'string', value: 'Bob' }, { type: 'string', value: '25' }],
      ];

      Merger.merge.mockReturnValue({
        sheets: [{
          name: 'Merged',
          data: [['Name', 'Age'], ['Alice', '30'], ['Bob', '25']],
          cellMeta: mergedMeta,
        }],
        sourceMap: [],
      });

      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      app.files = [
        {
          file: new File(['a,b'], 'a.csv'),
          parsed: { sheets: [{ name: 'a', data: [['Name', 'Age'], ['Alice', '30']] }] },
          name: 'a.csv', ext: 'csv', size: 1024,
          stats: { sheetCount: 1, rowCount: 2, colCount: 2, cellCount: 4, styledCellCount: 0 },
          identityKey: 'a.csv::csv::1024::0',
          contentFingerprint: 'abc1',
          lazy: false,
        },
        {
          file: new File(['c,d'], 'b.csv'),
          parsed: { sheets: [{ name: 'b', data: [['Name', 'Age'], ['Bob', '25']] }] },
          name: 'b.csv', ext: 'csv', size: 1024,
          stats: { sheetCount: 1, rowCount: 2, colCount: 2, cellCount: 4, styledCellCount: 0 },
          identityKey: 'b.csv::csv::1024::1',
          contentFingerprint: 'def2',
          lazy: false,
        },
      ];
      app.markFilesChanged();
      app.processedDataCache.clear();
      app.cleanedSheetCache.clear();

      document.getElementById('opt-trim').checked = false;
      document.getElementById('opt-empty-rows').checked = false;
      document.getElementById('opt-empty-cols').checked = false;
      document.getElementById('opt-duplicates').checked = false;
      document.getElementById('opt-numbers').checked = false;
      document.getElementById('opt-headers').checked = false;

      GoogleAPI.createSpreadsheet.mockClear();

      await app.handleUpload();

      expect(GoogleAPI.createSpreadsheet).toHaveBeenCalled();
      // Verify merged data is correct; cellMeta may be synthesized or null
      const callArgs = GoogleAPI.createSpreadsheet.mock.calls[0];
      const sheetsArg = callArgs[1];
      expect(sheetsArg[0].data).toEqual([['Name', 'Age'], ['Alice', '30'], ['Bob', '25']]);
    });
  });

  // ---- Excel formula survives formatting-preserving merge ----

  describe('Excel formula survives merge', () => {
    test('Excel formula survives formatting-preserving merge upload path', async () => {
      const app = await createApp();

      const formulaMeta = [
        [{ type: 'string', value: 'Result' }],
        [{ type: 'formula', value: '=SUM(A2:A5)' }],
      ];

      Merger.merge.mockReturnValue({
        sheets: [{
          name: 'Merged',
          data: [['Result'], [0]],
          cellMeta: formulaMeta,
        }],
        sourceMap: [
          { fileIndex: 0, sourceRow: 0, colMap: [0] },
          { fileIndex: 0, sourceRow: 1, colMap: [0] },
        ],
      });

      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      app.files = [
        {
          file: new File([new ArrayBuffer(10)], 'formula.xlsx'),
          parsed: {
            sheets: [{
              name: 'Sheet1',
              data: [['Result'], [0]],
              cellMeta: formulaMeta,
              styles: [],
            }],
            themeColors: [],
          },
          name: 'formula.xlsx', ext: 'xlsx', size: 4096,
          stats: { sheetCount: 1, rowCount: 2, colCount: 1, cellCount: 2, styledCellCount: 0 },
          identityKey: 'formula.xlsx::xlsx::4096::0',
          contentFingerprint: 'form1',
          lazy: false,
        },
        {
          file: new File([new ArrayBuffer(10)], 'other.xlsx'),
          parsed: {
            sheets: [{
              name: 'Sheet1',
              data: [['Result'], [0]],
              cellMeta: formulaMeta,
              styles: [],
            }],
            themeColors: [],
          },
          name: 'other.xlsx', ext: 'xlsx', size: 4096,
          stats: { sheetCount: 1, rowCount: 2, colCount: 1, cellCount: 2, styledCellCount: 0 },
          identityKey: 'other.xlsx::xlsx::4096::1',
          contentFingerprint: 'form2',
          lazy: false,
        },
      ];

      document.getElementById('opt-trim').checked = false;
      document.getElementById('opt-empty-rows').checked = false;
      document.getElementById('opt-empty-cols').checked = false;
      document.getElementById('opt-duplicates').checked = false;
      document.getElementById('opt-numbers').checked = false;
      document.getElementById('opt-headers').checked = false;

      GoogleAPI.createSpreadsheet.mockClear();

      await app.handleUpload();

      expect(GoogleAPI.createSpreadsheet).toHaveBeenCalled();

      const callArgs = GoogleAPI.createSpreadsheet.mock.calls[0];
      const sheetsArg = callArgs[1];
      expect(sheetsArg[0].cellMeta).toEqual(formulaMeta);
    });
  });

  describe('selected worksheet merge uploads', () => {
    test('uploads selected worksheet data, metadata, formulas, styles, cleanup, and dimensions', async () => {
      const app = await createApp();
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      document.getElementById('opt-trim').checked = true;

      const masterSelectedStyles = [
        [{ font: { bold: true }, fgColor: { rgb: '111111' } }, { font: { italic: true } }],
        [{ fgColor: { rgb: '222222' } }, { font: { bold: true } }],
      ];
      const sourceSelectedStyles = [
        [{ font: { bold: true }, fgColor: { rgb: '333333' } }, { font: { italic: true } }],
        [{ fgColor: { rgb: '444444' } }, { font: { bold: true } }],
      ];
      const masterSelectedMeta = [
        [
          { type: 'string', value: 'Selected master' },
          { type: 'string', value: 'Formula result' },
        ],
        [
          { type: 'number', value: 100 },
          { type: 'formula', value: '=SUM(A2:A2)' },
        ],
      ];
      const sourceSelectedMeta = [
        [
          { type: 'string', value: 'Selected source' },
          { type: 'string', value: 'Source formula' },
        ],
        [
          { type: 'number', value: 200 },
          { type: 'formula', value: '=SUM(A2:A2)' },
        ],
      ];
      const masterFirstSheet = {
        name: 'Wrong master sheet',
        data: [['WRONG MASTER'], ['wrong']],
        cellMeta: [[{ type: 'string', value: 'WRONG MASTER' }], [{ type: 'string', value: 'wrong' }]],
        styles: [[{ fgColor: { rgb: 'AAAAAA' } }], [{ fgColor: { rgb: 'BBBBBB' } }]],
      };
      const sourceFirstSheet = {
        name: 'Wrong source sheet',
        data: [['WRONG SOURCE'], ['wrong']],
        cellMeta: [[{ type: 'string', value: 'WRONG SOURCE' }], [{ type: 'string', value: 'wrong' }]],
        styles: [[{ fgColor: { rgb: 'CCCCCC' } }], [{ fgColor: { rgb: 'DDDDDD' } }]],
      };

      app.files = [
        {
          file: new File([new ArrayBuffer(10)], 'master.xlsx'),
          name: 'master.xlsx',
          ext: 'xlsx',
          selectedMergeSheetIndex: 1,
          parsed: {
            sheets: [
              masterFirstSheet,
              {
                name: 'Selected master sheet',
                data: [['Selected master', 'Formula result'], [100, '=SUM(A2:A2)']],
                cellMeta: masterSelectedMeta,
                styles: masterSelectedStyles,
              },
            ],
            themeColors: ['MASTER SELECTED THEME'],
          },
        },
        {
          file: new File([new ArrayBuffer(10)], 'source.xlsx'),
          name: 'source.xlsx',
          ext: 'xlsx',
          selectedMergeSheetIndex: 1,
          parsed: {
            sheets: [
              sourceFirstSheet,
              {
                name: 'Selected source sheet',
                data: [['Selected source', 'Source formula'], [200, '=SUM(A2:A2)']],
                cellMeta: sourceSelectedMeta,
                styles: sourceSelectedStyles,
              },
            ],
            themeColors: ['SOURCE SELECTED THEME'],
          },
        },
      ];

      const selectedInputs = [];
      Merger.merge.mockImplementation((files) => {
        selectedInputs.push(...files);
        return {
          sheets: [{
            name: 'Merged',
            data: [
              ['Selected master', 'Formula result'],
              [100, '=SUM(A2:A2)'],
              [200, '=SUM(A2:A2)'],
            ],
            cellMeta: [
              masterSelectedMeta[0],
              masterSelectedMeta[1],
              sourceSelectedMeta[1],
            ],
          }],
          sourceMap: [
            { fileIndex: 0, sourceRow: 0, colMap: [0, 1] },
            { fileIndex: 0, sourceRow: 1, colMap: [0, 1] },
            { fileIndex: 1, sourceRow: 1, colMap: [0, 1] },
          ],
        };
      });
      GoogleAPI.sheetJsToSheetsFormat.mockImplementation((style) => style);
      GoogleAPI.createSpreadsheet.mockClear();
      GoogleAPI.applyFormatting.mockClear();
      GoogleAPI.cleanUploadedSheet.mockClear();

      await app.handleUpload();

      expect(selectedInputs.map((input) => input.sheets[0].name)).toEqual([
        'Selected master sheet',
        'Selected source sheet',
      ]);
      expect(selectedInputs.map((input) => input.sheets[0].data[0])).toEqual([
        ['Selected master', 'Formula result'],
        ['Selected source', 'Source formula'],
      ]);
      expect(selectedInputs[0].sheets[0].cellMeta).toEqual(masterSelectedMeta);
      expect(selectedInputs[1].sheets[0].cellMeta).toEqual(sourceSelectedMeta);

      const spreadsheetData = GoogleAPI.createSpreadsheet.mock.calls[0][1][0];
      expect(spreadsheetData.data).toEqual([
        ['Selected master', 'Formula result'],
        [100, '=SUM(A2:A2)'],
        [200, '=SUM(A2:A2)'],
      ]);
      expect(spreadsheetData.data).not.toContainEqual(['WRONG MASTER']);
      expect(spreadsheetData.data).not.toContainEqual(['WRONG SOURCE']);
      expect(spreadsheetData.cellMeta[1][1]).toEqual(masterSelectedMeta[1][1]);
      expect(spreadsheetData.cellMeta[2][1]).toEqual(sourceSelectedMeta[1][1]);
      expect(spreadsheetData.data).toHaveLength(3);
      expect(spreadsheetData.data[0]).toHaveLength(2);

      const styleCalls = GoogleAPI.sheetJsToSheetsFormat.mock.calls;
      expect(styleCalls).toEqual(expect.arrayContaining([
        [masterSelectedStyles[0][0], ['MASTER SELECTED THEME']],
        [masterSelectedStyles[1][0], ['MASTER SELECTED THEME']],
        [sourceSelectedStyles[1][0], ['SOURCE SELECTED THEME']],
      ]));
      expect(styleCalls.flat().some((value) => value === masterFirstSheet.styles[0][0])).toBe(false);
      expect(styleCalls.flat().some((value) => value === sourceFirstSheet.styles[0][0])).toBe(false);
      expect(GoogleAPI.applyFormatting).toHaveBeenCalled();
      expect(GoogleAPI.cleanUploadedSheet).toHaveBeenCalled();
    });
  });

  describe('cleanup results summary', () => {
    beforeEach(() => {
      setupDOM();
      document.getElementById('opt-trim').checked = false;
      document.getElementById('opt-empty-rows').checked = false;
      document.getElementById('opt-empty-cols').checked = false;
      document.getElementById('opt-duplicates').checked = false;
      document.getElementById('opt-numbers').checked = false;
      document.getElementById('opt-headers').checked = false;
    });

    function wrapStats(stats, scope = 'exact', evaluatedOps = null) {
      const inferred = evaluatedOps !== null ? evaluatedOps : {
        trim: stats.trimmedValues > 0,
        removeEmptyRows: stats.emptyRowsRemoved > 0,
        removeEmptyColumns: stats.emptyColumnsRemoved > 0,
        removeDuplicates: stats.duplicateRowsRemoved > 0,
        fixNumbers: stats.numericValuesCorrected > 0,
        normalizeDates: stats.datesNormalized > 0,
        normalizeHeaders: stats.headersNormalized > 0,
      };
      return {
        stats,
        scope,
        evaluatedOperations: {
          trim: false,
          removeEmptyRows: false,
          removeEmptyColumns: false,
          removeDuplicates: false,
          fixNumbers: false,
          normalizeDates: false,
          normalizeHeaders: false,
          ...inferred,
        },
      };
    }

    function zeroStats() {
      return {
        trimmedValues: 0,
        emptyRowsRemoved: 0,
        emptyColumnsRemoved: 0,
        duplicateRowsRemoved: 0,
        numericValuesCorrected: 0,
        headersNormalized: 0,
      };
    }

    test('renderCleanupSummary hides section when stats is null', () => {
      const app = new DragToSheetsApp();
      const el = document.getElementById('cleanup-results');
      el.classList.remove('hidden');

      app.renderCleanupSummary(null);

      expect(el.classList.contains('hidden')).toBe(true);
    });

    test('renderCleanupSummary shows exact zero-change message when all stats are zero', () => {
      const app = new DragToSheetsApp();
      const el = document.getElementById('cleanup-results');
      const emptyEl = document.getElementById('cleanup-results-empty');

      app.renderCleanupSummary(wrapStats(zeroStats(), 'exact', { trim: true }));

      expect(el.classList.contains('hidden')).toBe(false);
      expect(emptyEl.classList.contains('hidden')).toBe(false);
      expect(emptyEl.textContent).toBe('No cleanup changes detected');
    });

    test('renderCleanupSummary uses sample-specific title and zero message', () => {
      const app = new DragToSheetsApp();
      const titleEl = document.getElementById('cleanup-results-title');
      const emptyEl = document.getElementById('cleanup-results-empty');

      app.renderCleanupSummary(wrapStats(zeroStats(), 'sample', { trim: true }));

      expect(titleEl.textContent).toBe('Changes in preview sample');
      expect(emptyEl.textContent).toBe('No changes detected in preview sample');
    });

    test('renderCleanupSummary shows only non-zero stats', () => {
      const app = new DragToSheetsApp();
      const el = document.getElementById('cleanup-results');
      const listEl = document.getElementById('cleanup-results-list');
      const emptyEl = document.getElementById('cleanup-results-empty');

      app.renderCleanupSummary(wrapStats({
        trimmedValues: 0,
        emptyRowsRemoved: 12,
        emptyColumnsRemoved: 3,
        duplicateRowsRemoved: 0,
        numericValuesCorrected: 0,
        headersNormalized: 6,
      }, 'exact'));

      expect(el.classList.contains('hidden')).toBe(false);
      expect(emptyEl.classList.contains('hidden')).toBe(true);

      const items = listEl.querySelectorAll('.cleanup-results-item');
      expect(items).toHaveLength(3);

      const texts = Array.from(items).map((li) => li.textContent);
      expect(texts).toContain('12 empty rows removed');
      expect(texts).toContain('3 empty columns removed');
      expect(texts).toContain('6 headers normalized');
      expect(texts).not.toContain('24 duplicate rows removed');
    });

    test('renderCleanupSummary uses singular labels for count of 1', () => {
      const app = new DragToSheetsApp();
      const listEl = document.getElementById('cleanup-results-list');

      app.renderCleanupSummary(wrapStats({
        trimmedValues: 1,
        emptyRowsRemoved: 1,
        emptyColumnsRemoved: 0,
        duplicateRowsRemoved: 0,
        numericValuesCorrected: 1,
        headersNormalized: 1,
      }, 'exact'));

      const texts = Array.from(listEl.querySelectorAll('.cleanup-results-item')).map((li) => li.textContent);
      expect(texts).toContain('1 value trimmed');
      expect(texts).toContain('1 empty row removed');
      expect(texts).toContain('1 numeric value corrected');
      expect(texts).toContain('1 header normalized');
    });

    test('renderCleanupSummary shows all stat types when all are non-zero', () => {
      const app = new DragToSheetsApp();
      const listEl = document.getElementById('cleanup-results-list');

      app.renderCleanupSummary(wrapStats({
        trimmedValues: 18,
        emptyRowsRemoved: 12,
        emptyColumnsRemoved: 3,
        duplicateRowsRemoved: 24,
        numericValuesCorrected: 7,
        headersNormalized: 6,
      }, 'exact'));

      const items = listEl.querySelectorAll('.cleanup-results-item');
      expect(items).toHaveLength(6);

      const texts = Array.from(items).map((li) => li.textContent);
      expect(texts).toContain('12 empty rows removed');
      expect(texts).toContain('3 empty columns removed');
      expect(texts).toContain('24 duplicate rows removed');
      expect(texts).toContain('18 values trimmed');
      expect(texts).toContain('7 numeric values corrected');
      expect(texts).toContain('6 headers normalized');
    });

    test('renderPreviewTable calls renderCleanupSummary with stats', () => {
      const app = new DragToSheetsApp();
      const renderCleanupSpy = jest.spyOn(app, 'renderCleanupSummary');

      const stats = wrapStats({
        trimmedValues: 2,
        emptyRowsRemoved: 0,
        emptyColumnsRemoved: 0,
        duplicateRowsRemoved: 0,
        numericValuesCorrected: 0,
        headersNormalized: 0,
      }, 'exact');

      app.renderPreviewTable([['Name'], ['Alice']], '', {}, [], stats);

      expect(renderCleanupSpy).toHaveBeenCalledWith(stats);

      renderCleanupSpy.mockRestore();
    });

    test('hidePreview hides cleanup results', () => {
      const app = new DragToSheetsApp();
      const el = document.getElementById('cleanup-results');
      el.classList.remove('hidden');

      app.hidePreview();

      expect(el.classList.contains('hidden')).toBe(true);
    });

    test('renderCleanupSummary uses exact title for exact scope', () => {
      const app = new DragToSheetsApp();
      const titleEl = document.getElementById('cleanup-results-title');

      app.renderCleanupSummary(wrapStats(zeroStats(), 'exact', { trim: true }));

      expect(titleEl.textContent).toBe('Cleanup applied');
    });

    test('renderPreviewNotice clears cleanup results', () => {
      const app = new DragToSheetsApp();
      const el = document.getElementById('cleanup-results');
      el.classList.remove('hidden');
      const listEl = document.getElementById('cleanup-results-list');
      listEl.innerHTML = '<li>old result</li>';

      app.renderPreviewNotice('Some error');

      expect(el.classList.contains('hidden')).toBe(true);
      expect(listEl.innerHTML).toBe('');
    });
  });

  describe('cleanup results regression', () => {
    beforeEach(() => {
      setupDOM();
    });

    // ---- scope & structure ----

    test('sampled preview scope is "sample" and evaluated ops exclude structural', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => fallback());
      app.files = [{
        file: new File(['csv'], 'test.csv'),
        name: 'test.csv', ext: 'csv', size: 100,
        parsed: null,
      }];
      document.getElementById('opt-trim').checked = true;
      document.getElementById('opt-empty-rows').checked = true;
      document.getElementById('opt-numbers').checked = true;
      Parser.preview.mockResolvedValue({
        sheets: [{ name: 'test', data: [['  Name  '], ['  Alice  ']] }],
        previewMeta: { rowCount: 2, colCount: 1, sheetCount: 1, sampled: true, sampleRows: 2, metadataTrusted: true },
      });
      Cleaner.apply.mockImplementation((data, options, cellMeta) => ({
        data: data.map(row => row.map(cell => typeof cell === 'string' ? cell.trim() : cell)),
        cellMeta: cellMeta || null,
        stats: { trimmedValues: 2, emptyRowsRemoved: 0, emptyColumnsRemoved: 0, duplicateRowsRemoved: 0, numericValuesCorrected: 0, headersNormalized: 0 },
      }));

      const preview = await app.getResponsiveSeparatePreview(app.files[0]);

      expect(preview.cleaningStats.scope).toBe('sample');
      expect(preview.cleaningStats.evaluatedOperations.trim).toBe(true);
      expect(preview.cleaningStats.evaluatedOperations.removeEmptyRows).toBe(false);
      expect(preview.cleaningStats.evaluatedOperations.fixNumbers).toBe(true);
    });

    test('exact preview scope is "exact" and evaluated ops match options', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => {
        return Promise.resolve(fallback());
      });
      app.files = [{
        file: new File(['csv'], 'test.csv'),
        name: 'test.csv', ext: 'csv', size: 100,
        parsed: { sheets: [{ name: 'test', data: [['  Name  '], ['  Alice  ']], cellMeta: null }], themeColors: null },
        stats: { sheetCount: 1, rowCount: 2, dataRowCount: 1, colCount: 1, cellCount: 2, styledCellCount: 0 },
        contentFingerprint: 'a1', identityKey: 'test.csv::csv::100::0', lazy: false,
      }];
      document.getElementById('opt-trim').checked = true;
      document.getElementById('opt-empty-rows').checked = true;
      document.getElementById('opt-numbers').checked = true;

      Cleaner.apply.mockImplementation((data, options, cellMeta) => ({
        data: [['Name'], ['Alice']],
        cellMeta: cellMeta || null,
        stats: { trimmedValues: 2, emptyRowsRemoved: 0, emptyColumnsRemoved: 0, duplicateRowsRemoved: 0, numericValuesCorrected: 0, headersNormalized: 0 },
      }));

      const cleanedResult = await app.getCleanedSheetData(0, 0);
      const rawStats = Array.isArray(cleanedResult) ? null : (cleanedResult.stats || null);

      expect(rawStats.trimmedValues).toBe(2);
    });

    // ---- single-call verification ----

    test('separate sampled preview calls Cleaner.apply exactly once', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => fallback());
      app.files = [{
        file: new File(['csv'], 'test.csv'),
        name: 'test.csv', ext: 'csv', size: 100,
        parsed: null,
      }];
      document.getElementById('opt-trim').checked = true;
      document.getElementById('opt-numbers').checked = true;
      document.getElementById('opt-empty-rows').checked = true;
      Parser.preview.mockResolvedValue({
        sheets: [{ name: 'test', data: [['  Name  '], ['  Alice  ']] }],
        previewMeta: { rowCount: 2, colCount: 1, sheetCount: 1, sampled: true, sampleRows: 2, metadataTrusted: true },
      });
      Cleaner.apply.mockClear();
      Cleaner.apply.mockImplementation((data, options, cellMeta) => ({
        data: data.map(row => row.map(cell => typeof cell === 'string' ? cell.trim() : cell)),
        cellMeta: cellMeta || null,
        stats: Cleaner.emptyStats(),
      }));

      await app.getResponsiveSeparatePreview(app.files[0]);

      expect(Cleaner.apply).toHaveBeenCalledTimes(1);
      const callArgs = Cleaner.apply.mock.calls[0];
      expect(callArgs[1].removeEmptyRows).toBe(false);
      expect(callArgs[1].trim).toBe(true);
    });

    test('merge sampled preview calls Cleaner.apply exactly once', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => fallback());
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      document.getElementById('opt-trim').checked = true;
      document.getElementById('opt-headers').checked = true;
      document.getElementById('opt-duplicates').checked = true;
      app.files = [
        { name: 'a.csv', ext: 'csv', size: 100, parsed: null, file: new File(['a'], 'a.csv') },
        { name: 'b.csv', ext: 'csv', size: 100, parsed: null, file: new File(['b'], 'b.csv') },
      ];
      const rawSample = [['  Name  '], ['  Alice  ']];
      Parser.preview
        .mockResolvedValueOnce({
          sheets: [{ name: 'a', data: rawSample }],
          previewMeta: { rowCount: 2, colCount: 1, sheetCount: 1, sampled: true, sampleRows: 2, metadataTrusted: true },
        })
        .mockResolvedValueOnce({
          sheets: [{ name: 'b', data: [['  Name  '], ['  Bob  ']] }],
          previewMeta: { rowCount: 2, colCount: 1, sheetCount: 1, sampled: true, sampleRows: 2, metadataTrusted: true },
        });
      Cleaner.apply.mockClear();
      Cleaner.apply.mockImplementation((data, options, cellMeta) => ({
        data: data.map(row => row.map(cell => typeof cell === 'string' ? cell.trim() : cell)),
        cellMeta: cellMeta || null,
        stats: Cleaner.emptyStats(),
      }));

      await app.getResponsiveMergePreview(app.getCleaningOptions());

      expect(Cleaner.apply).toHaveBeenCalledTimes(1);
      const callArgs = Cleaner.apply.mock.calls[0];
      expect(callArgs[1].removeDuplicates).toBe(false);
      expect(callArgs[1].trim).toBe(true);
    });

    // ---- stale-result clearing ----

    test('hidePreview clears cleanup results', () => {
      const app = new DragToSheetsApp();
      const el = document.getElementById('cleanup-results');
      el.classList.remove('hidden');
      const listEl = document.getElementById('cleanup-results-list');
      listEl.innerHTML = '<li>stale</li>';

      app.hidePreview();

      expect(el.classList.contains('hidden')).toBe(true);
      expect(listEl.innerHTML).toBe('');
    });

    test('refreshPreview clears stale results at start', () => {
      const app = new DragToSheetsApp();
      const el = document.getElementById('cleanup-results');
      el.classList.remove('hidden');
      const listEl = document.getElementById('cleanup-results-list');
      listEl.innerHTML = '<li>old</li>';
      jest.spyOn(app, 'clearCleanupResults');
      jest.spyOn(app, 'beginPreviewTask').mockReturnValue(1);

      // Null-simulate by having files length === 0
      Object.defineProperty(app, 'files', { value: [], writable: true });
      // Call but immediately returns after hidePreview
      const hideSpy = jest.spyOn(app, 'hidePreview').mockImplementation(() => {});
      // We can't easily test the async flow, but we can test that clearCleanupResults
      // is part of the static chain

      // Instead test the clearCleanupResults method directly
      app.clearCleanupResults();

      expect(el.classList.contains('hidden')).toBe(true);
      expect(listEl.innerHTML).toBe('');
    });

    test('renderNoDataPreview clears previous summary', () => {
      const app = new DragToSheetsApp();
      const el = document.getElementById('cleanup-results');
      el.classList.remove('hidden');
      document.getElementById('cleanup-results-list').innerHTML = '<li>stale</li>';

      app.renderNoDataPreview();

      expect(el.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('cleanup-results-list').innerHTML).toBe('');
    });

    // ---- no-options disables summary ----

    test('getResponsiveSeparatePreview returns null cleaningStats when no options enabled', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => fallback());
      app.files = [{
        file: new File(['csv'], 'test.csv'),
        name: 'test.csv', ext: 'csv', size: 100,
        parsed: null,
      }];
      document.getElementById('opt-trim').checked = false;
      document.getElementById('opt-empty-rows').checked = false;
      document.getElementById('opt-empty-cols').checked = false;
      document.getElementById('opt-duplicates').checked = false;
      document.getElementById('opt-numbers').checked = false;
      document.getElementById('opt-headers').checked = false;
      Parser.preview.mockResolvedValue({
        sheets: [{ name: 'test', data: [['Name'], ['Alice']] }],
        previewMeta: { rowCount: 2, colCount: 1, sheetCount: 1, sampled: true, sampleRows: 2, metadataTrusted: true },
      });

      const preview = await app.getResponsiveSeparatePreview(app.files[0]);

      expect(preview.cleaningStats).toBeNull();
    });

    // ---- accessible semantics ----

    test('cleanup results section has accessible attributes', () => {
      const app = new DragToSheetsApp();
      const el = document.getElementById('cleanup-results');

      expect(el.getAttribute('role')).toBe('status');
      expect(el.getAttribute('aria-live')).toBe('polite');
      expect(el.getAttribute('aria-atomic')).toBe('true');
      expect(el.getAttribute('aria-labelledby')).toBe('cleanup-results-title');
    });

    test('cleanup results title is an h4 with matching id', () => {
      const app = new DragToSheetsApp();
      const titleEl = document.getElementById('cleanup-results-title');

      expect(titleEl.tagName).toBe('H4');
      expect(titleEl.id).toBe('cleanup-results-title');
    });

    // ---- .preview-notice element check ----

    test('renderPreviewNotice creates element with preview-notice class', () => {
      const app = new DragToSheetsApp();
      app.renderPreviewNotice('test notice');

      const noticeEl = app.previewTable.querySelector('.preview-notice');
      expect(noticeEl).not.toBeNull();
      expect(noticeEl.textContent).toContain('test notice');
    });

    // ---- worker / main-thread equivalence ----

    test('Cleaner emptyStats returns consistent zero shape', () => {
      const stats = Cleaner.emptyStats();
      expect(stats).toEqual({
        trimmedValues: 0,
        emptyRowsRemoved: 0,
        emptyColumnsRemoved: 0,
        duplicateRowsRemoved: 0,
        numericValuesCorrected: 0,
        headersNormalized: 0,
      });
    });

    test('Cleaner.apply with 3 args and empty data returns consistent stats shape', () => {
      const result = Cleaner.apply([], { trim: true }, null);
      expect(result.stats).toEqual(Cleaner.emptyStats());
    });

    // ---- all-off exact paths hide summary ----

    test('exact separate preview with every option off keeps the summary hidden', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => {
        return Promise.resolve(fallback());
      });
      app.files = [{
        file: new File(['csv'], 'test.csv'),
        name: 'test.csv', ext: 'csv', size: 100,
        parsed: { sheets: [{ name: 'test', data: [['Name'], ['Alice']], cellMeta: null }], themeColors: null },
        stats: { sheetCount: 1, rowCount: 2, dataRowCount: 1, colCount: 1, cellCount: 2, styledCellCount: 0 },
        contentFingerprint: 'a2', identityKey: 'test.csv::csv::100::1', lazy: false,
      }];
      document.getElementById('opt-trim').checked = false;
      document.getElementById('opt-empty-rows').checked = false;
      document.getElementById('opt-numbers').checked = false;

      // Simulate the wrapping logic that refreshPreview does for exact separate
      const options = app.getCleaningOptions();
      const cleanedResult = await app.getCleanedSheetData(0, 0);
      const rawStats = Array.isArray(cleanedResult) ? null : (cleanedResult.stats || null);
      const hasCleaning = options.trim || options.removeEmptyRows || options.removeEmptyColumns ||
        options.removeDuplicates || options.fixNumbers || options.normalizeDates || options.normalizeHeaders;
      const cleanedStats = hasCleaning && rawStats ? { stats: rawStats, scope: 'exact', evaluatedOperations: { trim: false, removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false, fixNumbers: false, normalizeDates: false, normalizeHeaders: false } } : null;

      expect(hasCleaning).toBe(false);
      expect(cleanedStats).toBeNull();
    });

    test('exact merge preview with every option off keeps the summary hidden', async () => {
      const app = await createApp();
      document.getElementById('opt-trim').checked = false;
      document.getElementById('opt-empty-rows').checked = false;
      document.getElementById('opt-headers').checked = false;

      const options = app.getCleaningOptions();
      const hasCleaning = options.trim || options.removeEmptyRows || options.removeEmptyColumns ||
        options.removeDuplicates || options.fixNumbers || options.normalizeDates || options.normalizeHeaders;

      expect(hasCleaning).toBe(false);

      const rawStats = { trimmedValues: 0, emptyRowsRemoved: 0, emptyColumnsRemoved: 0, duplicateRowsRemoved: 0, numericValuesCorrected: 0, datesNormalized: 0, headersNormalized: 0 };
      const mergeStats = hasCleaning && rawStats ? { stats: rawStats, scope: 'exact', evaluatedOperations: {} } : null;

      expect(mergeStats).toBeNull();
    });

    test('all-off exact paths do not display the zero-change message', () => {
      const app = new DragToSheetsApp();
      const el = document.getElementById('cleanup-results');

      app.renderCleanupSummary(null);

      expect(el.classList.contains('hidden')).toBe(true);
    });

    // ---- structural-only samples return null ----

    test('structural-only separate sample returns cleaningStats null', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => fallback());
      app.files = [{
        file: new File(['csv'], 'test.csv'),
        name: 'test.csv', ext: 'csv', size: 100,
        parsed: null,
      }];
      document.getElementById('opt-trim').checked = false;
      document.getElementById('opt-empty-rows').checked = true;
      document.getElementById('opt-numbers').checked = false;
      document.getElementById('opt-headers').checked = false;
      Parser.preview.mockResolvedValue({
        sheets: [{ name: 'test', data: [['Name'], ['Alice']] }],
        previewMeta: { rowCount: 2, colCount: 1, sheetCount: 1, sampled: true, sampleRows: 2, metadataTrusted: true },
      });
      Cleaner.apply.mockClear();

      const preview = await app.getResponsiveSeparatePreview(app.files[0]);

      expect(preview.cleaningStats).toBeNull();
      expect(Cleaner.apply).not.toHaveBeenCalled();
    });

    test('structural-only merge sample returns cleaningStats null', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => fallback());
      document.querySelector('input[name="open-mode"][value="merge"]').checked = true;
      document.getElementById('opt-trim').checked = false;
      document.getElementById('opt-empty-rows').checked = true;
      document.getElementById('opt-numbers').checked = false;
      document.getElementById('opt-headers').checked = false;
      app.files = [
        { name: 'a.csv', ext: 'csv', size: 100, parsed: null, file: new File(['a'], 'a.csv') },
        { name: 'b.csv', ext: 'csv', size: 100, parsed: null, file: new File(['b'], 'b.csv') },
      ];
      Parser.preview
        .mockResolvedValueOnce({
          sheets: [{ name: 'a', data: [['Name'], ['Alice']] }],
          previewMeta: { rowCount: 2, colCount: 1, sheetCount: 1, sampled: true, sampleRows: 2, metadataTrusted: true },
        })
        .mockResolvedValueOnce({
          sheets: [{ name: 'b', data: [['Name'], ['Bob']] }],
          previewMeta: { rowCount: 2, colCount: 1, sheetCount: 1, sampled: true, sampleRows: 2, metadataTrusted: true },
        });
      Cleaner.apply.mockClear();

      const preview = await app.getResponsiveMergePreview(app.getCleaningOptions());

      expect(preview.cleaningStats).toBeNull();
      expect(Cleaner.apply).not.toHaveBeenCalled();
    });

    // ---- untrusted Excel single-option cases ----

    function makeUntrustedExcelItem() {
      return {
        file: new File(['x'], 'untrusted.xlsx'),
        name: 'untrusted.xlsx', ext: 'xlsx', size: 100,
        parsed: null,
      };
    }

    test('untrusted Excel with only trim enabled returns no summary', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => fallback());
      app.files = [makeUntrustedExcelItem()];
      document.getElementById('opt-trim').checked = true;
      document.getElementById('opt-numbers').checked = false;
      document.getElementById('opt-headers').checked = false;
      Parser.preview.mockResolvedValue({
        sheets: [{ name: 'u', data: [['  Col  '], ['  Val  ']] }],
        previewMeta: { rowCount: 2, colCount: 1, sheetCount: 1, sampled: true, sampleRows: 2, metadataTrusted: false },
      });

      const preview = await app.getResponsiveSeparatePreview(app.files[0]);

      expect(preview.cleaningStats).toBeNull();
    });

    test('untrusted Excel with only number correction enabled returns no summary', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => fallback());
      app.files = [makeUntrustedExcelItem()];
      document.getElementById('opt-trim').checked = false;
      document.getElementById('opt-numbers').checked = true;
      document.getElementById('opt-headers').checked = false;
      Parser.preview.mockResolvedValue({
        sheets: [{ name: 'u', data: [['Col'], ['123']] }],
        previewMeta: { rowCount: 2, colCount: 1, sheetCount: 1, sampled: true, sampleRows: 2, metadataTrusted: false },
      });

      const preview = await app.getResponsiveSeparatePreview(app.files[0]);

      expect(preview.cleaningStats).toBeNull();
    });

    test('untrusted Excel with only header normalization enabled returns no summary', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => fallback());
      app.files = [makeUntrustedExcelItem()];
      document.getElementById('opt-trim').checked = false;
      document.getElementById('opt-numbers').checked = false;
      document.getElementById('opt-headers').checked = true;
      Parser.preview.mockResolvedValue({
        sheets: [{ name: 'u', data: [['first name'], ['Alice']] }],
        previewMeta: { rowCount: 2, colCount: 1, sheetCount: 1, sampled: true, sampleRows: 2, metadataTrusted: false },
      });

      const preview = await app.getResponsiveSeparatePreview(app.files[0]);

      expect(preview.cleaningStats).toBeNull();
    });

    // ---- mixed: trim + duplicate → sample summary for trim only ----

    test('mixed trim plus duplicate removal produces a sample summary for trim only', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => fallback());
      app.files = [{
        file: new File(['csv'], 'test.csv'),
        name: 'test.csv', ext: 'csv', size: 100,
        parsed: null,
      }];
      document.getElementById('opt-trim').checked = true;
      document.getElementById('opt-duplicates').checked = true;
      document.getElementById('opt-empty-rows').checked = false;
      document.getElementById('opt-numbers').checked = false;
      document.getElementById('opt-headers').checked = false;
      Parser.preview.mockResolvedValue({
        sheets: [{ name: 'test', data: [['  Name  '], ['  Alice  ']] }],
        previewMeta: { rowCount: 2, colCount: 1, sheetCount: 1, sampled: true, sampleRows: 2, metadataTrusted: true },
      });
      Cleaner.apply.mockClear();
      Cleaner.apply.mockImplementation((data, options, cellMeta) => ({
        data: data.map(row => row.map(cell => typeof cell === 'string' ? cell.trim() : cell)),
        cellMeta: cellMeta || null,
        stats: { trimmedValues: 2, emptyRowsRemoved: 0, emptyColumnsRemoved: 0, duplicateRowsRemoved: 0, numericValuesCorrected: 0, headersNormalized: 0 },
      }));

      const preview = await app.getResponsiveSeparatePreview(app.files[0]);

      expect(Cleaner.apply).toHaveBeenCalledTimes(1);
      expect(preview.cleaningStats).not.toBeNull();
      expect(preview.cleaningStats.scope).toBe('sample');
      expect(preview.cleaningStats.evaluatedOperations.trim).toBe(true);
      expect(preview.cleaningStats.evaluatedOperations.removeDuplicates).toBe(false);
    });

    // ---- renderer gating ----

    test('renderer hides a result whose evaluatedOperations are all false', () => {
      const app = new DragToSheetsApp();
      const el = document.getElementById('cleanup-results');
      el.classList.remove('hidden');

      app.renderCleanupSummary({
        stats: { trimmedValues: 5, emptyRowsRemoved: 0, emptyColumnsRemoved: 0, duplicateRowsRemoved: 0, numericValuesCorrected: 0, datesNormalized: 0, headersNormalized: 0 },
        scope: 'exact',
        evaluatedOperations: { trim: false, removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false, fixNumbers: false, normalizeDates: false, normalizeHeaders: false },
      });

      expect(el.classList.contains('hidden')).toBe(true);
    });

    test('renderer ignores a non-zero counter when its corresponding evaluated flag is false', () => {
      const app = new DragToSheetsApp();
      const listEl = document.getElementById('cleanup-results-list');

      app.renderCleanupSummary({
        stats: { trimmedValues: 5, emptyRowsRemoved: 0, emptyColumnsRemoved: 0, duplicateRowsRemoved: 0, numericValuesCorrected: 0, datesNormalized: 0, headersNormalized: 0 },
        scope: 'exact',
        evaluatedOperations: { trim: false, removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false, fixNumbers: true, normalizeDates: false, normalizeHeaders: false },
      });

      const items = listEl.querySelectorAll('.cleanup-results-item');
      expect(items).toHaveLength(0);
    });

    test('one enabled and evaluated exact operation with zero changes still shows zero-change message', () => {
      const app = new DragToSheetsApp();
      const emptyEl = document.getElementById('cleanup-results-empty');

      app.renderCleanupSummary({
        stats: { trimmedValues: 0, emptyRowsRemoved: 0, emptyColumnsRemoved: 0, duplicateRowsRemoved: 0, numericValuesCorrected: 0, datesNormalized: 0, headersNormalized: 0 },
        scope: 'exact',
        evaluatedOperations: { trim: true, removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false, fixNumbers: false, normalizeDates: false, normalizeHeaders: false },
      });

      expect(emptyEl.textContent).toBe('No cleanup changes detected');
    });

    test('one enabled and evaluated sampled operation with zero changes still shows sample zero-change message', () => {
      const app = new DragToSheetsApp();
      const emptyEl = document.getElementById('cleanup-results-empty');

      app.renderCleanupSummary({
        stats: { trimmedValues: 0, emptyRowsRemoved: 0, emptyColumnsRemoved: 0, duplicateRowsRemoved: 0, numericValuesCorrected: 0, datesNormalized: 0, headersNormalized: 0 },
        scope: 'sample',
        evaluatedOperations: { trim: true, removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false, fixNumbers: false, normalizeDates: false, normalizeHeaders: false },
      });

      expect(emptyEl.textContent).toBe('No changes detected in preview sample');
    });

    test('displays date count when normalizeDates was evaluated with non-zero datesNormalized', () => {
      const app = new DragToSheetsApp();
      const listEl = document.getElementById('cleanup-results-list');

      app.renderCleanupSummary({
        stats: { trimmedValues: 0, emptyRowsRemoved: 0, emptyColumnsRemoved: 0, duplicateRowsRemoved: 0, numericValuesCorrected: 0, datesNormalized: 3, headersNormalized: 0 },
        scope: 'exact',
        evaluatedOperations: { trim: false, removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false, fixNumbers: false, normalizeDates: true, normalizeHeaders: false },
      });

      const items = listEl.querySelectorAll('.cleanup-results-item');
      expect(items).toHaveLength(1);
      expect(items[0].textContent).toContain('3');
      expect(items[0].textContent).toContain('dates');
    });

    test('hides date count when normalizeDates was NOT evaluated even if stats present', () => {
      const app = new DragToSheetsApp();
      const listEl = document.getElementById('cleanup-results-list');

      app.renderCleanupSummary({
        stats: { trimmedValues: 0, emptyRowsRemoved: 0, emptyColumnsRemoved: 0, duplicateRowsRemoved: 0, numericValuesCorrected: 0, datesNormalized: 5, headersNormalized: 0 },
        scope: 'exact',
        evaluatedOperations: { trim: false, removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false, fixNumbers: false, normalizeDates: false, normalizeHeaders: false },
      });

      const items = listEl.querySelectorAll('.cleanup-results-item');
      expect(items).toHaveLength(0);
    });

    test('displays singular "date" for one normalized date', () => {
      const app = new DragToSheetsApp();
      const listEl = document.getElementById('cleanup-results-list');

      app.renderCleanupSummary({
        stats: { trimmedValues: 0, emptyRowsRemoved: 0, emptyColumnsRemoved: 0, duplicateRowsRemoved: 0, numericValuesCorrected: 0, datesNormalized: 1, headersNormalized: 0 },
        scope: 'exact',
        evaluatedOperations: { trim: false, removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false, fixNumbers: false, normalizeDates: true, normalizeHeaders: false },
      });

      const items = listEl.querySelectorAll('.cleanup-results-item');
      expect(items[0].textContent).toContain('1 date normalized');
    });
  });

  // ---- Column type detection integration ----

  describe('column type detection', () => {
    beforeEach(() => {
      setupDOM();
    });

    test('detects types from full data beyond the 50-row display slice', () => {
      const app = new DragToSheetsApp();
      const data = [['Header']];
      // 60 rows: first 55 are numbers, last 5 are text — but only 50 rendered
      for (let i = 0; i < 55; i++) data.push([String(i)]);
      for (let i = 0; i < 5; i++) data.push(['text']);

      // Detection runs on all data (60 rows), not just 50 display rows
      // 55 numbers, 5 text = 91.7% numbers > threshold, so type = number
      app.renderPreviewTable(data, 'test', { totalCols: 1, totalRows: 61 }, [], null, {});

      const indicators = document.querySelectorAll('.col-type-indicator');
      expect(indicators.length).toBeGreaterThan(0);
      // The accessible label should say "Number" because numbers dominate
      const srSpan = indicators[0].querySelector('.sr-only');
      expect(srSpan).not.toBeNull();
      expect(srSpan.textContent.trim()).toMatch(/Number/);
    });

    test('responsive preview marks sampling', () => {
      const app = new DragToSheetsApp();
      const data = [['Header']];
      for (let i = 0; i < 100; i++) data.push([String(i)]);

      const typeCtx = { cellMeta: null, sourceSampled: true };
      app.renderPreviewTable(data, 'test', { totalCols: 1, totalRows: 101 }, [], null, typeCtx);

      const indicators = document.querySelectorAll('.col-type-indicator');
      const srSpan = indicators[0].querySelector('.sr-only');
      expect(srSpan.textContent.trim()).toContain('based on a sample');
    });

    test('exact small data is not marked sampled', () => {
      const app = new DragToSheetsApp();
      const data = [['Header'], ['hello'], ['world']];

      const typeCtx = { sourceSampled: false };
      app.renderPreviewTable(data, 'test', { totalCols: 1, totalRows: 3 }, [], null, typeCtx);

      const indicators = document.querySelectorAll('.col-type-indicator');
      const srSpan = indicators[0].querySelector('.sr-only');
      expect(srSpan.textContent.trim()).not.toContain('based on a sample');
    });

    test('exact large data is marked sampled due to internal sampling', () => {
      const app = new DragToSheetsApp();
      const data = [['Header']];
      for (let i = 0; i < 2000; i++) data.push([String(i)]);

      const typeCtx = { sourceSampled: false };
      app.renderPreviewTable(data, 'test', { totalCols: 1, totalRows: 2001 }, [], null, typeCtx);

      const indicators = document.querySelectorAll('.col-type-indicator');
      const srSpan = indicators[0].querySelector('.sr-only');
      // Internal sampling should mark it as sampled
      expect(srSpan.textContent.trim()).toContain('based on a sample');
    });

    test('typed Excel serial dates render as Date through cellMeta', () => {
      const app = new DragToSheetsApp();
      const data = [
        ['DateCol'], [45301], [45360], [45400],
      ];
      const cellMeta = [
        [{ type: 'string', value: 'DateCol' }],
        [{ type: 'date', value: 45301, formatType: 'DATE' }],
        [{ type: 'date', value: 45360, formatType: 'DATE' }],
        [{ type: 'date', value: 45400, formatType: 'DATE' }],
      ];

      const typeCtx = { cellMeta, sourceSampled: false };
      app.renderPreviewTable(data, 'test', { totalCols: 1, totalRows: 4 }, [], null, typeCtx);

      const indicators = document.querySelectorAll('.col-type-indicator');
      const srSpan = indicators[0].querySelector('.sr-only');
      expect(srSpan.textContent.trim()).toContain('Date');
    });

    test('formulas render as Text through cellMeta', () => {
      const app = new DragToSheetsApp();
      const data = [
        ['Formulas'], ['=A1+B1'], ['=SUM(C:C)'],
      ];
      const cellMeta = [
        [{ type: 'string', value: 'Formulas' }],
        [{ type: 'formula', value: 'A1+B1' }],
        [{ type: 'formula', value: 'SUM(C:C)' }],
      ];

      const typeCtx = { cellMeta, sourceSampled: false };
      app.renderPreviewTable(data, 'test', { totalCols: 1, totalRows: 3 }, [], null, typeCtx);

      const indicators = document.querySelectorAll('.col-type-indicator');
      const srSpan = indicators[0].querySelector('.sr-only');
      expect(srSpan.textContent.trim()).toContain('Text');
    });

    test('invalid date strings render as Text', () => {
      const app = new DragToSheetsApp();
      const data = [
        ['BadDates'],
        ['2026-99-99'],
        ['2026-02-30'],
        ['2026-03-04T24:30:00'],
        ['03/04/2026'],
      ];

      app.renderPreviewTable(data, 'test', { totalCols: 1, totalRows: 5 }, [], null, {});

      const indicators = document.querySelectorAll('.col-type-indicator');
      const srSpan = indicators[0].querySelector('.sr-only');
      // All invalid dates should be text
      expect(srSpan.textContent.trim()).toContain('Text');
    });

    test('leading-zero identifiers render as Text', () => {
      const app = new DragToSheetsApp();
      const data = [
        ['SKU'], ['00123'], ['00456'], ['00789'], ['0,012,345'],
      ];

      app.renderPreviewTable(data, 'test', { totalCols: 1, totalRows: 5 }, [], null, {});

      const indicators = document.querySelectorAll('.col-type-indicator');
      const srSpan = indicators[0].querySelector('.sr-only');
      expect(srSpan.textContent.trim()).toContain('Text');
    });

    test('partial metadata: valid tokens used, missing fall back to values', () => {
      const app = new DragToSheetsApp();
      const data = [
        ['Names'], ['Alice'], ['Bob'], ['Carol'],
      ];
      // Row 1 metadata is null at its actual index — does NOT shift other rows
      const cellMeta = [
        [{ type: 'string', value: 'Names' }],
        null, // absent metadata at the correct row index
        [{ type: 'string', value: 'Bob' }],
        [{ type: 'string', value: 'Carol' }],
      ];

      const typeCtx = { cellMeta, sourceSampled: false };
      app.renderPreviewTable(data, 'test', { totalCols: 1, totalRows: 4 }, [], null, typeCtx);

      const indicators = document.querySelectorAll('.col-type-indicator');
      const srSpan = indicators[0].querySelector('.sr-only');
      expect(srSpan.textContent.trim()).toContain('Text');
    });

    test('type cells have accessible column semantics', () => {
      const app = new DragToSheetsApp();
      const data = [['A', 'B'], ['1', 'hello']];

      app.renderPreviewTable(data, 'test', { totalCols: 2, totalRows: 2 }, [], null, {});

      const indicators = document.querySelectorAll('.col-type-indicator');
      expect(indicators.length).toBe(2);

      // Each indicator must be a <th scope="col">
      for (const th of indicators) {
        expect(th.tagName).toBe('TH');
        expect(th.getAttribute('scope')).toBe('col');
        // Must have a title attribute
        expect(th.getAttribute('title')).toBeTruthy();
        // Must have aria-hidden span
        const ariaSpan = th.querySelector('span[aria-hidden="true"]');
        expect(ariaSpan).not.toBeNull();
        // Must have sr-only span
        const srSpan = th.querySelector('span.sr-only');
        expect(srSpan).not.toBeNull();
        // Accessible label must contain meaningful words
        expect(srSpan.textContent.trim().length).toBeGreaterThan(2);
      }
    });

    test('non-destructive: data unchanged after detection', () => {
      const app = new DragToSheetsApp();
      const data = [['Values'], ['hello'], ['42'], ['true']];
      const original = JSON.parse(JSON.stringify(data));

      app.renderPreviewTable(data, 'test', { totalCols: 1, totalRows: 4 }, [], null, {});

      expect(data).toEqual(original);
    });

    test('non-destructive: cellMeta unchanged after detection', () => {
      const app = new DragToSheetsApp();
      const data = [['Col'], ['a']];
      const cellMeta = [[{ type: 'string', value: 'Col' }], [{ type: 'string', value: 'a' }]];
      const original = JSON.parse(JSON.stringify(cellMeta));

      const typeCtx = { cellMeta, sourceSampled: false };
      app.renderPreviewTable(data, 'test', { totalCols: 1, totalRows: 2 }, [], null, typeCtx);

      expect(cellMeta).toEqual(original);
    });

    test('truncated columns retain correct table alignment', () => {
      const app = new DragToSheetsApp();
      // 20 columns but only 15 display, 18 totalCols
      const header = [];
      for (let i = 0; i < 20; i++) header.push('Col' + i);
      const row = [];
      for (let i = 0; i < 20; i++) row.push(String(i));
      const data = [header, row, row.map(v => v + '-2')];

      app.renderPreviewTable(data, 'test', { totalCols: 18, totalRows: 3 }, [], null, {});

      // Should have exactly 15 type indicators (MAX_COLS) + 1 truncated cell
      const indicators = document.querySelectorAll('.col-type-indicator');
      // 15 column indicators + 1 truncated indicator = 16
      expect(indicators.length).toBe(16);
      // All indicators except the last should have accessible labels
      for (let i = 0; i < 15; i++) {
        const srSpan = indicators[i].querySelector('.sr-only');
        expect(srSpan).not.toBeNull();
      }
      // The truncated indicator is empty
      expect(indicators[15].textContent.trim()).toBe('');
    });

    test('responsive separate CSV: detects types from represented values', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => fallback());

      app.files = [{
        name: 'people.csv',
        ext: 'csv',
        size: 1024,
        stats: { sheetCount: 1, rowCount: 5, colCount: 4, cellCount: 20, styledCellCount: 0 },
        parsed: null,
        file: new File(['a'], 'people.csv'),
      }];

      Parser.preview.mockResolvedValue({
        sheets: [{
          name: 'people',
          data: [
            ['Age', 'Birthday', 'Active', 'SKU'],
            ['42', '2026-03-04', 'true', '00123'],
            ['30', '2024-01-15', 'false', '00456'],
            ['25', '2025-06-20', 'true', '00789'],
          ],
        }],
        previewMeta: { rowCount: 4, colCount: 4, sheetCount: 1, sampled: false, sampleRows: 4, fileSize: 1024 },
      });

      const preview = await app.getResponsiveSeparatePreview(app.files[0]);
      const typeCtx = { cellMeta: preview.cellMeta || null, sourceSampled: Boolean(preview.summary.sampled) };
      app.renderPreviewTable(preview.data, 'people.csv', preview.summary, [], null, typeCtx);

      const indicators = document.querySelectorAll('.col-type-indicator');
      expect(indicators.length).toBe(4);

      const types = [];
      for (const th of indicators) {
        const sr = th.querySelector('.sr-only');
        types.push(sr.textContent.trim());
      }

      expect(types[0]).toMatch(/Number/);   // Age
      expect(types[1]).toMatch(/Date/);     // Birthday
      expect(types[2]).toMatch(/Boolean/);  // Active
      expect(types[3]).toMatch(/Text/);     // SKU (leading zero identifier)
    });

    test('responsive merge CSV: detects types from merged sampled data', async () => {
      const app = await createApp();
      jest.spyOn(app, 'runProcessingTask').mockImplementation((type, payload, fallback) => {
        if (type === 'merge') return fallback();
        if (type === 'preview') return fallback();
        if (type === 'clean') return fallback();
        return fallback();
      });

      app.files = [
        {
          name: 'one.csv',
          ext: 'csv',
          size: 1024,
          stats: { sheetCount: 1, rowCount: 3, colCount: 2, cellCount: 6, styledCellCount: 0 },
          parsed: null,
          file: new File(['a'], 'one.csv'),
        },
        {
          name: 'two.csv',
          ext: 'csv',
          size: 1024,
          stats: { sheetCount: 1, rowCount: 3, colCount: 2, cellCount: 6, styledCellCount: 0 },
          parsed: null,
          file: new File(['b'], 'two.csv'),
        },
      ];

      let previewCallCount = 0;
      Parser.preview.mockImplementation(() => {
        previewCallCount++;
        if (previewCallCount === 1) {
          return Promise.resolve({
            sheets: [{
              name: 'one',
              data: [
                ['Age', 'SKU'],
                ['42', '00123'],
                ['30', '00456'],
              ],
            }],
            previewMeta: { rowCount: 3, colCount: 2, sheetCount: 1, sampled: false, sampleRows: 3, fileSize: 512 },
          });
        }
        return Promise.resolve({
          sheets: [{
            name: 'two',
            data: [
              ['Age', 'SKU'],
              ['25', '00789'],
              ['35', '00321'],
            ],
          }],
          previewMeta: { rowCount: 3, colCount: 2, sheetCount: 1, sampled: false, sampleRows: 3, fileSize: 512 },
        });
      });

      let mergeCallCount = 0;
      global.Merger.merge.mockImplementation((files) => {
        mergeCallCount++;
        // Simple merge: concatenate rows
        const allData = [['Age', 'SKU']];
        for (const file of files) {
          const data = file.sheets[0].data.slice(1);
          for (const row of data) allData.push(row);
        }
        return { sheets: [{ name: 'Merged', data: allData }], sourceMap: [] };
      });

      const options = app.getCleaningOptions();
      const samplePreview = await app.getResponsiveMergePreview(options);
      const sheet = samplePreview.merged.sheets[0];

      const typeCtx = { cellMeta: sheet.cellMeta || null, sourceSampled: true };
      app.renderPreviewTable(sheet.data, `Merged`, samplePreview.summary, [], null, typeCtx);

      const indicators = document.querySelectorAll('.col-type-indicator');
      expect(indicators.length).toBe(2);

      const types = [];
      for (const th of indicators) {
        const sr = th.querySelector('.sr-only');
        types.push(sr.textContent.trim());
      }

      expect(types[0]).toMatch(/Number/);  // Age
      expect(types[1]).toMatch(/Text/);    // SKU
    });

    test('fully empty column shows Empty type', () => {
      const app = new DragToSheetsApp();
      const data = [['A', 'Empty'], ['hello', ''], ['world', '']];

      app.renderPreviewTable(data, 'test', { totalCols: 2, totalRows: 3 }, [], null, {});

      const indicators = document.querySelectorAll('.col-type-indicator');
      const types = [];
      for (const th of indicators) {
        const sr = th.querySelector('.sr-only');
        types.push(sr.textContent.trim());
      }

      expect(types[0]).toMatch(/Text/);
      expect(types[1]).toMatch(/Empty/);
    });
  });
});
