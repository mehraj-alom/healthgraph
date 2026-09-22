/**
 * habits.test.mts — GitHub-style habit tracker (node --experimental-strip-types).
 *
 * Pure grid math runs directly (habitTracker.ts is zero-import). RN-bound
 * layers (hook, grid, settings mount) are pinned by source-text contract.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HABIT_WEEKS,
  buildHabitWeeks,
  habitLevel,
} from '../src/screens/Settings/habitTracker.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const TODAY = '2026-09-21'; // a Monday

describe('habit grid math', () => {
  test('levels are fixed thresholds over counts (0 stays 0)', () => {
    assert.equal(habitLevel(0), 0);
    assert.equal(habitLevel(-3), 0);
    assert.equal(habitLevel(NaN), 0);
    assert.equal(habitLevel(1), 1);
    assert.equal(habitLevel(2), 2);
    assert.equal(habitLevel(3), 2);
    assert.equal(habitLevel(4), 3);
    assert.equal(habitLevel(5), 3);
    assert.equal(habitLevel(6), 4);
    assert.equal(habitLevel(40), 4);
  });

  test('grid is 16 Sunday-start week columns', () => {
    assert.equal(HABIT_WEEKS, 16);
    const weeks = buildHabitWeeks(new Map(), TODAY);
    assert.equal(weeks.length, 16);
    for (const week of weeks) assert.equal(week.length, 7);
    // First cell is a Sunday, last column ends on Saturday.
    assert.equal(new Date(`${weeks[0][0].date}T12:00:00`).getDay(), 0);
    assert.equal(new Date(`${weeks[15][6].date}T12:00:00`).getDay(), 6);
  });

  test('counts land on their days; future days render blank, not zero', () => {
    const counts = new Map([
      ['2026-09-21', 5],
      ['2026-09-20', 1],
    ]);
    const weeks = buildHabitWeeks(counts, TODAY);
    const flat = weeks.flat();
    const monday = flat.find((c) => c.date === '2026-09-21')!;
    assert.deepEqual([monday.count, monday.level, monday.future], [5, 3, false]);
    const sunday = flat.find((c) => c.date === '2026-09-20')!;
    assert.deepEqual([sunday.count, sunday.level, sunday.future], [1, 1, false]);
    // Tuesday 09-22 is after today: blank future, never a zero-activity day.
    const future = flat.find((c) => c.date === '2026-09-22')!;
    assert.equal(future.future, true);
    assert.equal(future.count, 0);
    // No day before the window leaks in.
    assert.ok(flat.every((c) => c.date >= weeks[0][0].date));
  });

  test('fractional and negative counts sanitize to honest integers', () => {
    const weeks = buildHabitWeeks(new Map([['2026-09-21', 2.9]]), TODAY);
    const monday = weeks.flat().find((c) => c.date === '2026-09-21')!;
    assert.equal(monday.count, 2);
  });
});

describe('duplicate-date hardening', () => {
  test('range queries collapse duplicate group rows (latest wins, date keys unique)', () => {
    const q = src('src/db/queries/dailyLogs.ts');
    for (const fn of ['getSleepNights', 'getNutritionDays', 'getWellbeingDays']) {
      const start = q.indexOf(`export async function ${fn}`);
      const nextExport = q.indexOf('\nexport ', start + 1);
      const body = q.slice(start, nextExport === -1 ? undefined : nextExport);
      assert.ok(body.includes('ORDER BY updated_at DESC'), `${fn}: latest-first`);
      assert.ok(body.includes('seen.has(day)'), `${fn}: per-date dedupe`);
      assert.ok(body.includes('.sort('), `${fn}: ascending output`);
    }
  });

  test('habit hook counts one per logged date', () => {
    const hook = src('src/hooks/useHabitTracker.ts');
    assert.ok(hook.includes('seenLogDays'), 'log dates deduped before counting');
  });
});

describe('habit wiring', () => {
  test('hook counts bounded real rows, never writes or estimates', () => {
    const hook = src('src/hooks/useHabitTracker.ts');
    assert.ok(hook.includes('getDailyLogs'), 'check-in read');
    assert.ok(hook.includes('getTakenEventsInRange'), 'dose range read');
    assert.ok(hook.includes('listSubstanceEntries'), 'substance read');
    assert.ok(hook.includes('listCycleEntries'), 'cycle read');
    assert.ok(hook.includes('getRecentLocalHeartRates'), 'measurement read');
    assert.ok(hook.includes('getCachedPatientId'), 'patient scope');
    assert.ok(hook.includes('useFocusEffect'), 'focus reload');
    assert.ok(hook.includes('subscribeDataRefresh'), 'dataRefresh');
    assert.ok(!hook.includes('setInterval'), 'no polling');
    assert.ok(hook.includes('HABIT_WEEKS'), 'bounded window');
  });

  test('settings mounts the grid with honest copy (no scores)', () => {
    const settings = src('src/screens/Settings/SettingsScreen.tsx');
    assert.ok(settings.includes('<HabitGrid'), 'grid mounted');
    assert.ok(settings.includes('useHabitTracker'), 'hook mounted');
    const grid = src('src/screens/Settings/HabitGrid.tsx');
    assert.ok(!grid.toLowerCase().includes('score'), 'no score language');
    assert.ok(!grid.toLowerCase().includes('streak') || grid.includes('streakDays'), 'streak is a count');
  });

  test('compact preference rows reuse existing destinations', () => {
    const settings = src('src/screens/Settings/SettingsScreen.tsx');
    assert.ok(settings.includes('Goals & focus areas'), 'goals row present');
    assert.ok(settings.includes('Health areas'), 'areas row present');
    assert.ok(settings.includes("navigate('OnboardingSetup')"), 'setup destination');
    assert.ok(settings.includes("navigate('HealthAreas')"), 'areas destination');
  });

  test('profile save mirrors preferences to the backend', () => {
    const settings = src('src/screens/Settings/SettingsScreen.tsx');
    assert.ok(settings.includes('getOnboardingState'), 'reads local selections');
    assert.ok(settings.includes('payload.goals'), 'goals mirrored');
    assert.ok(settings.includes('payload.focus'), 'focus mirrored');
    assert.ok(settings.includes('requestDataRefresh'), 'restore refreshes UI');
  });
});
