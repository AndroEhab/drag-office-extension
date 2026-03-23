'use strict';

// Track the last message id so unhandled-rejection guard can reply
let _lastMessageId = -1;
let _initialized = false;

try {
  importScripts('../lib/xlsx.full.min.js', 'rust_bridge.js', 'parser.js', 'cleaner.js', 'merger.js');
  _initialized = true;
} catch (error) {
  // rust_bridge.js may fail if WASM pkg is missing — that's OK, JS fallback still works
  try {
    importScripts('../lib/xlsx.full.min.js', 'parser.js', 'cleaner.js', 'merger.js');
    _initialized = true;
  } catch (fallbackError) {
    self.postMessage({
      id: -1,
      ok: false,
      error: fallbackError?.message || 'Failed to initialize processing worker',
    });
  }
}

// Catch any unhandled promise rejections that escape the onmessage try-catch.
// Without this the worker stays silent and the main-thread promise hangs forever.
self.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  const id = _lastMessageId;
  if (id >= 0) {
    self.postMessage({
      id,
      ok: false,
      error: event.reason?.message || 'Unhandled worker error',
    });
    _lastMessageId = -1;
  }
});

// Try to initialize WASM in background (non-blocking)
if (typeof RustEngine !== 'undefined') {
  RustEngine.init().catch(() => {
    // WASM init failed in worker — JS fallback will be used
  });
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};
  _lastMessageId = typeof id === 'number' ? id : -1;

  if (!_initialized) {
    self.postMessage({
      id: _lastMessageId,
      ok: false,
      error: 'Worker failed to initialize — required scripts could not be loaded',
    });
    return;
  }

  try {
    let result;

    switch (type) {
      case 'parse':
        result = await Parser.parse(payload.file, payload.options || {});
        break;
      case 'preview':
        result = await Parser.preview(payload.file, payload.options || {});
        break;
      case 'clean':
        result = await Cleaner.apply(payload.data, payload.options || {});
        break;
      case 'merge':
        result = await Merger.merge(payload.files || [], payload.options || {});
        break;
      case 'mergeAndClean': {
        const merged = await Merger.merge(payload.files || [], payload.mergeOptions || {});
        const cleanOpts = payload.cleanOptions || {};
        merged.sheets = await Promise.all(merged.sheets.map(async (sheet) => ({
          name: sheet.name,
          data: await Cleaner.apply(sheet.data, cleanOpts),
        })));
        result = merged;
        break;
      }
      case 'detectMappings':
        result = Merger.detectMappings(payload.files || []);
        break;
      case 'collectHeaders':
        result = Merger.collectHeaders(payload.files || []);
        break;
      case 'collectHeadersByFile':
        result = Merger.collectHeadersByFile(payload.files || [], payload.fileNames || []);
        break;
      default:
        throw new Error(`Unknown worker task: ${type}`);
    }

    _lastMessageId = -1;
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    _lastMessageId = -1;
    self.postMessage({
      id,
      ok: false,
      error: error?.message || 'Worker task failed',
    });
  }
};
