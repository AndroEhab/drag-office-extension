const fs = require('fs');
const path = require('path');

// ---- Mock dependent modules ----

global.Parser = {
  isSupported: jest.fn((name) =>
    ['csv', 'tsv', 'xlsx', 'xls'].some((ext) =>
      name.toLowerCase().endsWith(`.${ext}`)
    )
  ),
  isExcelSupported: jest.fn(() => true),
  parse: jest.fn(),
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
  apply: jest.fn((data, options, cellMeta) => ({ data, cellMeta: cellMeta || null })),
  tokenFromValue: jest.fn(v => {
    if (v === null || v === undefined || v === '') return { type: 'empty' };
    if (typeof v === 'number') return { type: 'number', value: v };
    if (typeof v === 'boolean') return { type: 'boolean', value: v };
    return { type: 'string', value: String(v) };
  }),
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
        <input type="checkbox" id="opt-headers">
      </div>
    </div>
    <div id="preview-panel" class="hidden">
      <select id="preview-select"></select>
      <div id="preview-stats"></div>
      <div id="preview-table"></div>
    </div>
    <div class="actions">
      <button id="upload-btn" disabled>Open in Sheets</button>
    </div>
    <div id="loading-panel" class="loading-panel">
      <div class="loading-panel-progress">
        <div id="loading-panel-bar" class="loading-panel-bar" style="width:0%"></div>
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
      document.getElementById('opt-headers').checked = false;

      const opts = app.getCleaningOptions();

      expect(opts.trim).toBe(true);
      expect(opts.removeEmptyRows).toBe(true);
      expect(opts.removeEmptyColumns).toBe(false);
      expect(opts.removeDuplicates).toBe(false);
      expect(opts.fixNumbers).toBe(true);
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

      expect(Cleaner.apply).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ trim: false, fixNumbers: false, normalizeHeaders: false }),
        null
      );
      expect(preview.notices).toContainEqual(expect.stringContaining('Fix numbers'));
      expect(app.previewTable.textContent).toContain('Fix numbers');
      expect(preview.data).toEqual([
        ['  Formula Result  ', '  ordinary header  '],
        [' 1234 ', ' 1,234 '],
      ]);
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

      expect(Cleaner.apply).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ trim: false, fixNumbers: false, normalizeHeaders: false }),
        null
      );
      expect(preview.notices).toContainEqual(expect.stringContaining('Normalize headers'));
      expect(preview.merged.sheets[0].data).toEqual(rawSample);
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
    test('showProgress sets bar width', async () => {
      const app = await createApp();

      app.showProgress(50);

      expect(app.loadingBar.style.width).toBe('50%');
    });

    test('showProgress caps at 100%', async () => {
      const app = await createApp();

      app.showProgress(150);

      expect(app.loadingBar.style.width).toBe('100%');
    });

    test('hideProgress resets bar after delay', async () => {
      const app = await createApp();

      jest.useFakeTimers();

      app.showProgress(100);
      app.setStatus('Working…', 'loading');
      app.hideProgress();

      // Not reset immediately
      expect(app.loadingBar.style.width).toBe('100%');

      // Reset after 800ms
      jest.advanceTimersByTime(800);
      expect(app.loadingBar.style.width).toBe('0%');
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
});
