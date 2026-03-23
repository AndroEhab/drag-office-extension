const fs = require('fs');
const path = require('path');

// Load Cleaner module
let cleanerCode = fs.readFileSync(path.resolve(__dirname, '../sidepanel/cleaner.js'), 'utf-8');
cleanerCode = cleanerCode.replace('const Cleaner =', 'global.Cleaner =');
eval(cleanerCode);
const Cleaner = global.Cleaner;

describe('Cleaner', () => {
  // ---- trimWhitespace ----

  describe('trimWhitespace', () => {
    test('trims leading and trailing spaces', () => {
      const data = [
        ['  Name  ', ' Age'],
        [' Alice ', '  30  '],
      ];
      expect(Cleaner.trimWhitespace(data)).toEqual([
        ['Name', 'Age'],
        ['Alice', '30'],
      ]);
    });

    test('trims tabs and mixed whitespace', () => {
      const data = [['\t hello \n']];
      expect(Cleaner.trimWhitespace(data)).toEqual([['hello']]);
    });

    test('handles non-string cells', () => {
      const data = [[123, null, undefined, true]];
      const result = Cleaner.trimWhitespace(data);
      expect(result).toEqual([['123', '', '', 'true']]);
    });

    test('handles empty data', () => {
      expect(Cleaner.trimWhitespace([])).toEqual([]);
    });

    test('does not mutate original data', () => {
      const data = [['  hi  ']];
      const original = JSON.parse(JSON.stringify(data));
      Cleaner.trimWhitespace(data);
      expect(data).toEqual(original);
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
      expect(Cleaner.removeEmptyRows(data)).toEqual([
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
      const result = Cleaner.removeEmptyRows(data);
      expect(result[0]).toEqual(['', '']);
      expect(result).toHaveLength(2);
    });

    test('removes whitespace-only rows', () => {
      const data = [
        ['Name'],
        ['  ', '\t'],
        ['Alice'],
      ];
      expect(Cleaner.removeEmptyRows(data)).toEqual([
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
      expect(Cleaner.removeEmptyRows(data)).toEqual([['Header']]);
    });

    test('handles empty data', () => {
      expect(Cleaner.removeEmptyRows([])).toEqual([]);
    });

    test('handles single header row', () => {
      const data = [['Name', 'Age']];
      expect(Cleaner.removeEmptyRows(data)).toEqual([['Name', 'Age']]);
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
      expect(Cleaner.removeEmptyColumns(data)).toEqual([
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
      expect(Cleaner.removeEmptyColumns(data)).toEqual([
        ['Name', 'Age'],
        ['Alice', '30'],
      ]);
    });

    test('keeps column if any cell has a value', () => {
      const data = [
        ['Name', '', 'Age'],
        ['Alice', 'x', '30'],
      ];
      expect(Cleaner.removeEmptyColumns(data)).toEqual([
        ['Name', '', 'Age'],
        ['Alice', 'x', '30'],
      ]);
    });

    test('handles rows with missing cells', () => {
      const data = [
        ['A', 'B', 'C'],
        ['1'],
      ];
      const result = Cleaner.removeEmptyColumns(data);
      expect(result[0]).toEqual(['A', 'B', 'C']);
    });

    test('handles empty data', () => {
      expect(Cleaner.removeEmptyColumns([])).toEqual([]);
    });

    test('removes all columns if all are empty', () => {
      const data = [
        ['', ''],
        ['', ''],
      ];
      expect(Cleaner.removeEmptyColumns(data)).toEqual([[], []]);
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
      expect(Cleaner.removeDuplicateRows(data)).toEqual([
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
      const result = Cleaner.removeDuplicateRows(data);
      expect(result).toEqual([['Name'], ['Name']]);
    });

    test('handles no duplicates', () => {
      const data = [
        ['Name'],
        ['Alice'],
        ['Bob'],
      ];
      expect(Cleaner.removeDuplicateRows(data)).toEqual(data);
    });

    test('handles multiple duplicates of the same row', () => {
      const data = [
        ['H'],
        ['A'],
        ['A'],
        ['A'],
        ['B'],
      ];
      expect(Cleaner.removeDuplicateRows(data)).toEqual([
        ['H'],
        ['A'],
        ['B'],
      ]);
    });

    test('handles single row (header only)', () => {
      const data = [['Name']];
      expect(Cleaner.removeDuplicateRows(data)).toEqual([['Name']]);
    });

    test('handles empty data', () => {
      expect(Cleaner.removeDuplicateRows([])).toEqual([]);
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
      const result = Cleaner.fixNumberFormatting(data);
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
      const result = Cleaner.fixNumberFormatting(data);
      expect(result[1][0]).toBe(3.14);
      expect(result[2][0]).toBe(-0.5);
    });

    test('converts comma-separated numbers', () => {
      const data = [
        ['Value'],
        ['1,000'],
        ['1,234,567'],
      ];
      const result = Cleaner.fixNumberFormatting(data);
      expect(result[1][0]).toBe(1000);
      expect(result[2][0]).toBe(1234567);
    });

    test('skips header row', () => {
      const data = [
        ['123', '456'],
        ['7', '8'],
      ];
      const result = Cleaner.fixNumberFormatting(data);
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
      const result = Cleaner.fixNumberFormatting(data);
      expect(result[1][0]).toBe('hello');
      expect(result[2][0]).toBe('12abc');
      expect(result[3][0]).toBe('$100');
      expect(result[4][0]).toBe('1.2.3');
    });

    test('leaves empty strings unchanged', () => {
      const data = [['Col'], ['']];
      const result = Cleaner.fixNumberFormatting(data);
      expect(result[1][0]).toBe('');
    });

    test('handles non-string cells', () => {
      const data = [['Col'], [42]];
      const result = Cleaner.fixNumberFormatting(data);
      expect(result[1][0]).toBe(42);
    });

    test('handles whitespace around numbers', () => {
      const data = [['Col'], [' 42 ']];
      const result = Cleaner.fixNumberFormatting(data);
      expect(result[1][0]).toBe(42);
    });

    test('handles single row (header only)', () => {
      const data = [['Value']];
      expect(Cleaner.fixNumberFormatting(data)).toEqual([['Value']]);
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
});
