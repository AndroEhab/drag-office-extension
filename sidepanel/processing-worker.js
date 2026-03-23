'use strict';

try {
  importScripts('../lib/xlsx.full.min.js', 'parser.js', 'cleaner.js', 'merger.js');
} catch (error) {
  self.postMessage({
    id: -1,
    ok: false,
    error: error?.message || 'Failed to initialize processing worker',
  });
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};

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
        result = Cleaner.apply(payload.data, payload.options || {});
        break;
      case 'merge':
        result = Merger.merge(payload.files || [], payload.options || {});
        break;
      case 'mergeAndClean': {
        const merged = Merger.merge(payload.files || [], payload.mergeOptions || {});
        const cleanOpts = payload.cleanOptions || {};
        merged.sheets = merged.sheets.map((sheet) => ({
          name: sheet.name,
          data: Cleaner.apply(sheet.data, cleanOpts),
        }));
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

    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error?.message || 'Worker task failed',
    });
  }
};
