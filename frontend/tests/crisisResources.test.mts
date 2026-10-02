/**
 * crisisResources — tests for the static support-resources block (Chat).
 *
 * Behavioral coverage (pure, node-testable):
 *   - exactly three resources, US numbers correct, tel:/sms: URLs only
 *     (no http links, no tracking surface)
 * plus wiring guards (text-level, repo precedent):
 *   - ChatScreen renders the card in the empty state and a persistent
 *     slim link under the input, both opening core Linking (no new deps)
 *   - exact crisis copy pinned; no triage/counseling language anywhere
 *     in the new module
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/crisisResources.test.mts
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CRISIS_RESOURCES, CRISIS_SLIM_LINE, CRISIS_TITLE } from '../src/services/crisisResources.ts';

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
// Resource list
// ============================================================================

describe('crisis resource list', () => {
  test('three US resources with tel/sms URLs only', () => {
    assert.equal(CRISIS_RESOURCES.length, 3);
    const urls = CRISIS_RESOURCES.map((r) => r.url);
    assert.ok(urls.includes('tel:988'), 'call 988');
    assert.ok(urls.includes('sms:988'), 'text 988');
    assert.ok(urls.includes('sms:741741'), 'text 741741');
    for (const u of urls) {
      assert.ok(u.startsWith('tel:') || u.startsWith('sms:'), `no http tracking: ${u}`);
    }
    for (const r of CRISIS_RESOURCES) {
      assert.ok(r.label.length > 0 && r.sub.length > 0, 'labeled rows');
    }
    assert.equal(CRISIS_TITLE, 'Support resources');
    assert.equal(CRISIS_SLIM_LINE, 'In crisis? Call or text 988 (US)');
  });
});

// ============================================================================
// Wiring + copy guards
// ============================================================================

describe('crisis wiring + copy guards', () => {
  test('ChatScreen shows the card empty-state and a persistent link', () => {
    const screen = src('src/screens/Chat/ChatScreen.tsx');
    assert.ok(screen.includes('CrisisCard'), 'card rendered');
    assert.ok(screen.includes('CRISIS_SLIM_LINE'), 'persistent slim link wired');
    assert.ok(screen.includes('CRISIS_TITLE'), 'card title wired');
    assert.ok(screen.includes('Linking.openURL'), 'core linking used');
    assert.ok(!screen.includes('expo-communications'), 'no new native deps');
  });

  test('no triage or counseling language in the new module', () => {
    const mod = src('src/services/crisisResources.ts').toLowerCase();
    for (const phrase of [
      'diagnos',
      'triage',
      'risk assessment',
      'we will contact',
      'notified',
      'counseling',
      'therapy',
      'treatment',
    ]) {
      assert.ok(!mod.includes(phrase), phrase);
    }
  });
});
