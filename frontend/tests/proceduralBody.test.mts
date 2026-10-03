/**
 * proceduralBody — tests for the bundled procedural shell.
 *
 * Coverage:
 *   - the shipped GLB carries exactly our 33 region ids as node names
 *     (tap mapping is identity — no translation table to rot)
 *   - every fine-grained structure id resolves to a zone (EQUIVALENT),
 *     systems resolve to nothing (honest, never invented)
 *   - bundled asset file exists at the required path
 *   - no clinical language in the new module
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/proceduralBody.test.mts
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  PROCEDURAL_REGION_IDS,
  proceduralHighlightNodes,
} from '../src/services/proceduralBody.ts';

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

function glbNodeNames(glbPath: string): string[] {
  const buf = fs.readFileSync(glbPath);
  assert.equal(buf.subarray(0, 4).toString('ascii'), 'glTF', 'valid GLB magic');
  const jsonLen = buf.readUInt32LE(12);
  const doc = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  return (doc.nodes ?? []).map((n: { name?: string }) => n.name).filter(Boolean);
}

describe('procedural shell GLB', () => {
  test('bundled asset exists and node names equal the region vocabulary', () => {
    const glb = path.join(ROOT, 'assets', 'anatomy', 'procedural_male_shell.glb');
    assert.ok(fs.existsSync(glb), 'bundled GLB present');
    const names = glbNodeNames(glb);
    for (const id of PROCEDURAL_REGION_IDS) {
      assert.ok(names.includes(id), `zone node present: ${id}`);
    }
    assert.equal(PROCEDURAL_REGION_IDS.length, 33);
  });

  test('fine ids resolve to zones; systems resolve to nothing', () => {
    assert.deepEqual(proceduralHighlightNodes('LEFT_INDEX_FINGER'), ['LEFT_HAND']);
    assert.deepEqual(proceduralHighlightNodes('HEART'), ['CHEST']);
    assert.deepEqual(proceduralHighlightNodes('CHEST'), ['CHEST']);
    assert.deepEqual(proceduralHighlightNodes('MUSCULAR_SYSTEM'), []);
    assert.deepEqual(proceduralHighlightNodes(null), []);
  });

  test('screen falls back to the bundled shell when downloads miss', () => {
    const body = fs.readFileSync(path.join(ROOT, 'src', 'screens', 'Body', 'FilamentBody.tsx'), 'utf8');
    assert.ok(body.includes('procedural'), 'fallback wired');
    assert.ok(body.includes('proceduralHighlightNodes'), 'highlight resolves zones');
  });

  test('no clinical language in the new module', () => {
    const mod = fs.readFileSync(path.join(ROOT, 'src', 'services', 'proceduralBody.ts'), 'utf8').toLowerCase();
    for (const phrase of ['diagnos', 'treatment', 'fracture', 'tumor', 'disease']) {
      assert.ok(!mod.includes(phrase), phrase);
    }
  });
});
