/**
 * rPPG model metadata + message-copy unit tests.
 *
 * Covers the pure, dependency-free logic in
 * frontend/src/services/rppg/modelMeta.ts that the download manager and the
 * measurement hook depend on:
 *   - manifest integrity (version/size/checksum/URL shape)
 *   - base64 encoder correctness (RFC 4648 vectors, incl. padding + fallback)
 *   - user-facing failure copy per code (no raw internals leak)
 *
 * Run with Node built-ins (no Jest, no new deps):
 *   node --experimental-strip-types --test frontend/tests/rppgModelManager.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  RPPG_MODEL_MANIFEST,
  base64Encode,
  friendlyRppgModelMessage,
} from '../src/services/rppg/modelMeta.ts';
import {
  ASSET_RELEASE_TAG,
  assetUrl,
  getAssetBaseUrl,
} from '../src/services/assetHost.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function repoSrc(rel: string): string {
  return fs.readFileSync(path.join(HERE, '..', rel), 'utf8');
}

// ============================================================================
// Manifest — the fingerprint the installer enforces
// ============================================================================

describe('RPPG_MODEL_MANIFEST', () => {
  test('pins a versioned filename, size, checksum, and remote path', () => {
    assert.match(RPPG_MODEL_MANIFEST.version, /^\d+\.\d+\.\d+$/);
    assert.equal(RPPG_MODEL_MANIFEST.filename, 'physformer_rppg_fp16.onnx');
    assert.ok(
      Number.isInteger(RPPG_MODEL_MANIFEST.size) && RPPG_MODEL_MANIFEST.size > 0,
    );
    assert.match(RPPG_MODEL_MANIFEST.sha256Base64, /^[0-9a-f]{64}$/);
    assert.equal(
      RPPG_MODEL_MANIFEST.remotePath,
      'physformer_rppg_fp16.onnx',
    );
  });

  test('size matches the repo asset within tolerance', async () => {
    const { statSync } = await import('node:fs');
    const bytes = statSync(
      new URL('../assets/models/rppg/physformer_rppg_fp16.onnx', import.meta.url),
    ).size;
    assert.equal(bytes, RPPG_MODEL_MANIFEST.size);
  });

  test('checksum matches sha256(base64(bytes)) of the repo asset', async () => {
    const { readFileSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const bytes = readFileSync(
      new URL('../assets/models/rppg/physformer_rppg_fp16.onnx', import.meta.url),
    );
    const digest = createHash('sha256')
      .update(bytes.toString('base64'))
      .digest('hex');
    assert.equal(digest, RPPG_MODEL_MANIFEST.sha256Base64);
  });
});

// ============================================================================
// base64Encode — must equal Buffer/base64 (the checksum depends on it)
// ============================================================================

describe('base64Encode', () => {
  const vectors: Array<[string, string]> = [
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ];

  for (const [input, expected] of vectors) {
    test(`encodes ${JSON.stringify(input)}`, () => {
      const bytes = new TextEncoder().encode(input);
      assert.equal(base64Encode(bytes), expected);
    });
  }

  test('matches Node base64 on binary data incl. high bytes', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    assert.equal(
      base64Encode(bytes),
      Buffer.from(bytes).toString('base64'),
    );
  });

  test('pure-JS fallback matches btoa path', () => {
    // Force the fallback by hiding btoa for the duration of the call.
    const g = globalThis as Record<string, unknown>;
    const saved = g['btoa'];
    g['btoa'] = undefined;
    try {
      const bytes = new TextEncoder().encode('fallback check ✓');
      const expected = Buffer.from(bytes).toString('base64');
      assert.equal(base64Encode(bytes), expected);
    } finally {
      g['btoa'] = saved;
    }
  });
});

// ============================================================================
// Asset URLs — must match the verified public release (no auth, no drift)
// ============================================================================

describe('asset URLs', () => {
  test('default base is the public assets release', () => {
    assert.equal(
      getAssetBaseUrl(),
      `https://github.com/mehraj-alom/healthgraph-assets/releases/download/${ASSET_RELEASE_TAG}`,
    );
  });

  test('HTTP error pages never masquerade as checksum failures', () => {
    const mgr = repoSrc('src/services/rppg/modelManager.ts');
    // File.downloadFileAsync exposes no HTTP status, so the manager takes
    // a cheap HEAD first: a non-OK verdict fails fast with the server
    // status instead of falling through to a misleading checksum mismatch.
    assert.ok(mgr.includes("method: 'HEAD'"), 'HEAD pre-check present');
    assert.ok(mgr.includes('HTTP ${head.status}'), 'server verdict surfaced');
    assert.ok(mgr.includes('checksum'), 'integrity gates retained');
  });

test('model + sample anatomy URLs resolve flat under the release', () => {
    assert.equal(
      assetUrl(RPPG_MODEL_MANIFEST.remotePath),
      `${getAssetBaseUrl()}/physformer_rppg_fp16.onnx`,
    );
    assert.equal(
      assetUrl('renal_male.glb'),
      `${getAssetBaseUrl()}/renal_male.glb`,
    );
  });
});

// ============================================================================
// friendlyRppgModelMessage — exact copy per failure code
// ============================================================================

describe('friendlyRppgModelMessage', () => {
  test('each code maps to distinct, jargon-free copy', () => {
    const seen = new Set<string>();
    for (const code of ['network', 'checksum', 'storage'] as const) {
      const msg = friendlyRppgModelMessage(code);
      assert.ok(msg.length > 20, code);
      assert.ok(!/500|503|ERR_|status code/i.test(msg), code);
      assert.ok(!seen.has(msg), `duplicate copy for ${code}`);
      seen.add(msg);
    }
  });

  test('unknown/undefined codes fall back to the generic message', () => {
    const generic = friendlyRppgModelMessage(undefined);
    assert.equal(friendlyRppgModelMessage('bogus'), generic);
    assert.equal(friendlyRppgModelMessage('cancelled'), generic);
    assert.ok(generic.length > 10);
  });
});
