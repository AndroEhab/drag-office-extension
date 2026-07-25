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

/**
 * Read the width and height of a PNG file from its IHDR chunk.
 */
function readPngSize(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 24) return null;
  // PNG signature (8) + chunk length (4) + "IHDR" (4) + width (4) + height (4)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Validate icon files declared in the manifest have the expected pixel dimensions.
 * Returns an array of { file, expected, actual } error objects.
 */
function validateIconSizes(rootDir) {
  const manifestPath = path.join(rootDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const errors = [];

  const iconFields = [manifest.icons, manifest.action && manifest.action.default_icon].filter(Boolean);

  for (const field of iconFields) {
    for (const [sizeKey, iconPath] of Object.entries(field)) {
      const expected = parseInt(sizeKey, 10);
      if (Number.isNaN(expected)) continue;

      const fullPath = path.join(rootDir, iconPath);
      if (!fs.existsSync(fullPath)) {
        errors.push({ file: iconPath, expected: `${expected}\u00D7${expected}`, actual: 'not found' });
        continue;
      }

      const dims = readPngSize(fullPath);
      if (!dims) {
        errors.push({ file: iconPath, expected: `${expected}\u00D7${expected}`, actual: 'unreadable' });
      } else if (dims.width !== expected || dims.height !== expected) {
        errors.push({ file: iconPath, expected: `${expected}\u00D7${expected}`, actual: `${dims.width}\u00D7${dims.height}` });
      }
    }
  }

  return errors;
}

module.exports = { getManifestReferencedFiles, validateFilesExist, validateIconSizes };
