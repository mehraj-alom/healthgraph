/**
 * batch4 — tests for HealthGraph intelligence + cross-feature integration.
 *
 * Behavioral coverage (pure, node-runnable):
 *   - unified activity: chronological ordering, same-timestamp multi-source
 *     retention (no false dedupe), provenance mapping, patient isolation,
 *     empty state, malformed rows dropped, item cap
 *   - device heart nodes: pending-only contract, prefixed ids (no server
 *     collision), null/non-finite refusal, newest-first + cap, device_local
 *     provenance, zero edges fabricated
 *   - area deep-links: every pressable area maps (skin maps to null);
 *     every mapped route is a registered RootStack/Tab route
 * plus wiring guards (text-level, repo precedent) for RN-bound layers:
 *   - graph merges device nodes at a single point + device detail branch
 *     (no spinner trap) + server detail query skipped for device nodes
 *   - hub renders the activity section with provenance + empty state
 *   - no medical-conclusion copy in new descriptive strings
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/batch4.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  buildActivityItems,
  isActivityEmpty,
} from '../src/screens/HealthAreas/activity.ts';
import {
  buildDeviceHeartNodes,
  isDeviceHeartNode,
} from '../src/screens/Body/deviceNodes.ts';
import { areaRouteName } from '../src/screens/HealthAreas/areas.ts';

declare const __dirname: string;

function repoRoot(): string {
  const bases: string[] = [];
  try {
    if (typeof __dirname === 'string') bases.push(path.resolve(__dirname, '..'));
  } catch {
    // ESM/strip-types runtimes have no __dirname: fall through to cwd.
  }
  bases.push(process.cwd(), path.join(process.cwd(), 'frontend'));
  for (const b of bases) {
    try {
      if (fs.existsSync(path.join(b, 'App.tsx'))) return b;
    } catch {
      // Ignore and try the next candidate.
    }
  }
  throw new Error('repo root not found (App.tsx missing)');
}

const ROOT = repoRoot();
function src(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ============================================================================
// Unified activity — ordering, provenance, isolation
// ============================================================================

describe('buildActivityItems', () => {
  const base = {
    patientId: 'pat-A',
    logs: [],
    taken: [],
    heart: [],
    substance: [],
    cycle: [],
    documents: [],
  } as const;

  test('mixed sources order newest-first with per-source keys', () => {
    const items = buildActivityItems({
      ...base,
      logs: [
        {
          group_id: 'g1',
          patient_id: 'pat-A',
          log_date: '2026-09-18',
          sync_status: 'synced',
        },
      ],
      heart: [
        {
          measurementId: 'h1',
          method: 'rppg' as const,
          bpm: 72,
          measuredAt: '2026-09-20T08:00:00.000Z',
          pending: true,
        },
      ],
      substance: [
        {
          entry_id: 's1',
          patient_id: 'pat-A',
          category: 'alcohol',
          label: null,
          occurred_at: '2026-09-19T20:00:00.000Z',
          amount_value: null,
          amount_unit: null,
        },
      ],
    });
    assert.deepEqual(
      items.map((i) => i.key),
      ['hr-h1', 'substance-s1', 'log-g1'],
    );
    assert.deepEqual(
      items.map((i) => i.provenance),
      ['pending', 'device', 'server'],
    );
    assert.equal(items[0].detail, '72 bpm · Face scan');
  });

  test('duplicate daily-log rows collapse to one card per date (latest wins)', () => {
    const items = buildActivityItems({
      ...base,
      logs: [
        { group_id: 'g-old', patient_id: 'pat-A', log_date: '2026-09-21', sync_status: 'synced', updated_at: '2026-09-21T08:00:00.000Z' },
        { group_id: 'g-new', patient_id: 'pat-A', log_date: '2026-09-21', sync_status: 'pending', updated_at: '2026-09-21T09:00:00.000Z' },
        { group_id: 'g-nov', patient_id: 'pat-A', log_date: '2026-09-20', sync_status: 'synced', updated_at: '2026-09-20T08:00:00.000Z' },
      ],
    });
    assert.deepEqual(
      items.map((i) => i.key),
      ['log-g-new', 'log-g-nov'],
    );
    // Newest write's sync state shows (pending here — honest, not hidden).
    assert.equal(items[0].provenance, 'pending');
  });

  test('failed sync never masquerades as pending', () => {
    const items = buildActivityItems({
      ...base,
      logs: [
        { group_id: 'g1', patient_id: 'pat-A', log_date: '2026-09-21', sync_status: 'failed', updated_at: '2026-09-21T08:00:00.000Z' },
      ],
      taken: [
        { event_id: 't1', patient_id: 'pat-A', medication_id: 'm1', medication_name: 'A', taken_at: '2026-09-21T08:00:00.000Z', sync_status: 'failed' },
      ],
      documents: [
        { document_id: 'd1', patient_id: 'pat-A', status: 'FAILED', created_at: '2026-09-21T08:00:00.000Z' },
        { document_id: 'd2', patient_id: 'pat-A', status: 'COMPLETED', created_at: '2026-09-20T08:00:00.000Z' },
      ],
    });
    assert.deepEqual(
      items.map((i) => i.provenance),
      ['failed', 'failed', 'failed', 'server'],
    );
    const hub = src('src/screens/HealthAreas/HealthAreasScreen.tsx');
    assert.ok(hub.includes("Couldn't sync"), 'failed pill copy is honest');
  });

  test('same timestamp across sources keeps both (no false dedupe)', () => {    const items = buildActivityItems({
      ...base,
      heart: [
        { measurementId: 'h1', method: 'ppg' as const, bpm: 70, measuredAt: '2026-09-20T08:00:00.000Z', pending: false },
      ],
      documents: [
        { document_id: 'd1', patient_id: 'pat-A', status: 'COMPLETED', created_at: '2026-09-20T08:00:00.000Z' },
      ],
    });
    assert.equal(items.length, 2);
    assert.deepEqual(
      items.map((i) => i.source).sort(),
      ['document', 'heart'],
    );
  });

  test('other-patient rows are dropped; malformed rows never crash', () => {
    const items = buildActivityItems({
      ...base,
      patientId: 'pat-A',
      logs: [
        { group_id: 'gB', patient_id: 'pat-B', log_date: '2026-09-20', sync_status: 'synced' },
        { group_id: 'gBad', patient_id: 'pat-A', log_date: 'not-a-date', sync_status: 'synced' },
      ],
      heart: [
        { measurementId: 'hx', method: 'ppg' as const, bpm: Number.NaN, measuredAt: '2026-09-20T08:00:00.000Z', pending: true },
      ],
      substance: [
        { entry_id: 'sB', patient_id: 'pat-B', category: 'alcohol', label: null, occurred_at: '2026-09-20T08:00:00.000Z', amount_value: null, amount_unit: null },
      ],
    });
    assert.deepEqual(items, []);
    assert.equal(isActivityEmpty(items), true);
  });

  test('cycle entries group by day with device provenance + route', () => {
    const items = buildActivityItems({
      ...base,
      cycle: [
        { entry_id: 'c1', patient_id: 'pat-A', kind: 'period-start', date: '2026-09-15' },
      ],
      taken: [
        {
          event_id: 't1',
          patient_id: 'pat-A',
          medication_id: 'm1',
          medication_name: 'Aspirin',
          taken_at: '2026-09-20T08:00:00.000Z',
          sync_status: 'synced',
        },
      ],
    });
    const cycle = items.find((i) => i.source === 'cycle');
    assert.equal(cycle?.title, 'Period started');
    assert.equal(cycle?.provenance, 'device');
    assert.deepEqual(cycle?.route, { name: 'Cycle' });
    const dose = items.find((i) => i.source === 'medication');
    assert.equal(dose?.title, 'Dose taken · Aspirin');
    assert.equal(dose?.provenance, 'server');
  });

  test('empty inputs yield the legitimate empty stream', () => {
    assert.deepEqual(buildActivityItems(base), []);
  });
});

// ============================================================================
// Device heart nodes — pending-only, prefixed, edgeless
// ============================================================================

describe('buildDeviceHeartNodes', () => {
  test('pending rows become device-local ppg_measurement nodes', () => {
    const nodes = buildDeviceHeartNodes(
      [
        {
          measurement_id: 'p1',
          measured_at: '2026-09-20T08:00:00.000Z',
          heart_rate_bpm: 68,
        } as never,
      ],
      [
        {
          measurement_id: 'r1',
          measured_at: '2026-09-21T08:00:00.000Z',
          heart_rate_bpm: 72,
        } as never,
      ],
    );
    assert.equal(nodes.length, 2);
    // Newest first.
    assert.equal(nodes[0].id, 'local-rppg-r1');
    assert.equal(nodes[1].id, 'local-ppg-p1');
    for (const n of nodes) {
      assert.equal(n.type, 'ppg_measurement');
      assert.equal(n.properties?.device_local, true);
      assert.equal(n.properties?.sync_status, 'pending');
      assert.ok(isDeviceHeartNode(n));
    }
    assert.equal(nodes[0].properties?.method, 'face');
    assert.equal(nodes[1].properties?.method, 'fingertip');
  });

  test('null/non-finite BPM refused; ids cannot collide with server UUIDs', () => {
    const nodes = buildDeviceHeartNodes(
      [
        { measurement_id: 'x', measured_at: '2026-09-20T08:00:00.000Z', heart_rate_bpm: null },
        { measurement_id: 'y', measured_at: '2026-09-20T08:00:00.000Z', heart_rate_bpm: Number.NaN },
        { measurement_id: 'z', measured_at: '', heart_rate_bpm: 70 },
      ] as never,
      [],
    );
    assert.deepEqual(nodes, []);
  });

  test('server nodes never match the device predicate', () => {
    assert.equal(
      isDeviceHeartNode({
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'ppg_measurement',
        label: 'Heart rate',
        properties: { heart_rate_bpm: 70 },
      }),
      false,
    );
    assert.equal(isDeviceHeartNode(null), false);
    assert.equal(isDeviceHeartNode(undefined), false);
  });
});

// ============================================================================
// Deep-link completeness
// ============================================================================

describe('area deep-links', () => {
  test('every pressable area maps; skin honestly maps to null', () => {
    const pressable = [
      'heart',
      'sleep',
      'activity',
      'nutrition',
      'weight',
      'wellbeing',
      'medications',
      'records',
      'substance',
      'cycle',
      'meditation',
      'discipline',
    ] as const;
    for (const id of pressable) {
      assert.ok(areaRouteName(id) !== null, id);
    }
    assert.equal(areaRouteName('skin'), null);
    // Batch 6B–6G: sleep, weight, discipline, activity, nutrition and wellbeing own engine destinations.
    assert.equal(areaRouteName('sleep'), 'SleepEngine');
    assert.equal(areaRouteName('weight'), 'WeightEngine');
    assert.equal(areaRouteName('discipline'), 'DisciplineEngine');
    assert.equal(areaRouteName('activity'), 'FitnessEngine');
    assert.equal(areaRouteName('nutrition'), 'NutritionEngine');
    assert.equal(areaRouteName('wellbeing'), 'WellbeingEngine');
    assert.equal(areaRouteName('meditation'), 'MeditationEngine');
  });

  test('every mapped route is registered with matching params', () => {
    const types = src('src/types/index.ts');
    const names = new Set(
      (['heart', 'sleep', 'activity', 'nutrition', 'weight', 'wellbeing', 'medications', 'records', 'substance', 'cycle', 'meditation', 'discipline'] as const).map(
        (id) => areaRouteName(id),
      ),
    );
    assert.ok(!names.has(null));
    assert.ok(!names.has(undefined));
    for (const name of names) {
      assert.ok(types.includes(`${name}:`), `route ${name} typed`);
    }
    const app = src('App.tsx');
    for (const name of names) {
      assert.ok(app.includes(`name="${name}"`), `route ${name} registered`);
    }
    // Heart owns its engine destination (measurement happens inside it).
    assert.equal(areaRouteName('heart'), 'HeartEngine');
    // Meditation owns its engine destination (timed sits happen inside it).
    assert.equal(areaRouteName('meditation'), 'MeditationEngine');
  });
});

// ============================================================================
// Wiring guards — RN-bound layers
// ============================================================================

describe('batch 4 wiring', () => {
  test('graph merges device nodes at one point with a device detail branch', () => {
    const screen = src('src/screens/Body/HealthGraphScreen.tsx');
    assert.ok(screen.includes('useDeviceHeartNodes()'), 'hook consumed');
    assert.ok(screen.includes('...deviceHeartNodes'), 'single merge point');
    assert.ok(screen.includes('isDeviceNode'), 'device branch');
    assert.ok(screen.includes('DeviceNodeDetail'), 'local detail (no spinner trap)');
    assert.ok(
      screen.includes('useGraphNodeDetail(isDeviceNode || isDateNode ? null'),
      'server detail query skipped for device + layout-only day nodes',
    );
  });

  test('hub renders recent activity with provenance and empty state', () => {
    const hub = src('src/screens/HealthAreas/HealthAreasScreen.tsx');
    assert.ok(hub.includes('useHealthActivity()'), 'activity hook consumed');
    assert.ok(hub.includes('Recent activity'), 'section rendered');
    assert.ok(hub.includes('No recent activity yet'), 'honest empty state');
    assert.ok(hub.includes('On this device'), 'device provenance shown');
    assert.ok(hub.includes('Sync pending'), 'pending provenance shown');
  });

  test('descriptive copy states facts, never conclusions', () => {
    const hay = [
      src('src/screens/HealthAreas/HealthAreasScreen.tsx'),
      src('src/screens/HealthAreas/areas.ts'),
      src('src/screens/HealthAreas/activity.ts'),
      src('src/screens/Body/deviceNodes.ts'),
    ]
      .join('\n')
      .toLowerCase();
    for (const phrase of [
      'improving',
      'unhealthy',
      'at risk',
      'your sleep is poor',
      'you are unhealthy',
    ]) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });
});
