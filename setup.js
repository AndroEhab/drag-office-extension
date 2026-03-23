/**
 * Setup script — copies SheetJS library into lib/ for the Chrome extension.
 * Run: npm install && npm run setup
 */

const fs = require('fs');
const path = require('path');

const LIB_DIR = path.join(__dirname, 'lib');
const SOURCE = path.join(__dirname, 'node_modules', 'xlsx', 'dist', 'xlsx.mini.min.js');
const DEST = path.join(LIB_DIR, 'xlsx.mini.min.js');

if (!fs.existsSync(SOURCE)) {
  console.error('SheetJS not found. Run "npm install" first.');
  process.exit(1);
}

if (!fs.existsSync(LIB_DIR)) {
  fs.mkdirSync(LIB_DIR, { recursive: true });
}

fs.copyFileSync(SOURCE, DEST);
console.log(`Copied SheetJS (full build) to ${DEST}`);
console.log('Excel support (.xlsx/.xls) with cell formatting is now enabled.');
