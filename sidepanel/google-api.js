/**
 * Google Sheets & Drive API wrapper.
 * Uses chrome.identity for OAuth 2.0 authentication.
 *
 * Two upload paths:
 *  1. uploadFileToDrive — uploads the raw file to Google Drive with conversion
 *     to Google Sheets. Preserves all original formatting (colors, fonts, etc.)
 *     exactly as Google's own import does.
 *  2. createSpreadsheet — creates a spreadsheet from parsed data arrays.
 *     Used for CSV/TSV or when formatting preservation is not requested.
 */

// eslint-disable-next-line no-unused-vars
const GoogleAPI = (() => {
  'use strict';

  const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
  const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const DEFAULT_THEME_COLORS = [
    'FFFFFF', '000000', 'EEECE1', '1F497D', '4F81BD', 'C0504D',
    '9BBB59', '8064A2', '4BACC6', 'F79646', '0000FF', '800080',
  ];
  const INDEXED_COLORS = {
    0: '000000', 1: 'FFFFFF', 2: 'FF0000', 3: '00FF00', 4: '0000FF', 5: 'FFFF00',
    6: 'FF00FF', 7: '00FFFF', 8: '000000', 9: 'FFFFFF', 10: 'FF0000', 11: '00FF00',
    12: '0000FF', 13: 'FFFF00', 14: 'FF00FF', 15: '00FFFF', 16: '800000', 17: '008000',
    18: '000080', 19: '808000', 20: '800080', 21: '008080', 22: 'C0C0C0', 23: '808080',
    24: '9999FF', 25: '993366', 26: 'FFFFCC', 27: 'CCFFFF', 28: '660066', 29: 'FF8080',
    30: '0066CC', 31: 'CCCCFF', 32: '000080', 33: 'FF00FF', 34: 'FFFF00', 35: '00FFFF',
    36: '800080', 37: '800000', 38: '008080', 39: '0000FF', 40: '00CCFF', 41: 'CCFFFF',
    42: 'CCFFCC', 43: 'FFFF99', 44: '99CCFF', 45: 'FF99CC', 46: 'CC99FF', 47: 'FFCC99',
    48: '3366FF', 49: '33CCCC', 50: '99CC00', 51: 'FFCC00', 52: 'FF9900', 53: 'FF6600',
    54: '666699', 55: '969696', 56: '003366', 57: '339966', 58: '003300', 59: '333300',
    60: '993300', 61: '993366', 62: '333399', 63: '333333',
  };
  const MAX_VALUE_CELLS_PER_REQUEST = 50000;
  const MAX_VALUE_RANGES_PER_REQUEST = 200;
  const MAX_BATCH_REQUESTS = 100;

  // ---- Auth ----

  async function getToken(context) {
    if (context?.tokenPromise) {
      return context.tokenPromise;
    }

    const tokenPromise = chrome.identity
      .getAuthToken({ interactive: true })
      .then((result) => {
        if (!result || !result.token) {
          throw new Error('Google sign-in was cancelled. Please try again and grant access to continue.');
        }
        return result.token;
      })
      .catch((err) => {
        if (err.message?.includes('cancel') || err.message?.includes('denied')) {
          throw new Error('Google sign-in was cancelled. Please grant access to use Google Sheets.');
        }
        throw err;
      });

    if (context) {
      context.tokenPromise = tokenPromise;
    }

    return tokenPromise;
  }

  async function revokeToken() {
    try {
      const result = await chrome.identity.getAuthToken({ interactive: false });
      const token = result.token;
      if (token) {
        await chrome.identity.removeCachedAuthToken({ token });
        await fetch(
          `https://accounts.google.com/o/oauth2/revoke?token=${encodeURIComponent(token)}`
        );
      }
    } catch (_) {
      // No cached token — nothing to revoke
    }
  }

  // ---- HTTP helpers ----

  async function apiRequest(url, options = {}, context) {
    const token = await getToken(context);

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = body.error?.message || JSON.stringify(body);
      } catch (_) {
        detail = response.statusText;
      }
      throw new Error(`Google API ${response.status}: ${detail}`);
    }

    return response.json();
  }

  async function getSpreadsheetInfo(spreadsheetId, context) {
    const cacheKey = `spreadsheet:${spreadsheetId}`;

    if (context?.responseCache?.has(cacheKey)) {
      return context.responseCache.get(cacheKey);
    }

    const infoPromise = apiRequest(
      `${SHEETS_BASE}/${spreadsheetId}?includeGridData=false`,
      {},
      context
    );

    if (context) {
      if (!context.responseCache) context.responseCache = new Map();
      context.responseCache.set(cacheKey, infoPromise);
    }

    return infoPromise;
  }

  // ---- Sheet name helpers ----

  function sanitizeSheetName(name) {
    let safe = String(name || 'Sheet')
      .replace(/[\\/?*[\]]/g, '_')
      .replace(/^'+|'+$/g, '')
      .trim();
    return safe.substring(0, 100) || 'Sheet';
  }

  function getSheetDataBounds(data) {
    const rowCount = Math.max(data?.length || 0, 1);
    const colCount = Math.max(
      data && data.length > 0 ? data.reduce((max, row) => Math.max(max, row.length), 0) : 0,
      1
    );

    return { rowCount, colCount };
  }

  function escapeSheetName(name) {
    return "'" + name.replace(/'/g, "''") + "'";
  }

  /** Convert 0-based column index to spreadsheet letter(s): 0→A, 25→Z, 26→AA */
  function colToLetter(i) {
    let s = '';
    let n = i + 1;
    while (n > 0) {
      n--;
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26);
    }
    return s;
  }

  function normalizeHeaderTitleCase(value) {
    return String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  function countRangeCells(range) {
    return (range.values || []).reduce((sum, row) => sum + Math.max(row.length, 1), 0);
  }

  function buildSheetValueRanges(sheetName, data) {
    const ranges = [];
    let currentRows = [];
    let currentStartRow = 0;
    let currentCells = 0;

    const flush = () => {
      if (currentRows.length === 0) return;
      ranges.push({
        range: `${escapeSheetName(sheetName)}!A${currentStartRow + 1}`,
        values: currentRows,
      });
      currentRows = [];
      currentCells = 0;
    };

    for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
      const row = (data[rowIndex] || []).map((cell) => cell ?? '');
      const rowCells = Math.max(row.length, 1);

      if (rowCells > MAX_VALUE_CELLS_PER_REQUEST) {
        flush();
        for (let colStart = 0; colStart < row.length; colStart += MAX_VALUE_CELLS_PER_REQUEST) {
          ranges.push({
            range: `${escapeSheetName(sheetName)}!${colToLetter(colStart)}${rowIndex + 1}`,
            values: [row.slice(colStart, colStart + MAX_VALUE_CELLS_PER_REQUEST)],
          });
        }
        currentStartRow = rowIndex + 1;
        continue;
      }

      if (currentRows.length > 0 && currentCells + rowCells > MAX_VALUE_CELLS_PER_REQUEST) {
        flush();
        currentStartRow = rowIndex;
      }

      if (currentRows.length === 0) {
        currentStartRow = rowIndex;
      }

      currentRows.push(row);
      currentCells += rowCells;
    }

    flush();
    return ranges;
  }

  /**
   * Build updateCells rows using typed userEnteredValue objects from
   * cell metadata tokens, preserving formulas, numbers, booleans, etc.
   */
  function toSheetsFormula(value) {
    const formula = String(value ?? '');
    return formula.startsWith('=') ? formula : '=' + formula;
  }

  function buildTypedRowEntry(row, cellMetaRow, ri) {
    const values = row.map((cell, ci) => {
      const token = cellMetaRow && cellMetaRow[ci];
      const dataValue = cell;

      if (token && token.type && token.type !== 'empty') {
        switch (token.type) {
          case 'formula':
            return { userEnteredValue: { formulaValue: toSheetsFormula(token.value) } };
          case 'number':
            return { userEnteredValue: { numberValue: token.value } };
          case 'boolean':
            return { userEnteredValue: { boolValue: token.value } };
          case 'date': {
            const fmtType = token.formatType || 'DATE';
            const patterns = { DATE: 'yyyy-mm-dd', TIME: 'hh:mm:ss', DATE_TIME: 'yyyy-mm-dd hh:mm:ss' };
            return {
              userEnteredValue: { numberValue: token.value },
              userEnteredFormat: {
                numberFormat: { type: fmtType, pattern: patterns[fmtType] || patterns.DATE },
              },
            };
          }
          case 'string': {
            const str = String(token.value ?? '');
            return { userEnteredValue: { stringValue: str } };
          }
          default:
            return { userEnteredValue: { stringValue: String(cell ?? '') } };
        }
      }

      if (dataValue !== null && dataValue !== undefined && dataValue !== '') {
        if (typeof dataValue === 'number') return { userEnteredValue: { numberValue: dataValue } };
        if (typeof dataValue === 'boolean') return { userEnteredValue: { boolValue: dataValue } };
        return { userEnteredValue: { stringValue: String(dataValue) } };
      }

      return {};
    });
    return { values };
  }

  function buildTypedUpdateRows(data, cellMeta) {
    const blocks = [];
    let currentRows = [];
    let currentStartRow = 0;
    let currentCells = 0;
    let currentColCount = 0;

    const flush = () => {
      if (currentRows.length === 0) return;
      blocks.push({
        rows: currentRows,
        startRow: currentStartRow,
        endRow: currentStartRow + currentRows.length,
        startColumn: 0,
        endColumn: currentColCount,
        cellCount: currentRows.length * currentColCount,
      });
      currentRows = [];
      currentCells = 0;
      currentColCount = 0;
    };

    for (let ri = 0; ri < data.length; ri++) {
      const row = data[ri] || [];
      const metaRow = cellMeta && cellMeta[ri];
      const rowCells = Math.max(row.length, 1);

      // A single very wide row needs horizontal blocks because Sheets API
      // requests are bounded by cells, not just by the number of rows.
      if (row.length > MAX_VALUE_CELLS_PER_REQUEST) {
        flush();
        for (let colStart = 0; colStart < row.length; colStart += MAX_VALUE_CELLS_PER_REQUEST) {
          const colEnd = Math.min(colStart + MAX_VALUE_CELLS_PER_REQUEST, row.length);
          blocks.push({
            rows: [buildTypedRowEntry(row.slice(colStart, colEnd), metaRow && metaRow.slice(colStart, colEnd), ri)],
            startRow: ri,
            endRow: ri + 1,
            startColumn: colStart,
            endColumn: colEnd,
            cellCount: colEnd - colStart,
          });
        }
        continue;
      }

      const nextColCount = Math.max(currentColCount, rowCells);
      const nextCellCount = (currentRows.length + 1) * nextColCount;
      if (
        currentRows.length > 0 &&
        (currentCells + rowCells > MAX_VALUE_CELLS_PER_REQUEST ||
          nextCellCount > MAX_VALUE_CELLS_PER_REQUEST)
      ) {
        flush();
      }

      if (currentRows.length === 0) {
        currentStartRow = ri;
        currentColCount = rowCells;
      } else {
        currentColCount = Math.max(currentColCount, rowCells);
      }
      currentRows.push(buildTypedRowEntry(row, metaRow, ri));
      currentCells += rowCells;
    }

    flush();

    return blocks;
  }

  function buildValueRangesForSheets(sheetsData) {
    const ranges = [];
    for (const sheet of sheetsData) {
      if (!sheet.data || sheet.data.length === 0) continue;
      ranges.push(...buildSheetValueRanges(sheet.name, sheet.data));
    }
    return ranges;
  }

  async function sendValueRanges(spreadsheetId, valueRanges, valueInputOption, context) {
    if (!valueRanges || valueRanges.length === 0) return;

    let batch = [];
    let batchCells = 0;

    const flush = async () => {
      if (batch.length === 0) return;
      await apiRequest(
        `${SHEETS_BASE}/${spreadsheetId}/values:batchUpdate`,
        {
          method: 'POST',
          body: JSON.stringify({
            valueInputOption,
            data: batch,
          }),
        },
        context
      );
      batch = [];
      batchCells = 0;
    };

    for (const range of valueRanges) {
      const rangeCells = countRangeCells(range);
      if (
        batch.length > 0 &&
        (batch.length >= MAX_VALUE_RANGES_PER_REQUEST || batchCells + rangeCells > MAX_VALUE_CELLS_PER_REQUEST)
      ) {
        await flush();
      }

      batch.push(range);
      batchCells += rangeCells;

      if (batch.length >= MAX_VALUE_RANGES_PER_REQUEST || batchCells >= MAX_VALUE_CELLS_PER_REQUEST) {
        await flush();
      }
    }

    await flush();
  }

  async function sendBatchUpdateRequests(spreadsheetId, requests, context) {
    if (!requests || requests.length === 0) return;

    for (let i = 0; i < requests.length; i += MAX_BATCH_REQUESTS) {
      await apiRequest(
        `${SHEETS_BASE}/${spreadsheetId}:batchUpdate`,
        {
          method: 'POST',
          body: JSON.stringify({ requests: requests.slice(i, i + MAX_BATCH_REQUESTS) }),
        },
        context
      );
    }
  }

  function countUpdateCellsRequest(request) {
    const updateCells = request?.updateCells;
    const range = updateCells?.range;
    if (range &&
      Number.isInteger(range.startRowIndex) && Number.isInteger(range.endRowIndex) &&
      Number.isInteger(range.startColumnIndex) && Number.isInteger(range.endColumnIndex)) {
      return Math.max(range.endRowIndex - range.startRowIndex, 1) *
        Math.max(range.endColumnIndex - range.startColumnIndex, 1);
    }
    return (updateCells?.rows || []).reduce(
      (sum, row) => sum + Math.max((row?.values || []).length, 1),
      0
    );
  }

  /**
   * Send typed updateCells requests in cell-bounded HTTP payloads.  A
   * batchUpdate body may contain several small updateCells requests, but the
   * total rectangular cell area in that body must stay within the limit.
   */
  async function sendTypedBatchUpdateRequests(spreadsheetId, requests, context) {
    if (!requests || requests.length === 0) return;

    let batch = [];
    let batchCells = 0;

    const flush = async () => {
      if (batch.length === 0) return;
      await apiRequest(
        `${SHEETS_BASE}/${spreadsheetId}:batchUpdate`,
        {
          method: 'POST',
          body: JSON.stringify({ requests: batch }),
        },
        context
      );
      batch = [];
      batchCells = 0;
    };

    for (const request of requests) {
      const requestCells = countUpdateCellsRequest(request);
      if (requestCells > MAX_VALUE_CELLS_PER_REQUEST) {
        throw new Error('Typed updateCells request exceeds the configured cell limit.');
      }
      if (
        batch.length > 0 &&
        (batchCells + requestCells > MAX_VALUE_CELLS_PER_REQUEST || batch.length >= MAX_BATCH_REQUESTS)
      ) {
        await flush();
      }
      batch.push(request);
      batchCells += requestCells;
    }

    await flush();
  }

  // ==================================================================
  //  Path 1 — Drive upload (preserves formatting)
  // ==================================================================

  /**
   * Upload a file to Google Drive, converting it to Google Sheets format.
   * Google's conversion engine handles all formatting faithfully.
   *
   * @param {File|Blob} file - The raw file to upload
   * @param {string} title - Desired spreadsheet title
   * @returns {Promise<{ id: string, url: string }>}
   */
  async function uploadFileToDrive(file, title, context) {
    const token = await getToken(context);

    // Determine the correct MIME type for Drive conversion
    const name = file.name || '';
    const ext = name.split('.').pop().toLowerCase();
    const mimeMap = {
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      xls: 'application/vnd.ms-excel',
      csv: 'text/csv',
      tsv: 'text/tab-separated-values',
    };
    const fileMime = mimeMap[ext] || file.type || 'application/octet-stream';

    const metadata = {
      name: title,
      mimeType: 'application/vnd.google-apps.spreadsheet',
    };

    const form = new FormData();
    form.append(
      'metadata',
      new Blob([JSON.stringify(metadata)], { type: 'application/json' })
    );
    form.append('file', new Blob([file], { type: fileMime }), name);

    const response = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = body.error?.message || JSON.stringify(body);
      } catch (_) {
        detail = response.statusText;
      }
      throw new Error(`Drive upload failed (${response.status}): ${detail}`);
    }

    const driveFile = await response.json();
    return {
      id: driveFile.id,
      url: `https://docs.google.com/spreadsheets/d/${driveFile.id}/edit`,
    };
  }

  /**
   * Apply cleaning operations to an already-uploaded spreadsheet.
   * Uses Sheets API deleteDimension (which preserves cell formatting of
   * remaining rows/columns) and value updates for cell-level cleaning.
   */
    async function cleanUploadedSheet(spreadsheetId, options, context) {
    const info = await getSpreadsheetInfo(spreadsheetId, context);
    const hasStructural = options.removeEmptyRows || options.removeEmptyColumns || options.removeDuplicates;
    const hasValueLevel = options.trim || options.fixNumbers || options.normalizeDates || options.normalizeHeaders;

    for (const gs of info.sheets) {
      const sheetId = gs.properties.sheetId;
      const sheetTitle = gs.properties.title;
      const escapedTitle = escapeSheetName(sheetTitle);

      // ---- Step 1: lightweight FORMULA read for used-range bounding.
      // FORMULA returns formula text for formula cells (non-empty even
      // when the calculated result is empty), so formulas always
      // contribute to used-row / used-column bounds.
      const valuesResult = await apiRequest(
        `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(escapedTitle)}?valueRenderOption=FORMULA`,
        {}, context
      );
      const usedValues = valuesResult.values || [];
      const usedRows = usedValues.length;
      const usedCols = usedValues.length > 0
        ? Math.max(...usedValues.map((r) => (r ? r.length : 0)), 0)
        : 0;
      if (usedRows === 0 || usedCols === 0) continue;

      const GRID_FIELDS = 'sheets(data(rowData(values(userEnteredValue,effectiveFormat(numberFormat)))))';
      const structA1 = `${escapedTitle}!A1:${colToLetter(usedCols - 1)}${usedRows}`;

      // ---- Step 2: bounded CellData read for structural planning ----
      const structResult = await apiRequest(
        `${SHEETS_BASE}/${spreadsheetId}?fields=${encodeURIComponent(GRID_FIELDS)}&ranges=${encodeURIComponent(structA1)}`,
        {}, context
      );
      const structRowData = structResult.sheets?.[0]?.data?.[0]?.rowData || [];
      if (structRowData.length === 0) continue;

      const tokenGrid = structRowData.map((row) => {
        const cells = (row && row.values) || [];
        return cells.map((cell) =>
          typeof Cleaner !== 'undefined' && Cleaner.tokenFromCellData
            ? Cleaner.tokenFromCellData(cell || {})
            : tokenFromCellDataFallback(cell || {})
        );
      });

      // ---- Structural changes ----
      const deleteRequests = [];
      const rowsToDelete = new Set();
      const colsToDelete = new Set();
      const shouldTrimForComparison = Boolean(options.trim);

      if (options.removeEmptyRows) {
        for (let r = tokenGrid.length - 1; r >= 1; r--) {
          if (tokenGrid[r].every((t) => isTokenEmptyLocal(t))) {
            rowsToDelete.add(r);
          }
        }
      }

      if (options.removeEmptyColumns) {
        const maxCols = Math.max(...tokenGrid.map((r) => r.length), 0);
        for (let c = maxCols - 1; c >= 0; c--) {
          if (tokenGrid.every((row) => isTokenEmptyLocal(row[c]))) {
            colsToDelete.add(c);
          }
        }
      }

      if (options.removeDuplicates) {
        const seen = new Map();
        for (let r = 1; r < tokenGrid.length; r++) {
          if (rowsToDelete.has(r)) continue;
          const key = (typeof Cleaner !== 'undefined' && Cleaner.rowComparisonKey)
            ? Cleaner.rowComparisonKey(tokenGrid[r], shouldTrimForComparison, [...colsToDelete])
            : rowComparisonKeyFallback(tokenGrid[r], shouldTrimForComparison, [...colsToDelete]);
          if (!seen.has(key)) seen.set(key, []);
          seen.get(key).push(r);
        }
        if (options.duplicateMode === 'absolute') {
          for (const [, indices] of seen) {
            if (indices.length > 1) indices.forEach((i) => rowsToDelete.add(i));
          }
        } else {
          for (const [, indices] of seen) {
            if (indices.length > 1) indices.slice(1).forEach((i) => rowsToDelete.add(i));
          }
        }
      }

      // Apply row deletes bottom-to-top, column deletes right-to-left
      for (const row of [...rowsToDelete].sort((a, b) => b - a)) {
        deleteRequests.push({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: row, endIndex: row + 1 } } });
      }
      for (const c of [...colsToDelete].sort((a, b) => b - a)) {
        deleteRequests.push({ deleteDimension: { range: { sheetId, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 } } });
      }

      if (deleteRequests.length > 0) {
        await sendBatchUpdateRequests(spreadsheetId, deleteRequests, context);
        if (context?.responseCache) context.responseCache.delete(`spreadsheet:${spreadsheetId}`);
      }

      // Grid resize
      if (options.removeEmptyRows || options.removeEmptyColumns) {
        const origRows = gs.properties.gridProperties?.rowCount || usedRows;
        const origCols = gs.properties.gridProperties?.columnCount || usedCols;
        const targetRows = options.removeEmptyRows ? Math.max(1, tokenGrid.length - rowsToDelete.size) : origRows;
        let targetCols = origCols;
        if (options.removeEmptyColumns) {
          targetCols = 0;
          for (let c = 0; c < Math.max(...tokenGrid.map((r) => r.length), 0); c++) {
            if (!colsToDelete.has(c)) targetCols++;
          }
          targetCols = Math.max(targetCols, 1);
        }
        if (targetRows !== origRows || targetCols !== origCols) {
          await sendBatchUpdateRequests(spreadsheetId, [{
            updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount: targetRows, columnCount: targetCols } }, fields: 'gridProperties.rowCount,gridProperties.columnCount' },
          }], context);
          if (context?.responseCache) context.responseCache.delete(`spreadsheet:${spreadsheetId}`);
        }
      }

      // ---- Step 3: post-deletion bounded CellData read for value-level cleaning ----
      if (!hasValueLevel) continue;

      const postRows = usedRows - rowsToDelete.size;
      const postCols = usedCols - colsToDelete.size;
      if (postRows < 1 || postCols < 1) continue;

      const valueA1 = `${escapedTitle}!A1:${colToLetter(postCols - 1)}${postRows}`;
      const valueResult = await apiRequest(
        `${SHEETS_BASE}/${spreadsheetId}?fields=${encodeURIComponent(GRID_FIELDS)}&ranges=${encodeURIComponent(valueA1)}`,
        {}, context
      );
      const valueRowData = valueResult.sheets?.[0]?.data?.[0]?.rowData || [];

      const stringUpdates = [];
      const numberUpdates = [];
      const dateUpdateRequests = [];

      for (let r = 0; r < valueRowData.length; r++) {
        const cells = valueRowData[r]?.values || [];
        for (let c = 0; c < cells.length; c++) {
          const cell = cells[c] || {};
          const uev = cell.userEnteredValue || {};
          const token = typeof Cleaner !== 'undefined' && Cleaner.tokenFromCellData
            ? Cleaner.tokenFromCellData(cell)
            : tokenFromCellDataFallback(cell);
          if (!token || token.type !== 'string') continue;

          const raw = uev.stringValue;
          if (raw === undefined || raw === '') continue;

          const cellRef = `${escapedTitle}!${colToLetter(c)}${r + 1}`;
          let cur = raw;
          let changed = false;
          let valueIsNumber = false;
          let valueIsDate = false;
          const isTextFormatted = token.formatType === 'TEXT';

          if (options.normalizeHeaders && r === 0) {
            const normalized = normalizeHeaderTitleCase(cur);
            if (normalized !== cur && normalized.length > 0) { cur = normalized; changed = true; }
          }
          if (options.trim) {
            const trimmed = cur.trim();
            if (trimmed !== cur) { cur = trimmed; changed = true; }
          }
          if (options.fixNumbers && r > 0 && !isTextFormatted) {
            const cleaned = cur.replace(/[,\s]/g, '');
            if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
              changed = true;
              if (cleaned.length > 1 && cleaned.startsWith('0') && !cleaned.startsWith('0.')) {
                cur = cleaned;
              } else {
                cur = parseFloat(cleaned);
                valueIsNumber = true;
              }
            }
          }
          if (options.normalizeDates && r > 0 && !isTextFormatted && !valueIsNumber) {
            const dateToken = typeof Cleaner !== 'undefined' && Cleaner.parseDateToken
              ? Cleaner.parseDateToken(cur)
              : null;
            if (dateToken) {
              const fmtType = dateToken.formatType;
              const patterns = { DATE: 'yyyy-mm-dd', TIME: 'hh:mm:ss', DATE_TIME: 'yyyy-mm-dd hh:mm:ss' };
              dateUpdateRequests.push({
                updateCells: {
                  rows: [{
                    values: [{
                      userEnteredValue: { numberValue: dateToken.value },
                      userEnteredFormat: {
                        numberFormat: { type: fmtType, pattern: patterns[fmtType] || patterns.DATE },
                      },
                    }],
                  }],
                  fields: 'userEnteredValue,userEnteredFormat.numberFormat',
                  range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: c, endColumnIndex: c + 1 },
                },
              });
              valueIsDate = true;
            }
          }

          if ((changed || valueIsDate) && !valueIsNumber && !valueIsDate) {
            stringUpdates.push({ range: cellRef, values: [[cur]] });
          }
          if (valueIsNumber) {
            numberUpdates.push({ range: cellRef, values: [[cur]] });
          }
        }
      }

      if (stringUpdates.length > 0) await sendValueRanges(spreadsheetId, stringUpdates, 'RAW', context);
      if (numberUpdates.length > 0) await sendValueRanges(spreadsheetId, numberUpdates, 'USER_ENTERED', context);
      if (dateUpdateRequests.length > 0) await sendBatchUpdateRequests(spreadsheetId, dateUpdateRequests, context);
    }
  }

  function isTokenEmptyLocal(t) {
    if (!t || t.type === 'empty') return true;
    if (t.type === 'string' && String(t.value || '').trim().length === 0) return true;
    return false;
  }
  function tokenFromCellDataFallback(cellData) {
    const uev = (cellData && cellData.userEnteredValue) || {};
    const fmtType = cellData && cellData.effectiveFormat && cellData.effectiveFormat.numberFormat ? cellData.effectiveFormat.numberFormat.type : undefined;
    if (uev.formulaValue !== undefined) return { type: 'formula', value: uev.formulaValue };
    if (fmtType === 'DATE' || fmtType === 'TIME' || fmtType === 'DATE_TIME') return { type: 'date', value: uev.numberValue, formatType: fmtType };
    if (uev.boolValue !== undefined) return { type: 'boolean', value: uev.boolValue };
    if (uev.numberValue !== undefined) return { type: 'number', value: uev.numberValue };
    if (uev.stringValue !== undefined && uev.stringValue !== '') {
      const token = { type: 'string', value: uev.stringValue };
      if (fmtType === 'TEXT') token.formatType = 'TEXT';
      return token;
    }
    return { type: 'empty' };
  }
  function rowComparisonKeyFallback(tokens, shouldTrim, excludedCols) {
    const excluded = new Set(excludedCols || []);
    return tokens.reduce((parts, t, idx) => {
      if (excluded.has(idx)) return parts;
      const val = (t.type === 'string' && shouldTrim) ? String(t.value || '').trim() : t.value;
      let key = `${t.type}\x00${val ?? ''}`;
      if (t.type === 'date' && t.formatType) key += `\x00${t.formatType}`;
      parts.push(key);
      return parts;
    }, []).join('\x01');
  }

  /**
   * Overwrite cell values of the first sheet in an existing spreadsheet
   * with new data. Preserves all cell formatting — only values change.
   * Uses batchUpdate with updateCells (fields: userEnteredValue) which
   * explicitly touches only values and leaves formatting untouched.
   */
  async function overwriteSheetValues(spreadsheetId, data, context) {
    const info = await getSpreadsheetInfo(spreadsheetId, context);

    const gs = info.sheets[0];
    if (!gs) throw new Error('Uploaded spreadsheet has no sheets');
    const sheetId = gs.properties.sheetId;

    if (!data || data.length === 0) return;

    const rowCount = data.length;
    const colCount = Math.max(...data.map((r) => r.length), 1);

    const requests = [];

    // Ensure grid is large enough for merged data
    const currentRows = gs.properties.gridProperties?.rowCount || 1000;
    const currentCols = gs.properties.gridProperties?.columnCount || 26;

    if (rowCount > currentRows || colCount > currentCols) {
      requests.push({
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: {
              rowCount: Math.max(rowCount, currentRows),
              columnCount: Math.max(colCount, currentCols),
            },
          },
          fields: 'gridProperties.rowCount,gridProperties.columnCount',
        },
      });
    }

    // Build updateCells rows — only sets userEnteredValue, NOT format
    const rows = data.map((row) => ({
      values: row.map((cell) => ({
        userEnteredValue: { stringValue: cell == null ? '' : String(cell) },
      })),
    }));

    requests.push({
      updateCells: {
        rows,
        fields: 'userEnteredValue',
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: rowCount,
          startColumnIndex: 0,
          endColumnIndex: colCount,
        },
      },
    });

    // Clear any leftover rows beyond the merged data
    if (currentRows > rowCount) {
      requests.push({
        updateCells: {
          rows: Array.from({ length: currentRows - rowCount }, () => ({
            values: Array.from({ length: colCount }, () => ({
              userEnteredValue: { stringValue: '' },
            })),
          })),
          fields: 'userEnteredValue',
          range: {
            sheetId,
            startRowIndex: rowCount,
            endRowIndex: currentRows,
            startColumnIndex: 0,
            endColumnIndex: colCount,
          },
        },
      });
    }

    // Delete extra sheets beyond the first (uploaded file may have multiple)
    if (info.sheets.length > 1) {
      for (const s of info.sheets.slice(1)) {
        requests.push({ deleteSheet: { sheetId: s.properties.sheetId } });
      }
    }

    await sendBatchUpdateRequests(spreadsheetId, requests, context);

    if (context?.responseCache) {
      context.responseCache.delete(`spreadsheet:${spreadsheetId}`);
    }
  }

  /**
   * Apply standard post-upload formatting: auto-resize columns.
   * Does NOT change cell styles (preserves original formatting).
   */
  async function formatUploadedSheet(spreadsheetId, context) {
    const info = await getSpreadsheetInfo(spreadsheetId, context);

    const requests = [];
    for (const gs of info.sheets) {
      const sheetId = gs.properties.sheetId;
      const colCount = gs.properties.gridProperties?.columnCount || 26;

      requests.push({
        autoResizeDimensions: {
          dimensions: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: 0,
            endIndex: colCount,
          },
        },
      });
    }

    if (requests.length > 0) {
      await sendBatchUpdateRequests(spreadsheetId, requests, context).catch(() => {});
    }
  }

  // ==================================================================
  //  Path 2 — Create from data (CSV/TSV or no formatting preservation)
  // ==================================================================

  /**
   * Create a new Google Spreadsheet and populate it with data arrays.
   * Applies default formatting (bold header, light background, freeze row).
   *
   * @param {string} title - Spreadsheet title
   * @param {Array<{ name: string, data: (string|number)[][] }>} sheetsData
   * @returns {Promise<{ id: string, url: string }>}
   */
  async function createSpreadsheet(title, sheetsData, context) {
    const usedNames = new Set();
    const sanitized = sheetsData.map((sheet) => {
      let name = sanitizeSheetName(sheet.name);
      let suffix = 1;
      const base = name;
      while (usedNames.has(name)) {
        name = `${base} (${suffix++})`;
      }
      usedNames.add(name);
      return { ...sheet, name };
    });

    // Create the spreadsheet with default grid size (matches Google Sheets defaults)
    const spreadsheet = await apiRequest(
      SHEETS_BASE,
      {
        method: 'POST',
        body: JSON.stringify({
          properties: { title },
          sheets: sanitized.map((sheet) => {
            const bounds = getSheetDataBounds(sheet.data);

            return {
              properties: {
                title: sheet.name,
                gridProperties: {
                  rowCount: context?.tightGrid ? bounds.rowCount : Math.max(bounds.rowCount, 1000),
                  columnCount: context?.tightGrid ? bounds.colCount : Math.max(bounds.colCount, 26),
                },
              },
            };
          }),
        }),
      },
      context
    );

    const spreadsheetId = spreadsheet.spreadsheetId;

    // Write values — use typed cells only when at least one sheet has real metadata, RAW otherwise
    const hasMetadata = sanitized.some((s) => s.cellMeta != null);
    const typedSheets = hasMetadata ? sanitized.filter((s) => s.cellMeta != null) : [];
    const rawSheets = hasMetadata ? sanitized.filter((s) => s.cellMeta == null) : sanitized;

    if (rawSheets.length > 0) {
      const valueRanges = buildValueRangesForSheets(rawSheets);
      if (valueRanges.length > 0) {
        await sendValueRanges(spreadsheetId, valueRanges, 'RAW', context);
      }
    }

    if (typedSheets.length > 0) {
      const info = await getSpreadsheetInfo(spreadsheetId, context);
      const requests = [];
      for (const sheet of typedSheets) {
        const gsSheet = info.sheets.find((s) => s.properties.title === sheet.name);
        if (!gsSheet) continue;
        const sheetId = gsSheet.properties.sheetId;
        const blocks = buildTypedUpdateRows(sheet.data, sheet.cellMeta);
          for (const block of blocks) {
            requests.push({
              updateCells: {
                rows: block.rows,
                fields: 'userEnteredValue,userEnteredFormat',
                range: {
                  sheetId,
                  startRowIndex: block.startRow,
                  endRowIndex: block.endRow,
                  startColumnIndex: block.startColumn,
                  endColumnIndex: block.endColumn,
                },
              },
            });
        }
      }
      if (requests.length > 0) {
        await sendTypedBatchUpdateRequests(spreadsheetId, requests, context);
      }
    }

    // Auto-resize columns to fit content
    const formatRequests = [];

    for (const gsSheet of spreadsheet.sheets) {
      const sheetId = gsSheet.properties.sheetId;
      const sheetTitle = gsSheet.properties.title;
      const matchingData = sanitized.find((s) => s.name === sheetTitle);
      const colCount = matchingData
        ? Math.max(...matchingData.data.map((r) => r.length), 1)
        : 1;

      formatRequests.push({
        autoResizeDimensions: {
          dimensions: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: 0,
            endIndex: colCount,
          },
        },
      });
    }

    if (formatRequests.length > 0) {
      await sendBatchUpdateRequests(spreadsheetId, formatRequests, context).catch(() => {});
    }

    if (context) {
      if (!context.responseCache) context.responseCache = new Map();
      context.responseCache.set(`spreadsheet:${spreadsheetId}`, Promise.resolve(spreadsheet));
    }

    return {
      id: spreadsheetId,
      url: spreadsheet.spreadsheetUrl,
    };
  }

  // ==================================================================
  //  Formatting helpers for merge with preserve formatting
  // ==================================================================

  /**
   * Convert an Excel ARGB or RGB hex string to a Sheets API color object.
   * Excel uses ARGB (8 chars, first 2 are alpha) or RGB (6 chars).
   */
  function hexToRgb(hex) {
    if (!hex || hex.length < 6) return null;
    const offset = hex.length === 8 ? 2 : 0; // skip alpha channel in ARGB
    const r = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    const g = parseInt(hex.slice(offset + 2, offset + 4), 16) / 255;
    const b = parseInt(hex.slice(offset + 4, offset + 6), 16) / 255;
    return Number.isNaN(r) ? null : { red: r, green: g, blue: b };
  }

  function rgbToHex(color) {
    if (!color) return null;

    const toHex = (value) => {
      const scaled = Math.max(0, Math.min(255, Math.round(value * 255)));
      return scaled.toString(16).padStart(2, '0').toUpperCase();
    };

    return `${toHex(color.red || 0)}${toHex(color.green || 0)}${toHex(color.blue || 0)}`;
  }

  function applyTint(hex, tint = 0) {
    const color = hexToRgb(hex);
    if (!color || !tint) return color ? rgbToHex(color) : null;

    const transform = (channel) => {
      if (tint < 0) {
        return channel * (1 + tint);
      }
      return channel + (1 - channel) * tint;
    };

    return rgbToHex({
      red: transform(color.red),
      green: transform(color.green),
      blue: transform(color.blue),
    });
  }

  function resolveSheetJsColor(colorRef, themeColors = DEFAULT_THEME_COLORS) {
    if (!colorRef) return null;
    themeColors = themeColors || DEFAULT_THEME_COLORS;

    if (typeof colorRef === 'string') {
      return hexToRgb(colorRef);
    }

    if (colorRef.rgb) {
      return hexToRgb(colorRef.rgb);
    }

    if (typeof colorRef.theme === 'number') {
      const themeHex = themeColors[colorRef.theme] || DEFAULT_THEME_COLORS[colorRef.theme];
      if (!themeHex) return null;
      return hexToRgb(applyTint(themeHex, colorRef.tint || 0));
    }

    if (typeof colorRef.indexed === 'number') {
      const indexedHex = INDEXED_COLORS[colorRef.indexed];
      return indexedHex ? hexToRgb(indexedHex) : null;
    }

    return null;
  }

  /**
   * Convert a Google Sheets userEnteredFormat object to a SheetJS cell style.
   * Inverse of sheetJsToSheetsFormat — used when saving the current sheet
   * back to an XLSX file so that the styles survive a re-import.
   * Returns null when there is nothing to apply.
   */
  function sheetsFormatToSheetJs(fmt) {
    if (!fmt || typeof fmt !== 'object') return null;
    const style = {};
    let hasProps = false;

    // Background color
    const bgHex = rgbToHex(fmt.backgroundColor);
    if (bgHex) {
      const colorObj = { rgb: bgHex };
      style.fgColor = colorObj;
      style.fill = { patternType: 'solid', fgColor: colorObj };
      hasProps = true;
    }

    // Text format
    const tf = fmt.textFormat;
    if (tf && typeof tf === 'object') {
      const font = {};
      let hasFontProps = false;
      if (tf.bold) { font.bold = true; hasFontProps = true; }
      if (tf.italic) { font.italic = true; hasFontProps = true; }
      if (tf.underline) { font.underline = true; hasFontProps = true; }
      if (tf.strikethrough) { font.strike = true; hasFontProps = true; }
      if (typeof tf.fontSize === 'number' && tf.fontSize > 0) {
        font.sz = tf.fontSize;
        hasFontProps = true;
      }
      if (tf.fontFamily) { font.name = tf.fontFamily; hasFontProps = true; }
      const textHex = rgbToHex(tf.foregroundColor);
      if (textHex) {
        font.color = { rgb: textHex };
        hasFontProps = true;
      }
      if (hasFontProps) {
        style.font = font;
        hasProps = true;
      }
    }

    // Alignment
    const hMap = { LEFT: 'left', CENTER: 'center', RIGHT: 'right' };
    const vMap = { TOP: 'top', MIDDLE: 'center', BOTTOM: 'bottom' };
    let alignment = null;
    if (fmt.horizontalAlignment && hMap[fmt.horizontalAlignment]) {
      alignment = alignment || {};
      alignment.horizontal = hMap[fmt.horizontalAlignment];
    }
    if (fmt.verticalAlignment && vMap[fmt.verticalAlignment]) {
      alignment = alignment || {};
      alignment.vertical = vMap[fmt.verticalAlignment];
    }
    if (fmt.wrapStrategy === 'WRAP' || fmt.wrapStrategy === 'WRAP_AND_CLIP') {
      alignment = alignment || {};
      alignment.wrapText = true;
    }
    if (alignment) {
      style.alignment = alignment;
      hasProps = true;
    }

    // Borders
    if (fmt.borders && typeof fmt.borders === 'object') {
      const bStyleMap = {
        SOLID: 'thin', SOLID_MEDIUM: 'medium', SOLID_THICK: 'thick',
        DASHED: 'dashed', DOTTED: 'dotted', DOUBLE: 'double',
      };
      const borders = {};
      let hasBorder = false;
      for (const side of ['top', 'bottom', 'left', 'right']) {
        const b = fmt.borders[side];
        if (b && bStyleMap[b.style]) {
          const entry = { style: bStyleMap[b.style] };
          const bHex = rgbToHex(b.color);
          if (bHex) entry.color = { rgb: bHex };
          borders[side] = entry;
          hasBorder = true;
        }
      }
      if (hasBorder) {
        style.border = borders;
        hasProps = true;
      }
    }

    // Number format
    if (fmt.numberFormat && typeof fmt.numberFormat === 'object') {
      const pattern = fmt.numberFormat.pattern;
      if (pattern && pattern !== 'General' && pattern !== 'GENERAL') {
        style.numFmt = pattern;
        hasProps = true;
      }
    }

    return hasProps ? style : null;
  }

  /**
   * Convert a 2D grid of Google Sheets userEnteredFormat objects into a 2D
   * grid of SheetJS cell styles (the inverse direction of the SheetJS-side
   * styles, matching the shape produced by Parser.extractSheetStyles).
   * Returns null when the grid is missing or has no cells.
   */
  function sheetsFormatGridToSheetJs(formatGrid) {
    if (!Array.isArray(formatGrid) || formatGrid.length === 0) return null;
    return formatGrid.map((row) =>
      Array.isArray(row) ? row.map((fmt) => sheetsFormatToSheetJs(fmt)) : []
    );
  }

  /**
   * Convert a SheetJS cell style object to a Google Sheets userEnteredFormat.
   * Defensively handles various SheetJS style layouts.
   * Returns null when there is nothing to apply.
   */
  function sheetJsToSheetsFormat(s, themeColors) {
    if (!s || typeof s !== 'object') return null;
    const fmt = {};

    // Background color
    const fillColor = resolveSheetJsColor(s.fgColor || s.fill?.fgColor, themeColors);
    if (fillColor) {
      const c = fillColor;
      if (c) fmt.backgroundColor = c;
    }

    // Text format
    const tf = {};
    const font = s.font || s;
    if (font.bold) tf.bold = true;
    if (font.italic) tf.italic = true;
    if (font.underline) tf.underline = true;
    if (font.strike || font.strikethrough) tf.strikethrough = true;
    if (font.sz) tf.fontSize = Math.round(font.sz);
    if (font.name) tf.fontFamily = font.name;
    const fontColor = resolveSheetJsColor(font.color || s.textColor, themeColors);
    if (fontColor) {
      const c = fontColor;
      if (c) tf.foregroundColor = c;
    }
    if (Object.keys(tf).length > 0) fmt.textFormat = tf;

    // Horizontal alignment
    if (s.alignment?.horizontal) {
      const hMap = { left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'LEFT' };
      const h = hMap[s.alignment.horizontal];
      if (h) fmt.horizontalAlignment = h;
    }

    // Vertical alignment
    if (s.alignment?.vertical) {
      const vMap = { top: 'TOP', center: 'MIDDLE', bottom: 'BOTTOM' };
      const v = vMap[s.alignment.vertical];
      if (v) fmt.verticalAlignment = v;
    }

    // Wrap text
    if (s.alignment?.wrapText) {
      fmt.wrapStrategy = 'WRAP';
    }

    // Borders
    if (s.border) {
      const bStyleMap = {
        thin: 'SOLID', medium: 'SOLID_MEDIUM', thick: 'SOLID_THICK',
        dashed: 'DASHED', dotted: 'DOTTED', double: 'DOUBLE', hair: 'DOTTED',
      };
      const borders = {};
      for (const side of ['top', 'bottom', 'left', 'right']) {
        const b = s.border[side];
        if (b?.style) {
          const entry = { style: bStyleMap[b.style] || 'SOLID' };
          if (b.color?.rgb) {
            const c = hexToRgb(b.color.rgb);
            if (c) entry.color = c;
          }
          borders[side] = entry;
        }
      }
      if (Object.keys(borders).length > 0) fmt.borders = borders;
    }

    // Number format
    const numFmt = s.numFmt || s.z;
    if (numFmt && numFmt !== 'General') {
      fmt.numberFormat = { type: 'NUMBER', pattern: numFmt };
    }

    return Object.keys(fmt).length > 0 ? fmt : null;
  }

  /**
   * Apply cell formatting to contiguous blocks of rows in the first sheet.
   * Each block: { startRow: number, rows: Array<Array<format|null>> }
   * Only updates userEnteredFormat — values are untouched.
   */
  async function applyFormatting(spreadsheetId, formattingBlocks, context) {
    if (!formattingBlocks || formattingBlocks.length === 0) return;

    const info = await getSpreadsheetInfo(spreadsheetId, context);
    const sheetId = info.sheets[0].properties.sheetId;

    const requests = formattingBlocks.map(({ startRow, rows: fmtRows }) => {
      const cols = Math.max(...fmtRows.map((r) => r.length), 1);
      const rows = fmtRows.map((row) => ({
        values: Array.from({ length: cols }, (_, i) => {
          const fmt = row[i];
          return fmt ? { userEnteredFormat: fmt } : {};
        }),
      }));
      return {
        updateCells: {
          rows,
          fields: 'userEnteredFormat',
          range: {
            sheetId,
            startRowIndex: startRow,
            endRowIndex: startRow + fmtRows.length,
            startColumnIndex: 0,
            endColumnIndex: cols,
          },
        },
      };
    });

    await sendBatchUpdateRequests(spreadsheetId, requests, context);
  }

  return {
    getToken,
    revokeToken,
    uploadFileToDrive,
    cleanUploadedSheet,
    overwriteSheetValues,
    formatUploadedSheet,
    createSpreadsheet,
    sheetJsToSheetsFormat,
    sheetsFormatToSheetJs,
    sheetsFormatGridToSheetJs,
    applyFormatting,
    tokenFromCellDataFallback,
    rowComparisonKeyFallback,
    MAX_VALUE_CELLS_PER_REQUEST,
  };
})();
