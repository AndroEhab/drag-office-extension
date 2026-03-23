/**
 * File parser — handles CSV, TSV, and Excel formats.
 * CSV/TSV are parsed natively (RFC 4180 compliant).
 * Excel (.xlsx/.xls) requires the SheetJS library in lib/.
 *
 * Output format:
 *   { sheets: [{ name: string, data: string[][] }] }
 */

// eslint-disable-next-line no-unused-vars
const Parser = (() => {
  'use strict';

  const SUPPORTED_EXTENSIONS = ['csv', 'tsv', 'xlsx', 'xls'];
  const DEFAULT_PREVIEW_ROWS = 51;
  const DEFAULT_PREVIEW_BYTES = 512 * 1024;

  /**
   * Read a File as text or ArrayBuffer.
   */
  function readFile(file, asText) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      if (asText) {
        reader.readAsText(file);
      } else {
        reader.readAsArrayBuffer(file);
      }
    });
  }

  /**
   * RFC 4180 compliant CSV/TSV parser.
   * Handles quoted fields, escaped quotes, mixed line endings.
   */
  function parseCsv(text, delimiter) {
    const rows = [];
    let current = [];
    let field = '';
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
      const ch = text[i];

      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < text.length && text[i + 1] === '"') {
            // Escaped quote
            field += '"';
            i += 2;
          } else {
            // End of quoted field
            inQuotes = false;
            i++;
          }
        } else {
          field += ch;
          i++;
        }
      } else {
        if (ch === '"' && field.length === 0) {
          inQuotes = true;
          i++;
        } else if (ch === delimiter) {
          current.push(field);
          field = '';
          i++;
        } else if (ch === '\r') {
          current.push(field);
          field = '';
          rows.push(current);
          current = [];
          // Handle \r\n
          if (i + 1 < text.length && text[i + 1] === '\n') i++;
          i++;
        } else if (ch === '\n') {
          current.push(field);
          field = '';
          rows.push(current);
          current = [];
          i++;
        } else {
          field += ch;
          i++;
        }
      }
    }

    // Flush last row
    if (field.length > 0 || current.length > 0) {
      current.push(field);
      rows.push(current);
    }

    // Remove trailing empty rows (from trailing newlines or blank lines)
    while (
      rows.length > 0 &&
      rows[rows.length - 1].every((c) => c === '')
    ) {
      rows.pop();
    }

    return rows;
  }

  /**
   * Auto-detect CSV delimiter from first few lines.
   */
  function detectDelimiter(text) {
    const sample = text.substring(0, 4096);
    const commas = (sample.match(/,/g) || []).length;
    const tabs = (sample.match(/\t/g) || []).length;
    const semicolons = (sample.match(/;/g) || []).length;

    if (tabs > commas && tabs > semicolons) return '\t';
    if (semicolons > commas) return ';';
    return ',';
  }

  function normalizeTable(data) {
    const maxCols = data.reduce((max, row) => Math.max(max, row.length), 0);
    const rows = new Array(data.length);
    for (let r = 0; r < data.length; r++) {
      const src = data[r];
      const dest = new Array(maxCols);
      const len = Math.min(src.length, maxCols);
      for (let c = 0; c < len; c++) {
        dest[c] = src[c] == null ? '' : String(src[c]);
      }
      for (let c = len; c < maxCols; c++) {
        dest[c] = '';
      }
      rows[r] = dest;
    }
    return { colCount: maxCols, rows };
  }

  function trimTrailingEmptyRows(rows) {
    while (rows.length > 0 && rows[rows.length - 1].every((c) => c === '')) {
      rows.pop();
    }
    return rows;
  }

  async function previewDelimited(file, delimiter, sheetName, options = {}) {
    const sampleRows = options.sampleRows || DEFAULT_PREVIEW_ROWS;
    const maxBytes = options.maxBytes || DEFAULT_PREVIEW_BYTES;
    const text = typeof file._content === 'string'
      ? file._content.slice(0, maxBytes)
      : await readFile(typeof file.slice === 'function' ? file.slice(0, maxBytes) : file, true);
    const parsedRows = parseCsv(text, delimiter);
    const truncated = (file.size || 0) > maxBytes;

    if (truncated && !/(\r\n|\r|\n)$/.test(text) && parsedRows.length > 0) {
      parsedRows.pop();
    }

    const exactRows = !truncated;
    const sampledRows = trimTrailingEmptyRows(parsedRows.slice(0, sampleRows));
    const normalized = normalizeTable(sampledRows);

    return {
      sheets: [{ name: sheetName, data: normalized.rows }],
      previewMeta: {
        rowCount: exactRows ? parsedRows.length : null,
        colCount: exactRows
          ? parsedRows.reduce((max, row) => Math.max(max, row.length), 0)
          : normalized.colCount,
        sheetCount: 1,
        sampled: truncated || parsedRows.length > sampleRows,
        sampleRows: normalized.rows.length,
        fileSize: file.size || 0,
      },
    };
  }

  function previewExcel(arrayBuffer, options = {}) {
    if (typeof XLSX === 'undefined') {
      throw new Error(
        'Excel support requires the SheetJS library. ' +
        'Run "npm run setup" or see README for instructions.'
      );
    }

    const sampleRows = options.sampleRows || DEFAULT_PREVIEW_ROWS;
    const workbook = XLSX.read(arrayBuffer, {
      type: 'array',
      cellStyles: false,
      sheetRows: sampleRows,
    });

    const name = workbook.SheetNames[0] || 'Sheet1';
    const sheet = workbook.Sheets[name];
    const sampleData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const normalized = normalizeTable(trimTrailingEmptyRows(sampleData));
    const fullRef = sheet?.['!fullref'] || sheet?.['!ref'];

    let rowCount = normalized.rows.length;
    let colCount = normalized.colCount;
    if (fullRef) {
      const range = XLSX.utils.decode_range(fullRef);
      rowCount = range.e.r - range.s.r + 1;
      colCount = range.e.c - range.s.c + 1;
    }

    return {
      sheets: [{ name, data: normalized.rows }],
      previewMeta: {
        rowCount,
        colCount,
        sheetCount: workbook.SheetNames.length,
        sampled: rowCount > normalized.rows.length,
        sampleRows: normalized.rows.length,
        fileSize: options.fileSize || 0,
      },
    };
  }

  /**
   * Parse the raw sheet XML from workbook.files to build a 2D array of
   * CellXf indices: result[row][col] = xfIndex.  Only works for XLSX
   * (ZIP-based) files.  Avoids address-string construction in the
   * extractSheetStyles hot-loop.
   */
  function buildCellStyleMap(workbook, sheetIndex) {
    if (!workbook.files || !workbook.keys) return null;

    // Find sheet XML paths sorted by sheet number
    const sheetPaths = workbook.keys
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
      .sort((a, b) => {
        const numA = parseInt(a.match(/sheet(\d+)/i)[1], 10);
        const numB = parseInt(b.match(/sheet(\d+)/i)[1], 10);
        return numA - numB;
      });

    if (sheetIndex >= sheetPaths.length) return null;

    const entry = workbook.files[sheetPaths[sheetIndex]];
    if (!entry?.content) return null;

    let xml;
    try {
      const content = entry.content;
      xml =
        typeof content === 'string'
          ? content
          : new TextDecoder('utf-8').decode(content);
    } catch {
      return null;
    }

    // Extract cell refs and style indices from <c> elements into a 2D array
    const map = [];
    let hasEntries = false;
    const regex = /<c\b[^>]*>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const tag = match[0];
      const rMatch = tag.match(/\br="([^"]+)"/);
      const sMatch = tag.match(/\bs="(\d+)"/);
      if (rMatch) {
        // Inline decode: "AB12" → col=27, row=11 (0-indexed)
        const addr = rMatch[1];
        let col = 0, ri = 0;
        while (ri < addr.length && addr.charCodeAt(ri) >= 65) {
          col = col * 26 + (addr.charCodeAt(ri) - 64);
          ri++;
        }
        col--;
        let row = 0;
        while (ri < addr.length) {
          row = row * 10 + (addr.charCodeAt(ri) - 48);
          ri++;
        }
        row--;
        if (!map[row]) map[row] = [];
        map[row][col] = sMatch ? parseInt(sMatch[1], 10) : 0;
        hasEntries = true;
      }
    }

    return hasEntries ? map : null;
  }

  /**
   * Parse an Excel file using SheetJS (must be loaded).
   * When the workbook's full Styles table and raw files are available
   * (XLSX with bookFiles), builds complete style objects (fill + font).
   * Otherwise falls back to cell.s (fill only for XLSX).
   */
  function extractSheetStyles(sheet, rowCount, colCount, workbook, sheetIndex) {
    const styles = new Array(rowCount);

    // Access full style tables from the workbook
    const CellXf = workbook?.Styles?.CellXf;
    const Fonts = workbook?.Styles?.Fonts;
    const Fills = workbook?.Styles?.Fills;

    // Build 2D CellXf index map from the raw sheet XML
    let cellXfMap = null;
    if (CellXf && Fonts && Fills && workbook.files) {
      cellXfMap = buildCellStyleMap(workbook, sheetIndex);
    }

    // Pre-compute column letters once to avoid per-cell encode_cell calls
    const colLetters = new Array(colCount);
    for (let ci = 0; ci < colCount; ci++) {
      let s = '';
      let n = ci + 1;
      while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
      colLetters[ci] = s;
    }

    for (let r = 0; r < rowCount; r++) {
      const styleRow = new Array(colCount);

      if (cellXfMap) {
        // Fast path: 2D array lookup — no address construction needed
        const xfRow = cellXfMap[r];
        for (let c = 0; c < colCount; c++) {
          const xfIndex = xfRow ? xfRow[c] : undefined;
          const xf = xfIndex != null ? CellXf[xfIndex] : null;

          if (xf) {
            const style = {};
            let hasProps = false;

            // Fill (background color)
            const fill = Fills[xf.fillId];
            if (fill) {
              if (fill.fgColor) style.fgColor = fill.fgColor;
              if (fill.bgColor) style.bgColor = fill.bgColor;
              if (fill.patternType) style.patternType = fill.patternType;
              style.fill = fill;
              hasProps = true;
            }

            // Font (text color, bold, italic, size, family, etc.)
            const font = Fonts[xf.fontId];
            if (font) {
              style.font = font;
              hasProps = true;
            }

            // Number format from cell (address needed for sheet object lookup)
            const cell = sheet[colLetters[c] + (r + 1)];
            if (cell?.z) { style.numFmt = cell.z; hasProps = true; }

            // Alignment from CellXf (if present)
            if (xf.alignment) { style.alignment = xf.alignment; hasProps = true; }

            styleRow[c] = hasProps ? style : null;
          } else {
            styleRow[c] = null;
          }
        }
      } else {
        // Fallback for XLS or when bookFiles isn't available
        for (let c = 0; c < colCount; c++) {
          const addr = colLetters[c] + (r + 1);
          const cell = sheet[addr];
          styleRow[c] = cell?.s ?? null;
        }
      }

      styles[r] = styleRow;
    }

    return styles;
  }

  function extractWorkbookThemeColors(workbook) {
    const scheme = workbook?.Themes?.themeElements?.clrScheme;
    if (!Array.isArray(scheme) || scheme.length === 0) return null;

    const colors = scheme.map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const value = entry.rgb || entry.lastClr || entry.sysClr || null;
      return typeof value === 'string' && value.length >= 6
        ? value.slice(-6).toUpperCase()
        : null;
    });

    return colors.some(Boolean) ? colors : null;
  }

  function parseExcel(arrayBuffer, options = {}) {
    if (typeof XLSX === 'undefined') {
      throw new Error(
        'Excel support requires the SheetJS library. ' +
        'Run "npm run setup" or see README for instructions.'
      );
    }

    const preserveFormatting = Boolean(options.preserveFormatting);
    const workbook = XLSX.read(arrayBuffer, {
      type: 'array',
      cellStyles: preserveFormatting,
      bookFiles: preserveFormatting,
    });
    const themeColors = preserveFormatting ? extractWorkbookThemeColors(workbook) : null;

    const sheets = workbook.SheetNames.map((name, sheetIdx) => {
      const sheet = workbook.Sheets[name];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      // Ensure all rows have consistent column count
      const maxCols = data.reduce((max, row) => Math.max(max, row.length), 0);

      const styles = preserveFormatting
        ? extractSheetStyles(sheet, data.length, maxCols, workbook, sheetIdx)
        : null;

      const normalized = new Array(data.length);
      for (let ri = 0; ri < data.length; ri++) {
        const src = data[ri];
        const dest = new Array(maxCols);
        const len = Math.min(src.length, maxCols);
        for (let ci = 0; ci < len; ci++) {
          dest[ci] = src[ci] == null ? '' : String(src[ci]);
        }
        for (let ci = len; ci < maxCols; ci++) {
          dest[ci] = '';
        }
        normalized[ri] = dest;
      }

      // Trim trailing empty rows — cellStyles can extend the sheet range
      // beyond actual data, producing all-empty rows that break merging.
      while (normalized.length > 1 && normalized[normalized.length - 1].every((c) => c === '')) {
        normalized.pop();
        if (styles) styles.pop();
      }

      const result = { name, data: normalized };
      if (styles) result.styles = styles;
      return result;
    });

    return { sheets, themeColors };
  }

  /**
   * Get file extension (lowercase, without dot).
   */
  function getExtension(fileName) {
    const parts = fileName.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  }

  // ---- Public API ----

  return {
    SUPPORTED_EXTENSIONS,

    /**
     * Parse a File object into the standard format.
     * @param {File} file
     * @returns {Promise<{ sheets: Array<{ name: string, data: string[][] }> }>}
     */
    async parse(file, options = {}) {
      const ext = getExtension(file.name);
      const baseName = file.name.replace(/\.[^.]+$/, '');

      if (!SUPPORTED_EXTENSIONS.includes(ext)) {
        throw new Error(`Unsupported file type: .${ext}`);
      }

      if (ext === 'csv' || ext === 'tsv') {
        const text = await readFile(file, true);
        const delimiter = ext === 'tsv' ? '\t' : detectDelimiter(text);
        const data = parseCsv(text, delimiter);

        // Normalize column count
        const maxCols = data.reduce((max, row) => Math.max(max, row.length), 0);
        const normalized = new Array(data.length);
        for (let ri = 0; ri < data.length; ri++) {
          const src = data[ri];
          if (src.length === maxCols) {
            normalized[ri] = src;
          } else {
            const dest = new Array(maxCols);
            for (let ci = 0; ci < src.length; ci++) dest[ci] = src[ci];
            for (let ci = src.length; ci < maxCols; ci++) dest[ci] = '';
            normalized[ri] = dest;
          }
        }

        return { sheets: [{ name: baseName, data: normalized }] };
      }

      // Excel formats
      const buffer = await readFile(file, false);
      return parseExcel(buffer, options);
    },

    async preview(file, options = {}) {
      const ext = getExtension(file.name);
      const baseName = file.name.replace(/\.[^.]+$/, '');

      if (!SUPPORTED_EXTENSIONS.includes(ext)) {
        throw new Error(`Unsupported file type: .${ext}`);
      }

      if (ext === 'csv' || ext === 'tsv') {
        const text = typeof file._content === 'string'
          ? file._content.slice(0, options.maxBytes || DEFAULT_PREVIEW_BYTES)
          : await readFile(
            typeof file.slice === 'function'
              ? file.slice(0, options.maxBytes || DEFAULT_PREVIEW_BYTES)
              : file,
            true
          );
        const delimiter = ext === 'tsv' ? '\t' : detectDelimiter(text);
        return previewDelimited(file, delimiter, baseName, options);
      }

      const buffer = await readFile(file, false);
      return previewExcel(buffer, { ...options, fileSize: file.size || 0 });
    },

    /**
     * Check if a file extension is supported.
     * @param {string} fileName
     * @returns {boolean}
     */
    isSupported(fileName) {
      return SUPPORTED_EXTENSIONS.includes(getExtension(fileName));
    },

    /**
     * Check if Excel parsing is available.
     * @returns {boolean}
     */
    isExcelSupported() {
      return typeof XLSX !== 'undefined';
    },
  };
})();
