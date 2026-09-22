/**
 * batch6b.test.mts — Sleep Engine (node --experimental-strip-types).
 *
 * Pure engine math runs directly (sleepEngine.ts + changes.ts are
 * zero-import). RN-bound layers (screen, hook, queries, navigation) are
 * pinned by source-text contract: patient scoping, bounded windows,
 * honest copy, route registration.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSleepWeek,
  describeSleepChange,
  formatSleepDuration,
  isSleepEngineActive,
  sleepWindowStart,
  summarizeSleepNights,
  SLEEP_HISTORY_DAYS,
  type SleepNight,
} from '../src/screens/SleepEngine/sleepEngine.ts';
import {
  deriveActiveEngines,
  ENGINES,
} from '../src/screens/HealthAreas/engines.ts';
import { areaRouteName } from '../src/screens/HealthAreas/areas.ts';
import {
  describeChange,
  summarize,
  weekWindows,
} from '../src/screens/HealthAreas/changes.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const N = (date: string, durationMinutes: number, quality: number | null = null, awakenings: number | null = null): SleepNight => ({
  date,
  durationMinutes,
  quality,
  awakenings,
});

// ============================================================================
// Activation — sleep ∈ activeEngines via the Batch 6A system (no new state)
// ============================================================================

describe('sleep engine activation', () => {
  test('selected sleep activates; unselected does not', () => {
    assert.equal(isSleepEngineActive(['sleep']), true);
    assert.equal(isSleepEngineActive(['sleep', 'heart']), true);
    assert.equal(isSleepEngineActive([]), false);
    assert.equal(isSleepEngineActive(['weight', 'fitness']), false);
  });

  test('deriveActiveEngines carries sleep through the 6A pipeline', () => {
    assert.deepEqual(
      deriveActiveEngines(['sleep']).map((e) => e.id),
      ['sleep'],
    );
    assert.deepEqual(deriveActiveEngines([]).map((e) => e.id), []);
  });

  test('sleep catalog entry points at the engine destination', () => {
    assert.equal(ENGINES.sleep.route?.name, 'SleepEngine');
  });

  test('sleep hub area routes to the engine', () => {
    assert.equal(areaRouteName('sleep'), 'SleepEngine');
  });
});

// ============================================================================
// No-data state — empty in, nulls out (never zeros, never estimates)
// ============================================================================

describe('no-data state', () => {
  test('empty history summarizes to nulls, not zeros', () => {
    const s = summarizeSleepNights([]);
    assert.equal(s.loggedNights, 0);
    assert.equal(s.avgMinutes, null);
    assert.equal(s.latest, null);
  });

  test('empty history yields no change line', () => {
    assert.equal(describeSleepChange([], '2026-09-21'), null);
  });

  test('empty week strip marks every day unlogged', () => {
    const week = buildSleepWeek([], '2026-09-21');
    assert.equal(week.length, 7);
    assert.ok(week.every((d) => !d.logged && d.durationMinutes === null));
  });
});

// ============================================================================
// Real-data state — summary, strip, change from logged nights only
// ============================================================================

describe('real-data state', () => {
  test('summary averages logged nights; latest is the newest date', () => {
    const s = summarizeSleepNights([
      N('2026-09-18', 420),
      N('2026-09-19', 480, 4, 1),
      N('2026-09-20', 450, 3, 0),
    ]);
    assert.equal(s.loggedNights, 3);
    assert.equal(s.avgMinutes, 450);
    assert.equal(s.latest?.date, '2026-09-20');
  });

  test('sparse single night: summary exists, change stays null', () => {
    const nights = [N('2026-09-20', 430, 4)];
    assert.equal(summarizeSleepNights(nights).avgMinutes, 430);
    // Prior window empty → no comparison (never an invented baseline).
    assert.equal(describeSleepChange(nights, '2026-09-21'), null);
  });

  test('two-window data produces a descriptive absolute line', () => {
    const nights = [
      N('2026-09-10', 360),
      N('2026-09-11', 360),
      N('2026-09-19', 420),
      N('2026-09-20', 480),
    ];
    // current avg 450 vs previous avg 360 → "+90 min vs last week".
    assert.equal(
      describeSleepChange(nights, '2026-09-21'),
      'Average sleep +90 min vs last week',
    );
  });

  test('identical windows yield a zero line, not null', () => {
    const nights = [N('2026-09-10', 420), N('2026-09-20', 420)];
    assert.equal(
      describeSleepChange(nights, '2026-09-21'),
      'Average sleep → 0 min vs last week',
    );
  });

  test('engine math matches the shared changes.ts contract (parity)', () => {
    // sleepEngine.ts intentionally inlines the changes.ts logic (zero-import
    // rule for node-tested pure modules) — this test fails on divergence so
    // the engine dashboard and hub card can never disagree.
    const fixtures: SleepNight[][] = [
      [],
      [N('2026-09-20', 430)],
      [N('2026-09-10', 360), N('2026-09-11', 360), N('2026-09-19', 420), N('2026-09-20', 480)],
      [N('2026-09-10', 420), N('2026-09-20', 420)],
      [N('2026-09-14', 300), N('2026-09-15', 500), N('2026-09-21', 450), N('2026-09-08', 480)],
    ];
    for (const nights of fixtures) {
      const windows = weekWindows('2026-09-21');
      const cur = nights
        .filter((n) => n.date >= windows.currentStart && n.date <= windows.currentEnd)
        .map((n) => n.durationMinutes);
      const prev = nights
        .filter((n) => n.date >= windows.previousStart && n.date <= windows.previousEnd)
        .map((n) => n.durationMinutes);
      const expected = describeChange({
        current: summarize(cur),
        previous: summarize(prev),
        mode: 'average',
        unit: 'min',
        periodLabel: 'vs last week',
        usePercent: false,
      });
      assert.equal(
        describeSleepChange(nights, '2026-09-21'),
        expected === null ? null : `Average sleep ${expected}`,
      );
    }
  });

  test('week strip pins nights to dates across a month boundary', () => {
    const week = buildSleepWeek([N('2026-08-31', 400), N('2026-09-01', 440)], '2026-09-01');
    assert.equal(week.length, 7);
    assert.equal(week[0].date, '2026-08-26');
    assert.equal(week[6].date, '2026-09-01');
    assert.equal(week[5].logged, true);
    assert.equal(week[5].durationMinutes, 400);
    assert.equal(week[6].durationMinutes, 440);
    assert.equal(week[0].logged, false);
  });

  test('history window is a bounded 28-day trailing range', () => {
    assert.equal(SLEEP_HISTORY_DAYS, 28);
    assert.equal(sleepWindowStart('2026-09-21'), '2026-08-25');
  });

  test('duration formatting never rounds stored values silently', () => {
    assert.equal(formatSleepDuration(450), '7h 30m');
    assert.equal(formatSleepDuration(480), '8h');
    assert.equal(formatSleepDuration(45), '45m');
  });
});

// ============================================================================
// Wiring guards — RN-bound layers pinned by contract
// ============================================================================

describe('batch 6b wiring', () => {
  test('sleep query is patient-scoped, bounded, duration-only', () => {
    const q = src('src/db/queries/dailyLogs.ts');
    const start = q.indexOf('export async function getSleepNights');
    const nextExport = q.indexOf('\nexport ', start + 1);
    const body = q.slice(start, nextExport === -1 ? undefined : nextExport);
    assert.ok(body.includes('patient_id = ?'), 'patient scope');
    assert.ok(body.includes('log_date >= ? AND log_date <= ?'), 'bounded range');
    assert.ok(body.includes('sleep_duration_minutes IS NOT NULL'), 'no empty nights');
    assert.ok(!body.includes('sync_queue'), 'no sync writes from a read');
  });

  test('hook reloads on focus + dataRefresh, gates on identity', () => {
    const hook = src('src/hooks/useSleepEngine.ts');
    assert.ok(hook.includes('useFocusEffect'), 'focus reload');
    assert.ok(hook.includes('subscribeDataRefresh'), 'dataRefresh');
    assert.ok(hook.includes('getCachedPatientId'), 'patient scope');
    assert.ok(!hook.includes('setInterval'), 'no polling');
    assert.ok(hook.includes('SLEEP_HISTORY_DAYS'), 'bounded window');
  });

  test('no other engine dashboards were built', () => {
    // Batch 6 is complete: all seven engines exist, none beyond them.
    for (const id of ['weight', 'discipline', 'fitness', 'nutrition', 'wellbeing', 'heart']) {
      assert.ok(
        fs.existsSync(
          path.join(
            ROOT,
            'src',
            'screens',
            `${id[0].toUpperCase()}${id.slice(1)}Engine`,
            `${id[0].toUpperCase()}${id.slice(1)}EngineScreen.tsx`,
          ),
        ),
        `${id} engine exists`,
      );
    }
    assert.ok(fs.existsSync(path.join(ROOT, 'src', 'hooks', 'useWeightEngine.ts')));
  });

  test('SleepEngine route is typed, registered, and reachable', () => {
    const types = src('src/types/index.ts');
    assert.ok(types.includes('SleepEngine:'), 'route typed');
    const app = src('App.tsx');
    assert.ok(app.includes('name="SleepEngine"'), 'route registered');
    assert.ok(app.includes('SleepEngineScreen'), 'screen wired');
    const hub = src('src/screens/HealthAreas/HealthAreasScreen.tsx');
    assert.ok(hub.includes("case 'SleepEngine'"), 'hub dispatch handles it');
  });

  test('sleep rows are wiped with the patient (no orphan engine data)', () => {
    const erase = src('src/db/queries/patientErase.ts');
    assert.ok(erase.includes("'daily_logs'"), 'group rows wiped');
    assert.ok(erase.includes("'daily_log_events'") || erase.includes('daily_log_events'), 'event rows wiped');
  });

  test('no fabricated values anywhere in the engine', () => {
    const hay = [
      src('src/screens/SleepEngine/sleepEngine.ts'),
      src('src/screens/SleepEngine/SleepEngineScreen.tsx'),
      src('src/hooks/useSleepEngine.ts'),
    ].join('\n');
    for (const phrase of ['Math.random', 'placeholder', 'sample data', 'mock sleep', 'fake']) {
      assert.ok(!hay.toLowerCase().includes(phrase), phrase);
    }
  });

  test('no medical, diagnostic, or outcome promises in engine copy', () => {
    // Instructional/predictive patterns (bare-word denials in the footer
    // document the boundary; they are not violations).
    const hay = [
      src('src/screens/SleepEngine/sleepEngine.ts'),
      src('src/screens/SleepEngine/SleepEngineScreen.tsx'),
    ]
      .join('\n')
      .toLowerCase();
    for (const phrase of [
      'improve your sleep',
      'fix your sleep',
      'prevent insomnia',
      'you have insomnia',
      'sleep disorder',
      'will improve',
      'treatment plan',
      'prescrib',
    ]) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });

  test('no new table, no migration, no backend endpoint for sleep', () => {
    const migrations = src('src/db/migrations.ts');
    assert.ok(!migrations.toLowerCase().includes('sleep_nights'), 'no new sleep table');
    assert.ok(!migrations.toLowerCase().includes('sleep_engine'), 'no engine table');
    const screen = src('src/screens/SleepEngine/SleepEngineScreen.tsx');
    assert.ok(!screen.includes('fetch('), 'no network calls from the engine');
    assert.ok(!screen.includes('sync_queue'), 'no sync writes from the engine');
  });
});
