const { loadModule } = require('./helpers');

const Cleaner = loadModule('../sidepanel/cleaner.js', 'Cleaner');

describe('Cleaner', () => {
  // ---- trimWhitespace ----

  describe('trimWhitespace', () => {
    test('trims leading and trailing spaces', () => {
      const data = [
        ['  Name  ', ' Age'],
        [' Alice ', '  30  '],
      ];
      expect(Cleaner.trimWhitespace(data).data).toEqual([
        ['Name', 'Age'],
        ['Alice', '30'],
      ]);
    });

    test('trims tabs and mixed whitespace', () => {
      const data = [['\t hello \n']];
      expect(Cleaner.trimWhitespace(data).data).toEqual([['hello']]);
    });

    test('handles non-string cells', () => {
      const data = [[123, null, undefined, true]];
      const result = Cleaner.trimWhitespace(data);
      // Non-string values pass through unchanged
      expect(result.data).toEqual([[123, null, undefined, true]]);
    });

    test('handles empty data', () => {
      expect(Cleaner.trimWhitespace([]).data).toEqual([]);
    });

    test('does not mutate original data', () => {
      const data = [['  hi  ']];
      const original = JSON.parse(JSON.stringify(data));
      Cleaner.trimWhitespace(data);
      expect(data).toEqual(original);
    });

    test('with metadata, trims only string tokens', () => {
      const data = [['  header  ', '  cached formula  ', '  number display  ', '  text  ']];
      const cellMeta = [[
        { type: 'string', value: '  header  ' },
        { type: 'formula', value: '=A1', displayValue: '  cached formula  ' },
        { type: 'number', value: 42 },
        { type: 'string', value: '  text  ' },
      ]];

      const result = Cleaner.trimWhitespace(data, cellMeta);

      expect(result.data[0]).toEqual(['header', '  cached formula  ', '  number display  ', 'text']);
      expect(result.cellMeta[0]).toEqual([
        { type: 'string', value: 'header' },
        { type: 'formula', value: '=A1', displayValue: '  cached formula  ' },
        { type: 'number', value: 42 },
        { type: 'string', value: 'text' },
      ]);
    });
  });

  // ---- removeEmptyRows ----

  describe('removeEmptyRows', () => {
    test('removes rows where all cells are empty', () => {
      const data = [
        ['Name', 'Age'],
        ['Alice', '30'],
        ['', ''],
        ['Bob', '25'],
      ];
      expect(Cleaner.removeEmptyRows(data).data).toEqual([
        ['Name', 'Age'],
        ['Alice', '30'],
        ['Bob', '25'],
      ]);
    });

    test('always preserves header row even if empty', () => {
      const data = [
        ['', ''],
        ['Alice', '30'],
      ];
      const result = Cleaner.removeEmptyRows(data).data;
      expect(result[0]).toEqual(['', '']);
      expect(result).toHaveLength(2);
    });

    test('removes whitespace-only rows', () => {
      const data = [
        ['Name'],
        ['  ', '\t'],
        ['Alice'],
      ];
      expect(Cleaner.removeEmptyRows(data).data).toEqual([
        ['Name'],
        ['Alice'],
      ]);
    });

    test('handles all data rows being empty', () => {
      const data = [
        ['Header'],
        [''],
        [''],
      ];
      expect(Cleaner.removeEmptyRows(data).data).toEqual([['Header']]);
    });

    test('handles empty data', () => {
      expect(Cleaner.removeEmptyRows([]).data).toEqual([]);
    });

    test('handles single header row', () => {
      const data = [['Name', 'Age']];
      expect(Cleaner.removeEmptyRows(data).data).toEqual([['Name', 'Age']]);
    });
  });

  // ---- removeEmptyColumns ----

  describe('removeEmptyColumns', () => {
    test('removes columns where all cells are empty', () => {
      const data = [
        ['Name', '', 'Age'],
        ['Alice', '', '30'],
        ['Bob', '', '25'],
      ];
      expect(Cleaner.removeEmptyColumns(data).data).toEqual([
        ['Name', 'Age'],
        ['Alice', '30'],
        ['Bob', '25'],
      ]);
    });

    test('removes whitespace-only columns', () => {
      const data = [
        ['Name', '  ', 'Age'],
        ['Alice', ' ', '30'],
      ];
      expect(Cleaner.removeEmptyColumns(data).data).toEqual([
        ['Name', 'Age'],
        ['Alice', '30'],
      ]);
    });

    test('keeps column if any cell has a value', () => {
      const data = [
        ['Name', '', 'Age'],
        ['Alice', 'x', '30'],
      ];
      expect(Cleaner.removeEmptyColumns(data).data).toEqual([
        ['Name', '', 'Age'],
        ['Alice', 'x', '30'],
      ]);
    });

    test('handles rows with missing cells', () => {
      const data = [
        ['A', 'B', 'C'],
        ['1'],
      ];
      const result = Cleaner.removeEmptyColumns(data).data;
      expect(result[0]).toEqual(['A', 'B', 'C']);
    });

    test('handles empty data', () => {
      expect(Cleaner.removeEmptyColumns([]).data).toEqual([]);
    });

    test('removes all columns if all are empty', () => {
      const data = [
        ['', ''],
        ['', ''],
      ];
      expect(Cleaner.removeEmptyColumns(data).data).toEqual([[], []]);
    });
  });

  // ---- removeDuplicateRows ----

  describe('removeDuplicateRows', () => {
    test('removes duplicate rows keeping first occurrence', () => {
      const data = [
        ['Name', 'Age'],
        ['Alice', '30'],
        ['Bob', '25'],
        ['Alice', '30'],
      ];
      expect(Cleaner.removeDuplicateRows(data).data).toEqual([
        ['Name', 'Age'],
        ['Alice', '30'],
        ['Bob', '25'],
      ]);
    });

    test('preserves header row', () => {
      const data = [
        ['Name'],
        ['Name'],
      ];
      const result = Cleaner.removeDuplicateRows(data).data;
      expect(result).toEqual([['Name'], ['Name']]);
    });

    test('handles no duplicates', () => {
      const data = [
        ['Name'],
        ['Alice'],
        ['Bob'],
      ];
      expect(Cleaner.removeDuplicateRows(data).data).toEqual(data);
    });

    test('handles multiple duplicates of the same row', () => {
      const data = [
        ['H'],
        ['A'],
        ['A'],
        ['A'],
        ['B'],
      ];
      expect(Cleaner.removeDuplicateRows(data).data).toEqual([
        ['H'],
        ['A'],
        ['B'],
      ]);
    });

    test('handles single row (header only)', () => {
      const data = [['Name']];
      expect(Cleaner.removeDuplicateRows(data).data).toEqual([['Name']]);
    });

    test('handles empty data', () => {
      expect(Cleaner.removeDuplicateRows([]).data).toEqual([]);
    });
  });

  // ---- removeAbsoluteDuplicates (tested via apply) ----

  describe('removeAbsoluteDuplicates (via apply)', () => {
    const opts = {
      trim: false,
      removeEmptyRows: false,
      removeEmptyColumns: false,
      removeDuplicates: true,
      duplicateMode: 'absolute',
      fixNumbers: false,
      normalizeHeaders: false,
    };

    test('removes ALL occurrences of duplicated rows', () => {
      const data = [
        ['Name', 'Age'],
        ['Alice', '30'],
        ['Bob', '25'],
        ['Alice', '30'],
        ['Charlie', '35'],
      ];
      const result = Cleaner.apply(data, opts);
      expect(result).toEqual([
        ['Name', 'Age'],
        ['Bob', '25'],
        ['Charlie', '35'],
      ]);
    });

    test('keeps rows that appear exactly once', () => {
      const data = [
        ['H'],
        ['A'],
        ['B'],
        ['C'],
      ];
      const result = Cleaner.apply(data, opts);
      expect(result).toEqual(data);
    });

    test('removes all rows if all are duplicates', () => {
      const data = [
        ['H'],
        ['A'],
        ['A'],
      ];
      const result = Cleaner.apply(data, opts);
      expect(result).toEqual([['H']]);
    });

    test('preserves header even if it matches a data row', () => {
      const data = [
        ['Name'],
        ['Name'],
        ['Name'],
      ];
      const result = Cleaner.apply(data, opts);
      // Header is always kept; data rows 'Name' appear twice → removed
      expect(result).toEqual([['Name']]);
    });
  });

  // ---- fixNumberFormatting ----

  describe('fixNumberFormatting', () => {
    test('converts text integers to numbers', () => {
      const data = [
        ['Value'],
        ['42'],
        ['0'],
        ['-7'],
      ];
      const result = Cleaner.fixNumberFormatting(data).data;
      // All numeric-looking strings become numbers (restored behavior)
      expect(result[1][0]).toBe(42);
      expect(result[2][0]).toBe(0);
      expect(result[3][0]).toBe(-7);
    });

    test('converts text decimals to numbers', () => {
      const data = [
        ['Value'],
        ['3.14'],
        ['-0.5'],
      ];
      const result = Cleaner.fixNumberFormatting(data).data;
      expect(result[1][0]).toBe(3.14);
      expect(result[2][0]).toBe(-0.5);
    });

    test('converts comma-separated numbers', () => {
      const data = [
        ['Value'],
        ['1,000'],
        ['1,234,567'],
      ];
      const result = Cleaner.fixNumberFormatting(data).data;
      expect(result[1][0]).toBe(1000);
      expect(result[2][0]).toBe(1234567);
    });

    test('skips header row', () => {
      const data = [
        ['123', '456'],
        ['7', '8'],
      ];
      const result = Cleaner.fixNumberFormatting(data).data;
      expect(result[0]).toEqual(['123', '456']);
      expect(result[1]).toEqual([7, 8]);
    });

    test('leaves non-numeric strings unchanged', () => {
      const data = [
        ['Col'],
        ['hello'],
        ['12abc'],
        ['$100'],
        ['1.2.3'],
      ];
      const result = Cleaner.fixNumberFormatting(data).data;
      expect(result[1][0]).toBe('hello');
      expect(result[2][0]).toBe('12abc');
      expect(result[3][0]).toBe('$100');
      expect(result[4][0]).toBe('1.2.3');
    });

    test('leaves empty strings unchanged', () => {
      const data = [['Col'], ['']];
      const result = Cleaner.fixNumberFormatting(data).data;
      expect(result[1][0]).toBe('');
    });

    test('handles non-string cells', () => {
      const data = [['Col'], [42]];
      const result = Cleaner.fixNumberFormatting(data).data;
      expect(result[1][0]).toBe(42);
    });

    test('handles whitespace around numbers', () => {
      const data = [['Col'], [' 42 ']];
      const result = Cleaner.fixNumberFormatting(data).data;
      // fixNumbers internally trims before checking → converts to number
      expect(result[1][0]).toBe(42);
    });

    test('handles single row (header only)', () => {
      const data = [['Value']];
      expect(Cleaner.fixNumberFormatting(data).data).toEqual([['Value']]);
    });
  });

  // ---- normalizeHeaders ----

  describe('normalizeHeaders', () => {
    test('converts headers to title case', () => {
      const data = [
        ['first name', 'last name'],
        ['Alice', 'Smith'],
      ];
      const result = Cleaner.normalizeHeaders(data);
      expect(result[0]).toEqual(['First Name', 'Last Name']);
      expect(result[1]).toEqual(['Alice', 'Smith']);
    });

    test('normalizes uppercase and mixed-case headers to title case', () => {
      const data = [
        ['FIRST NAME', 'eMAIL ADDRESS'],
        ['Alice', 'alice@example.com'],
      ];
      const result = Cleaner.normalizeHeaders(data);
      expect(result[0]).toEqual(['First Name', 'Email Address']);
    });

    test('collapses multiple spaces', () => {
      const data = [
        ['first   name', 'date    of   birth'],
        ['Alice', '1990'],
      ];
      const result = Cleaner.normalizeHeaders(data);
      expect(result[0]).toEqual(['First Name', 'Date Of Birth']);
    });

    test('trims whitespace from headers', () => {
      const data = [['  name  ', '  age  ']];
      const result = Cleaner.normalizeHeaders(data);
      expect(result[0]).toEqual(['Name', 'Age']);
    });

    test('handles non-string headers', () => {
      const data = [[123, null]];
      const result = Cleaner.normalizeHeaders(data);
      expect(result[0]).toEqual([123, null]);
    });

    test('handles empty data', () => {
      expect(Cleaner.normalizeHeaders([])).toEqual([]);
    });

    test('does not modify data rows', () => {
      const data = [['name'], ['alice']];
      const result = Cleaner.normalizeHeaders(data);
      expect(result[1]).toEqual(['alice']);
    });
  });

  // ---- getStats ----

  describe('getStats', () => {
    test('calculates correct statistics', () => {
      const original = [
        ['A', 'B', 'C'],
        ['1', '2', '3'],
        ['4', '5', '6'],
        ['7', '8', '9'],
      ];
      const cleaned = [
        ['A', 'B'],
        ['1', '2'],
        ['4', '5'],
      ];
      const stats = Cleaner.getStats(original, cleaned);
      expect(stats).toEqual({
        rowsRemoved: 1,
        colsRemoved: 1,
        originalRows: 4,
        cleanedRows: 3,
        originalCols: 3,
        cleanedCols: 2,
      });
    });

    test('handles no changes', () => {
      const data = [['A'], ['1']];
      const stats = Cleaner.getStats(data, data);
      expect(stats.rowsRemoved).toBe(0);
      expect(stats.colsRemoved).toBe(0);
    });

    test('handles empty original', () => {
      const stats = Cleaner.getStats([], []);
      expect(stats.originalRows).toBe(0);
      expect(stats.cleanedRows).toBe(0);
      expect(stats.originalCols).toBe(0);
      expect(stats.cleanedCols).toBe(0);
    });
  });

  // ---- emptyStats ----

  describe('emptyStats', () => {
    test('returns all zero counters', () => {
      const stats = Cleaner.emptyStats();
      expect(stats).toEqual({
        trimmedValues: 0,
        emptyRowsRemoved: 0,
        emptyColumnsRemoved: 0,
        duplicateRowsRemoved: 0,
        numericValuesCorrected: 0,
        headersNormalized: 0,
        datesNormalized: 0,
      });
    });
  });

  // ---- cleaning stats via apply (with cellMeta) ----

  describe('cleaningStats via apply', () => {
    const baseOpts = (overrides) => ({
      trim: false,
      removeEmptyRows: false,
      removeEmptyColumns: false,
      removeDuplicates: false,
      duplicateMode: 'keep-first',
      fixNumbers: false,
      normalizeHeaders: false,
      ...overrides,
    });

    test('trimmedValues counts cells changed by trim', () => {
      const data = [['  Name  ', '  Age  '], ['  Alice  ', '  30  '], ['  Bob   ', '   25  ']];
      const result = Cleaner.apply(data, baseOpts({ trim: true }), null);
      expect(result.stats.trimmedValues).toBe(6); // 6 cells trimmed
      expect(result.stats.emptyRowsRemoved).toBe(0);
      expect(result.stats.emptyColumnsRemoved).toBe(0);
    });

    test('trimmedValues is zero when nothing changes', () => {
      const data = [['Name', 'Age'], ['Alice', '30']];
      const result = Cleaner.apply(data, baseOpts({ trim: true }), null);
      expect(result.stats.trimmedValues).toBe(0);
    });

    test('emptyRowsRemoved counts rows removed', () => {
      const data = [['Name'], ['Alice'], [''], ['Bob'], ['', '']];
      const result = Cleaner.apply(data, baseOpts({ removeEmptyRows: true }), null);
      expect(result.stats.emptyRowsRemoved).toBe(2);
    });

    test('emptyRowsRemoved is zero when no empty rows', () => {
      const data = [['Name'], ['Alice'], ['Bob']];
      const result = Cleaner.apply(data, baseOpts({ removeEmptyRows: true }), null);
      expect(result.stats.emptyRowsRemoved).toBe(0);
    });

    test('emptyColumnsRemoved counts columns removed', () => {
      const data = [['Name', '', 'Age', '', ''], ['Alice', '', '30', '', '']];
      const result = Cleaner.apply(data, baseOpts({ removeEmptyColumns: true }), null);
      expect(result.stats.emptyColumnsRemoved).toBe(3);
    });

    test('emptyColumnsRemoved is zero when all columns have content', () => {
      const data = [['Name', 'Age'], ['Alice', '30']];
      const result = Cleaner.apply(data, baseOpts({ removeEmptyColumns: true }), null);
      expect(result.stats.emptyColumnsRemoved).toBe(0);
    });

    test('duplicateRowsRemoved counts keep-first duplicates', () => {
      const data = [['Name'], ['Alice'], ['Bob'], ['Alice'], ['Charlie'], ['Bob']];
      const result = Cleaner.apply(data, baseOpts({ removeDuplicates: true, duplicateMode: 'keep-first' }), null);
      expect(result.stats.duplicateRowsRemoved).toBe(2);
    });

    test('duplicateRowsRemoved counts absolute duplicates', () => {
      const data = [['Name'], ['Alice'], ['Bob'], ['Alice'], ['Charlie'], ['Bob']];
      const result = Cleaner.apply(data, baseOpts({ removeDuplicates: true, duplicateMode: 'absolute' }), null);
      expect(result.stats.duplicateRowsRemoved).toBe(4);
    });

    test('duplicateRowsRemoved is zero with no duplicates', () => {
      const data = [['Name'], ['Alice'], ['Bob'], ['Charlie']];
      const result = Cleaner.apply(data, baseOpts({ removeDuplicates: true }), null);
      expect(result.stats.duplicateRowsRemoved).toBe(0);
    });

    test('numericValuesCorrected counts cells converted from string to number', () => {
      const data = [['Col'], ['42'], ['1,000'], ['3.14']];
      const result = Cleaner.apply(data, baseOpts({ fixNumbers: true }), null);
      expect(result.stats.numericValuesCorrected).toBe(3);
    });

    test('numericValuesCorrected skips non-numeric and already numeric', () => {
      const data = [['Col'], ['hello'], [42], ['x123']];
      const result = Cleaner.apply(data, baseOpts({ fixNumbers: true }), null);
      expect(result.stats.numericValuesCorrected).toBe(0);
    });

    test('numericValuesCorrected skips header row', () => {
      const data = [['42', '100'], ['1', '2']];
      const result = Cleaner.apply(data, baseOpts({ fixNumbers: true }), null);
      expect(result.stats.numericValuesCorrected).toBe(2); // only data row
    });

    test('headersNormalized counts headers changed', () => {
      const data = [['first name', 'LAST_NAME', 'age'], ['Alice', 'Smith', '30']];
      const result = Cleaner.apply(data, baseOpts({ normalizeHeaders: true }), null);
      expect(result.stats.headersNormalized).toBe(3);
    });

    test('headersNormalized is zero when headers are already normalized', () => {
      const data = [['Name', 'Age'], ['Alice', '30']];
      const result = Cleaner.apply(data, baseOpts({ normalizeHeaders: true }), null);
      expect(result.stats.headersNormalized).toBe(0);
    });

    test('combined operations aggregate all stats', () => {
      const data = [
        ['  name  ', '  ', '  age  '],
        ['  Alice  ', '  ', '  30  '],
        ['', '', ''],
        ['  Alice  ', '  ', '  30  '],
      ];
      const result = Cleaner.apply(data, baseOpts({
        trim: true,
        removeEmptyRows: true,
        removeEmptyColumns: true,
        removeDuplicates: true,
      }), null);
      expect(result.stats.trimmedValues).toBeGreaterThan(0);
      expect(result.stats.emptyRowsRemoved).toBe(1);
      expect(result.stats.emptyColumnsRemoved).toBe(1);
      expect(result.stats.duplicateRowsRemoved).toBe(1);
    });

    test('stats object present even for no-op operations', () => {
      const data = [['Name'], ['Alice']];
      const result = Cleaner.apply(data, baseOpts({ removeEmptyRows: true }), null);
      expect(result.stats).toBeDefined();
      expect(result.stats.emptyRowsRemoved).toBe(0);
    });
  });

  // ---- apply (pipeline) ----

  describe('apply', () => {
    const allOff = {
      trim: false,
      removeEmptyRows: false,
      removeEmptyColumns: false,
      removeDuplicates: false,
      duplicateMode: 'keep-first',
      fixNumbers: false,
      normalizeHeaders: false,
    };

    test('returns data unchanged when all options are off', () => {
      const data = [
        ['  Name  '],
        ['  Alice  '],
        [''],
      ];
      const result = Cleaner.apply(data, allOff);
      expect(result).toEqual(data);
    });

    test('returns empty/null data unchanged', () => {
      expect(Cleaner.apply([], allOff)).toEqual([]);
      expect(Cleaner.apply(null, allOff)).toBeNull();
    });

    test('does not mutate original data', () => {
      const data = [['  A  '], ['  1  ']];
      const copy = JSON.parse(JSON.stringify(data));
      Cleaner.apply(data, { ...allOff, trim: true });
      expect(data).toEqual(copy);
    });

    test('applies trim only', () => {
      const data = [['  Name  '], ['  Alice  ']];
      const result = Cleaner.apply(data, { ...allOff, trim: true });
      expect(result).toEqual([['Name'], ['Alice']]);
    });

    test('applies multiple operations in sequence', () => {
      const data = [
        ['  name  ', '  '],
        ['  alice  ', '  '],
        ['  ', '  '],
        ['  alice  ', '  '],
      ];
      const result = Cleaner.apply(data, {
        trim: true,
        removeEmptyRows: true,
        removeEmptyColumns: true,
        removeDuplicates: true,
        duplicateMode: 'keep-first',
        fixNumbers: false,
        normalizeHeaders: true,
      });
      expect(result).toEqual([['Name'], ['alice']]);
    });

    test('applies fixNumbers and normalizeHeaders together', () => {
      const data = [
        ['price', 'quantity'],
        ['1,000', '5'],
      ];
      const result = Cleaner.apply(data, {
        ...allOff,
        fixNumbers: true,
        normalizeHeaders: true,
      });
      expect(result[0]).toEqual(['Price', 'Quantity']);
      expect(result[1]).toEqual([1000, 5]);
    });

    test('uses absolute duplicate mode when specified', () => {
      const data = [
        ['Val'],
        ['A'],
        ['B'],
        ['A'],
      ];
      const result = Cleaner.apply(data, {
        ...allOff,
        removeDuplicates: true,
        duplicateMode: 'absolute',
      });
      expect(result).toEqual([['Val'], ['B']]);
    });

    test('uses keep-first duplicate mode by default', () => {
      const data = [
        ['Val'],
        ['A'],
        ['B'],
        ['A'],
      ];
      const result = Cleaner.apply(data, {
        ...allOff,
        removeDuplicates: true,
        duplicateMode: 'keep-first',
      });
      expect(result).toEqual([['Val'], ['A'], ['B']]);
    });
  });

  // ---- cellMeta ----

  describe('cellMeta', () => {
    const allOff = {
      trim: false,
      removeEmptyRows: false,
      removeEmptyColumns: false,
      removeDuplicates: false,
      duplicateMode: 'keep-first',
      fixNumbers: false,
      normalizeHeaders: false,
    };

    test('Cleaner does not mutate source cellMeta', () => {
      const data = [
        ['  Name  ', ' Age'],
        [' Alice ', '  30  '],
      ];
      const cellMeta = [
        [{ type: 'string', value: '  Name  ' }, { type: 'string', value: ' Age' }],
        [{ type: 'string', value: ' Alice ' }, { type: 'string', value: '  30  ' }],
      ];
      const sourceMeta = JSON.parse(JSON.stringify(cellMeta));
      Cleaner.apply(data, { ...allOff, trim: true }, cellMeta);
      expect(cellMeta).toEqual(sourceMeta);
    });

    test('fixNumbers updates cellMeta when converting strings to numbers', () => {
      const data = [['Value'], ['42']];
      const cellMeta = [[{ type: 'string', value: 'Value' }], [{ type: 'string', value: '42' }]];
      const result = Cleaner.fixNumberFormatting(data, cellMeta);
      expect(result.cellMeta[1][0]).toEqual({ type: 'number', value: 42 });
    });

    test('fixNumbers updates cellMeta for leading-zero cleaned strings', () => {
      const data = [['Code'], ['0,012,345']];
      const cellMeta = [[{ type: 'string', value: 'Code' }], [{ type: 'string', value: '0,012,345' }]];
      const result = Cleaner.fixNumberFormatting(data, cellMeta);
      expect(result.cellMeta[1][0]).toEqual({ type: 'string', value: '0012345' });
    });

    test('Fix numbers preserves a formula with a numeric-looking cached result', () => {
      const formulaToken = {
        type: 'formula',
        value: '=TEXT(1234,"0")',
        displayValue: '1234',
      };
      const data = [['Result'], ['1234']];
      const cellMeta = [[{ type: 'string', value: 'Result' }], [formulaToken]];

      const result = Cleaner.apply(data, {
        trim: false,
        removeEmptyRows: false,
        removeEmptyColumns: false,
        removeDuplicates: false,
        fixNumbers: true,
        normalizeHeaders: false,
      }, cellMeta);

      expect(result.data).toEqual(data);
      expect(result.cellMeta[1][0]).toEqual(formulaToken);
    });

    test('normalizeHeaders updates header cellMeta tokens', () => {
      const data = [['first name', 'eMAIL ADDRESS'], ['Alice', 'alice@example.com']];
      const cellMeta = [
        [{ type: 'string', value: 'first name' }, { type: 'string', value: 'eMAIL ADDRESS' }],
        [{ type: 'string', value: 'Alice' }, { type: 'string', value: 'alice@example.com' }],
      ];
      const result = Cleaner.normalizeHeaders(data, cellMeta);
      expect(result.data[0]).toEqual(['First Name', 'Email Address']);
      expect(result.cellMeta[0][0].value).toBe('First Name');
      expect(result.cellMeta[0][1].value).toBe('Email Address');
      expect(result.cellMeta[1]).toEqual(cellMeta[1]);
    });

    test('value transformations never alter non-string tokens', () => {
      const formula = '=TEXT(1234,"0")';
      const data = [
        ['  formula header  ', '  ordinary header  ', 'Number', 'Boolean', 'Date', 'Empty'],
        [' 1234 ', ' 1,234 ', 42, true, 45306, ''],
      ];
      const cellMeta = [
        [
          { type: 'formula', value: '=A1', displayValue: '  formula header  ' },
          { type: 'string', value: '  ordinary header  ' },
          { type: 'string', value: 'Number' },
          { type: 'string', value: 'Boolean' },
          { type: 'string', value: 'Date' },
          { type: 'string', value: 'Empty' },
        ],
        [
          { type: 'formula', value: formula, displayValue: ' 1234 ' },
          { type: 'string', value: ' 1,234 ' },
          { type: 'number', value: 42 },
          { type: 'boolean', value: true },
          { type: 'date', value: 45306, formatType: 'DATE' },
          { type: 'empty' },
        ],
      ];

      const result = Cleaner.apply(data, {
        trim: true,
        removeEmptyRows: false,
        removeEmptyColumns: false,
        removeDuplicates: false,
        fixNumbers: true,
        normalizeHeaders: true,
      }, cellMeta);

      expect(result.data).toEqual([
        ['  formula header  ', 'Ordinary Header', 'Number', 'Boolean', 'Date', 'Empty'],
        [' 1234 ', 1234, 42, true, 45306, ''],
      ]);
      expect(result.cellMeta[0][0]).toEqual(cellMeta[0][0]);
      expect(result.cellMeta[1][0]).toEqual(cellMeta[1][0]);
      expect(result.cellMeta[1][1]).toEqual({ type: 'number', value: 1234 });
      expect(result.cellMeta[1].slice(2)).toEqual(cellMeta[1].slice(2));
    });

    test('formula cached as padded text is unchanged by trim and Fix numbers', () => {
      const formulaToken = {
        type: 'formula',
        value: '=TEXT(1234,"0")',
        displayValue: ' 1234 ',
      };
      const data = [['Result', 'Label'], [' 1234 ', '  ordinary  ']];
      const cellMeta = [
        [{ type: 'string', value: 'Result' }, { type: 'string', value: 'Label' }],
        [formulaToken, { type: 'string', value: '  ordinary  ' }],
      ];

      const result = Cleaner.apply(data, {
        trim: true,
        removeEmptyRows: false,
        removeEmptyColumns: false,
        removeDuplicates: false,
        fixNumbers: true,
        normalizeHeaders: false,
      }, cellMeta);

      expect(result.data).toEqual([['Result', 'Label'], [' 1234 ', 'ordinary']]);
      expect(result.cellMeta[1][0]).toEqual(formulaToken);
      expect(result.cellMeta[1][1]).toEqual({ type: 'string', value: 'ordinary' });
    });

    test('formula in header row is not title-cased beside ordinary string headers', () => {
      const formulaToken = {
        type: 'formula',
        value: '=A1',
        displayValue: 'formula header',
      };
      const data = [['formula header', 'first name'], ['value', 'Alice']];
      const cellMeta = [
        [formulaToken, { type: 'string', value: 'first name' }],
        [{ type: 'string', value: 'value' }, { type: 'string', value: 'Alice' }],
      ];

      const result = Cleaner.apply(data, {
        trim: false,
        removeEmptyRows: false,
        removeEmptyColumns: false,
        removeDuplicates: false,
        fixNumbers: false,
        normalizeHeaders: true,
      }, cellMeta);

      expect(result.data[0]).toEqual(['formula header', 'First Name']);
      expect(result.cellMeta[0][0]).toEqual(formulaToken);
      expect(result.cellMeta[0][1]).toEqual({ type: 'string', value: 'First Name' });
    });
  });

  // ---- normalizeDates ----
  describe('normalizeDates', () => {
    // ---- shared helper: parseDateToken ----
    describe('parseDateToken', () => {
      test('ISO date returns DATE token with exact serial', () => {
        const token = Cleaner.parseDateToken('2026-03-04');
        expect(token).toEqual({ type: 'date', value: 46085, formatType: 'DATE' });
      });

      test('ISO date unpadded', () => {
        const token = Cleaner.parseDateToken('2026-3-4');
        expect(token).toEqual({ type: 'date', value: 46085, formatType: 'DATE' });
      });

      test('ISO datetime no suffix (floating)', () => {
        const token = Cleaner.parseDateToken('2026-03-04T12:30:00');
        expect(token.formatType).toBe('DATE_TIME');
        expect(token.value).toBeCloseTo(46085 + 12.5 / 24, 10);
      });

      test('ISO datetime Z suffix', () => {
        const token = Cleaner.parseDateToken('2026-03-04T12:30:00Z');
        expect(token.formatType).toBe('DATE_TIME');
        expect(token.value).toBeCloseTo(46085 + 12.5 / 24, 10);
      });

      test('ISO datetime with positive offset', () => {
        const token = Cleaner.parseDateToken('2026-03-04T12:30:00+05:30');
        expect(token.formatType).toBe('DATE_TIME');
        expect(token.value).toBeCloseTo(46085 + 7 / 24, 10);
      });

      test('ISO datetime with negative offset', () => {
        const token = Cleaner.parseDateToken('2026-03-04T12:30:00-04:00');
        expect(token.formatType).toBe('DATE_TIME');
        expect(token.value).toBeCloseTo(46085 + 16.5 / 24, 10);
      });

      test('offset cross day backward', () => {
        const token = Cleaner.parseDateToken('2026-03-04T02:00:00+05:00');
        expect(token.formatType).toBe('DATE_TIME');
        expect(token.value).toBeCloseTo(46084 + 21 / 24, 10);
      });

      test('offset cross day forward', () => {
        const token = Cleaner.parseDateToken('2026-03-04T23:30:00-05:00');
        expect(token.formatType).toBe('DATE_TIME');
        expect(token.value).toBeCloseTo(46086 + 4.5 / 24, 10);
      });

      test('fractional seconds preserved', () => {
        const token = Cleaner.parseDateToken('2026-03-04T12:30:00.500');
        expect(token.formatType).toBe('DATE_TIME');
        expect(token.value).toBeCloseTo(46085 + 12.5 / 24 + 0.5 / 86400, 10);
      });

      test('rejects non-strings', () => {
        expect(Cleaner.parseDateToken(null)).toBeNull();
        expect(Cleaner.parseDateToken(42)).toBeNull();
        expect(Cleaner.parseDateToken(true)).toBeNull();
      });

      test('rejects empty string', () => {
        expect(Cleaner.parseDateToken('')).toBeNull();
        expect(Cleaner.parseDateToken('   ')).toBeNull();
      });
    });

    // ---- serial anchor tests ----
    describe('serial anchors', () => {
      test('1899-12-30 → 0', () => {
        expect(Cleaner.parseDateToken('1899-12-30').value).toBe(0);
      });

      test('1900-01-01 → 2', () => {
        expect(Cleaner.parseDateToken('1900-01-01').value).toBe(2);
      });

      test('1970-01-01 → 25569', () => {
        expect(Cleaner.parseDateToken('1970-01-01').value).toBe(25569);
      });

      test('2026-03-04 → 46085', () => {
        expect(Cleaner.parseDateToken('2026-03-04').value).toBe(46085);
      });

      test('2024-02-29 → 45351', () => {
        expect(Cleaner.parseDateToken('2024-02-29').value).toBe(45351);
      });
    });

    // ---- ISO dates ----
    describe('ISO dates', () => {
      test('converts YYYY-MM-DD to date token', () => {
        const data = [['Name', 'Birthday'], ['Alice', '2026-03-04']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.cellMeta[1][1]).toEqual({ type: 'date', value: 46085, formatType: 'DATE' });
        expect(result.stats.datesNormalized).toBe(1);
      });

      test('does not modify the data array string', () => {
        const data = [['Name', 'Date'], ['Alice', '2026-03-04']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.data[1][1]).toBe('2026-03-04');
      });

      test('rejects invalid ISO date (Feb 30)', () => {
        const data = [['Name', 'Date'], ['Alice', '2026-02-30']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.cellMeta[1][1]).toEqual({ type: 'string', value: '2026-02-30' });
        expect(result.stats.datesNormalized).toBe(0);
      });

      test('converts leap day (Feb 29, 2024)', () => {
        const data = [['Name', 'Date'], ['Alice', '2024-02-29']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.cellMeta[1][1]).toEqual({ type: 'date', value: 45351, formatType: 'DATE' });
      });
    });

    // ---- Month-name dates ----
    describe('month-name dates', () => {
      test('converts "Month DD, YYYY" full month', () => {
        const data = [['Name', 'Date'], ['Alice', 'March 4, 2026']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.cellMeta[1][1]).toEqual({ type: 'date', value: 46085, formatType: 'DATE' });
        expect(result.stats.datesNormalized).toBe(1);
      });

      test('converts "DD-Mon-YYYY" hyphenated', () => {
        const data = [['Name', 'Date'], ['Alice', '04-Mar-2026']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.cellMeta[1][1]).toEqual({ type: 'date', value: 46085, formatType: 'DATE' });
      });

      test('date serial number matches between ISO and month-name for same date', () => {
        const data = [['Name', 'MonthName', 'ISO'], ['Alice', 'March 4, 2026', '2026-03-04']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.cellMeta[1][1].value).toBe(46085);
        expect(result.cellMeta[1][2].value).toBe(46085);
      });
    });

    // ---- Valid existing date cells ----
    describe('valid existing date cells', () => {
      test('preserves cells that already have date tokens', () => {
        const existingToken = { type: 'date', value: 46024, formatType: 'DATE' };
        const data = [['Name', 'Birthday'], ['Alice', 'March 4, 2026']];
        const cellMeta = [
          [{ type: 'string', value: 'Name' }, { type: 'string', value: 'Birthday' }],
          [{ type: 'string', value: 'Alice' }, existingToken],
        ];
        const result = Cleaner.normalizeDates(data, cellMeta);
        expect(result.cellMeta[1][1]).toEqual(existingToken);
        expect(result.stats.datesNormalized).toBe(0);
      });
    });

    // ---- Ambiguous slash dates ----
    describe('ambiguous slash dates', () => {
      test('does NOT convert MM/DD/YYYY', () => {
        const data = [['Name', 'Date'], ['Alice', '03/04/2026']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.stats.datesNormalized).toBe(0);
      });

      test('does NOT convert dot-separated dates', () => {
        const data = [['Name', 'Date'], ['Alice', '03.04.2026']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.stats.datesNormalized).toBe(0);
      });

      test('does NOT convert ambiguous numeric hyphen format MM-DD-YYYY', () => {
        const data = [['Name', 'Date'], ['Alice', '03-04-2026']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.stats.datesNormalized).toBe(0);
      });

      test('does NOT convert ambiguous numeric hyphen format DD-MM-YYYY', () => {
        const data = [['Name', 'Date'], ['Alice', '04-03-2026']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.stats.datesNormalized).toBe(0);
      });
    });

    // ---- Invalid dates and times ----
    describe('invalid dates and times', () => {
      test('does NOT convert "2026-13-01" (month 13)', () => {
        expect(Cleaner.parseDateToken('2026-13-01')).toBeNull();
      });

      test('does NOT convert "February 30, 2026"', () => {
        expect(Cleaner.parseDateToken('February 30, 2026')).toBeNull();
      });

      test('does NOT convert "2026-02-29" (non-leap year)', () => {
        expect(Cleaner.parseDateToken('2026-02-29')).toBeNull();
      });

      test('rejects hour 24', () => {
        expect(Cleaner.parseDateToken('2026-03-04T24:01:00')).toBeNull();
      });

      test('rejects minute 60', () => {
        expect(Cleaner.parseDateToken('2026-03-04T12:60:00')).toBeNull();
      });

      test('rejects second 60', () => {
        expect(Cleaner.parseDateToken('2026-03-04T12:30:60')).toBeNull();
      });

      test('rejects invalid offset +25:00', () => {
        expect(Cleaner.parseDateToken('2026-03-04T12:30:00+25:00')).toBeNull();
      });

      test('should reject hour 24 from normalizeDates', () => {
        const data = [['col'], ['2026-03-04T24:01:00']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.stats.datesNormalized).toBe(0);
      });

      test('should reject minute 60 from normalizeDates', () => {
        const data = [['col'], ['2026-03-04T12:60:00']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.stats.datesNormalized).toBe(0);
      });
    });

    // ---- Timezone offset boundaries ----
    describe('timezone offset boundaries', () => {
      test('+00:00 accepted', () => {
        expect(Cleaner.parseDateToken('2026-03-04T12:30:00+00:00')).not.toBeNull();
      });

      test('-00:00 accepted', () => {
        expect(Cleaner.parseDateToken('2026-03-04T12:30:00-00:00')).not.toBeNull();
      });

      test('+05:30 accepted', () => {
        expect(Cleaner.parseDateToken('2026-03-04T12:30:00+05:30')).not.toBeNull();
      });

      test('-04:00 accepted', () => {
        expect(Cleaner.parseDateToken('2026-03-04T12:30:00-04:00')).not.toBeNull();
      });

      test('+13:59 accepted', () => {
        expect(Cleaner.parseDateToken('2026-03-04T12:30:00+13:59')).not.toBeNull();
      });

      test('-13:59 accepted', () => {
        expect(Cleaner.parseDateToken('2026-03-04T12:30:00-13:59')).not.toBeNull();
      });

      test('+14:00 accepted', () => {
        expect(Cleaner.parseDateToken('2026-03-04T12:30:00+14:00')).not.toBeNull();
      });

      test('-14:00 accepted', () => {
        expect(Cleaner.parseDateToken('2026-03-04T12:30:00-14:00')).not.toBeNull();
      });

      test('+14:01 rejected', () => {
        expect(Cleaner.parseDateToken('2026-03-04T12:30:00+14:01')).toBeNull();
      });

      test('-14:30 rejected', () => {
        expect(Cleaner.parseDateToken('2026-03-04T12:30:00-14:30')).toBeNull();
      });

      test('+15:00 rejected', () => {
        expect(Cleaner.parseDateToken('2026-03-04T12:30:00+15:00')).toBeNull();
      });

      test('-23:59 rejected', () => {
        expect(Cleaner.parseDateToken('2026-03-04T12:30:00-23:59')).toBeNull();
      });

      test('rejected offset remains string token locally', () => {
        const data = [['col'], ['2026-03-04T12:30:00+15:00']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.cellMeta[1][0]).toEqual({ type: 'string', value: '2026-03-04T12:30:00+15:00' });
        expect(result.stats.datesNormalized).toBe(0);
      });
    });

    // ---- Formulas returning dates ----
    describe('formulas returning dates', () => {
      test('does NOT modify formula cells', () => {
        const formulaToken = { type: 'formula', value: '=DATE(2026,3,4)' };
        const data = [['Name', 'Computed'], ['Alice', '=DATE(2026,3,4)']];
        const cellMeta = [
          [{ type: 'string', value: 'Name' }, { type: 'string', value: 'Computed' }],
          [{ type: 'string', value: 'Alice' }, formulaToken],
        ];
        const result = Cleaner.normalizeDates(data, cellMeta);
        expect(result.cellMeta[1][1]).toEqual(formulaToken);
        expect(result.stats.datesNormalized).toBe(0);
      });
    });

    // ---- Empty values ----
    describe('empty values', () => {
      test('handles empty cell', () => {
        const data = [['Name', 'Date'], ['Alice', '']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.cellMeta[1][1]).toEqual({ type: 'empty' });
        expect(result.stats.datesNormalized).toBe(0);
      });

      test('handles fully empty data', () => {
        expect(Cleaner.normalizeDates([], null).stats.datesNormalized).toBe(0);
      });
    });

    // ---- Header and typed-cell semantics ----
    describe('header and typed-cell semantics', () => {
      test('always skips row 0 — both data and meta unchanged', () => {
        const data = [['ID', '2026-03-04'], ['1', '2026-06-15']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.data[0][1]).toBe('2026-03-04');
        expect(result.cellMeta[0][1]).toEqual({ type: 'string', value: '2026-03-04' });
      });

      test('does NOT count header values in datesNormalized', () => {
        const data = [['ID', '2026-03-04'], ['1', '2026-06-15']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.stats.datesNormalized).toBe(1);
      });

      test('skips TEXT-format cells when metadata is present', () => {
        const data = [['Name', 'Date'], ['Alice', '2026-03-04']];
        const cellMeta = [
          [{ type: 'string', value: 'Name' }, { type: 'string', value: 'Date' }],
          [{ type: 'string', value: 'Alice' }, { type: 'string', value: '2026-03-04', formatType: 'TEXT' }],
        ];
        const result = Cleaner.normalizeDates(data, cellMeta);
        expect(result.cellMeta[1][1].type).toBe('string');
        expect(result.stats.datesNormalized).toBe(0);
      });

      test('skips number cells even if displayed as date string', () => {
        const data = [['Name', 'Val'], ['Alice', '2026-03-04']];
        const cellMeta = [
          [{ type: 'string', value: 'Name' }, { type: 'string', value: 'Val' }],
          [{ type: 'string', value: 'Alice' }, { type: 'number', value: 42 }],
        ];
        const result = Cleaner.normalizeDates(data, cellMeta);
        expect(result.cellMeta[1][1].type).toBe('number');
        expect(result.stats.datesNormalized).toBe(0);
      });

      test('skips boolean cells', () => {
        const data = [['Flag'], [true]];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.cellMeta[1][0]).toEqual({ type: 'boolean', value: true });
        expect(result.stats.datesNormalized).toBe(0);
      });
    });

    // ---- Partial metadata ----
    describe('partial metadata', () => {
      test('metadata missing an entire data row does not throw', () => {
        const data = [['col'], ['2026-03-04']];
        const cellMeta = [[{ type: 'string', value: 'col' }]];
        expect(() => Cleaner.normalizeDates(data, cellMeta)).not.toThrow();
      });

      test('a missing metadata row leaves date-looking cells unchanged', () => {
        const data = [['col'], ['2026-03-04']];
        const cellMeta = [[{ type: 'string', value: 'col' }]];
        const result = Cleaner.normalizeDates(data, cellMeta);
        expect(result.stats.datesNormalized).toBe(0);
        expect(result.cellMeta[1]).toEqual([]);
      });

      test('metadata row shorter than data row leaves unmatched cells unchanged', () => {
        const data = [['a', 'b'], ['x', '2026-03-04']];
        const cellMeta = [
          [{ type: 'string', value: 'a' }, { type: 'string', value: 'b' }],
          [{ type: 'string', value: 'x' }],
        ];
        const result = Cleaner.normalizeDates(data, cellMeta);
        expect(result.stats.datesNormalized).toBe(0);
      });

      test('undefined token is not inferred as string', () => {
        const data = [['a'], ['2026-03-04']];
        const cellMeta = [[{ type: 'string', value: 'a' }], [{ type: 'string', value: '2026-03-04' }]];
        cellMeta[1][0] = undefined;
        const result = Cleaner.normalizeDates(data, cellMeta);
        expect(result.stats.datesNormalized).toBe(0);
      });

      test('null token is not inferred as string', () => {
        const data = [['a'], ['2026-03-04']];
        const cellMeta = [[{ type: 'string', value: 'a' }], [null]];
        const result = Cleaner.normalizeDates(data, cellMeta);
        expect(result.stats.datesNormalized).toBe(0);
      });

      test('explicitly typed string tokens are still normalized', () => {
        const data = [['a'], ['2026-03-04']];
        const cellMeta = [
          [{ type: 'string', value: 'a' }],
          [{ type: 'string', value: '2026-03-04' }],
        ];
        const result = Cleaner.normalizeDates(data, cellMeta);
        expect(result.stats.datesNormalized).toBe(1);
      });

      test('date token remains unchanged even though data looks like a date', () => {
        const data = [['a'], ['2026-03-04']];
        const cellMeta = [
          [{ type: 'string', value: 'a' }],
          [{ type: 'date', value: 46000, formatType: 'DATE' }],
        ];
        const result = Cleaner.normalizeDates(data, cellMeta);
        expect(result.cellMeta[1][0].type).toBe('date');
        expect(result.stats.datesNormalized).toBe(0);
      });

      test('number token remains unchanged', () => {
        const data = [['a'], ['2026-03-04']];
        const cellMeta = [
          [{ type: 'string', value: 'a' }],
          [{ type: 'number', value: 42 }],
        ];
        const result = Cleaner.normalizeDates(data, cellMeta);
        expect(result.cellMeta[1][0].type).toBe('number');
        expect(result.stats.datesNormalized).toBe(0);
      });

      test('boolean token remains unchanged', () => {
        const data = [['a'], ['2026-03-04']];
        const cellMeta = [
          [{ type: 'string', value: 'a' }],
          [{ type: 'boolean', value: true }],
        ];
        const result = Cleaner.normalizeDates(data, cellMeta);
        expect(result.cellMeta[1][0].type).toBe('boolean');
        expect(result.stats.datesNormalized).toBe(0);
      });

      test('TEXT-format token remains unchanged', () => {
        const data = [['a'], ['2026-03-04']];
        const cellMeta = [
          [{ type: 'string', value: 'a' }],
          [{ type: 'string', value: '2026-03-04', formatType: 'TEXT' }],
        ];
        const result = Cleaner.normalizeDates(data, cellMeta);
        expect(result.cellMeta[1][0].type).toBe('string');
        expect(result.stats.datesNormalized).toBe(0);
      });

      test('formula token remains unchanged', () => {
        const data = [['a'], ['2026-03-04']];
        const cellMeta = [
          [{ type: 'string', value: 'a' }],
          [{ type: 'formula', value: '=TODAY()' }],
        ];
        const result = Cleaner.normalizeDates(data, cellMeta);
        expect(result.cellMeta[1][0].type).toBe('formula');
        expect(result.stats.datesNormalized).toBe(0);
      });

      test('datesNormalized counts only explicit eligible string tokens', () => {
        const data = [['a', 'b', 'c', 'd'], ['x', '2026-03-04', '2026-06-15', '2026-12-25']];
        const cellMeta = [
          [{ type: 'string', value: 'a' }, { type: 'string', value: 'b' }, { type: 'string', value: 'c' }, { type: 'string', value: 'd' }],
          [{ type: 'string', value: 'x' }, { type: 'number', value: 1 }, null, { type: 'string', value: '2026-12-25' }],
        ];
        const result = Cleaner.normalizeDates(data, cellMeta);
        expect(result.stats.datesNormalized).toBe(1);
        expect(result.cellMeta[1][3].type).toBe('date');
      });

      test('source metadata object remains unmodified', () => {
        const data = [['a'], ['2026-03-04']];
        const cellMeta = [
          [{ type: 'string', value: 'a' }],
          [{ type: 'string', value: '2026-03-04' }],
        ];
        const metaCopy = JSON.parse(JSON.stringify(cellMeta));
        Cleaner.normalizeDates(data, cellMeta);
        expect(cellMeta).toEqual(metaCopy);
      });
    });

    // ---- Integration: datesNormalized counting ----
    describe('datesNormalized count', () => {
      test('counts only cells actually converted', () => {
        const data = [['a', 'b', 'c'], ['x', '2026-03-04', '2026-06-15']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.stats.datesNormalized).toBe(2);
      });

      test('is zero when no dates found', () => {
        const data = [['a', 'b'], ['x', 'y']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.stats.datesNormalized).toBe(0);
      });
    });

    // ---- Edge cases ----
    describe('edge cases', () => {
      test('works via apply() with the normalizeDates option', () => {
        const data = [['Name', 'Date'], ['Alice', '2026-03-04']];
        const result = Cleaner.apply(data, {
          trim: false, removeEmptyRows: false, removeEmptyColumns: false,
          removeDuplicates: false, fixNumbers: false,
          normalizeDates: true, normalizeHeaders: false,
        }, null);
        expect(result.stats.datesNormalized).toBe(1);
      });

      test('does NOT mutate original cellMeta', () => {
        const data = [['Name', 'Date'], ['Alice', '2026-03-04']];
        const cellMeta = [
          [{ type: 'string', value: 'Name' }, { type: 'string', value: 'Date' }],
          [{ type: 'string', value: 'Alice' }, { type: 'string', value: '2026-03-04' }],
        ];
        const metaCopy = JSON.parse(JSON.stringify(cellMeta));
        Cleaner.normalizeDates(data, cellMeta);
        expect(cellMeta).toEqual(metaCopy);
      });

      test('does NOT convert numeric strings that happen to look like serial numbers', () => {
        const data = [['ID'], ['46024']];
        const result = Cleaner.normalizeDates(data, null);
        expect(result.cellMeta[1][0]).toEqual({ type: 'string', value: '46024' });
        expect(result.stats.datesNormalized).toBe(0);
      });
    });
  });
});
