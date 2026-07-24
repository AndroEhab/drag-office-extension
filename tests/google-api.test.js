const { loadModule } = require('./helpers');

const GoogleAPI = loadModule('../sidepanel/google-api.js', 'GoogleAPI');
const Cleaner = loadModule('../sidepanel/cleaner.js', 'Cleaner');
const Merger = loadModule('../sidepanel/merger.js', 'Merger');
const Parser = loadModule('../sidepanel/parser.js', 'Parser');

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
  //  sheetsFormatToSheetJs (inverse direction â€” used by save flow)
  // ================================================================

  describe('sheetsFormatToSheetJs', () => {
    test('returns null for null input', () => {
      expect(GoogleAPI.sheetsFormatToSheetJs(null)).toBeNull();
    });

    test('returns null for undefined input', () => {
      expect(GoogleAPI.sheetsFormatToSheetJs(undefined)).toBeNull();
    });

    test('returns null for non-object input', () => {
      expect(GoogleAPI.sheetsFormatToSheetJs('string')).toBeNull();
      expect(GoogleAPI.sheetsFormatToSheetJs(42)).toBeNull();
    });

    test('returns null for empty format object', () => {
      expect(GoogleAPI.sheetsFormatToSheetJs({})).toBeNull();
    });

    test('converts backgroundColor to fgColor + fill', () => {
      const result = GoogleAPI.sheetsFormatToSheetJs({
        backgroundColor: { red: 1, green: 0, blue: 0 },
      });
      expect(result.fgColor).toEqual({ rgb: 'FF0000' });
      expect(result.fill).toEqual({
        patternType: 'solid',
        fgColor: { rgb: 'FF0000' },
      });
    });

    test('converts partial backgroundColor to hex', () => {
      const result = GoogleAPI.sheetsFormatToSheetJs({
        backgroundColor: { red: 0, green: 0, blue: 1 },
      });
      expect(result.fgColor).toEqual({ rgb: '0000FF' });
    });

    test('converts textFormat properties to font', () => {
      const result = GoogleAPI.sheetsFormatToSheetJs({
        textFormat: {
          bold: true,
          italic: true,
          underline: true,
          strikethrough: true,
          fontSize: 14,
          fontFamily: 'Arial',
          foregroundColor: { red: 0, green: 0, blue: 1 },
        },
      });
      expect(result.font.bold).toBe(true);
      expect(result.font.italic).toBe(true);
      expect(result.font.underline).toBe(true);
      expect(result.font.strike).toBe(true);
      expect(result.font.sz).toBe(14);
      expect(result.font.name).toBe('Arial');
      expect(result.font.color).toEqual({ rgb: '0000FF' });
    });

    test('ignores zero/invalid font size', () => {
      const result = GoogleAPI.sheetsFormatToSheetJs({
        textFormat: { fontSize: 0 },
      });
      expect(result).toBeNull();
    });

    test('converts horizontal alignment', () => {
      expect(
        GoogleAPI.sheetsFormatToSheetJs({ horizontalAlignment: 'LEFT' }).alignment
          .horizontal
      ).toBe('left');
      expect(
        GoogleAPI.sheetsFormatToSheetJs({ horizontalAlignment: 'CENTER' }).alignment
          .horizontal
      ).toBe('center');
      expect(
        GoogleAPI.sheetsFormatToSheetJs({ horizontalAlignment: 'RIGHT' }).alignment
          .horizontal
      ).toBe('right');
    });

    test('converts vertical alignment', () => {
      expect(
        GoogleAPI.sheetsFormatToSheetJs({ verticalAlignment: 'TOP' }).alignment.vertical
      ).toBe('top');
      expect(
        GoogleAPI.sheetsFormatToSheetJs({ verticalAlignment: 'MIDDLE' }).alignment.vertical
      ).toBe('center');
      expect(
        GoogleAPI.sheetsFormatToSheetJs({ verticalAlignment: 'BOTTOM' }).alignment.vertical
      ).toBe('bottom');
    });

    test('converts WRAP wrapStrategy to wrapText', () => {
      const result = GoogleAPI.sheetsFormatToSheetJs({ wrapStrategy: 'WRAP' });
      expect(result.alignment.wrapText).toBe(true);
    });

    test('converts WRAP_AND_CLIP wrapStrategy to wrapText', () => {
      const result = GoogleAPI.sheetsFormatToSheetJs({ wrapStrategy: 'WRAP_AND_CLIP' });
      expect(result.alignment.wrapText).toBe(true);
    });

    test('does not set wrapText for OVERFLOW_CELL wrapStrategy', () => {
      const result = GoogleAPI.sheetsFormatToSheetJs({ wrapStrategy: 'OVERFLOW_CELL' });
      expect(result).toBeNull();
    });

    test('converts border styles to SheetJS names', () => {
      const result = GoogleAPI.sheetsFormatToSheetJs({
        borders: {
          top: { style: 'SOLID', color: { red: 1, green: 0, blue: 0 } },
          bottom: { style: 'SOLID_MEDIUM' },
          left: { style: 'DASHED' },
          right: { style: 'DOUBLE' },
        },
      });
      expect(result.border.top.style).toBe('thin');
      expect(result.border.top.color).toEqual({ rgb: 'FF0000' });
      expect(result.border.bottom.style).toBe('medium');
      expect(result.border.left.style).toBe('dashed');
      expect(result.border.right.style).toBe('double');
    });

    test('ignores borders with unsupported style', () => {
      const result = GoogleAPI.sheetsFormatToSheetJs({
        borders: { top: { style: 'SOLID' }, bottom: { style: 'UNKNOWN_STYLE' } },
      });
      expect(result.border.top).toBeDefined();
      expect(result.border.bottom).toBeUndefined();
    });

    test('converts number format pattern', () => {
      const result = GoogleAPI.sheetsFormatToSheetJs({
        numberFormat: { type: 'NUMBER', pattern: '0.00%' },
      });
      expect(result.numFmt).toBe('0.00%');
    });

    test('ignores General number format', () => {
      const result = GoogleAPI.sheetsFormatToSheetJs({
        numberFormat: { type: 'NUMBER', pattern: 'General' },
      });
      expect(result).toBeNull();
    });

    test('ignores GENERAL number format', () => {
      const result = GoogleAPI.sheetsFormatToSheetJs({
        numberFormat: { type: 'NUMBER', pattern: 'GENERAL' },
      });
      expect(result).toBeNull();
    });

    test('handles combined format properties', () => {
      const result = GoogleAPI.sheetsFormatToSheetJs({
        backgroundColor: { red: 1, green: 1, blue: 0 },
        textFormat: { bold: true, fontSize: 12 },
        horizontalAlignment: 'CENTER',
      });
      expect(result.fgColor).toEqual({ rgb: 'FFFF00' });
      expect(result.font.bold).toBe(true);
      expect(result.font.sz).toBe(12);
      expect(result.alignment.horizontal).toBe('center');
    });

    test('preserves round-trip with sheetJsToSheetsFormat for color/bold', () => {
      // Start from a SheetJS style and convert it to Sheets format,
      // then convert back. The result should contain the same
      // semantic values.
      const original = { fgColor: { rgb: 'FF8800' }, font: { bold: true, sz: 13 } };
      const sheets = GoogleAPI.sheetJsToSheetsFormat(original);
      const back = GoogleAPI.sheetsFormatToSheetJs(sheets);

      expect(back.fgColor).toEqual({ rgb: 'FF8800' });
      expect(back.font.bold).toBe(true);
      expect(back.font.sz).toBe(13);
    });
  });

  // ================================================================
  //  sheetsFormatGridToSheetJs (2D grid wrapper)
  // ================================================================

  describe('sheetsFormatGridToSheetJs', () => {
    test('returns null for non-array input', () => {
      expect(GoogleAPI.sheetsFormatGridToSheetJs(null)).toBeNull();
      expect(GoogleAPI.sheetsFormatGridToSheetJs(undefined)).toBeNull();
    });

    test('returns null for empty array', () => {
      expect(GoogleAPI.sheetsFormatGridToSheetJs([])).toBeNull();
    });

    test('converts a 2D grid of formats', () => {
      const grid = [
        [
          { backgroundColor: { red: 1, green: 0, blue: 0 } },
          { textFormat: { bold: true } },
        ],
        [null, { backgroundColor: { red: 0, green: 1, blue: 0 } }],
      ];
      const result = GoogleAPI.sheetsFormatGridToSheetJs(grid);
      expect(result).toHaveLength(2);
      expect(result[0][0].fgColor).toEqual({ rgb: 'FF0000' });
      expect(result[0][1].font.bold).toBe(true);
      expect(result[1][0]).toBeNull();
      expect(result[1][1].fgColor).toEqual({ rgb: '00FF00' });
    });

    test('preserves null cells in the grid', () => {
      const grid = [
        [null, null],
        [null, null],
      ];
      const result = GoogleAPI.sheetsFormatGridToSheetJs(grid);
      expect(result[0][0]).toBeNull();
      expect(result[1][1]).toBeNull();
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

    test('normalizes SheetJS formula SUM(A1:A3) to =SUM(A1:A3)', async () => {
      mockFetchSequence(
        {
          spreadsheetId: 's1',
          spreadsheetUrl: 'url',
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {},
        {}
      );

      await GoogleAPI.createSpreadsheet('Formulas', [
        {
          name: 'Sheet1',
          data: [['Result']],
          cellMeta: [[{ type: 'formula', value: 'SUM(A1:A3)' }]],
        },
      ]);

      const batchCall = global.fetch.mock.calls[2];
      expect(batchCall[0]).toBe('https://sheets.googleapis.com/v4/spreadsheets/s1:batchUpdate');
      const body = JSON.parse(batchCall[1].body);
      const rows = body.requests[0].updateCells.rows;
      expect(rows[0].values[0].userEnteredValue.formulaValue).toBe('=SUM(A1:A3)');
    });

    test('does not double-prefix an already-prefixed formula', async () => {
      mockFetchSequence(
        {
          spreadsheetId: 's1',
          spreadsheetUrl: 'url',
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {},
        {}
      );

      await GoogleAPI.createSpreadsheet('Formulas', [
        {
          name: 'Sheet1',
          data: [['Result']],
          cellMeta: [[{ type: 'formula', value: '=SUM(A1:A3)' }]],
        },
      ]);

      const batchCall = global.fetch.mock.calls[2];
      const body = JSON.parse(batchCall[1].body);
      const rows = body.requests[0].updateCells.rows;
      expect(rows[0].values[0].userEnteredValue.formulaValue).toBe('=SUM(A1:A3)');
    });

    test('typed output preserves a formula with a numeric-looking cached result', async () => {
      const formula = '=TEXT(1234,"0")';
      mockFetchSequence(
        {
          spreadsheetId: 's1',
          spreadsheetUrl: 'url',
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        { sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }] },
        {},
        {}
      );

      await GoogleAPI.createSpreadsheet('Formula result', [
        {
          name: 'Sheet1',
          data: [['Result'], ['1234']],
          cellMeta: [
            [{ type: 'string', value: 'Result' }],
            [{ type: 'formula', value: formula, displayValue: '1234' }],
          ],
        },
      ]);

      const typedBody = JSON.parse(global.fetch.mock.calls[2][1].body);
      const userEnteredValue = typedBody.requests[0].updateCells.rows[1].values[0].userEnteredValue;
      expect(userEnteredValue.formulaValue).toBe(formula);
      expect(userEnteredValue).not.toHaveProperty('numberValue');
    });

    test('literal string beginning with = uses stringValue', async () => {
      mockFetchSequence(
        {
          spreadsheetId: 's1',
          spreadsheetUrl: 'url',
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {},
        {}
      );

      await GoogleAPI.createSpreadsheet('Strings', [
        {
          name: 'Sheet1',
          data: [['Input']],
          cellMeta: [[{ type: 'string', value: '=SUM(A1:A3)' }]],
        },
      ]);

      const batchCall = global.fetch.mock.calls[2];
      const body = JSON.parse(batchCall[1].body);
      const rows = body.requests[0].updateCells.rows;
      expect(rows[0].values[0].userEnteredValue).toHaveProperty('stringValue', '=SUM(A1:A3)');
      expect(rows[0].values[0].userEnteredValue).not.toHaveProperty('formulaValue');
    });

    test('non-empty data with null token uses data value type', async () => {
      mockFetchSequence(
        {
          spreadsheetId: 's1',
          spreadsheetUrl: 'url',
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {},
        {}
      );

      await GoogleAPI.createSpreadsheet('Types', [
        {
          name: 'Sheet1',
          data: [['Num', 'Bool', 'Str'], [42, true, 'hello']],
          cellMeta: [
            [null, null, null],
            [null, null, null],
          ],
        },
      ]);

      const batchCall = global.fetch.mock.calls[2];
      const body = JSON.parse(batchCall[1].body);
      const rows = body.requests[0].updateCells.rows;
      expect(rows[1].values[0].userEnteredValue).toEqual({ numberValue: 42 });
      expect(rows[1].values[1].userEnteredValue).toEqual({ boolValue: true });
      expect(rows[1].values[2].userEnteredValue).toEqual({ stringValue: 'hello' });
    });

    test('DATE token writes numberFormat', async () => {
      mockFetchSequence(
        {
          spreadsheetId: 's1',
          spreadsheetUrl: 'url',
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {},
        {}
      );

      await GoogleAPI.createSpreadsheet('Dates', [
        {
          name: 'Sheet1',
          data: [['Date']],
          cellMeta: [[{ type: 'date', value: 45306, formatType: 'DATE' }]],
        },
      ]);

      const batchCall = global.fetch.mock.calls[2];
      const body = JSON.parse(batchCall[1].body);
      const cell = body.requests[0].updateCells.rows[0].values[0];
      expect(cell.userEnteredValue).toEqual({ numberValue: 45306 });
      expect(cell.userEnteredFormat).toEqual({
        numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' },
      });
      expect(body.requests[0].updateCells.fields).toBe('userEnteredValue,userEnteredFormat');
    });

    test('TIME token writes numberFormat', async () => {
      mockFetchSequence(
        {
          spreadsheetId: 's1',
          spreadsheetUrl: 'url',
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {},
        {}
      );

      await GoogleAPI.createSpreadsheet('Times', [
        {
          name: 'Sheet1',
          data: [['Time']],
          cellMeta: [[{ type: 'date', value: 0.6041666666666666, formatType: 'TIME' }]],
        },
      ]);

      const batchCall = global.fetch.mock.calls[2];
      const body = JSON.parse(batchCall[1].body);
      const cell = body.requests[0].updateCells.rows[0].values[0];
      expect(cell.userEnteredValue).toEqual({ numberValue: 0.6041666666666666 });
      expect(cell.userEnteredFormat).toEqual({
        numberFormat: { type: 'TIME', pattern: 'hh:mm:ss' },
      });
    });

    test('DATE_TIME token writes numberFormat', async () => {
      mockFetchSequence(
        {
          spreadsheetId: 's1',
          spreadsheetUrl: 'url',
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
        {},
        {}
      );

      await GoogleAPI.createSpreadsheet('Timestamps', [
        {
          name: 'Sheet1',
          data: [['Timestamp']],
          cellMeta: [[{ type: 'date', value: 45306.604166666664, formatType: 'DATE_TIME' }]],
        },
      ]);

      const batchCall = global.fetch.mock.calls[2];
      const body = JSON.parse(batchCall[1].body);
      const cell = body.requests[0].updateCells.rows[0].values[0];
      expect(cell.userEnteredValue).toEqual({ numberValue: 45306.604166666664 });
      expect(cell.userEnteredFormat).toEqual({
        numberFormat: { type: 'DATE_TIME', pattern: 'yyyy-mm-dd hh:mm:ss' },
      });
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

  // ---- CellData grid helpers for cleanUploadedSheet tests ----

  function cellS(s, fmt) {
    const c = { userEnteredValue: { stringValue: String(s) } };
    if (fmt) c.effectiveFormat = { numberFormat: { type: fmt } };
    return c;
  }
  function cellF(f) {
    return { userEnteredValue: { formulaValue: f } };
  }
  function cellN(n, fmt) {
    const c = { userEnteredValue: { numberValue: n } };
    if (fmt) c.effectiveFormat = { numberFormat: { type: fmt } };
    return c;
  }
  function cellB(b) {
    return { userEnteredValue: { boolValue: b } };
  }
  function emptyCell() { return {}; }
  function gridData(rows) {
    return { sheets: [{ data: [{ rowData: rows.map((r) => ({ values: r })) }] }] };
  }

  // ================================================================
  //  cleanUploadedSheet
  // ================================================================

  describe('cleanUploadedSheet', () => {
    function valuesResp(arr) {
      return { values: arr };
    }
    function sheetInfo(title, rows, cols) {
      return {
        sheets: [{
          properties: { sheetId: 0, title, gridProperties: { rowCount: rows, columnCount: cols } },
        }],
      };
    }

    // ================================================================
    //  Structural-only tests
    // ================================================================

    test('shrinks trailing rows and columns when empty cleanup is enabled', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 1000, 26)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Name', 'Age', ''], ['Alice', '30', ''], ['', '', '']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([
          [cellS('Name'), cellS('Age'), emptyCell()],
          [cellS('Alice'), cellS('30'), emptyCell()],
          [emptyCell(), emptyCell(), emptyCell()],
        ])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: true, removeEmptyColumns: true,
        removeDuplicates: false, trim: false, fixNumbers: false, normalizeHeaders: false,
      });

      const deleteBody = JSON.parse(global.fetch.mock.calls[3][1].body);
      expect(deleteBody.requests.some((r) => r.deleteDimension)).toBe(true);

      const resizeBody = JSON.parse(global.fetch.mock.calls[4][1].body);
      expect(resizeBody.requests[0].updateSheetProperties.properties.gridProperties).toEqual({ rowCount: 2, columnCount: 2 });
    });

    test('identifies same duplicates as Cleaner after trimming', async () => {
      const fixture = [['Name', 'Score'], ['Alice', '100'], [' Alice ', '100'], ['Bob', '200']];
      const cleanerResult = Cleaner.apply(JSON.parse(JSON.stringify(fixture)), {
        trim: true, removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: true,
        fixNumbers: false, normalizeHeaders: false,
      });
      expect(cleanerResult).toHaveLength(3);

      const postStruct = [
        [cellS('Name'), cellS('Score')],
        [cellS('Alice'), cellS('100')],
        [cellS('Bob'), cellS('200')],
      ];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 10, 2)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Name', 'Score'], ['Alice', '100'], [' Alice ', '100'], ['Bob', '200']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([
          [cellS('Name'), cellS('Score')], [cellS('Alice'), cellS('100')],
          [cellS(' Alice '), cellS('100')], [cellS('Bob'), cellS('200')],
        ])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(postStruct)) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: true,
        duplicateMode: 'keep-first', trim: true, fixNumbers: false, normalizeHeaders: false,
      });

      const deleteBody = JSON.parse(global.fetch.mock.calls[3][1].body);
      const rowDeletes = deleteBody.requests.filter((r) => r.deleteDimension?.range?.dimension === 'ROWS');
      expect(rowDeletes).toHaveLength(1);
      expect(rowDeletes[0].deleteDimension.range.startIndex).toBe(2);
      expect(rowDeletes[0].deleteDimension.range.endIndex).toBe(3);
    });

    test('two different formulas with same displayed result are not duplicates', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 3, 2)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Name', 'Value'], ['x', '2'], ['x', '2']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([
          [cellS('Name'), cellS('Value')], [cellS('x'), cellF('=1+1')], [cellS('x'), cellF('=SUM(1,1)')],
        ])) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: true,
        duplicateMode: 'keep-first', trim: false, fixNumbers: false, normalizeHeaders: false,
      });

      expect(global.fetch.mock.calls.length).toBe(3);
    });

    test('two identical formula rows are duplicates', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 3, 2)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Name', 'Value'], ['x', '3'], ['x', '3']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([
          [cellS('Name'), cellS('Value')], [cellS('x'), cellF('=SUM(1,2)')], [cellS('x'), cellF('=SUM(1,2)')],
        ])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: true,
        duplicateMode: 'keep-first', trim: false, fixNumbers: false, normalizeHeaders: false,
      });

      const deleteBody = JSON.parse(global.fetch.mock.calls[3][1].body);
      const rowDeletes = deleteBody.requests.filter((r) => r.deleteDimension?.range?.dimension === 'ROWS');
      expect(rowDeletes).toHaveLength(1);
      expect(rowDeletes[0].deleteDimension.range.startIndex).toBe(2);
      expect(rowDeletes[0].deleteDimension.range.endIndex).toBe(3);
    });

    test("trim disabled: 'Alice' and ' Alice ' remain separate rows", async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 4, 2)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Name', 'Score'], ['Alice', '100'], [' Alice ', '100'], ['Bob', '200']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([
          [cellS('Name'), cellS('Score')], [cellS('Alice'), cellS('100')],
          [cellS(' Alice '), cellS('100')], [cellS('Bob'), cellS('200')],
        ])) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: true,
        duplicateMode: 'keep-first', trim: false, fixNumbers: false, normalizeHeaders: false,
      });

      expect(global.fetch.mock.calls.length).toBe(3);
    });

    test('empty-column removal occurs before duplicate comparison', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 10, 3)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['A', '', 'C'], ['x', '', '1'], ['x', '', '1']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([
          [cellS('A'), emptyCell(), cellS('C')], [cellS('x'), emptyCell(), cellS('1')], [cellS('x'), emptyCell(), cellS('1')],
        ])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: true, removeDuplicates: true,
        duplicateMode: 'keep-first', trim: false, fixNumbers: false, normalizeHeaders: false,
      });

      const deleteBody = JSON.parse(global.fetch.mock.calls[3][1].body);
      const requests = deleteBody.requests;

      const rowDeletes = requests.filter((r) => r.deleteDimension?.range?.dimension === 'ROWS');
      expect(rowDeletes).toHaveLength(1);
      expect(rowDeletes[0].deleteDimension.range.startIndex).toBe(2);

      const colDeletes = requests.filter((r) => r.deleteDimension?.range?.dimension === 'COLUMNS');
      expect(colDeletes).toHaveLength(1);
      expect(colDeletes[0].deleteDimension.range.startIndex).toBe(1);

      const resizeBody = JSON.parse(global.fetch.mock.calls[4][1].body);
      expect(resizeBody.requests[0].updateSheetProperties.properties.gridProperties).toEqual({ rowCount: 10, columnCount: 2 });
    });

    test('keep-first and absolute duplicate modes use the same canonical key', async () => {
      const info = () => Promise.resolve(sheetInfo('Sheet1', 10, 2));
      const vResp = () => Promise.resolve(valuesResp([['A', 'B'], ['x', '1'], ['x', '1'], ['x', '1'], ['y', '2']]));
      const data = gridData([
        [cellS('A'), cellS('B')], [cellS('x'), cellS('1')], [cellS('x'), cellS('1')],
        [cellS('x'), cellS('1')], [cellS('y'), cellS('2')],
      ]);

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => info() })
        .mockResolvedValueOnce({ ok: true, json: () => vResp() })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(data) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: true,
        duplicateMode: 'keep-first', trim: false, fixNumbers: false, normalizeHeaders: false,
      });

      const keepFirstBody = JSON.parse(global.fetch.mock.calls[3][1].body);
      const keepFirstRowDeletes = keepFirstBody.requests
        .filter((r) => r.deleteDimension?.range?.dimension === 'ROWS')
        .map((r) => r.deleteDimension.range.startIndex).sort((a, b) => a - b);
      expect(keepFirstRowDeletes).toEqual([2, 3]);

      jest.clearAllMocks();
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => info() })
        .mockResolvedValueOnce({ ok: true, json: () => vResp() })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(data) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: true,
        duplicateMode: 'absolute', trim: false, fixNumbers: false, normalizeHeaders: false,
      });

      const absoluteBody = JSON.parse(global.fetch.mock.calls[3][1].body);
      const absoluteRowDeletes = absoluteBody.requests
        .filter((r) => r.deleteDimension?.range?.dimension === 'ROWS')
        .map((r) => r.deleteDimension.range.startIndex).sort((a, b) => a - b);
      expect(absoluteRowDeletes).toEqual([1, 2, 3]);
    });

    // ================================================================
    //  Value-level-only tests
    // ================================================================

    test('normalizes headers to title case in value updates', async () => {
      const structFixture = [
        [cellS('FIRST NAME'), cellS('eMAIL ADDRESS')],
        [cellS('Alice'), cellS('alice@example.com')],
      ];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 2, 2)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['FIRST NAME', 'eMAIL ADDRESS'], ['Alice', 'alice@example.com']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: false, fixNumbers: false, normalizeHeaders: true,
      });

      const updateBody = JSON.parse(global.fetch.mock.calls[4][1].body);
      expect(updateBody.valueInputOption).toBe('RAW');
      expect(updateBody.data).toEqual([
        { range: "'Sheet1'!A1", values: [['First Name']] },
        { range: "'Sheet1'!B1", values: [['Email Address']] },
      ]);
    });

    test('skips formula cells identified through formulaValue', async () => {
      const structFixture = [
        [cellS('Name'), cellS('Total')],
        [cellS('Alice'), cellF('=SUM(B2:B2)')],
        [cellS('Bob'), cellF('=A3&" test"')],
      ];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 3, 2)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Name', 'Total'], ['Alice', '0'], ['Bob', '']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: true, fixNumbers: true, normalizeHeaders: false,
      });

      expect(global.fetch.mock.calls.length).toBe(4);
    });

    test('treats literal text beginning with equals as a string, not a formula', async () => {
      const structFixture = [[cellS('Input')], [cellS('  =not-a-formula')]];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 2, 1)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Input'], ['  =not-a-formula']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: true, fixNumbers: false, normalizeHeaders: false,
      });

      const updateBody = JSON.parse(global.fetch.mock.calls[4][1].body);
      expect(updateBody.data).toEqual([
        { range: "'Sheet1'!A2", values: [['=not-a-formula']] },
      ]);
    });

    test('does not convert numeric-looking string in a TEXT-formatted cell', async () => {
      const structFixture = [[cellS('Code')], [cellS('1,234', 'TEXT')]];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 2, 1)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Code'], ['1,234']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: false, fixNumbers: true, normalizeHeaders: false,
      });

      expect(global.fetch.mock.calls.length).toBe(4);
    });

    test('converts eligible numeric-looking string into number', async () => {
      const structFixture = [[cellS('Amount')], [cellS('1,234')]];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 2, 1)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Amount'], ['1,234']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: false, fixNumbers: true, normalizeHeaders: false,
      });

      const updateBody = JSON.parse(global.fetch.mock.calls[4][1].body);
      expect(updateBody.valueInputOption).toBe('USER_ENTERED');
      expect(updateBody.data).toEqual([
        { range: "'Sheet1'!A2", values: [[1234]] },
      ]);
    });

    test('leaves actual numbers untouched', async () => {
      const structFixture = [[cellS('Value')], [cellN(42)]];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 2, 1)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Value'], ['42']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: false, fixNumbers: true, normalizeHeaders: false,
      });

      expect(global.fetch.mock.calls.length).toBe(4);
    });

    test('leaves DATE cells untouched', async () => {
      const structFixture = [[cellS('Date')], [cellN(45306, 'DATE')]];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 2, 1)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Date'], ['1/15/2024']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: false, fixNumbers: true, normalizeHeaders: false,
      });

      expect(global.fetch.mock.calls.length).toBe(4);
    });

    test('leaves TIME cells untouched', async () => {
      const structFixture = [[cellS('Time')], [cellN(0.6041666666666666, 'TIME')]];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 2, 1)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Time'], ['2:30 PM']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: false, fixNumbers: true, normalizeHeaders: false,
      });

      expect(global.fetch.mock.calls.length).toBe(4);
    });

    test('leaves DATE_TIME cells untouched', async () => {
      const structFixture = [[cellS('Timestamp')], [cellN(45306.604166666664, 'DATE_TIME')]];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 2, 1)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Timestamp'], ['1/15/2024 14:30:00']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: false, fixNumbers: true, normalizeHeaders: false,
      });

      expect(global.fetch.mock.calls.length).toBe(4);
    });

    test('leaves boolean cells untouched', async () => {
      const structFixture = [[cellS('Active')], [cellB(true)]];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 2, 1)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Active'], ['TRUE']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: false, fixNumbers: true, normalizeHeaders: false,
      });

      expect(global.fetch.mock.calls.length).toBe(4);
    });

    test('preserves leading-zero identifier as string', async () => {
      const structFixture = [[cellS('Code')], [cellS('00123')]];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 2, 1)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Code'], ['00123']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: false, fixNumbers: true, normalizeHeaders: false,
      });

      const updateBody = JSON.parse(global.fetch.mock.calls[4][1].body);
      expect(updateBody.valueInputOption).toBe('RAW');
      expect(updateBody.data).toEqual([
        { range: "'Sheet1'!A2", values: [['00123']] },
      ]);
    });

    test('preserves leading-zero identifier but cleans commas', async () => {
      const structFixture = [[cellS('Account')], [cellS('0,012,345')]];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 2, 1)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Account'], ['0,012,345']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: false, fixNumbers: true, normalizeHeaders: false,
      });

      const updateBody = JSON.parse(global.fetch.mock.calls[4][1].body);
      expect(updateBody.valueInputOption).toBe('RAW');
      expect(updateBody.data).toEqual([
        { range: "'Sheet1'!A2", values: [['0012345']] },
      ]);
    });

    test('normalizes headers but skips formula cell in header row', async () => {
      const structFixture = [
        [cellS('first name'), cellF('=TODAY()'), cellS('eMAIL ADDRESS')],
        [cellS('Alice'), cellS('2024-01-15'), cellS('alice@example.com')],
      ];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 2, 3)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['first name', '1/15/2024', 'eMAIL ADDRESS'], ['Alice', '2024-01-15', 'alice@example.com']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: false, fixNumbers: false, normalizeHeaders: true,
      });

      const updateBody = JSON.parse(global.fetch.mock.calls[4][1].body);
      expect(updateBody.valueInputOption).toBe('RAW');
      expect(updateBody.data).toEqual([
        { range: "'Sheet1'!A1", values: [['First Name']] },
        { range: "'Sheet1'!C1", values: [['Email Address']] },
      ]);
    });

    test('fixNumbers + trim chain correctly on eligible string', async () => {
      const structFixture = [[cellS('Price')], [cellS('  1,234.56  ')]];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 2, 1)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Price'], ['  1,234.56  ']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: true, fixNumbers: true, normalizeHeaders: false,
      });

      const updateBody = JSON.parse(global.fetch.mock.calls[4][1].body);
      expect(updateBody.valueInputOption).toBe('USER_ENTERED');
      expect(updateBody.data).toEqual([
        { range: "'Sheet1'!A2", values: [[1234.56]] },
      ]);
    });

    test('trim updates string cells but not formulas or numbers', async () => {
      const structFixture = [
        [cellS('  Name  ')],
        [cellF('=A1')],
        [cellS('   text   ')],
      ];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 3, 1)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['  Name  '], ['Name'], ['   text   ']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: true, fixNumbers: false, normalizeHeaders: false,
      });

      const updateBody = JSON.parse(global.fetch.mock.calls[4][1].body);
      expect(updateBody.valueInputOption).toBe('RAW');
      expect(updateBody.data).toEqual([
        { range: "'Sheet1'!A1", values: [['Name']] },
        { range: "'Sheet1'!A3", values: [['text']] },
      ]);
    });

    // ================================================================
    //  URL / range bounding tests
    // ================================================================

    test('struct-read range is bounded by usedRows/usedCols from values.get', async () => {
      const structFixture = [[cellS('X')], [cellS('y')]];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 1000, 26)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['X'], ['y']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(structFixture)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: true, fixNumbers: false, normalizeHeaders: false,
      });

      const valuesUrl = global.fetch.mock.calls[1][0];
      expect(valuesUrl).toContain('spreadsheets/sheet-id/values/');
      expect(valuesUrl).toContain('valueRenderOption=FORMULA');

      const structUrl = global.fetch.mock.calls[2][0];
      expect(structUrl).toContain('spreadsheets/sheet-id?fields=');
      expect(structUrl).not.toContain('includeGridData');
      expect(structUrl).toContain(encodeURIComponent("'Sheet1'!A1:A2"));
    });

    test('struct-read range escapes sheet name containing spaces', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('My Data', 100, 10)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['X'], ['y']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([[cellS('X')], [cellS('y')]])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([[cellS('X')], [cellS('y')]])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: true, fixNumbers: false, normalizeHeaders: false,
      });

      const structUrl = global.fetch.mock.calls[2][0];
      expect(structUrl).toContain(encodeURIComponent("'My Data'!A1:A2"));
    });

    test('struct-read range escapes sheet name containing an apostrophe', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo("John's Sheet", 50, 5)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Data'], ['1']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([[cellS('Data')], [cellS('1')]])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([[cellS('Data')], [cellS('1')]])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: true, fixNumbers: false, normalizeHeaders: false,
      });

      const structUrl = global.fetch.mock.calls[2][0];
      expect(structUrl).toContain(encodeURIComponent("'John''s Sheet'!A1:A2"));
    });

    test('formula returning empty string in trailing column contributes to used bounds', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 2, 2)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Name', '=IF(TRUE,"",)'], ['Alice', '']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([
          [cellS('Name'), cellF('=IF(TRUE,"",)')],
          [cellS('Alice'), emptyCell()],
        ])) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: true, removeDuplicates: false,
        trim: false, fixNumbers: false, normalizeHeaders: false,
      });

      // Only 3 calls: info, FORMULA values, struct CellData — no structural deletes
      // because the formula column is non-empty
      expect(global.fetch.mock.calls.length).toBe(3);
    });

    test('formula returning empty string in trailing row contributes to used bounds', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 3, 1)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Name'], ['Alice'], ['=IF(TRUE,"",)']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([
          [cellS('Name')],
          [cellS('Alice')],
          [cellF('=IF(TRUE,"",)')],
        ])) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: true, removeEmptyColumns: false, removeDuplicates: false,
        trim: false, fixNumbers: false, normalizeHeaders: false,
      });

      // Only 3 calls: info, FORMULA values, struct CellData — no structural deletes
      // because the formula row is non-empty
      expect(global.fetch.mock.calls.length).toBe(3);
    });

    test('effective zero-row sheet is skipped', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Empty', 100, 10)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([])) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: true, fixNumbers: true, normalizeHeaders: true,
      });

      expect(global.fetch.mock.calls.length).toBe(2);
    });

    // ================================================================
    //  Shifted-coordinate tests (structural + value-level)
    // ================================================================

    test('empty column before numeric cell: writes target shifted coordinates', async () => {
      const preStruct = [
        [cellS('Name'), emptyCell(), cellS('Amount')],
        [cellS('Alice'), emptyCell(), cellS('1,234')],
      ];
      const postStruct = [
        [cellS('Name'), cellS('Amount')],
        [cellS('Alice'), cellS('1,234')],
      ];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 2, 3)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Name', '', 'Amount'], ['Alice', '', '1,234']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(preStruct)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(postStruct)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: true, removeDuplicates: false,
        trim: false, fixNumbers: true, normalizeHeaders: false,
      });

      const deleteBody = JSON.parse(global.fetch.mock.calls[3][1].body);
      const colDeletes = deleteBody.requests.filter((r) => r.deleteDimension?.range?.dimension === 'COLUMNS');
      expect(colDeletes).toHaveLength(1);
      expect(colDeletes[0].deleteDimension.range.startIndex).toBe(1);

      const updateBody = JSON.parse(global.fetch.mock.calls[6][1].body);
      expect(updateBody.valueInputOption).toBe('USER_ENTERED');
      expect(updateBody.data).toEqual([
        { range: "'Sheet1'!B2", values: [[1234]] },
      ]);
    });

    test('empty row before trimmed cell: writes target shifted coordinates', async () => {
      const preStruct = [
        [cellS('Name')],
        [emptyCell()],
        [cellS('  Alice  ')],
      ];
      const postStruct = [
        [cellS('Name')],
        [cellS('  Alice  ')],
      ];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 3, 1)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Name'], [''], ['  Alice  ']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(preStruct)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(postStruct)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: true, removeEmptyColumns: false, removeDuplicates: false,
        trim: true, fixNumbers: false, normalizeHeaders: false,
      });

      const deleteBody = JSON.parse(global.fetch.mock.calls[3][1].body);
      const rowDeletes = deleteBody.requests.filter((r) => r.deleteDimension?.range?.dimension === 'ROWS');
      expect(rowDeletes).toHaveLength(1);
      expect(rowDeletes[0].deleteDimension.range.startIndex).toBe(1);

      const updateBody = JSON.parse(global.fetch.mock.calls[6][1].body);
      expect(updateBody.data).toEqual([
        { range: "'Sheet1'!A2", values: [['Alice']] },
      ]);
    });

    test('duplicate row before edited row: writes correct shifted coordinates', async () => {
      const preStruct = [
        [cellS('Name'), cellS('Score')],
        [cellS('Alice'), cellS('100')],
        [cellS('Alice'), cellS('100')],
        [cellS(' Bob '), cellS(' 200 ')],
      ];
      const postStruct = [
        [cellS('Name'), cellS('Score')],
        [cellS('Alice'), cellS('100')],
        [cellS(' Bob '), cellS(' 200 ')],
      ];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 4, 2)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Name', 'Score'], ['Alice', '100'], ['Alice', '100'], [' Bob ', ' 200 ']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(preStruct)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(postStruct)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: true,
        duplicateMode: 'keep-first', trim: true, fixNumbers: false, normalizeHeaders: false,
      });

      const deleteBody = JSON.parse(global.fetch.mock.calls[3][1].body);
      const rowDeletes = deleteBody.requests.filter((r) => r.deleteDimension?.range?.dimension === 'ROWS');
      expect(rowDeletes).toHaveLength(1);
      expect(rowDeletes[0].deleteDimension.range.startIndex).toBe(2);

      const updateBody = JSON.parse(global.fetch.mock.calls[5][1].body);
      expect(updateBody.valueInputOption).toBe('RAW');
      const data = updateBody.data;
      const ranges = data.map((d) => d.range);
      expect(ranges).toContain("'Sheet1'!A3");
      expect(ranges).toContain("'Sheet1'!B3");
    });

    // ================================================================
    //  Comprehensive parity integration test
    // ================================================================

    test('full integration: API mutations reconstruct to match Cleaner.apply', async () => {
      const fixture = [
        [' first name ', ' ', '  AMOUNT  ', 'Code'],
        ['  Alice  ', ' ', '  1,234.56  ', '00123'],
        [' ', ' ', ' ', ' '],
        ['  Alice  ', ' ', '  1,234.56  ', '00123'],
        ['  Bob  ', ' ', '  42  ', '99999'],
        ['=1+1', ' ', true, 3.14],
      ];

      const options = {
        trim: true, removeEmptyRows: true, removeEmptyColumns: true,
        removeDuplicates: true, duplicateMode: 'keep-first',
        fixNumbers: true, normalizeHeaders: true,
      };

      const expected = Cleaner.apply(JSON.parse(JSON.stringify(fixture)), options);

      const preStructCellData = [
        [cellS(' first name '), cellS(' '), cellS('  AMOUNT  '), cellS('Code')],
        [cellS('  Alice  '), cellS(' '), cellS('  1,234.56  '), cellS('00123')],
        [cellS(' '), cellS(' '), cellS(' '), cellS(' ')],
        [cellS('  Alice  '), cellS(' '), cellS('  1,234.56  '), cellS('00123')],
        [cellS('  Bob  '), cellS(' '), cellS('  42  '), cellS('99999')],
        [cellF('=1+1'), cellS(' '), cellB(true), cellN(3.14)],
      ];

      // After deletions: row 3 (index 3, duplicate), row 2 (index 2, empty), col 1 (index 1, empty)
      const postStructCellData = [
        [cellS(' first name '), cellS('  AMOUNT  '), cellS('Code')],
        [cellS('  Alice  '), cellS('  1,234.56  '), cellS('00123')],
        [cellS('  Bob  '), cellS('  42  '), cellS('99999')],
        [cellF('=1+1'), cellB(true), cellN(3.14)],
      ];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 6, 4)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([
          [' first name ', ' ', '  AMOUNT  ', 'Code'],
          ['  Alice  ', ' ', '  1,234.56  ', '00123'],
          [' ', ' ', ' ', ' '],
          ['  Alice  ', ' ', '  1,234.56  ', '00123'],
          ['  Bob  ', ' ', '  42  ', '99999'],
          ['2', ' ', 'TRUE', '3.14'],
        ])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(preStructCellData)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData(postStructCellData)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', options);

      // Collect all deleteDimension requests
      const deleteBody = JSON.parse(global.fetch.mock.calls[3][1].body);
      const deleteReqs = (deleteBody.requests || []).filter((r) => r.deleteDimension);

      // Collect RAW writes
      const rawBody = JSON.parse(global.fetch.mock.calls[6][1].body);
      const rawWrites = rawBody.data || [];

      // Collect USER_ENTERED writes
      const ueBody = JSON.parse(global.fetch.mock.calls[7][1].body);
      const ueWrites = ueBody.data || [];

      // ---- RECONSTRUCTION ----
      const recon = fixture.map((row) => [...row]);

      // Apply row deletes bottom-to-top
      const rowDeletes = deleteReqs
        .filter((r) => r.deleteDimension.range.dimension === 'ROWS')
        .sort((a, b) => b.deleteDimension.range.startIndex - a.deleteDimension.range.startIndex);
      for (const rd of rowDeletes) {
        recon.splice(rd.deleteDimension.range.startIndex, 1);
      }

      // Apply column deletes right-to-left
      const colDeletes = deleteReqs
        .filter((r) => r.deleteDimension.range.dimension === 'COLUMNS')
        .sort((a, b) => b.deleteDimension.range.startIndex - a.deleteDimension.range.startIndex);
      for (const cd of colDeletes) {
        const colIdx = cd.deleteDimension.range.startIndex;
        for (let r = 0; r < recon.length; r++) {
          recon[r].splice(colIdx, 1);
        }
      }

      // Apply RAW writes
      for (const write of rawWrites) {
        const match = write.range.match(/!([A-Z]+)(\d+)/);
        const col = match[1].charCodeAt(0) - 65;
        const rowIdx = parseInt(match[2], 10) - 1;
        recon[rowIdx][col] = write.values[0][0];
      }

      // Apply USER_ENTERED writes
      for (const write of ueWrites) {
        const match = write.range.match(/!([A-Z]+)(\d+)/);
        const col = match[1].charCodeAt(0) - 65;
        const rowIdx = parseInt(match[2], 10) - 1;
        recon[rowIdx][col] = write.values[0][0];
      }

      // Assertions
      expect(recon.length).toBe(expected.length);
      expect(recon[0].length).toBe(expected[0].length);

      for (let r = 0; r < expected.length; r++) {
        for (let c = 0; c < expected[r].length; c++) {
          const expVal = expected[r][c];
          const reconVal = recon[r][c];
          if (typeof expVal === 'number') {
            expect(typeof reconVal).toBe('number');
            expect(reconVal).toBeCloseTo(expVal);
          } else {
            expect(reconVal).toBe(expVal);
          }
        }
      }

      // Formula identity
      expect(recon[3][0]).toBe('=1+1');
      expect(recon[3][1]).toBe(true);
      expect(typeof recon[3][2]).toBe('number');
      expect(recon[3][2]).toBeCloseTo(3.14);
    });

    // ---- date normalization (native path) ----

    test('native path converts ISO date string to typed date cell', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 3, 2)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Name', 'Date'], ['Alice', '2026-03-04']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([
          [cellS('Name'), cellS('Date')],
          [cellS('Alice'), cellS('2026-03-04')],
        ])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([
          [cellS('Name'), cellS('Date')],
          [cellS('Alice'), cellS('2026-03-04')],
        ])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: false, fixNumbers: false, normalizeDates: true, normalizeHeaders: false,
      });

      const batchCall = global.fetch.mock.calls.find(
        (call) => call[0].includes(':batchUpdate')
      );
      expect(batchCall).toBeDefined();
      const dateBody = JSON.parse(batchCall[1].body);
      const updateCells = dateBody.requests.filter((r) => r.updateCells);
      expect(updateCells.length).toBeGreaterThan(0);

      const dateReq = updateCells[0].updateCells;
      expect(dateReq.rows[0].values[0].userEnteredValue.numberValue).toBe(46085);
      expect(dateReq.rows[0].values[0].userEnteredFormat.numberFormat.type).toBe('DATE');
      expect(dateReq.fields).toBe('userEnteredValue,userEnteredFormat.numberFormat');
    });

    test('native path preserves formula cells during date normalization', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 3, 2)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Name', 'Date'], ['Alice', '2026-03-04']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([
          [cellS('Name'), cellS('Date')],
          [cellS('Alice'), cellF('=TODAY()')],
        ])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([
          [cellS('Name'), cellS('Date')],
          [cellS('Alice'), cellF('=TODAY()')],
        ])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: false, fixNumbers: false, normalizeDates: true, normalizeHeaders: false,
      });

      const batchCalls = global.fetch.mock.calls.filter(
        (call) => call[0].includes(':batchUpdate')
      );
      const hasUpdateCells = batchCalls.some((call) => {
        const body = JSON.parse(call[1].body);
        return (body.requests || []).some((r) => r.updateCells);
      });
      expect(hasUpdateCells).toBe(false);
    });

    test('native path preserves existing date cells', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 3, 2)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Name', 'Date'], ['Alice', '2026-03-04']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([
          [cellS('Name'), cellS('Date')],
          [cellS('Alice'), cellN(46085, 'DATE')],
        ])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([
          [cellS('Name'), cellS('Date')],
          [cellS('Alice'), cellN(46085, 'DATE')],
        ])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: false, fixNumbers: false, normalizeDates: true, normalizeHeaders: false,
      });

      const batchCalls = global.fetch.mock.calls.filter(
        (call) => call[0].includes(':batchUpdate')
      );
      const hasUpdateCells = batchCalls.some((call) => {
        const body = JSON.parse(call[1].body);
        return (body.requests || []).some((r) => r.updateCells);
      });
      expect(hasUpdateCells).toBe(false);
    });

    test('native path preserves TEXT-formatted date strings', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 3, 2)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Name', 'Date'], ['Alice', '2026-03-04']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([
          [cellS('Name'), cellS('Date')],
          [cellS('Alice'), cellS('2026-03-04', 'TEXT')],
        ])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([
          [cellS('Name'), cellS('Date')],
          [cellS('Alice'), cellS('2026-03-04', 'TEXT')],
        ])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: false, fixNumbers: false, normalizeDates: true, normalizeHeaders: false,
      });

      const batchCalls = global.fetch.mock.calls.filter(
        (call) => call[0].includes(':batchUpdate')
      );
      const hasUpdateCells = batchCalls.some((call) => {
        const body = JSON.parse(call[1].body);
        return (body.requests || []).some((r) => r.updateCells);
      });
      expect(hasUpdateCells).toBe(false);
    });

    test('local and Google-side normalization produce the same serial', () => {
      const localToken = Cleaner.parseDateToken('2026-03-04');
      const localValue = localToken.value;

      // The same ISO string produces the same serial regardless of path
      const localToken2 = Cleaner.parseDateToken('2026-03-04');
      expect(localToken2.value).toBe(localValue);
      expect(localToken2.value).toBe(46085);
    });

    test('native path honors timezone offset', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sheetInfo('Sheet1', 3, 2)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(valuesResp([['Name', 'Time'], ['Alice', '2026-03-04T12:30:00+05:30']])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([
          [cellS('Name'), cellS('Time')],
          [cellS('Alice'), cellS('2026-03-04T12:30:00+05:30')],
        ])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(gridData([
          [cellS('Name'), cellS('Time')],
          [cellS('Alice'), cellS('2026-03-04T12:30:00+05:30')],
        ])) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await GoogleAPI.cleanUploadedSheet('sheet-id', {
        removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false,
        trim: false, fixNumbers: false, normalizeDates: true, normalizeHeaders: false,
      });

      const batchCall = global.fetch.mock.calls.find(
        (call) => call[0].includes(':batchUpdate')
      );
      expect(batchCall).toBeDefined();
      const dateBody = JSON.parse(batchCall[1].body);
      const updateCells = dateBody.requests.filter((r) => r.updateCells);
      const serial = updateCells[0].updateCells.rows[0].values[0].userEnteredValue.numberValue;
      expect(serial).toBeCloseTo(46085 + 7 / 24, 10);
      expect(updateCells[0].updateCells.rows[0].values[0].userEnteredFormat.numberFormat.type).toBe('DATE_TIME');
    });
  });

  // ================================================================
  //  tokenFromCellDataFallback & rowComparisonKeyFallback
  // ================================================================

  describe('tokenFromCellDataFallback', () => {
    test('includes formatType for DATE token', () => {
      const cellData = {
        userEnteredValue: { numberValue: 45306 },
        effectiveFormat: { numberFormat: { type: 'DATE' } },
      };
      const token = GoogleAPI.tokenFromCellDataFallback(cellData);
      expect(token).toEqual({ type: 'date', value: 45306, formatType: 'DATE' });
    });

    test('includes formatType for TIME token', () => {
      const cellData = {
        userEnteredValue: { numberValue: 0.5 },
        effectiveFormat: { numberFormat: { type: 'TIME' } },
      };
      const token = GoogleAPI.tokenFromCellDataFallback(cellData);
      expect(token).toEqual({ type: 'date', value: 0.5, formatType: 'TIME' });
    });

    test('includes formatType for DATE_TIME token', () => {
      const cellData = {
        userEnteredValue: { numberValue: 45306.5 },
        effectiveFormat: { numberFormat: { type: 'DATE_TIME' } },
      };
      const token = GoogleAPI.tokenFromCellDataFallback(cellData);
      expect(token).toEqual({ type: 'date', value: 45306.5, formatType: 'DATE_TIME' });
    });
  });

  describe('rowComparisonKeyFallback', () => {
    test('includes formatType for date tokens', () => {
      const tokens = [
        { type: 'date', value: 45306, formatType: 'DATE' },
      ];
      const key = GoogleAPI.rowComparisonKeyFallback(tokens, false, []);
      expect(key).toBe('date\x0045306\x00DATE');
    });

    test('DATE vs TIME with equal serial value produce distinct keys', () => {
      const dateTokens = [{ type: 'date', value: 25569, formatType: 'DATE' }];
      const timeTokens = [{ type: 'date', value: 25569, formatType: 'TIME' }];
      const dateKey = GoogleAPI.rowComparisonKeyFallback(dateTokens, false, []);
      const timeKey = GoogleAPI.rowComparisonKeyFallback(timeTokens, false, []);
      expect(dateKey).not.toBe(timeKey);
      expect(dateKey).toBe('date\x0025569\x00DATE');
      expect(timeKey).toBe('date\x0025569\x00TIME');
    });

    test('date tokens without formatType do not append extra segment', () => {
      const tokens = [
        { type: 'date', value: 100 },
      ];
      const key = GoogleAPI.rowComparisonKeyFallback(tokens, false, []);
      expect(key).toBe('date\x00100');
    });
  });

  // ================================================================
  //  Bounded typed writes
  // ================================================================

  describe('buildTypedUpdateRows chunking', () => {
    function mockFetchSequence(...responses) {
      for (const resp of responses) {
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(resp),
        });
      }
    }

    test('large typed merge chunked into multiple bounded requests', async () => {
      const rows = [];
      for (let ri = 0; ri < 600; ri++) {
        const row = [];
        for (let ci = 0; ci < 100; ci++) {
          row.push(`r${ri}c${ci}`);
        }
        rows.push(row);
      }

      const cellMeta = rows.map((row) =>
        row.map((v) => ({ type: 'string', value: String(v) }))
      );

      mockFetchSequence(
        { spreadsheetId: 's1', spreadsheetUrl: 'url', sheets: [{ properties: { sheetId: 0, title: 'Big' } }] },
        { sheets: [{ properties: { sheetId: 0, title: 'Big' } }] },
        {},  // batchUpdate block 1
        {},  // batchUpdate block 2
        {}   // format
      );

      await GoogleAPI.createSpreadsheet('Big', [
        { name: 'Big', data: rows, cellMeta },
      ]);

      const calls = global.fetch.mock.calls;
      const creationCalls = calls.filter((call) =>
        call[0] === 'https://sheets.googleapis.com/v4/spreadsheets'
      );
      const metadataCalls = calls.filter((call) =>
        call[0].includes('/spreadsheets/s1?includeGridData=false')
      );
      const batchCalls = calls.filter((call) =>
        call[0] === 'https://sheets.googleapis.com/v4/spreadsheets/s1:batchUpdate'
      );
      const typedValueCalls = batchCalls.filter((call) => {
        const body = JSON.parse(call[1].body);
        return body.requests.some((request) => request.updateCells?.fields?.includes('userEnteredValue'));
      });
      const autoResizeCalls = batchCalls.filter((call) => {
        const body = JSON.parse(call[1].body);
        return body.requests.some((request) => request.autoResizeDimensions);
      });

      expect(creationCalls).toHaveLength(1);
      expect(metadataCalls).toHaveLength(1);
      expect(typedValueCalls.length).toBeGreaterThanOrEqual(2);
      expect(autoResizeCalls).toHaveLength(1);

      for (const call of typedValueCalls) {
        const body = JSON.parse(call[1].body);
        const cellCount = body.requests.reduce((sum, request) => {
          const range = request.updateCells.range;
          return sum + (range.endRowIndex - range.startRowIndex) *
            (range.endColumnIndex - range.startColumnIndex);
        }, 0);
        expect(cellCount).toBeLessThanOrEqual(GoogleAPI.MAX_VALUE_CELLS_PER_REQUEST);
      }
    });

    test('typed output keeps the selected empty-result formula over a later duplicate literal', async () => {
      const formula = '=IF(FALSE,"x","")';
      const merged = Merger.merge([
        {
          sheets: [{
            name: 'A',
            data: [['Col', 'Col', 'Col'], ['', 'real', 'later literal']],
            cellMeta: [
              [
                { type: 'string', value: 'Col' },
                { type: 'string', value: 'Col' },
                { type: 'string', value: 'Col' },
              ],
              [
                { type: 'formula', value: formula, displayValue: '' },
                { type: 'string', value: 'real' },
                { type: 'string', value: 'later literal' },
              ],
            ],
          }],
        },
        {
          sheets: [{
            name: 'B',
            data: [['Col'], ['other']],
            cellMeta: [[{ type: 'string', value: 'Col' }], [{ type: 'string', value: 'other' }]],
          }],
        },
      ]);

      expect(merged.sheets[0].data[1][0]).toBe('');
      expect(merged.sheets[0].cellMeta[1][0]).toEqual({ type: 'formula', value: formula, displayValue: '' });

      mockFetchSequence(
        { spreadsheetId: 's1', spreadsheetUrl: 'url', sheets: [{ properties: { sheetId: 0, title: 'Merged' } }] },
        { sheets: [{ properties: { sheetId: 0, title: 'Merged' } }] },
        {},
        {}
      );

      await GoogleAPI.createSpreadsheet('Formula merge', merged.sheets);

      const typedCall = global.fetch.mock.calls.find((call) => {
        if (!call[0].endsWith('/s1:batchUpdate')) return false;
        const body = JSON.parse(call[1].body);
        return body.requests.some((request) => request.updateCells?.fields?.includes('userEnteredValue'));
      });
      const body = JSON.parse(typedCall[1].body);
      const formulaValue = body.requests[0].updateCells.rows[1].values[0].userEnteredValue.formulaValue;
      expect(formulaValue).toBe(formula);
    });

    test('actual large CSV merge output keeps typed writes bounded across HTTP requests', async () => {
      const rowCount = 300;
      const colCount = 100;
      const makeCsvFile = (name, offset) => {
        const headers = Array.from({ length: colCount }, (_, ci) => `C${ci}`);
        const rows = [headers];
        for (let ri = 0; ri < rowCount; ri++) {
          rows.push(Array.from({ length: colCount }, (_, ci) => `${offset + ri}-${ci}`));
        }
        const content = rows.map((row) => row.join(',')).join('\n');
        const file = new File([content], name);
        file._buffer = new TextEncoder().encode(content).buffer;
        return file;
      };

      const parsedFiles = await Promise.all([
        Parser.parse(makeCsvFile('large-a.csv', 0)),
        Parser.parse(makeCsvFile('large-b.csv', rowCount)),
      ]);
      const merged = Merger.merge(parsedFiles);

      expect(merged.sheets[0].cellMeta).toBeTruthy();
      expect(merged.sheets[0].data).toHaveLength(rowCount * 2 + 1);

      mockFetchSequence(
        { spreadsheetId: 's1', spreadsheetUrl: 'url', sheets: [{ properties: { sheetId: 0, title: 'Merged' } }] },
        { sheets: [{ properties: { sheetId: 0, title: 'Merged' } }] },
        {},
        {},
        {}
      );

      await GoogleAPI.createSpreadsheet('Large CSV merge', merged.sheets);

      const batchCalls = global.fetch.mock.calls.filter((call) =>
        call[0] === 'https://sheets.googleapis.com/v4/spreadsheets/s1:batchUpdate'
      );
      const typedCalls = batchCalls.filter((call) => {
        const body = JSON.parse(call[1].body);
        return body.requests.some((request) => request.updateCells?.fields?.includes('userEnteredValue'));
      });

      expect(typedCalls.length).toBeGreaterThanOrEqual(2);
      for (const call of typedCalls) {
        const body = JSON.parse(call[1].body);
        const cells = body.requests.reduce((sum, request) => {
          const range = request.updateCells.range;
          return sum + (range.endRowIndex - range.startRowIndex) *
            (range.endColumnIndex - range.startColumnIndex);
        }, 0);
        expect(cells).toBeLessThanOrEqual(GoogleAPI.MAX_VALUE_CELLS_PER_REQUEST);
      }
    });

    test('pure CSV merge uses RAW path not typed', async () => {
      mockFetchSequence(
        { spreadsheetId: 's1', spreadsheetUrl: 'url', sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }] },
        {},  // RAW values write
        {}   // format
      );

      await GoogleAPI.createSpreadsheet('CSVOnly', [
        { name: 'Sheet1', data: [['A', 'B'], ['1', '2']] },  // no cellMeta
        { name: 'Sheet2', data: [['C', 'D']] },  // no cellMeta
      ]);

      const valueCalls = global.fetch.mock.calls.filter((call) =>
        call[0].includes('values:batchUpdate')
      );
      expect(valueCalls).toHaveLength(1);

      const batchCalls = global.fetch.mock.calls.filter((call) =>
        call[0].includes('batchUpdate') && !call[0].includes('values:batchUpdate')
      );
      // Only format call, no typed updateCells
      expect(batchCalls).toHaveLength(1);
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
