const path = require('path');
const { getManifestReferencedFiles, validateFilesExist, validateIconSizes } = require('../scripts/validate-manifest');

const ROOT = path.resolve(__dirname, '..');

describe('getManifestReferencedFiles', () => {
  test('returns manifest.json itself', () => {
    const files = getManifestReferencedFiles(ROOT);
    expect(files).toContain('manifest.json');
  });

  test('returns icon files from icons field', () => {
    const files = getManifestReferencedFiles(ROOT);
    expect(files).toContain('images/icon-16.png');
    expect(files).toContain('images/icon-48.png');
    expect(files).toContain('images/icon-128.png');
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

describe('validateIconSizes', () => {
  test('returns empty array when all icons match expected dimensions', () => {
    const errors = validateIconSizes(ROOT);
    expect(errors).toEqual([]);
  });

  test('reports wrong dimensions for a non-square icon', () => {
    const manifestPath = path.join(ROOT, 'manifest.json');
    const original = require(manifestPath);
    const patched = JSON.parse(JSON.stringify(original));
    patched.icons['16'] = 'images/icon-48.png';

    const restore = jest.spyOn(require('fs'), 'readFileSync').mockImplementation((fp) => {
      if (fp === manifestPath) return JSON.stringify(patched, null, 2);
      // Return fake non-square PNG buffer (48×32)
      const buf = Buffer.alloc(24);
      buf.writeUInt32BE(48, 16); // width
      buf.writeUInt32BE(32, 20); // height
      return buf;
    });

    try {
      const errors = validateIconSizes(ROOT);
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0].file).toBe('images/icon-48.png');
      expect(errors[0].expected).toBe('16\u00D716');
    } finally {
      restore.mockRestore();
    }
  });
});
