/**
 * recovery.test.mts — overnight-recovery hint (node --experimental-strip-types).
 *
 * Pure math runs directly (recovery.ts is zero-import). RN-bound layers
 * (hook loads, screen wiring, route) are pinned by source-text contract.
 * Copy boundaries: wellness hint only — no diagnoses, no predictions,
 * no rated-number language inside the Heart engine files (that contract
 * is unchanged; recovery lives in its own surface).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bandFor,
  computeReadiness,
  type ActivityInput,
  type HrInput,
  type HrvInput,
  type SleepInput,
} from '../src/screens/Recovery/recovery.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const TODAY = '2026-09-30';
const dayBefore = (n: number): string => {
  const d = new Date(`${TODAY}T12:00:00`);
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

function nights(n: number, minutes = 480, quality: number | null = 4): SleepInput[] {
  const out: SleepInput[] = [];
  for (let i = n; i >= 1; i--) out.push({ date: dayBefore(i), durationMinutes: minutes, quality });
  return out;
}

function hr(days: number, min: number): HrInput[] {
  const out: HrInput[] = [];
  for (let i = days; i >= 0; i--) {
    out.push({ measuredAt: `${dayBefore(i)}T08:00:00Z`, bpm: min + 8 });
    out.push({ measuredAt: `${dayBefore(i)}T20:00:00Z`, bpm: min });
  }
  return out;
}

function hrv(days: number, ms: number): HrvInput[] {
  const out: HrvInput[] = [];
  for (let i = days; i >= 0; i--) out.push({ measuredAt: `${dayBefore(i)}T08:00:00Z`, rmssdMs: ms });
  return out;
}

function active(days: number): ActivityInput[] {
  const out: ActivityInput[] = [];
  for (let i = 0; i < days; i++) out.push({ log_date: dayBefore(i), duration_minutes: 30 });
  return out;
}

describe('bandFor', () => {
  test('thresholds', () => {
    assert.equal(bandFor(100), 'ready');
    assert.equal(bandFor(75), 'ready');
    assert.equal(bandFor(74), 'steady');
    assert.equal(bandFor(50), 'steady');
    assert.equal(bandFor(49), 'easy');
    assert.equal(bandFor(0), 'easy');
  });
});

describe('computeReadiness', () => {
  test('full data yields a bounded value with weights summing to 100', () => {
    const { readiness, missing } = computeReadiness(
      { nights: nights(10), hr: hr(6, 62), hrv: hrv(6, 45), activity: active(5) },
      TODAY,
    );
    assert.deepEqual(missing, []);
    assert.ok(readiness);
    assert.ok(readiness.value >= 0 && readiness.value <= 100);
    assert.equal(
      readiness.factors.reduce((s, f) => s + f.max, 0),
      100,
    );
  });

  test('elevated resting pulse lowers the value vs steady baseline', () => {
    const base = { nights: nights(10), hrv: hrv(6, 45), activity: active(5) };
    const steady = computeReadiness({ ...base, hr: hr(6, 62) }, TODAY).readiness;
    const elevatedHr = hr(6, 62).map((p, i, arr) =>
      i >= arr.length - 2 ? { ...p, bpm: p.bpm + 9 } : p,
    );
    const elevated = computeReadiness({ ...base, hr: elevatedHr }, TODAY).readiness;
    assert.ok(steady && elevated);
    assert.ok(elevated.value < steady.value);
  });

  test('missing HRV redistributes weights (still sums to 100)', () => {
    const { readiness } = computeReadiness(
      { nights: nights(10), hr: hr(6, 62), hrv: [], activity: active(5) },
      TODAY,
    );
    assert.ok(readiness);
    assert.equal(
      readiness.factors.reduce((s, f) => s + f.max, 0),
      100,
    );
    assert.ok(!readiness.factors.some((f) => f.key === 'hrv'));
  });

  test('sparse data returns missing reasons, never a number', () => {
    const r1 = computeReadiness({ nights: [], hr: [], hrv: [], activity: [] }, TODAY);
    assert.equal(r1.readiness, null);
    assert.ok(r1.missing.length > 0);

    const r2 = computeReadiness(
      { nights: nights(2), hr: hr(1, 62), hrv: [], activity: [] },
      TODAY,
    );
    assert.equal(r2.readiness, null);
    assert.ok(r2.missing.length > 0);
  });

  test('stale sleep (nothing in 3 days) blocks with a reason', () => {
    const old = nights(10).filter((n) => n.date <= dayBefore(5));
    const { readiness, missing } = computeReadiness(
      { nights: old, hr: hr(6, 62), hrv: [], activity: [] },
      TODAY,
    );
    assert.equal(readiness, null);
    assert.ok(missing.some((m) => m.includes('sleep')));
  });

  test('future-dated rows are ignored', () => {
    const { readiness } = computeReadiness(
      {
        nights: [...nights(10), { date: '2026-10-05', durationMinutes: 5, quality: 1 }],
        hr: [...hr(6, 62), { measuredAt: '2026-10-05T08:00:00Z', bpm: 200 }],
        hrv: [],
        activity: [],
      },
      TODAY,
    );
    assert.ok(readiness && readiness.value > 0);
  });
});

describe('recovery wiring', () => {
  test('hook loads four bounded sources, no writes, no polling', () => {
    const hook = src('src/hooks/useReadiness.ts');
    assert.ok(hook.includes('getSleepNights'), 'sleep source');
    assert.ok(hook.includes('getRecentLocalHeartRates'), 'heart source');
    assert.ok(hook.includes('getRecentPpgMeasurements'), 'ppg/hrv source');
    assert.ok(hook.includes('getActivityLogs'), 'activity source');
    assert.ok(hook.includes('getCachedPatientId'), 'patient scope');
    assert.ok(!hook.includes('setInterval'), 'no polling');
  });

  test('route typed, registered, reachable from Heart', () => {
    const types = src('src/types/index.ts');
    assert.ok(types.includes('Recovery:'), 'route typed');
    const app = src('App.tsx');
    assert.ok(app.includes('name="Recovery"'), 'route registered');
    assert.ok(app.includes('RecoveryScreen'), 'screen wired');
    const heart = src('src/screens/HeartEngine/HeartEngineScreen.tsx');
    assert.ok(heart.includes("navigate('Recovery')"), 'heart entry point');
  });

  test('heart engine files stay free of rated-number language', () => {
    const hay = [
      src('src/screens/HeartEngine/heartEngine.ts'),
      src('src/screens/HeartEngine/HeartEngineScreen.tsx'),
      src('src/hooks/useHeartEngine.ts'),
    ]
      .join('\n')
      .toLowerCase();
    for (const phrase of ['stress score', 'recovery score', 'readiness', 'hrv proves', 'score']) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });
});
