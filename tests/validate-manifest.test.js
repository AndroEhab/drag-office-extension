const path = require('path');
const { getManifestReferencedFiles, validateFilesExist } = require('../scripts/validate-manifest');

const ROOT = path.resolve(__dirname, '..');

describe('getManifestReferencedFiles', () => {
  test('returns manifest.json itself', () => {
    const files = getManifestReferencedFiles(ROOT);
    expect(files).toContain('manifest.json');
  });

  test('returns icon files from icons field', () => {
    const files = getManifestReferencedFiles(ROOT);
    expect(files).toContain('images/logo-icon.png');
  });

  test('returns background service worker', () => {
    const files = getManifestReferencedFiles(ROOT);
    expect(files).toContain('background.js');
  });

  test('returns side panel default path', () => {
    const files = getManifestReferencedFiles(ROOT);
    expect(files).toContain('sidepanel/sidepanel.html');
  });
});

describe('validateFilesExist', () => {
  test('returns empty array when all files exist', () => {
    const files = getManifestReferencedFiles(ROOT);
    const missing = validateFilesExist(ROOT, files);
    expect(missing).toEqual([]);
  });

  test('returns missing paths for non-existent files', () => {
    const missing = validateFilesExist(ROOT, ['missing-file.js']);
    expect(missing).toEqual(['missing-file.js']);
  });

  test('reports multiple missing files', () => {
    const missing = validateFilesExist(ROOT, ['a.test', 'b.test']);
    expect(missing).toEqual(['a.test', 'b.test']);
  });
});
