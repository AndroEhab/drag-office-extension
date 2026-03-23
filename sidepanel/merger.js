/**
 * Merge multiple parsed spreadsheet datasets into one.
 * Aligns columns by header name (case-insensitive match).
 */

// eslint-disable-next-line no-unused-vars
const Merger = (() => {
  'use strict';

  /**
   * Merge multiple parsed file objects into a single dataset.
   * Uses the first sheet from each file.
   * Empty rows are preserved in the merged output (use Cleaner to strip them).
   *
   * @param {Array<{ sheets: Array<{ name: string, data: string[][] }> }>} parsedFiles
   * @returns {{ sheets: Array<{ name: string, data: string[][] }>, sourceMap: Array }}
   */
  function merge(parsedFiles, options) {
    options = options || {};
    const keyFn = options.smartMapping ? fuzzyNormalizeKey : normalizeKey;
    const customMappings = options.customMappings || [];

    // Build custom mapping lookup: normalizeKey(from) → keyFn(to)
    const customMap = new Map();
    const customDisplayMap = new Map();
    for (const { from, to } of customMappings) {
      if (!from || !to) continue;
      const fromKey = normalizeKey(from);
      const toKey = keyFn(to);
      if (fromKey === toKey) continue;
      customMap.set(fromKey, toKey);
      customDisplayMap.set(fromKey, String(to).trim());
    }

    // Resolve per-file header keys, skipping custom redirect when the target
    // column already exists naturally in the same file (prevents data loss).
    const resolveFileHeaders = (rawHeaders) => {
      const patched = [];
      for (let ci = 0; ci < rawHeaders.length; ci++) {
        const raw = String(rawHeaders[ci] ?? '').trim();
        patched.push(raw || `Column ${ci + 1}`);
      }
      const naturalKeys = new Set();
      for (const h of patched) {
        if (!customMap.has(normalizeKey(h))) {
          naturalKeys.add(keyFn(h));
        }
      }
      return patched.map((header) => {
        const nk = normalizeKey(header);
        if (customMap.has(nk)) {
          const targetKey = customMap.get(nk);
          if (!naturalKeys.has(targetKey)) {
            return { key: targetKey, display: customDisplayMap.get(nk) || header };
          }
        }
        return { key: keyFn(header), display: header };
      });
    };

    // Collect the first sheet from each file, tracking original index
    // so sourceMap entries can point back to the correct file for formatting.
    const indexed = parsedFiles
      .map((f, i) => ({ sheet: f.sheets[0], originalIndex: i }))
      .filter((item) => item.sheet && item.sheet.data.length > 0);

    if (indexed.length === 0) {
      return { sheets: [{ name: 'Merged', data: [] }], sourceMap: [] };
    }

    if (indexed.length === 1) {
      const raw = indexed[0].sheet.data;
      const wantSM = Boolean(options.includeSourceMap);
      const identity = wantSM ? (raw[0] ? raw[0].map((_, i) => i) : []) : null;
      // Keep header, then all non-empty data rows
      const data = [raw[0]];
      const sourceMap = wantSM
        ? [{ fileIndex: indexed[0].originalIndex, sourceRow: 0, colMap: identity }]
        : [];
      for (let i = 1; i < raw.length; i++) {
        data.push(raw[i]);
        if (wantSM) {
          sourceMap.push({
            fileIndex: indexed[0].originalIndex,
            sourceRow: i,
            colMap: identity,
          });
        }
      }
      return { sheets: [{ name: 'Merged', data }], sourceMap };
    }

    // Build a unified header list preserving first-seen order
    const headerOrder = [];
    const headerSet = new Map(); // normalized → original display name

    for (const { sheet } of indexed) {
      for (const { key, display } of resolveFileHeaders(sheet.data[0] || [])) {
        if (!headerSet.has(key)) {
          headerSet.set(key, display);
          headerOrder.push(key);
        }
      }
    }

    // The unified header row uses the first-seen display name
    const unifiedHeaders = headerOrder.map((key) => headerSet.get(key));
    const headerIndexMap = new Map(headerOrder.map((key, index) => [key, index]));

    // Pre-compute total data row count for pre-allocation
    let totalDataRows = 0;
    for (let fi = 0; fi < indexed.length; fi++) {
      totalDataRows += indexed[fi].sheet.data.length - 1;
    }

    const headerLen = unifiedHeaders.length;
    const mergedData = new Array(totalDataRows + 1);
    mergedData[0] = unifiedHeaders;

    // sourceMap is only needed for preserve-formatting upload path
    const wantSourceMap = Boolean(options.includeSourceMap);
    const sourceMap = wantSourceMap ? new Array(totalDataRows + 1) : [];

    if (wantSourceMap) {
      const firstColMap = resolveFileHeaders(indexed[0].sheet.data[0] || []).map(
        ({ key }) => headerIndexMap.get(key) ?? -1
      );
      sourceMap[0] = {
        fileIndex: indexed[0].originalIndex,
        sourceRow: 0,
        colMap: firstColMap,
      };
    }

    let writeIdx = 1;
    for (let fi = 0; fi < indexed.length; fi++) {
      const { sheet, originalIndex } = indexed[fi];
      const sheetData = sheet.data;
      const rowCount = sheetData.length;

      // Build column mapping: source index → unified index
      const colMap = resolveFileHeaders(sheetData[0] || []).map(
        ({ key }) => headerIndexMap.get(key) ?? -1
      );
      const colMapLen = colMap.length;

      for (let i = 1; i < rowCount; i++) {
        const srcRow = sheetData[i];
        const newRow = new Array(headerLen);
        for (let h = 0; h < headerLen; h++) newRow[h] = '';
        const srcLen = Math.min(srcRow.length, colMapLen);
        for (let j = 0; j < srcLen; j++) {
          const targetIdx = colMap[j];
          if (targetIdx >= 0 && newRow[targetIdx] === '') {
            newRow[targetIdx] = srcRow[j];
          }
        }
        mergedData[writeIdx] = newRow;
        if (wantSourceMap) {
          sourceMap[writeIdx] = { fileIndex: originalIndex, sourceRow: i, colMap };
        }
        writeIdx++;
      }
    }

    return { sheets: [{ name: 'Merged', data: mergedData }], sourceMap };
  }

  /**
   * Normalize a header string for comparison.
   */
  function normalizeKey(header) {
    return String(header ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  /**
   * Aggressive normalize for smart mapping:
   * - lowercase
   * - underscores / hyphens → spaces
   * - collapse whitespace
   * - strip common English plural suffixes
   */
  function fuzzyNormalizeKey(header) {
    let key = String(header ?? '')
      .trim()
      .toLowerCase()
      .replace(/[_\-]/g, ' ')
      .replace(/\s+/g, ' ');
    // Depluralize: ies→y, ses/xes/zes/ches/shes→drop "es", generic "es"→drop "es", then trailing "s"
    if (key.length > 3) {
      if (/ies$/.test(key)) {
        key = key.slice(0, -3) + 'y';
      } else if (/(?:s|x|z|ch|sh)es$/.test(key)) {
        key = key.slice(0, -2);
      } else if (/[^s]s$/.test(key)) {
        key = key.slice(0, -1);
      }
    }
    return key;
  }

  /**
   * Detect header groups that smart mapping would combine but exact matching would not.
   * Returns an array of { canonical, variants } objects.
   */
  function detectMappings(parsedFiles) {
    const sheets = parsedFiles
      .map((f) => f.sheets[0])
      .filter((s) => s && s.data.length > 0);

    const seen = new Set();
    const uniqueHeaders = [];
    for (const sheet of sheets) {
      for (const header of (sheet.data[0] || [])) {
        const display = String(header ?? '').trim();
        if (display && !seen.has(display)) {
          seen.add(display);
          uniqueHeaders.push(display);
        }
      }
    }

    const groups = new Map();
    for (const header of uniqueHeaders) {
      const key = fuzzyNormalizeKey(header);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(header);
    }

    const mappings = [];
    for (const [, headers] of groups) {
      if (headers.length < 2) continue;
      const exactKeys = new Set(headers.map((h) => normalizeKey(h)));
      if (exactKeys.size > 1) {
        mappings.push({ canonical: headers[0], variants: headers });
      }
    }

    return mappings;
  }

  /**
   * Collect all unique display headers across the first sheet of each file.
   * @param {Array} parsedFiles
   * @returns {string[]}
   */
  function collectHeaders(parsedFiles) {
    const sheets = parsedFiles
      .map((f) => f.sheets[0])
      .filter((s) => s && s.data.length > 0);

    const seen = new Set();
    const headers = [];
    for (const sheet of sheets) {
      for (const header of (sheet.data[0] || [])) {
        const display = String(header ?? '').trim();
        if (display && !seen.has(display)) {
          seen.add(display);
          headers.push(display);
        }
      }
    }
    return headers;
  }

  /**
   * Collect headers grouped by file (first sheet of each).
   * @param {Array} parsedFiles
   * @param {string[]} fileNames  Display names for each file
   * @returns {Array<{ fileName: string, headers: string[] }>}
   */
  function collectHeadersByFile(parsedFiles, fileNames) {
    const result = [];
    for (let i = 0; i < parsedFiles.length; i++) {
      const sheet = parsedFiles[i]?.sheets?.[0];
      if (!sheet || !sheet.data || sheet.data.length === 0) {
        result.push({ fileName: (fileNames && fileNames[i]) || `File ${i + 1}`, headers: [] });
        continue;
      }
      const headers = [];
      for (const header of (sheet.data[0] || [])) {
        const display = String(header ?? '').trim();
        if (display) headers.push(display);
      }
      result.push({ fileName: (fileNames && fileNames[i]) || `File ${i + 1}`, headers });
    }
    return result;
  }

  return { merge, detectMappings, collectHeaders, collectHeadersByFile };
})();
