/**
 * timelineBook.test.mts — book interaction + wireframe card contracts.
 *
 * Static guarantees (no device):
 * - vertical snap paging: flings settle page-by-page (snap offsets,
 *   fast deceleration, no interval momentum)
 * - pages tilt top-anchored with perspective while traveling (native driver)
 * - page card matches the wireframe: primary box + narrow side box +
 *   full-width bottom box, all data-driven
 */
import { test } from 'node:test';
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

const SCREEN = 'src/screens/Timeline/TimelineScreen.tsx';
const PAPER = 'src/screens/Timeline/DiaryPaper.tsx';

test('timeline snaps page-by-page on fling', () => {
  const s = src(SCREEN);
  assert.ok(s.includes('snapToOffsets={snapOffsets}'), 'snap offsets bound');
  assert.ok(s.includes('snapToAlignment="start"'), 'snap alignment');
  assert.ok(s.includes('decelerationRate="fast"'), 'fast settle');
  assert.ok(s.includes('disableIntervalMomentum'), 'fling turns pages, no free scroll');
  assert.ok(s.includes('DIARY_PAGE_STEP'), 'snap step is the fixed page step');
});

test('pages tilt top-anchored while traveling (native driver)', () => {
  const p = src(PAPER);
  assert.ok(p.includes('rotateX'), 'X-axis page turn');
  assert.ok(p.includes('perspective'), 'depth perspective');
  assert.ok(p.includes('useNativeDriver: true') || p.includes('Animated.Value'), 'animated scroll value');
  const s = src(SCREEN);
  assert.ok(s.includes('<TurningPage'), 'pages wrapped in the turn animation');
  assert.ok(s.includes('topOffset={headerH}'), 'turn math accounts for the header');
});

test('page card matches the wireframe boxes', () => {
  const p = src(PAPER);
  assert.ok(p.includes('Daily Report'), 'report header');
  assert.ok(p.includes('sideBox'), 'narrow side box beside the primary');
  assert.ok(p.includes('bottomBox'), 'full-width bottom box');
  assert.ok(p.includes('day.secondary'), 'side box is data-driven (runner-up)');
  assert.ok(p.includes('stripSummary'), 'bottom box summarizes real day data');
});

test('fixed page geometry keeps scroll math exact', () => {
  const p = src(PAPER);
  assert.ok(p.includes('DIARY_PAGE_HEIGHT = 336'), 'fixed page height');
  assert.ok(p.includes('DIARY_PAGE_STEP = DIARY_PAGE_HEIGHT + 18'), 'step includes the gap');
  const s = src(SCREEN);
  assert.ok(s.includes('getItemLayout'), 'exact layout for AI scroll + position restore');
});
