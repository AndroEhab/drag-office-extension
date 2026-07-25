const { loadModule } = require('./helpers');

const Parser = loadModule('../sidepanel/parser.js', 'Parser');
const Cleaner = loadModule('../sidepanel/cleaner.js', 'Cleaner');

/** Create a File with _content and _buffer attached for the MockFileReader */
function makeFile(name, textContent) {
  const file = new File([textContent], name);
  file._content = textContent;
  file._buffer = new TextEncoder().encode(textContent).buffer;
  return file;
}

/** Create an Excel-like File with _buffer attached */
function makeExcelFile(name) {
  const buffer = new ArrayBuffer(10);
  const file = new File([buffer], name);
  file._buffer = buffer;
  return file;
}

describe('Parser', () => {
  // ---- SUPPORTED_EXTENSIONS ----

  describe('SUPPORTED_EXTENSIONS', () => {
    test('contains csv, tsv, xlsx, xls', () => {
      expect(Parser.SUPPORTED_EXTENSIONS).toEqual(['csv', 'tsv', 'xlsx', 'xls']);
    });
  });

  // ---- isSupported ----

  describe('isSupported', () => {
    test.each([
      ['data.csv', true],
      ['data.tsv', true],
      ['data.xlsx', true],
      ['data.xls', true],
    ])('returns true for supported file %s', (name, expected) => {
      expect(Parser.isSupported(name)).toBe(expected);
    });

    test.each([
      ['data.txt', false],
      ['data.pdf', false],
      ['data.json', false],
      ['data.doc', false],
      ['data', false],
      ['', false],
    ])('returns false for unsupported file %s', (name, expected) => {
      expect(Parser.isSupported(name)).toBe(expected);
    });

    test('is case-insensitive', () => {
      expect(Parser.isSupported('FILE.CSV')).toBe(true);
      expect(Parser.isSupported('file.Xlsx')).toBe(true);
      expect(Parser.isSupported('file.TSV')).toBe(true);
    });
  });

  // ---- isExcelSupported ----

  describe('isExcelSupported', () => {
    test('returns false when XLSX is not defined', () => {
      delete global.XLSX;
      expect(Parser.isExcelSupported()).toBe(false);
    });

    test('returns true when XLSX is defined', () => {
      global.XLSX = {};
      expect(Parser.isExcelSupported()).toBe(true);
      delete global.XLSX;
    });
  });

  // ---- parse (CSV) ----

  describe('parse CSV', () => {
    test('parses simple CSV', async () => {
      const result = await Parser.parse(makeFile('test.csv', 'a,b,c\n1,2,3'));
      expect(result.sheets).toHaveLength(1);
      expect(result.sheets[0].name).toBe('test');
      expect(result.sheets[0].data).toEqual([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
      ]);
    });

    test('parses multi-row CSV', async () => {
      const result = await Parser.parse(makeFile('multi.csv', 'a,b\n1,2\n3,4\n5,6'));
      expect(result.sheets[0].data).toEqual([
        ['a', 'b'],
        ['1', '2'],
        ['3', '4'],
        ['5', '6'],
      ]);
    });

    test('handles quoted fields containing commas', async () => {
      const result = await Parser.parse(
        makeFile('quoted.csv', 'name,value\n"Smith, John",42')
      );
      expect(result.sheets[0].data).toEqual([
        ['name', 'value'],
        ['Smith, John', '42'],
      ]);
    });

    test('handles escaped quotes (double quotes)', async () => {
      const result = await Parser.parse(
        makeFile('esc.csv', 'say\n"He said ""hello"""')
      );
      expect(result.sheets[0].data[1]).toEqual(['He said "hello"']);
    });

    test('handles quoted fields with newlines inside', async () => {
      const result = await Parser.parse(
        makeFile('multiline.csv', 'col\n"line1\nline2"')
      );
      expect(result.sheets[0].data).toEqual([['col'], ['line1\nline2']]);
    });

    test('handles empty quoted fields', async () => {
      // Empty quoted fields before a non-empty row (trailing all-empty rows get trimmed)
      const result = await Parser.parse(makeFile('empty-quoted.csv', '"",""\ndata,data'));
      expect(result.sheets[0].data).toEqual([['', ''], ['data', 'data']]);
    });

    test('handles \\r\\n line endings', async () => {
      const result = await Parser.parse(makeFile('crlf.csv', 'a,b\r\nc,d'));
      expect(result.sheets[0].data).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });

    test('handles \\r line endings', async () => {
      const result = await Parser.parse(makeFile('cr.csv', 'a,b\rc,d'));
      expect(result.sheets[0].data).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });

    test('handles mixed line endings', async () => {
      const result = await Parser.parse(makeFile('mixed.csv', 'a\nb\r\nc\rd'));
      expect(result.sheets[0].data).toEqual([['a'], ['b'], ['c'], ['d']]);
    });

    test('strips trailing empty rows', async () => {
      const result = await Parser.parse(makeFile('trailing.csv', 'a,b\n1,2\n\n\n'));
      expect(result.sheets[0].data).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ]);
    });

    test('normalizes column count by padding shorter rows', async () => {
      const result = await Parser.parse(makeFile('uneven.csv', 'a,b,c\n1,2\n3'));
      expect(result.sheets[0].data).toEqual([
        ['a', 'b', 'c'],
        ['1', '2', ''],
        ['3', '', ''],
      ]);
    });

    test('handles empty fields', async () => {
      const result = await Parser.parse(makeFile('empty-fields.csv', 'a,,c\n,2,'));
      expect(result.sheets[0].data).toEqual([
        ['a', '', 'c'],
        ['', '2', ''],
      ]);
    });

    test('parses single cell', async () => {
      const result = await Parser.parse(makeFile('single.csv', 'hello'));
      expect(result.sheets[0].data).toEqual([['hello']]);
    });

    test('handles empty CSV', async () => {
      const result = await Parser.parse(makeFile('empty.csv', ''));
      expect(result.sheets[0].data).toEqual([]);
    });

    test('uses base name (without extension) as sheet name', async () => {
      const result = await Parser.parse(makeFile('my-data.csv', 'a'));
      expect(result.sheets[0].name).toBe('my-data');
    });

    test('handles multi-dot filenames', async () => {
      const result = await Parser.parse(makeFile('my.data.file.csv', 'a'));
      expect(result.sheets[0].name).toBe('my.data.file');
    });

    test('handles header-only CSV', async () => {
      const result = await Parser.parse(makeFile('headers-only.csv', 'name,age,city'));
      expect(result.sheets[0].data).toEqual([['name', 'age', 'city']]);
    });
  });

  // ---- parse (TSV) ----

  describe('parse TSV', () => {
    test('parses tab-separated values', async () => {
      const result = await Parser.parse(makeFile('data.tsv', 'a\tb\tc\n1\t2\t3'));
      expect(result.sheets[0].data).toEqual([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
      ]);
    });

    test('forces tab delimiter regardless of content', async () => {
      const result = await Parser.parse(makeFile('data.tsv', 'a,b,c\t1\n2,3,4\t5'));
      expect(result.sheets[0].data[0]).toEqual(['a,b,c', '1']);
    });
  });

  describe('preview CSV', () => {
    test('returns sampled rows for large csv previews', async () => {
      const rows = ['a,b'];
      for (let i = 0; i < 80; i++) rows.push(`${i},${i + 1}`);
      const content = rows.join('\n');
      const file = makeFile('large.csv', content);
      Object.defineProperty(file, 'size', { value: 1024 * 1024 });

      const result = await Parser.preview(file, { maxBytes: 64, sampleRows: 5 });

      expect(result.sheets[0].data).toEqual([
        ['a', 'b'],
        ['0', '1'],
        ['1', '2'],
        ['2', '3'],
        ['3', '4'],
      ]);
      expect(result.previewMeta.sampled).toBe(true);
      expect(result.previewMeta.rowCount).toBeNull();
      expect(result.previewMeta.dataRowCount).toBeNull();
      expect(result.previewMeta.colCount).toBe(2);
    });

    test('complete CSV preview returns exact row metrics', async () => {
      const content = 'Header\nA\nB\nC';
      const file = makeFile('small.csv', content);
      Object.defineProperty(file, 'size', { value: content.length });

      const result = await Parser.preview(file, { sampleRows: 51 });

      expect(result.previewMeta.rowCount).toBe(4);
      expect(result.previewMeta.dataRowCount).toBe(3);
      expect(result.previewMeta.colCount).toBe(1);
      expect(result.previewMeta.sampled).toBe(false);
    });

    test('truncated CSV preview returns null row metrics', async () => {
      const rows = ['header'];
      for (let i = 0; i < 100; i++) rows.push(`row${i}`);
      const content = rows.join('\n');
      const file = makeFile('big.csv', content);
      Object.defineProperty(file, 'size', { value: 1024 * 1024 });

      const result = await Parser.preview(file, { maxBytes: 64, sampleRows: 5 });

      expect(result.previewMeta.rowCount).toBeNull();
      expect(result.previewMeta.dataRowCount).toBeNull();
      expect(result.previewMeta.sampled).toBe(true);
    });


  });

  // ---- Delimiter auto-detection ----

  describe('delimiter auto-detection', () => {
    test('auto-detects semicolon delimiter in CSV', async () => {
      const result = await Parser.parse(makeFile('semi.csv', 'a;b;c\n1;2;3'));
      expect(result.sheets[0].data).toEqual([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
      ]);
    });

    test('auto-detects tab delimiter in CSV', async () => {
      const result = await Parser.parse(makeFile('tab.csv', 'a\tb\tc\n1\t2\t3'));
      expect(result.sheets[0].data).toEqual([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
      ]);
    });

    test('defaults to comma when counts are equal', async () => {
      const result = await Parser.parse(makeFile('default.csv', 'a,b\n1,2'));
      expect(result.sheets[0].data).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ]);
    });
  });

  // ---- parse (Excel) ----

  describe('parse Excel', () => {
    beforeEach(() => {
      global.XLSX = {
        read: jest.fn().mockReturnValue({
          SheetNames: ['Sheet1'],
          Themes: {
            themeElements: {
              clrScheme: [
                { rgb: 'FFFFFF' },
                { rgb: '000000' },
                { rgb: 'FFFFFF' },
                { rgb: '000000' },
                { rgb: '4285F4' },
              ],
            },
          },
          Sheets: {
            Sheet1: {
              'A1': { v: 'Name', s: null },
              'B1': { v: 'Age', s: null },
              'A2': { v: 'Alice', s: { font: { bold: true } } },
              'B2': { v: 30, s: null },
            },
          },
        }),
        utils: {
          sheet_to_json: jest.fn().mockReturnValue([
            ['Name', 'Age'],
            ['Alice', 30],
          ]),
          encode_cell: jest.fn(({ r, c }) => {
            const col = String.fromCharCode(65 + c);
            return `${col}${r + 1}`;
          }),
        },
      };
    });

    afterEach(() => {
      delete global.XLSX;
    });

    test('parses Excel file using SheetJS', async () => {
      const result = await Parser.parse(makeExcelFile('test.xlsx'));

      expect(global.XLSX.read).toHaveBeenCalledWith(
        expect.any(ArrayBuffer),
        expect.objectContaining({ type: 'array', cellStyles: true, bookFiles: true })
      );
      expect(result.sheets).toHaveLength(1);
      expect(result.sheets[0].name).toBe('Sheet1');
      expect(result.sheets[0].data).toEqual([
        ['Name', 'Age'],
        ['Alice', 30],
      ]);
    });

    test('builds sampled Excel previews with full sheet bounds', async () => {
      global.XLSX.read.mockReturnValue({
        SheetNames: ['Sheet1'],
        Sheets: {
          Sheet1: {
            '!ref': 'A1:B5',
            '!fullref': 'A1:B500',
          },
        },
      });
      global.XLSX.utils.sheet_to_json.mockReturnValue([
        ['Name', 'Age'],
        ['Alice', 30],
        ['Bob', 31],
      ]);
      global.XLSX.utils.decode_range = jest.fn(() => ({ s: { r: 0, c: 0 }, e: { r: 499, c: 1 } }));

      const result = await Parser.preview(makeExcelFile('preview.xlsx'), { sampleRows: 3 });

      expect(global.XLSX.read).toHaveBeenCalledWith(
        expect.any(ArrayBuffer),
        expect.objectContaining({ type: 'array', sheetRows: 3 })
      );
      expect(result.previewMeta.rowCount).toBe(500);
      expect(result.previewMeta.colCount).toBe(2);
      expect(result.previewMeta.sampled).toBe(true);
      expect(result.sheets[0].data[1]).toEqual(['Alice', 30]);
    });

    test('previews a requested worksheet while preserving the default first-sheet behavior', async () => {
      global.XLSX.read.mockReturnValue({
        SheetNames: ['First', 'Second'],
        Sheets: {
          First: { '!ref': 'A1:C4' },
          Second: { '!ref': 'A1:B3' },
        },
      });
      global.XLSX.utils.sheet_to_json.mockReturnValue([
        ['Second-selected'],
        ['x'],
        ['y'],
      ]);
      global.XLSX.utils.decode_range = jest.fn((ref) => {
        if (ref === 'A1:C4') return { s: { r: 0, c: 0 }, e: { r: 3, c: 2 } };
        return { s: { r: 0, c: 0 }, e: { r: 2, c: 1 } };
      });

      const result = await Parser.preview(makeExcelFile('selected.xlsx'), {
        sampleRows: 3,
        sheetIndex: 1,
      });

      expect(result.sheets[0].name).toBe('Second');
      expect(result.sheets[0].data[0]).toEqual(['Second-selected', '']);
      expect(result.previewMeta.rowCount).toBe(3);
      expect(result.previewMeta.dataRowCount).toBe(2);
      expect(result.previewMeta.colCount).toBe(2);
      expect(result.previewMeta.sheetCount).toBe(2);
    });

    test('uses the selected worksheet full range for sampled preview dimensions', async () => {
      global.XLSX.read.mockReturnValue({
        SheetNames: ['First', 'Second'],
        Sheets: {
          First: { '!ref': 'A1:C4', '!fullref': 'A1:C4' },
          Second: { '!ref': 'A1:B3', '!fullref': 'A1:B500' },
        },
      });
      global.XLSX.utils.sheet_to_json.mockReturnValue([
        ['Second-selected'],
        ['x'],
        ['y'],
      ]);
      global.XLSX.utils.decode_range = jest.fn((ref) => {
        const ranges = {
          'A1:C4': { s: { r: 0, c: 0 }, e: { r: 3, c: 2 } },
          'A1:B3': { s: { r: 0, c: 0 }, e: { r: 2, c: 1 } },
          'A1:B500': { s: { r: 0, c: 0 }, e: { r: 499, c: 1 } },
        };
        return ranges[ref];
      });

      const result = await Parser.preview(makeExcelFile('sampled-selected.xlsx'), {
        sampleRows: 3,
        sheetIndex: 1,
      });

      expect(result.previewMeta.rowCount).toBe(500);
      expect(result.previewMeta.dataRowCount).toBe(499);
      expect(result.previewMeta.colCount).toBe(2);
      expect(result.previewMeta.sampled).toBe(true);
      expect(result.previewMeta.sampleRows).toBe(3);
    });

    test('preserves sampled Excel metadata and cleaning semantics for typed cells', async () => {
      const formula = '=TEXT(1234,"0")';
      global.XLSX.read.mockReturnValue({
        SheetNames: ['Sheet1'],
        Sheets: {
          Sheet1: {
            '!ref': 'A1:G2',
            '!fullref': 'A1:G3',
            A1: { v: 'Text', t: 's' },
            B1: { v: 'Number', t: 's' },
            C1: { v: 'Formula', t: 's' },
            D1: { v: 'Date', t: 's' },
            E1: { v: 'Time', t: 's' },
            F1: { v: 'Boolean', t: 's' },
            G1: { v: 'Ordinary String', t: 's' },
            A2: { v: '1,234', t: 's', z: '@' },
            B2: { v: 1234, t: 'n', z: '#,##0' },
            C2: { v: ' 1234 ', t: 'str', f: formula },
            D2: { v: 45292, t: 'n', z: 'm/d/yy' },
            E2: { v: 0.5, t: 'n', z: 'h:mm' },
            F2: { v: true, t: 'b' },
            G2: { v: ' 1,234 ', t: 's' },
          },
        },
      });
      global.XLSX.utils.sheet_to_json.mockReturnValue([
        ['Text', 'Number', 'Formula', 'Date', 'Time', 'Boolean', 'Ordinary String'],
        ['1,234', 1234, ' 1234 ', 45292, 0.5, true, ' 1,234 '],
      ]);
      global.XLSX.utils.decode_range = jest.fn((ref) =>
        ref === 'A1:G3'
          ? { s: { r: 0, c: 0 }, e: { r: 2, c: 6 } }
          : { s: { r: 0, c: 0 }, e: { r: 1, c: 6 } }
      );

      const result = await Parser.preview(makeExcelFile('typed-preview.xlsx'), { sampleRows: 2 });
      const sheet = result.sheets[0];

      expect(sheet.data).toEqual([
        ['Text', 'Number', 'Formula', 'Date', 'Time', 'Boolean', 'Ordinary String'],
        ['1,234', 1234, ' 1234 ', 45292, 0.5, true, ' 1,234 '],
      ]);
      expect(sheet.cellMeta[1]).toEqual([
        { type: 'string', value: '1,234', formatType: 'TEXT' },
        { type: 'number', value: 1234 },
        { type: 'formula', value: formula, displayValue: ' 1234 ' },
        { type: 'date', value: 45292, formatType: 'DATE' },
        { type: 'date', value: 0.5, formatType: 'TIME' },
        { type: 'boolean', value: true },
        { type: 'string', value: ' 1,234 ' },
      ]);
      expect(result.previewMeta.metadataTrusted).toBe(true);

      const cleaned = Cleaner.apply(
        sheet.data,
        {
          trim: true,
          removeEmptyRows: false,
          removeEmptyColumns: false,
          removeDuplicates: false,
          fixNumbers: true,
          normalizeHeaders: false,
        },
        sheet.cellMeta
      );

      expect(cleaned.data[1]).toEqual(['1,234', 1234, ' 1234 ', 45292, 0.5, true, 1234]);
      expect(cleaned.cellMeta[1].slice(0, 6)).toEqual(sheet.cellMeta[1].slice(0, 6));
      expect(cleaned.cellMeta[1][6]).toEqual({ type: 'number', value: 1234 });
    });

    test('always extracts cell styles for excel files', async () => {
      const result = await Parser.parse(makeExcelFile('styled.xlsx'));

      expect(global.XLSX.read).toHaveBeenCalledWith(
        expect.any(ArrayBuffer),
        expect.objectContaining({ type: 'array', cellStyles: true, bookFiles: true })
      );
      expect(result.sheets[0].styles).toBeDefined();
      // Without workbook.files, falls back to cell.s
      expect(result.sheets[0].styles[1][0]).toEqual({ font: { bold: true } });
      expect(result.themeColors).toEqual(['FFFFFF', '000000', 'FFFFFF', '000000', '4285F4']);
    });

    test('extracts complete styles (fill + font) from workbook Styles via bookFiles', async () => {
      const sheetXml = '<worksheet><sheetData>' +
        '<row r="1"><c r="A1" s="0"><v>Name</v></c><c r="B1" s="1"><v>Value</v></c></row>' +
        '<row r="2"><c r="A2" s="2"><v>Alice</v></c><c r="B2" s="0"><v>30</v></c></row>' +
        '</sheetData></worksheet>';
      const xmlContent = sheetXml;

      global.XLSX.read.mockReturnValue({
        SheetNames: ['Sheet1'],
        Themes: { themeElements: { clrScheme: [] } },
        Styles: {
          CellXf: [
            { fontId: 0, fillId: 0 },  // s=0: default
            { fontId: 1, fillId: 2 },  // s=1: bold + yellow bg
            { fontId: 2, fillId: 0 },  // s=2: blue text, no bg
          ],
          Fonts: [
            { name: 'Calibri', sz: 11 },
            { name: 'Calibri', sz: 11, bold: true },
            { name: 'Calibri', sz: 11, color: { rgb: '0000FF' } },
          ],
          Fills: [
            {},
            { patternType: 'gray125' },
            { fgColor: { rgb: 'FFFF00' }, patternType: 'solid' },
          ],
        },
        keys: ['xl/worksheets/sheet1.xml'],
        files: {
          'xl/worksheets/sheet1.xml': { content: xmlContent },
        },
        Sheets: {
          Sheet1: {
            'A1': { v: 'Name', s: null },
            'B1': { v: 'Value', s: null },
            'A2': { v: 'Alice', s: null },
            'B2': { v: 30, s: null },
          },
        },
      });

      const result = await Parser.parse(makeExcelFile('styled.xlsx'));

      // B1 (s=1): bold font + yellow background
      const b1Style = result.sheets[0].styles[0][1];
      expect(b1Style.fgColor).toEqual({ rgb: 'FFFF00' });
      expect(b1Style.font.bold).toBe(true);

      // A2 (s=2): blue font color, no background
      const a2Style = result.sheets[0].styles[1][0];
      expect(a2Style.font.color).toEqual({ rgb: '0000FF' });
      expect(a2Style.fgColor).toBeUndefined();

      // A1 (s=0): default style — has default font but no fill
      const a1Style = result.sheets[0].styles[0][0];
      expect(a1Style.font).toEqual({ name: 'Calibri', sz: 11 });
    });

    test('handles multi-sheet workbooks', async () => {
      global.XLSX.read.mockReturnValue({
        SheetNames: ['Sales', 'Costs'],
        Sheets: {
          Sales: { 'A1': { v: 'Revenue', s: null } },
          Costs: { 'A1': { v: 'Expense', s: null } },
        },
      });
      global.XLSX.utils.sheet_to_json
        .mockReturnValueOnce([['Revenue']])
        .mockReturnValueOnce([['Expense']]);

      const result = await Parser.parse(makeExcelFile('multi.xlsx'));

      expect(result.sheets).toHaveLength(2);
      expect(result.sheets[0].name).toBe('Sales');
      expect(result.sheets[1].name).toBe('Costs');
    });

    test('preserves native cell types where available', async () => {
      global.XLSX.read.mockReturnValue({
        SheetNames: ['Sheet1'],
        Themes: { themeElements: { clrScheme: [] } },
        Sheets: {
          Sheet1: {
            '!ref': 'A1:A4',
            'A1': { v: 'Col', t: 's' },
            'A2': { v: 123, t: 'n' },
            'A3': { v: null },
            'A4': { v: true, t: 'b' },
          },
        },
      });
      global.XLSX.utils.decode_range = jest.fn(() => ({ s: { r: 0, c: 0 }, e: { r: 3, c: 0 } }));
      global.XLSX.utils.sheet_to_json.mockReturnValue([
        ['Col'],
        [123],
        [null],
        [true],
      ]);

      const result = await Parser.parse(makeExcelFile('types.xlsx'));

      // Native types preserved (not stringified)
      expect(result.sheets[0].data[1][0]).toBe(123);
      expect(result.sheets[0].data[2][0]).toBe('');
      expect(result.sheets[0].data[3][0]).toBe(true);
      // cellMeta contains type information
      expect(result.sheets[0].cellMeta).toBeTruthy();
    });

    test('pads rows to consistent column count', async () => {
      global.XLSX.utils.sheet_to_json.mockReturnValue([
        ['A', 'B', 'C'],
        ['1'],
      ]);

      const result = await Parser.parse(makeExcelFile('uneven.xlsx'));

      expect(result.sheets[0].data[1]).toEqual(['1', '', '']);
    });

    test('trims trailing empty rows', async () => {
      global.XLSX.utils.sheet_to_json.mockReturnValue([
        ['A'],
        ['1'],
        [''],
        [''],
      ]);

      const result = await Parser.parse(makeExcelFile('trailing.xlsx'));

      expect(result.sheets[0].data).toEqual([['A'], ['1']]);
    });

    test('multi-sheet Excel preview reports workbook-wide metrics from ranges', async () => {
      global.XLSX.read.mockReturnValueOnce({
        SheetNames: ['Sheet1', 'Sheet2'],
        Sheets: {
          Sheet1: {
            '!ref': 'A1:C3',
            'A1': { v: 'H1', t: 's' },
            'B1': { v: 'H2', t: 's' },
            'C1': { v: 'H3', t: 's' },
            'A2': { v: 'v1', t: 's' },
            'B2': { v: 'v2', t: 's' },
            'A3': { v: 'v3', t: 's' },
          },
          Sheet2: {
            '!ref': 'A1:B5',
            'A1': { v: 'H', t: 's' },
            'A2': { v: 'x', t: 's' },
            'A3': { v: 'y', t: 's' },
            'A4': { v: 'z', t: 's' },
            'A5': { v: 'w', t: 's' },
          },
        },
      });
      global.XLSX.utils.sheet_to_json
        .mockReturnValueOnce([
          ['H1', 'H2', 'H3'],
          ['v1', 'v2', ''],
          ['v3', '', ''],
        ])
        .mockReturnValueOnce([
          ['H'],
          ['x'],
          ['y'],
          ['z'],
          ['w'],
        ]);
      global.XLSX.utils.decode_range = jest.fn((ref) => {
        if (ref === 'A1:C3') return { s: { r: 0, c: 0 }, e: { r: 2, c: 2 } };
        if (ref === 'A1:B5') return { s: { r: 0, c: 0 }, e: { r: 4, c: 1 } };
        return { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
      });

      const result = await Parser.preview(makeExcelFile('multi.xlsx'), { sampleRows: 51 });

      expect(result.previewMeta.sheetCount).toBe(2);
      expect(result.previewMeta.rowCount).toBe(8);  // 3 + 5
      expect(result.previewMeta.dataRowCount).toBe(6);  // (3-1)+(5-1)
      expect(result.previewMeta.colCount).toBe(3);  // max(3, 2)
      expect(result.previewMeta.sampled).toBe(true);  // sampled because totalRows (8) > sample data rows (3)
    });

    test('missing worksheet ranges produce unknown summary metrics', async () => {
      global.XLSX.read.mockReturnValueOnce({
        SheetNames: ['NoRef'],
        Sheets: {
          NoRef: {
            'A1': { v: 'Alone', t: 's' },
          },
        },
      });
      global.XLSX.utils.sheet_to_json.mockReturnValueOnce([['Alone']]);
      global.XLSX.utils.decode_range = jest.fn(() => ({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }));

      const result = await Parser.preview(makeExcelFile('noref.xlsx'), { sampleRows: 51 });

      expect(result.previewMeta.rowCount).toBeNull();
      expect(result.previewMeta.dataRowCount).toBeNull();
      expect(result.previewMeta.colCount).toBeNull();
      expect(result.previewMeta.sheetCount).toBe(1);
    });

    test('throws when SheetJS is not loaded', async () => {
      delete global.XLSX;
      await expect(Parser.parse(makeExcelFile('test.xlsx'))).rejects.toThrow(
        'Excel support requires the SheetJS library'
      );
    });

    test('parses .xls files the same as .xlsx', async () => {
      const result = await Parser.parse(makeExcelFile('legacy.xls'));

      expect(global.XLSX.read).toHaveBeenCalled();
      expect(result.sheets[0].data).toEqual([
        ['Name', 'Age'],
        ['Alice', 30],
      ]);
    });
  });

  // ---- Error handling ----

  describe('error handling', () => {
    test('throws for unsupported file type', async () => {
      const file = new File(['data'], 'test.txt');
      await expect(Parser.parse(file)).rejects.toThrow('Unsupported file type: .txt');
    });

    test('throws for file with no extension', async () => {
      const file = new File(['data'], 'noext');
      await expect(Parser.parse(file)).rejects.toThrow('Unsupported file type: .');
    });
  });

  // ---- hasTypedCellMetadata ----

  describe('hasTypedCellMetadata', () => {
    test('returns false for null input', () => {
      expect(Parser.hasTypedCellMetadata(null)).toBe(false);
    });

    test('returns false for undefined input', () => {
      expect(Parser.hasTypedCellMetadata(undefined)).toBe(false);
    });

    test('returns false for object without sheets', () => {
      expect(Parser.hasTypedCellMetadata({})).toBe(false);
    });

    test('returns false for empty sheets array', () => {
      expect(Parser.hasTypedCellMetadata({ sheets: [] })).toBe(false);
    });

    test('missing metadata row fails hasTypedCellMetadata', () => {
      const parsed = {
        sheets: [{
          name: 'S1',
          data: [['A'], ['1']],
          cellMeta: [[{ type: 'string', value: 'A' }]],
        }],
      };
      expect(Parser.hasTypedCellMetadata(parsed)).toBe(false);
    });

    test('missing metadata column fails hasTypedCellMetadata', () => {
      const parsed = {
        sheets: [{
          name: 'S1',
          data: [['A', 'B']],
          cellMeta: [[{ type: 'string', value: 'A' }]],
        }],
      };
      expect(Parser.hasTypedCellMetadata(parsed)).toBe(false);
    });

    test('null metadata row fails hasTypedCellMetadata', () => {
      const parsed = {
        sheets: [{
          name: 'S1',
          data: [['A']],
          cellMeta: [null],
        }],
      };
      expect(Parser.hasTypedCellMetadata(parsed)).toBe(false);
    });

    test('invalid token type fails hasTypedCellMetadata', () => {
      const parsed = {
        sheets: [{
          name: 'S1',
          data: [['A']],
          cellMeta: [[{ type: 'invalid_type', value: 'A' }]],
        }],
      };
      expect(Parser.hasTypedCellMetadata(parsed)).toBe(false);
    });

    test('formula token without formula text fails hasTypedCellMetadata', () => {
      const parsed = {
        sheets: [{
          name: 'S1',
          data: [['Result']],
          cellMeta: [[{ type: 'formula', value: '' }]],
        }],
      };
      expect(Parser.hasTypedCellMetadata(parsed)).toBe(false);
    });

    test('valid complete WASM metadata passes', () => {
      const parsed = {
        sheets: [{
          name: 'S1',
          data: [['Name', 'Age', 'Active', 'Joined']],
          cellMeta: [[
            { type: 'string', value: 'Name' },
            { type: 'number', value: 0 },
            { type: 'boolean', value: false },
            { type: 'date', value: 45306, formatType: 'DATE' },
          ]],
        }],
      };
      expect(Parser.hasTypedCellMetadata(parsed)).toBe(true);
    });

    test('formula token with text passes', () => {
      const parsed = {
        sheets: [{
          name: 'S1',
          data: [['Result']],
          cellMeta: [[{ type: 'formula', value: '=SUM(A1:A3)' }]],
        }],
      };
      expect(Parser.hasTypedCellMetadata(parsed)).toBe(true);
    });

    test('empty token with non-empty header data fails', () => {
      const parsed = {
        sheets: [{
          name: 'S1',
          data: [['Value']],
          cellMeta: [[{ type: 'empty' }]],
        }],
      };
      expect(Parser.hasTypedCellMetadata(parsed)).toBe(false);
    });

    test('date token with valid formatType passes', () => {
      for (const fmt of ['DATE', 'TIME', 'DATE_TIME']) {
        const parsed = {
          sheets: [{
            name: 'S1',
            data: [['Field']],
            cellMeta: [[{ type: 'date', value: 1, formatType: fmt }]],
          }],
        };
        expect(Parser.hasTypedCellMetadata(parsed)).toBe(true);
      }
    });

    test('metadata row too wide fails', () => {
      const parsed = {
        sheets: [{
          name: 'S1',
          data: [['A']],
          cellMeta: [[{ type: 'string', value: 'A' }, { type: 'empty' }]],
        }],
      };
      expect(Parser.hasTypedCellMetadata(parsed)).toBe(false);
    });

    test('empty token with non-empty data fails', () => {
      const parsed = {
        sheets: [{
          name: 'S1',
          data: [['A'], ['value']],
          cellMeta: [[{ type: 'string', value: 'A' }], [{ type: 'empty' }]],
        }],
      };
      expect(Parser.hasTypedCellMetadata(parsed)).toBe(false);
    });

    test('formula token with empty display value is valid', () => {
      const parsed = {
        sheets: [{
          name: 'S1',
          data: [['Result'], ['']],
          cellMeta: [[{ type: 'string', value: 'Result' }], [{ type: 'formula', value: '=IF(FALSE,"x","")', displayValue: '' }]],
        }],
      };
      expect(Parser.hasTypedCellMetadata(parsed)).toBe(true);
    });

    test('metadata row exact width matching passes', () => {
      const parsed = {
        sheets: [{
          name: 'S1',
          data: [['A', 'B'], ['1', '2']],
          cellMeta: [
            [{ type: 'string', value: 'A' }, { type: 'string', value: 'B' }],
            [{ type: 'string', value: '1' }, { type: 'string', value: '2' }],
          ],
        }],
      };
      expect(Parser.hasTypedCellMetadata(parsed)).toBe(true);
    });

    test('date token without formatType fails', () => {
      const parsed = {
        sheets: [{
          name: 'S1',
          data: [['Field']],
          cellMeta: [[{ type: 'date', value: 45306 }]],
        }],
      };
      expect(Parser.hasTypedCellMetadata(parsed)).toBe(false);
    });

    test('date token with non-finite value fails', () => {
      const parsed = {
        sheets: [{
          name: 'S1',
          data: [['Field']],
          cellMeta: [[{ type: 'date', value: Infinity, formatType: 'DATE' }]],
        }],
      };
      expect(Parser.hasTypedCellMetadata(parsed)).toBe(false);
    });

    test('number token with non-number value fails', () => {
      const parsed = {
        sheets: [{
          name: 'S1',
          data: [['Field']],
          cellMeta: [[{ type: 'number', value: '42' }]],
        }],
      };
      expect(Parser.hasTypedCellMetadata(parsed)).toBe(false);
    });

    test('boolean token with non-boolean value fails', () => {
      const parsed = {
        sheets: [{
          name: 'S1',
          data: [['Field']],
          cellMeta: [[{ type: 'boolean', value: 'true' }]],
        }],
      };
      expect(Parser.hasTypedCellMetadata(parsed)).toBe(false);
    });

    test('string token with non-string value fails', () => {
      const parsed = {
        sheets: [{
          name: 'S1',
          data: [['Field']],
          cellMeta: [[{ type: 'string', value: 42 }]],
        }],
      };
      expect(Parser.hasTypedCellMetadata(parsed)).toBe(false);
    });

    test('data row that is not an array fails', () => {
      const parsed = {
        sheets: [{
          name: 'S1',
          data: ['not-an-array'],
          cellMeta: [[{ type: 'string', value: 'x' }]],
        }],
      };
      expect(Parser.hasTypedCellMetadata(parsed)).toBe(false);
    });

    test('empty token with empty data value passes', () => {
      for (const emptyVal of [null, undefined, '']) {
        const parsed = {
          sheets: [{
            name: 'S1',
            data: [[emptyVal]],
            cellMeta: [[{ type: 'empty' }]],
          }],
        };
        expect(Parser.hasTypedCellMetadata(parsed)).toBe(true);
      }
    });
  });
});
