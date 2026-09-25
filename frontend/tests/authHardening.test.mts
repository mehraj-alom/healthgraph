/**
 * authHardening — source guards for the confirmed client findings.
 *
 * Behavioral coverage (repo precedent: text-level guards for RN-bound
 * layers, as in batch5.test.mts):
 *   - Firebase auth persists via SecureStore, never plaintext AsyncStorage
 *   - production base URL must be https (dev LAN http stays allowed)
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/authHardening.test.mts
 */

import { test, describe } from 'node:test';
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

describe('auth hardening wiring', () => {
  test('Firebase persistence is SecureStore-backed', () => {
    const auth = src('src/context/AuthContext.tsx');
    assert.ok(auth.includes('securePersistence'), 'SecureStore persistence wired');
    assert.ok(
      auth.includes("from '@/services/securePersistence'") ||
        auth.includes('from "@/services/securePersistence"'),
      'persistence module imported',
    );
    assert.ok(
      !auth.includes('getReactNativePersistence(AsyncStorage)'),
      'no plaintext AsyncStorage auth persistence',
    );
  });

  test('SecureStore persistence chunks past the 2048-byte limit', () => {
    const persist = src('src/services/securePersistence.ts');
    assert.ok(persist.includes('expo-secure-store'), 'SecureStore used');
    assert.ok(persist.includes('#'), 'chunked keys');
    assert.ok(persist.includes('isAvailableAsync'), 'availability probe');
  });

  test('production base URL must be https', () => {
    const api = src('src/services/api.ts');
    assert.ok(
      api.includes('must use https://'),
      'https enforcement error present',
    );
    assert.ok(api.includes('10.22.93.11:8000'), 'dev LAN fallback preserved');
  });
});
