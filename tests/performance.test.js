/**
 * Performance tests for the full pipeline: parsing, cleaning, merging, and upload prep.
 *
 * Tests use programmatically generated data at multiple sizes:
 *   - Small:  1,000 rows   (~typical quick file)
 *   - Medium: 10,000 rows  (~moderate spreadsheet)
 *   - Large:  50,000 rows  (~heavy workload)
 *   - XL:     100,000 rows (~stress test)
 *
 * For CSV parsing, the Python script (scripts/generate_xlsx.py) can generate
 * realistic files. These tests use generated-in-memory data so they run without
 * external file dependencies, but the test data helper matches the schema from
 * the Python script.
 *
 * Duration targets are calibrated for a typical development machine.
 * CI environments may need ~2x the thresholds.
 */
const { loadModule } = require('./helpers');

const Cleaner = loadModule('../sidepanel/cleaner.js', 'Cleaner');
const Merger = loadModule('../sidepanel/merger.js', 'Merger');

// Parser needs FileReader mock from setup.js (already loaded via jest.config)
const Parser = loadModule('../sidepanel/parser.js', 'Parser');

// ---- Test data generators ----

const COLUMNS = [
  'id', 'customer_id', 'first_name', 'last_name', 'full_name',
  'email', 'phone', 'company', 'job_title', 'street_address',
  'city', 'state', 'postcode', 'country', 'signup_date',
  'last_login', 'age', 'is_active', 'account_balance', 'credit_score',
  'preferred_channel', 'notes',
];

function generateRow(i) {
  return [
    String(i),
    `uuid-${i}-${i * 7 % 10000}`,
    `First${i % 500}`,
    `Last${i % 300}`,
    `First${i % 500} Last${i % 300}`,
    `user${i}@example.com`,
    `555-${String(i % 10000).padStart(4, '0')}`,
    `Company ${i % 200}`,
    `Job ${i % 100}`,
    `${i % 9999} Main St`,
    `City${i % 50}`,
    `State${i % 50}`,
    String(10000 + (i % 90000)),
    `Country${i % 30}`,
    `2024-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    `2025-01-15 ${String(i % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`,
    String(18 + (i % 63)),
    i % 3 === 0 ? 'true' : 'false',
    String(Math.round((i * 17.31) % 250000 * 100) / 100),
    String(300 + (i % 551)),
    ['email', 'sms', 'phone', 'web'][i % 4],
    `Sample note text for row ${i} with some realistic length for benchmarking.`,
  ];
}

function generateData(rowCount) {
  const data = [COLUMNS.slice()];
  for (let i = 1; i <= rowCount; i++) {
    data.push(generateRow(i));
  }
  return data;
}

/** Generate data with intentional issues for cleaning */
function generateDirtyData(rowCount) {
  const data = [COLUMNS.map((h) => `  ${h}  `)]; // padded headers
  for (let i = 1; i <= rowCount; i++) {
    const row = generateRow(i);
    // Add whitespace to ~30% of cells
    if (i % 3 === 0) {
      for (let j = 0; j < row.length; j++) {
        row[j] = `  ${row[j]}  `;
      }
    }
    data.push(row);
  }
  // Add ~5% empty rows
  const emptyCount = Math.floor(rowCount * 0.05);
  for (let i = 0; i < emptyCount; i++) {
    const pos = Math.floor((i + 1) * (data.length / (emptyCount + 1)));
    data.splice(pos, 0, new Array(COLUMNS.length).fill(''));
  }
  // Add ~5% duplicate rows
  const dupCount = Math.floor(rowCount * 0.05);
  for (let i = 0; i < dupCount; i++) {
    const sourceIdx = 1 + (i * 7) % Math.min(rowCount, data.length - 1);
    if (data[sourceIdx]) {
      data.push([...data[sourceIdx]]);
    }
  }
  // Add 2 empty columns
  for (const row of data) {
    row.splice(5, 0, '', '');
  }
  return data;
}

/** Convert 2D array to CSV string */
function toCsv(data) {
  return data.map((row) =>
    row.map((cell) => {
      const s = String(cell ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    }).join(',')
  ).join('\n');
}

/** Create a mock File-like object for the parser */
function makeCsvFile(name, data) {
  const content = toCsv(data);
  const file = new File([content], name);
  file._content = content;
  file._buffer = new TextEncoder().encode(content).buffer;
  return file;
}

/** High-resolution timer */
function hrtime() {
  return performance.now();
}

function elapsed(start) {
  return performance.now() - start;
}

// ---- Performance helper ----

function benchmark(label, fn, maxMs) {
  const start = hrtime();
  const result = fn();
  const ms = elapsed(start);
  // eslint-disable-next-line no-console
  console.log(`  [perf] ${label}: ${ms.toFixed(1)}ms (limit: ${maxMs}ms)`);
  expect(ms).toBeLessThan(maxMs);
  return result;
}

async function benchmarkAsync(label, fn, maxMs) {
  const start = hrtime();
  const result = await fn();
  const ms = elapsed(start);
  // eslint-disable-next-line no-console
  console.log(`  [perf] ${label}: ${ms.toFixed(1)}ms (limit: ${maxMs}ms)`);
  expect(ms).toBeLessThan(maxMs);
  return result;
}

// ============================================================
// PERFORMANCE: Data Generation
// ============================================================
describe('Performance: Data Generation', () => {
  test('generates 10k rows in under 500ms', () => {
    benchmark('generate 10k rows', () => generateData(10000), 500);
  });

  test('generates 50k rows in under 2000ms', () => {
    benchmark('generate 50k rows', () => generateData(50000), 2000);
  });
});

// ============================================================
// PERFORMANCE: CSV Parsing
// ============================================================
describe('Performance: CSV Parsing', () => {
  test('parse 1k row CSV in under 200ms', async () => {
    const data = generateData(1000);
    const file = makeCsvFile('small.csv', data);
    await benchmarkAsync('parse 1k CSV', () => Parser.parse(file), 200);
  });

  test('parse 10k row CSV in under 1000ms', async () => {
    const data = generateData(10000);
    const file = makeCsvFile('medium.csv', data);
    await benchmarkAsync('parse 10k CSV', () => Parser.parse(file), 1000);
  });

  test('parse 50k row CSV in under 5000ms', async () => {
    const data = generateData(50000);
    const file = makeCsvFile('large.csv', data);
    await benchmarkAsync('parse 50k CSV', () => Parser.parse(file), 5000);
  });
});

// ============================================================
// PERFORMANCE: Trim Whitespace
// ============================================================
describe('Performance: Trim Whitespace', () => {
  const opts = { trim: true, removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false, fixNumbers: false, normalizeHeaders: false };

  test('trim 1k rows in under 50ms', () => {
    const data = generateDirtyData(1000);
    benchmark('trim 1k rows', () => Cleaner.apply(data, opts), 50);
  });

  test('trim 10k rows in under 200ms', () => {
    const data = generateDirtyData(10000);
    benchmark('trim 10k rows', () => Cleaner.apply(data, opts), 200);
  });

  test('trim 50k rows in under 1000ms', () => {
    const data = generateDirtyData(50000);
    benchmark('trim 50k rows', () => Cleaner.apply(data, opts), 1000);
  });

  test('trim 100k rows in under 2000ms', () => {
    const data = generateDirtyData(100000);
    benchmark('trim 100k rows', () => Cleaner.apply(data, opts), 2000);
  });
});

// ============================================================
// PERFORMANCE: Remove Empty Rows
// ============================================================
describe('Performance: Remove Empty Rows', () => {
  const opts = { trim: false, removeEmptyRows: true, removeEmptyColumns: false, removeDuplicates: false, fixNumbers: false, normalizeHeaders: false };

  test('remove empty rows from 1k rows in under 50ms', () => {
    const data = generateDirtyData(1000);
    benchmark('removeEmptyRows 1k', () => Cleaner.apply(data, opts), 50);
  });

  test('remove empty rows from 10k rows in under 200ms', () => {
    const data = generateDirtyData(10000);
    benchmark('removeEmptyRows 10k', () => Cleaner.apply(data, opts), 200);
  });

  test('remove empty rows from 50k rows in under 800ms', () => {
    const data = generateDirtyData(50000);
    benchmark('removeEmptyRows 50k', () => Cleaner.apply(data, opts), 800);
  });

  test('remove empty rows from 100k rows in under 1500ms', () => {
    const data = generateDirtyData(100000);
    benchmark('removeEmptyRows 100k', () => Cleaner.apply(data, opts), 1500);
  });
});

// ============================================================
// PERFORMANCE: Remove Empty Columns
// ============================================================
describe('Performance: Remove Empty Columns', () => {
  const opts = { trim: false, removeEmptyRows: false, removeEmptyColumns: true, removeDuplicates: false, fixNumbers: false, normalizeHeaders: false };

  test('remove empty columns from 1k rows in under 50ms', () => {
    const data = generateDirtyData(1000);
    benchmark('removeEmptyColumns 1k', () => Cleaner.apply(data, opts), 50);
  });

  test('remove empty columns from 10k rows in under 200ms', () => {
    const data = generateDirtyData(10000);
    benchmark('removeEmptyColumns 10k', () => Cleaner.apply(data, opts), 200);
  });

  test('remove empty columns from 50k rows in under 1000ms', () => {
    const data = generateDirtyData(50000);
    benchmark('removeEmptyColumns 50k', () => Cleaner.apply(data, opts), 1000);
  });

  test('remove empty columns from 100k rows in under 2000ms', () => {
    const data = generateDirtyData(100000);
    benchmark('removeEmptyColumns 100k', () => Cleaner.apply(data, opts), 2000);
  });
});

// ============================================================
// PERFORMANCE: Remove Duplicate Rows (Keep First)
// ============================================================
describe('Performance: Remove Duplicates (Keep First)', () => {
  const opts = { trim: false, removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: true, duplicateMode: 'keep-first', fixNumbers: false, normalizeHeaders: false };

  test('dedup 1k rows in under 50ms', () => {
    const data = generateDirtyData(1000);
    benchmark('dedup keep-first 1k', () => Cleaner.apply(data, opts), 50);
  });

  test('dedup 10k rows in under 200ms', () => {
    const data = generateDirtyData(10000);
    benchmark('dedup keep-first 10k', () => Cleaner.apply(data, opts), 200);
  });

  test('dedup 50k rows in under 1500ms', () => {
    const data = generateDirtyData(50000);
    benchmark('dedup keep-first 50k', () => Cleaner.apply(data, opts), 1500);
  });

  test('dedup 100k rows in under 3000ms', () => {
    const data = generateDirtyData(100000);
    benchmark('dedup keep-first 100k', () => Cleaner.apply(data, opts), 3000);
  });
});

// ============================================================
// PERFORMANCE: Remove Duplicate Rows (Absolute)
// ============================================================
describe('Performance: Remove Duplicates (Absolute)', () => {
  const opts = { trim: false, removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: true, duplicateMode: 'absolute', fixNumbers: false, normalizeHeaders: false };

  test('absolute dedup 1k rows in under 50ms', () => {
    const data = generateDirtyData(1000);
    benchmark('dedup absolute 1k', () => Cleaner.apply(data, opts), 50);
  });

  test('absolute dedup 10k rows in under 200ms', () => {
    const data = generateDirtyData(10000);
    benchmark('dedup absolute 10k', () => Cleaner.apply(data, opts), 200);
  });

  test('absolute dedup 50k rows in under 1500ms', () => {
    const data = generateDirtyData(50000);
    benchmark('dedup absolute 50k', () => Cleaner.apply(data, opts), 1500);
  });

  test('absolute dedup 100k rows in under 3000ms', () => {
    const data = generateDirtyData(100000);
    benchmark('dedup absolute 100k', () => Cleaner.apply(data, opts), 3000);
  });
});

// ============================================================
// PERFORMANCE: Fix Number Formatting
// ============================================================
describe('Performance: Fix Number Formatting', () => {
  const opts = { trim: false, removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false, fixNumbers: true, normalizeHeaders: false };

  test('fix numbers 1k rows in under 50ms', () => {
    const data = generateData(1000);
    benchmark('fixNumbers 1k', () => Cleaner.apply(data, opts), 50);
  });

  test('fix numbers 10k rows in under 200ms', () => {
    const data = generateData(10000);
    benchmark('fixNumbers 10k', () => Cleaner.apply(data, opts), 200);
  });

  test('fix numbers 50k rows in under 1000ms', () => {
    const data = generateData(50000);
    benchmark('fixNumbers 50k', () => Cleaner.apply(data, opts), 1000);
  });

  test('fix numbers 100k rows in under 2000ms', () => {
    const data = generateData(100000);
    benchmark('fixNumbers 100k', () => Cleaner.apply(data, opts), 2000);
  });
});

// ============================================================
// PERFORMANCE: Normalize Headers
// ============================================================
describe('Performance: Normalize Headers', () => {
  const opts = { trim: false, removeEmptyRows: false, removeEmptyColumns: false, removeDuplicates: false, fixNumbers: false, normalizeHeaders: true };

  test('normalize headers 1k rows in under 10ms', () => {
    const data = generateData(1000);
    benchmark('normalizeHeaders 1k', () => Cleaner.apply(data, opts), 10);
  });

  test('normalize headers 100k rows in under 50ms', () => {
    // Header normalization should be O(cols) not O(rows), so this should be fast
    const data = generateData(100000);
    benchmark('normalizeHeaders 100k', () => Cleaner.apply(data, opts), 100);
  });
});

// ============================================================
// PERFORMANCE: Full Cleaning Pipeline (all options)
// ============================================================
describe('Performance: Full Cleaning Pipeline', () => {
  const allOn = {
    trim: true,
    removeEmptyRows: true,
    removeEmptyColumns: true,
    removeDuplicates: true,
    duplicateMode: 'keep-first',
    fixNumbers: true,
    normalizeHeaders: true,
  };

  test('full clean 1k rows in under 100ms', () => {
    const data = generateDirtyData(1000);
    benchmark('full pipeline 1k', () => Cleaner.apply(data, allOn), 100);
  });

  test('full clean 10k rows in under 500ms', () => {
    const data = generateDirtyData(10000);
    benchmark('full pipeline 10k', () => Cleaner.apply(data, allOn), 500);
  });

  test('full clean 50k rows in under 3000ms', () => {
    const data = generateDirtyData(50000);
    benchmark('full pipeline 50k', () => Cleaner.apply(data, allOn), 3000);
  });

  test('full clean 100k rows in under 6000ms', () => {
    const data = generateDirtyData(100000);
    benchmark('full pipeline 100k', () => Cleaner.apply(data, allOn), 6000);
  });
});

// ============================================================
// PERFORMANCE: Merging
// ============================================================
describe('Performance: Merging', () => {
  function makeParsedFiles(count, rowsPerFile) {
    return Array.from({ length: count }, (_, fi) => {
      const data = generateData(rowsPerFile);
      return { sheets: [{ name: `File${fi}`, data }] };
    });
  }

  test('merge 2 files x 1k rows in under 200ms', () => {
    const files = makeParsedFiles(2, 1000);
    benchmark('merge 2x1k', () => Merger.merge(files), 200);
  });

  test('merge 5 files x 1k rows in under 500ms', () => {
    const files = makeParsedFiles(5, 1000);
    benchmark('merge 5x1k', () => Merger.merge(files), 500);
  });

  test('merge 2 files x 10k rows in under 1000ms', () => {
    const files = makeParsedFiles(2, 10000);
    benchmark('merge 2x10k', () => Merger.merge(files), 1000);
  });

  test('merge 5 files x 10k rows in under 3000ms', () => {
    const files = makeParsedFiles(5, 10000);
    benchmark('merge 5x10k', () => Merger.merge(files), 3000);
  });

  test('merge 10 files x 1k rows in under 1000ms', () => {
    const files = makeParsedFiles(10, 1000);
    benchmark('merge 10x1k', () => Merger.merge(files), 1000);
  });
});

// ============================================================
// PERFORMANCE: Merge + Clean Pipeline
// ============================================================
describe('Performance: Merge + Clean Pipeline', () => {
  const allOn = {
    trim: true,
    removeEmptyRows: true,
    removeEmptyColumns: true,
    removeDuplicates: true,
    duplicateMode: 'keep-first',
    fixNumbers: true,
    normalizeHeaders: true,
  };

  function makeDirtyParsedFiles(count, rowsPerFile) {
    return Array.from({ length: count }, (_, fi) => {
      const data = generateDirtyData(rowsPerFile);
      return { sheets: [{ name: `File${fi}`, data }] };
    });
  }

  test('merge + clean 2 files x 1k in under 500ms', () => {
    const files = makeDirtyParsedFiles(2, 1000);
    benchmark('merge+clean 2x1k', () => {
      const merged = Merger.merge(files);
      merged.sheets.forEach((s) => { s.data = Cleaner.apply(s.data, allOn); });
      return merged;
    }, 500);
  });

  test('merge + clean 5 files x 1k in under 1500ms', () => {
    const files = makeDirtyParsedFiles(5, 1000);
    benchmark('merge+clean 5x1k', () => {
      const merged = Merger.merge(files);
      merged.sheets.forEach((s) => { s.data = Cleaner.apply(s.data, allOn); });
      return merged;
    }, 1500);
  });

  test('merge + clean 2 files x 10k in under 3000ms', () => {
    const files = makeDirtyParsedFiles(2, 10000);
    benchmark('merge+clean 2x10k', () => {
      const merged = Merger.merge(files);
      merged.sheets.forEach((s) => { s.data = Cleaner.apply(s.data, allOn); });
      return merged;
    }, 3000);
  });
});

// ============================================================
// PERFORMANCE: End-to-End (Parse CSV → Clean → Ready for Upload)
// ============================================================
describe('Performance: End-to-End (Parse → Clean → Upload-ready)', () => {
  const allOn = {
    trim: true,
    removeEmptyRows: true,
    removeEmptyColumns: true,
    removeDuplicates: true,
    duplicateMode: 'keep-first',
    fixNumbers: true,
    normalizeHeaders: true,
  };

  test('e2e single 1k row CSV in under 300ms', async () => {
    const data = generateDirtyData(1000);
    const file = makeCsvFile('dirty_1k.csv', data);
    await benchmarkAsync('e2e 1k CSV', async () => {
      const parsed = await Parser.parse(file);
      const cleaned = Cleaner.apply(parsed.sheets[0].data, allOn);
      return cleaned;
    }, 300);
  });

  test('e2e single 10k row CSV in under 2000ms', async () => {
    const data = generateDirtyData(10000);
    const file = makeCsvFile('dirty_10k.csv', data);
    await benchmarkAsync('e2e 10k CSV', async () => {
      const parsed = await Parser.parse(file);
      const cleaned = Cleaner.apply(parsed.sheets[0].data, allOn);
      return cleaned;
    }, 2000);
  });

  test('e2e single 50k row CSV in under 8000ms', async () => {
    const data = generateDirtyData(50000);
    const file = makeCsvFile('dirty_50k.csv', data);
    await benchmarkAsync('e2e 50k CSV', async () => {
      const parsed = await Parser.parse(file);
      const cleaned = Cleaner.apply(parsed.sheets[0].data, allOn);
      return cleaned;
    }, 8000);
  });

  test('e2e merge 3 files x 5k rows in under 5000ms', async () => {
    const files = Array.from({ length: 3 }, (_, i) => {
      const data = generateDirtyData(5000);
      return makeCsvFile(`file_${i}.csv`, data);
    });
    await benchmarkAsync('e2e merge 3x5k', async () => {
      const parsed = [];
      for (const f of files) {
        parsed.push(await Parser.parse(f));
      }
      const merged = Merger.merge(parsed);
      merged.sheets.forEach((s) => { s.data = Cleaner.apply(s.data, allOn); });
      return merged;
    }, 5000);
  });
});

// ============================================================
// PERFORMANCE: Separate Mode (Parse each → Clean → Upload-ready)
// ============================================================
describe('Performance: Separate Mode Pipeline', () => {
  const cleanOpts = {
    trim: true,
    removeEmptyRows: true,
    removeEmptyColumns: false,
    removeDuplicates: true,
    duplicateMode: 'keep-first',
    fixNumbers: true,
    normalizeHeaders: false,
  };

  test('separate mode: 5 files x 2k rows in under 3000ms', async () => {
    const files = Array.from({ length: 5 }, (_, i) => {
      const data = generateDirtyData(2000);
      return makeCsvFile(`sep_${i}.csv`, data);
    });
    await benchmarkAsync('separate 5x2k', async () => {
      const results = [];
      for (const f of files) {
        const parsed = await Parser.parse(f);
        const cleaned = Cleaner.apply(parsed.sheets[0].data, cleanOpts);
        results.push({ name: f.name, data: cleaned });
      }
      return results;
    }, 3000);
  });

  test('separate mode: 10 files x 1k rows in under 3000ms', async () => {
    const files = Array.from({ length: 10 }, (_, i) => {
      const data = generateDirtyData(1000);
      return makeCsvFile(`sep_${i}.csv`, data);
    });
    await benchmarkAsync('separate 10x1k', async () => {
      const results = [];
      for (const f of files) {
        const parsed = await Parser.parse(f);
        const cleaned = Cleaner.apply(parsed.sheets[0].data, cleanOpts);
        results.push({ name: f.name, data: cleaned });
      }
      return results;
    }, 3000);
  });
});

// ============================================================
// PERFORMANCE: No Cleaning (Baseline)
// ============================================================
describe('Performance: No Cleaning Baseline', () => {
  const noClean = {
    trim: false,
    removeEmptyRows: false,
    removeEmptyColumns: false,
    removeDuplicates: false,
    fixNumbers: false,
    normalizeHeaders: false,
  };

  test('no-clean shortcut 100k rows returns immediately (under 5ms)', () => {
    const data = generateData(100000);
    const start = hrtime();
    const result = Cleaner.apply(data, noClean);
    const ms = elapsed(start);
    // eslint-disable-next-line no-console
    console.log(`  [perf] no-clean bypass 100k: ${ms.toFixed(2)}ms`);
    // When all options are off, apply() should return data as-is (reference equality)
    expect(result).toBe(data);
    expect(ms).toBeLessThan(5);
  });
});

// ============================================================
// PERFORMANCE: CSV Preview (first 50 rows from large file)
// ============================================================
describe('Performance: CSV Preview', () => {
  test('preview first 50 rows from 10k row CSV in under 200ms', async () => {
    const data = generateData(10000);
    const file = makeCsvFile('preview_10k.csv', data);
    await benchmarkAsync('preview 10k CSV', () => Parser.preview(file, { sampleRows: 51 }), 200);
  });

  test('preview first 50 rows from 50k row CSV in under 1500ms', async () => {
    const data = generateData(50000);
    const file = makeCsvFile('preview_50k.csv', data);
    await benchmarkAsync('preview 50k CSV', () => Parser.preview(file, { sampleRows: 51 }), 1500);
  });
});

// ============================================================
// PERFORMANCE: getStats
// ============================================================
describe('Performance: getStats', () => {
  test('getStats on 100k row data in under 5ms', () => {
    const original = generateData(100000);
    const cleaned = generateData(90000);
    benchmark('getStats 100k', () => Cleaner.getStats(original, cleaned), 5);
  });
});

// ============================================================
// PERFORMANCE: Scaling Characteristics
// ============================================================
describe('Performance: Scaling (linear check)', () => {
  test('cleaning time scales roughly linearly with row count', () => {
    const opts = { trim: true, removeEmptyRows: true, removeEmptyColumns: false, removeDuplicates: true, duplicateMode: 'keep-first', fixNumbers: true, normalizeHeaders: false };

    const data5k = generateDirtyData(5000);
    const start5k = hrtime();
    Cleaner.apply(data5k, opts);
    const time5k = elapsed(start5k);

    const data20k = generateDirtyData(20000);
    const start20k = hrtime();
    Cleaner.apply(data20k, opts);
    const time20k = elapsed(start20k);

    const ratio = time20k / time5k;
    // eslint-disable-next-line no-console
    console.log(`  [perf] 5k: ${time5k.toFixed(1)}ms, 20k: ${time20k.toFixed(1)}ms, ratio: ${ratio.toFixed(2)}x (expected ~4x)`);
    // Should scale roughly linearly (4x data → ~4x time), allow up to 8x for overhead
    expect(ratio).toBeLessThan(8);
  });
});
