const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const { loadModule } = require('./helpers');
const {
  collectProductionFiles,
  createZip,
  stageFiles,
} = require('../scripts/package');
const {
  getManifestReferencedFiles,
  validateFilesExist,
} = require('../scripts/validate-manifest');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Use the same browser-global module loading convention as the existing Jest
// tests, then provide the small set of controller dependencies used by the
// jsdom integration checks below.
const Parser = loadModule('../sidepanel/parser.js', 'Parser');
const Cleaner = loadModule('../sidepanel/cleaner.js', 'Cleaner');
const Merger = loadModule('../sidepanel/merger.js', 'Merger');
global.Parser = Parser;
global.Cleaner = Cleaner;
global.Merger = Merger;
global.TypeDetector = loadModule('../sidepanel/type-detector.js', 'TypeDetector');
global.GoogleAPI = {
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
  sheetJsToSheetsFormat: jest.fn((style) => style),
  applyFormatting: jest.fn().mockResolvedValue(undefined),
};
global.FileHandleStore = {
  saveHandle: jest.fn().mockResolvedValue('handle-1'),
  getHandle: jest.fn().mockResolvedValue(null),
  deleteHandle: jest.fn().mockResolvedValue(undefined),
  verifyWritePermission: jest.fn().mockResolvedValue(false),
  writeToHandle: jest.fn().mockResolvedValue(undefined),
};
global.lucide = { createIcons: jest.fn() };

let sidepanelCode = fs.readFileSync(
  path.join(ROOT, 'sidepanel', 'sidepanel.js'),
  'utf8'
);
sidepanelCode = sidepanelCode.replace(
  /document\.addEventListener\(\s*['"]DOMContentLoaded['"]\s*,\s*\(\)\s*=>\s*new\s+DragToSheetsApp\(\)\s*\)\s*;?/,
  'global.DragToSheetsApp = DragToSheetsApp;'
);
eval(sidepanelCode);

function makeFile(name, text) {
  const file = new File([text], name, { type: 'text/csv' });
  file._content = text;
  file._buffer = new TextEncoder().encode(text).buffer;
  return file;
}

function setupPanelDom() {
  window.lucide = global.lucide;
  document.body.innerHTML = `
    <button id="theme-toggle" class="theme-toggle" title="Toggle dark mode" aria-label="Toggle dark mode">
      <i data-lucide="moon" class="app-icon" aria-hidden="true"></i>
    </button>
    <div id="drop-zone"></div>
    <input id="file-input" type="file" multiple>
    <ul id="file-list"></ul>
    <span id="file-count"></span>
    <div id="dataset-summary"><span id="summary-files"></span><span id="summary-rows"></span><span id="summary-cols"></span></div>
    <div id="options-panel">
      <div id="merge-option">
        <label id="open-mode-separate-card"><input type="radio" name="open-mode" value="separate" checked></label>
        <label id="open-mode-merge-card"><input type="radio" name="open-mode" value="merge"></label>
        <div id="smart-mapping-option"><input id="opt-smart-mapping" type="checkbox"></div>
        <div id="custom-mapping-option"><div id="custom-mapping-list"></div><button id="custom-mapping-add">Add mapping</button></div>
      </div>
      <div id="mapping-review"><div id="mapping-review-list"></div><button id="mapping-approve-btn">Apply</button><button id="mapping-decline-btn">Decline</button></div>
      <button id="settings-btn" aria-expanded="false"></button>
      <div id="cleaning-options">
        <input id="opt-trim" type="checkbox">
        <input id="opt-empty-rows" type="checkbox">
        <input id="opt-empty-cols" type="checkbox">
        <input id="opt-duplicates" type="checkbox">
        <div id="dup-mode"><input name="dup-mode" value="keep-first" type="radio" checked><input name="dup-mode" value="absolute" type="radio"></div>
        <input id="opt-numbers" type="checkbox">
        <input id="opt-dates" type="checkbox">
        <input id="opt-headers" type="checkbox">
      </div>
    </div>
    <div id="preview-panel"><select id="preview-select"></select><div id="preview-stats"></div><div id="preview-table"></div>
      <section id="cleanup-results"><h4 id="cleanup-results-title"></h4><ul id="cleanup-results-list"></ul><p id="cleanup-results-empty"></p></section>
    </div>
    <div class="actions"><button id="upload-btn" disabled>Open in Sheets</button></div>
    <div id="loading-panel"><progress id="loading-panel-bar" max="100" value="0"></progress><div id="loading-spinner"></div><span id="loading-text"></span><span id="loading-sr-status"></span><span id="loading-sr-alert"></span></div>
    <button id="clear-btn" disabled>Clear</button>
    <button id="url-toggle" aria-expanded="false"></button>
    <div id="url-bar" class="hidden"><input id="url-input"><button id="url-fetch-btn">Import</button></div>
  `;
}

function resetControllerMocks() {
  chrome.storage.session.get.mockReset().mockResolvedValue({});
  chrome.storage.session.set.mockReset().mockResolvedValue(undefined);
  chrome.storage.local.get.mockReset().mockResolvedValue({});
  chrome.storage.local.set.mockReset().mockResolvedValue(undefined);
  chrome.permissions.contains.mockReset().mockResolvedValue(false);
  chrome.permissions.request.mockReset().mockResolvedValue(true);
  chrome.tabs.create.mockReset().mockResolvedValue({});
  chrome.runtime.sendMessage.mockReset().mockResolvedValue(undefined);

  GoogleAPI.createSpreadsheet.mockReset().mockResolvedValue({
    id: 'sheet-123',
    url: 'https://docs.google.com/spreadsheets/d/sheet-123/edit',
  });
  GoogleAPI.uploadFileToDrive.mockReset().mockResolvedValue({
    id: 'drive-456',
    url: 'https://docs.google.com/spreadsheets/d/drive-456/edit',
  });
  GoogleAPI.cleanUploadedSheet.mockReset().mockResolvedValue(undefined);
  GoogleAPI.applyFormatting.mockReset().mockResolvedValue(undefined);
}

function flushPromises() {
  return new Promise((resolve) => process.nextTick(resolve));
}

async function createApp() {
  setupPanelDom();
  const app = new global.DragToSheetsApp();
  await flushPromises();
  return app;
}

function responseFromChunks(chunks, headers = {}) {
  let index = 0;
  const reader = {
    read: jest.fn(async () => {
      if (index >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: chunks[index++] };
    }),
    cancel: jest.fn().mockResolvedValue(undefined),
  };
  return {
    ok: true,
    headers: {
      get: jest.fn((name) => {
        const key = name.toLowerCase();
        return headers[key] === undefined ? null : String(headers[key]);
      }),
    },
    body: {
      getReader: jest.fn(() => reader),
      cancel: jest.fn().mockResolvedValue(undefined),
    },
  };
}

function readBuildText(entryName) {
  return fs.readFileSync(path.join(buildRoot, entryName), 'utf8');
}

let buildRoot;

describe('release-readiness regression suite', () => {
  let tempDir;
  let zip;
  let zipEntries;
  let zipPath;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drag-to-sheets-release-'));
    const stagingDir = path.join(tempDir, 'staging');
    const distDir = path.join(tempDir, 'dist');
    const files = collectProductionFiles(ROOT);
    stageFiles(stagingDir, files, ROOT);
    buildRoot = stagingDir;
    zipPath = await createZip(stagingDir, distDir, ROOT, files);
    zip = new AdmZip(zipPath);
    zipEntries = zip.getEntries().map((entry) => entry.entryName);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetControllerMocks();
  });

  afterEach(() => {
    delete global.fetch;
    jest.useRealTimers();
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('final production package', () => {
    test('matches the release version and contains every manifest reference', () => {
      const packagedManifest = JSON.parse(readBuildText('manifest.json'));
      const references = getManifestReferencedFiles(ROOT);

      expect(packagedManifest.version).toBe(packageJson.version);
      expect(packagedManifest.version_name).toBe(packagedManifest.version);
      expect(path.basename(zipPath)).toBe(`drag-to-sheets-${packagedManifest.version}.zip`);
      expect(validateFilesExist(ROOT, references)).toEqual([]);
      expect(zipEntries).toEqual(expect.arrayContaining(references));
    });

    test('contains no remotely hosted executable code', () => {
      const remoteScriptSources = [];
      const remoteModuleSources = [];

      for (const entry of zipEntries) {
        if (!entry.endsWith('.html') && !entry.endsWith('.js')) continue;
        const text = readBuildText(entry);
        for (const match of text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
          if (/^(?:https?:)?\/\//i.test(match[1])) remoteScriptSources.push(`${entry}:${match[1]}`);
        }
        for (const match of text.matchAll(/\b(?:importScripts|import)\s*\(\s*["']([^"']+)["']/g)) {
          if (/^(?:https?:)?\/\//i.test(match[1])) remoteModuleSources.push(`${entry}:${match[1]}`);
        }
      }

      expect(remoteScriptSources).toEqual([]);
      expect(remoteModuleSources).toEqual([]);
    });

    test('bundles the required SheetJS and Lucide runtime files', () => {
      expect(zipEntries).toEqual(expect.arrayContaining([
        'lib/xlsx.full.min.js',
        'lib/lucide.js',
      ]));

      const sheetJs = readBuildText('lib/xlsx.full.min.js');
      const lucide = readBuildText('lib/lucide.js');
      expect(sheetJs.length).toBeGreaterThan(100000);
      expect(sheetJs).toMatch(/XLSX|make_xlsx_lib/);
      expect(lucide.length).toBeGreaterThan(100000);
      expect(lucide).toContain('createIcons');

      const panelHtml = readBuildText('sidepanel/sidepanel.html');
      expect(panelHtml).toContain('../lib/xlsx.full.min.js');
      expect(panelHtml).toContain('../lib/lucide.js');
    });

    test('declares required permissions and HTTPS-only optional host access', () => {
      expect(manifest.permissions).toEqual(expect.arrayContaining(['sidePanel', 'identity', 'storage']));
      expect(manifest.host_permissions).toEqual(expect.arrayContaining([
        'https://sheets.googleapis.com/*',
        'https://www.googleapis.com/*',
        'https://accounts.google.com/*',
      ]));
      expect(manifest.optional_host_permissions).toEqual(['https://*/*']);
      expect(manifest.optional_host_permissions.every((permission) => permission.startsWith('https://'))).toBe(true);
      expect(manifest.optional_host_permissions.some((permission) => permission.includes('http://'))).toBe(false);
    });

    test('configures the toolbar action and keyboard shortcut', () => {
      expect(manifest.action).toEqual(expect.objectContaining({
        default_title: 'Open Drag to Sheets',
      }));
      expect(manifest.action.default_icon).toEqual(expect.objectContaining({
        '16': 'images/icon-16.png',
        '48': 'images/icon-48.png',
        '128': 'images/icon-128.png',
      }));
      expect(manifest.commands._execute_action).toEqual(expect.objectContaining({
        description: 'Open Drag to Sheets panel',
        suggested_key: {
          default: 'Ctrl+Shift+S',
          mac: 'Command+Shift+S',
        },
      }));
      expect(readBuildText('background.js')).toContain('openPanelOnActionClick');
    });

    test('keeps the Limited Use statement and public homepage privacy link', () => {
      const privacy = readBuildText('privacy.html');
      const homepage = new DOMParser().parseFromString(
        fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
        'text/html'
      );

      expect(privacy).toContain('Limited Use');
      expect(privacy).toMatch(/use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy/i);
      expect(homepage.querySelector('a[href="privacy.html"]')).not.toBeNull();
    });
  });

  describe('local parsing and import flows', () => {
    test('imports a local CSV file without network access', async () => {
      const app = await createApp();
      const file = makeFile('local.csv', 'name,age\nAlice,30');
      app.schedulePreviewRefresh = jest.fn();

      await app.handleFiles([file]);

      expect(app.files).toHaveLength(1);
      expect(app.files[0].parsed.sheets[0].data).toEqual([
        ['name', 'age'],
        ['Alice', '30'],
      ]);
      expect(chrome.permissions.request).not.toHaveBeenCalled();
      expect(global.fetch).toBeUndefined();
    });

    test('requests the submitted HTTPS origin before fetching a URL', async () => {
      const app = await createApp();
      app.urlInput.value = 'https://example.com/data.csv';
      app.handleFiles = jest.fn().mockResolvedValue(undefined);

      let grant;
      chrome.permissions.request.mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
      global.fetch = jest.fn().mockResolvedValue(
        responseFromChunks([new TextEncoder().encode('name\nAlice')], {
          'content-type': 'text/csv',
        })
      );

      const importPromise = app.importFromUrl();
      await Promise.resolve();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ['https://example.com/*'] });
      expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['https://example.com/*'] });

      grant(true);
      await importPromise;

      expect(global.fetch).toHaveBeenCalledWith('https://example.com/data.csv', expect.objectContaining({
        signal: expect.any(AbortSignal),
      }));
      expect(app.handleFiles).toHaveBeenCalledWith([expect.any(File)]);
    });

    test('rejects HTTP URLs before permission or network access', async () => {
      const app = await createApp();
      app.urlInput.value = 'http://example.com/data.csv';
      global.fetch = jest.fn();

      await app.importFromUrl();

      expect(app.loadingText.textContent).toContain('Only HTTPS URLs are supported');
      expect(chrome.permissions.contains).not.toHaveBeenCalled();
      expect(chrome.permissions.request).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('enforces the URL Content-Length limit before reading the body', async () => {
      const app = await createApp();
      app.urlInput.value = 'https://example.com/large.csv';
      chrome.permissions.contains.mockResolvedValue(true);
      const getReader = jest.fn();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: { get: (name) => name === 'content-length' ? String(51 * 1024 * 1024) : null },
        body: { getReader, cancel: jest.fn().mockResolvedValue(undefined) },
      });

      await app.importFromUrl();

      expect(getReader).not.toHaveBeenCalled();
      expect(app.loadingText.textContent).toContain('Maximum supported size is 50 MB');
      expect(app.urlFetchBtn.disabled).toBe(false);
    });

    test('enforces the URL streaming limit when Content-Length is absent', async () => {
      const app = await createApp();
      app.urlInput.value = 'https://example.com/stream.csv';
      chrome.permissions.contains.mockResolvedValue(true);
      global.fetch = jest.fn().mockResolvedValue(
        responseFromChunks([{ byteLength: 50 * 1024 * 1024 + 1 }])
      );

      await app.importFromUrl();

      expect(app.loadingText.textContent).toContain('File too large');
      expect(app.urlInput.classList.contains('url-input--error')).toBe(true);
      expect(app.urlFetchBtn.disabled).toBe(false);
    });
  });

  describe('data transformation regressions', () => {
    test('handles a UTF-8 BOM and detects delimiters outside quoted fields', async () => {
      const file = makeFile(
        'quoted.csv',
        '\uFEFFname;note\nAlice;"a,b"\nBob;"c,d"'
      );

      const result = await Parser.parse(file);

      expect(result.sheets[0].data).toEqual([
        ['name', 'note'],
        ['Alice', 'a,b'],
        ['Bob', 'c,d'],
      ]);
    });

    test('runs the complete cleaning pipeline and reports each applied operation', () => {
      const data = [
        [' name ', '', 'age', 'when'],
        [' Alice ', '', ' 1,234 ', '2026-03-04'],
        ['', '', '', ''],
        [' Alice ', '', ' 1,234 ', '2026-03-04'],
      ];

      const result = Cleaner.apply(data, {
        trim: true,
        removeEmptyRows: true,
        removeEmptyColumns: true,
        removeDuplicates: true,
        duplicateMode: 'keep-first',
        fixNumbers: true,
        normalizeDates: true,
        normalizeHeaders: true,
      }, null);

      expect(result.data).toEqual([
        ['Name', 'Age', 'When'],
        ['Alice', 1234, '2026-03-04'],
      ]);
      expect(result.stats).toEqual(expect.objectContaining({
        trimmedValues: expect.any(Number),
        emptyRowsRemoved: 1,
        emptyColumnsRemoved: 1,
        duplicateRowsRemoved: 1,
        numericValuesCorrected: 1,
        headersNormalized: 3,
        datesNormalized: 1,
      }));
      expect(result.stats.trimmedValues).toBeGreaterThan(0);
    });

    test('merges selected worksheets while ignoring unselected worksheet data', async () => {
      const app = await createApp();
      app.files = [
        {
          name: 'first.xlsx',
          ext: 'xlsx',
          selectedMergeSheetIndex: 1,
          parsed: { sheets: [
            { name: 'Wrong first', data: [['id'], ['wrong-first']] },
            { name: 'Selected first', data: [['id'], ['first']] },
          ] },
        },
        {
          name: 'second.xlsx',
          ext: 'xlsx',
          selectedMergeSheetIndex: 1,
          parsed: { sheets: [
            { name: 'Wrong second', data: [['id'], ['wrong-second']] },
            { name: 'Selected second', data: [['id'], ['second']] },
          ] },
        },
      ];

      const result = await app.getMergedProcessedData({
        trim: false,
        removeEmptyRows: false,
        removeEmptyColumns: false,
        removeDuplicates: false,
        duplicateMode: 'keep-first',
        fixNumbers: false,
        normalizeDates: false,
        normalizeHeaders: false,
      });

      expect(result.sheets[0].data).toEqual([
        ['id'],
        ['first'],
        ['second'],
      ]);
      expect(result.sheets[0].data.flat()).not.toContain('wrong-first');
      expect(result.sheets[0].data.flat()).not.toContain('wrong-second');
    });

    test('supports smart header mapping and explicit custom mapping', () => {
      const smart = Merger.merge([
        { sheets: [{ name: 'a', data: [['First_Name'], ['Alice']] }] },
        { sheets: [{ name: 'b', data: [['First Name'], ['Bob']] }] },
      ], { smartMapping: true });
      expect(smart.sheets[0].data).toEqual([
        ['First_Name'],
        ['Alice'],
        ['Bob'],
      ]);

      const custom = Merger.merge([
        { sheets: [{ name: 'master', data: [['Email'], ['a@example.com']] }] },
        { sheets: [{ name: 'source', data: [['student_email'], ['b@example.com']] }] },
      ], { customMappings: [{ from: 'student_email', to: 'Email' }] });
      expect(custom.sheets[0].data).toEqual([
        ['Email'],
        ['a@example.com'],
        ['b@example.com'],
      ]);
    });
  });

  describe('upload and restoration regressions', () => {
    function lazyEntry(file) {
      return {
        file,
        parsed: null,
        name: file.name,
        ext: file.name.split('.').pop(),
        size: file.size,
        lazy: true,
      };
    }

    test('uploads every file separately in separate mode', async () => {
      const app = await createApp();
      const first = makeFile('first.csv', 'id\n1');
      const second = makeFile('second.csv', 'id\n2');
      app.files = [lazyEntry(first), lazyEntry(second)];

      await app.handleUpload();

      expect(GoogleAPI.uploadFileToDrive).toHaveBeenCalledTimes(2);
      expect(GoogleAPI.uploadFileToDrive.mock.calls.map((call) => call[0])).toEqual([first, second]);
      expect(GoogleAPI.createSpreadsheet).not.toHaveBeenCalled();
      expect(chrome.tabs.create).toHaveBeenCalledTimes(2);
      expect(app.uploading).toBe(false);
    });

    test('per-file upload targets only the requested file', async () => {
      const app = await createApp();
      const first = makeFile('first.csv', 'id\n1');
      const second = makeFile('second.csv', 'id\n2');
      const third = makeFile('third.csv', 'id\n3');
      app.files = [lazyEntry(first), lazyEntry(second), lazyEntry(third)];

      await app.uploadSingleFromList(1);

      expect(GoogleAPI.uploadFileToDrive).toHaveBeenCalledTimes(1);
      expect(GoogleAPI.uploadFileToDrive).toHaveBeenCalledWith(second, 'second', expect.any(Object));
      expect(app.files.map((item) => item.name)).toEqual(['first.csv', 'second.csv', 'third.csv']);
    });

    test('restores files and preferences from session and local storage', async () => {
      chrome.storage.session.get.mockResolvedValue({
        files: [{
          name: 'restored.csv',
          ext: 'csv',
          sheets: [{ name: 'restored', data: [['Name'], ['Alice']] }],
        }],
      });
      chrome.storage.local.get.mockResolvedValue({
        prefs: {
          openMode: 'merge',
          cleaningOptions: { trim: true },
          settingsOpen: true,
          smartMapping: true,
          customMappings: [{ from: 'source', to: 'target' }],
        },
      });

      const app = await createApp();

      expect(app.files).toHaveLength(1);
      expect(app.files[0].parsed.sheets[0].data[1]).toEqual(['Alice']);
      expect(app.getOpenMode()).toBe('merge');
      expect(document.getElementById('opt-trim').checked).toBe(true);
      expect(document.getElementById('settings-btn').getAttribute('aria-expanded')).toBe('true');
      expect(app.smartMappingCheckbox.checked).toBe(true);
      expect(app.customMappings).toEqual([{ from: 'source', to: 'target' }]);
    });

    test('prevents a second upload while the first upload is pending', async () => {
      const app = await createApp();
      const file = makeFile('pending.csv', 'id\n1');
      app.files = [lazyEntry(file)];

      let resolveUpload;
      GoogleAPI.uploadFileToDrive.mockReturnValueOnce(new Promise((resolve) => {
        resolveUpload = resolve;
      }));

      const firstUpload = app.handleUpload();
      await Promise.resolve();
      await app.handleUpload();

      expect(GoogleAPI.uploadFileToDrive).toHaveBeenCalledTimes(1);
      resolveUpload({
        id: 'drive-pending',
        url: 'https://docs.google.com/spreadsheets/d/drive-pending/edit',
      });
      await firstUpload;
      expect(app.uploading).toBe(false);
    });
  });
});
