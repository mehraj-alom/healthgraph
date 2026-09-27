/**
 * timelineBook.test.mts — stacked-page wheel + wireframe card contracts.
 *
 * Static guarantees (no device):
 * - the journal is a 3D stacked wheel: pages turn up/down with perspective,
 *   older pages fan out behind the front one (peek + scale + opacity)
 * - snapping settles the wheel on whole pages (no free drift)
 * - tapping front opens the report; tapping a page behind brings it forward
 * - the day report renderer receives a well-shaped node (regression: the
 *   old `diaryItem.node as PreparedItem` double-wrap crashed on open)
 * - the page card matches the wireframe: primary box + narrow side box +
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
const WHEEL = 'src/screens/Timeline/TimelineWheel.tsx';

test('the journal is a 3D stacked wheel with perspective', () => {
  const w = src(WHEEL);
  assert.ok(w.includes('PanResponder'), 'drag turns the wheel');
  assert.ok(w.includes('rotateX'), 'X-axis page turn');
  assert.ok(w.includes('perspective'), 'depth perspective');
  assert.ok(w.includes('useNativeDriver: true'), 'native-driven motion');
  const s = src(SCREEN);
  assert.ok(s.includes('<TimelineWheel'), 'screen renders the wheel');
});

test('snapping settles the wheel on whole pages', () => {
  const w = src(WHEEL);
  assert.ok(w.includes('Easing.out'), 'eased settle');
  assert.ok(w.includes('Math.round(posVal.current)'), 'rounds to the nearest page');
  assert.ok(w.includes('clampIndex'), 'never scrolls past the ends');
});

test('pages interpolate a single plain Animated.Value', () => {
  const w = src(WHEEL);
  // Composed-node interpolation (Animated.add/subtract results) is banned:
  // every page interpolates `pos` directly with a range centred on its index.
  assert.ok(!w.includes('Animated.subtract'), 'no composed subtraction node');
  assert.ok(!w.includes('Animated.divide'), 'no composed division node');
  assert.ok(!w.includes('Animated.add('), 'no composed addition node');
  assert.ok(w.includes('pos.interpolate({'), 'pages interpolate the plain wheel value');
});

test('older pages fan out behind the front page', () => {
  const w = src(WHEEL);
  assert.ok(w.includes('PEEK'), 'each page peeks out by a step');
  assert.ok(w.includes('zIndex'), 'front page stacks above older pages');
  assert.ok(w.includes('opacity'), 'deeper pages fade back');
  assert.ok(w.includes('scale'), 'deeper pages shrink');
});

test('tap front opens the report; tap behind brings it forward, then opens', () => {
  const w = src(WHEEL);
  assert.ok(w.includes('pendingOpen'), 'behind tap queues the page to open');
  assert.ok(w.includes('front ?') || w.includes('front\n'), 'front tap opens immediately');
});

test('day report rows receive a well-shaped node (regression)', () => {
  const s = src(SCREEN);
  // The crash was `diaryItem.node as PreparedItem` re-wrapping a DiaryItemInput.
  assert.ok(!s.includes('diaryItem.node as PreparedItem'), 'no double-wrapped node cast');
  assert.ok(!s.includes('renderTimelineItem'), 'ledger row renderer removed with the cards');
});

test('report opens as a staged pull-out, not a generic push', () => {
  const p = src(PAPER);
  assert.ok(p.includes('animationType="none"'), 'no stock modal slide');
  assert.ok(p.includes('Easing.out(Easing.cubic)'), 'rise-and-expand entrance');
  assert.ok(p.includes('translateY') && p.includes('scale'), 'page grows toward the user');
  assert.ok(p.includes('rgba(13, 20, 26, 0.72)'), 'timeline stays recognizable behind');
});

test('report is a formal document with header, sections, footer, disclaimer', () => {
  const v = src('src/screens/Timeline/ReportDocumentView.tsx');
  assert.ok(v.includes('Daily Health Report'), 'document title');
  assert.ok(v.includes('HEALTHGRAPH') || v.includes('HealthGraph'), 'wordmark masthead');
  assert.ok(v.includes('Digital Health Record Visualization'), 'footer line');
  assert.ok(
    v.includes('For visualization purposes only'),
    'visualization disclaimer present',
  );
  assert.ok(
    v.includes('No health activity recorded for this section.'),
    'explicit empty-data sentence, never fabricated rows',
  );
  assert.ok(v.includes('MedicationSection'), 'medication section from the med architecture');
  assert.ok(v.includes('No dose recorded'), 'never implies taken from scheduled');
});

test('no fabricated legal identity anywhere near the report', () => {
  for (const f of [PAPER, SCREEN, WHEEL, 'src/screens/Timeline/ReportDocumentView.tsx']) {
    const srcText = src(f);
    for (const banned of ['GmbH', 'Straße', 'Imprint', 'registration number', 'license']) {
      assert.ok(!srcText.includes(banned), `${f} contains no ${banned}`);
    }
  }
});

test('page card matches the wireframe boxes', () => {
  const p = src(PAPER);
  assert.ok(p.includes('Daily Report'), 'report header');
  assert.ok(p.includes('sideBox'), 'narrow side box beside the primary');
  assert.ok(p.includes('bottomBox'), 'full-width bottom box');
  assert.ok(p.includes('day.secondary'), 'side box is data-driven (runner-up)');
  assert.ok(p.includes('stripSummary'), 'bottom box summarizes real day data');
});

test('page control shows month + position of the front page', () => {
  const s = src(SCREEN);
  assert.ok(s.includes('pageIndicator'), 'position caption styles');
  assert.ok(s.includes('of ${diaryDays.length}'), 'n-of-N count');
  assert.ok(s.includes('onActiveChange'), 'wheel reports the front page');
  assert.ok(s.includes('month'), 'month label from the front day');
});

test('no custom back button; platform back path owns navigation', () => {
  const s = src(SCREEN);
  assert.ok(!s.includes('backBtn'), 'custom back pill removed');
  assert.ok(!s.includes('Go back'), 'no back label rendered');
  assert.ok(s.includes('swipe-back'), 'documents the platform back path');
});

test('controls meet the 44pt target and small text meets minimums', () => {
  const s = src(SCREEN);
  assert.ok(s.includes('size="medium"'), 'filter chips use the taller size');
  assert.ok(src(PAPER).includes('width: 44, height: 44'), 'day steppers keep 44pt targets');
  assert.ok(!s.includes('fontSize: 10'), 'no 10pt text on the screen');
  assert.ok(!s.includes('fontSize: 9'), 'no 9pt text on the screen');
  const p = src(PAPER);
  assert.ok(!p.includes('fontSize: 10'), 'no 10pt text on the page');
  assert.ok(!p.includes('fontSize: 9'), 'no 9pt text on the page');
});

test('document type folds to the scale with tabular values', () => {
  const v = src('src/screens/Timeline/ReportDocumentView.tsx');
  assert.ok(v.includes("fontVariant: ['tabular-nums']"), 'values keep tabular numerals');
  assert.ok(!v.includes('fontSize: 9'), 'no sub-minimum text in the document');
  assert.ok(!v.includes('fontSize: 10'), 'no sub-minimum text in the document');
  // Secondary document text uses paper-muted (4.95:1), never faint (2.47:1).
  assert.ok(!v.includes('PAPER.faint'), 'no failing faint tone in the document');
});

test('no dead SectionList-era styles linger', () => {
  const s = src(SCREEN);
  for (const dead of ['dateDivider', 'dateHeaderRow', 'dateHeading', 'dateCountPill', 'sectionFoot']) {
    assert.ok(!s.includes(dead), `removed dead style ${dead}`);
  }
});

test('fixed page geometry keeps the wheel stage exact', () => {
  const p = src(PAPER);
  assert.ok(p.includes('DIARY_PAGE_HEIGHT = 336'), 'fixed page height');
  const w = src(WHEEL);
  assert.ok(w.includes('DIARY_PAGE_HEIGHT'), 'wheel uses the fixed page height');
  const s = src(SCREEN);
  assert.ok(s.includes('useWindowDimensions'), 'stage adapts to the window');
  assert.ok(s.includes('wheelBox'), 'stage hosts the wheel');
});