/**
 * deletionFix — regression tests for the failed-deletion incident.
 *
 * Behavioral coverage (pure contract module):
 *   - 200-shaped reports validate (completed + partial)
 *   - garbage/empty/unknown-status bodies throw BEFORE any local wipe
 *   - 404 maps to the server-too-old copy (never the connection copy)
 *   - non-404 keeps the existing connection copy
 *   - status extraction never needs axios (duck-typed)
 * plus wiring guards (text-level, repo precedent) for RN-bound layers:
 *   - service validates the report before wiping local state
 *   - screen guards double-submit synchronously AND via state
 *   - screen surfaces the mapped copy (not a hardcoded string)
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/deletionFix.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  deletionFailureMessage,
  deletionStatusOf,
  validateErasureReport,
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

// ============================================================================
// Report validation — garbage never triggers a wipe or a claim
// ============================================================================

describe('validateErasureReport', () => {
  test('completed and partial reports validate through', () => {
    assert.equal(validateErasureReport({ status: 'completed' }), 'completed');
    assert.equal(validateErasureReport({ status: 'partial', neo4j: {} }), 'partial');
  });

  test('empty/garbage/unknown bodies throw (caller wipes nothing)', () => {
    for (const bad of [undefined, null, '', {}, { status: 'ok' }, { status: 200 }, []]) {
      assert.throws(() => validateErasureReport(bad), /unexpected deletion response/);
    }
  });
});

// ============================================================================
// Failure copy — 404 means stale server, not a broken connection
// ============================================================================

describe('deletionFailureMessage', () => {
  const err404 = { response: { status: 404 } };
  const err500 = { response: { status: 500 } };
  const errNet = { code: 'ERR_NETWORK', message: 'Network Error' };

  test('404 names the server version gap per operation', () => {
    assert.match(deletionFailureMessage(err404, 'data'), /server version/);
    assert.match(deletionFailureMessage(err404, 'account'), /server version/);
    assert.ok(!deletionFailureMessage(err404, 'data').includes('connection'));
  });

  test('non-404 keeps the existing connection copy', () => {
    const expected = 'Nothing was deleted. Check your connection and try again.';
    assert.equal(deletionFailureMessage(err500, 'data'), expected);
    assert.equal(deletionFailureMessage(errNet, 'account'), expected);
    assert.equal(deletionFailureMessage(new Error('boom'), 'data'), expected);
    assert.equal(deletionFailureMessage(undefined, 'data'), expected);
  });

  test('status extraction is axios-free and total', () => {
    assert.equal(deletionStatusOf(err404), 404);
    assert.equal(deletionStatusOf({ response: {} }), undefined);
    assert.equal(deletionStatusOf({ response: { status: '404' } }), undefined);
    assert.equal(deletionStatusOf(null), undefined);
  });
});

// ============================================================================
// Wiring guards — RN-bound layers
// ============================================================================

describe('deletion fix wiring', () => {
  test('service validates before wiping (both operations)', () => {
    const svc = src('src/services/deletion.ts');
    for (const fn of ['deleteAllHealthData', 'deleteAccountCompletely']) {
      const body = svc.slice(svc.indexOf(`export async function ${fn}`));
      const validateAt = body.indexOf('validateErasureReport(');
      const wipeAt = body.indexOf('wipeLocal(');
      assert.ok(validateAt > 0 && wipeAt > validateAt, fn);
    }
  });

  test('screen guards double-submit twice and maps failure copy', () => {
    const screen = src('src/screens/Settings/SettingsScreen.tsx');
    assert.ok(screen.includes('deletingRef'), 'synchronous ref guard');
    assert.ok(screen.includes('deletingRef.current = true'), 'ref set before work');
    assert.ok(screen.includes('deletionFailureMessage(error'), 'mapped copy used');
    // The old hardcoded catch-all must not remain as the failure path.
    const catches = screen.match(/Nothing was deleted\. Check your connection/g) ?? [];
    assert.equal(catches.length, 0);
  });
});
