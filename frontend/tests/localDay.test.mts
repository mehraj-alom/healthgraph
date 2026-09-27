/**
 * localDay.test.mts — calendar days are device-local, never UTC.
 *
 * Regression: VitalsLogger + Medications computed "today" with
 * toISOString() (UTC), so IST evenings after ~05:30 UTC logged under
 * yesterday while every reader (timeline, HomeStory, nutrition, voice)
 * used the local day — entries vanished from "today". Day math must use
 * local calendar components everywhere.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { shiftDayKey, todayKeyLocal, toDayKey } from '../src/utils/dayKey.ts';

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

function allSrc(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(p);
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        out.push(fs.readFileSync(p, 'utf8'));
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  return out.join('\n');
}

test('no UTC-sliced calendar days in app sources', () => {
  const hay = allSrc();
  for (const banned of [
    'toISOString().slice(0, 10)',
    "toISOString().split('T')[0]",
    'toISOString().split("T")[0]',
    'toISOString().substring(0, 10)',
    'getUTCFullYear()',
    'getUTCMonth()',
    'getUTCDate()',
  ]) {
    assert.ok(!hay.includes(banned), `UTC day pattern present: ${banned}`);
  }
});

test('logger + medications share the canonical day key', () => {
  const vitals = src('src/screens/VitalsLogger/VitalsLoggerScreen.tsx');
  assert.ok(vitals.includes('@/utils/dayKey'), 'logger imports the canonical module');
  assert.ok(vitals.includes('todayKeyLocal()') && vitals.includes('shiftDayKey('), 'logger delegates both helpers');
  const meds = src('src/screens/Medications/MedicationsScreen.tsx');
  assert.ok(meds.includes('todayKey()'), 'med schedule uses the shared local key');
  for (const f of [
    'src/services/nutritionService.ts',
    'src/services/voice/log.ts',
    'src/screens/Cycle/CycleScreen.tsx',
    'src/db/queries/dailyLogs.ts',
    'src/db/queries/medicationTakenEvents.ts',
  ]) {
    assert.ok(src(f).includes('todayKeyLocal'), `${f} delegates to the canonical key`);
  }
});

test('canonical day keys: local components, rollover, invalid input', () => {
  // Month/year rollover and leap day via local arithmetic.
  assert.equal(shiftDayKey('2026-01-31', 1), '2026-02-01');
  assert.equal(shiftDayKey('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDayKey('2024-02-28', 1), '2024-02-29');
  assert.equal(shiftDayKey('2026-09-28', 0), '2026-09-28');
  assert.equal(shiftDayKey('2026-12-31', 1), '2027-01-01');
  // Garbage in, '' out — callers treat missing, never guess.
  assert.equal(shiftDayKey('not-a-date', 1), '');
  assert.equal(shiftDayKey('', 0), '');
  // toDayKey uses local components (getFullYear/getMonth/getDate), never UTC.
  const d = new Date(2026, 8, 28, 0, 30); // Sep 28 00:30 local
  assert.equal(toDayKey(d), '2026-09-28');
  assert.match(todayKeyLocal(), /^\d{4}-\d{2}-\d{2}$/);
});
