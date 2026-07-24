/**
 * Non-destructive column type detection for spreadsheet preview.
 * Infers a likely type for each column without modifying values.
 *
 * Uses Cleaner.parseDateToken for conservative date validation and
 * respects leading-zero identifier handling consistent with fixNumberFormatting.
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

  var BOOLEAN_TRUE = new Set(['true', 'yes', 't', 'y']);
  var BOOLEAN_FALSE = new Set(['false', 'no', 'f', 'n']);

  /**
   * Check if a cleaned numeric string represents a leading-zero identifier
   * (postal code, SKU, etc.) consistent with Cleaner.fixNumberFormatting.
   * Returns true when the value should be treated as text, not a number.
   */
  function isLeadingZeroIdentifier(cleaned) {
    return cleaned.length > 1 && cleaned.startsWith('0') && !cleaned.startsWith('0.');
  }

  /**
   * Classify a single raw value into a type category.
   * @param {*} val
   * @param {Function|null} parseDateToken - Cleaner.parseDateToken or null
   * @returns {'empty'|'number'|'date'|'boolean'|'text'}
   */
  function classifyValue(val, parseDateToken) {
    if (val === null || val === undefined) return 'empty';

    if (typeof val === 'number') {
      if (isNaN(val)) return 'empty';
      return 'number';
    }

    if (typeof val === 'boolean') return 'boolean';

    var str = String(val).trim();
    if (str === '') return 'empty';

    // Numeric — but preserve leading-zero identifiers as text
    if (RE_INTEGER.test(str) || RE_DECIMAL.test(str)) {
      if (isLeadingZeroIdentifier(str)) return 'text';
      return 'number';
    }
    if (RE_SCIENTIFIC.test(str)) return 'number';
    if (RE_COMMA_NUMBER.test(str)) {
      var cleanedNum = str.replace(/[,\s]/g, '');
      if (isLeadingZeroIdentifier(cleanedNum)) return 'text';
      return 'number';
    }

    // Boolean
    var lower = str.toLowerCase();
    if (BOOLEAN_TRUE.has(lower) || BOOLEAN_FALSE.has(lower)) return 'boolean';

    // Date — use the validated shared parser
    if (parseDateToken && typeof parseDateToken === 'function') {
      if (parseDateToken(str) !== null) return 'date';
    }

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

    return { type: COLUMN_TYPES.MIXED, note: null };
  }

  /**
   * Map a cell metadata token to a type category.
   * Typed tokens (number, date, boolean, formula, empty) are authoritative.
   * String tokens are semantically classified unless formatType='TEXT'.
   * Falls back to raw value classification when no usable token exists.
   *
   * @param {Object|null} token
   * @param {*} rawValue - the cell's raw displayed value
   * @param {Function|null} parseDateToken - Cleaner.parseDateToken for date validation
   * @returns {'empty'|'number'|'date'|'boolean'|'text'}
   */
  function classifyToken(token, rawValue, parseDateToken) {
    if (!token || !token.type) {
      return classifyValue(rawValue, parseDateToken);
    }

    switch (token.type) {
      case 'empty':
        return 'empty';

      case 'number':
        return 'number';

      case 'date':
        return 'date';

      case 'boolean':
        return 'boolean';

      case 'formula':
        return 'text';

      case 'string': {
        if (token.formatType === 'TEXT') return 'text';

        var value = token.value !== undefined && token.value !== null
          ? token.value
          : rawValue;

        return classifyValue(value, parseDateToken);
      }

      default:
        return classifyValue(rawValue, parseDateToken);
    }
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
   * @param {boolean} [options.sourceSampled=false] - Whether the source data was itself sampled
   * @param {Function} [options.parseDateToken] - Cleaner.parseDateToken for date validation
   * @returns {Array<{type: string, sampled: boolean, note: string|null}>}
   */
  function detect(data, options) {
    options = options || {};
    if (!data || data.length < 2) return [];

    var maxCols = options.maxCols || 15;
    var sampleMax = options.sampleMax || MAX_SAMPLE;
    var cellMeta = options.cellMeta || null;
    var sourceSampled = Boolean(options.sourceSampled);
    var parseDateToken = options.parseDateToken || null;

    var colCount = Math.min((data[0] && data[0].length) || 0, maxCols);
    var results = [];
    var dataRows = data.length - 1;
    var totalRows = dataRows; // data rows only (excluding header)

    for (var col = 0; col < colCount; col++) {
      var tally = { empty: 0, number: 0, date: 0, boolean: 0, text: 0 };
      var sampleCount = Math.min(totalRows, sampleMax);
      var sampledCount = 0;

      // Evenly distributed sampling
      for (var sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
        var rowIdx = totalRows > sampleMax
          ? Math.floor(sampleIndex * totalRows / sampleCount) + 1 // +1 skips header
          : sampleIndex + 1;

        var row = data[rowIdx];

        // Per-cell metadata check — not all-or-nothing;
        // explicit empty tokens are authoritative even if the raw cell has a stale value.
        var rawValue = col < (row ? row.length : 0) ? row[col] : undefined;
        var metaToken = (cellMeta && Array.isArray(cellMeta[rowIdx])) ? cellMeta[rowIdx][col] : undefined;

        var ct = metaToken && metaToken.type
          ? classifyToken(metaToken, rawValue, parseDateToken)
          : classifyValue(rawValue, parseDateToken);

        tally[ct] = (tally[ct] || 0) + 1;
        sampledCount++;
      }

      var nonEmpty = sampledCount - (tally.empty || 0);
      var result = dominantType(tally, nonEmpty);

      // Truthful sampling: sampled if source was sampled OR we sampled internally
      result.sampled = sourceSampled || totalRows > sampledCount;
      results.push(result);
    }

    return results;
  }

  // ---- display helpers ----

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
   * Return a human-readable type description with sampling note.
   * @param {string} type
   * @param {boolean} sampled
   * @returns {string}
   */
  function descriptionFor(type, sampled) {
    var canonical = {
      text: 'Text',
      number: 'Number',
      date: 'Date',
      boolean: 'Boolean',
      mixed: 'Mixed',
      empty: 'Empty',
    };
    var base = canonical[type] || type;
    if (sampled) base += ', based on a sample';
    return base;
  }

  /**
   * Return a short display title (tooltip) for a column type.
   * @param {string} type
   * @param {boolean} sampled
   * @param {string|null} note
   * @returns {string}
   */
  function titleFor(type, sampled, note) {
    var base = 'Detected type: ' + descriptionFor(type, sampled);
    if (note === 'mixed') base += ' (with some variation)';
    return base;
  }

  var exports = {
    COLUMN_TYPES: COLUMN_TYPES,
    detect: detect,
    classifyValue: classifyValue,
    classifyToken: classifyToken,
    labelFor: labelFor,
    descriptionFor: descriptionFor,
    titleFor: titleFor,
    isLeadingZeroIdentifier: isLeadingZeroIdentifier,
  };

  return exports;
})();
