/**
 * substanceGoals.test.mts — goals, streaks, milestones pure contract (node).
 *
 * Goals count what the user logged — nothing more: drink-equivalents come
 * only from drink-like units (anything else is reported separately, never
 * converted by guessing volumes); streaks count consecutive days without a
 * logged use; any use today restarts the count. Copy is descriptive
 * progress, never treatment language.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GOALS_STORAGE_KEY,
  MILESTONES,
  drinkEquivalents,
  goalStatusLine,
  milestonesReached,
  normalizeGoal,
  streakDays,
  weeklyUse,
} from '../src/services/substanceGoals.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const entry = (day: string, category = 'alcohol', amount_value: number | null = 1, amount_unit: string | null = 'drinks') => ({
  occurred_at: `${day}T20:00:00Z`,
  category,
  amount_value,
  amount_unit,
});

describe('drink-equivalent counting', () => {
  test('drink-like units count one each; anything else stays separate', () => {
    assert.equal(drinkEquivalents({ amount_value: 2, amount_unit: 'beers' } as never), null);
    assert.equal(drinkEquivalents({ amount_value: 2, amount_unit: 'drinks' } as never), 2);
    assert.equal(drinkEquivalents({ amount_value: 1, amount_unit: 'Glass' } as never), 1);
    assert.equal(drinkEquivalents({ amount_value: 3, amount_unit: 'shots' } as never), 3);
    assert.equal(drinkEquivalents({ amount_value: 2, amount_unit: 'bottles' } as never), null);
    assert.equal(drinkEquivalents({ amount_value: 2, amount_unit: null } as never), null);
    assert.equal(drinkEquivalents({ amount_value: -1, amount_unit: 'drinks' } as never), null);
    assert.equal(drinkEquivalents({ amount_value: 1.5, amount_unit: 'drinks' } as never), null);
  });
});

describe('weekly use', () => {
  test('seven-day window sums drink-equivalents and other units separately', () => {
    const entries = [
      entry('2026-09-28'),
      entry('2026-09-28', 'alcohol', 1, 'bottles'),
      entry('2026-09-20', 'alcohol', 5, 'drinks'),
      entry('2026-09-29', 'tobacco', 10, 'cigarettes'),
    ];
    const use = weeklyUse(entries as never, 'alcohol', '2026-09-30');
    assert.equal(use.drinks, 1);
    assert.equal(use.otherUnits, 1);
    assert.equal(use.entries, 2);
    const tobacco = weeklyUse(entries as never, 'tobacco', '2026-09-30');
    assert.equal(tobacco.drinks, 0);
    assert.equal(tobacco.otherUnits, 1);
  });
});

describe('streaks', () => {
  test('consecutive clean days count back from today; use today restarts', () => {
    const entries = [entry('2026-09-28'), entry('2026-09-27'), entry('2026-09-26')];
    assert.equal(streakDays(entries as never, 'alcohol', '2026-09-30'), 2);
    assert.equal(streakDays(entries as never, 'alcohol', '2026-09-29'), 1);
    assert.equal(streakDays([], 'alcohol', '2026-09-30'), 0);
  });

  test('other categories do not break the streak', () => {
    const entries = [entry('2026-09-30', 'tobacco', 5, 'cigarettes')];
    assert.equal(streakDays(entries as never, 'alcohol', '2026-09-30'), 0);
  });

  test('malformed dates never inflate a streak', () => {
    const entries = [{ occurred_at: 'garbage', category: 'alcohol', amount_value: 1, amount_unit: 'drinks' }];
    assert.equal(streakDays(entries as never, 'alcohol', '2026-09-30'), 0);
  });
});

describe('milestones', () => {
  test('standard ladder with next milestone identified', () => {
    assert.deepEqual(MILESTONES, [1, 3, 7, 14, 30, 60, 90, 180, 365]);
    assert.deepEqual(milestonesReached(0), { reached: [], next: 1 });
    assert.deepEqual(milestonesReached(7), { reached: [1, 3, 7], next: 14 });
    assert.deepEqual(milestonesReached(400), { reached: MILESTONES, next: null });
  });
});

describe('goal normalization + status lines', () => {
  test('garbage resolves to track mode with no target', () => {
    assert.deepEqual(normalizeGoal(null), { category: 'alcohol', mode: 'track' });
    assert.deepEqual(normalizeGoal({ category: 'tobacco', mode: 'quit' }), { category: 'tobacco', mode: 'quit' });
    assert.deepEqual(normalizeGoal({ category: 'alcohol', mode: 'reduce', weeklyCap: 7 }), {
      category: 'alcohol',
      mode: 'reduce',
      weeklyCap: 7,
    });
    assert.deepEqual(normalizeGoal({ category: 'alcohol', mode: 'reduce', weeklyCap: 0 }), {
      category: 'alcohol',
      mode: 'track',
    });
    assert.deepEqual(normalizeGoal({ category: 'other', mode: 'quit' }), { category: 'alcohol', mode: 'track' });
  });

  test('status lines describe without judging', () => {
    assert.equal(
      goalStatusLine({ category: 'alcohol', mode: 'reduce', weeklyCap: 7 }, { drinks: 5, otherUnits: 0, entries: 3 }, 2),
      '5 of 7 drinks this week · 2 days without logged use',
    );
    assert.equal(
      goalStatusLine({ category: 'alcohol', mode: 'reduce', weeklyCap: 7 }, { drinks: 9, otherUnits: 0, entries: 5 }, 0),
      '9 of 7 drinks this week · 0 days without logged use',
    );
    assert.equal(
      goalStatusLine({ category: 'alcohol', mode: 'quit' }, { drinks: 0, otherUnits: 0, entries: 0 }, 14),
      '14 days without logged use',
    );
    assert.equal(
      goalStatusLine({ category: 'alcohol', mode: 'track' }, { drinks: 2, otherUnits: 1, entries: 2 }, 0),
      '2 drinks + 1 entry in other units this week',
    );
  });
});

describe('substance goals wiring + copy guards', () => {
  test('versioned key; wiring uses storage only, no tables or network', () => {
    assert.ok(GOALS_STORAGE_KEY.startsWith('hg:'), 'namespaced key');
    const wiring = src('src/services/substanceGoalStore.ts');
    assert.ok(!wiring.includes('CREATE TABLE'), 'no schema');
    assert.ok(!wiring.includes('fetch('), 'no network');
    assert.ok(!wiring.includes('/api/'), 'no backend endpoints');
  });

  test('no treatment language anywhere in the goals surface', () => {
    const hay = [
      src('src/services/substanceGoals.ts'),
      src('src/services/substanceGoalStore.ts'),
    ]
      .join('\n')
      .toLowerCase();
    for (const phrase of ['treatment', 'therapy', 'withdrawal', 'detox', 'addiction', 'alcoholic', 'cure']) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });
});
