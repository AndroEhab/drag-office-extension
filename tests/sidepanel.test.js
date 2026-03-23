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
};

global.Cleaner = {
  apply: jest.fn((data) => data),
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

// ---- Load sidepanel module (expose class without auto-instantiation) ----

let spCode = fs.readFileSync(path.resolve(__dirname, '../sidepanel/sidepanel.js'), 'utf-8');
spCode = spCode.replace(
  "document.addEventListener('DOMContentLoaded', () => new DragToSheetsApp());",
  'global.DragToSheetsApp = DragToSheetsApp;'
);
eval(spCode);

// ---- DOM setup ----

function setupDOM() {
  window.lucide = global.lucide;
  document.body.innerHTML = `
    <div id="drop-zone" tabindex="0"></div>
    <input type="file" id="file-input" multiple>
    <ul id="file-list"></ul>
    <span id="file-count"></span>
    <div id="options-panel">
      <div id="merge-option" class="hidden">
        <input type="radio" name="open-mode" value="separate" checked>
        <input type="radio" name="open-mode" value="merge">
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
      <div id="cleaning-options" class="hidden">
        <input type="checkbox" id="opt-trim">
        <input type="checkbox" id="opt-empty-rows">
        <input type="checkbox" id="opt-empty-cols">
        <input type="checkbox" id="opt-duplicates">
        <div id="dup-mode" class="hidden">
          <input type="radio" name="dup-mode" value="keep-first" checked>
          <input type="radio" name="dup-mode" value="absolute">
        </div>
        <input type="checkbox" id="opt-numbers">
        <input type="checkbox" id="opt-headers">
        <input type="checkbox" id="opt-preserve-fmt">
      </div>
    </div>
    <div id="preview-panel" class="hidden">
      <select id="preview-select"></select>
      <div id="preview-stats"></div>
      <div id="preview-table"></div>
    </div>
    <div id="loading-panel" class="loading-panel">
      <div class="loading-panel-progress">
        <div id="loading-panel-bar" class="loading-panel-bar" style="width:0%"></div>
      </div>
      <div class="loading-panel-body">
        <div id="loading-spinner" class="loading-spinner hidden"></div>
        <span id="loading-text" class="loading-text"></span>
      </div>
    </div>
    <button id="upload-btn" disabled>Open in Sheets</button>
    <button id="settings-btn">Settings</button>
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

    test('passes formatting preference into parsing for merge workloads', async () => {
      const app = await createApp();
      Parser.parse.mockResolvedValue({
        sheets: [{ name: 'f', data: [['A']] }],
      });
      document.getElementById('opt-preserve-fmt').checked = true;
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
      document.getElementById('opt-preserve-fmt').checked = true;

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
      document.getElementById('opt-preserve-fmt').checked = true;
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
      document.getElementById('opt-preserve-fmt').checked = true;

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

  // ---- setStatus ----

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
  });

  // ---- URL bar toggle ----

  describe('toggleUrlBar', () => {
    test('opens URL bar', async () => {
      const app = await createApp();

      app.toggleUrlBar(true);

      expect(app.urlBar.classList.contains('hidden')).toBe(false);
      expect(app.urlToggle.getAttribute('aria-expanded')).toBe('true');
    });

    test('closes URL bar', async () => {
      const app = await createApp();
      app.toggleUrlBar(true);

      app.toggleUrlBar(false);

      expect(app.urlBar.classList.contains('hidden')).toBe(true);
      expect(app.urlToggle.getAttribute('aria-expanded')).toBe('false');
    });

    test('toggles when no argument given', async () => {
      const app = await createApp();

      app.toggleUrlBar(); // opens
      expect(app.urlBar.classList.contains('hidden')).toBe(false);

      app.toggleUrlBar(); // closes
      expect(app.urlBar.classList.contains('hidden')).toBe(true);
    });
  });
});
