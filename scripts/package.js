const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const AdmZip = require('adm-zip');
const { getManifestReferencedFiles, validateFilesExist } = require('./validate-manifest');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const STAGING = path.join(ROOT, 'tmp-package');

const ZIP_DATE = new Date('1980-01-01T00:00:00Z');

function toArchivePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function collectProductionFiles(rootDir) {
  const files = new Set();

  for (const f of getManifestReferencedFiles(rootDir)) {
    files.add(f);
  }

  files.add('images/logo-horizontal.png');
  files.add('privacy.html');

  const sidepanelDir = path.join(rootDir, 'sidepanel');
  if (fs.existsSync(sidepanelDir)) {
    for (const entry of fs.readdirSync(sidepanelDir)) {
      const full = path.join(sidepanelDir, entry);
      if (fs.statSync(full).isFile()) files.add('sidepanel/' + entry);
    }
  }

  const libDir = path.join(rootDir, 'lib');
  if (fs.existsSync(libDir)) {
    for (const entry of fs.readdirSync(libDir)) {
      const full = path.join(libDir, entry);
      if (fs.statSync(full).isFile()) files.add('lib/' + entry);
    }
  }

  return [...files].sort();
}

function stageFiles(stagingDir, files, rootDir) {
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  for (const file of files) {
    const src = path.join(rootDir, file);
    const dest = path.join(stagingDir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function listStagedFiles(stagingDir) {
  return fs.readdirSync(stagingDir, { recursive: true })
    .map(entry => toArchivePath(entry))
    .filter(entry => fs.statSync(path.join(stagingDir, entry)).isFile())
    .sort();
}

async function createZip(stagingDir, distDir, rootDir, files = listStagedFiles(stagingDir)) {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
  const version = manifest.version;
  const zipName = 'drag-to-sheets-' + version + '.zip';

  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  for (const entry of fs.readdirSync(distDir)) {
    if (entry.endsWith('.zip')) {
      fs.unlinkSync(path.join(distDir, entry));
    }
  }

  const zipPath = path.join(distDir, zipName);
  const zip = new AdmZip();

  for (const entry of [...files].map(toArchivePath).sort()) {
    const fullPath = path.join(stagingDir, entry);
    if (fs.statSync(fullPath).isFile()) {
      zip.addFile(entry, fs.readFileSync(fullPath));
      zip.getEntry(entry).header.time = ZIP_DATE;
    }
  }

  zip.writeZip(zipPath);
  return zipPath;
}

async function main() {
  console.log('--- Packaging Chrome Extension ---\n');
  try {
    process.stdout.write('[1/5] Running setup... ');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'setup.js')], {
      cwd: ROOT, stdio: 'inherit',
    });
    if (r.status !== 0) throw Error('Setup failed.');

    process.stdout.write('[2/5] Validating manifest file references... ');
    const refs = getManifestReferencedFiles(ROOT);
    const missing = validateFilesExist(ROOT, refs);
    if (missing.length) {
      console.error('');
      missing.forEach(f => console.error('  missing: ' + f));
      throw Error('Manifest validation failed.');
    }
    console.log('All ' + refs.length + ' manifest references OK.');

    process.stdout.write('[3/5] Collecting production files... ');
    const files = collectProductionFiles(ROOT);
    console.log(files.length + ' files to package.');

    process.stdout.write('[4/5] Staging files... ');
    stageFiles(STAGING, files, ROOT);
    console.log('done.');

    process.stdout.write('[5/5] Creating ZIP... ');
    const zipPath = await createZip(STAGING, DIST_DIR, ROOT, files);
    const stats = fs.statSync(zipPath);
    console.log('Created ' + path.basename(zipPath) + ' (' + (stats.size / 1024).toFixed(1) + ' KB)');
    console.log('  Location: ' + zipPath);

    console.log('\nDone.');
  } finally {
    if (fs.existsSync(STAGING)) {
      fs.rmSync(STAGING, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = {
  collectProductionFiles,
  createZip,
  listStagedFiles,
  stageFiles,
  toArchivePath,
  ZIP_DATE,
};
