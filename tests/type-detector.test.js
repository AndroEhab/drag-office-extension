const { loadModule } = require('./helpers');

const Cleaner = loadModule('../sidepanel/cleaner.js', 'Cleaner');
const TypeDetector = loadModule('../sidepanel/type-detector.js', 'TypeDetector');

describe('TypeDetector', () => {
  // ---- classifyValue ----

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

    // numbers
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

    // leading-zero identifiers
    test('leading-zero identifier is text', () => {
      expect(TypeDetector.classifyValue('00123', Cleaner.parseDateToken)).toBe('text');
    });
    test('long leading-zero identifier is text', () => {
      expect(TypeDetector.classifyValue('00004567', Cleaner.parseDateToken)).toBe('text');
    });
    test('comma-separated leading-zero is text after cleaning', () => {
      expect(TypeDetector.classifyValue('0,012,345', Cleaner.parseDateToken)).toBe('text');
    });
    test('single zero is number', () => {
      expect(TypeDetector.classifyValue('0', Cleaner.parseDateToken)).toBe('number');
    });
    test('decimal is number', () => {
      expect(TypeDetector.classifyValue('0.5', Cleaner.parseDateToken)).toBe('number');
    });
    test('-0.25 is number', () => {
      expect(TypeDetector.classifyValue('-0.25', Cleaner.parseDateToken)).toBe('number');
    });

    // booleans
    test('boolean type is boolean', () => {
      expect(TypeDetector.classifyValue(true, Cleaner.parseDateToken)).toBe('boolean');
    });
    test('boolean strings are boolean', () => {
      expect(TypeDetector.classifyValue('true', Cleaner.parseDateToken)).toBe('boolean');
      expect(TypeDetector.classifyValue('false', Cleaner.parseDateToken)).toBe('boolean');
      expect(TypeDetector.classifyValue('yes', Cleaner.parseDateToken)).toBe('boolean');
      expect(TypeDetector.classifyValue('no', Cleaner.parseDateToken)).toBe('boolean');
    });

    // dates
    test('ISO date is date', () => {
      expect(TypeDetector.classifyValue('2024-01-15', Cleaner.parseDateToken)).toBe('date');
    });
    test('ISO datetime is date', () => {
      expect(TypeDetector.classifyValue('2024-01-15T10:30:00', Cleaner.parseDateToken)).toBe('date');
    });
    test('month-name date is date', () => {
      expect(TypeDetector.classifyValue('March 4, 2026', Cleaner.parseDateToken)).toBe('date');
    });

    // invalid dates
    test('invalid month (2026-99-99) is text', () => {
      expect(TypeDetector.classifyValue('2026-99-99', Cleaner.parseDateToken)).toBe('text');
    });
    test('invalid calendar date (2026-02-30) is text', () => {
      expect(TypeDetector.classifyValue('2026-02-30', Cleaner.parseDateToken)).toBe('text');
    });
    test('invalid hour (24:30:00) is text', () => {
      expect(TypeDetector.classifyValue('2026-03-04T24:30:00', Cleaner.parseDateToken)).toBe('text');
    });
    test('invalid minute (12:60:00) is text', () => {
      expect(TypeDetector.classifyValue('2026-03-04T12:60:00', Cleaner.parseDateToken)).toBe('text');
    });
    test('trailing junk is text', () => {
      expect(TypeDetector.classifyValue('2026-03-04T12:30junk', Cleaner.parseDateToken)).toBe('text');
    });
    test('invalid timezone (+15:00) is text', () => {
      expect(TypeDetector.classifyValue('2026-03-04T12:30:00+15:00', Cleaner.parseDateToken)).toBe('text');
    });
    test('slash-separated date is text', () => {
      expect(TypeDetector.classifyValue('03/04/2026', Cleaner.parseDateToken)).toBe('text');
    });
    test('dot-separated date is text', () => {
      expect(TypeDetector.classifyValue('03.04.2026', Cleaner.parseDateToken)).toBe('text');
    });
    test('plain text is text', () => {
      expect(TypeDetector.classifyValue('Hello', Cleaner.parseDateToken)).toBe('text');
    });
  });

  // ---- classifyToken: typed tokens authority ----

  describe('classifyToken — typed tokens are authoritative', () => {
    test('empty token returns empty even with non-empty raw value', () => {
      const token = { type: 'empty' };
      expect(TypeDetector.classifyToken(token, 'hello', Cleaner.parseDateToken)).toBe('empty');
    });
    test('number token returns number', () => {
      const token = { type: 'number', value: 42 };
      expect(TypeDetector.classifyToken(token, 'hello', Cleaner.parseDateToken)).toBe('number');
    });
    test('date token returns date', () => {
      const token = { type: 'date', value: 45306, formatType: 'DATE' };
      expect(TypeDetector.classifyToken(token, 'hello', Cleaner.parseDateToken)).toBe('date');
    });
    test('boolean token returns boolean', () => {
      const token = { type: 'boolean', value: true };
      expect(TypeDetector.classifyToken(token, 'hello', Cleaner.parseDateToken)).toBe('boolean');
    });
    test('formula token returns text regardless of display', () => {
      const token = { type: 'formula', value: 'A1+B1' };
      expect(TypeDetector.classifyToken(token, '42', Cleaner.parseDateToken)).toBe('text');
    });
  });

  // ---- classifyToken: string token semantic inference ----

  describe('classifyToken — string token semantic inference', () => {
    test('ordinary numeric string token → Number', () => {
      const token = { type: 'string', value: '42' };
      expect(TypeDetector.classifyToken(token, null, Cleaner.parseDateToken)).toBe('number');
    });
    test('ordinary boolean string token → Boolean', () => {
      const token = { type: 'string', value: 'true' };
      expect(TypeDetector.classifyToken(token, null, Cleaner.parseDateToken)).toBe('boolean');
    });
    test('ordinary valid-date string token → Date', () => {
      const token = { type: 'string', value: '2026-03-04' };
      expect(TypeDetector.classifyToken(token, null, Cleaner.parseDateToken)).toBe('date');
    });
    test('leading-zero string token → Text', () => {
      const token = { type: 'string', value: '00123' };
      expect(TypeDetector.classifyToken(token, null, Cleaner.parseDateToken)).toBe('text');
    });
    test('invalid-date string token → Text', () => {
      const token = { type: 'string', value: '2026-02-30' };
      expect(TypeDetector.classifyToken(token, null, Cleaner.parseDateToken)).toBe('text');
    });
    test('TEXT-formatted numeric string token → Text', () => {
      const token = { type: 'string', value: '42', formatType: 'TEXT' };
      expect(TypeDetector.classifyToken(token, null, Cleaner.parseDateToken)).toBe('text');
    });
    test('TEXT-formatted date string token → Text', () => {
      const token = { type: 'string', value: '2026-03-04', formatType: 'TEXT' };
      expect(TypeDetector.classifyToken(token, null, Cleaner.parseDateToken)).toBe('text');
    });
    test('string token without value falls back to raw value', () => {
      const token = { type: 'string' };
      expect(TypeDetector.classifyToken(token, '42', Cleaner.parseDateToken)).toBe('number');
    });
    test('null/undefined token falls back to raw value classification', () => {
      expect(TypeDetector.classifyToken(null, '42', Cleaner.parseDateToken)).toBe('number');
    });
  });

  // ---- isLeadingZeroIdentifier ----

  describe('isLeadingZeroIdentifier', () => {
    test('00123 is an identifier', () => {
      expect(TypeDetector.isLeadingZeroIdentifier('00123')).toBe(true);
    });
    test('0 is not an identifier (single char)', () => {
      expect(TypeDetector.isLeadingZeroIdentifier('0')).toBe(false);
    });
    test('0.5 is not an identifier (decimal)', () => {
      expect(TypeDetector.isLeadingZeroIdentifier('0.5')).toBe(false);
    });
  });

  // ---- detect: homogeneous ----

  describe('detect — homogeneous columns', () => {
    test('all text column', () => {
      const data = [['Name'], ['Alice'], ['Bob'], ['Carol']];
      const types = TypeDetector.detect(data, { parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('text');
    });
    test('all number column (strings)', () => {
      const data = [['Age'], ['25'], ['30'], ['45']];
      const types = TypeDetector.detect(data, { parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('number');
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
      const data = [['MixedCol']];
      for (let i = 0; i < 50; i++) data.push([String(i * 10)]);
      for (let i = 0; i < 50; i++) data.push(['text_' + i]);
      const types = TypeDetector.detect(data, { sampleMax: 10, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('mixed');
    });
  });

  // ---- detect: with cellMeta ----

  describe('detect — with cellMeta', () => {
    test('typed Excel serial dates render as Date through cellMeta', () => {
      const data = [['Date'], [45306], [45370], [45413]];
      const cellMeta = [
        [{ type: 'string', value: 'Date' }],
        [{ type: 'date', value: 45306, formatType: 'DATE' }],
        [{ type: 'date', value: 45370, formatType: 'DATE' }],
        [{ type: 'date', value: 45413, formatType: 'DATE' }],
      ];
      const types = TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('date');
    });

    test('formula tokens are classified as Text', () => {
      const data = [['Formulas'], ['=A1+B1'], ['=SUM(C:C)']];
      const cellMeta = [
        [{ type: 'string', value: 'Formulas' }],
        [{ type: 'formula', value: 'A1+B1' }],
        [{ type: 'formula', value: 'SUM(C:C)' }],
      ];
      const types = TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('text');
    });

    test('ordinary numeric string token → Number via cellMeta', () => {
      const data = [['Age'], ['42'], ['7'], ['99']];
      const cellMeta = [
        [{ type: 'string', value: 'Age' }],
        [{ type: 'string', value: '42' }],
        [{ type: 'string', value: '7' }],
        [{ type: 'string', value: '99' }],
      ];
      const types = TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('number');
    });

    test('ordinary boolean string token → Boolean via cellMeta', () => {
      const data = [['Flag'], ['true'], ['false']];
      const cellMeta = [
        [{ type: 'string', value: 'Flag' }],
        [{ type: 'string', value: 'true' }],
        [{ type: 'string', value: 'false' }],
      ];
      const types = TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('boolean');
    });

    test('ordinary valid-date string token → Date via cellMeta', () => {
      const data = [['DOB'], ['2026-03-04'], ['2026-06-15']];
      const cellMeta = [
        [{ type: 'string', value: 'DOB' }],
        [{ type: 'string', value: '2026-03-04' }],
        [{ type: 'string', value: '2026-06-15' }],
      ];
      const types = TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('date');
    });

    test('leading-zero string token → Text via cellMeta', () => {
      const data = [['SKU'], ['00123'], ['00456']];
      const cellMeta = [
        [{ type: 'string', value: 'SKU' }],
        [{ type: 'string', value: '00123' }],
        [{ type: 'string', value: '00456' }],
      ];
      const types = TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('text');
    });

    test('invalid-date string token → Text via cellMeta', () => {
      const data = [['Bad'], ['2026-02-30'], ['2026-13-01']];
      const cellMeta = [
        [{ type: 'string', value: 'Bad' }],
        [{ type: 'string', value: '2026-02-30' }],
        [{ type: 'string', value: '2026-13-01' }],
      ];
      const types = TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('text');
    });

    test('TEXT-formatted numeric string token → Text', () => {
      const data = [['ID'], ['42'], ['99']];
      const cellMeta = [
        [{ type: 'string', value: 'ID' }],
        [{ type: 'string', value: '42', formatType: 'TEXT' }],
        [{ type: 'string', value: '99', formatType: 'TEXT' }],
      ];
      const types = TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('text');
    });

    test('TEXT-formatted date string token → Text', () => {
      const data = [['Col'], ['2026-03-04']];
      const cellMeta = [
        [{ type: 'string', value: 'Col' }],
        [{ type: 'string', value: '2026-03-04', formatType: 'TEXT' }],
      ];
      const types = TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('text');
    });

    test('formula token with numeric-looking display → Text', () => {
      // The formula token says "formula" — it must be Text regardless of display value
      const data = [['Calc'], ['42'], ['99']];
      const cellMeta = [
        [{ type: 'string', value: 'Calc' }],
        [{ type: 'formula', value: 'SUM(A1:A10)' }],
        [{ type: 'formula', value: 'AVERAGE(B1:B10)' }],
      ];
      const types = TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('text');
    });

    test('explicit empty token with stale non-empty display → Empty', () => {
      const data = [['Col'], ['should be ignored'], ['also ignored']];
      const cellMeta = [
        [{ type: 'string', value: 'Col' }],
        [{ type: 'empty' }],
        [{ type: 'empty' }],
      ];
      const types = TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('empty');
    });

    test('missing token falls back to raw value classification', () => {
      const data = [['Col'], ['42'], ['2024-01-15']];
      // No cellMeta at all — falls back to raw value classification
      const types = TypeDetector.detect(data, { parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('mixed');
    });

    test('partial metadata uses available typed tokens without shifting row alignment', () => {
      const data = [
        ['Names'], ['Alice'], ['Bob'], ['Carol'],
      ];
      // Row 1 metadata is null (absent) at its actual index; rows 2-3 have string tokens
      const cellMeta = [
        [{ type: 'string', value: 'Names' }],
        null, // absent metadata at correct row index — does not shift other rows
        [{ type: 'string', value: 'Bob' }],
        [{ type: 'string', value: 'Carol' }],
      ];
      const types = TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      expect(types[0].type).toBe('text');
    });

    test('metadata shorter than data uses typed tokens for covered rows', () => {
      const data = [['A'], [1], [2], [3], [4]];
      const cellMeta = [
        [{ type: 'string', value: 'A' }],
        [{ type: 'number', value: 1 }],
      ];
      const types = TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      // Rows 0-1 have meta (string header + number), rows 2-4 fall back to raw (numbers)
      expect(types[0].type).toBe('number');
    });

    test('source data and metadata remain unchanged after detection', () => {
      const data = [['A'], ['a']];
      const cellMeta = [[{ type: 'string', value: 'A' }], [{ type: 'string', value: 'a' }]];
      const dataCopy = JSON.parse(JSON.stringify(data));
      const metaCopy = JSON.parse(JSON.stringify(cellMeta));
      TypeDetector.detect(data, { cellMeta, parseDateToken: Cleaner.parseDateToken });
      expect(data).toEqual(dataCopy);
      expect(cellMeta).toEqual(metaCopy);
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

  // ---- labelFor / descriptionFor / titleFor ----

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

  describe('descriptionFor', () => {
    test('returns full type descriptions', () => {
      expect(TypeDetector.descriptionFor('text', false)).toBe('Text');
    });
    test('appends sampled note', () => {
      expect(TypeDetector.descriptionFor('text', true)).toBe('Text, based on a sample');
    });
  });

  describe('titleFor', () => {
    test('returns tooltip with detected type prefix', () => {
      expect(TypeDetector.titleFor('text', false, null)).toBe('Detected type: Text');
    });
  });

  // ---- non-destructive ----

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
