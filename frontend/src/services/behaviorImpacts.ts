/**
 * behaviorImpacts.ts — day-pattern impacts (zero imports).
 *
 * Complements the Pearson correlation feed with Daylio-style group
 * comparison: for each binary factor (alcohol day, exercise day, …)
 * and each outcome (mood, sleep, …), the mean outcome on factor days
 * versus other days, same-day and previous-day lag, with counts and
 * a volume-based confidence label. Pairs below three days per side
 * are suppressed; lines describe co-occurrence with its basis, never
 * causal claims. Sorted by magnitude, capped at six.
 *
 * Node-testable by design.
 */

export interface ImpactFactor {
  id: string;
  label: string;
}

export interface ImpactOutcome {
  id: string;
  label: string;
}

export interface ImpactDay {
  date: string;
  factors: Record<string, boolean>;
  outcomes: Record<string, number | null>;
}

export type ImpactConfidence = 'low' | 'medium' | 'high';

export interface Impact {
  factor: string;
  factorLabel: string;
  outcome: string;
  outcomeLabel: string;
  lag: 0 | 1;
  withMean: number;
  withoutMean: number;
  withN: number;
  withoutN: number;
  diff: number;
  confidence: ImpactConfidence;
  line: string;
}

const MIN_EACH_SIDE = 3;
const MAX_IMPACTS = 6;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function confidenceFor(total: number): ImpactConfidence {
  if (total >= 20) return 'high';
  if (total >= 10) return 'medium';
  return 'low';
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Group comparison over day records for lag 0 (same day) and lag 1
 * (factor the previous day, outcome today). Pure.
 */
export function computeImpacts(
  days: ReadonlyArray<ImpactDay>,
  factors: ReadonlyArray<ImpactFactor>,
  outcomes: ReadonlyArray<ImpactOutcome>,
): Impact[] {
  const byDate = new Map<string, ImpactDay>();
  for (const d of days) {
    if (typeof d.date !== 'string' || !DAY_RE.test(d.date)) continue;
    byDate.set(d.date, d);
  }
  const dates = [...byDate.keys()].sort();
  const prevOf = new Map<string, string>();
  for (let i = 1; i < dates.length; i++) {
    const d = new Date(`${dates[i]}T12:00:00`);
    const p = new Date(`${dates[i - 1]}T12:00:00`);
    if (Number.isNaN(d.getTime()) || Number.isNaN(p.getTime())) continue;
    if (d.getTime() - p.getTime() === 86400000) prevOf.set(dates[i], dates[i - 1]);
  }

  const out: Impact[] = [];
  for (const lag of [0, 1] as const) {
    for (const f of factors) {
      for (const o of outcomes) {
        const withVals: number[] = [];
        const withoutVals: number[] = [];
        for (const date of dates) {
          const factorDay = lag === 0 ? date : prevOf.get(date);
          if (factorDay === undefined) continue;
          const factorRow = byDate.get(factorDay);
          const outcomeRow = byDate.get(date);
          if (!factorRow || !outcomeRow) continue;
          const flag = factorRow.factors[f.id];
          const value = outcomeRow.outcomes[o.id];
          if (typeof value !== 'number' || !Number.isFinite(value)) continue;
          if (flag === true) withVals.push(value);
          else if (flag === false) withoutVals.push(value);
        }
        if (withVals.length < MIN_EACH_SIDE || withoutVals.length < MIN_EACH_SIDE) continue;
        const withMean = round1(mean(withVals));
        const withoutMean = round1(mean(withoutVals));
        const diff = round1(withMean - withoutMean);
        const lagBit = lag === 1 ? ' · previous day' : '';
        out.push({
          factor: f.id,
          factorLabel: f.label,
          outcome: o.id,
          outcomeLabel: o.label,
          lag,
          withMean,
          withoutMean,
          withN: withVals.length,
          withoutN: withoutVals.length,
          diff,
          confidence: confidenceFor(withVals.length + withoutVals.length),
          line: `On ${f.label}, ${o.label} averaged ${withMean} vs ${withoutMean} without · ${withVals.length}/${withoutVals.length} days${lagBit}`,
        });
      }
    }
  }
  out.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return out.slice(0, MAX_IMPACTS);
}

export interface ImpactSourceGroups {
  log_date: unknown;
  overall_wellbeing: unknown;
  energy_level: unknown;
  stress_level: unknown;
  sleep_duration_minutes: unknown;
}

export interface ImpactSourceSubstance {
  occurred_at: unknown;
  category: unknown;
}

export interface ImpactSourceDated {
  log_date?: unknown;
  occurred_at?: unknown;
}

function dayOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const day = value.slice(0, 10);
  return DAY_RE.test(day) ? day : null;
}

function cleanOutcome(value: unknown): number | null {
  const v = typeof value === 'string' ? Number(value) : value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Assemble day records from device rows: group outcomes keyed by day,
 * factor flags from substance/craving/activity rows (a flag day without
 * a group row still enters with null outcomes — it can only serve as a
 * lag source, never a mean). Pure.
 */
export function buildImpactDays(input: {
  groups: ReadonlyArray<ImpactSourceGroups>;
  substance: ReadonlyArray<ImpactSourceSubstance>;
  cravings: ReadonlyArray<ImpactSourceDated>;
  activities: ReadonlyArray<ImpactSourceDated>;
}): ImpactDay[] {
  const byDay = new Map<string, ImpactDay>();
  const ensure = (date: string): ImpactDay => {
    let row = byDay.get(date);
    if (!row) {
      row = {
        date,
        factors: { alcohol: false, tobacco: false, craving: false, exercise: false },
        outcomes: { mood: null, energy: null, stress: null, sleep: null },
      };
      byDay.set(date, row);
    }
    return row;
  };

  for (const g of input.groups) {
    const day = dayOf(g.log_date);
    if (day === null) continue;
    const row = ensure(day);
    const mood = cleanOutcome(g.overall_wellbeing);
    const energy = cleanOutcome(g.energy_level);
    const stress = cleanOutcome(g.stress_level);
    const sleepMin = cleanOutcome(g.sleep_duration_minutes);
    if (mood !== null) row.outcomes.mood = mood;
    if (energy !== null) row.outcomes.energy = energy;
    if (stress !== null) row.outcomes.stress = stress;
    if (sleepMin !== null && sleepMin > 0) row.outcomes.sleep = round1(sleepMin / 60);
  }
  for (const s of input.substance) {
    const day = dayOf(s.occurred_at);
    if (day === null) continue;
    if (s.category === 'alcohol') ensure(day).factors.alcohol = true;
    else if (s.category === 'tobacco') ensure(day).factors.tobacco = true;
  }
  for (const c of input.cravings) {
    const day = dayOf(c.log_date) ?? dayOf(c.occurred_at);
    if (day === null) continue;
    ensure(day).factors.craving = true;
  }
  for (const a of input.activities) {
    const day = dayOf(a.log_date) ?? dayOf(a.occurred_at);
    if (day === null) continue;
    ensure(day).factors.exercise = true;
  }

  return [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
