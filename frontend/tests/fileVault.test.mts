/**
 * fileVault.test.mts — sealed patient-file envelope (node --experimental-strip-types).
 *
 * Pure envelope math runs directly (fileEnvelope.ts imports only crypto-es,
 * zero native modules). IO wiring (seal on download, wipe on logout) is
 * pinned by source-text contract.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isSealedUri,
  openEnvelope,
  SEALED_SUFFIX,
  sealEnvelope,
} from '../src/services/fileEnvelope.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
// "hello file" as base64 — stands in for file bytes.
const HELLO_B64 = Buffer.from('hello file', 'utf8').toString('base64');

describe('envelope math', () => {
  test('seal round-trips back to the exact bytes', () => {
    const env = sealEnvelope(HELLO_B64, KEY);
    assert.equal(openEnvelope(env, KEY), HELLO_B64);
  });

  test('random IVs differ per seal (no deterministic ciphertext)', () => {
    const a = sealEnvelope(HELLO_B64, KEY);
    const b = sealEnvelope(HELLO_B64, KEY);
    assert.notEqual(a, b);
    assert.equal(openEnvelope(a, KEY), HELLO_B64);
    assert.equal(openEnvelope(b, KEY), HELLO_B64);
  });

  test('tampered ciphertext fails the integrity check', () => {
    const env = sealEnvelope(HELLO_B64, KEY);
    const tampered = env.slice(0, 20) + (env[20] === 'A' ? 'B' : 'A') + env.slice(21);
    assert.throws(() => openEnvelope(tampered, KEY), /integrity|envelope/i);
  });

  test('wrong key fails instead of returning garbage', () => {
    const env = sealEnvelope(HELLO_B64, KEY);
    const other = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    assert.throws(() => openEnvelope(env, other), /integrity/i);
  });

  test('malformed envelopes and keys throw', () => {
    assert.throws(() => openEnvelope('!!!not-base64!!!', KEY), /envelope/i);
    assert.throws(() => sealEnvelope(HELLO_B64, 'short'), /64 hex/);
    assert.throws(() => openEnvelope(sealEnvelope(HELLO_B64, KEY), 'short'), /64 hex/);
  });

  test('sealed suffix detection', () => {
    assert.equal(SEALED_SUFFIX, '.enc');
    assert.ok(isSealedUri('file:///x/photo.jpg.enc'));
    assert.ok(!isSealedUri('file:///x/photo.jpg'));
    assert.ok(!isSealedUri(null));
  });
});

describe('vault wiring', () => {
  test('downloads and local copies seal before returning', () => {
    const docs = src('src/services/documents.ts');
    assert.ok(docs.includes('sealCachedFile(patientId, result.uri)'), 'download seals');
    assert.ok(docs.includes('sealCachedFile(patientId, target)'), 'local copy seals');
  });

  test('logout and data wipe remove cached patient files', () => {
    const auth = src('src/context/AuthContext.tsx');
    assert.ok(auth.includes('wipePatientFiles'), 'logout wipes files');
    const deletion = src('src/services/deletion.ts');
    assert.ok(deletion.includes('wipePatientFiles'), 'erase wipes files');
  });

  test('viewed files decrypt to wiped temps, never lingering plaintext', () => {
    const detail = src('src/screens/Documents/DocumentDetailScreen.tsx');
    assert.ok(detail.includes('openSealedFile'), 'sealed opens via vault');
    assert.ok(detail.includes('wipeTemps'), 'temps wiped on close');
  });
});
