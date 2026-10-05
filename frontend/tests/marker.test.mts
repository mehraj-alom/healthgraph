/**
 * marker.test.mts — sketchpen tagline shading (node --experimental-strip-types).
 *
 * Pure scribble math runs directly (markerScribble.ts is zero-import).
 * Placement behind graph taglines (dial rim labels + graph card titles)
 * is pinned by source-text contract.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MARKER_COLOR, scribblePaths } from '../src/components/markerScribble.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('scribble math', () => {
  test('marker color is highlighter yellow (never a data encoding)', () => {
    assert.equal(MARKER_COLOR, '#FFD84D');
  });

  test('double stroke: full pass plus shorter overlap', () => {
    const s = scribblePaths(0, 0, 100, 12);
    assert.ok(s.main.startsWith('M') && s.main.includes('L'), 'main pass strokes');
    assert.ok(s.over.startsWith('M') && s.over.includes('L'), 'overlap strokes');
    const extent = (d: string): number =>
      Math.max(...d.split(' ').filter((t) => /^-?\d+(\.\d+)?$/.test(t)).map(Number).filter((_, i) => i % 2 === 0));
    assert.ok(extent(s.over) < extent(s.main), 'overlap is shorter');
    assert.ok(s.mainWidth > s.overWidth, 'overlap is thinner');
  });

  test('widths scale with text height', () => {
    const small = scribblePaths(0, 0, 60, 8);
    const big = scribblePaths(0, 0, 60, 16);
    assert.ok(big.mainWidth > small.mainWidth);
  });

  test('deterministic across renders (no shimmer)', () => {
    const a = scribblePaths(10, 20, 90, 12);
    const b = scribblePaths(10, 20, 90, 12);
    assert.deepEqual(a, b);
  });
});

describe('marker wiring', () => {
  test('section headers shade their taglines by default (accent-aware)', () => {
    const header = src('src/components/SectionHeader.tsx');
    assert.ok(header.includes('MarkerHighlight'), 'title wrapped');
    assert.ok(header.includes('marked = true'), 'on by default');
    assert.ok(header.includes('accent ?? (dark ? MARK_DARK : undefined)'), 'accent hue, slate on dark glass, highlighter otherwise');
  });  test('graph card titles wear their curve color (no marker shade)', () => {
    const card = src('src/components/home/CorrelationGraphCard.tsx');
    assert.ok(!card.includes('MarkerHighlight'), 'marker shade removed with the redesign');
    assert.ok(card.includes('titleColor'), 'title tinted by its own stream color');
    assert.ok(card.includes('windowDate'), 'window date sits right of the title');
  });

  test('dial rim labels carry the shade behind the tagline', () => {
    const map = src('src/components/home/HGraphMap.tsx');
    assert.ok(map.includes('scribblePaths'), 'scribble computed per spoke');
    assert.ok(map.includes('MARK_DARK'), 'slate shade on dark glass');
  });
});
