/**
 * deviceExport.test.mts — user CSV export (node --experimental-strip-types).
 *
 * The long-format builder runs directly (services/deviceExport.ts is
 * zero-import). The RN layer (deviceExportShare.ts, Settings wiring) is
 * pinned by source-text contract. Absences (no server data, no zip, no
 * email, no analytics) are tested as absences.
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/deviceExport.test.mts
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildExportRows,
  exportFileName,
  toCsv,
  type DeviceExportInput,
} from '../src/services/deviceExport.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const EMPTY: DeviceExportInput = {
  meditation: [],
  substance: [],
  cravings: [],
  cycle: [],
  ppg: [],
  rppg: [],
  foodItems: [],
  dailyLogs: [],
  medications: [],
  taken: [],
};

// ============================================================================
// CSV encoding — pure
// ============================================================================

describe('csv encoding', () => {
  test('header-only when there are no rows', () => {
    assert.equal(toCsv([]), 'date,domain,metric,value,unit,note\r\n');
  });

  test('commas, quotes and newlines are escaped', () => {
    const csv = toCsv([
      { date: '2026-10-14', domain: 'daily-log', metric: 'note', value: 'said "hi", then\nleft', unit: null, note: null },
    ]);
    assert.ok(csv.includes('"said ""hi"", then\nleft"'), 'quoted cell');
    const lines = csv.trim().split('\r\n');
    assert.equal(lines.length, 2);
  });

  test('null unit/note become empty cells', () => {
    const csv = toCsv([
      { date: '2026-10-14', domain: 'cycle', metric: 'period-start', value: '1', unit: null, note: null },
    ]);
    assert.ok(csv.includes('2026-10-14,cycle,period-start,1,,'), 'empty cells');
  });

  test('filename is stable and sortable', () => {
    assert.equal(exportFileName('2026-10-14'), 'healthgraph-export-2026-10-14.csv');
    assert.equal(exportFileName('garbage'), 'healthgraph-export-undated.csv');
  });
});

// ============================================================================
// Row building — pure
// ============================================================================

describe('export rows', () => {
  test('every domain maps to long-format rows', () => {
    const rows = buildExportRows({
      ...EMPTY,
      meditation: [
        { started_at: '2026-10-14T08:00:00.000Z', preset_min: 10, duration_sec: 600, completed: 1, notes: 'quiet' },
      ],
      substance: [
        { occurred_at: '2026-10-13T19:30:00', category: 'alcohol', amount_value: 2, amount_unit: 'drinks', notes: null },
      ],
      cravings: [
        { occurred_at: '2026-10-13T20:00:00', category: 'tobacco', intensity: 3, outcome: null, notes: null },
      ],
      cycle: [{ date: '2026-10-12', kind: 'period-start', notes: null }],
      ppg: [{ measured_at: '2026-10-14T07:00:00.000Z', heart_rate_bpm: 62, rmssd_ms: 41 }],
      rppg: [{ measured_at: '2026-10-14T07:05:00.000Z', heart_rate_bpm: 63 }],
      foodItems: [{ log_date: '2026-10-14', label: 'Oats', kcal: 310, barcode: '400123' }],
      dailyLogs: [
        {
          log_date: '2026-10-14', overall_wellbeing: 4, energy_level: null,
          stress_level: 2, sleep_duration_minutes: 420, water_ml: null,
          meals_count: 3, calories_kcal: 2100, food_label: 'home cooking', notes: null,
        },
      ],
      medications: [{ name: 'Vitamin D', status: 'ACTIVE', frequency: 'daily' }],
      taken: [{ taken_at: '2026-10-14T08:05:00.000Z', medication_name: 'Vitamin D', status: 'taken' }],
    });
    const byDomain = new Map<string, number>();
    for (const r of rows) byDomain.set(r.domain, (byDomain.get(r.domain) ?? 0) + 1);
    for (const d of ['meditation', 'substance', 'craving', 'cycle', 'ppg', 'rppg', 'food', 'daily-log', 'medication', 'medication-taken']) {
      assert.ok((byDomain.get(d) ?? 0) > 0, `domain ${d}`);
    }
    // PPG fans out to heart-rate + HRV rows.
    assert.equal(byDomain.get('ppg'), 2);
    // Food label rides on the calories row.
    const calories = rows.find((r) => r.metric === 'calories');
    assert.equal(calories?.note, 'home cooking');
    // Sorted ascending by date.
    const dates = rows.map((r) => r.date);
    assert.deepEqual(dates, [...dates].sort());
  });

  test('null measurements are absent, never zero', () => {
    const rows = buildExportRows({
      ...EMPTY,
      ppg: [{ measured_at: '2026-10-14T07:00:00.000Z', heart_rate_bpm: null, rmssd_ms: null }],
      dailyLogs: [
        {
          log_date: '2026-10-14', overall_wellbeing: null, energy_level: null,
          stress_level: null, sleep_duration_minutes: null, water_ml: null,
          meals_count: null, calories_kcal: null, food_label: null, notes: null,
        },
      ],
    });
    assert.equal(rows.length, 0);
  });

  test('early-ended sits are marked, not counted as full', () => {
    const rows = buildExportRows({
      ...EMPTY,
      meditation: [
        { started_at: '2026-10-14T08:00:00.000Z', preset_min: 10, duration_sec: 120, completed: 0, notes: null },
      ],
    });
    assert.equal(rows.length, 1);
    assert.ok(rows[0]?.value.includes('/early'), 'early flag');
  });
});

// ============================================================================
// RN-bound layers — source-text contracts + absences
// ============================================================================

describe('export wiring contracts', () => {
  test('share layer writes a temp CSV and opens the sheet', () => {
    const wiring = src('src/services/deviceExportShare.ts');
    assert.ok(wiring.includes('expo-file-system/legacy'), 'legacy FS write');
    assert.ok(wiring.includes('writeAsStringAsync'), 'string write');
    assert.ok(wiring.includes('expo-sharing'), 'share sheet');
    assert.ok(wiring.includes('text/csv'), 'csv mime');
    assert.ok(wiring.includes('deleteAsync'), 'temp file wiped');
    assert.ok(wiring.includes('Nothing to export yet'), 'empty guard');
  });

  test('collection is per-table best-effort', () => {
    const wiring = src('src/services/deviceExportShare.ts');
    assert.ok(wiring.includes('quiet('), 'best-effort collector');
    assert.ok(wiring.includes('catch'), 'failures contained per table');
  });

  test('settings exposes the export next to deletion', () => {
    const settings = src('src/screens/Settings/SettingsScreen.tsx');
    assert.ok(settings.includes('Export my data (CSV)'), 'export row');
    assert.ok(settings.includes('exportAndShareDeviceCsv'), 'wiring used');
  });

  test('absences: no server bundle, no zip, no email, no analytics', () => {
    const builder = src('src/services/deviceExport.ts');
    for (const word of ['/privacy/export', 'fetch(', 'XMLHttpRequest']) {
      assert.ok(!builder.includes(word), `builder: ${word}`);
    }
    const wiring = src('src/services/deviceExportShare.ts');
    for (const word of ['jszip', 'mailto:', 'analytics', 'firebase']) {
      assert.ok(!wiring.includes(word), `wiring: ${word}`);
    }
  });
});
