/**
 * healthConnect.test.mts — Health Connect foundation (node --experimental-strip-types).
 *
 * Slice 1 is JS-only: consent record, record validation, mappers into the
 * existing DailyLog shapes, dedupe keys, and a capability probe. No native
 * module, no manifest permissions, no backend calls, no new tables — so the
 * contract tests below pin exactly that. Malformed external records are
 * rejected (never crash, never fabricate); consent defaults to denied.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REQUESTED_DATA_TYPES,
  UNAVAILABLE_REASON,
  type HealthConnectAdapter,
  unavailableAdapter,
} from '../src/services/healthConnect/capability.ts';
import {
  CONSENT_STORAGE_KEY,
  CONSENT_TEXT_VERSION,
  canImport,
  grantConsent,
  readConsent,
  revokeConsent,
  type ConsentRecord,
  type ConsentStoragePort,
} from '../src/services/healthConnect/consent.ts';
import {
  DISCLOSURE_BODY,
  DISCLOSURE_TITLE,
} from '../src/services/healthConnect/disclosure.ts';
import {
  dedupeKey,
  mapExerciseSession,
  mapSleepSession,
  mapStepsRecord,
  mapWeightRecord,
} from '../src/services/healthConnect/mapping.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function memStorage(initial?: Record<string, string>): ConsentStoragePort {
  const store = new Map(Object.entries(initial ?? {}));
  return {
    getItem: async (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: async (k: string, v: string) => void store.set(k, v),
    removeItem: async (k: string) => void store.delete(k),
  };
}

// ============================================================================
// Sleep mapping — duration only, quality unknown stays null (never invented)
// ============================================================================

describe('sleep session mapping', () => {
  test('valid overnight session maps to duration minutes', () => {
    const out = mapSleepSession({
      uid: 'sleep-1',
      startTime: '2026-09-20T22:30:00Z',
      endTime: '2026-09-21T06:30:00Z',
    });
    assert.deepEqual(out, {
      duration_minutes: 480,
      sleep_quality: null,
      awakenings: null,
      source: 'health_connect',
      dedupeKey: 'hc:sleep:2026-09-20T22:30:00Z:2026-09-21T06:30:00Z:sleep-1',
    });
  });

  test('end before start, overlong, and malformed sessions are rejected', () => {
    assert.equal(
      mapSleepSession({ uid: 'x', startTime: '2026-09-21T06:30:00Z', endTime: '2026-09-20T22:30:00Z' }),
      null,
    );
    assert.equal(
      mapSleepSession({ uid: 'x', startTime: '2026-09-19T00:00:00Z', endTime: '2026-09-21T00:00:01Z' }),
      null,
    );
    assert.equal(mapSleepSession({ uid: 'x', startTime: 'garbage', endTime: '2026-09-21T06:30:00Z' }), null);
    assert.equal(mapSleepSession(null), null);
    assert.equal(mapSleepSession({ uid: '', startTime: '2026-09-20T22:30:00Z', endTime: '2026-09-21T06:30:00Z' }), null);
  });
});

// ============================================================================
// Weight mapping — LOINC 29463-7 shape the Weight Engine already reads
// ============================================================================

describe('weight record mapping', () => {
  test('kilogram record maps to the weight vital shape', () => {
    const out = mapWeightRecord({ uid: 'w-1', time: '2026-09-21T07:00:00Z', weightKg: 82.4 });
    assert.deepEqual(out, {
      concept_id: '29463-7',
      value: 82.4,
      unit: 'kg',
      source: 'health_connect',
      dedupeKey: 'hc:weight:2026-09-21T07:00:00Z:w-1',
    });
  });

  test('pounds convert to kilograms rounded to one decimal', () => {
    const out = mapWeightRecord({ uid: 'w-2', time: '2026-09-21T07:00:00Z', weightLb: 180 });
    assert.equal(out?.unit, 'kg');
    assert.equal(out?.value, 81.6);
  });

  test('absurd and malformed weights are rejected', () => {
    assert.equal(mapWeightRecord({ uid: 'x', time: '2026-09-21T07:00:00Z', weightKg: 0 }), null);
    assert.equal(mapWeightRecord({ uid: 'x', time: '2026-09-21T07:00:00Z', weightKg: 600 }), null);
    assert.equal(mapWeightRecord({ uid: 'x', time: '2026-09-21T07:00:00Z', weightKg: NaN }), null);
    assert.equal(mapWeightRecord({ uid: 'x', time: 'nope', weightKg: 80 }), null);
    assert.equal(mapWeightRecord(undefined), null);
  });
});

// ============================================================================
// Exercise mapping — known types translate, unknown stays generic 'workout'
// ============================================================================

describe('exercise session mapping', () => {
  test('running session maps with duration and calories', () => {
    const out = mapExerciseSession({
      uid: 'e-1',
      startTime: '2026-09-21T07:00:00Z',
      endTime: '2026-09-21T07:30:00Z',
      exerciseType: 'RUNNING',
      activeCaloriesKcal: 320,
    });
    assert.deepEqual(out, {
      activity_type: 'running',
      duration_minutes: 30,
      calories_burned: 320,
      source: 'health_connect',
      dedupeKey: 'hc:exercise:2026-09-21T07:00:00Z:2026-09-21T07:30:00Z:e-1',
    });
  });

  test('unknown type falls back to workout, missing calories stay null', () => {
    const out = mapExerciseSession({
      uid: 'e-2',
      startTime: '2026-09-21T07:00:00Z',
      endTime: '2026-09-21T08:00:00Z',
      exerciseType: 'SOMETHING_NEW',
    });
    assert.equal(out?.activity_type, 'workout');
    assert.equal(out?.calories_burned, null);
  });

  test('inverted and malformed sessions are rejected', () => {
    assert.equal(
      mapExerciseSession({ uid: 'x', startTime: '2026-09-21T08:00:00Z', endTime: '2026-09-21T07:00:00Z', exerciseType: 'RUNNING' }),
      null,
    );
    assert.equal(mapExerciseSession(null), null);
  });
});

// ============================================================================
// Steps mapping — staged for Slice 2 (no steps home exists yet)
// ============================================================================

describe('steps record mapping', () => {
  test('valid day maps to a staged steps fragment', () => {
    const out = mapStepsRecord({ uid: 's-1', startTime: '2026-09-21T00:00:00Z', endTime: '2026-09-21T23:59:59Z', steps: 8432 });
    assert.deepEqual(out, {
      log_date: '2026-09-21',
      steps: 8432,
      source: 'health_connect',
      dedupeKey: 'hc:steps:2026-09-21:s-1',
    });
  });

  test('negative, absurd, and malformed step counts are rejected', () => {
    assert.equal(mapStepsRecord({ uid: 'x', startTime: '2026-09-21T00:00:00Z', endTime: '2026-09-21T23:59:59Z', steps: -5 }), null);
    assert.equal(mapStepsRecord({ uid: 'x', startTime: '2026-09-21T00:00:00Z', endTime: '2026-09-21T23:59:59Z', steps: 500000 }), null);
    assert.equal(mapStepsRecord({ uid: 'x', startTime: '2026-09-21T00:00:00Z', endTime: '2026-09-21T23:59:59Z', steps: 1.5 }), null);
    assert.equal(mapStepsRecord(undefined), null);
  });
});

// ============================================================================
// Dedupe keys — deterministic, distinct per record
// ============================================================================

describe('dedupe keys', () => {
  test('same record always yields the same key; different records differ', () => {
    const a = dedupeKey('sleep', '2026-09-20T22:30:00Z', '2026-09-21T06:30:00Z', 'u1');
    const b = dedupeKey('sleep', '2026-09-20T22:30:00Z', '2026-09-21T06:30:00Z', 'u1');
    const c = dedupeKey('sleep', '2026-09-20T22:30:00Z', '2026-09-21T06:30:00Z', 'u2');
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.ok(a.startsWith('hc:sleep:'));
  });
});

// ============================================================================
// Consent — denied by default, explicit grant, easy revoke (GDPR Art. 7/9)
// ============================================================================

describe('health connect consent', () => {
  test('no stored record means denied', async () => {
    const record = await readConsent(memStorage());
    assert.equal(record, null);
    assert.equal(await canImport(memStorage(), unavailableAdapter), false);
  });

  test('grant records purpose, timestamp, and text version', async () => {
    const storage = memStorage();
    const record: ConsentRecord = await grantConsent(storage, ['steps', 'sleep']);
    assert.equal(record.granted, true);
    assert.equal(record.textVersion, CONSENT_TEXT_VERSION);
    assert.deepEqual(record.dataTypes, ['steps', 'sleep']);
    assert.ok(Date.parse(record.grantedAt) > 0);
    const reread = await readConsent(storage);
    assert.deepEqual(reread, record);
  });

  test('revoke stops future imports and records the timestamp', async () => {
    const storage = memStorage();
    await grantConsent(storage, ['steps']);
    const revoked = await revokeConsent(storage);
    assert.equal(revoked.granted, false);
    assert.ok(Date.parse(revoked.revokedAt as string) > 0);
    assert.equal(await canImport(storage, unavailableAdapter), false);
  });

  test('stale text version does not authorize import', async () => {
    const storage = memStorage({
      [CONSENT_STORAGE_KEY]: JSON.stringify({
        granted: true,
        grantedAt: '2026-01-01T00:00:00Z',
        textVersion: 'v0-ancient',
        dataTypes: ['steps'],
        source: 'settings',
      }),
    });
    assert.equal(await canImport(storage, unavailableAdapter), false);
  });

  test('corrupt stored consent is treated as denied, never granted', async () => {
    const storage = memStorage({ [CONSENT_STORAGE_KEY]: 'not-json{{{' });
    assert.equal(await readConsent(storage), null);
    assert.equal(await canImport(storage, unavailableAdapter), false);
  });
});

// ============================================================================
// Capability — unavailable adapter blocks import, minimum data types listed
// ============================================================================

describe('adapter capability', () => {
  test('unavailable adapter reports itself and blocks import', async () => {
    assert.equal(unavailableAdapter.isAvailable(), false);
    assert.equal(unavailableAdapter.reason, UNAVAILABLE_REASON);
    const storage = memStorage();
    await grantConsent(storage, ['steps']);
    assert.equal(await canImport(storage, unavailableAdapter), false);
  });

  test('requested data types are the documented minimum set', () => {
    assert.deepEqual(REQUESTED_DATA_TYPES, ['steps', 'sleep', 'exercise', 'weight']);
  });

  test('a ready adapter plus fresh consent authorizes import', async () => {
    const ready: HealthConnectAdapter = { isAvailable: () => true, reason: null };
    const storage = memStorage();
    await grantConsent(storage, ['steps']);
    assert.equal(await canImport(storage, ready), true);
  });
});

// ============================================================================
// Disclosure — prominent, specific, revocable (Play User Data policy)
// ============================================================================

describe('prominent disclosure', () => {
  test('disclosure names data, purpose, storage, and revoke path', () => {
    const body = DISCLOSURE_BODY.toLowerCase();
    for (const phrase of ['steps', 'sleep', 'workouts', 'weight', 'device', 'revoke', 'settings', 'health connect']) {
      assert.ok(body.includes(phrase), phrase);
    }
    assert.ok(DISCLOSURE_TITLE.length > 0);
  });
});

// ============================================================================
// Slice 1 wiring guards — pure JS only
// ============================================================================

describe('slice 1 wiring guards', () => {
  const files = [
    'src/services/healthConnect/records.ts',
    'src/services/healthConnect/mapping.ts',
    'src/services/healthConnect/consent.ts',
    'src/services/healthConnect/capability.ts',
    'src/services/healthConnect/disclosure.ts',
    'src/services/healthConnect/index.ts',
  ];

  test('no native, network, or storage imports in the foundation', () => {
    for (const f of files) {
      const body = src(f);
      for (const banned of ['react-native', 'NativeModules', 'AsyncStorage', 'fetch(', "from 'expo", 'expo-', 'Expo', 'require(']) {
        assert.ok(!body.includes(banned), `${f}: ${banned}`);
      }
    }
  });

  test('no diagnostic or judgment language in the foundation', () => {
    const hay = files.map((f) => src(f)).join('\n').toLowerCase();
    for (const phrase of ['diagnos', 'disease', 'healthy', 'risky', 'prescrib', 'treatment', 'resting']) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });

  test('no logs carry record identifiers', () => {
    const hay = files.map((f) => src(f)).join('\n');
    assert.ok(!hay.includes('console.log'), 'no console logging of health data');
  });
});
