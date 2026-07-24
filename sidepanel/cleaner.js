/**
 * Data cleaning utilities for spreadsheet data.
 * All functions operate on 2D string arrays (first row = headers).
 */

// eslint-disable-next-line no-unused-vars
const Cleaner = (() => {
  'use strict';

  function emptyStats() {
    return {
      trimmedValues: 0,
      emptyRowsRemoved: 0,
      emptyColumnsRemoved: 0,
      duplicateRowsRemoved: 0,
      numericValuesCorrected: 0,
      headersNormalized: 0,
      datesNormalized: 0,
    };
  }

  /**
   * Apply all selected cleaning operations in sequence.
   * @param {string[][]} data - 2D array (row 0 = headers)
   * @param {Object} options - Cleaning options
   * @param {Object[][]} [cellMeta] - Optional 2D cell token array
   * @returns {string[][]|{data: string[][], cellMeta: Object[][], stats: Object}}
   */
  function apply(data, options, cellMeta) {
    const hasMetaArg = arguments.length >= 3;

    if (!data || data.length === 0) {
      if (hasMetaArg) return { data, cellMeta: cellMeta || null, stats: emptyStats() };
      return data;
    }

    const hasWork =
      options.trim ||
      options.removeEmptyRows ||
      options.removeEmptyColumns ||
      options.removeDuplicates ||
      options.fixNumbers ||
      options.normalizeDates ||
      options.normalizeHeaders;

    if (!hasWork) {
      if (hasMetaArg) return { data, cellMeta: cellMeta || null, stats: emptyStats() };
      return data;
    }

    let result = data;
    let meta = cellMeta ? cellMeta.map(row => row.map(token => token ? { ...token } : { type: 'empty' })) : null;
    const stats = emptyStats();

    if (options.trim) {
      const trimResult = trimWhitespace(result, meta);
      result = trimResult.data;
      meta = trimResult.cellMeta || null;
      stats.trimmedValues = trimResult.stats.trimmedValues;
    }
    if (options.removeEmptyRows) {
      const opResult = removeEmptyRows(result, meta);
      result = opResult.data;
      meta = opResult.cellMeta || null;
      stats.emptyRowsRemoved = opResult.stats.emptyRowsRemoved;
    }
    if (options.removeEmptyColumns) {
      const opResult = removeEmptyColumns(result, meta);
      result = opResult.data;
      meta = opResult.cellMeta || null;
      stats.emptyColumnsRemoved = opResult.stats.emptyColumnsRemoved;
    }
    if (options.removeDuplicates) {
      const opResult = options.duplicateMode === 'absolute'
        ? removeAbsoluteDuplicates(result, meta)
        : removeDuplicateRows(result, meta);
      result = opResult.data;
      meta = opResult.cellMeta || null;
      stats.duplicateRowsRemoved = opResult.stats.duplicateRowsRemoved;
    }
    if (options.fixNumbers) {
      const opResult = fixNumberFormatting(result, meta);
      result = opResult.data;
      meta = opResult.cellMeta || null;
      stats.numericValuesCorrected = opResult.stats.numericValuesCorrected;
    }
    if (options.normalizeDates) {
      const opResult = normalizeDates(result, meta);
      result = opResult.data;
      meta = opResult.cellMeta || null;
      stats.datesNormalized = opResult.stats.datesNormalized;
    }
    if (options.normalizeHeaders) {
      const normResult = normalizeHeaders(result, meta);
      result = normResult.data;
      meta = normResult.cellMeta || null;
      stats.headersNormalized = normResult.stats.headersNormalized;
    }

    if (hasMetaArg) return { data: result, cellMeta: meta || null, stats };
    return result;
  }

  /**
   * Trim leading/trailing whitespace from string cells only.
   * Numbers, booleans, null, and undefined pass through unchanged.
   */
  function trimWhitespace(data, meta) {
    let trimmedCount = 0;
    const trimmedData = data.map((row, ri) =>
      row.map((cell, ci) => {
        const token = meta && meta[ri] ? meta[ri][ci] : null;
        if (meta && (!token || token.type !== 'string')) return cell;
        if (typeof cell === 'string') {
          const trimmed = cell.trim();
          if (trimmed !== cell) trimmedCount++;
          if (token) {
            token.value = trimmed;
          }
          return trimmed;
        }
        return cell;
      })
    );
    return { data: trimmedData, cellMeta: meta || null, stats: { trimmedValues: trimmedCount } };
  }

  /**
   * Remove rows where all cells are empty or whitespace.
   * Always keeps the header row (index 0).
   * @returns {{data: string[][], stats: Object}} or {{data: string[][], cellMeta: Object[][], stats: Object}}
   */
  function removeEmptyRows(data, meta) {
    if (data.length === 0) {
      const result = { data, stats: { emptyRowsRemoved: 0 } };
      if (meta) result.cellMeta = meta;
      return result;
    }

    const keepIndices = [0];
    for (let i = 1; i < data.length; i++) {
      const isEmpty = meta
        ? meta[i].every((token) => isTokenEmpty(token))
        : data[i].every((cell) => {
            if (cell === null || cell === undefined) return true;
            if (typeof cell === 'string') return cell.trim().length === 0;
            return false;
          });
      if (!isEmpty) keepIndices.push(i);
    }

    const removed = data.length - keepIndices.length;
    const result = { data: keepIndices.map((i) => data[i]), stats: { emptyRowsRemoved: removed } };
    if (meta) result.cellMeta = keepIndices.map((i) => meta[i]);
    return result;
  }

  /**
   * Remove columns where all cells (including header) are empty.
   * @returns {{data: string[][], stats: Object}} or {{data: string[][], cellMeta: Object[][], stats: Object}}
   */
  function removeEmptyColumns(data, meta) {
    if (data.length === 0) {
      const result = { data, stats: { emptyColumnsRemoved: 0 } };
      if (meta) result.cellMeta = meta;
      return result;
    }

    const colCount = data.reduce((max, r) => Math.max(max, r.length), 0);
    const keepCols = [];
    for (let col = 0; col < colCount; col++) {
      const hasContent = meta
        ? meta.some((row) => row[col] && !isTokenEmpty(row[col]))
        : data.some((row) => {
            const val = row[col];
            if (val === null || val === undefined) return false;
            if (typeof val === 'string') return val.trim().length > 0;
            return true;
          });
      if (hasContent) keepCols.push(col);
    }

    const removed = colCount - keepCols.length;
    const result = { data: data.map((row) => keepCols.map((col) => row[col] ?? '')), stats: { emptyColumnsRemoved: removed } };
    if (meta) {
      result.cellMeta = meta.map((row) =>
        keepCols.map((col) => (row ? row[col] || { type: 'empty' } : { type: 'empty' }))
      );
    }
    return result;
  }

  /**
   * Remove ALL occurrences of any row that appears more than once.
   * Uses token-based comparison via metadata tokens (or tokenFromValue fallback).
   * @returns {{data: string[][], stats: Object}} or {{data: string[][], cellMeta: Object[][], stats: Object}}
   */
  function removeAbsoluteDuplicates(data, meta) {
    if (data.length <= 1) {
      const result = { data, stats: { duplicateRowsRemoved: 0 } };
      if (meta) result.cellMeta = meta;
      return result;
    }

    const keys = new Array(data.length);
    const counts = new Map();
    for (let i = 1; i < data.length; i++) {
      let tokens;
      if (meta && meta[i]) {
        tokens = meta[i];
      } else {
        tokens = data[i].map((v) => tokenFromValue(v));
      }
      const key = rowComparisonKey(tokens, false, []);
      keys[i] = key;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    const keepIndices = [0];
    for (let i = 1; i < data.length; i++) {
      if (counts.get(keys[i]) === 1) keepIndices.push(i);
    }

    const removed = data.length - keepIndices.length;
    const result = { data: keepIndices.map((i) => data[i]), stats: { duplicateRowsRemoved: removed } };
    if (meta) result.cellMeta = keepIndices.map((i) => meta[i]);
    return result;
  }

  /**
   * Remove duplicate rows keeping first occurrence.
   * Uses token-based comparison via metadata tokens (or tokenFromValue fallback).
   * @returns {{data: string[][], stats: Object}} or {{data: string[][], cellMeta: Object[][], stats: Object}}
   */
  function removeDuplicateRows(data, meta) {
    if (data.length <= 1) {
      const result = { data, stats: { duplicateRowsRemoved: 0 } };
      if (meta) result.cellMeta = meta;
      return result;
    }

    const seen = new Set();
    const keepIndices = [0];
    for (let i = 1; i < data.length; i++) {
      let tokens;
      if (meta && meta[i]) {
        tokens = meta[i];
      } else {
        tokens = data[i].map((v) => tokenFromValue(v));
      }
      const key = rowComparisonKey(tokens, false, []);
      if (!seen.has(key)) {
        seen.add(key);
        keepIndices.push(i);
      }
    }

    const removed = data.length - keepIndices.length;
    const result = { data: keepIndices.map((i) => data[i]), stats: { duplicateRowsRemoved: removed } };
    if (meta) result.cellMeta = keepIndices.map((i) => meta[i]);
    return result;
  }

  /**
   * Convert text-formatted numbers to actual numbers.
   * Skips the header row. Converts all eligible numeric-looking strings.
   * Preserves leading-zero identifiers (postal codes, SKUs, etc.).
   * @returns {{data: string[][], stats: Object}} or {{data: string[][], cellMeta: Object[][], stats: Object}}
   */
  function fixNumberFormatting(data, meta) {
    if (data.length <= 1) {
      const result = { data, stats: { numericValuesCorrected: 0 } };
      if (meta) result.cellMeta = meta;
      return result;
    }

    let fixedCount = 0;
    let newMeta = meta ? meta.map((row) => [...row]) : null;

    const newData = data.map((row, rowIndex) => {
      if (rowIndex === 0) return row;
      return row.map((cell, colIndex) => {
        if (typeof cell !== 'string') return cell;
        const token = meta && meta[rowIndex] ? meta[rowIndex][colIndex] : null;
        if (meta && (!token || token.type !== 'string')) return cell;
        if (token && token.formatType === 'TEXT') return cell;
        const trimmed = cell.trim();
        if (trimmed === '') return cell;

        const cleaned = trimmed.replace(/[,\s]/g, '');
        if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
          if (cleaned.length > 1 && cleaned.startsWith('0') && !cleaned.startsWith('0.')) {
            if (newMeta && newMeta[rowIndex] && newMeta[rowIndex][colIndex]) {
              newMeta[rowIndex][colIndex] = {
                ...newMeta[rowIndex][colIndex],
                type: 'string',
                value: cleaned,
              };
            }
            return cleaned;
          }
          const num = Number(cleaned);
          if (Number.isFinite(num)) {
            fixedCount++;
            if (newMeta) newMeta[rowIndex][colIndex] = { type: 'number', value: num };
            return num;
          }
        }

        return cell;
      });
    });

    const result = { data: newData, stats: { numericValuesCorrected: fixedCount } };
    if (meta) result.cellMeta = newMeta;
    return result;
  }

  /**
   * Convert unambiguous date strings to spreadsheet date values.
   *
   * Skips: row 0 (headers), formulas, existing date tokens, TEXT-format cells,
   * non-string token types, numeric strings, and ambiguous numeric-only formats.
   *
   * @returns {{data: string[][], stats: Object}} or {{data: string[][], cellMeta: Object[][], stats: Object}}
   */
  function normalizeDates(data, meta) {
    const hasProvidedMeta = arguments.length >= 2 && meta != null;
    let newMeta = hasProvidedMeta
      ? data.map((row, ri) =>
          Array.isArray(meta && meta[ri]) ? [...meta[ri]] : []
        )
      : data.map((row) => row.map((v) => tokenFromValue(v)));

    let normalizedCount = 0;

    const newData = data.map((row, ri) => {
      if (ri === 0) return row;
      return row.map((cell, ci) => {
        if (typeof cell !== 'string') return cell;

        // Use original meta as the eligibility authority (not the copy).
        // A missing row or token means "unknown — do not normalize."
        const sourceToken = hasProvidedMeta
          ? (Array.isArray(meta && meta[ri]) ? meta[ri][ci] : undefined)
          : null;

        if (hasProvidedMeta) {
          if (!sourceToken) return cell;
          if (sourceToken.type === 'formula' || sourceToken.type === 'date') return cell;
          if (sourceToken.type !== 'string') return cell;
          if (sourceToken.formatType === 'TEXT') return cell;
        }

        const dateToken = parseDateToken(cell);
        if (!dateToken) return cell;

        // Only assign after confirming the destination row exists.
        if (!newMeta[ri]) return cell;
        normalizedCount++;
        newMeta[ri][ci] = dateToken;
        return cell;
      });
    });

    const result = { data: newData, stats: { datesNormalized: normalizedCount } };
    result.cellMeta = newMeta;
    return result;
  }

  // ================================================================
  //  Shared date-parsing helper — used by both local Cleaner and
  //  Google-side cleanUploadedSheet so serials and semantics match.
  // ================================================================

  /**
   * Attempt to parse a value as an unambiguous date string.
   * Returns a date cell token `{ type: 'date', value: sheetsSerial, formatType }`
   * or null when the value is not a recognised unambiguous date.
   *
   * Recognised formats (conservative):
   *   - ISO date:       2026-03-04, 2026-3-4
   *   - ISO datetime:   2026-03-04T12:30:00, 2026-03-04T12:30:00Z,
   *                     2026-03-04T12:30:00+05:30, 2026-03-04T12:30:00.500
   *   - Month-name:     March 4, 2026  /  4 March 2026  /  Mar 4, 2026
   *   - Hyphenated:     04-Mar-2026
   *
   * Rejected:
   *   - Slash/dot-separated numeric dates (03/04/2026, 03.04.2026)
   *   - ISO-like with invalid clock components (24:01:00, 12:60:00)
   *   - Invalid calendar dates (Feb 30)
   *
   * @param {*} value - raw cell value
   * @returns {Object|null} date token or null
   */
  function parseDateToken(value) {
    if (typeof value !== 'string') return null;
    var trimmed = value.trim();
    if (trimmed === '') return null;

    var c = parseDateComponents(trimmed);
    if (!c) return null;

    var serial = dateComponentsToSerial(c);
    if (serial == null) return null;

    return {
      type: 'date',
      value: serial,
      formatType: c.hasTime ? 'DATE_TIME' : 'DATE',
    };
  }

  // ---- internal date helpers ----

  var MONTH_INDEX = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  var RE_ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  var RE_ISO_DATETIME = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))?$/;
  var RE_MONTH_DAY_YEAR = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})$/i;
  var RE_DAY_MONTH_YEAR = /^(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})$/i;
  var RE_DD_MON_YYYY = /^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{4})$/i;

  /**
   * Parse a date string into a components object or null.
   * @returns {{ y:number, mo:number, d:number, hasTime:boolean, h:number, mi:number, s:number, ms:number }|null}
   */
  function parseDateComponents(str) {
    // ISO datetime (must check before ISO date)
    var m = str.match(RE_ISO_DATETIME);
    if (m) {
      var y = parseInt(m[1], 10);
      var mo = parseInt(m[2], 10) - 1;
      var d = parseInt(m[3], 10);
      var h = parseInt(m[4], 10);
      var mi = parseInt(m[5], 10);
      var s = parseInt(m[6], 10);
      var frac = m[7] || null;
      var ms = 0;
      if (frac) {
        ms = Math.round(parseFloat(frac) * 1000);
      }
      var suffixZ = m[8] === 'Z';
      var offsetSign = m[9] || null;
      var offsetH = m[10] ? parseInt(m[10], 10) : 0;
      var offsetM = m[11] ? parseInt(m[11], 10) : 0;

      if (!isValidCalendarDate(y, mo, d)) return null;
      if (!isValidTime(h, mi, s)) return null;
      if (offsetSign && !isValidOffset(offsetH, offsetM)) return null;

      if (offsetSign) {
        var offsetMinutes = offsetH * 60 + offsetM;
        if (offsetSign === '-') offsetMinutes = -offsetMinutes;
        var totalMinutes = h * 60 + mi - offsetMinutes;
        if (totalMinutes < 0) {
          // Roll back one day
          var prev = addDays(y, mo, d, -1);
          y = prev.y; mo = prev.mo; d = prev.d;
          totalMinutes += 24 * 60;
        } else if (totalMinutes >= 24 * 60) {
          // Roll forward one day
          prev = addDays(y, mo, d, 1);
          y = prev.y; mo = prev.mo; d = prev.d;
          totalMinutes -= 24 * 60;
        }
        h = Math.floor(totalMinutes / 60);
        mi = totalMinutes % 60;
      }

      return { y: y, mo: mo, d: d, hasTime: true, h: h, mi: mi, s: s, ms: ms };
    }

    // ISO date
    m = str.match(RE_ISO_DATE);
    if (m) {
      y = parseInt(m[1], 10);
      mo = parseInt(m[2], 10) - 1;
      d = parseInt(m[3], 10);
      if (!isValidCalendarDate(y, mo, d)) return null;
      return { y: y, mo: mo, d: d, hasTime: false, h: 0, mi: 0, s: 0, ms: 0 };
    }

    // Month DD, YYYY
    m = str.match(RE_MONTH_DAY_YEAR);
    if (m) {
      mo = MONTH_INDEX[m[1].toLowerCase()];
      d = parseInt(m[2], 10);
      y = parseInt(m[3], 10);
      if (mo === undefined || !isValidCalendarDate(y, mo, d)) return null;
      return { y: y, mo: mo, d: d, hasTime: false, h: 0, mi: 0, s: 0, ms: 0 };
    }

    // DD Month YYYY
    m = str.match(RE_DAY_MONTH_YEAR);
    if (m) {
      d = parseInt(m[1], 10);
      mo = MONTH_INDEX[m[2].toLowerCase()];
      y = parseInt(m[3], 10);
      if (mo === undefined || !isValidCalendarDate(y, mo, d)) return null;
      return { y: y, mo: mo, d: d, hasTime: false, h: 0, mi: 0, s: 0, ms: 0 };
    }

    // DD-Mon-YYYY
    m = str.match(RE_DD_MON_YYYY);
    if (m) {
      d = parseInt(m[1], 10);
      mo = MONTH_INDEX[m[2].toLowerCase()];
      y = parseInt(m[3], 10);
      if (mo === undefined || !isValidCalendarDate(y, mo, d)) return null;
      return { y: y, mo: mo, d: d, hasTime: false, h: 0, mi: 0, s: 0, ms: 0 };
    }

    return null;
  }

  function isValidCalendarDate(year, monthIndex, day) {
    var dt = new Date(Date.UTC(year, monthIndex, day));
    return dt.getUTCFullYear() === year && dt.getUTCMonth() === monthIndex && dt.getUTCDate() === day;
  }

  function isValidTime(hours, minutes, seconds) {
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59;
  }

  function isValidOffset(hours, minutes) {
    if (
      !Number.isInteger(hours) ||
      !Number.isInteger(minutes) ||
      hours < 0 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return false;
    }
    if (hours < 14) return true;
    return hours === 14 && minutes === 0;
  }

  function addDays(year, monthIndex, day, days) {
    var dt = new Date(Date.UTC(year, monthIndex, day));
    dt.setUTCDate(dt.getUTCDate() + days);
    return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth(), d: dt.getUTCDate() };
  }

  var SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);
  var MS_PER_DAY = 86400000;
  var MS_PER_SECOND = 1000;
  var MS_PER_MINUTE = 60000;
  var MS_PER_HOUR = 3600000;

  /**
   * Convert parsed date components to a Google Sheets serial number
   * using the 1900 date system (epoch = 1899-12-30 UTC).
   */
  function dateComponentsToSerial(c) {
    var dateMs = Date.UTC(c.y, c.mo, c.d, 0, 0, 0, 0);
    var dateSerial = (dateMs - SHEETS_EPOCH_MS) / MS_PER_DAY;

    if (!c.hasTime) return dateSerial;

    var timeFraction = (c.h * MS_PER_HOUR + c.mi * MS_PER_MINUTE + c.s * MS_PER_SECOND + c.ms) / MS_PER_DAY;
    return dateSerial + timeFraction;
  }

  /**
   * Normalize header names:
   * - Trim whitespace
   * - Collapse multiple spaces to one
   * - Convert to Title Case
   */
  function normalizeHeaders(data, meta) {
    const hasMeta = arguments.length >= 2;

    if (data.length === 0) {
      if (hasMeta) return { data, cellMeta: meta || null, stats: { headersNormalized: 0 } };
      return [];
    }

    let normalizedCount = 0;
    const result = [...data];
    result[0] = data[0].map((header, ci) => {
      const token = meta && meta[0] ? meta[0][ci] : null;
      if (meta && (!token || token.type !== 'string')) return header;
      if (typeof header !== 'string') return header;
      const normalized = header
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (ch) => ch.toUpperCase());
      if (normalized !== header) normalizedCount++;
      if (token) {
        token.value = normalized;
      }
      return normalized;
    });

    if (hasMeta) return { data: result, cellMeta: meta || null, stats: { headersNormalized: normalizedCount } };
    return result;
  }

  /**
   * Get cleaning statistics (before/after comparison).
   */
  function getStats(original, cleaned) {
    const origRows = original.length;
    const cleanedRows = cleaned.length;
    const origCols = original[0]?.length || 0;
    const cleanedCols = cleaned[0]?.length || 0;

    return {
      rowsRemoved: origRows - cleanedRows,
      colsRemoved: origCols - cleanedCols,
      originalRows: origRows,
      cleanedRows,
      originalCols: origCols,
      cleanedCols,
    };
  }

  // ================================================================
  //  Cell-token helpers — shared by local preview and Google-side
  //  structural planning to guarantee identical row-identity and
  //  emptiness semantics.
  // ================================================================

  /**
   * Build a cell token from a raw 2D-array value (used by the local
   * Cleaner path for structural comparison).
   */
  function tokenFromValue(value) {
    if (value === null || value === undefined || value === '') return { type: 'empty' };
    if (typeof value === 'number') return { type: 'number', value };
    if (typeof value === 'boolean') return { type: 'boolean', value };
    if (typeof value === 'string') return { type: 'string', value };
    return { type: 'string', value: String(value) };
  }

  /**
   * Build a cell token from a Sheets API CellData object (used by
   * the Google-side structural-planning path).
   */
  function tokenFromCellData(cellData) {
    const uev = (cellData && cellData.userEnteredValue) || {};
    const fmtType = cellData && cellData.effectiveFormat && cellData.effectiveFormat.numberFormat
      ? cellData.effectiveFormat.numberFormat.type
      : undefined;

    if (uev.formulaValue !== undefined) return { type: 'formula', value: uev.formulaValue };
    if (fmtType === 'DATE' || fmtType === 'TIME' || fmtType === 'DATE_TIME') return { type: 'date', value: uev.numberValue, formatType: fmtType };
    if (uev.boolValue !== undefined) return { type: 'boolean', value: uev.boolValue };
    if (uev.numberValue !== undefined) return { type: 'number', value: uev.numberValue };
    if (uev.stringValue !== undefined && uev.stringValue !== '') {
      const token = { type: 'string', value: uev.stringValue };
      if (fmtType === 'TEXT') token.formatType = 'TEXT';
      return token;
    }
    return { type: 'empty' };
  }

  /**
   * Returns true when a token represents an effectively empty cell.
   * Whitespace-only strings are treated as empty.
   */
  function isTokenEmpty(token) {
    if (!token || token.type === 'empty') return true;
    if (token.type === 'string' && String(token.value || '').trim().length === 0) return true;
    return false;
  }

  /**
   * Stable comparison key for a single cell token.
   * When `shouldTrim` is true, string values are trimmed before keying.
   */
  function tokenComparisonKey(token, shouldTrim) {
    if (token.type === 'formula') {
      return `formula\x00${token.value ?? ''}`;
    }
    if (token.type === 'date') {
      return `date\x00${token.value ?? ''}\x00${token.formatType || 'DATE'}`;
    }
    if (token.type === 'string' && shouldTrim) {
      return `string\x00${String(token.value ?? '').trim()}`;
    }
    return `${token.type}\x00${token.value ?? ''}`;
  }

  /**
   * Build a row-level comparison key from an array of cell tokens.
   * Columns in `excludedCols` are skipped (for empty-column handling).
   */
  function rowComparisonKey(tokens, shouldTrim, excludedCols) {
    const excluded = new Set(excludedCols || []);
    return tokens.reduce((parts, token, idx) => {
      if (excluded.has(idx)) return parts;
      parts.push(tokenComparisonKey(token, shouldTrim));
      return parts;
    }, []).join('\x01');
  }

  return {
    apply,
    trimWhitespace,
    removeEmptyRows,
    removeEmptyColumns,
    removeDuplicateRows,
    removeAbsoluteDuplicates,
    fixNumberFormatting,
    normalizeDates,
    parseDateToken,
    normalizeHeaders,
    getStats,
    emptyStats,
    // Cell-token helpers
    tokenFromValue,
    tokenFromCellData,
    isTokenEmpty,
    tokenComparisonKey,
    rowComparisonKey,
  };
})();
