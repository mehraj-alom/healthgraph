/**
 * batch2 — tests for food classification, timeline detail, prescription
 * review, and profile preferences.
 *
 * Behavioral coverage (pure, node-runnable):
 *   - meal classification: seven types, time-of-day suggestion, label
 *     prefixing with re-classification safety, unknown rejection
 *   - persisted food labels never stack type prefixes
 * plus wiring guards (text-level, repo precedent) for RN-bound layers:
 *   - scan never auto-logs (explicit Log CTA only; retake cancels clean)
 *   - timeline local rows expand with on-device provenance
 *   - prescription review captures route + requires confirmation
 *   - profile preferences navigate to setup; deletion flows guarded
 *   - no diagnosis/disease/treatment language in new wellness copy
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/batch2.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  MEAL_TYPES,
  formatMealLabel,
  isMealType,
  stripMealPrefix,
  suggestMealType,
} from '../src/screens/FoodScan/mealTypes.ts';
import {
  FOCUS_AREAS,
  HEALTH_GOALS,
} from '../src/screens/Onboarding/options.ts';

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

function atHour(h: number): Date {
  const d = new Date(2026, 0, 15, 12, 0, 0);
  d.setHours(h);
  return d;
}

// ============================================================================
// Meal classification — pure contract
// ============================================================================

describe('meal classification', () => {
  test('seven stable consumption types', () => {
    assert.deepEqual([...MEAL_TYPES], [
      'Breakfast',
      'Lunch',
      'Dinner',
      'Snack',
      'Beverage',
      'Alcohol',
      'Other',
    ]);
  });

  test('time-of-day suggestion is a default, not a decision', () => {
    assert.equal(suggestMealType(atHour(7)), 'Breakfast');
    assert.equal(suggestMealType(atHour(12)), 'Lunch');
    assert.equal(suggestMealType(atHour(19)), 'Dinner');
    assert.equal(suggestMealType(atHour(23)), 'Snack');
    assert.equal(suggestMealType(atHour(3)), 'Snack');
  });

  test('unknown values are rejected (never persisted)', () => {
    assert.equal(isMealType('Lunch'), true);
    assert.equal(isMealType('Brunch'), false);
    assert.equal(isMealType(''), false);
    assert.equal(isMealType(null), false);
    assert.equal(isMealType(undefined), false);
  });

  test('label carries the classification; re-classification never stacks', () => {
    assert.equal(formatMealLabel('Lunch', 'salmon, rice'), 'Lunch — salmon, rice');
    assert.equal(
      formatMealLabel('Dinner', stripMealPrefix('Lunch — salmon, rice')),
      'Dinner — salmon, rice',
    );
    assert.equal(stripMealPrefix('plain label'), 'plain label');
    assert.equal(stripMealPrefix('Brunch — eggs'), 'Brunch — eggs');
    assert.equal(formatMealLabel('Snack', '   '), 'Snack — Scanned meal');
  });
});

// ============================================================================
// Wiring guards — RN-bound layers
// ============================================================================

describe('batch 2 wiring', () => {
  test('scan never auto-logs: explicit CTA logs, retake cancels clean', () => {
    const sheet = src('src/screens/FoodScan/ScanResultSheet.tsx');
    // Exactly one logging call site, inside the explicit Log handler.
    const calls = sheet.match(/await logScannedMeal\(/g) ?? [];
    assert.equal(calls.length, 1);
    assert.ok(sheet.includes('logScannedMeal(totalKcal, label, mealType)'), 'type passed');
    assert.ok(sheet.includes('MEAL_TYPES'), 'classification step rendered');
    assert.ok(sheet.includes('suggestMealType()'), 'suggestion is a default');
    // Cancel path: Retake invokes the reset callback, never the log call.
    assert.ok(sheet.includes('onPress={onRetake}'), 'retake cancels');
    const service = src('src/services/nutritionService.ts');
    assert.ok(service.includes('stripMealPrefix'), 're-classification safe');
  });

  test('timeline local rows expand with on-device provenance', () => {
    const timeline = src('src/screens/Timeline/TimelineScreen.tsx');
    assert.ok(timeline.includes('expanded={open}'), 'local rows expandable');
    assert.ok(timeline.includes('On this device'), 'local provenance badge');
    assert.ok(timeline.includes('Entered by you'), 'measured vs entered distinction');
  });

  test('prescription review captures route and requires confirmation', () => {
    const meds = src('src/screens/Medications/MedicationsScreen.tsx');
    for (const route of ['ORAL', 'TOPICAL', 'INJECTION', 'INHALED', 'SUBLINGUAL', 'RECTAL', 'NASAL', 'OPHTHALMIC', 'OTHER']) {
      assert.ok(meds.includes(`${route}:`), route);
    }
    assert.ok(meds.includes('ROUTE_LABELS'), 'route selector rendered');
    assert.ok(!meds.includes('void route'), 'route state no longer discarded');
    assert.ok(meds.toLowerCase().includes('wrong or missed entries are your responsibility'), 'responsibility copy');
    assert.ok(meds.includes('I checked all details against my prescription'), 'blocking confirmation before save');
    assert.ok(meds.includes('Medication name is required'), 'name gate before create');
    // No silent creation: the only medication POST lives in the Save handler.
    const posts = meds.match(/api\.post(?:<[^>]+>)?\(['"]\/api\/v1\/medications['"]/g) ?? [];
    assert.equal(posts.length, 1);
  });

  test('profile preferences link to setup; destructive flows stay guarded', () => {
    // Preferences live as compact Settings shortcuts + the Priority
    // world's Edit action (drawer holds the rest).
    const drawer = src('src/components/ProfileSheet.tsx');
    assert.ok(drawer.includes("go('Priority')"), 'priorities world link');
    const world = src('src/screens/Priority/PriorityWorldScreen.tsx');
    assert.ok(world.includes("navigate('OnboardingSetup')"), 'setup review link');
    const settings = src('src/screens/Settings/SettingsScreen.tsx');
    assert.ok(settings.includes('Goals & focus areas'), 'preferences section');
    assert.ok(settings.includes('deleteAllHealthData'), 'data deletion wired');
    assert.ok(settings.includes('deleteAccountCompletely'), 'account deletion wired');
    assert.ok(settings.includes('if (deleting) return'), 'double-submit guard');
  });

  test('new wellness copy carries no clinical claims', () => {
    // User-visible copy only (labels, hints, rendered strings) — never
    // diagnosis/disease/treatment framing.
    const visible = [...HEALTH_GOALS, ...FOCUS_AREAS]
      .map((o) => `${o.label} ${o.hint}`.toLowerCase())
      .join(' | ');
    for (const word of ['diagnos', 'disease', 'disorder', 'treatment', 'prescrib']) {
      assert.ok(!visible.includes(word), `options: ${word}`);
    }
    const sheet = src('src/screens/FoodScan/ScanResultSheet.tsx').toLowerCase();
    for (const word of ['diagnos', 'disease', 'treatment']) {
      assert.ok(!sheet.includes(word), `sheet: ${word}`);
    }
    const meal = src('src/screens/FoodScan/mealTypes.ts').toLowerCase();
    for (const word of ['diagnos', 'disease', 'treatment']) {
      assert.ok(!meal.includes(word), `mealTypes: ${word}`);
    }
  });
});
