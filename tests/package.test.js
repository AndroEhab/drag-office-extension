const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const {
  collectProductionFiles,
  createZip,
  stageFiles,
  ZIP_DATE,
} = require('../scripts/package');

const ROOT = path.resolve(__dirname, '..');

describe('collectProductionFiles', () => {
  let files;

  beforeAll(() => {
    files = collectProductionFiles(ROOT);
  });

  test('returns manifest.json', () => {
    expect(files).toContain('manifest.json');
  });

  test('returns background.js', () => {
    expect(files).toContain('background.js');
  });

  test('returns privacy.html', () => {
    expect(files).toContain('privacy.html');
  });

  test('returns all sidepanel files', () => {
    const sidepanel = files.filter(f => f.startsWith('sidepanel/'));
    expect(sidepanel.length).toBeGreaterThanOrEqual(10);
    expect(sidepanel).toContain('sidepanel/sidepanel.html');
    expect(sidepanel).toContain('sidepanel/sidepanel.js');
  });

  test('returns lib files', () => {
    expect(files.filter(f => f.startsWith('lib/')).length).toBe(2);
  });

  test('excludes node_modules', () => {
    expect(files.some(f => f.startsWith('node_modules/'))).toBe(false);
  });

  test('excludes tests directory', () => {
    expect(files.some(f => f.startsWith('tests/'))).toBe(false);
  });

  test('excludes .git directory', () => {
    expect(files.some(f => f.startsWith('.git/'))).toBe(false);
  });

  test('excludes .github directory', () => {
    expect(files.some(f => f.startsWith('.github/'))).toBe(false);
  });

  test('excludes scripts directory', () => {
    expect(files.some(f => f.startsWith('scripts/'))).toBe(false);
  });

  test('excludes dist directory', () => {
    expect(files.some(f => f.startsWith('dist/'))).toBe(false);
  });

  test('excludes tmp-package directory', () => {
    expect(files.some(f => f.startsWith('tmp-package'))).toBe(false);
  });

  test('includes only relative paths with forward slashes', () => {
    files.forEach(f => {
      expect(f).not.toMatch(/^[A-Z]:\\/);
    });
  });

    test('total file count is 20', () => {
      expect(files.length).toBe(20);
  });
});

describe('release ZIP', () => {
  let tempDir;
  let stagingDir;
  let distDir;
  let zipPath;
  let zipEntries;
  let zip;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drag-to-sheets-package-'));
    stagingDir = path.join(tempDir, 'staging');
    distDir = path.join(tempDir, 'dist');

    const files = collectProductionFiles(ROOT);
    stageFiles(stagingDir, files, ROOT);
    zipPath = await createZip(stagingDir, distDir, ROOT, files);

    zip = new AdmZip(zipPath);
    zipEntries = zip.getEntries().map(e => e.entryName).sort();
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('exists and is non-empty', () => {
    const stats = fs.statSync(zipPath);
    expect(stats.size).toBeGreaterThan(0);
  });

  test('contains manifest.json at root', () => {
    expect(zipEntries).toContain('manifest.json');
  });

  test('contains background.js at root', () => {
    expect(zipEntries).toContain('background.js');
  });

  test('contains privacy.html at root', () => {
    expect(zipEntries).toContain('privacy.html');
  });

  test('contains images/ at root', () => {
    expect(zipEntries).toContain('images/icon-16.png');
    expect(zipEntries).toContain('images/icon-48.png');
    expect(zipEntries).toContain('images/icon-128.png');
    expect(zipEntries).toContain('images/logo-horizontal.png');
  });

  test('contains sidepanel/ files', () => {
    expect(zipEntries).toContain('sidepanel/sidepanel.html');
    expect(zipEntries).toContain('sidepanel/sidepanel.js');
    expect(zipEntries).toContain('sidepanel/sidepanel.css');
  });

  test('contains lib/ files', () => {
    expect(zipEntries).toContain('lib/xlsx.full.min.js');
    expect(zipEntries).toContain('lib/lucide.js');
  });

  test('excludes node_modules', () => {
    expect(zipEntries.some(e => e.startsWith('node_modules/'))).toBe(false);
  });

  test('excludes tests directory', () => {
    expect(zipEntries.some(e => e.startsWith('tests/'))).toBe(false);
  });

  test('excludes .git directory', () => {
    expect(zipEntries.some(e => e.startsWith('.git/')) || zipEntries.some(e => e === '.git')).toBe(false);
  });

  test('excludes .github directory', () => {
    expect(zipEntries.some(e => e.startsWith('.github/'))).toBe(false);
  });

  test('excludes scripts directory', () => {
    expect(zipEntries.some(e => e.startsWith('scripts/'))).toBe(false);
  });

  test('excludes dist directory', () => {
    expect(zipEntries.some(e => e.startsWith('dist/'))).toBe(false);
  });

  test('excludes tmp-package directory', () => {
    expect(zipEntries.some(e => e.startsWith('tmp-package'))).toBe(false);
  });

  test('excludes node_modules as a top-level entry', () => {
    expect(zipEntries).not.toContain('node_modules');
    expect(zipEntries).not.toContain('node_modules/');
  });

  test('all entries are at root level or in subdirectories of root', () => {
    zipEntries.forEach(e => {
      const parts = e.split('/');
      expect(parts[0]).not.toBe('..');
      expect(parts[0]).not.toBe('.');
    });
  });

  test('total ZIP entries matches production file count', () => {
    expect(zipEntries.length).toBe(20);
  });

  test('normalizes entry timestamps for reproducible archives', () => {
    zip.getEntries().forEach(entry => {
      expect(entry.header.time.getTime()).toBe(ZIP_DATE.getTime());
    });
  });
});
