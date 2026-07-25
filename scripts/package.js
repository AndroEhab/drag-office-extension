const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getManifestReferencedFiles, validateFilesExist } = require('./validate-manifest');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const STAGING = path.join(ROOT, 'tmp-package');

function main() {
  console.log('--- Packaging Chrome Extension ---\n');

  step('1/5', 'Running setup', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'setup.js')], {
      cwd: ROOT, stdio: 'inherit',
    });
    if (r.status !== 0) die('Setup failed.');
  });

  step('2/5', 'Validating manifest file references', () => {
    const refs = getManifestReferencedFiles(ROOT);
    const missing = validateFilesExist(ROOT, refs);
    if (missing.length) {
      console.error('Missing files referenced in manifest.json:');
      missing.forEach(f => console.error('  ' + f));
      die('Manifest validation failed.');
    }
    console.log('  All ' + refs.length + ' manifest references OK.');
  });

  step('3/5', 'Collecting production files', () => {
    const files = collectProductionFiles(ROOT);
    console.log('  ' + files.length + ' files to package.');
  });

  step('4/5', 'Staging files', () => {
    stageFiles(STAGING, collectProductionFiles(ROOT));
  });

  step('5/5', 'Creating ZIP', () => {
    createZip(STAGING, DIST_DIR);
  });

  console.log('\nDone.');
}

function step(label, description, fn) {
  process.stdout.write('[' + label + '] ' + description + '... ');
  fn();
}

function die(msg) {
  console.error(msg);
  process.exit(1);
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

function stageFiles(stagingDir, files) {
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true });
  }
  for (const file of files) {
    const src = path.join(ROOT, file);
    const dest = path.join(stagingDir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function createZip(stagingDir, distDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
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

  const r = spawnSync('powershell', [
    '-NoProfile',
    '-Command',
    "Compress-Archive -Path '" + stagingDir + "\\*' -DestinationPath '" + zipPath + "' -Force",
  ], { cwd: ROOT, stdio: 'pipe' });
  if (r.status !== 0) {
    console.error(r.stderr ? r.stderr.toString() : '');
    die('Failed to create ZIP.');
  }

  fs.rmSync(stagingDir, { recursive: true });

  const stats = fs.statSync(zipPath);
  console.log('  Created ' + zipName + ' (' + (stats.size / 1024).toFixed(1) + ' KB)');
  console.log('  Location: ' + zipPath);
}

main();
