/**
 * cycleSymptomLink.ts — cycle-phase symptom co-occurrence (v1).
 *
 * Counts only: which logged symptoms fall in which cycle phase across
 * recent cycles, always with the cycle basis attached to the line.
 * Phases come from recorded starts plus the median length (same calendar
 * math as the estimates module). Dates outside any known cycle stay out;
 * short input yields nothing rather than a thin claim.
 *
 * Copy contract: co-occurrence tallies, never causal claims or condition
 * labels. Pinned by tests in cycleSymptomLink.test.mts.
 *
 * Zero imports: safe for node unit tests.
 */

export type CyclePhase = 'menstrual' | 'follicular' | 'fertile' | 'luteal';

export const PHASES: CyclePhase[] = ['menstrual', 'follicular', 'fertile', 'luteal'];

export interface SymptomOccurrence {
  date: string;
  label: string;
}

export interface SymptomPattern {
  label: string;
  perPhase: Record<CyclePhase, number>;
  cycles: number;
}

export interface CyclePatternSummary {
  patterns: SymptomPattern[];
  cycles: number;
  lines: string[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_LENGTH = 21;
const MAX_LENGTH = 35;
const MAX_GAP_DAYS = 90;
const MAX_STARTS = 7;

function dayDiff(fromDay: string, toDay: string): number | null {
  const ms =
    new Date(`${toDay}T12:00:00`).getTime() - new Date(`${fromDay}T12:00:00`).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 86400000);
}

/**
 * Phase for one date, or null when it sits outside every known cycle.
 * Menstrual covers days 1–5; fertile spans five days before through one
 * day after the length-minus-14 point; earlier days read follicular and
 * later days luteal.
 */
export function phaseOf(
  date: string,
  starts: readonly string[],
  medianLength: number,
): CyclePhase | null {
  if (!DAY_RE.test(date) || !Number.isInteger(medianLength)) return null;
  if (medianLength < MIN_LENGTH || medianLength > MAX_LENGTH) return null;
  const clean = starts.filter((s) => DAY_RE.test(s)).sort();
  if (clean.length === 0) return null;
  let cycleStart: string | null = null;
  for (const s of clean) {
    if (s <= date) cycleStart = s;
  }
  if (cycleStart === null) return null;
  const gap = dayDiff(cycleStart, date);
  if (gap === null || gap > MAX_GAP_DAYS) return null;
  const day = gap + 1;
  const ovulationDay = medianLength - 14;
  if (day <= 5) return 'menstrual';
  if (day >= ovulationDay - 5 && day <= ovulationDay + 1) return 'fertile';
  if (day < ovulationDay - 5) return 'follicular';
  return 'luteal';
}

/** Co-occurrence tallies per symptom label with the cycle basis attached. */
export function summarizeCyclePatterns(
  occurrences: readonly SymptomOccurrence[],
  starts: readonly string[],
  medianLength: number,
): CyclePatternSummary {
  const clean = starts.filter((s) => DAY_RE.test(s)).sort().slice(-MAX_STARTS);
  const cycles = clean.length;
  if (cycles === 0) return { patterns: [], cycles: 0, lines: [] };
  const byLabel = new Map<string, Record<CyclePhase, number>>();
  for (const occ of occurrences) {
    if (typeof occ?.label !== 'string' || occ.label.trim().length === 0) continue;
    const phase = phaseOf(occ.date, clean, medianLength);
    if (phase === null) continue;
    const label = occ.label.trim().slice(0, 80);
    const counts = byLabel.get(label) ?? { menstrual: 0, follicular: 0, fertile: 0, luteal: 0 };
    counts[phase] += 1;
    byLabel.set(label, counts);
  }
  const patterns: SymptomPattern[] = [...byLabel.entries()].map(([label, perPhase]) => ({
    label,
    perPhase,
    cycles,
  }));
  patterns.sort(
    (a, b) =>
      b.perPhase.luteal + b.perPhase.fertile + b.perPhase.menstrual + b.perPhase.follicular -
      (a.perPhase.luteal + a.perPhase.fertile + a.perPhase.menstrual + a.perPhase.follicular),
  );
  const lines: string[] = [];
  for (const p of patterns) {
    for (const phase of PHASES) {
      const n = p.perPhase[phase];
      if (n > 0) {
        lines.push(
          `${p.label} · ${n}× in ${phase} · last ${cycles} ${cycles === 1 ? 'cycle' : 'cycles'}`,
        );
      }
    }
  }
  return { patterns, cycles, lines };
}

export interface LoggedOccurrence {
  date: string;
  label: string;
}

/**
 * Display-ready assembly over already-loaded occurrences: summarize, keep
 * the top six lines, null when there is nothing worth showing. Pure —
 * fetching lives in the useCyclePatterns hook so tracker screens stay
 * device-only (batch3 wiring guard).
 */
export function buildPatternLines(
  occurrences: LoggedOccurrence[],
  periodStarts: string[],
  medianDays: number,
): string[] | null {
  const validStarts = periodStarts.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (validStarts.length < 2) return null;
  const summary = summarizeCyclePatterns(occurrences, validStarts, medianDays);
  if (summary.lines.length === 0) return null;
  return summary.lines.slice(0, 6);
}
