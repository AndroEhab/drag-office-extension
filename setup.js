/**
 * Setup script — copies SheetJS library into lib/ for the Chrome extension.
 * Run: npm install && npm run setup
 */

const fs = require('fs');
const path = require('path');

const LIB_DIR = path.join(__dirname, 'lib');
const SOURCE = path.join(__dirname, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js');
const DEST = path.join(LIB_DIR, 'xlsx.full.min.js');
const LUCIDE_SOURCE = path.join(__dirname, 'node_modules', 'lucide', 'dist', 'umd', 'lucide.js');
const LUCIDE_DEST = path.join(LIB_DIR, 'lucide.js');

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

if (fs.existsSync(LUCIDE_SOURCE)) {
  fs.copyFileSync(LUCIDE_SOURCE, LUCIDE_DEST);
  console.log(`Copied Lucide icons to ${LUCIDE_DEST}`);
} else {
  console.warn('Lucide not found — icons will not be available. Run "npm install" first.');
}
