/**
 * healthConnectImport.test.mts — import pipeline (node --experimental-strip-types).
 *
 * The importer orchestrates with every side effect injected (storage,
 * adapter, day store, clock), so the whole sync converges here with fakes:
 * consent gating, 30-day window clamping, watermark idempotency, manual-data
 * protection (import never overwrites a manual sleep), duplicate-activity
 * skipping, malformed-record tolerance, and weight/steps deferral.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  IMPORTED_DATA_TYPES,
  WATERMARK_STORAGE_KEY,
  loadWatermark,
  runHealthConnectImport,
  type ImportAdapter,
  type ImportDayDetail,
  type ImportStore,
} from '../src/services/healthConnect/importer.ts';
import { CONSENT_TEXT_VERSION, grantConsent } from '../src/services/healthConnect/consent.ts';
import type { ConsentStoragePort } from '../src/services/healthConnect/consent.ts';
import { mapExerciseSession } from '../src/services/healthConnect/mapping.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NOW = '2026-10-01T12:00:00Z';

function memStorage(initial?: Record<string, string>): ConsentStoragePort {
  const store = new Map(Object.entries(initial ?? {}));
  return {
    getItem: async (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: async (k: string, v: string) => void store.set(k, v),
    removeItem: async (k: string) => void store.delete(k),
  };
}

interface MergeCall {
  logDate: string;
  overlay: { sleep_minutes?: number };
}
interface InsertCall {
  groupId: string;
  eventTime: string;
  activity: { activity_type: string; duration_minutes: number; calories_burned: number | null };
}

function fakeStore(
  details: Record<string, ImportDayDetail | null>,
  opts?: { weightConcept?: string | null },
): ImportStore & {
  merges: MergeCall[];
  inserts: InsertCall[];
  refreshes: number;
  savedSteps: { logDate: string; steps: number }[];
} {
  const merges: MergeCall[] = [];
  const inserts: InsertCall[] = [];
  const savedSteps: { logDate: string; steps: number }[] = [];
  let refreshes = 0;
  return {
    merges,
    inserts,
    savedSteps,
    refreshes: 0,
    get refreshCount() {
      return refreshes;
    },
    async getDetail(logDate: string) {
      return details[logDate] ?? null;
    },
    async mergeDay(logDate: string, overlay: { sleep_minutes?: number }) {
      merges.push({ logDate, overlay });
      return `group-${logDate}`;
    },
    async insertActivity(groupId: string, eventTime: string, activity: InsertCall['activity']) {
      inserts.push({ groupId, eventTime, activity });
    },
    async resolveWeightConcept() {
      return opts?.weightConcept ?? null;
    },
    async saveSteps(logDate: string, steps: number) {
      savedSteps.push({ logDate, steps });
    },
    refresh() {
      refreshes += 1;
    },
    nowISO() {
      return NOW;
    },
  } as unknown as ImportStore & { merges: MergeCall[]; inserts: InsertCall[]; refreshes: number; savedSteps: { logDate: string; steps: number }[] };
}

function readyAdapter(sleep: unknown[] = [], exercise: unknown[] = []): ImportAdapter & {
  reads: { kind: string; start: string; end: string }[];
} {
  const reads: { kind: string; start: string; end: string }[] = [];
  return {
    reads,
    isAvailable: () => true,
    ensurePermissions: async () => true,
    readSleep: async (start: string, end: string) => {
      reads.push({ kind: 'sleep', start, end });
      return sleep;
    },
    readExercise: async (start: string, end: string) => {
      reads.push({ kind: 'exercise', start, end });
      return exercise;
    },
    readWeight: async (start: string, end: string) => {
      reads.push({ kind: 'weight', start, end });
      return [];
    },
    readSteps: async (start: string, end: string) => {
      reads.push({ kind: 'steps', start, end });
      return [];
    },
  };
}

const SLEEP = { startTime: '2026-09-30T22:30:00Z', endTime: '2026-10-01T06:30:00Z' };
const RUN = { startTime: '2026-09-30T07:00:00Z', endTime: '2026-09-30T07:30:00Z', exerciseType: 'RUNNING' };

// ============================================================================
// Gating — no consent or no adapter means no reads, no writes
// ============================================================================

describe('import gating', () => {
  test('blocked without consent: adapter never touched, store never touched', async () => {
    const storage = memStorage();
    const adapter = readyAdapter([SLEEP], [RUN]);
    const store = fakeStore({});
    const report = await runHealthConnectImport({ storage, adapter, store });
    assert.equal(report.status, 'blocked');
    assert.deepEqual(adapter.reads, []);
    assert.deepEqual(store.merges, []);
    assert.deepEqual(store.inserts, []);
  });

  test('blocked when the adapter is unavailable', async () => {
    const storage = memStorage();
    await grantConsent(storage, ['sleep', 'exercise']);
    const adapter = readyAdapter();
    adapter.isAvailable = () => false;
    const store = fakeStore({});
    const report = await runHealthConnectImport({ storage, adapter, store });
    assert.equal(report.status, 'blocked');
    assert.deepEqual(store.merges, []);
  });

  test('blocked when Health Connect permission is denied', async () => {
    const storage = memStorage();
    await grantConsent(storage, ['sleep', 'exercise']);
    const adapter = readyAdapter([SLEEP], [RUN]);
    adapter.ensurePermissions = async () => false;
    const store = fakeStore({});
    const report = await runHealthConnectImport({ storage, adapter, store });
    assert.equal(report.status, 'blocked');
    assert.equal(report.reason, 'permission-denied');
    assert.deepEqual(store.merges, []);
  });
});

// ============================================================================
// Happy path — sleep overlay plus appended workout, watermark advances
// ============================================================================

describe('happy path import', () => {
  test('sleep fills an empty day, workout appends, watermark advances', async () => {
    const storage = memStorage();
    await grantConsent(storage, ['sleep', 'exercise']);
    const adapter = readyAdapter([{ ...SLEEP, uid: 's1' }], [{ ...RUN, uid: 'e1' }]);
    const store = fakeStore({});
    const report = await runHealthConnectImport({ storage, adapter, store });
    assert.equal(report.status, 'ok');
    assert.equal(report.sleepImported, 1);
    assert.equal(report.activitiesImported, 1);
    assert.deepEqual(store.merges, [
      { logDate: '2026-10-01', overlay: { sleep_minutes: 480 } },
      { logDate: '2026-09-30', overlay: {} },
    ]);
    assert.equal(store.inserts.length, 1);
    assert.equal(store.inserts[0].activity.activity_type, 'running');
    assert.equal(store.inserts[0].groupId, 'group-2026-09-30');
    const watermark = await loadWatermark(storage);
    assert.equal(watermark.sleep, NOW);
    assert.equal(watermark.exercise, NOW);
  });

  test('manual sleep wins: import never overwrites a hand-logged night', async () => {
    const storage = memStorage();
    await grantConsent(storage, ['sleep', 'exercise']);
    const adapter = readyAdapter([{ ...SLEEP, uid: 's1' }], []);
    const store = fakeStore({
      '2026-10-01': { group_id: 'g1', sleep_duration_minutes: 420, vitals: [], activities: [] },
    });
    const report = await runHealthConnectImport({ storage, adapter, store });
    assert.equal(report.status, 'ok');
    assert.equal(report.sleepImported, 0);
    assert.deepEqual(store.merges, []);
  });

  test('identical workout already logged is not duplicated', async () => {
    const storage = memStorage();
    await grantConsent(storage, ['sleep', 'exercise']);
    const adapter = readyAdapter([], [{ ...RUN, uid: 'e1' }]);
    const store = fakeStore({
      '2026-09-30': {
        group_id: 'g1',
        sleep_duration_minutes: null,
        vitals: [],
        activities: [{ activity_type: 'running', duration_minutes: 30, calories_burned: null }],
      },
    });
    const report = await runHealthConnectImport({ storage, adapter, store });
    assert.equal(report.status, 'ok');
    assert.equal(report.activitiesImported, 0);
    assert.deepEqual(store.inserts, []);
  });

  test('malformed records are dropped while valid ones still import', async () => {
    const storage = memStorage();
    await grantConsent(storage, ['sleep', 'exercise']);
    const adapter = readyAdapter(
      [{ uid: 'bad', startTime: 'garbage', endTime: '2026-10-01T06:30:00Z' }, { ...SLEEP, uid: 's1' }],
      [],
    );
    const store = fakeStore({});
    const report = await runHealthConnectImport({ storage, adapter, store });
    assert.equal(report.status, 'ok');
    assert.equal(report.sleepImported, 1);
    assert.equal(report.dropped, 1);
  });
});

// ============================================================================
// Watermark — idempotent reruns, 30-day clamp
// ============================================================================

describe('watermark idempotency', () => {
  test('second run over the same window reads nothing new and saves nothing', async () => {
    const storage = memStorage();
    await grantConsent(storage, ['sleep', 'exercise']);
    const adapter = readyAdapter([{ ...SLEEP, uid: 's1' }], [{ ...RUN, uid: 'e1' }]);
    const store = fakeStore({});
    await runHealthConnectImport({ storage, adapter, store });
    const second = await runHealthConnectImport({ storage, adapter, store });
    assert.equal(second.status, 'ok');
    assert.equal(second.sleepImported, 0);
    assert.equal(second.activitiesImported, 0);
    // Empty reads: nothing after the watermark.
    assert.deepEqual(adapter.reads.slice(4), [
      { kind: 'sleep', start: NOW, end: NOW },
      { kind: 'exercise', start: NOW, end: NOW },
      { kind: 'weight', start: NOW, end: NOW },
      { kind: 'steps', start: NOW, end: NOW },
    ]);
  });

  test('ancient watermark clamps the window to 30 days (bounded load)', async () => {
    const storage = memStorage();
    await grantConsent(storage, ['sleep', 'exercise']);
    await storage.setItem(
      WATERMARK_STORAGE_KEY,
      JSON.stringify({ sleep: '2020-01-01T00:00:00Z', exercise: null }),
    );
    const adapter = readyAdapter([], []);
    const store = fakeStore({});
    await runHealthConnectImport({ storage, adapter, store });
    assert.equal(adapter.reads[0].start, '2026-09-01T12:00:00.000Z');
  });
});

// ============================================================================
// Scope — Slice 2 imports sleep + exercise only
// ============================================================================

describe('slice 3 scope', () => {
  test('imported types are sleep, exercise, weight, and steps', () => {
    assert.deepEqual(IMPORTED_DATA_TYPES, ['sleep', 'exercise', 'weight', 'steps']);
  });

  test('extended exercise names map to friendly labels', () => {
    assert.equal(
      mapExerciseSession({ uid: 'x', startTime: '2026-09-30T07:00:00Z', endTime: '2026-09-30T08:00:00Z', exerciseType: 'SWIMMING_POOL' })?.activity_type,
      'swimming',
    );
    assert.equal(
      mapExerciseSession({ uid: 'x', startTime: '2026-09-30T07:00:00Z', endTime: '2026-09-30T08:00:00Z', exerciseType: 'BIKING' })?.activity_type,
      'cycling',
    );
    assert.equal(
      mapExerciseSession({ uid: 'x', startTime: '2026-09-30T07:00:00Z', endTime: '2026-09-30T08:00:00Z', exerciseType: 'RUNNING_TREADMILL' })?.activity_type,
      'running',
    );
  });
});

// ============================================================================
// Weight import — resolved UUID only, existing weight wins
// ============================================================================

describe('weight import', () => {
  const WEIGHT = { uid: 'w-1', time: '2026-09-30T07:00:00Z', weightKg: 82.4 };

  function weightAdapter(records: unknown[]): ImportAdapter & { reads: unknown[] } {
    const base = readyAdapter([], []);
    return {
      ...base,
      readWeight: async () => records,
    } as unknown as ImportAdapter & { reads: unknown[] };
  }

  test('weight saves with the resolved concept uuid on an empty day', async () => {
    const storage = memStorage();
    await grantConsent(storage, ['weight']);
    const store = fakeStore({}, { weightConcept: 'uuid-weight' });
    const report = await runHealthConnectImport({
      storage,
      adapter: weightAdapter([WEIGHT]),
      store,
    });
    assert.equal(report.status, 'ok');
    assert.equal(report.weightImported, 1);
    assert.deepEqual(store.merges, [
      { logDate: '2026-09-30', overlay: { vitals: [{ concept_id: 'uuid-weight', value: 82.4, unit: 'kg' }] } },
    ]);
  });

  test('existing weight vital wins: import never overwrites it', async () => {
    const storage = memStorage();
    await grantConsent(storage, ['weight']);
    const store = fakeStore(
      {
        '2026-09-30': {
          group_id: 'g1',
          sleep_duration_minutes: null,
          vitals: [{ concept_id: 'uuid-weight', unit: 'kg' }],
          activities: [],
        },
      },
      { weightConcept: 'uuid-weight' },
    );
    const report = await runHealthConnectImport({
      storage,
      adapter: weightAdapter([WEIGHT]),
      store,
    });
    assert.equal(report.status, 'ok');
    assert.equal(report.weightImported, 0);
    assert.deepEqual(store.merges, []);
  });

  test('unresolvable concept skips weight but the run still succeeds', async () => {
    const storage = memStorage();
    await grantConsent(storage, ['weight']);
    const store = fakeStore({});
    const report = await runHealthConnectImport({
      storage,
      adapter: weightAdapter([WEIGHT]),
      store,
    });
    assert.equal(report.status, 'ok');
    assert.equal(report.weightImported, 0);
    assert.deepEqual(store.merges, []);
  });
});

// ============================================================================
// Steps import — daily sums into the step store
// ============================================================================

describe('steps import', () => {
  function stepsAdapter(records: unknown[]): ImportAdapter {
    const base = readyAdapter([], []);
    return { ...base, readSteps: async () => records } as unknown as ImportAdapter;
  }

  test('interval records aggregate into daily totals', async () => {
    const storage = memStorage();
    await grantConsent(storage, ['steps']);
    const store = fakeStore({});
    const report = await runHealthConnectImport({
      storage,
      adapter: stepsAdapter([
        { uid: 'a', startTime: '2026-09-30T08:00:00Z', endTime: '2026-09-30T09:00:00Z', steps: 3000 },
        { uid: 'b', startTime: '2026-09-30T18:00:00Z', endTime: '2026-09-30T19:00:00Z', steps: 5000 },
        { uid: 'c', startTime: '2026-10-01T08:00:00Z', endTime: '2026-10-01T09:00:00Z', steps: 1000 },
      ]),
      store,
    });
    assert.equal(report.status, 'ok');
    assert.equal(report.stepDaysImported, 2);
    assert.equal(report.stepsTotal, 9000);
    assert.deepEqual(store.savedSteps, [
      { logDate: '2026-09-30', steps: 8000 },
      { logDate: '2026-10-01', steps: 1000 },
    ]);
  });
});

// ============================================================================
// Wiring guards — importer stays decoupled from native, db, and network
// ============================================================================

describe('importer wiring guards', () => {
  test('importer injects every side effect; nothing native, db, or network', () => {
    const body = src('src/services/healthConnect/importer.ts');
    for (const banned of ['react-native-health-connect', '@/db', 'expo-sqlite', 'fetch(', "from 'react-native'", 'require(']) {
      assert.ok(!body.includes(banned), banned);
    }
    assert.ok(body.includes('canImport'), 'consent gate reused');
  });
});
