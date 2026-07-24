/**
 * Non-destructive column type detection for spreadsheet preview.
 * Infers a likely type for each column without modifying values.
 */

// eslint-disable-next-line no-unused-vars
const TypeDetector = (() => {
  'use strict';

  const COLUMN_TYPES = {
    TEXT: 'text',
    NUMBER: 'number',
    DATE: 'date',
    BOOLEAN: 'boolean',
    MIXED: 'mixed',
    EMPTY: 'empty',
  };

  const MAX_SAMPLE = 1000;
  const DOMINANCE_THRESHOLD = 0.7;

  // ---- value-level classifiers ----

  var RE_INTEGER = /^-?\d+$/;
  var RE_DECIMAL = /^-?\d+\.\d+$/;
  var RE_COMMA_NUMBER = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
  var RE_SCIENTIFIC = /^-?\d+(?:\.\d+)?[eE][+-]?\d+$/;

  var RE_ISO_DATE = /^\d{4}-\d{1,2}-\d{1,2}$/;
  var RE_ISO_DATETIME = /^\d{4}-\d{1,2}-\d{1,2}[T ]\d{1,2}:\d{2}/;
  var RE_MONTH_DATE = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}$/i;
  var RE_DAY_MONTH_DATE = /^\d{1,2}\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}$/i;
  var RE_DD_MON_YYYY = /^\d{1,2}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4}$/i;

  var BOOLEAN_TRUE = new Set(['true', 'yes', 't', 'y']);
  var BOOLEAN_FALSE = new Set(['false', 'no', 'f', 'n']);

  /**
   * Classify a single raw value into a type category.
   * @param {*} val
   * @returns {'empty'|'number'|'date'|'boolean'|'text'}
   */
  function classifyValue(val) {
    if (val === null || val === undefined) return 'empty';

    if (typeof val === 'number') {
      if (isNaN(val)) return 'empty';
      return 'number';
    }

    if (typeof val === 'boolean') return 'boolean';

    var str = String(val).trim();
    if (str === '') return 'empty';

    // Numeric
    if (RE_INTEGER.test(str) || RE_DECIMAL.test(str) || RE_SCIENTIFIC.test(str)) return 'number';
    if (RE_COMMA_NUMBER.test(str)) return 'number';

    // Boolean
    var lower = str.toLowerCase();
    if (BOOLEAN_TRUE.has(lower) || BOOLEAN_FALSE.has(lower)) return 'boolean';

    // Date
    if (RE_ISO_DATE.test(str)) return 'date';
    if (RE_ISO_DATETIME.test(str)) return 'date';
    if (RE_MONTH_DATE.test(str)) return 'date';
    if (RE_DAY_MONTH_DATE.test(str)) return 'date';
    if (RE_DD_MON_YYYY.test(str)) return 'date';

    return 'text';
  }

  /**
   * Determine the dominant type from a tally of classified values.
   * @param {Object<string,number>} tally - counts per type
   * @param {number} nonEmpty - total non-empty count
   * @returns {{ type: string, note: string|null }}
   */
  function dominantType(tally, nonEmpty) {
    if (nonEmpty === 0) return { type: COLUMN_TYPES.EMPTY, note: null };

    var entries = Object.keys(tally)
      .filter(function (k) { return k !== 'empty'; })
      .map(function (k) { return [k, tally[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; });

    if (entries.length === 0) return { type: COLUMN_TYPES.EMPTY, note: null };

    var top = entries[0];
    var ratio = top[1] / nonEmpty;

    if (entries.length === 1 || ratio >= DOMINANCE_THRESHOLD) {
      return { type: top[0], note: ratio < 1 ? 'mixed' : null };
    }

    // Check if top two types together would be dominant — still mixed
    return { type: COLUMN_TYPES.MIXED, note: null };
  }

  /**
   * Detect column types from a 2D data array.
   * Row 0 is treated as the header row and is skipped.
   *
   * @param {Array<Array<*>>} data - 2D array of cell values
   * @param {Object} [options]
   * @param {number} [options.maxCols=15] - Maximum columns to analyze
   * @param {number} [options.sampleMax=1000] - Max values per column
   * @param {Array<Array<Object>>} [options.cellMeta] - Optional cell metadata tokens
   * @returns {Array<{type: string, sampled: boolean}>}
   */
  function detect(data, options) {
    options = options || {};
    if (!data || data.length < 2) return [];

    var maxCols = options.maxCols || 15;
    var sampleMax = options.sampleMax || MAX_SAMPLE;
    var cellMeta = options.cellMeta || null;

    var colCount = Math.min((data[0] && data[0].length) || 0, maxCols);
    var results = [];
    var dataRows = data.slice(1);
    var totalRows = dataRows.length;
    var hasMeta = cellMeta && Array.isArray(cellMeta) && cellMeta.length === data.length;

    for (var col = 0; col < colCount; col++) {
      var tally = { empty: 0, number: 0, date: 0, boolean: 0, text: 0 };
      var sampleSize = Math.min(totalRows, sampleMax);
      var step = totalRows > sampleMax ? Math.floor(totalRows / sampleMax) : 1;
      var sampled = 0;

      for (var i = 0; i < totalRows && sampled < sampleMax; i += step) {
        var row = dataRows[i];

        // Use cellMeta classification when available (e.g. Excel with trusted metadata)
        if (hasMeta && cellMeta[i + 1]) {
          var metaToken = cellMeta[i + 1][col];
          var ct = classifyToken(metaToken);
          tally[ct] = (tally[ct] || 0) + 1;
        } else {
          var val = col < (row ? row.length : 0) ? row[col] : undefined;
          var ct = classifyValue(val);
          tally[ct] = (tally[ct] || 0) + 1;
        }
        sampled++;
      }

      var nonEmpty = sampled - (tally.empty || 0);
      var result = dominantType(tally, nonEmpty);
      result.sampled = totalRows > sampled;
      results.push(result);
    }

    return results;
  }

  /**
   * Map a cell metadata token to a type category.
   * @param {Object|null} token
   * @returns {'empty'|'number'|'date'|'boolean'|'text'}
   */
  function classifyToken(token) {
    if (!token) return 'empty';
    if (token.type === 'empty') return 'empty';
    if (token.type === 'number') return 'number';
    if (token.type === 'date') return 'date';
    if (token.type === 'boolean') return 'boolean';
    if (token.type === 'string' || token.type === 'formula') return 'text';
    return 'empty';
  }

  /**
   * Return a compact display label for a column type.
   * @param {string} type
   * @returns {string}
   */
  function labelFor(type) {
    var labels = {
      text: 'abc',
      number: '#',
      date: 'dat',
      boolean: 'bool',
      mixed: '-/-',
      empty: '--',
    };
    return labels[type] || type;
  }

  /**
   * Return a short display title (tooltip) for a column type.
   * @param {string} type
   * @param {boolean} sampled
   * @param {string|null} note
   * @returns {string}
   */
  function titleFor(type, sampled, note) {
    var base = type.charAt(0).toUpperCase() + type.slice(1);
    if (note === 'mixed') base += ' (with some variation)';
    if (sampled) base += ' \u2014 from sample';
    return base;
  }

  // Exports for tests
  var exports = {
    COLUMN_TYPES: COLUMN_TYPES,
    detect: detect,
    classifyValue: classifyValue,
    labelFor: labelFor,
    titleFor: titleFor,
  };

  return exports;
})();
