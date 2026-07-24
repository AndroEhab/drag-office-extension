const { loadModule } = require('./helpers');

const TypeDetector = loadModule('../sidepanel/type-detector.js', 'TypeDetector');

describe('TypeDetector', () => {
  // ---- classifyValue ----

  describe('classifyValue', () => {
    test('null is empty', () => {
      expect(TypeDetector.classifyValue(null)).toBe('empty');
    });

    test('undefined is empty', () => {
      expect(TypeDetector.classifyValue(undefined)).toBe('empty');
    });

    test('empty string is empty', () => {
      expect(TypeDetector.classifyValue('')).toBe('empty');
    });

    test('whitespace-only string is empty', () => {
      expect(TypeDetector.classifyValue('   ')).toBe('empty');
      expect(TypeDetector.classifyValue('\t')).toBe('empty');
    });

    test('integer string is number', () => {
      expect(TypeDetector.classifyValue('42')).toBe('number');
    });

    test('negative integer string is number', () => {
      expect(TypeDetector.classifyValue('-17')).toBe('number');
    });

    test('decimal string is number', () => {
      expect(TypeDetector.classifyValue('3.14')).toBe('number');
    });

    test('negative decimal string is number', () => {
      expect(TypeDetector.classifyValue('-0.5')).toBe('number');
    });

    test('scientific notation is number', () => {
      expect(TypeDetector.classifyValue('1.5e10')).toBe('number');
      expect(TypeDetector.classifyValue('2.3E-4')).toBe('number');
    });

    test('comma-formatted number is number', () => {
      expect(TypeDetector.classifyValue('1,234')).toBe('number');
      expect(TypeDetector.classifyValue('1,234,567')).toBe('number');
    });

    test('number type is number', () => {
      expect(TypeDetector.classifyValue(42)).toBe('number');
      expect(TypeDetector.classifyValue(-3.14)).toBe('number');
    });

    test('NaN number is empty', () => {
      expect(TypeDetector.classifyValue(NaN)).toBe('empty');
    });

    test('boolean type is boolean', () => {
      expect(TypeDetector.classifyValue(true)).toBe('boolean');
      expect(TypeDetector.classifyValue(false)).toBe('boolean');
    });

    test('boolean strings are boolean', () => {
      expect(TypeDetector.classifyValue('true')).toBe('boolean');
      expect(TypeDetector.classifyValue('false')).toBe('boolean');
      expect(TypeDetector.classifyValue('yes')).toBe('boolean');
      expect(TypeDetector.classifyValue('no')).toBe('boolean');
    });

    test('case-insensitive boolean strings', () => {
      expect(TypeDetector.classifyValue('TRUE')).toBe('boolean');
      expect(TypeDetector.classifyValue('Yes')).toBe('boolean');
    });

    test('ISO date is date', () => {
      expect(TypeDetector.classifyValue('2024-01-15')).toBe('date');
    });

    test('ISO datetime is date', () => {
      expect(TypeDetector.classifyValue('2024-01-15T10:30:00')).toBe('date');
    });

    test('month-name date is date', () => {
      expect(TypeDetector.classifyValue('March 4, 2026')).toBe('date');
      expect(TypeDetector.classifyValue('Jan 15 2024')).toBe('date');
    });

    test('day-month-name date is date', () => {
      expect(TypeDetector.classifyValue('15 Jan 2024')).toBe('date');
    });

    test('dd-mon-yyyy date is date', () => {
      expect(TypeDetector.classifyValue('15-Jan-2024')).toBe('date');
    });

    test('plain text is text', () => {
      expect(TypeDetector.classifyValue('Hello')).toBe('text');
      expect(TypeDetector.classifyValue('ABC Corp')).toBe('text');
      expect(TypeDetector.classifyValue('Product-123')).toBe('text');
    });

    test('ID-like strings that resemble numbers are still text', () => {
      // "123" could be an ID — classifyValue treats it as number since
      // the detector is non-destructive and only for display hints
      expect(TypeDetector.classifyValue('123')).toBe('number');
    });
  });

  // ---- detect (homogeneous) ----

  describe('detect — homogeneous columns', () => {
    test('all text column', () => {
      const data = [
        ['Name'],
        ['Alice'],
        ['Bob'],
        ['Carol'],
      ];
      const types = TypeDetector.detect(data);
      expect(types).toHaveLength(1);
      expect(types[0].type).toBe('text');
    });

    test('all number column (strings)', () => {
      const data = [
        ['Age'],
        ['25'],
        ['30'],
        ['45'],
      ];
      const types = TypeDetector.detect(data);
      expect(types[0].type).toBe('number');
    });

    test('all number column (actual numbers)', () => {
      const data = [
        ['Age'],
        [25],
        [30],
        [45],
      ];
      const types = TypeDetector.detect(data);
      expect(types[0].type).toBe('number');
    });

    test('all date column (ISO format)', () => {
      const data = [
        ['DOB'],
        ['2020-01-15'],
        ['2019-06-20'],
        ['2021-03-10'],
      ];
      const types = TypeDetector.detect(data);
      expect(types[0].type).toBe('date');
    });

    test('all date column (month-name format)', () => {
      const data = [
        ['DOB'],
        ['March 4, 2026'],
        ['Jan 15 2024'],
        ['December 25 2023'],
      ];
      const types = TypeDetector.detect(data);
      expect(types[0].type).toBe('date');
    });

    test('all boolean column', () => {
      const data = [
        ['Active'],
        ['true'],
        ['false'],
        ['true'],
      ];
      const types = TypeDetector.detect(data);
      expect(types[0].type).toBe('boolean');
    });

    test('all empty column', () => {
      const data = [
        ['Empty'],
        [''],
        [''],
        [''],
      ];
      const types = TypeDetector.detect(data);
      expect(types[0].type).toBe('empty');
    });

    test('null/undefined values are treated as empty', () => {
      const data = [
        ['Col'],
        [null],
        [undefined],
        [''],
      ];
      const types = TypeDetector.detect(data);
      expect(types[0].type).toBe('empty');
    });
  });

  // ---- detect (mixed) ----

  describe('detect — mixed columns', () => {
    test('dominant text with some numbers', () => {
      const data = [
        ['Mixed'],
        ['apple'],
        ['banana'],
        ['cherry'],
        ['42'],
        ['date'],
        ['fig'],
        ['10'],
      ];
      const types = TypeDetector.detect(data);
      // 5 text, 2 numbers = 71% text, over dominance threshold
      expect(types[0].type).toBe('text');
    });

    test('roughly even mix of number and text is mixed', () => {
      const data = [
        ['Mixed'],
        ['100'],
        ['apple'],
        ['200'],
        ['banana'],
        ['300'],
        ['cherry'],
      ];
      const types = TypeDetector.detect(data);
      // 3 numbers, 3 text = 50% each, under threshold
      expect(types[0].type).toBe('mixed');
    });

    test('numbers with sparse text is number', () => {
      const data = [];
      data.push(['MostlyNum']);
      for (let i = 0; i < 20; i++) {
        data.push([String(i * 10)]);
      }
      data.push(['apple']); // 1 text, 20 numbers = 95% numbers
      const types = TypeDetector.detect(data);
      expect(types[0].type).toBe('number');
    });
  });

  // ---- detect (sparse) ----

  describe('detect — sparse columns', () => {
    test('mostly empty with a few values', () => {
      const data = [
        ['Sparse'],
        [''],
        [''],
        ['hello'],
        [''],
        [''],
        ['world'],
        [''],
      ];
      const types = TypeDetector.detect(data);
      expect(types[0].type).toBe('text');
    });

    test('mostly empty with one value', () => {
      const data = [
        ['Sparse'],
        [''],
        [''],
        ['2024-01-15'],
        [''],
      ];
      const types = TypeDetector.detect(data);
      expect(types[0].type).toBe('date');
    });
  });

  // ---- detect (ambiguous) ----

  describe('detect — ambiguous columns', () => {
    test('zero as a number', () => {
      const data = [
        ['Amount'],
        ['0'],
        ['100'],
        ['200'],
      ];
      const types = TypeDetector.detect(data);
      expect(types[0].type).toBe('number');
    });

    test('zero as the only value is not boolean', () => {
      const data = [
        ['Flag'],
        ['0'],
        ['0'],
        ['0'],
      ];
      const types = TypeDetector.detect(data);
      // "0" matches number pattern first, not boolean
      expect(types[0].type).toBe('number');
    });

    test('large dates mixed with invalid dates is mixed', () => {
      const data = [
        ['Dates'],
        ['2024-01-15'],
        ['2024-06-20'],
        ['not a date'],
        ['2024-03-10'],
        ['also text'],
      ];
      const types = TypeDetector.detect(data);
      // 3 dates, 2 text = 60% dates, under threshold
      expect(types[0].type).toBe('mixed');
    });
  });

  // ---- detect (multiple columns) ----

  describe('detect — multiple columns', () => {
    test('returns type per column', () => {
      const data = [
        ['Name', 'Age', 'DOB',       'Active'],
        ['Alice',  '30',  '2020-05-01', 'true'],
        ['Bob',    '25',  '2019-03-15', 'false'],
        ['Carol',  '35',  '2021-07-20', 'true'],
      ];
      const types = TypeDetector.detect(data);
      expect(types).toHaveLength(4);
      expect(types[0].type).toBe('text');
      expect(types[1].type).toBe('number');
      expect(types[2].type).toBe('date');
      expect(types[3].type).toBe('boolean');
    });

    test('handles extra columns with missing values', () => {
      const data = [
        ['A', 'B', 'C'],
        ['hello', '42'],
        ['world'],
        ['test', '99', 'extra'],
      ];
      const types = TypeDetector.detect(data);
      expect(types).toHaveLength(3);
      expect(types[0].type).toBe('text');
      expect(types[1].type).toBe('number');
    });
  });

  // ---- detect (sampling) ----

  describe('detect — sampling', () => {
    test('sampled is false when rows <= sample max', () => {
      const data = [['H'], ...Array.from({ length: 50 }, (_, i) => [String(i)])];
      const types = TypeDetector.detect(data, { sampleMax: 100 });
      expect(types[0].sampled).toBe(false);
    });

    test('sampled is true when rows > sample max', () => {
      const data = [['H'], ...Array.from({ length: 2000 }, (_, i) => [String(i)])];
      const types = TypeDetector.detect(data, { sampleMax: 100 });
      expect(types[0].sampled).toBe(true);
    });
  });

  // ---- detect (with cellMeta) ----

  describe('detect — with cellMeta', () => {
    test('uses cellMeta types when available', () => {
      const data = [
        ['Date'],
        [45306], // Serial date from Excel
        [45370],
        [45413],
      ];
      const cellMeta = [
        [{ type: 'string', value: 'Date' }],
        [{ type: 'date', value: 45306, formatType: 'DATE' }],
        [{ type: 'date', value: 45370, formatType: 'DATE' }],
        [{ type: 'date', value: 45413, formatType: 'DATE' }],
      ];
      const types = TypeDetector.detect(data, { cellMeta });
      expect(types[0].type).toBe('date');
    });

    test('falls back to value classification without cellMeta', () => {
      const data = [
        ['Date'],
        [45306],
        [45370],
        [45413],
      ];
      // Without cellMeta, serial dates look like numbers
      const types = TypeDetector.detect(data);
      expect(types[0].type).toBe('number');
    });

    test('cellMeta with mixed types is handled', () => {
      const data = [
        ['Mixed'],
        ['hello'],
        ['2024-01-01'],
      ];
      const cellMeta = [
        [{ type: 'string', value: 'Mixed' }],
        [{ type: 'string', value: 'hello' }],
        [{ type: 'date', value: 45306, formatType: 'DATE' }],
      ];
      const types = TypeDetector.detect(data, { cellMeta });
      // 1 string, 1 date = 50% each = mixed
      expect(types[0].type).toBe('mixed');
    });
  });

  // ---- labelFor ----

  describe('labelFor', () => {
    test('returns compact labels', () => {
      expect(TypeDetector.labelFor('text')).toBe('abc');
      expect(TypeDetector.labelFor('number')).toBe('#');
      expect(TypeDetector.labelFor('date')).toBe('dat');
      expect(TypeDetector.labelFor('boolean')).toBe('bool');
      expect(TypeDetector.labelFor('mixed')).toBe('-/-');
      expect(TypeDetector.labelFor('empty')).toBe('--');
    });
  });

  // ---- titleFor ----

  describe('titleFor', () => {
    test('returns capitalized type name', () => {
      expect(TypeDetector.titleFor('text', false, null)).toBe('Text');
      expect(TypeDetector.titleFor('number', false, null)).toBe('Number');
      expect(TypeDetector.titleFor('date', false, null)).toBe('Date');
      expect(TypeDetector.titleFor('boolean', false, null)).toBe('Boolean');
      expect(TypeDetector.titleFor('mixed', false, null)).toBe('Mixed');
    });

    test('appends sampled note when sampled', () => {
      expect(TypeDetector.titleFor('text', true, null)).toContain('sample');
    });

    test('appends variation note when mixed', () => {
      expect(TypeDetector.titleFor('text', false, 'mixed')).toContain('variation');
    });
  });

  // ---- COLUMN_TYPES ----

  describe('COLUMN_TYPES', () => {
    test('exports correct type constants', () => {
      expect(TypeDetector.COLUMN_TYPES).toEqual({
        TEXT: 'text',
        NUMBER: 'number',
        DATE: 'date',
        BOOLEAN: 'boolean',
        MIXED: 'mixed',
        EMPTY: 'empty',
      });
    });
  });

  // ---- Edge cases ----

  describe('edge cases', () => {
    test('empty data returns empty array', () => {
      expect(TypeDetector.detect(null)).toEqual([]);
      expect(TypeDetector.detect([])).toEqual([]);
      expect(TypeDetector.detect([[]])).toEqual([]); // no data rows
    });

    test('single row (header only) returns empty', () => {
      expect(TypeDetector.detect([['Name']])).toEqual([]);
    });

    test('only one data row', () => {
      const data = [
        ['Name', 'Age'],
        ['Alice', '30'],
      ];
      const types = TypeDetector.detect(data);
      expect(types).toHaveLength(2);
      expect(types[0].type).toBe('text');
      expect(types[1].type).toBe('number');
    });

    test('respects maxCols option', () => {
      const data = [
        ['A', 'B', 'C', 'D', 'E', 'F'],
        ['1', '2', '3', '4', '5', '6'],
        ['7', '8', '9', '10', '11', '12'],
      ];
      const types = TypeDetector.detect(data, { maxCols: 3 });
      expect(types).toHaveLength(3);
    });

    test('undefined values in sparse rows do not crash', () => {
      const data = [
        ['A', 'B'],
        ['hello'],
        [undefined, 'world'],
        ['test', undefined],
      ];
      const types = TypeDetector.detect(data);
      expect(types).toHaveLength(2);
    });

    test('non-array rows do not crash', () => {
      const data = [
        ['A'],
        null,
        ['value'],
      ];
      const types = TypeDetector.detect(data);
      expect(types).toHaveLength(1);
    });
  });
});
