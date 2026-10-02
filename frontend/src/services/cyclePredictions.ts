/**
 * cyclePredictions.ts — period + fertile-window estimates (v1).
 *
 * Estimates only, from recorded period starts: the median of recent cycle
 * lengths with an explicit ± range (never a single certain day), and a
 * fertile window by the textbook calendar method (ovulation around
 * length-minus-14, window five days before through one day after).
 * Fewer than the required past cycles means no estimate — never a guess.
 *
 * Deliberate v1 boundaries: estimates, never certainties; no family-planning
 * mode beyond the fertile window; no condition inference. Pinned by tests
 * in cyclePredictions.test.mts.
 *
 * Zero imports: safe for node unit tests.
 */

export interface PeriodStart {
  date: string;
}

export interface CycleStats {
  lengths: number[];
  medianLength: number;
  cycles: number;
  irregularDays: number;
}

export interface PeriodPrediction {
  expected: string;
  from: string;
  to: string;
  basedOn: number;
  early: boolean;
}

export interface FertileEstimate {
  ovulationAround: string;
  fertileFrom: string;
  fertileTo: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_LENGTH = 15;
const MAX_LENGTH = 90;
const MAX_STARTS = 7;

function shiftDay(dayKey: string, deltaDays: number): string | null {
  const d = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Valid recorded starts, ascending, deduped. */
function cleanStarts(starts: readonly PeriodStart[]): string[] {
  const days = starts
    .map((s) => (typeof s?.date === 'string' ? s.date.slice(0, 10) : ''))
    .filter((d) => DAY_RE.test(d));
  const unique = [...new Set(days)].sort();
  return unique.slice(-MAX_STARTS);
}

function spanLengths(starts: string[]): number[] | null {
  if (starts.length < 2) return null;
  const lengths: number[] = [];
  for (let i = 1; i < starts.length; i++) {
    const ms =
      new Date(`${starts[i]}T12:00:00`).getTime() - new Date(`${starts[i - 1]}T12:00:00`).getTime();
    const days = Math.round(ms / 86400000);
    if (!Number.isFinite(days) || days < MIN_LENGTH || days > MAX_LENGTH) return null;
    lengths.push(days);
  }
  return lengths;
}

/** Median of recent cycle lengths plus the max-min spread, or null. */
export function cycleStats(starts: readonly PeriodStart[]): CycleStats | null {
  const clean = cleanStarts(starts);
  if (clean.length < 2) return null;
  // Only the six most recent lengths count (older cycles mislead).
  const recent = clean.slice(-7);
  const lengths = spanLengths(recent);
  if (lengths === null || lengths.length === 0) return null;
  const sorted = [...lengths].sort((a, b) => a - b);
  const medianLength = sorted[Math.floor((sorted.length - 1) / 2)];
  return {
    lengths,
    medianLength,
    cycles: lengths.length,
    irregularDays: Math.max(...lengths) - Math.min(...lengths),
  };
}

/** Next-period window from the median length with an explicit ± range. */
export function predictNextPeriod(starts: readonly PeriodStart[]): PeriodPrediction | null {
  const stats = cycleStats(starts);
  if (stats === null) return null;
  const clean = cleanStarts(starts);
  const last = clean[clean.length - 1];
  const expected = shiftDay(last, stats.medianLength);
  if (expected === null) return null;
  const early = stats.cycles === 1;
  const half = early ? 3 : Math.min(3, Math.max(1, Math.floor(stats.irregularDays / 2)));
  const from = shiftDay(expected, -half);
  const to = shiftDay(expected, half);
  if (from === null || to === null) return null;
  return { expected, from, to, basedOn: stats.cycles, early };
}

/**
 * Fertile-window estimate by the calendar method. Needs at least two
 * recorded lengths; a single cycle cannot anchor an ovulation estimate.
 */
export function fertileEstimate(starts: readonly PeriodStart[]): FertileEstimate | null {
  const stats = cycleStats(starts);
  if (stats === null || stats.cycles < 2) return null;
  const clean = cleanStarts(starts);
  const last = clean[clean.length - 1];
  const ovulationAround = shiftDay(last, stats.medianLength - 14);
  if (ovulationAround === null) return null;
  const fertileFrom = shiftDay(ovulationAround, -5);
  const fertileTo = shiftDay(ovulationAround, 1);
  if (fertileFrom === null || fertileTo === null) return null;
  return { ovulationAround, fertileFrom, fertileTo };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortRange(from: string, to: string): string {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (fy === ty && fm === tm) return `${MONTHS[fm - 1]} ${fd} – ${td}`;
  return `${MONTHS[fm - 1]} ${fd} – ${MONTHS[tm - 1]} ${td}`;
}

/** One estimate line with its basis attached — never a bare date. */
export function describePrediction(pred: PeriodPrediction): string {
  const range = shortRange(pred.from, pred.to);
  const count = `${pred.basedOn} past ${pred.basedOn === 1 ? 'cycle' : 'cycles'}`;
  return pred.early ? `Expected ${range} · early estimate from ${count}` : `Expected ${range} · based on ${count}`;
}
