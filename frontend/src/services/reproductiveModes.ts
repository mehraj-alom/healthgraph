/**
 * reproductiveModes.ts — TTC / pregnancy / perimenopause mode logic (v1).
 *
 * One mode per patient, device-only: 'standard' (existing predictions UI),
 * 'ttc' (fertile-window surfacing for planning + ovulation-test log),
 * 'pregnant' (week from LMP or due date + logistics checklist),
 * 'perimenopause' (cycle-variability note, no inference).
 *
 * Deliberate v1 boundaries: estimates, never certainties; TTC copy is
 * planning-only and names that it is not contraception; the pregnancy
 * checklist is appointments-and-paperwork logistics (no dosing, no triage,
 * no symptom interpretation); perimenopause copy frames variability without
 * diagnosing. Pinned by tests in reproductiveModes.test.mts.
 *
 * Zero imports: safe for node unit tests.
 */

import { fertileEstimate, type CycleStats, type PeriodStart } from './cyclePredictions.ts';

export type ReproductiveMode = 'standard' | 'ttc' | 'pregnant' | 'perimenopause';

export const REPRODUCTIVE_MODE_KEY = 'hg:reproductive-mode:v1';
export const OVULATION_TESTS_KEY = 'hg:ovulation-tests:v1';

export const TTC_DISCLAIMER =
  'For planning only — fertile-window estimates support trying to conceive, not contraception.';

const MODES: readonly ReproductiveMode[] = ['standard', 'ttc', 'pregnant', 'perimenopause'];

/** Unknown or corrupt values fall back to standard — never a guess. */
export function normalizeMode(raw: unknown): ReproductiveMode {
  return typeof raw === 'string' && (MODES as readonly string[]).includes(raw)
    ? (raw as ReproductiveMode)
    : 'standard';
}

export interface TtcCard {
  fertileFrom: string;
  fertileTo: string;
  ovulationAround: string;
  basedOn: number;
}

/**
 * Fertile-window card for TTC mode. Needs at least two recorded lengths
 * (three starts); fewer means no estimate — never a guess.
 */
export function ttcCard(starts: readonly PeriodStart[]): TtcCard | null {
  const est = fertileEstimate(starts);
  if (est === null) return null;
  const clean = starts
    .map((s) => (typeof s?.date === 'string' ? s.date.slice(0, 10) : ''))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const unique = [...new Set(clean)].sort();
  if (unique.length < 3) return null;
  return {
    fertileFrom: est.fertileFrom,
    fertileTo: est.fertileTo,
    ovulationAround: est.ovulationAround,
    basedOn: unique.length - 1,
  };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayDiffDays(from: string, to: string): number | null {
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) return null;
  const ms = new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 86400000);
}

function clampWeek(week: number): number | null {
  if (!Number.isFinite(week)) return null;
  const w = Math.floor(week);
  return w >= 1 && w <= 42 ? w : null;
}

/** Gestational week from first day of last menstrual period. */
export function pregnancyWeekFromLmp(lmp: string, today: string): number | null {
  const days = dayDiffDays(lmp, today);
  if (days === null || days < 0) return null;
  return clampWeek(days / 7 + 1);
}

/** Gestational week from due date (280-day convention). */
export function pregnancyWeekFromDueDate(due: string, today: string): number | null {
  const remaining = dayDiffDays(today, due);
  if (remaining === null) return null;
  return clampWeek((280 - remaining) / 7 + 1);
}

/**
 * Logistics-only prenatal checklist: appointments and paperwork topics to
 * raise with a provider. No dosing, no triage, no symptom interpretation.
 */
export const PRENATAL_CHECKLIST: readonly string[] = [
  'First prenatal visit scheduled',
  'Questions list started for your provider',
  'Insurance / coverage paperwork checked',
  'Birth preferences draft started',
];

/**
 * Perimenopause note from cycle variability. Frames what the data shows
 * and points at a provider conversation — never an inference.
 */
export function periNote(stats: CycleStats | null): string | null {
  if (stats === null || stats.cycles < 1) return null;
  if (stats.irregularDays <= 7) {
    return `Recent cycles vary by ${stats.irregularDays} days — within a steady range.`;
  }
  return (
    `Recent cycles vary by ${stats.irregularDays} days across ` +
    `${stats.cycles} past cycles. Cycle timing can shift with age and stress — ` +
    `worth mentioning to your provider at your next visit.`
  );
}

export type OvulationResult = 'positive' | 'negative';

export interface OvulationTest {
  day: string;
  result: OvulationResult;
}

/** Manual strip log row; junk throws so the store never persists it. */
export function normalizeOvulationTest(raw: {
  day: unknown;
  result: unknown;
}): OvulationTest {
  if (typeof raw.day !== 'string' || !DAY_RE.test(raw.day.slice(0, 10))) {
    throw new Error('ovulation test needs a valid day');
  }
  if (raw.result !== 'positive' && raw.result !== 'negative') {
    throw new Error('ovulation test result must be positive or negative');
  }
  return { day: raw.day.slice(0, 10), result: raw.result };
}
