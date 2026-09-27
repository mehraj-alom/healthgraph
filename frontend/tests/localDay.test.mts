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
  assert.ok(!hay.includes('toISOString().slice(0, 10)'), 'UTC day slice present');
  assert.ok(!hay.includes("toISOString().split('T')[0]"), 'UTC day split present');
});

test('logger + medications share the local day key', () => {
  const vitals = src('src/screens/VitalsLogger/VitalsLoggerScreen.tsx');
  assert.ok(vitals.includes('getMonth()') && vitals.includes('getDate()'), 'local components used');
  const meds = src('src/screens/Medications/MedicationsScreen.tsx');
  assert.ok(meds.includes('todayKey()'), 'med schedule uses the shared local key');
});
