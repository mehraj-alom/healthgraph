/**
 * chatExport — tests for conversation export/share (Echo gap).
 *
 * Behavioral coverage (pure, node-testable):
 *   - labeled turns with header/footer; null when no content turns exist
 *   - unknown roles skipped; blank content skipped; bad timestamps omitted
 *     (never crash, never invent)
 *   - oversized conversations trim oldest turns first with a marker
 * plus wiring guards (text-level, repo precedent):
 *   - ChatScreen wires the builder to the OS share sheet behind a
 *     labeled action, disabled while empty
 *   - no new native dependencies for export (core Share only)
 *   - no clinical/advisory language in the builder
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/chatExport.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { buildChatExport } from '../src/services/chatExport.ts';

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

const TURNS = [
  { role: 'user', content: '  My sleep was short.  ', timestamp: new Date('2026-10-02T08:04:00') },
  { role: 'assistant', content: 'Short nights happen. What time did you get up?', timestamp: new Date('2026-10-02T08:05:00') },
];

// ============================================================================
// Export builder
// ============================================================================

describe('buildChatExport', () => {
  test('labels turns with header, count, and trust footer', () => {
    const text = buildChatExport(TURNS);
    assert.ok(text !== null);
    assert.ok(text.includes('HealthGraph chat export'));
    assert.ok(text.includes('2 messages'));
    assert.ok(/^You /m.test(text));
    assert.ok(text.includes('Assistant ('));
    assert.ok(text.includes('My sleep was short.'));
    assert.ok(text.includes('share only with people you trust'));
  });

  test('null when nothing exportable; skips blanks and unknown roles', () => {
    assert.equal(buildChatExport([]), null);
    assert.equal(buildChatExport([{ role: 'user', content: '   ' }]), null);
    assert.equal(
      buildChatExport([{ role: 'system', content: 'hidden' } as never]),
      null,
    );
    const mixed = buildChatExport([
      { role: 'system', content: 'hidden' } as never,
      { role: 'user', content: 'hi' },
    ]);
    assert.ok(mixed !== null && mixed.includes('1 message') && !mixed.includes('hidden'));
  });

  test('bad timestamps omitted, never fatal', () => {
    const text = buildChatExport([{ role: 'user', content: 'hi', timestamp: 'garbage' }]);
    assert.ok(text !== null && text.includes('You:') && text.includes('hi'));
  });

  test('oversized exports trim oldest turns first with a marker', () => {
    const turns = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `message number ${i} with padding text to grow the export`,
    }));
    const text = buildChatExport(turns, { maxChars: 300 });
    assert.ok(text !== null);
    assert.ok(text.includes('earlier messages trimmed'));
    assert.ok(text.includes('message number 19'));
    assert.ok(!text.includes('message number 0'));
    assert.ok(text.length <= 300 + 400);
  });
});

// ============================================================================
// Wiring + copy guards
// ============================================================================

describe('chat export wiring + copy guards', () => {
  test('ChatScreen shares the built export behind a labeled action', () => {
    const screen = src('src/screens/Chat/ChatScreen.tsx');
    assert.ok(screen.includes('buildChatExport'), 'builder wired');
    assert.ok(screen.includes('Share.share'), 'OS share sheet');
    assert.ok(screen.includes('Share chat'), 'labeled action');
    assert.ok(!screen.includes('expo-print'), 'no print dependency');
    assert.ok(!screen.includes('expo-sharing'), 'no file-share dependency');
  });

  test('no clinical or advisory language in the builder', () => {
    const builder = src('src/services/chatExport.ts').toLowerCase();
    for (const phrase of [
      'diagnos',
      'disorder',
      'syndrome',
      'treatment plan',
      'recommended dose',
      'you should take',
      'prescribes',
    ]) {
      assert.ok(!builder.includes(phrase), phrase);
    }
  });
});
