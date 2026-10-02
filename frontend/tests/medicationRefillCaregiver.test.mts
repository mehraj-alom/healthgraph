/**
 * medicationRefillCaregiver — tests for refill pickup logging + caregiver
 * report (Medisafe gap).
 *
 * Behavioral coverage (pure, node-testable):
 *   - refill pickup validation (positive integer fill, valid non-future
 *     pickup day; refills_left decrements with a floor of zero, null stays
 *     null — never invented)
 *   - caregiver report renders schedule + adherence + supply lines with
 *     every value escaped; null when there is nothing to report; honest
 *     partial states (unknown adherence/supply shown as such, never filled)
 * plus wiring guards (text-level, repo precedent):
 *   - report builder stays dependency-free (no imports, no network)
 *   - ReportScreen stays device-only after the caregiver variant lands
 *   - no clinical/advisory language anywhere in the new surface
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/medicationRefillCaregiver.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { refillPickup } from '../src/utils/medicationAdherence.ts';
import { buildCaregiverReportHtml } from '../src/services/doctorReportHtml.ts';

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

// ============================================================================
// Refill pickup math
// ============================================================================

describe('refill pickup', () => {
  test('valid pickup resets supply to the new fill and burns one refill', () => {
    const out = refillPickup(
      { supply_quantity: 5, refills_left: 2 },
      { quantity: 30, pickedUpOn: '2026-10-01' },
      '2026-10-02',
    );
    assert.deepEqual(out, {
      supply_quantity: 30,
      supply_started_on: '2026-10-01',
      refills_left: 1,
    });
  });

  test('unknown refills stay unknown; zero floors at zero', () => {
    const unknown = refillPickup(
      { supply_quantity: 0, refills_left: null },
      { quantity: 30, pickedUpOn: '2026-10-01' },
      '2026-10-02',
    );
    assert.equal(unknown.refills_left, null);
    const floor = refillPickup(
      { supply_quantity: 0, refills_left: 0 },
      { quantity: 30, pickedUpOn: '2026-10-01' },
      '2026-10-02',
    );
    assert.equal(floor.refills_left, 0);
  });

  test('bad fill size or pickup day throws; nothing to apply', () => {
    const med = { supply_quantity: 5, refills_left: 2 };
    assert.throws(() => refillPickup(med, { quantity: 0, pickedUpOn: '2026-10-01' }, '2026-10-02'));
    assert.throws(() => refillPickup(med, { quantity: -4, pickedUpOn: '2026-10-01' }, '2026-10-02'));
    assert.throws(() => refillPickup(med, { quantity: 2.5, pickedUpOn: '2026-10-01' }, '2026-10-02'));
    assert.throws(() => refillPickup(med, { quantity: 30, pickedUpOn: 'not-a-day' }, '2026-10-02'));
    assert.throws(() => refillPickup(med, { quantity: 30, pickedUpOn: '2026-10-05' }, '2026-10-02'));
  });
});

// ============================================================================
// Caregiver report builder
// ============================================================================

const CAREGIVER_INPUT = {
  generatedAt: 'Oct 2, 2026',
  windowDays: 7,
  patientName: 'Alex',
  meds: [
    {
      name: 'Lisinopril',
      schedule: '10 mg · once daily · morning',
      adherence: 86,
      supply: '12 days left · 1 refill left',
    },
    {
      name: 'Vitamin D<script>',
      schedule: null,
      adherence: null,
      supply: null,
    },
  ],
};

describe('buildCaregiverReportHtml', () => {
  test('renders schedule, adherence, and supply lines with values', () => {
    const html = buildCaregiverReportHtml(CAREGIVER_INPUT);
    assert.ok(html !== null);
    assert.ok(html.includes('Lisinopril'));
    assert.ok(html.includes('once daily'));
    assert.ok(html.includes('86%'));
    assert.ok(html.includes('12 days left'));
    assert.ok(html.includes('Alex'));
  });

  test('escapes hostile input; unknowns shown as unknown', () => {
    const html = buildCaregiverReportHtml(CAREGIVER_INPUT);
    assert.ok(html !== null);
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('Vitamin D&lt;script&gt;'));
    assert.ok(html.includes('Not recorded'));
  });

  test('null when there is nothing to report', () => {
    assert.equal(
      buildCaregiverReportHtml({ ...CAREGIVER_INPUT, meds: [] }),
      null,
    );
  });
});

// ============================================================================
// Wiring + copy guards
// ============================================================================

describe('refill + caregiver wiring + copy guards', () => {
  test('report builder stays dependency-free', () => {
    const builder = src('src/services/doctorReportHtml.ts');
    assert.ok(!builder.includes('import '), 'zero imports');
    assert.ok(!builder.includes('fetch('), 'no network');
  });

  test('ReportScreen stays device-only with the caregiver variant', () => {
    const screen = src('src/screens/Report/ReportScreen.tsx');
    assert.ok(screen.includes('Caregiver'), 'caregiver option present');
    assert.ok(screen.includes('buildCaregiverReportHtml'), 'caregiver builder wired');
    assert.ok(screen.includes('printToFileAsync'), 'PDF generation');
    assert.ok(screen.includes('shareAsync'), 'OS share sheet');
    assert.ok(!screen.includes('fetch('), 'no network calls');
    assert.ok(!screen.includes('/api/v1/'), 'no backend dependency');
  });

  test('MedicationsScreen offers refill pickup logging per medication', () => {
    const meds = src('src/screens/Medications/MedicationsScreen.tsx');
    assert.ok(meds.includes('refillPickup'), 'pickup math wired');
    assert.ok(meds.includes('Log refill'), 'pickup action present');
  });

  test('no clinical or advisory language anywhere in the new surface', () => {
    // The established wellness denial ("not a diagnosis", "not medical
    // advice") is allowlisted — it denies claims instead of making them.
    const hay = [
      src('src/services/doctorReportHtml.ts'),
      src('src/screens/Report/ReportScreen.tsx'),
      src('src/utils/medicationAdherence.ts'),
    ]
      .join('\n')
      .toLowerCase()
      .replaceAll('not a diagnosis', '')
      .replaceAll('not medical advice', '');
    for (const phrase of [
      'diagnos',
      'disorder',
      'syndrome',
      'treatment plan',
      'recommended dose',
      'you should take',
      'prescribes',
      'increase your dose',
      'decrease your dose',
      'skip your dose',
    ]) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });
});
