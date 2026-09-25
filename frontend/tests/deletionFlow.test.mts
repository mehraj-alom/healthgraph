/**
 * deletionFlow — destructive-action safeguards and honest outcome reporting.
 *
 * Behavioral coverage (pure units, dependency-free):
 *   - exact DELETE match (case-sensitive, no whitespace forgiveness)
 *   - 20-second countdown constant + labels
 *   - timeout-like classification (reconcile-and-retry vs plain failure)
 *
 * Wiring guards (text-level, repo precedent):
 *   - Settings deletion runs through DeleteConfirmSheet, not bare Alerts
 *   - countdown cannot complete without an exact match (sheet logic)
 *   - running disables destructive controls; duplicate requests guarded
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/deletionFlow.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  DELETE_CONFIRM_PHRASE,
  DELETE_COUNTDOWN_SECONDS,
  countdownLabel,
  isDeleteConfirmed,
  isTimeoutLikeError,
} from '../src/services/deletionContract.ts';

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

describe('confirmation match', () => {
  test('exact DELETE only', () => {
    assert.equal(isDeleteConfirmed('DELETE'), true);
    assert.equal(DELETE_CONFIRM_PHRASE, 'DELETE');
    assert.equal(DELETE_COUNTDOWN_SECONDS, 20);
  });

  test('wrong strings blocked', () => {
    for (const bad of ['', ' ', 'delete', 'Delete', 'DELETE ', ' DELETE', 'DEL', 'DELETED', 'delete\n']) {
      assert.equal(isDeleteConfirmed(bad), false, JSON.stringify(bad));
    }
  });

  test('countdown labels', () => {
    assert.equal(countdownLabel(20), 'Wait 20s…');
    assert.equal(countdownLabel(1), 'Wait 1s…');
    assert.equal(countdownLabel(0), 'Delete now');
    assert.equal(countdownLabel(-3), 'Delete now');
  });
});

describe('timeout classification', () => {
  test('timeout-like errors reconcile instead of claiming nothing happened', () => {
    assert.equal(isTimeoutLikeError({ code: 'ECONNABORTED' }), true);
    assert.equal(isTimeoutLikeError({ code: 'ERR_NETWORK' }), true);
    assert.equal(isTimeoutLikeError({ code: 'ETIMEDOUT' }), true);
    assert.equal(isTimeoutLikeError(new Error('timeout of 120000ms exceeded')), true);
    assert.equal(isTimeoutLikeError(new Error('Network request failed')), true);
  });

  test('ordinary failures stay plain failures', () => {
    assert.equal(isTimeoutLikeError({ response: { status: 403 } }), false);
    assert.equal(isTimeoutLikeError({ response: { status: 500 } }), false);
    assert.equal(isTimeoutLikeError(new Error('Request failed with status code 500')), false);
    assert.equal(isTimeoutLikeError(null), false);
    assert.equal(isTimeoutLikeError(undefined), false);
  });
});

describe('deletion wiring', () => {
  test('Settings runs deletion through the sheet, not bare alerts', () => {
    const settings = src('src/screens/Settings/SettingsScreen.tsx');
    assert.ok(settings.includes('<DeleteConfirmSheet'), 'sheet mounted');
    assert.ok(settings.includes('openDeleteDataSheet'), 'data flow opens sheet');
    assert.ok(settings.includes('openDeleteAccountSheet'), 'account flow opens sheet');
    assert.ok(!settings.includes('confirmDeleteData'), 'no legacy alert flow for data');
    assert.ok(!settings.includes('confirmDeleteAccount'), 'no legacy alert flow for account');
  });

  test('sheet cannot arm without an exact match', () => {
    const sheet = src('src/components/DeleteConfirmSheet.tsx');
    assert.ok(sheet.includes('disabled={!armed || running}'), 'confirm gated on armed');
    assert.ok(sheet.includes('setSecondsLeft(text === DELETE_CONFIRM_PHRASE'), 'match starts countdown');
    assert.ok(sheet.includes('clearTimer'), 'edits and unmount clear the timer');
  });

  test('duplicate requests guarded at both layers', () => {
    const settings = src('src/screens/Settings/SettingsScreen.tsx');
    assert.ok(settings.includes('deletingRef.current = true'), 'sync ref guard set');
    assert.ok(settings.includes('if (deleting || deletingRef.current) return'), 're-entry blocked');
    const sheet = src('src/components/DeleteConfirmSheet.tsx');
    assert.ok(sheet.includes('disabled={running}'), 'controls disabled while running');
  });
});
