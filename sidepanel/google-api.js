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
      .then((result) => result.token);

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
    // Get sheet metadata
    const info = await getSpreadsheetInfo(spreadsheetId, context);

    for (const gs of info.sheets) {
      const sheetId = gs.properties.sheetId;
      const sheetTitle = gs.properties.title;

      // Read current values
      const range = encodeURIComponent(escapeSheetName(sheetTitle));
      const result = await apiRequest(
        `${SHEETS_BASE}/${spreadsheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`,
        {},
        context
      );
      const data = result.values || [];
      if (data.length === 0) continue;

      // ---- Structural changes (row/column deletions) ----
      const deleteRequests = [];
      const rowsToDelete = new Set();

      // Empty rows (skip header row 0)
      if (options.removeEmptyRows) {
        for (let r = data.length - 1; r >= 1; r--) {
          if (!data[r] || data[r].every((c) => !c || !String(c).trim())) {
            rowsToDelete.add(r);
          }
        }
      }

      // Duplicate rows (skip header row 0)
      if (options.removeDuplicates) {
        const seen = new Map();
        for (let r = 1; r < data.length; r++) {
          if (rowsToDelete.has(r)) continue;
          const key = (data[r] || []).map((c) => String(c ?? '')).join('\0');
          if (!seen.has(key)) seen.set(key, []);
          seen.get(key).push(r);
        }
        if (options.duplicateMode === 'absolute') {
          for (const [, indices] of seen) {
            if (indices.length > 1) indices.forEach((i) => rowsToDelete.add(i));
          }
        } else {
          for (const [, indices] of seen) {
            if (indices.length > 1)
              indices.slice(1).forEach((i) => rowsToDelete.add(i));
          }
        }
      }

      // Delete rows bottom-to-top to avoid index shifts
      const sortedRows = [...rowsToDelete].sort((a, b) => b - a);
      for (const row of sortedRows) {
        deleteRequests.push({
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: row, endIndex: row + 1 },
          },
        });
      }

      // Empty columns (right-to-left)
      if (options.removeEmptyColumns) {
        const maxCols = Math.max(...data.map((r) => (r ? r.length : 0)), 0);
        for (let c = maxCols - 1; c >= 0; c--) {
          if (data.every((row) => !row || !row[c] || !String(row[c]).trim())) {
            deleteRequests.push({
              deleteDimension: {
                range: { sheetId, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 },
              },
            });
          }
        }
      }

      // Send structural deletes
      if (deleteRequests.length > 0) {
        await sendBatchUpdateRequests(spreadsheetId, deleteRequests, context);

        if (context?.responseCache) {
          context.responseCache.delete(`spreadsheet:${spreadsheetId}`);
        }
      }

      if (options.removeEmptyRows || options.removeEmptyColumns) {
        const originalRows = gs.properties.gridProperties?.rowCount || Math.max(data.length, 1);
        const originalCols = gs.properties.gridProperties?.columnCount || 26;
        const targetRows = options.removeEmptyRows
          ? Math.max(1, data.length - rowsToDelete.size)
          : originalRows;

        let targetCols = originalCols;
        if (options.removeEmptyColumns) {
          const maxCols = Math.max(...data.map((r) => (r ? r.length : 0)), 0);
          targetCols = 0;
          for (let c = 0; c < maxCols; c++) {
            if (data.some((row) => row && row[c] && String(row[c]).trim())) {
              targetCols++;
            }
          }
          targetCols = Math.max(targetCols, 1);
        }

        if (targetRows !== originalRows || targetCols !== originalCols) {
          await sendBatchUpdateRequests(
            spreadsheetId,
            [{
              updateSheetProperties: {
                properties: {
                  sheetId,
                  gridProperties: {
                    rowCount: targetRows,
                    columnCount: targetCols,
                  },
                },
                fields: 'gridProperties.rowCount,gridProperties.columnCount',
              },
            }],
            context
          );

          if (context?.responseCache) {
            context.responseCache.delete(`spreadsheet:${spreadsheetId}`);
          }
        }
      }

      // ---- Value-level changes (trim, fix numbers, normalize headers) ----
      if (options.trim || options.fixNumbers || options.normalizeHeaders) {
        // Re-read after structural changes
        const freshResult = await apiRequest(
          `${SHEETS_BASE}/${spreadsheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`,
          {},
          context
        );
        const updatedData = freshResult.values || [];
        const valueUpdates = [];

        for (let r = 0; r < updatedData.length; r++) {
          if (!updatedData[r]) continue;
          for (let c = 0; c < updatedData[r].length; c++) {
            let val = String(updatedData[r][c] ?? '');
            let changed = false;

            if (options.trim) {
              const trimmed = val.trim();
              if (trimmed !== val) { val = trimmed; changed = true; }
            }

            if (options.fixNumbers && r > 0) {
              const cleaned = val.replace(/[,\s]/g, '');
              if (/^-?\d+(\.\d+)?$/.test(cleaned) && cleaned !== val) {
                val = cleaned;
                changed = true;
              }
            }

            if (options.normalizeHeaders && r === 0) {
              const normalized = val
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_|_$/g, '');
              if (normalized !== val && normalized.length > 0) {
                val = normalized;
                changed = true;
              }
            }

            if (changed) {
              const cellRef = `${escapeSheetName(sheetTitle)}!${colToLetter(c)}${r + 1}`;
              valueUpdates.push({ range: cellRef, values: [[val]] });
            }
          }
        }

        if (valueUpdates.length > 0) {
          await sendValueRanges(spreadsheetId, valueUpdates, 'RAW', context);
        }
      }
    }
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
      await sendBatchUpdateRequests(spreadsheetId, requests, context).catch((err) =>
        console.warn('Drag to Sheets: post-upload formatting failed:', err.message)
      );
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

    // Write values
    const valueRanges = buildValueRangesForSheets(sanitized);

    if (valueRanges.length > 0) {
      await sendValueRanges(spreadsheetId, valueRanges, 'RAW', context);
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
      await sendBatchUpdateRequests(spreadsheetId, formatRequests, context).catch((err) =>
        console.warn('Drag to Sheets: formatting batchUpdate failed:', err.message)
      );
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
    applyFormatting,
  };
})();
