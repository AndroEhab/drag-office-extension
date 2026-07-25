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
   * Remove one UTF-8 BOM character from the beginning of delimited text.
   * BOM characters elsewhere in the file are valid field content.
   */
  function stripLeadingBom(text) {
    return text.startsWith('\uFEFF') ? text.slice(1) : text;
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
   * Analyze several complete records and ignore candidate delimiters inside
   * quoted fields. The candidate order provides a deterministic tie-breaker.
   */
  const DELIMITER_CANDIDATES = [',', ';', '\t'];
  const DELIMITER_SAMPLE_CHARS = 4096;
  const DELIMITER_SAMPLE_RECORDS = 20;

  /**
   * Count fields in complete, non-empty records for one delimiter.
   * Newlines inside quoted fields are part of the current record.
   */
  function getFieldCounts(text, delimiter) {
    const sample = text.substring(0, DELIMITER_SAMPLE_CHARS);
    const sampleIsComplete = sample.length === text.length;
    const fieldCounts = [];
    let fieldCount = 1;
    let fieldEmpty = true;
    let recordHasContent = false;
    let inQuotes = false;

    const addRecord = () => {
      if (!recordHasContent || inQuotes) return;
      fieldCounts.push(fieldCount);
      fieldCount = 1;
      fieldEmpty = true;
      recordHasContent = false;
    };

    for (let i = 0; i < sample.length && fieldCounts.length < DELIMITER_SAMPLE_RECORDS; i++) {
      const ch = sample[i];

      if (inQuotes) {
        recordHasContent = true;
        if (ch === '"') {
          if (i + 1 < sample.length && sample[i + 1] === '"') {
            // Escaped quote
            i++;
          } else {
            inQuotes = false;
          }
        }
        continue;
      }

      if (ch === '"' && fieldEmpty) {
        inQuotes = true;
        fieldEmpty = false;
        recordHasContent = true;
      } else if (DELIMITER_CANDIDATES.includes(ch)) {
        if (ch === delimiter) fieldCount++;
        fieldEmpty = true;
        recordHasContent = true;
      } else if (ch === '\r' || ch === '\n') {
        addRecord();
        // Treat CRLF as one record separator.
        if (ch === '\r' && i + 1 < sample.length && sample[i + 1] === '\n') i++;
      } else {
        fieldEmpty = false;
        recordHasContent = true;
      }
    }

    // Do not score a final partial record when the sample was truncated.
    if (sampleIsComplete && fieldCounts.length < DELIMITER_SAMPLE_RECORDS) addRecord();

    return fieldCounts;
  }

  /**
   * Auto-detect CSV delimiter from several complete records near the start.
   * Delimiters inside quoted fields are ignored by getFieldCounts().
   */
  function detectDelimiter(text) {
    let best = null;

    for (const delimiter of DELIMITER_CANDIDATES) {
      const fieldCounts = getFieldCounts(text, delimiter);
      if (fieldCounts.length === 0) continue;

      const frequencies = new Map();
      for (const count of fieldCounts) {
        frequencies.set(count, (frequencies.get(count) || 0) + 1);
      }

      let dominantFieldCount = 0;
      let consistentRecords = 0;
      for (const [count, frequency] of frequencies) {
        if (frequency > consistentRecords) {
          dominantFieldCount = count;
          consistentRecords = frequency;
        }
      }

      // A delimiter that only produces one field is not useful when another
      // candidate can produce multiple fields.
      if (dominantFieldCount <= 1) continue;

      const consistencyScore = consistentRecords / fieldCounts.length;
      if (!best || consistencyScore > best.consistencyScore) {
        best = { delimiter, consistencyScore };
      }
    }

    // Candidate order is the deterministic tie-breaker. Comma is also the
    // safe fallback for empty, single-column, or otherwise unhelpful input.
    return best ? best.delimiter : ',';
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

  /**
   * Normalize an Excel table without stringifying native cell values.
   * Excel metadata and the final parse path both rely on numbers, booleans,
   * and serial date values remaining typed in the data matrix.
   */
  function normalizeNativeTable(data, colCountOverride) {
    const maxCols = colCountOverride == null
      ? data.reduce((max, row) => Math.max(max, row.length), 0)
      : colCountOverride;
    const rows = new Array(data.length);
    for (let r = 0; r < data.length; r++) {
      const src = data[r] || [];
      const dest = new Array(maxCols);
      const len = Math.min(src.length, maxCols);
      for (let c = 0; c < len; c++) {
        dest[c] = src[c] == null ? '' : src[c];
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
    const rawText = typeof file._content === 'string'
      ? file._content.slice(0, maxBytes)
      : await readFile(typeof file.slice === 'function' ? file.slice(0, maxBytes) : file, true);
    const text = stripLeadingBom(rawText);
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
        dataRowCount: exactRows ? Math.max(parsedRows.length - 1, 0) : null,
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
      cellStyles: true,
      cellNF: true,
      sheetRows: sampleRows,
    });

    const requestedSheetIndex = Number(options.sheetIndex);
    const hasSheetSelection = Number.isFinite(requestedSheetIndex);
    const selectedSheetIndex = hasSheetSelection
      ? Math.max(0, Math.min(Math.trunc(requestedSheetIndex), Math.max(workbook.SheetNames.length - 1, 0)))
      : 0;
    const name = workbook.SheetNames[selectedSheetIndex] || 'Sheet1';
    const sheet = workbook.Sheets[name];
    const sampleData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    let sampleColCount = sampleData.reduce((max, row) => Math.max(max, row.length), 0);
    const sampleRef = sheet?.['!ref'];
    if (sampleRef && typeof XLSX.utils.decode_range === 'function') {
      try {
        const range = XLSX.utils.decode_range(sampleRef);
        sampleColCount = Math.max(sampleColCount, range.e.c - range.s.c + 1);
      } catch (_) {
        // Keep the column width derived from the sampled values.
      }
    }
    const normalized = normalizeNativeTable(sampleData, sampleColCount);
    const cellMeta = buildCellMeta(sheet, normalized.rows.length, normalized.colCount);

    // Keep formula rows even when their cached display value is empty, while
    // removing trailing rows that are genuinely empty in both matrices.
    while (normalized.rows.length > 1) {
      const lastIndex = normalized.rows.length - 1;
      const isEmpty = normalized.rows[lastIndex].every((value, ci) => {
        const token = cellMeta[lastIndex]?.[ci];
        if (token?.type === 'formula') return false;
        if (token?.type === 'empty') {
          return value === '' || value === null || value === undefined;
        }
        if (token?.type === 'string') return String(token.value || '').trim().length === 0;
        return value === '' || value === null || value === undefined;
      });
      if (!isEmpty) break;
      normalized.rows.pop();
      cellMeta.pop();
    }
    // Compute whole-workbook totals across every sheet by default. A scoped
    // worksheet preview reports only the selected worksheet's dimensions so
    // merge-mode summaries do not include hidden worksheets.
    let totalRows = 0;
    let totalDataRows = 0;
    let maxColsAll = 0;
    let allExact = true;

    for (const sheetName of workbook.SheetNames) {
      const s = workbook.Sheets[sheetName];
      const ref = s?.['!fullref'] || s?.['!ref'];
      if (!ref) { allExact = false; break; }
      const range = XLSX.utils.decode_range(ref);
      const sheetRows = range.e.r - range.s.r + 1;
      const sheetCols = range.e.c - range.s.c + 1;
      totalRows += sheetRows;
      totalDataRows += Math.max(sheetRows - 1, 0);
      maxColsAll = Math.max(maxColsAll, sheetCols);
    }

    let selectedRows = null;
    let selectedCols = null;
    const selectedFullRef = sheet?.['!fullref'] || sampleRef;
    if (hasSheetSelection && selectedFullRef && typeof XLSX.utils.decode_range === 'function') {
      try {
        const range = XLSX.utils.decode_range(selectedFullRef);
        selectedRows = range.e.r - range.s.r + 1;
        selectedCols = range.e.c - range.s.c + 1;
      } catch (_) {
        // Keep selected worksheet dimensions unknown when its range is invalid.
      }
    }

    const rowCount = hasSheetSelection
      ? selectedRows
      : (allExact ? totalRows : null);
    const dataRowCount = hasSheetSelection
      ? (selectedRows === null ? null : Math.max(selectedRows - 1, 0))
      : (allExact ? totalDataRows : null);
    const colCount = hasSheetSelection
      ? selectedCols
      : (allExact ? maxColsAll : null);
    const previewRowCount = hasSheetSelection ? selectedRows : (allExact ? totalRows : normalized.rows.length);

    const result = {
      sheets: [{ name, data: normalized.rows, cellMeta }],
      previewMeta: {
        rowCount,
        dataRowCount,
        colCount,
        sheetCount: workbook.SheetNames.length,
        sampled: previewRowCount === null || previewRowCount > normalized.rows.length,
        sampleRows: normalized.rows.length,
        fileSize: options.fileSize || 0,
      },
    };
    result.previewMeta.metadataTrusted = hasTypedCellMetadata(result);
    return result;
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
    try {
      while ((match = regex.exec(xml)) !== null) {
        const tag = match[0];
        const rMatch = tag.match(/\br="([^"]+)"/);
        const sMatch = tag.match(/\bs="(\d+)"/);
        if (!rMatch || !rMatch[1]) continue;
        try {
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
          if (col < 0 || row < 0 || !isFinite(col) || !isFinite(row)) continue;
          const styleIdx = sMatch && sMatch[1] ? parseInt(sMatch[1], 10) : 0;
          if (!isFinite(styleIdx)) continue;
          if (!map[row]) map[row] = [];
          map[row][col] = styleIdx;
          hasEntries = true;
        } catch (_) {
          // Skip malformed tag and continue
        }
      }
    } catch (_) {
      // If regex parsing fails entirely, return null
      return null;
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

    const workbook = XLSX.read(arrayBuffer, {
      type: 'array',
      cellStyles: true,
      cellNF: true,
      bookFiles: true,
    });
    const themeColors = extractWorkbookThemeColors(workbook);

    const sheets = workbook.SheetNames.map((name, sheetIdx) => {
      const sheet = workbook.Sheets[name];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      const fullRef = sheet?.['!fullref'] || sheet?.['!ref'];
      let refRows = data.length;
      let rawMaxCols = data.reduce((max, row) => Math.max(max, row.length), 0);
      if (fullRef) {
        const range = XLSX.utils.decode_range(fullRef);
        refRows = range.e.r - range.s.r + 1;
        rawMaxCols = Math.max(rawMaxCols, range.e.c - range.s.c + 1);
      }
      const maxCols = Math.max(rawMaxCols, 1);

      while (data.length < refRows) {
        data.push([]);
      }

      const styles = extractSheetStyles(sheet, refRows, maxCols, workbook, sheetIdx);
      const cellMeta = buildCellMeta(sheet, refRows, maxCols);

      // Preserve native cell types (numbers, booleans, dates)
      const normalized = new Array(refRows);
      for (let ri = 0; ri < refRows; ri++) {
        const src = data[ri];
        const dest = new Array(maxCols);
        const len = Math.min(src.length, maxCols);
        for (let ci = 0; ci < len; ci++) {
          dest[ci] = src[ci] == null ? '' : src[ci];
        }
        for (let ci = len; ci < maxCols; ci++) {
          dest[ci] = '';
        }
        normalized[ri] = dest;
      }

      // Trim trailing empty rows, respecting formula metadata
      while (
        normalized.length > 1 &&
        normalized[normalized.length - 1].every((c, ci) => {
          if (cellMeta && cellMeta[normalized.length - 1]) {
            const token = cellMeta[normalized.length - 1][ci];
            if (!token) return true;
            if (token.type === 'formula') return false;
            return token.type === 'empty' || (token.type === 'string' && String(token.value || '').trim().length === 0);
          }
          return c === '';
        })
      ) {
        normalized.pop();
        if (styles) styles.pop();
        if (cellMeta) cellMeta.pop();
      }

      const result = { name, data: normalized, cellMeta };
      if (styles) result.styles = styles;
      return result;
    });

    return { sheets, themeColors };
  }

  /**
   * Read worksheet names and range-derived dimensions without materializing
   * normalized cell data, styles, or cell metadata.
   */
  async function getWorkbookMetadata(file) {
    const ext = getExtension(file.name);
    const baseName = file.name.replace(/\.[^.]+$/, '');

    if (ext === 'csv' || ext === 'tsv') {
      return {
        sheets: [{ name: baseName, rowCount: null, colCount: null }],
      };
    }

    if (ext !== 'xlsx' && ext !== 'xls') {
      throw new Error(`Unsupported file type: .${ext}`);
    }
    if (typeof XLSX === 'undefined') {
      throw new Error(
        'Excel support requires the SheetJS library. ' +
        'Run "npm run setup" or see README for instructions.'
      );
    }

    const buffer = await readFile(file, false);
    const workbook = XLSX.read(buffer, {
      type: 'array',
      cellStyles: false,
      cellNF: false,
    });
    const sheets = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      const ref = sheet?.['!fullref'] || sheet?.['!ref'];
      if (!ref || typeof XLSX.utils?.decode_range !== 'function') {
        return { name, rowCount: null, colCount: null };
      }

      try {
        const range = XLSX.utils.decode_range(ref);
        return {
          name,
          rowCount: range.e.r - range.s.r + 1,
          colCount: range.e.c - range.s.c + 1,
        };
      } catch (_) {
        return { name, rowCount: null, colCount: null };
      }
    });

    return { sheets };
  }

  /**
   * Build a cell-metadata matrix parallel to the data matrix.
   * Each entry is a token: { type, value, formula?, formatType? }
   * Derived from SheetJS cell objects (t, v, f, z).
   */
  function buildCellMeta(sheet, rowCount, colCount) {
    const colLetters = new Array(colCount);
    for (let ci = 0; ci < colCount; ci++) {
      let s = '';
      let n = ci + 1;
      while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
      colLetters[ci] = s;
    }

    const meta = new Array(rowCount);
    for (let ri = 0; ri < rowCount; ri++) {
      meta[ri] = new Array(colCount);
      for (let ci = 0; ci < colCount; ci++) {
        const cell = sheet[colLetters[ci] + (ri + 1)];
        meta[ri][ci] = tokenFromSheetCell(cell);
      }
    }
    return meta;
  }

  /**
   * Derive a cell token from a SheetJS cell object.
   */
  function tokenFromSheetCell(cell) {
    if (!cell) return { type: 'empty' };

    const t = cell.t;
    const f = cell.f;
    const v = cell.v;
    const z = cell.z;
    const fmtType = classifyNumberFormat(z);

    // Formula cells — preserve formula string
    if (f !== undefined && f !== null) {
      return { type: 'formula', value: f, displayValue: v == null ? '' : v };
    }

    // Date/time determined by number format
    if (fmtType === 'DATE' || fmtType === 'TIME' || fmtType === 'DATE_TIME') {
      return { type: 'date', value: v, formatType: fmtType };
    }

    // Boolean
    if (t === 'b') {
      return { type: 'boolean', value: Boolean(v) };
    }

    // Number
    if (t === 'n') {
      const tok = { type: 'number', value: v };
      if (fmtType === 'TEXT') tok.formatType = 'TEXT';
      return tok;
    }

    // String or empty
    if (v === undefined || v === null || v === '') {
      return { type: 'empty' };
    }
    const tok = { type: 'string', value: String(v) };
    if (fmtType === 'TEXT') tok.formatType = 'TEXT';
    return tok;
  }

  /**
   * Classify a SheetJS number format string (z) into a type.
   * Detects TEXT (@), date, time, and date-time patterns.
   */
  function classifyNumberFormat(z) {
    if (!z || typeof z !== 'string') return undefined;
    if (z === '@') return 'TEXT';

    // "m" is ambiguous in Excel formats (month vs minute).  Treat it as a
    // date component only when the format also contains an unambiguous day or
    // year marker; h:mm and mm:ss are times.
    const hasDate = /[dy]/i.test(z);
    const hasTime = /h{1,2}|s{1,2}/i.test(z);

    if (hasDate && hasTime) return 'DATE_TIME';
    if (hasDate) return 'DATE';
    if (hasTime) return 'TIME';
    return undefined;
  }

  /**
   * Get file extension (lowercase, without dot).
   */
  function getExtension(fileName) {
    const parts = fileName.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  }

  /**
   * Check if a parsed result has typed cell metadata on every sheet.
   * @param {Object} parsed - A parsed result object
   * @returns {boolean}
   */
  function hasTypedCellMetadata(parsed) {
    if (!parsed || !Array.isArray(parsed.sheets) || parsed.sheets.length === 0) return false;
    const VALID_TYPES = new Set(['empty', 'string', 'number', 'boolean', 'formula', 'date']);
    const DATE_TYPES = new Set(['DATE', 'TIME', 'DATE_TIME']);

    return parsed.sheets.every(sheet => {
      if (!Array.isArray(sheet.data) || !Array.isArray(sheet.cellMeta)) return false;
      if (sheet.cellMeta.length !== sheet.data.length) return false;

      return sheet.cellMeta.every((metaRow, ri) => {
        if (!Array.isArray(metaRow)) return false;
        const dataRow = sheet.data[ri];
        if (!Array.isArray(dataRow)) return false;
        const width = dataRow.length;
        if (metaRow.length !== width) return false;

        return metaRow.every((token, ci) => {
          if (!token || typeof token !== 'object') return false;
          if (!VALID_TYPES.has(token.type)) return false;
          const dataValue = dataRow[ci];

          if (token.type === 'number') {
            if (typeof token.value !== 'number' || !isFinite(token.value)) return false;
          } else if (token.type === 'boolean') {
            if (typeof token.value !== 'boolean') return false;
          } else if (token.type === 'string') {
            if (typeof token.value !== 'string') return false;
          } else if (token.type === 'formula') {
            if (!token.value || typeof token.value !== 'string' || token.value.trim() === '') return false;
          } else if (token.type === 'date') {
            if (typeof token.value !== 'number' || !isFinite(token.value)) return false;
            if (!token.formatType || !DATE_TYPES.has(token.formatType)) return false;
          } else if (token.type === 'empty') {
            if (dataValue !== null && dataValue !== undefined && dataValue !== '') return false;
          }

          return true;
        });
      });
    });
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
        const buffer = await readFile(file, false);
        const delimiter = ext === 'tsv' ? '\t' : null; // null = auto-detect
        
        // Try Rust/WASM implementation first
        if (typeof RustEngine !== 'undefined' && RustEngine.ready()) {
          try {
            const result = await RustEngine.parseCsv(
              new Uint8Array(buffer),
              delimiter,
              options
            );
            if (result && Array.isArray(result.sheets)) {
              return result;
            }
          } catch (_) {
            // Rust WASM not available — fall through to JS implementation
          }
        }

        // JavaScript fallback
        const text = stripLeadingBom(new TextDecoder('utf-8').decode(buffer));
        const finalDelimiter = ext === 'tsv' ? '\t' : detectDelimiter(text);
        const data = parseCsv(text, finalDelimiter);

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
      
      // Try Rust/WASM implementation first for XLSX
      if (ext === 'xlsx' && typeof RustEngine !== 'undefined' && RustEngine.ready()) {
        try {
          const result = await RustEngine.parseXlsx(
            new Uint8Array(buffer),
            options
          );
          if (result && Array.isArray(result.sheets) && hasTypedCellMetadata(result)) {
            return result;
          }
        } catch (_) {
          // Rust WASM not available — fall through to JS implementation
        }
      }

      // Try Rust/WASM implementation for XLS
      if (ext === 'xls' && typeof RustEngine !== 'undefined' && RustEngine.ready()) {
        try {
          const result = await RustEngine.parseXls(
            new Uint8Array(buffer),
            options
          );
          if (result && Array.isArray(result.sheets) && hasTypedCellMetadata(result)) {
            return result;
          }
        } catch (_) {
          // Rust WASM not available — fall through to JS implementation
        }
      }

      // JavaScript fallback
      return parseExcel(buffer, options);
    },

    getWorkbookMetadata,

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
        const delimiter = ext === 'tsv' ? '\t' : detectDelimiter(stripLeadingBom(text));
        return previewDelimited(file, delimiter, baseName, options);
      }

      const buffer = await readFile(file, false);
      
      // Try Rust/WASM for the default/first-sheet preview. For an explicitly
      // selected later worksheet, use the JS path until the Rust API exposes
      // a worksheet selector of its own.
      const requestedSheetIndex = Number(options.sheetIndex);
      const hasLaterSheetSelection = Number.isFinite(requestedSheetIndex) && Math.trunc(requestedSheetIndex) > 0;
      if (!hasLaterSheetSelection && typeof RustEngine !== 'undefined' && RustEngine.ready()) {
        try {
          const previewOptions = {
            ...options,
            previewMode: true,
            maxRows: options.sampleRows || DEFAULT_PREVIEW_ROWS
          };
          
          if (ext === 'xlsx') {
            const result = await RustEngine.parseXlsx(new Uint8Array(buffer), previewOptions);
            if (!result || !Array.isArray(result.sheets)) throw new Error('Invalid WASM preview result');
            return {
              sheets: result.sheets,
              previewMeta: {
                rowCount: null,
                colCount: result.sheets[0]?.data[0]?.length || 0,
                sheetCount: result.sheets.length,
                sampled: true,
                sampleRows: result.sheets[0]?.data.length || 0,
                fileSize: file.size || 0,
                metadataTrusted: hasTypedCellMetadata(result),
              },
            };
          } else if (ext === 'xls') {
            const result = await RustEngine.parseXls(new Uint8Array(buffer), previewOptions);
            if (!result || !Array.isArray(result.sheets)) throw new Error('Invalid WASM preview result');
            return {
              sheets: result.sheets,
              previewMeta: {
                rowCount: null,
                colCount: result.sheets[0]?.data[0]?.length || 0,
                sheetCount: result.sheets.length,
                sampled: true,
                sampleRows: result.sheets[0]?.data.length || 0,
                fileSize: file.size || 0,
                metadataTrusted: hasTypedCellMetadata(result),
              },
            };
          }
        } catch (_) {
          // Rust WASM not available — fall through to JS implementation
        }
      }

      // JavaScript fallback
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

    hasTypedCellMetadata,
  };
})();
