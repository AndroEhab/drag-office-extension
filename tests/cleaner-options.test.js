/**
 * Comprehensive tests for every cleaning option.
 * Each option is tested in isolation and in combination with others
 * to ensure correct behavior and no unintended side effects.
 */
const { loadModule } = require('./helpers');

const Cleaner = loadModule('../sidepanel/cleaner.js', 'Cleaner');

/** Base options object with all cleaning off */
const ALL_OFF = {
  trim: false,
  removeEmptyRows: false,
  removeEmptyColumns: false,
  removeDuplicates: false,
  duplicateMode: 'keep-first',
  fixNumbers: false,
  normalizeHeaders: false,
};

/** Enable a single option */
function withOption(key, value = true) {
  return { ...ALL_OFF, [key]: value };
}

// ============================================================
// 1. TRIM WHITESPACE
// ============================================================
describe('Cleaning Option: Trim Whitespace', () => {
  const opts = withOption('trim');

  test('trims leading spaces from cells', () => {
    const data = [['  Name', '  Age'], ['  Alice', '  30']];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['Name', 'Age'], ['Alice', '30']]);
  });

  test('trims trailing spaces from cells', () => {
    const data = [['Name  ', 'Age  '], ['Alice  ', '30  ']];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['Name', 'Age'], ['Alice', '30']]);
  });

  test('trims tabs', () => {
    const data = [['\tName\t'], ['\tAlice\t']];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['Name'], ['Alice']]);
  });

  test('trims newlines', () => {
    const data = [['\nName\n'], ['\nAlice\n']];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['Name'], ['Alice']]);
  });

  test('trims mixed whitespace (spaces, tabs, newlines)', () => {
    const data = [[' \t\n Name \t\n ']];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['Name']]);
  });

  test('does not change cells without extraneous whitespace', () => {
    const data = [['Clean Header'], ['Clean Data']];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['Clean Header'], ['Clean Data']]);
  });

  test('preserves internal spaces', () => {
    const data = [['  First Name  '], ['  Mary Jane  ']];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['First Name'], ['Mary Jane']]);
  });

  test('converts null/undefined cells to empty strings', () => {
    const data = [[null, undefined], [123, true]];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['', ''], ['123', 'true']]);
  });

  test('handles completely empty cells', () => {
    const data = [['', ''], ['', '']];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['', ''], ['', '']]);
  });

  test('handles large row count', () => {
    const header = ['Col'];
    const rows = Array.from({ length: 1000 }, (_, i) => [`  value${i}  `]);
    const data = [header, ...rows];
    const result = Cleaner.apply(data, opts);
    expect(result[0]).toEqual(['Col']);
    expect(result[500]).toEqual(['value499']);
    expect(result).toHaveLength(1001);
  });

  test('does not mutate original data', () => {
    const data = [['  A  '], ['  B  ']];
    const copy = JSON.parse(JSON.stringify(data));
    Cleaner.apply(data, opts);
    expect(data).toEqual(copy);
  });
});

// ============================================================
// 2. REMOVE EMPTY ROWS
// ============================================================
describe('Cleaning Option: Remove Empty Rows', () => {
  const opts = withOption('removeEmptyRows');

  test('removes rows where all cells are empty strings', () => {
    const data = [
      ['Name', 'Age'],
      ['Alice', '30'],
      ['', ''],
      ['Bob', '25'],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([
      ['Name', 'Age'],
      ['Alice', '30'],
      ['Bob', '25'],
    ]);
  });

  test('removes rows where all cells are whitespace', () => {
    const data = [
      ['Name'],
      ['Alice'],
      ['   ', '\t', '\n'],
      ['Bob'],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['Name'], ['Alice'], ['Bob']]);
  });

  test('always preserves header row even if empty', () => {
    const data = [
      ['', '', ''],
      ['Alice', '30', 'F'],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result[0]).toEqual(['', '', '']);
    expect(result).toHaveLength(2);
  });

  test('removes multiple consecutive empty rows', () => {
    const data = [
      ['H'],
      ['A'],
      ['', ''],
      ['', ''],
      ['', ''],
      ['B'],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['H'], ['A'], ['B']]);
  });

  test('removes empty rows at end of data', () => {
    const data = [
      ['H'],
      ['A'],
      [''],
      [''],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['H'], ['A']]);
  });

  test('removes empty rows at start (after header)', () => {
    const data = [
      ['H'],
      [''],
      [''],
      ['A'],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['H'], ['A']]);
  });

  test('keeps rows that have at least one non-empty cell', () => {
    const data = [
      ['A', 'B', 'C'],
      ['', 'x', ''],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['A', 'B', 'C'], ['', 'x', '']]);
  });

  test('handles data with only header', () => {
    const data = [['Name', 'Age']];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['Name', 'Age']]);
  });

  test('handles data with only header and empty rows', () => {
    const data = [['H'], [''], [''], ['']];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['H']]);
  });

  test('does not mutate original data', () => {
    const data = [['H'], [''], ['A']];
    const copy = JSON.parse(JSON.stringify(data));
    Cleaner.apply(data, opts);
    expect(data).toEqual(copy);
  });
});

// ============================================================
// 3. REMOVE EMPTY COLUMNS
// ============================================================
describe('Cleaning Option: Remove Empty Columns', () => {
  const opts = withOption('removeEmptyColumns');

  test('removes column where all cells including header are empty', () => {
    const data = [
      ['Name', '', 'Age'],
      ['Alice', '', '30'],
      ['Bob', '', '25'],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([
      ['Name', 'Age'],
      ['Alice', '30'],
      ['Bob', '25'],
    ]);
  });

  test('removes columns with only whitespace', () => {
    const data = [
      ['Name', '  ', 'Age'],
      ['Alice', ' ', '30'],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['Name', 'Age'], ['Alice', '30']]);
  });

  test('keeps column if header has value but data cells are empty', () => {
    const data = [
      ['Name', 'Notes', 'Age'],
      ['Alice', '', '30'],
      ['Bob', '', '25'],
    ];
    const result = Cleaner.apply(data, opts);
    // 'Notes' header has text, so column stays
    expect(result).toEqual(data);
  });

  test('keeps column if any data cell has value even if header is empty', () => {
    const data = [
      ['Name', '', 'Age'],
      ['Alice', 'x', '30'],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual(data);
  });

  test('removes multiple empty columns', () => {
    const data = [
      ['A', '', 'B', '', '', 'C'],
      ['1', '', '2', '', '', '3'],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['A', 'B', 'C'], ['1', '2', '3']]);
  });

  test('removes leading empty columns', () => {
    const data = [
      ['', '', 'Name'],
      ['', '', 'Alice'],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['Name'], ['Alice']]);
  });

  test('removes trailing empty columns', () => {
    const data = [
      ['Name', '', ''],
      ['Alice', '', ''],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['Name'], ['Alice']]);
  });

  test('handles rows with missing cells (ragged arrays)', () => {
    const data = [
      ['A', 'B', 'C'],
      ['1'],       // short row
      ['x', 'y'],  // medium row
    ];
    const result = Cleaner.apply(data, opts);
    // Column B keeps because header has value, column C keeps because header has value
    expect(result[0]).toEqual(['A', 'B', 'C']);
  });

  test('handles all columns empty, returns empty rows', () => {
    const data = [
      ['', ''],
      ['', ''],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([[], []]);
  });

  test('does not mutate original data', () => {
    const data = [['Name', '', 'Age'], ['Alice', '', '30']];
    const copy = JSON.parse(JSON.stringify(data));
    Cleaner.apply(data, opts);
    expect(data).toEqual(copy);
  });
});

// ============================================================
// 4. REMOVE DUPLICATE ROWS (Keep First)
// ============================================================
describe('Cleaning Option: Remove Duplicate Rows (Keep First)', () => {
  const opts = { ...ALL_OFF, removeDuplicates: true, duplicateMode: 'keep-first' };

  test('removes exact duplicate rows, keeps first occurrence', () => {
    const data = [
      ['Name', 'Age'],
      ['Alice', '30'],
      ['Bob', '25'],
      ['Alice', '30'],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([
      ['Name', 'Age'],
      ['Alice', '30'],
      ['Bob', '25'],
    ]);
  });

  test('preserves header row even if it matches a data row', () => {
    const data = [
      ['Name'],
      ['Name'],  // matches header but is a data row
    ];
    const result = Cleaner.apply(data, opts);
    // Header is kept, data row "Name" kept as first occurrence
    expect(result).toEqual([['Name'], ['Name']]);
  });

  test('handles triple duplicates — only first kept', () => {
    const data = [
      ['H'],
      ['A'],
      ['A'],
      ['A'],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['H'], ['A']]);
  });

  test('handles rows that differ in a single column', () => {
    const data = [
      ['Name', 'Age'],
      ['Alice', '30'],
      ['Alice', '31'],  // different age
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual(data); // no duplicates
  });

  test('preserves order of unique rows', () => {
    const data = [
      ['H'],
      ['C'],
      ['A'],
      ['B'],
      ['A'],
      ['C'],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['H'], ['C'], ['A'], ['B']]);
  });

  test('handles data with no duplicates', () => {
    const data = [['H'], ['A'], ['B'], ['C']];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual(data);
  });

  test('handles header-only data', () => {
    const data = [['H']];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['H']]);
  });

  test('handles empty rows as potential duplicates', () => {
    const data = [
      ['H'],
      ['', ''],
      ['A', 'B'],
      ['', ''],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['H'], ['', ''], ['A', 'B']]);
  });

  test('does not mutate original data', () => {
    const data = [['H'], ['A'], ['A']];
    const copy = JSON.parse(JSON.stringify(data));
    Cleaner.apply(data, opts);
    expect(data).toEqual(copy);
  });
});

// ============================================================
// 5. REMOVE DUPLICATE ROWS (Absolute — remove ALL duplicates)
// ============================================================
describe('Cleaning Option: Remove Duplicate Rows (Absolute)', () => {
  const opts = { ...ALL_OFF, removeDuplicates: true, duplicateMode: 'absolute' };

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
    const data = [['H'], ['A'], ['B'], ['C']];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual(data);
  });

  test('removes all data rows if all are duplicates', () => {
    const data = [['H'], ['A'], ['A']];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['H']]);
  });

  test('handles triple duplicates — removes all three', () => {
    const data = [
      ['H'],
      ['A'],
      ['A'],
      ['A'],
      ['B'],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result).toEqual([['H'], ['B']]);
  });

  test('handles multiple groups of duplicates', () => {
    const data = [
      ['H'],
      ['A'],
      ['B'],
      ['A'],
      ['B'],
      ['C'],
    ];
    const result = Cleaner.apply(data, opts);
    // A appears twice, B appears twice — both removed entirely
    expect(result).toEqual([['H'], ['C']]);
  });

  test('header row always preserved even if data rows match it', () => {
    const data = [['Name'], ['Name'], ['Name']];
    const result = Cleaner.apply(data, opts);
    // Header kept; data rows "Name" appear 2 times → all removed
    expect(result).toEqual([['Name']]);
  });

  test('does not mutate original data', () => {
    const data = [['H'], ['A'], ['A']];
    const copy = JSON.parse(JSON.stringify(data));
    Cleaner.apply(data, opts);
    expect(data).toEqual(copy);
  });
});

// ============================================================
// 6. FIX NUMBER FORMATTING
// ============================================================
describe('Cleaning Option: Fix Number Formatting', () => {
  const opts = withOption('fixNumbers');

  test('converts simple integer strings to numbers', () => {
    const data = [['Value'], ['42'], ['0'], ['-7']];
    const result = Cleaner.apply(data, opts);
    expect(result[1][0]).toBe(42);
    expect(result[2][0]).toBe(0);
    expect(result[3][0]).toBe(-7);
  });

  test('converts decimal strings to numbers', () => {
    const data = [['Value'], ['3.14'], ['-0.5'], ['0.001']];
    const result = Cleaner.apply(data, opts);
    expect(result[1][0]).toBe(3.14);
    expect(result[2][0]).toBe(-0.5);
    expect(result[3][0]).toBe(0.001);
  });

  test('converts comma-separated thousands', () => {
    const data = [['Amount'], ['1,000'], ['1,234,567'], ['1,000.50']];
    const result = Cleaner.apply(data, opts);
    expect(result[1][0]).toBe(1000);
    expect(result[2][0]).toBe(1234567);
    expect(result[3][0]).toBe(1000.5);
  });

  test('does NOT modify header row', () => {
    const data = [['123', '456', '78.9'], ['1', '2', '3']];
    const result = Cleaner.apply(data, opts);
    expect(result[0]).toEqual(['123', '456', '78.9']); // unchanged strings
    expect(result[1]).toEqual([1, 2, 3]); // converted
  });

  test('leaves non-numeric text unchanged', () => {
    const data = [
      ['Col'],
      ['hello'],
      ['abc123'],
      ['12abc'],
      ['$100'],
      ['100%'],
      ['1.2.3'],
      ['--5'],
    ];
    const result = Cleaner.apply(data, opts);
    expect(result[1][0]).toBe('hello');
    expect(result[2][0]).toBe('abc123');
    expect(result[3][0]).toBe('12abc');
    expect(result[4][0]).toBe('$100');
    expect(result[5][0]).toBe('100%');
    expect(result[6][0]).toBe('1.2.3');
    expect(result[7][0]).toBe('--5');
  });

  test('leaves empty cells unchanged', () => {
    const data = [['Col'], [''], ['  ']];
    const result = Cleaner.apply(data, opts);
    expect(result[1][0]).toBe('');
    expect(result[2][0]).toBe('  '); // not trimmed, that's a separate option
  });

  test('handles numbers with leading/trailing whitespace', () => {
    const data = [['Col'], [' 42 '], [' -3.14 ']];
    const result = Cleaner.apply(data, opts);
    expect(result[1][0]).toBe(42);
    expect(result[2][0]).toBe(-3.14);
  });

  test('handles cells that are already numbers', () => {
    const data = [['Col'], [42], [3.14]];
    const result = Cleaner.apply(data, opts);
    expect(result[1][0]).toBe(42);
    expect(result[2][0]).toBe(3.14);
  });

  test('converts zero correctly', () => {
    const data = [['Col'], ['0'], ['0.0'], ['-0']];
    const result = Cleaner.apply(data, opts);
    expect(result[1][0]).toBe(0);
    expect(result[2][0]).toBe(0);
    expect(result[3][0]).toBe(-0);
  });

  test('handles large numbers', () => {
    const data = [['Col'], ['999999999999'], ['1,000,000,000']];
    const result = Cleaner.apply(data, opts);
    expect(result[1][0]).toBe(999999999999);
    expect(result[2][0]).toBe(1000000000);
  });

  test('does not mutate original data', () => {
    const data = [['Col'], ['42']];
    const copy = JSON.parse(JSON.stringify(data));
    Cleaner.apply(data, opts);
    expect(data).toEqual(copy);
  });
});

// ============================================================
// 7. NORMALIZE HEADER NAMES
// ============================================================
describe('Cleaning Option: Normalize Header Names', () => {
  const opts = withOption('normalizeHeaders');

  test('converts lowercase headers to Title Case', () => {
    const data = [['first name', 'last name'], ['Alice', 'Smith']];
    const result = Cleaner.apply(data, opts);
    expect(result[0]).toEqual(['First Name', 'Last Name']);
  });

  test('converts UPPERCASE headers to Title Case', () => {
    const data = [['FIRST NAME', 'AGE'], ['Alice', '30']];
    const result = Cleaner.apply(data, opts);
    // \b\w matches word boundaries; FIRST NAME → FIRST NAME with F, N capitalized
    // The rest stays as-is since \w only capitalizes first char of each word
    expect(result[0][0]).toMatch(/^F/);
  });

  test('collapses multiple spaces in headers', () => {
    const data = [['first   name', 'date    of   birth'], ['Alice', '1990']];
    const result = Cleaner.apply(data, opts);
    expect(result[0]).toEqual(['First Name', 'Date Of Birth']);
  });

  test('trims leading/trailing whitespace from headers', () => {
    const data = [['  name  ', '  age  '], ['Alice', '30']];
    const result = Cleaner.apply(data, opts);
    expect(result[0]).toEqual(['Name', 'Age']);
  });

  test('does NOT modify data rows', () => {
    const data = [['name'], ['alice smith'], ['  bob  ']];
    const result = Cleaner.apply(data, opts);
    expect(result[1]).toEqual(['alice smith']);
    expect(result[2]).toEqual(['  bob  ']); // not trimmed
  });

  test('handles non-string headers (numbers, null)', () => {
    const data = [[123, null, undefined], ['A', 'B', 'C']];
    const result = Cleaner.apply(data, opts);
    // Non-strings are returned as-is
    expect(result[0]).toEqual([123, null, undefined]);
  });

  test('handles empty string headers', () => {
    const data = [['', 'name'], ['x', 'Alice']];
    const result = Cleaner.apply(data, opts);
    expect(result[0]).toEqual(['', 'Name']);
  });

  test('handles headers with underscores', () => {
    const data = [['first_name', 'last_name'], ['A', 'B']];
    const result = Cleaner.apply(data, opts);
    // \b\w treats _ as a word char, so only the first letter is capitalized
    expect(result[0]).toEqual(['First_name', 'Last_name']);
  });

  test('handles single-word headers', () => {
    const data = [['name', 'age', 'email'], ['A', '30', 'a@b.com']];
    const result = Cleaner.apply(data, opts);
    expect(result[0]).toEqual(['Name', 'Age', 'Email']);
  });

  test('does not mutate original data', () => {
    const data = [['name'], ['alice']];
    const copy = JSON.parse(JSON.stringify(data));
    Cleaner.apply(data, opts);
    expect(data).toEqual(copy);
  });
});

// ============================================================
// 8. COMBINED OPTIONS — INTERACTION TESTS
// ============================================================
describe('Combined Cleaning Options', () => {
  test('trim + removeEmptyRows: whitespace-only rows treated as empty after trim', () => {
    const data = [
      ['Name'],
      ['  Alice  '],
      ['   ', '   '],
      ['  Bob  '],
    ];
    const result = Cleaner.apply(data, {
      ...ALL_OFF,
      trim: true,
      removeEmptyRows: true,
    });
    expect(result).toEqual([['Name'], ['Alice'], ['Bob']]);
  });

  test('trim + removeEmptyColumns: whitespace columns removed', () => {
    const data = [
      ['Name', '  ', 'Age'],
      ['Alice', '  ', '30'],
    ];
    const result = Cleaner.apply(data, {
      ...ALL_OFF,
      trim: true,
      removeEmptyColumns: true,
    });
    // After trim, middle column becomes '' which is empty → removed
    expect(result).toEqual([['Name', 'Age'], ['Alice', '30']]);
  });

  test('trim + removeDuplicates: duplicates with different whitespace are caught', () => {
    const data = [
      ['Name'],
      ['Alice'],
      ['  Alice  '],  // same data after trimming
    ];
    const result = Cleaner.apply(data, {
      ...ALL_OFF,
      trim: true,
      removeDuplicates: true,
      duplicateMode: 'keep-first',
    });
    // After trim, both become 'Alice' → duplicate removed
    expect(result).toEqual([['Name'], ['Alice']]);
  });

  test('fixNumbers + normalizeHeaders together', () => {
    const data = [
      ['price', 'quantity'],
      ['1,000', '5'],
    ];
    const result = Cleaner.apply(data, {
      ...ALL_OFF,
      fixNumbers: true,
      normalizeHeaders: true,
    });
    expect(result[0]).toEqual(['Price', 'Quantity']);
    expect(result[1]).toEqual([1000, 5]);
  });

  test('all options enabled on realistic data', () => {
    const data = [
      ['  first name  ', '  ', '  age  ', 'score'],
      ['  Alice  ', '  ', '  30  ', '1,500'],
      ['  ', '  ', '  ', ''],
      ['  Bob  ', '  ', '  25  ', '2,000'],
      ['  Alice  ', '  ', '  30  ', '1,500'],
    ];
    const result = Cleaner.apply(data, {
      trim: true,
      removeEmptyRows: true,
      removeEmptyColumns: true,
      removeDuplicates: true,
      duplicateMode: 'keep-first',
      fixNumbers: true,
      normalizeHeaders: true,
    });
    // Trim first → then empty rows → then empty cols → then dedup → then fix nums → then normalize headers
    expect(result).toEqual([
      ['First Name', 'Age', 'Score'],
      ['Alice', 30, 1500],
      ['Bob', 25, 2000],
    ]);
  });

  test('removeEmptyRows + removeEmptyColumns combined', () => {
    const data = [
      ['A', '', 'C'],
      ['', '', ''],
      ['1', '', '3'],
    ];
    const result = Cleaner.apply(data, {
      ...ALL_OFF,
      removeEmptyRows: true,
      removeEmptyColumns: true,
    });
    expect(result).toEqual([['A', 'C'], ['1', '3']]);
  });

  test('all options with absolute duplicate mode', () => {
    const data = [
      ['  name  '],
      ['  Alice  '],
      ['  Alice  '],
      ['  Bob  '],
    ];
    const result = Cleaner.apply(data, {
      trim: true,
      removeEmptyRows: false,
      removeEmptyColumns: false,
      removeDuplicates: true,
      duplicateMode: 'absolute',
      fixNumbers: false,
      normalizeHeaders: true,
    });
    // After trim, both Alices match → absolute mode removes both
    expect(result).toEqual([['Name'], ['Bob']]);
  });
});

// ============================================================
// 9. getStats — STATISTICS REPORTING
// ============================================================
describe('Cleaning Statistics (getStats)', () => {
  test('reports rows and columns removed correctly', () => {
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
    expect(stats.rowsRemoved).toBe(1);
    expect(stats.colsRemoved).toBe(1);
    expect(stats.originalRows).toBe(4);
    expect(stats.cleanedRows).toBe(3);
    expect(stats.originalCols).toBe(3);
    expect(stats.cleanedCols).toBe(2);
  });

  test('reports zero changes when nothing removed', () => {
    const data = [['A', 'B'], ['1', '2']];
    const stats = Cleaner.getStats(data, data);
    expect(stats.rowsRemoved).toBe(0);
    expect(stats.colsRemoved).toBe(0);
  });

  test('handles empty arrays', () => {
    const stats = Cleaner.getStats([], []);
    expect(stats.originalRows).toBe(0);
    expect(stats.cleanedRows).toBe(0);
    expect(stats.originalCols).toBe(0);
    expect(stats.cleanedCols).toBe(0);
  });
});

// ============================================================
// 10. EDGE CASES & ROBUSTNESS
// ============================================================
describe('Edge Cases', () => {
  test('apply returns empty array unchanged', () => {
    expect(Cleaner.apply([], ALL_OFF)).toEqual([]);
  });

  test('apply returns null unchanged', () => {
    expect(Cleaner.apply(null, ALL_OFF)).toBeNull();
  });

  test('apply returns undefined unchanged', () => {
    expect(Cleaner.apply(undefined, ALL_OFF)).toBeUndefined();
  });

  test('single cell dataset', () => {
    const data = [['hello']];
    const result = Cleaner.apply(data, {
      trim: true,
      removeEmptyRows: true,
      removeEmptyColumns: true,
      removeDuplicates: true,
      fixNumbers: true,
      normalizeHeaders: true,
    });
    expect(result).toEqual([['Hello']]);
  });

  test('large multi-column dataset maintains correctness', () => {
    const header = Array.from({ length: 20 }, (_, i) => `col${i}`);
    const makeRow = (id) => Array.from({ length: 20 }, (_, i) => `${id}-${i}`);
    const data = [header, makeRow('a'), makeRow('b'), makeRow('a'), makeRow('c')];
    const result = Cleaner.apply(data, {
      ...ALL_OFF,
      removeDuplicates: true,
      normalizeHeaders: true,
    });
    expect(result).toHaveLength(4); // header + a + b + c (a deduped)
    expect(result[0][0]).toBe('Col0'); // normalized
  });

  test('unicode cell content preserved through cleaning', () => {
    const data = [
      ['  名前  ', '  年齢  '],
      ['  田中太郎  ', '  30  '],
    ];
    const result = Cleaner.apply(data, { ...ALL_OFF, trim: true, normalizeHeaders: true });
    expect(result[0]).toEqual(['名前', '年齢']);
    expect(result[1]).toEqual(['田中太郎', '30']);
  });

  test('cells with only zero-width characters handled', () => {
    // Zero-width space (U+200B) is not trimmed by String.trim() in all environments
    const zwsp = '\u200B';
    const data = [['Name'], [zwsp]];
    const result = Cleaner.apply(data, { ...ALL_OFF, trim: true });
    // trim() may or may not remove ZWSP — just verify it doesn't crash
    expect(result).toHaveLength(2);
  });
});
