/**
 * voiceTurnLog.test.mts — voice turns become journal lines.
 *
 * Pure builders (shape, clipping, cap trimming) plus wiring guards: the
 * turn screen logs completed turns through the existing daily-log save
 * sequence with full-payload rebuilds (PUT-safe), no new tables, no new
 * endpoints. Nothing logs unless transcript + reply are both present.
 */
import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  appendVoiceNote,
  buildVoiceNoteLine,
  VOICE_NOTES_CAP,
} from '../src/services/voice/logPure.ts';

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

describe('buildVoiceNoteLine', () => {
  it('shapes a timestamped journal line with both sides', () => {
    const line = buildVoiceNoteLine('took my pill', 'Recorded. Anything else?', '08:42');
    assert.match(line, /^\[08:42 Voice turn\]/);
    assert.match(line, /You: "took my pill"/);
    assert.match(line, /HealthGraph: "Recorded\. Anything else\?"/);
  });

  it('clips long sides instead of bloating the day notes', () => {
    const line = buildVoiceNoteLine('x'.repeat(500), 'y'.repeat(500), '08:42');
    assert.ok(line.length < 500, `clipped, got ${line.length}`);
    assert.match(line, /…/);
  });
});

describe('appendVoiceNote', () => {
  it('appends to empty and existing notes', () => {
    assert.equal(appendVoiceNote(null, 'L1'), 'L1');
    assert.equal(appendVoiceNote('', 'L1'), 'L1');
    assert.equal(appendVoiceNote('L0', 'L1'), 'L0\nL1');
  });

  it('trims oldest lines past the cap, never exceeding it', () => {
    const big = Array.from({ length: 200 }, (_, i) => `line-${i}-pad-pad-pad`).join('\n');
    const out = appendVoiceNote(big, 'newest');
    assert.ok(out.length <= VOICE_NOTES_CAP, `capped, got ${out.length}`);
    assert.ok(out.endsWith('newest'), 'newest line survives');
    assert.ok(!out.startsWith('line-0'), 'oldest lines trimmed first');
  });

  it('cap constant stays comfortably under the backend 4000-char limit', () => {
    assert.ok(VOICE_NOTES_CAP <= 3500);
  });
});

test('turn screen logs completed turns, never partial ones', () => {
  const s = src('src/screens/Voice/VoiceTurnScreen.tsx');
  assert.ok(s.includes('logVoiceTurn(out.text, text)'), 'logs after reply arrives');
  assert.ok(s.includes("Completed turns are saved to today's journal"), 'mic/journal disclosure present');
});

test('voice log reuses the daily-log save sequence (PUT-safe)', () => {
  const s = src('src/services/voice/log.ts');
  assert.ok(s.includes('persistDailyLog'), 'same offline-first sequence as meals');
  assert.ok(s.includes('preservedNutritionBlock'), 'nutrition passes through untouched');
  assert.ok(s.includes('detailToRequest(existing, logDate, preservedNutritionBlock(existing), notes)'), 'full payload rebuild with notes override');
  assert.ok(s.includes('if (!transcript.trim() || !reply.trim()) return null'), 'partial turns never log');
  assert.ok(!/CREATE TABLE|ALTER TABLE|sync_queue|api\.post|api\.put/i.test(s), 'no new tables, queue, or endpoints');
});
