/**
 * exerciseDistance.test.mts — workout distance + pace (node --experimental-strip-types).
 *
 * Distance mapping and fitness math run directly (mapping.ts and
 * fitnessEngine.ts are zero-import). The adapter/importer/storage/UI
 * layers are pinned by source-text contract. Absences (no GPS tracks,
 * no maps, no location permission, no targets) are tested as absences.
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/exerciseDistance.test.mts
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  mapDistanceRecord,
  sumDistanceKm,
} from '../src/services/healthConnect/mapping.ts';
import {
  formatDistanceKm,
  formatPace,
  paceMinPerKm,
  summarizeFitness,
} from '../src/screens/FitnessEngine/fitnessEngine.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ============================================================================
// Distance mapping — pure
// ============================================================================

describe('distance mapping', () => {
  test('adapter-normalized km accepted', () => {
    const m = mapDistanceRecord({
      startTime: '2026-10-14T07:00:00Z',
      endTime: '2026-10-14T07:10:00Z',
      distanceKm: 1.5,
    });
    assert.deepEqual(m, {
      startMs: Date.parse('2026-10-14T07:00:00Z'),
      endMs: Date.parse('2026-10-14T07:10:00Z'),
      km: 1.5,
    });
  });

  test('raw Health Connect distance shapes convert', () => {
    const meters = mapDistanceRecord({
      startTime: '2026-10-14T07:00:00Z',
      endTime: '2026-10-14T07:10:00Z',
      distance: { value: 1500, unit: 'meters' },
    });
    assert.equal(meters?.km, 1.5);
    const miles = mapDistanceRecord({
      startTime: '2026-10-14T07:00:00Z',
      endTime: '2026-10-14T07:10:00Z',
      distance: { value: 1, unit: 'miles' },
    });
    assert.equal(miles?.km, 1.61);
  });

  test('malformed and absurd records rejected', () => {
    assert.equal(mapDistanceRecord(null), null);
    assert.equal(
      mapDistanceRecord({ startTime: 'garbage', endTime: '2026-10-14T07:10:00Z', distanceKm: 1 }),
      null,
    );
    assert.equal(
      mapDistanceRecord({ startTime: '2026-10-14T07:00:00Z', endTime: '2026-10-14T07:10:00Z', distanceKm: -2 }),
      null,
    );
    assert.equal(
      mapDistanceRecord({ startTime: '2026-10-14T07:00:00Z', endTime: '2026-10-14T07:10:00Z', distanceKm: 5000 }),
      null,
    );
    assert.equal(
      mapDistanceRecord({ startTime: '2026-10-14T07:00:00Z', endTime: '2026-10-14T07:10:00Z' }),
      null,
    );
  });

  test('session sum uses containment, null when empty', () => {
    const records = [
      { startTime: '2026-10-14T07:05:00Z', endTime: '2026-10-14T07:10:00Z', distanceKm: 1 },
      { startTime: '2026-10-14T07:10:00Z', endTime: '2026-10-14T07:20:00Z', distanceKm: 2 },
      // Straddles the session edge — not contained, not counted.
      { startTime: '2026-10-14T06:55:00Z', endTime: '2026-10-14T07:05:00Z', distanceKm: 9 },
    ];
    assert.equal(
      sumDistanceKm(records, '2026-10-14T07:00:00Z', '2026-10-14T07:30:00Z'),
      3,
    );
    assert.equal(sumDistanceKm([], '2026-10-14T07:00:00Z', '2026-10-14T07:30:00Z'), null);
    assert.equal(sumDistanceKm(records, 'garbage', '2026-10-14T07:30:00Z'), null);
  });
});

// ============================================================================
// Pace math — pure, descriptive only
// ============================================================================

describe('pace math', () => {
  test('pace needs both duration and positive distance', () => {
    assert.equal(paceMinPerKm({ durationMinutes: 30, distanceKm: 5 }), 6);
    assert.equal(paceMinPerKm({ durationMinutes: null, distanceKm: 5 }), null);
    assert.equal(paceMinPerKm({ durationMinutes: 30, distanceKm: null }), null);
    assert.equal(paceMinPerKm({ durationMinutes: 30, distanceKm: 0 }), null);
  });

  test('pace and distance format honestly', () => {
    assert.equal(formatPace(6), '6:00 /km');
    assert.equal(formatPace(8.4), '8:24 /km');
    assert.equal(formatPace(null), null);
    assert.equal(formatDistanceKm(12.44), '12.4 km');
    assert.equal(formatDistanceKm(null), null);
  });

  test('summary totals distance, null when none logged', () => {
    const withKm = summarizeFitness([
      { date: '2026-10-14', type: 'running', durationMinutes: 30, caloriesLogged: null, distanceKm: 5 },
      { date: '2026-10-13', type: 'yoga', durationMinutes: 20, caloriesLogged: null, distanceKm: null },
    ]);
    assert.equal(withKm.distanceKm, 5);
    const without = summarizeFitness([
      { date: '2026-10-14', type: 'yoga', durationMinutes: 20, caloriesLogged: null, distanceKm: null },
    ]);
    assert.equal(without.distanceKm, null);
  });
});

// ============================================================================
// Wiring contracts + absences
// ============================================================================

describe('distance wiring contracts', () => {
  test('importer attaches distance without touching dedupe', () => {
    const importer = src('src/services/healthConnect/importer.ts');
    assert.ok(importer.includes('readDistance'), 'distance read');
    assert.ok(importer.includes('sumDistanceKm'), 'session attribution');
    assert.ok(importer.includes('distance_km: frag.distanceKm'), 'payload attach');
    const wiring = src('src/services/healthConnect/importWiring.ts');
    assert.ok(wiring.includes('distance_km'), 'storage write');
    const adapter = src('src/services/healthConnect/nativeAdapter.ts');
    assert.ok(adapter.includes("recordType: 'Distance'"), 'Distance permission requested');
  });

  test('manual entries share the same field', () => {
    const form = src('src/screens/VitalsLogger/VitalsLoggerScreen.tsx');
    assert.ok(form.includes('Distance in km (optional)'), 'form input');
    const detail = src('src/types/index.ts');
    assert.ok(detail.includes('distance_km'), 'shared contract type');
  });

  test('fitness UI shows distance and pace', () => {
    const screen = src('src/screens/FitnessEngine/FitnessEngineScreen.tsx');
    assert.ok(screen.includes('formatDistanceKm'), 'distance line');
    assert.ok(screen.includes('formatPace'), 'pace line');
  });

  test('consent covers the new record type', () => {
    assert.ok(src('src/services/healthConnect/consent.ts').includes("'distance'"), 'known type');
    assert.ok(
      src('src/services/healthConnect/disclosure.ts').includes('workout'),
      'disclosure names workouts',
    );
    assert.ok(
      src('src/services/healthConnect/disclosure.ts').includes('distance'),
      'disclosure names distances',
    );
  });

  test('absences: no GPS tracks, no maps, no location permission', () => {
    const adapter = src('src/services/healthConnect/nativeAdapter.ts');
    assert.ok(!adapter.includes('ExerciseRoute'), 'no route reads');
    assert.ok(!adapter.includes('ACCESS_FINE_LOCATION'), 'no location permission');
    assert.ok(!adapter.includes('ACCESS_COARSE_LOCATION'), 'no location permission');
    const pkg = src('package.json');
    assert.ok(!pkg.includes('react-native-maps'), 'no maps dep');
    const manifest = src('app.json');
    assert.ok(!manifest.includes('ACCESS_FINE_LOCATION'), 'no manifest location');
  });
});
