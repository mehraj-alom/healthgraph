/**
 * bloodPressure.ts — BP recognition, pairing, and averages (zero imports).
 *
 * Manual cuff readings only: VITAL_SIGN events recognized by LOINC
 * (8480-6 systolic, 8462-4 diastolic) or mmHg unit. Days pair latest
 * systolic + latest diastolic; unpaired or implausible days are skipped,
 * never half-plotted. Averages carry their window and reading count.
 * No ranges, no staging, no alerts — log and neutral trends only.
 *
 * Node-testable by design.
 */

export const SYSTOLIC_CODE = '8480-6';
export const DIASTOLIC_CODE = '8462-4';

export type BpComponent = 'systolic' | 'diastolic';

const SYS_MIN = 50;
const SYS_MAX = 300;
const DIA_MIN = 30;
const DIA_MAX = 200;

function normUnit(unit: unknown): string {
  return typeof unit === 'string' ? unit.trim().toLowerCase().replace(/\s+/g, '') : '';
}

function normConcept(concept: unknown): string {
  return typeof concept === 'string' ? concept.trim().toLowerCase() : '';
}

/** True for systolic/diastolic readings by code or mmHg unit. */
export function isBpReading(conceptId: unknown, unit: unknown, _label?: unknown): boolean {
  const concept = normConcept(conceptId);
  if (concept === SYSTOLIC_CODE || concept === DIASTOLIC_CODE) return true;
  return normUnit(unit) === 'mmhg';
}

/** Which half of the pair a reading is, or null when neither.
 * Unit-only mmHg readings are recognized as BP (for logger presets) but
 * cannot be split into halves — pairing requires LOINC codes. */
export function bpComponent(conceptId: unknown, unit: unknown): BpComponent | null {
  const concept = normConcept(conceptId);
  if (concept === SYSTOLIC_CODE) return 'systolic';
  if (concept === DIASTOLIC_CODE) return 'diastolic';
  if (normUnit(unit) !== 'mmhg') return null;
  return null;
}

export interface BpPoint {
  log_date: string;
  systolic: number;
  diastolic: number;
}

export interface BpRow {
  log_date: unknown;
  concept_id: unknown;
  value: unknown;
  unit: unknown;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanValue(value: unknown): number | null {
  const v = typeof value === 'string' ? Number(value) : value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function validSys(v: number | null): v is number {
  return v !== null && v >= SYS_MIN && v <= SYS_MAX;
}

function validDia(v: number | null): v is number {
  return v !== null && v >= DIA_MIN && v <= DIA_MAX;
}

/**
 * Latest systolic + latest diastolic per day, oldest first. Days missing
 * either half, and pairs failing plausibility (bounds or sys > dia),
 * are skipped.
 */
export function pairBpDays(rows: ReadonlyArray<BpRow>): BpPoint[] {
  const sys = new Map<string, number>();
  const dia = new Map<string, number>();
  for (const r of rows) {
    const day = typeof r.log_date === 'string' ? r.log_date.slice(0, 10) : '';
    if (!DAY_RE.test(day)) continue;
    const concept = normConcept(r.concept_id);
    if (concept !== SYSTOLIC_CODE && concept !== DIASTOLIC_CODE) continue;
    const value = cleanValue(r.value);
    if (value === null) continue;
    if (concept === SYSTOLIC_CODE) {
      if (validSys(value)) sys.set(day, value);
    } else if (validDia(value)) {
      dia.set(day, value);
    }
  }
  const out: BpPoint[] = [];
  for (const [day, s] of sys) {
    const d = dia.get(day);
    if (d === undefined || s <= d) continue;
    out.push({ log_date: day, systolic: s, diastolic: d });
  }
  out.sort((a, b) => (a.log_date < b.log_date ? -1 : a.log_date > b.log_date ? 1 : 0));
  return out;
}

export interface BpAverage {
  count: number;
  avgSystolic: number | null;
  avgDiastolic: number | null;
}

/** Trailing-window means over paired days; empty windows yield nulls. */
export function bpAverages(
  points: ReadonlyArray<BpPoint>,
  todayKey: string,
  windowDays = 7,
): BpAverage {
  const empty: BpAverage = { count: 0, avgSystolic: null, avgDiastolic: null };
  const end = typeof todayKey === 'string' ? todayKey.slice(0, 10) : '';
  if (!DAY_RE.test(end)) return empty;
  const startD = new Date(`${end}T12:00:00`);
  if (Number.isNaN(startD.getTime())) return empty;
  startD.setDate(startD.getDate() - (windowDays - 1));
  const start = `${startD.getFullYear()}-${String(startD.getMonth() + 1).padStart(2, '0')}-${String(startD.getDate()).padStart(2, '0')}`;
  let sysSum = 0;
  let diaSum = 0;
  let count = 0;
  for (const p of points) {
    if (!DAY_RE.test(p.log_date) || p.log_date < start || p.log_date > end) continue;
    sysSum += p.systolic;
    diaSum += p.diastolic;
    count += 1;
  }
  if (count === 0) return empty;
  return {
    count,
    avgSystolic: Math.round((sysSum / count) * 10) / 10,
    avgDiastolic: Math.round((diaSum / count) * 10) / 10,
  };
}
