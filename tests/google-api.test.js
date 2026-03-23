const fs = require('fs');
const path = require('path');

// Load GoogleAPI module
let apiCode = fs.readFileSync(path.resolve(__dirname, '../sidepanel/google-api.js'), 'utf-8');
apiCode = apiCode.replace('const GoogleAPI =', 'global.GoogleAPI =');
eval(apiCode);
const GoogleAPI = global.GoogleAPI;

describe('GoogleAPI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  // ================================================================
  //  sheetJsToSheetsFormat (pure function)
  // ================================================================

  describe('sheetJsToSheetsFormat', () => {
    test('returns null for null input', () => {
      expect(GoogleAPI.sheetJsToSheetsFormat(null)).toBeNull();
    });

    test('returns null for undefined input', () => {
      expect(GoogleAPI.sheetJsToSheetsFormat(undefined)).toBeNull();
    });

    test('returns null for non-object input', () => {
      expect(GoogleAPI.sheetJsToSheetsFormat('string')).toBeNull();
      expect(GoogleAPI.sheetJsToSheetsFormat(42)).toBeNull();
    });

    test('returns null for empty style object', () => {
      expect(GoogleAPI.sheetJsToSheetsFormat({})).toBeNull();
    });

    // Background color
    test('converts fgColor.rgb to backgroundColor', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({ fgColor: { rgb: 'FF0000' } });
      expect(result.backgroundColor).toEqual({ red: 1, green: 0, blue: 0 });
    });

    test('converts fill.fgColor.rgb to backgroundColor', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({
        fill: { fgColor: { rgb: '00FF00' } },
      });
      expect(result.backgroundColor).toEqual({ red: 0, green: 1, blue: 0 });
    });

    test('handles ARGB hex (8 chars, skips alpha)', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({ fgColor: { rgb: 'FF0000FF' } });
      expect(result.backgroundColor).toEqual({ red: 0, green: 0, blue: 1 });
    });

    // Text format
    test('converts bold', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({ font: { bold: true } });
      expect(result.textFormat.bold).toBe(true);
    });

    test('converts italic', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({ font: { italic: true } });
      expect(result.textFormat.italic).toBe(true);
    });

    test('converts underline', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({ font: { underline: true } });
      expect(result.textFormat.underline).toBe(true);
    });

    test('converts strikethrough (strike)', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({ font: { strike: true } });
      expect(result.textFormat.strikethrough).toBe(true);
    });

    test('converts strikethrough (strikethrough)', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({ font: { strikethrough: true } });
      expect(result.textFormat.strikethrough).toBe(true);
    });

    test('converts font size', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({ font: { sz: 14 } });
      expect(result.textFormat.fontSize).toBe(14);
    });

    test('converts font family', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({ font: { name: 'Arial' } });
      expect(result.textFormat.fontFamily).toBe('Arial');
    });

    test('converts font color', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({
        font: { color: { rgb: '0000FF' } },
      });
      expect(result.textFormat.foregroundColor).toEqual({ red: 0, green: 0, blue: 1 });
    });

    test('converts theme font color', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({
        font: { color: { theme: 1 } },
      });
      expect(result.textFormat.foregroundColor).toEqual({ red: 0, green: 0, blue: 0 });
    });

    test('uses workbook theme colors when provided', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat(
        { font: { color: { theme: 4 } } },
        ['FFFFFF', '000000', 'FFFFFF', '000000', '4285F4']
      );
      expect(result.textFormat.foregroundColor).toEqual({
        red: 66 / 255,
        green: 133 / 255,
        blue: 244 / 255,
      });
    });

    test('converts tinted theme font color', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({
        font: { color: { theme: 1, tint: 0.5 } },
      });
      expect(result.textFormat.foregroundColor.red).toBeCloseTo(0.5, 2);
      expect(result.textFormat.foregroundColor.green).toBeCloseTo(0.5, 2);
      expect(result.textFormat.foregroundColor.blue).toBeCloseTo(0.5, 2);
    });

    test('converts indexed font color', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({
        font: { color: { indexed: 4 } },
      });
      expect(result.textFormat.foregroundColor).toEqual({ red: 0, green: 0, blue: 1 });
    });

    test('falls back to default theme colors when themeColors is null', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat(
        { font: { color: { theme: 1 } } },
        null
      );
      expect(result.textFormat.foregroundColor).toEqual({ red: 0, green: 0, blue: 0 });
    });

    test('converts textColor as fallback', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({ textColor: 'FF0000' });
      expect(result.textFormat.foregroundColor).toEqual({ red: 1, green: 0, blue: 0 });
    });

    // Bold/italic from root level (without font wrapper)
    test('handles bold at root level', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({ bold: true });
      expect(result.textFormat.bold).toBe(true);
    });

    // Alignment
    test('converts horizontal alignment', () => {
      expect(
        GoogleAPI.sheetJsToSheetsFormat({ alignment: { horizontal: 'left' } })
          .horizontalAlignment
      ).toBe('LEFT');
      expect(
        GoogleAPI.sheetJsToSheetsFormat({ alignment: { horizontal: 'center' } })
          .horizontalAlignment
      ).toBe('CENTER');
      expect(
        GoogleAPI.sheetJsToSheetsFormat({ alignment: { horizontal: 'right' } })
          .horizontalAlignment
      ).toBe('RIGHT');
      expect(
        GoogleAPI.sheetJsToSheetsFormat({ alignment: { horizontal: 'justify' } })
          .horizontalAlignment
      ).toBe('LEFT');
    });

    test('converts vertical alignment', () => {
      expect(
        GoogleAPI.sheetJsToSheetsFormat({ alignment: { vertical: 'top' } })
          .verticalAlignment
      ).toBe('TOP');
      expect(
        GoogleAPI.sheetJsToSheetsFormat({ alignment: { vertical: 'center' } })
          .verticalAlignment
      ).toBe('MIDDLE');
      expect(
        GoogleAPI.sheetJsToSheetsFormat({ alignment: { vertical: 'bottom' } })
          .verticalAlignment
      ).toBe('BOTTOM');
    });

    test('converts wrap text', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({
        alignment: { wrapText: true },
      });
      expect(result.wrapStrategy).toBe('WRAP');
    });

    // Borders
    test('converts border styles', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({
        border: {
          top: { style: 'thin' },
          bottom: { style: 'medium' },
          left: { style: 'dashed' },
          right: { style: 'double' },
        },
      });
      expect(result.borders.top.style).toBe('SOLID');
      expect(result.borders.bottom.style).toBe('SOLID_MEDIUM');
      expect(result.borders.left.style).toBe('DASHED');
      expect(result.borders.right.style).toBe('DOUBLE');
    });

    test('converts border colors', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({
        border: {
          top: { style: 'thin', color: { rgb: 'FF0000' } },
        },
      });
      expect(result.borders.top.color).toEqual({ red: 1, green: 0, blue: 0 });
    });

    test('handles hair border style as DOTTED', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({
        border: { top: { style: 'hair' } },
      });
      expect(result.borders.top.style).toBe('DOTTED');
    });

    // Number format
    test('converts number format', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({ numFmt: '#,##0.00' });
      expect(result.numberFormat).toEqual({
        type: 'NUMBER',
        pattern: '#,##0.00',
      });
    });

    test('converts z property as number format', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({ z: '0.00%' });
      expect(result.numberFormat).toEqual({
        type: 'NUMBER',
        pattern: '0.00%',
      });
    });

    test('ignores "General" number format', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({ numFmt: 'General' });
      expect(result).toBeNull();
    });

    // Combined formats
    test('handles multiple format properties together', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({
        fgColor: { rgb: 'FFFF00' },
        font: { bold: true, sz: 12 },
        alignment: { horizontal: 'center' },
      });
      expect(result.backgroundColor).toEqual({ red: 1, green: 1, blue: 0 });
      expect(result.textFormat.bold).toBe(true);
      expect(result.textFormat.fontSize).toBe(12);
      expect(result.horizontalAlignment).toBe('CENTER');
    });

    // Invalid hex
    test('ignores short/invalid hex colors', () => {
      const result = GoogleAPI.sheetJsToSheetsFormat({ fgColor: { rgb: 'abc' } });
      expect(result).toBeNull();
    });
  });

  // ================================================================
  //  getToken
  // ================================================================

  describe('getToken', () => {
    test('returns token from chrome.identity', async () => {
      const token = await GoogleAPI.getToken();
      expect(token).toBe('mock-token');
      expect(chrome.identity.getAuthToken).toHaveBeenCalledWith({ interactive: true });
    });
  });

  // ================================================================
  //  revokeToken
  // ================================================================

  describe('revokeToken', () => {
    test('revokes and removes cached token', async () => {
      global.fetch.mockResolvedValue({});
      await GoogleAPI.revokeToken();

      expect(chrome.identity.getAuthToken).toHaveBeenCalledWith({ interactive: false });
      expect(chrome.identity.removeCachedAuthToken).toHaveBeenCalledWith({
        token: 'mock-token',
      });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('accounts.google.com/o/oauth2/revoke')
      );
    });

    test('does not throw when no cached token', async () => {
      chrome.identity.getAuthToken.mockRejectedValueOnce(new Error('No token'));
      await expect(GoogleAPI.revokeToken()).resolves.toBeUndefined();
    });
  });

  // ================================================================
  //  createSpreadsheet
  // ================================================================

  describe('createSpreadsheet', () => {
    function mockFetchSequence(...responses) {
      for (const resp of responses) {
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(resp),
        });
      }
    }

    test('creates spreadsheet and returns id and url', async () => {
      mockFetchSequence(
        // Create spreadsheet
        {
          spreadsheetId: 'sheet-123',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-123/edit',
          sheets: [{ properties: { sheetId: 0, title: 'Data' } }],
        },
        // Write values
        {},
        // Format (auto-resize)
        {}
      );

      const result = await GoogleAPI.createSpreadsheet('Test', [
        { name: 'Data', data: [['a', 'b'], ['1', '2']] },
      ]);

      expect(result.id).toBe('sheet-123');
      expect(result.url).toBe('https://docs.google.com/spreadsheets/d/sheet-123/edit');
    });

    test('sends correct data to Sheets API', async () => {
      mockFetchSequence(
        {
          spreadsheetId: 's1',
          spreadsheetUrl: 'url',
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {},
        {}
      );

      await GoogleAPI.createSpreadsheet('My Sheet', [
        { name: 'Sheet1', data: [['Name'], ['Alice']] },
      ]);

      // First call creates the spreadsheet
      const createCall = global.fetch.mock.calls[0];
      expect(createCall[0]).toContain('sheets.googleapis.com');
      const createBody = JSON.parse(createCall[1].body);
      expect(createBody.properties.title).toBe('My Sheet');

      // Second call writes values
      const writeCall = global.fetch.mock.calls[1];
      expect(writeCall[0]).toContain('values:batchUpdate');
    });

    test('writes literal strings with RAW input option', async () => {
      mockFetchSequence(
        {
          spreadsheetId: 's1',
          spreadsheetUrl: 'url',
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {},
        {}
      );

      await GoogleAPI.createSpreadsheet('My Sheet', [
        { name: 'Sheet1', data: [['Phone'], ['+1-551-848-4656x482']] },
      ]);

      const writeBody = JSON.parse(global.fetch.mock.calls[1][1].body);
      expect(writeBody.valueInputOption).toBe('RAW');
      expect(writeBody.data[0].values[1][0]).toBe('+1-551-848-4656x482');
    });

    test('chunks large value writes into multiple requests', async () => {
      const rows = Array.from({ length: 600 }, (_, index) => [String(index), 'value']);

      mockFetchSequence(
        {
          spreadsheetId: 's1',
          spreadsheetUrl: 'url',
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {},
        {},
        {}
      );

      await GoogleAPI.createSpreadsheet('Chunked', [
        { name: 'Sheet1', data: rows.map((row) => Array.from({ length: 100 }, () => row[1])) },
      ]);

      const valueCalls = global.fetch.mock.calls.filter((call) =>
        call[0].includes('values:batchUpdate')
      );

      expect(valueCalls).toHaveLength(2);
      expect(JSON.parse(valueCalls[0][1].body).data[0].range).toBe("'Sheet1'!A1");
      expect(JSON.parse(valueCalls[1][1].body).data[0].range).toBe("'Sheet1'!A501");
    });

    test('uses cleaned bounds when tight grid is enabled', async () => {
      mockFetchSequence(
        {
          spreadsheetId: 's1',
          spreadsheetUrl: 'url',
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {},
        {}
      );

      await GoogleAPI.createSpreadsheet(
        'My Sheet',
        [{ name: 'Sheet1', data: [['Name'], ['Alice']] }],
        { tightGrid: true }
      );

      const createBody = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(createBody.sheets[0].properties.gridProperties).toEqual({
        rowCount: 2,
        columnCount: 1,
      });
    });

    test('sizes default grid to fit large chunked writes', async () => {
      const rows = Array.from({ length: 2446 }, (_, rowIndex) =>
        Array.from({ length: 30 }, (_, colIndex) => `r${rowIndex}c${colIndex}`)
      );

      mockFetchSequence(
        {
          spreadsheetId: 's1',
          spreadsheetUrl: 'url',
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {},
        {},
        {}
      );

      await GoogleAPI.createSpreadsheet('Large Sheet', [
        { name: 'Sheet1', data: rows },
      ]);

      const createBody = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(createBody.sheets[0].properties.gridProperties).toEqual({
        rowCount: 2446,
        columnCount: 30,
      });

      const valueCalls = global.fetch.mock.calls.filter((call) =>
        call[0].includes('values:batchUpdate')
      );
      expect(valueCalls).toHaveLength(2);
      expect(JSON.parse(valueCalls[1][1].body).data[0].range).toBe("'Sheet1'!A1667");
    });

    test('handles empty sheet data', async () => {
      mockFetchSequence(
        {
          spreadsheetId: 's1',
          spreadsheetUrl: 'url',
          sheets: [{ properties: { sheetId: 0, title: 'Empty' } }],
        },
        // No write call for empty data
        {} // Format
      );

      const result = await GoogleAPI.createSpreadsheet('Empty', [
        { name: 'Empty', data: [] },
      ]);
      expect(result.id).toBe('s1');
    });

    test('deduplicates sheet names', async () => {
      mockFetchSequence(
        {
          spreadsheetId: 's1',
          spreadsheetUrl: 'url',
          sheets: [
            { properties: { sheetId: 0, title: 'Data' } },
            { properties: { sheetId: 1, title: 'Data (1)' } },
          ],
        },
        {},
        {}
      );

      await GoogleAPI.createSpreadsheet('Test', [
        { name: 'Data', data: [['A']] },
        { name: 'Data', data: [['B']] },
      ]);

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      const sheetNames = body.sheets.map((s) => s.properties.title);
      expect(sheetNames[0]).toBe('Data');
      expect(sheetNames[1]).toBe('Data (1)');
    });

    test('handles API errors', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: () => Promise.resolve({ error: { message: 'Insufficient permissions' } }),
      });

      await expect(
        GoogleAPI.createSpreadsheet('Test', [{ name: 'S', data: [['A']] }])
      ).rejects.toThrow('Google API 403');
    });
  });

  // ================================================================
  //  uploadFileToDrive
  // ================================================================

  describe('uploadFileToDrive', () => {
    test('uploads file and returns id and url', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'drive-456' }),
      });

      const file = new File(['data'], 'test.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const result = await GoogleAPI.uploadFileToDrive(file, 'My Sheet');

      expect(result.id).toBe('drive-456');
      expect(result.url).toBe('https://docs.google.com/spreadsheets/d/drive-456/edit');
    });

    test('sends multipart upload to Drive API', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'id' }),
      });

      const file = new File(['csv,data'], 'test.csv');
      await GoogleAPI.uploadFileToDrive(file, 'Title');

      const call = global.fetch.mock.calls[0];
      expect(call[0]).toContain('upload/drive/v3/files');
      expect(call[0]).toContain('uploadType=multipart');
      expect(call[1].method).toBe('POST');
    });

    test('throws on upload failure', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: { message: 'Server error' } }),
      });

      const file = new File(['data'], 'test.csv');
      await expect(GoogleAPI.uploadFileToDrive(file, 'T')).rejects.toThrow(
        'Drive upload failed (500)'
      );
    });
  });

  // ================================================================
  //  cleanUploadedSheet
  // ================================================================

  describe('cleanUploadedSheet', () => {
    test('shrinks trailing rows and columns when empty cleanup is enabled', async () => {
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            sheets: [{
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                gridProperties: { rowCount: 1000, columnCount: 26 },
              },
            }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            values: [
              ['Name', 'Age', ''],
              ['Alice', '30', ''],
              ['', '', ''],
            ],
          }),
        })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: true,
        removeEmptyColumns: true,
        removeDuplicates: false,
        trim: false,
        fixNumbers: false,
        normalizeHeaders: false,
      });

      const deleteBody = JSON.parse(global.fetch.mock.calls[2][1].body);
      expect(deleteBody.requests.some((request) => request.deleteDimension)).toBe(true);

      const resizeBody = JSON.parse(global.fetch.mock.calls[3][1].body);
      expect(resizeBody.requests[0].updateSheetProperties.properties.gridProperties).toEqual({
        rowCount: 2,
        columnCount: 2,
      });
    });
  });

  // ================================================================
  //  applyFormatting
  // ================================================================

  describe('applyFormatting', () => {
    test('does nothing when blocks are empty', async () => {
      await GoogleAPI.applyFormatting('id', []);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('does nothing when blocks are null', async () => {
      await GoogleAPI.applyFormatting('id', null);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('sends updateCells requests for formatting blocks', async () => {
      // Mock: getSheetInfo + batchUpdate
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              sheets: [{ properties: { sheetId: 0 } }],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        });

      await GoogleAPI.applyFormatting('sheet-id', [
        {
          startRow: 0,
          rows: [[{ backgroundColor: { red: 1, green: 0, blue: 0 } }]],
        },
      ]);

      // Second call is batchUpdate with formatting
      const batchCall = global.fetch.mock.calls[1];
      const body = JSON.parse(batchCall[1].body);
      expect(body.requests[0].updateCells.fields).toBe('userEnteredFormat');
    });
  });

  // ================================================================
  //  formatUploadedSheet
  // ================================================================

  describe('formatUploadedSheet', () => {
    test('auto-resizes columns', async () => {
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              sheets: [
                {
                  properties: {
                    sheetId: 0,
                    gridProperties: { columnCount: 5 },
                  },
                },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        });

      await GoogleAPI.formatUploadedSheet('sheet-id');

      const body = JSON.parse(global.fetch.mock.calls[1][1].body);
      expect(body.requests[0].autoResizeDimensions).toBeDefined();
      expect(body.requests[0].autoResizeDimensions.dimensions.endIndex).toBe(5);
    });
  });
});
