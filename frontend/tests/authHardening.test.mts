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
  test('Firebase persistence is a SecureStore-backed class definition', () => {
    // Firebase instantiates persistence via `new` (_getInstance asserts
    // `cls instanceof Function`, "expected a class definition") — a plain
    // object crashes startup, so this shape is load-bearing.
    const auth = src('src/context/AuthContext.tsx');
    assert.ok(auth.includes('secureStorePersistenceForAuth()'), 'factory product instantiated at init');
    assert.ok(auth.includes('secureStorePersistenceForAuth'), 'typed auth-slot alias used');
    assert.ok(
      !auth.includes('getReactNativePersistence(AsyncStorage)'),
      'no plaintext AsyncStorage auth persistence',
    );
    const persist = src('src/services/securePersistence.ts');
    assert.ok(persist.includes('expo-secure-store'), 'SecureStore used');
    assert.ok(persist.includes('export function getSecureStorePersistence'), 'class factory exported');
    assert.ok(persist.includes('return SecureStorePersistence'), 'factory returns the class, not an instance');
    assert.ok(persist.includes('JSON.stringify(value)'), 'values serialized like Firebase expects');
    assert.ok(persist.includes('JSON.parse(json)'), 'values deserialized like Firebase expects');
  });

  test('production base URL must be https', () => {
    const api = src('src/services/api.ts');
    assert.ok(
      api.includes('must use https://'),
      'https enforcement error present',
    );
    assert.ok(api.includes('10.22.93.11:8000'), 'dev LAN fallback preserved');
  });

  test('SecureStore chunk helpers round-trip without native modules', async () => {
    const { splitValue, joinParts, CHUNK_SIZE } = await import('../src/services/secureChunks.ts');
    assert.equal(typeof CHUNK_SIZE, 'number');
    assert.ok(CHUNK_SIZE <= 2048, 'chunks fit the SecureStore value cap');
    const blob = 'x'.repeat(CHUNK_SIZE * 2 + 17);
    const parts = splitValue(blob);
    assert.equal(parts.length, 3);
    assert.ok(parts.every(p => p.length <= CHUNK_SIZE), 'no oversized piece');
    assert.equal(joinParts(parts), blob, 'lossless round-trip');
    assert.equal(joinParts([]), '', 'empty joins to empty');
    assert.equal(joinParts(['a', null, 'b']), null, 'gap fails closed, never glues stale chunks');
    assert.equal(splitValue('').length, 0, 'empty splits to nothing');
  });

  test('Firebase keys encode to SecureStore-safe storage keys', async () => {
    const {
      encodeStorageKey, decodeStorageKey, toStoreKey, toChunkKey,
      parseCount, staleIndices,
    } = await import('../src/services/secureChunks.ts');
    const valid = /^[A-Za-z0-9._-]+$/;
    // Realistic Firebase persistence keys (colons, brackets, dots).
    const firebaseKeys = [
      'firebase:authUser:AIzaSyBX2-test_123:[DEFAULT]',
      'firebase:persistence:AIzaSyBX2-test_123:[DEFAULT]',
    ];
    for (const key of firebaseKeys) {
      const stored = toStoreKey('hg_fbauth_', key);
      assert.ok(valid.test(stored), `storage key valid: ${stored.slice(0, 40)}…`);
      for (let i = 0; i < 3; i++) {
        assert.ok(valid.test(toChunkKey('hg_fbauth_', key, i)), `chunk ${i} valid`);
      }
      assert.equal(decodeStorageKey(encodeStorageKey(key)), key, 'lossless key round-trip');
      assert.equal(encodeStorageKey(key), encodeStorageKey(key), 'deterministic across restarts');
    }
    // Collision resistance: adversarial near-misses must stay distinct.
    const tricky = ['a:b', 'a_x3a_b', 'a_b', 'a_x5f_b', '_', '', 'x:y:z', 'x_x3a_y_x3a_z', '🔑key', 'a/b\\c d'];
    const encoded = tricky.map(encodeStorageKey);
    assert.ok(encoded.every(e => valid.test(e) || e === ''), 'all outputs valid (empty stays empty)');
    assert.equal(new Set(encoded).size, tricky.length, 'no accidental collisions');
    for (const t of tricky) {
      assert.equal(decodeStorageKey(encodeStorageKey(t)), t, `injectivity holds for ${JSON.stringify(t)}`);
    }
    // Count parsing: garbage can never resurrect chunks.
    assert.equal(parseCount(null), 0, 'missing means none');
    assert.equal(parseCount('garbage!!'), 0, 'corrupt count means none');
    assert.equal(parseCount('-4'), 0, 'negative means none');
    assert.equal(parseCount('0'), 0, 'zero means none');
    assert.equal(parseCount('3'), 3, 'valid count passes');
    // Stale-chunk math: shrink 5→2 deletes exactly indices 2,3,4.
    assert.deepEqual(staleIndices(5, 2), [2, 3, 4]);
    assert.deepEqual(staleIndices(2, 2), []);
    assert.deepEqual(staleIndices(0, 3), []);
  });

  test('persistence layer routes every SecureStore call through encoded keys', () => {
    const persist = src('src/services/securePersistence.ts');
    assert.ok(!persist.includes('from') || !persist.includes('async-storage'), 'no AsyncStorage import');
    assert.ok(!persist.includes('AsyncStorage.'), 'no AsyncStorage member access anywhere');
    assert.ok(!persist.includes('#${i}'), 'no raw #-joined chunk keys (not SecureStore-safe)');
    for (const fn of ['getItemAsync', 'setItemAsync', 'deleteItemAsync']) {
      const uses = persist.split(fn).length - 1;
      assert.ok(uses > 0, `${fn} used`);
    }
    // Every SecureStore key argument flows via toStoreKey/toChunkKey/PROBE_KEY.
    const calls = [...persist.matchAll(/(getItemAsync|setItemAsync|deleteItemAsync)\(([^)]*)\)/g)];
    assert.ok(calls.length >= 7, 'all native key touchpoints present');
    for (const [, fn, args] of calls) {
      const first = args.split(',')[0].trim();
      const ok = first.includes('toStoreKey') || first.includes('toChunkKey') || first.includes('PROBE_KEY');
      assert.ok(ok, `${fn} key routed via encoder, got: ${first}`);
    }
  });
});
