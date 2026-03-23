/**
 * Data cleaning utilities for spreadsheet data.
 * All functions operate on 2D string arrays (first row = headers).
 */

// eslint-disable-next-line no-unused-vars
const Cleaner = (() => {
  'use strict';

  /**
   * Apply all selected cleaning operations in sequence.
   * @param {string[][]} data - 2D array (row 0 = headers)
   * @param {Object} options - Cleaning options
   * @returns {string[][]}
   */
  function apply(data, options) {
    if (!data || data.length === 0) return data;

    const hasWork =
      options.trim ||
      options.removeEmptyRows ||
      options.removeEmptyColumns ||
      options.removeDuplicates ||
      options.fixNumbers ||
      options.normalizeHeaders;

    if (!hasWork) return data;

    let result = data;

    if (options.trim) {
      result = trimWhitespace(result);
    }
    if (options.removeEmptyRows) {
      result = removeEmptyRows(result);
    }
    if (options.removeEmptyColumns) {
      result = removeEmptyColumns(result);
    }
    if (options.removeDuplicates) {
      result = options.duplicateMode === 'absolute'
        ? removeAbsoluteDuplicates(result)
        : removeDuplicateRows(result);
    }
    if (options.fixNumbers) {
      result = fixNumberFormatting(result);
    }
    if (options.normalizeHeaders) {
      result = normalizeHeaders(result);
    }

    return result;
  }

  /**
   * Trim leading/trailing whitespace from every cell.
   */
  function trimWhitespace(data) {
    return data.map((row) =>
      row.map((cell) => (typeof cell === 'string' ? cell.trim() : String(cell ?? '')))
    );
  }

  /**
   * Remove rows where all cells are empty or whitespace.
   * Always keeps the header row (index 0).
   */
  function removeEmptyRows(data) {
    if (data.length === 0) return data;
    return [
      data[0],
      ...data.slice(1).filter((row) =>
        row.some((cell) => {
          const val = typeof cell === 'string' ? cell.trim() : String(cell ?? '');
          return val.length > 0;
        })
      ),
    ];
  }

  /**
   * Remove columns where all cells (including header) are empty.
   */
  function removeEmptyColumns(data) {
    if (data.length === 0) return data;

    const colCount = data.reduce((max, r) => Math.max(max, r.length), 0);
    const keepCols = [];

    for (let col = 0; col < colCount; col++) {
      const hasValue = data.some((row) => {
        const val = row[col];
        return val != null && String(val).trim().length > 0;
      });
      if (hasValue) keepCols.push(col);
    }

    return data.map((row) => keepCols.map((col) => row[col] ?? ''));
  }

  /**
   * Fast row fingerprint for dedup — avoids JSON.stringify overhead.
   */
  function rowKey(row) {
    return row.length + '\x00' + row.join('\x00');
  }

  /**
   * Remove ALL occurrences of any row that appears more than once.
   * Leaves only rows that are truly unique. Header row is always preserved.
   */
  function removeAbsoluteDuplicates(data) {
    if (data.length <= 1) return data;
    const header = data[0];
    // Pre-compute keys once to avoid double-hashing each row
    const keys = new Array(data.length);
    const counts = new Map();
    for (let i = 1; i < data.length; i++) {
      const key = rowKey(data[i]);
      keys[i] = key;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const result = [header];
    for (let i = 1; i < data.length; i++) {
      if (counts.get(keys[i]) === 1) result.push(data[i]);
    }
    return result;
  }

  /**
   * Remove duplicate data rows (keeps first occurrence).
   * Header row (index 0) is always preserved.
   */
  function removeDuplicateRows(data) {
    if (data.length <= 1) return data;

    const header = data[0];
    const seen = new Set();
    const result = [header];

    for (let i = 1; i < data.length; i++) {
      const key = rowKey(data[i]);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(data[i]);
      }
    }

    return result;
  }

  /**
   * Convert text-formatted numbers to actual numbers.
   * Skips the header row. Only converts clean numeric strings.
   */
  function fixNumberFormatting(data) {
    if (data.length <= 1) return data;

    return data.map((row, rowIndex) => {
      if (rowIndex === 0) return row; // Preserve headers as-is
      return row.map((cell) => {
        if (typeof cell !== 'string') return cell;
        const trimmed = cell.trim();
        if (trimmed === '') return cell;

        // Match integers, decimals, negative numbers, and comma-separated numbers
        const cleaned = trimmed.replace(/,/g, '');
        if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
          const num = Number(cleaned);
          if (Number.isFinite(num)) return num;
        }

        return cell;
      });
    });
  }

  /**
   * Normalize header names:
   * - Trim whitespace
   * - Collapse multiple spaces to one
   * - Convert to Title Case
   */
  function normalizeHeaders(data) {
    if (data.length === 0) return data;

    const result = [...data];
    result[0] = data[0].map((header) => {
      if (typeof header !== 'string') return header;
      return header
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\b\w/g, (ch) => ch.toUpperCase());
    });

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

  return {
    apply,
    trimWhitespace,
    removeEmptyRows,
    removeEmptyColumns,
    removeDuplicateRows,
    removeAbsoluteDuplicates,
    fixNumberFormatting,
    normalizeHeaders,
    getStats,
  };
})();
