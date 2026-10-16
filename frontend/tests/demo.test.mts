/**
 * demo.test.mts — sandbox reviewer demo (node --experimental-strip-types).
 *
 * The identity contract and seed plan run directly (demoMode.ts is
 * zero-import; seedDemoData takes injectable storage). The RN session
 * (flag, seeding wiring, wipe, nav gate, banner) is pinned by
 * source-text contract. Absences (no Firebase, no backend, no sync of
 * demo rows, no OS alarms) are tested as absences.
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/demo.test.mts
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEMO_FLAG_KEY,
  DEMO_PATIENT_ID,
  isDemoPatientId,
  normalizeDemoFlag,
} from '../src/services/demoMode.ts';
import { seedDemoData, type DemoSeedDeps } from '../src/services/demoSeed.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ============================================================================
// Identity contract — pure
// ============================================================================

describe('demo identity', () => {
  test('demo id is fixed, synthetic, and recognizable', () => {
    assert.ok(DEMO_PATIENT_ID.startsWith('demo-'), 'demo prefix');
    assert.ok(DEMO_FLAG_KEY.startsWith('hg:demo-mode:'), 'versioned flag key');
  });

  test('demo guard matches only the demo id', () => {
    assert.equal(isDemoPatientId(DEMO_PATIENT_ID), true);
    assert.equal(isDemoPatientId('demo-something-else'), false);
    assert.equal(isDemoPatientId(null), false);
    assert.equal(isDemoPatientId(undefined), false);
  });

  test('flag parse fails closed', () => {
    assert.equal(normalizeDemoFlag(true), true);
    // AsyncStorage persists booleans as JSON strings — honor the round-trip.
    assert.equal(normalizeDemoFlag('true'), true);
    for (const raw of [false, null, undefined, 0, 1, 'yes', '1', [], {}]) {
      assert.equal(normalizeDemoFlag(raw), false);
    }
  });
});

// ============================================================================
// Seed plan — injectable storage, real counts
// ============================================================================

function recordingDeps(): DemoSeedDeps & {
  logs: unknown[];
  meds: { reminder_enabled: boolean }[];
  taken: unknown[];
  sits: { completed: boolean }[];
} {
  const logs: unknown[] = [];
  const meds: { reminder_enabled: boolean }[] = [];
  const taken: unknown[] = [];
  const sits: { completed: boolean }[] = [];
  return {
    logs,
    meds,
    taken,
    sits,
    upsertLog: async (_pid, request) => {
      logs.push(request);
      return `g${logs.length}`;
    },
    addMedication: async (_pid, med) => {
      // Seeder contract: reminders stay OFF in demo by policy.
      meds.push({ reminder_enabled: false });
      void med;
      return `m${meds.length}`;
    },
    addTaken: async (_pid, event) => {
      taken.push(event);
      return `t${taken.length}`;
    },
    addSit: async (_pid, sit) => {
      sits.push({ completed: sit.completed });
      return `s${sits.length}`;
    },
  };
}

describe('demo seed', () => {
  test('minimal trio lands under the demo patient only', async () => {
    const deps = recordingDeps();
    const seen: string[] = [];
    const watching: DemoSeedDeps = {
      upsertLog: (pid, req) => {
        seen.push(pid);
        return deps.upsertLog(pid, req);
      },
      addMedication: (pid, med) => {
        seen.push(pid);
        return deps.addMedication(pid, med);
      },
      addTaken: (pid, ev) => {
        seen.push(pid);
        return deps.addTaken(pid, ev);
      },
      addSit: (pid, sit) => {
        seen.push(pid);
        return deps.addSit(pid, sit);
      },
    };
    const report = await seedDemoData(watching, DEMO_PATIENT_ID);
    assert.deepEqual(report, { logs: 7, medications: 2, taken: 4, sits: 5 });
    assert.ok(seen.length > 0);
    assert.ok(seen.every((pid) => pid === DEMO_PATIENT_ID), 'demo patient only');
  });

  test('every sit is completed and every note is labeled sample', async () => {
    const deps = recordingDeps();
    await seedDemoData(deps, DEMO_PATIENT_ID);
    assert.ok(deps.sits.length === 5 && deps.sits.every((s) => s.completed));
    for (const req of deps.logs as { notes?: string }[]) {
      if (req.notes) assert.ok(req.notes.includes('Sample data'), 'honest label');
    }
  });
});

// ============================================================================
// Session + nav + sync — source-text contracts + absences
// ============================================================================

describe('demo wiring contracts', () => {
  test('identity override shadows without touching SecureStore', () => {
    const identity = src('src/services/patientIdentity.ts');
    assert.ok(identity.includes('setDemoOverride'), 'override setter');
    assert.ok(identity.includes('_demoOverride ?? _cachedPatientId'), 'override wins');
    assert.ok(identity.includes('SecureStore'), 'real path intact');
    // The override path never calls SecureStore APIs: only the real setters do.
    const session = src('src/services/demoSession.ts');
    for (const api of ['setItemAsync', 'getItemAsync', 'deleteItemAsync']) {
      assert.ok(!session.includes(api), `no keychain ${api} from demo`);
    }
    assert.ok(!session.includes('updatePatientId'), 'real identity untouched');
  });

  test('sync engine refuses demo rows at every gate', () => {
    const engine = src('src/services/syncEngine.ts');
    const hits = engine.match(/isDemoPatientId\(/g) ?? [];
    assert.ok(hits.length >= 5, `demo guards present (found ${hits.length})`);
  });

  test('demo exit wipes through the patient eraser', () => {
    const session = src('src/services/demoSession.ts');
    assert.ok(session.includes('deletePatientLocalData'), 'erase on exit');
    assert.ok(session.includes('setDemoOverride(null)'), 'shadow cleared');
    const erase = src('src/db/queries/patientErase.ts');
    assert.ok(erase.includes('meditation_sessions'), 'sits wiped too');
  });

  test('entry lives on the signed-out login view; banner gates the app', () => {
    const onboarding = src('src/screens/Onboarding/OnboardingScreen.tsx');
    assert.ok(onboarding.includes('Try the demo'), 'entry link');
    assert.ok(onboarding.includes('enterDemoMode'), 'entry wiring');
    const app = src('App.tsx');
    assert.ok(app.includes('useDemoMode'), 'gate hook');
    assert.ok(app.includes('DemoBanner'), 'banner rendered');
    assert.ok(app.includes("'demo'"), 'demo navigator key');
  });

  test('absences: no Firebase, no backend, no alarms from demo', () => {
    for (const f of [
      'src/services/demoMode.ts',
      'src/services/demoSeed.ts',
      'src/services/demoSession.ts',
    ]) {
      const text = src(f);
      for (const word of ['firebase', 'auth/sync', 'api.post', 'api.get', 'fetch(']) {
        assert.ok(!text.includes(word), `${f}: ${word}`);
      }
    }
    const seed = src('src/services/demoSeed.ts');
    assert.ok(seed.includes('reminder_enabled: false'), 'no OS alarms from seed');
    assert.ok(!seed.includes('expo-notifications'), 'no notification wiring');
  });
});
