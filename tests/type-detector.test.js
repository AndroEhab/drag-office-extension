const { loadModule } = require('./helpers');

const Cleaner = loadModule('../sidepanel/cleaner.js', 'Cleaner');
const TypeDetector = loadModule('../sidepanel/type-detector.js', 'TypeDetector');

describe('TypeDetector', () => {
  // ---- classifyValue: null/empty ----

  describe('classifyValue', () => {
    test('null is empty', () => {
      expect(TypeDetector.classifyValue(null, Cleaner.parseDateToken)).toBe('empty');
    });

    test('undefined is empty', () => {
      expect(TypeDetector.classifyValue(undefined, Cleaner.parseDateToken)).toBe('empty');
    });

    test('empty string is empty', () => {
      expect(TypeDetector.classifyValue('', Cleaner.parseDateToken)).toBe('empty');
    });

    test('whitespace-only string is empty', () => {
      expect(TypeDetector.classifyValue('   ', Cleaner.parseDateToken)).toBe('empty');
    });

    // ---- classifyValue: numbers ----

    test('integer string is number', () => {
      expect(TypeDetector.classifyValue('42', Cleaner.parseDateToken)).toBe('number');
    });

    test('negative integer string is number', () => {
      expect(TypeDetector.classifyValue('-17', Cleaner.parseDateToken)).toBe('number');
    });

    test('decimal string is number', () => {
      expect(TypeDetector.classifyValue('3.14', Cleaner.parseDateToken)).toBe('number');
    });

    test('scientific notation is number', () => {
      expect(TypeDetector.classifyValue('1.5e10', Cleaner.parseDateToken)).toBe('number');
      expect(TypeDetector.classifyValue('2.3E-4', Cleaner.parseDateToken)).toBe('number');
    });

    test('comma-formatted number is number', () => {
      expect(TypeDetector.classifyValue('1,234', Cleaner.parseDateToken)).toBe('number');
    });

    test('actual number type is number', () => {
      expect(TypeDetector.classifyValue(42, Cleaner.parseDateToken)).toBe('number');
    });

    test('NaN number is empty', () => {
      expect(TypeDetector.classifyValue(NaN, Cleaner.parseDateToken)).toBe('empty');
    });

    // ---- leading-zero identifiers preserved as text ----

    test('leading-zero identifier is text', () => {
      expect(TypeDetector.classifyValue('00123', Cleaner.parseDateToken)).toBe('text');
    });

    test('long leading-zero identifier is text', () => {
      expect(TypeDetector.classifyValue('00004567', Cleaner.parseDateToken)).toBe('text');
    });

    test('comma-separated leading-zero is text after cleaning', () => {
      // "0,012,345" → cleanedNum = "0012345" → starts with 0, length > 1 → text
      expect(TypeDetector.classifyValue('0,012,345', Cleaner.parseDateToken)).toBe('text');
    });

    test('single zero is number', () => {
      expect(TypeDetector.classifyValue('0', Cleaner.parseDateToken)).toBe('number');
    });

    test('negative seven is number', () => {
      expect(TypeDetector.classifyValue('-7', Cleaner.parseDateToken)).toBe('number');
    });

    test('plain comma number is number', () => {
      expect(TypeDetector.classifyValue('1,234', Cleaner.parseDateToken)).toBe('number');
    });

    test('decimal is number', () => {
      expect(TypeDetector.classifyValue('0.5', Cleaner.parseDateToken)).toBe('number');
      expect(TypeDetector.classifyValue('-0.25', Cleaner.parseDateToken)).toBe('number');
    });

    // ---- booleans ----

    test('boolean type is boolean', () => {
      expect(TypeDetector.classifyValue(true, Cleaner.parseDateToken)).toBe('boolean');
    });

    test('boolean strings are boolean', () => {
      expect(TypeDetector.classifyValue('true', Cleaner.parseDateToken)).toBe('boolean');
      expect(TypeDetector.classifyValue('false', Cleaner.parseDateToken)).toBe('boolean');
      expect(TypeDetector.classifyValue('yes', Cleaner.parseDateToken)).toBe('boolean');
      expect(TypeDetector.classifyValue('no', Cleaner.parseDateToken)).toBe('boolean');
    });

    // ---- dates: reuses Cleaner.parseDateToken ----

    test('ISO date is date', () => {
      expect(TypeDetector.classifyValue('2024-01-15', Cleaner.parseDateToken)).toBe('date');
    });

    test('ISO datetime is date', () => {
      expect(TypeDetector.classifyValue('2024-01-15T10:30:00', Cleaner.parseDateToken)).toBe('date');
    });

    test('month-name date is date', () => {
      expect(TypeDetector.classifyValue('March 4, 2026', Cleaner.parseDateToken)).toBe('date');
    });

    // ---- invalid dates are text ----

    test('invalid month date is text (2026-99-99)', () => {
      expect(TypeDetector.classifyValue('2026-99-99', Cleaner.parseDateToken)).toBe('text');
    });

    test('invalid calendar date is text (2026-02-30)', () => {
      expect(TypeDetector.classifyValue('2026-02-30', Cleaner.parseDateToken)).toBe('text');
    });

    test('invalid hour is text (24:30:00)', () => {
      expect(TypeDetector.classifyValue('2026-03-04T24:30:00', Cleaner.parseDateToken)).toBe('text');
    });

    test('invalid minute is text (12:60:00)', () => {
      expect(TypeDetector.classifyValue('2026-03-04T12:60:00', Cleaner.parseDateToken)).toBe('text');
    });

    test('trailing junk is text', () => {
      expect(TypeDetector.classifyValue('2026-03-04T12:30junk', Cleaner.parseDateToken)).toBe('text');
    });

    test('invalid timezone offset is text (+15:00)', () => {
      expect(TypeDetector.classifyValue('2026-03-04T12:30:00+15:00', Cleaner.parseDateToken)).toBe('text');
    });

    test('slash-separated date is text (ambiguous)', () => {
      expect(TypeDetector.classifyValue('03/04/2026', Cleaner.parseDateToken)).toBe('text');
    });

    test('dot-separated date is text (ambiguous)', () => {
      expect(TypeDetector.classifyValue('03.04.2026', Cleaner.parseDateToken)).toBe('text');
    });

    // ---- plain text ----

    test('plain text is text', () => {
      expect(TypeDetector.classifyValue('Hello', Cleaner.parseDateToken)).toBe('text');
    });
  });

  // ---- isLeadingZeroIdentifier ----

  describe('isLeadingZeroIdentifier', () => {
    test('00123 is an identifier', () => {
      expect(TypeDetector.isLeadingZeroIdentifier('00123')).toBe(true);
    });

    test('00004567 is an identifier', () => {
      expect(TypeDetector.isLeadingZeroIdentifier('00004567')).toBe(true);
    });

    test('0 is not an identifier (single char)', () => {
      expect(TypeDetector.isLeadingZeroIdentifier('0')).toBe(false);
    });

    test('0.5 is not an identifier (decimal)', () => {
      expect(TypeDetector.isLeadingZeroIdentifier('0.5')).toBe(false);
    });

    test('42 is not an identifier', () => {
      expect(TypeDetector.isLeadingZeroIdentifier('42')).toBe(false);
    });
  });

  // ---- detect: homogeneous ----

  describe('detect — homogeneous columns', () => {
    test('all text column', () => {
      const data = [['Name'], ['Alice'], ['Bob'], ['Carol']];
      const types = TypeDetector.detect(data, { parseDateToken: Cleaner.parseDateToken });
      expect(types).toHaveLength(1);
      expect(types[0].type).toBe('text');
    });

    test('all number column (strings)', () => {
      const data = [['Age'], ['25'], ['30'], ['45']];
      const types = TypeDetector.detect(data, { parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('number');
    });

    test('all number column (actual numbers)', () => {
      const data = [['Age'], [25], [30], [45]];
      const types = TypeDetector.detect(data, { parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('number');
    });

    test('all boolean column', () => {
      const data = [['Active'], ['true'], ['false'], ['true']];
      const types = TypeDetector.detect(data, { parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('boolean');
    });

    test('all empty column', () => {
      const data = [['Empty'], [''], [''], ['']];
      const types = TypeDetector.detect(data, { parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('empty');
    });

    test('leading-zero identifiers render as text', () => {
      const data = [['SKU'], ['00123'], ['00456'], ['00789']];
      const types = TypeDetector.detect(data, { parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('text');
    });
  });

  // ---- detect: mixed ----

  describe('detect — mixed columns', () => {
    test('dominant text with some numbers', () => {
      const data = [
        ['Mixed'], ['apple'], ['banana'], ['cherry'], ['42'], ['date'], ['fig'], ['10'],
      ];
      const types = TypeDetector.detect(data, { parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('text');
    });

    test('roughly even mix is mixed', () => {
      const data = [
        ['Mixed'], ['100'], ['apple'], ['200'], ['banana'], ['300'], ['cherry'],
      ];
      const types = TypeDetector.detect(data, { parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('mixed');
    });

    test('numbers with sparse text is number', () => {
      const data = [['MostlyNum']];
      for (let i = 0; i < 20; i++) data.push([String(i * 10)]);
      data.push(['apple']);
      const types = TypeDetector.detect(data, { parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('number');
    });
  });

  // ---- detect: sparse ----

  describe('detect — sparse columns', () => {
    test('mostly empty with a few values', () => {
      const data = [['Sparse'], [''], [''], ['hello'], [''], [''], ['world'], ['']];
      const types = TypeDetector.detect(data, { parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('text');
    });
  });

  // ---- detect: sampling ----

  describe('detect — sampling', () => {
    test('sampled is false when rows <= sampleMax and source not sampled', () => {
      const data = [['H'], ...Array.from({ length: 50 }, (_, i) => [String(i)])];
      const types = TypeDetector.detect(data, { sampleMax: 100, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].sampled).toBe(false);
    });

    test('sampled is true when rows > sampleMax', () => {
      const data = [['H'], ...Array.from({ length: 2000 }, (_, i) => [String(i)])];
      const types = TypeDetector.detect(data, { sampleMax: 100, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].sampled).toBe(true);
    });

    test('sourceSampled forces sampled=true even for small data', () => {
      const data = [['H'], ['a'], ['b'], ['c']];
      const types = TypeDetector.detect(data, {
        sampleMax: 100,
        sourceSampled: true,
        parseDateToken: Cleaner.parseDateToken,
      });
      expect(types[0].sampled).toBe(true);
    });

    test('evenly distributed sampling covers both halves', () => {
      // First 50 rows numeric, next 50 rows text, sampleMax=10
      const data = [['MixedCol']];
      for (let i = 0; i < 50; i++) data.push([String(i * 10)]);
      for (let i = 0; i < 50; i++) data.push(['text_' + i]);
      // Even sampling should pick from both halves -> mixed
      const types = TypeDetector.detect(data, { sampleMax: 10, parseDateToken: Cleaner.parseDateToken });
      // With even distribution across 100 rows, 10 samples will span both halves
      expect(types[0].type).toBe('mixed');
    });
  });

  // ---- detect: with cellMeta ----

  describe('detect — with cellMeta', () => {
    test('uses cellMeta types when available', () => {
      const data = [
        ['Date'], [45306], [45370], [45413],
      ];
      const cellMeta = [
        [{ type: 'string', value: 'Date' }],
        [{ type: 'date', value: 45306, formatType: 'DATE' }],
        [{ type: 'date', value: 45370, formatType: 'DATE' }],
        [{ type: 'date', value: 45413, formatType: 'DATE' }],
      ];
      const types = TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('date');
    });

    test('formula tokens are classified as text', () => {
      const data = [
        ['Formulas'], ['=A1+B1'], ['=SUM(C:C)'],
      ];
      const cellMeta = [
        [{ type: 'string', value: 'Formulas' }],
        [{ type: 'formula', value: 'A1+B1' }],
        [{ type: 'formula', value: 'SUM(C:C)' }],
      ];
      const types = TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('text');
    });

    test('partial metadata does not discard valid columns', () => {
      const data = [
        ['Names'], ['Alice'], ['Bob'], ['Carol'],
      ];
      // Missing metadata for row 2 — should still use tokens for rows that have them
      const cellMeta = [
        [{ type: 'string', value: 'Names' }],
        null, // ragged — no metadata for this row
        [{ type: 'string', value: 'Bob' }],
        [{ type: 'string', value: 'Carol' }],
      ];
      const types = TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('text');
    });

    test('metadata array shorter than data does not crash', () => {
      const data = [['A'], [1], [2], [3], [4]];
      const cellMeta = [
        [{ type: 'string', value: 'A' }],
        [{ type: 'number', value: 1 }],
      ];
      const types = TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('number');
    });

    test('mixed metadata with value fallback', () => {
      const data = [
        ['Mixed'], ['hello'], ['2024-01-01'], ['world'],
      ];
      // Only row 1 has metadata as a string
      const cellMeta = [
        [{ type: 'string', value: 'Mixed' }],
        [{ type: 'string', value: 'hello' }],
        // Row 2 has no metadata — falls back to value classification (date)
      ];
      const types = TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      // 1 text (from meta), 1 date (from value), 1 text (from value) → mixed
      expect(types[0].type).toBe('mixed');
    });
  });

  // ---- detect: edge cases ----

  describe('detect — edge cases', () => {
    test('empty data returns empty array', () => {
      expect(TypeDetector.detect(null)).toEqual([]);
      expect(TypeDetector.detect([])).toEqual([]);
      expect(TypeDetector.detect([[]])).toEqual([]);
    });

    test('single row (header only) returns empty', () => {
      expect(TypeDetector.detect([['Name']])).toEqual([]);
    });

    test('respects maxCols option', () => {
      const data = [
        ['A', 'B', 'C', 'D', 'E', 'F'],
        ['1', '2', '3', '4', '5', '6'],
        ['7', '8', '9', '10', '11', '12'],
      ];
      const types = TypeDetector.detect(data, { maxCols: 3, parseDateToken: Cleaner.parseDateToken });
      expect(types).toHaveLength(3);
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

  // ---- descriptionFor ----

  describe('descriptionFor', () => {
    test('returns full type descriptions', () => {
      expect(TypeDetector.descriptionFor('text', false)).toBe('Text');
      expect(TypeDetector.descriptionFor('number', false)).toBe('Number');
      expect(TypeDetector.descriptionFor('date', false)).toBe('Date');
      expect(TypeDetector.descriptionFor('boolean', false)).toBe('Boolean');
      expect(TypeDetector.descriptionFor('mixed', false)).toBe('Mixed');
      expect(TypeDetector.descriptionFor('empty', false)).toBe('Empty');
    });

    test('appends sampled note', () => {
      expect(TypeDetector.descriptionFor('text', true)).toBe('Text, based on a sample');
    });
  });

  // ---- titleFor ----

  describe('titleFor', () => {
    test('returns tooltip with detected type prefix', () => {
      expect(TypeDetector.titleFor('text', false, null)).toBe('Detected type: Text');
    });

    test('appends sampled note when sampled', () => {
      expect(TypeDetector.titleFor('text', true, null)).toContain('based on a sample');
    });
  });

  // ---- no mutation ----

  describe('non-destructive guarantee', () => {
    test('detect does not mutate input data', () => {
      const data = [['A'], ['1'], ['2'], ['3']];
      const copy = JSON.parse(JSON.stringify(data));
      TypeDetector.detect(data, { parseDateToken: Cleaner.parseDateToken });
      expect(data).toEqual(copy);
    });

    test('detect does not mutate cellMeta', () => {
      const data = [['A'], ['a']];
      const cellMeta = [[{ type: 'string', value: 'A' }], [{ type: 'string', value: 'a' }]];
      const copy = JSON.parse(JSON.stringify(cellMeta));
      TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      expect(cellMeta).toEqual(copy);
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
});
