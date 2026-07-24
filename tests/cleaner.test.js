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
});
