const fs = require('fs');
const path = require('path');

function getManifestReferencedFiles(rootDir) {
  const manifestPath = path.join(rootDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = new Set();

  files.add('manifest.json');

  if (manifest.icons) {
    for (const icon of Object.values(manifest.icons)) {
      if (typeof icon === 'string') files.add(icon);
    }
  }

  if (manifest.action && manifest.action.default_icon) {
    for (const icon of Object.values(manifest.action.default_icon)) {
      if (typeof icon === 'string') files.add(icon);
    }
  }

  if (manifest.background && manifest.background.service_worker) {
    files.add(manifest.background.service_worker);
  }

  if (manifest.side_panel && manifest.side_panel.default_path) {
    files.add(manifest.side_panel.default_path);
  }

  return [...files];
}

function validateFilesExist(rootDir, filePaths) {
  const missing = [];
  for (const filePath of filePaths) {
    if (!fs.existsSync(path.join(rootDir, filePath))) {
      missing.push(filePath);
    }
  }
  return missing;
}

module.exports = { getManifestReferencedFiles, validateFilesExist };
