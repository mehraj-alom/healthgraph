/**
 * mapping.ts — Health Connect records into DailyLog-compatible fragments.
 *
 * Every mapper validates defensively and returns null for anything it does
 * not understand: malformed input, inverted times, absurd magnitudes.
 * Unknowns stay missing (null), never zero, never invented:
 * - sleep quality / awakenings are not in the record, so they stay null;
 * - missing calories stay null;
 * - unknown exercise types fall back to the generic 'workout' label.
 *
 * Weight uses concept '29463-7', the same identifier the Weight Engine
 * query already recognizes; pounds convert with the same LB_TO_KG factor.
 */

import type {
  HcDataType,
  HcDistanceInput,
  HcExerciseSessionInput,
  HcSleepSessionInput,
  HcStepsInput,
  HcWeightInput,
} from './records';

const SOURCE = 'health_connect';
const MAX_SESSION_MINUTES = 1440;
const MAX_STEPS_PER_DAY = 300000;
const MAX_WEIGHT_KG = 500;
/** A single activity session cannot plausibly cover more than this. */
const MAX_DISTANCE_KM = 1000;
const LB_TO_KG = 0.45359237;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function toMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Deterministic dedupe key — no patient data, no raw identifiers logged. */
export function dedupeKey(kind: HcDataType, start: string, end: string, uid: string): string {
  return `hc:${kind}:${start}:${end}:${uid}`;
}

export interface SleepFragment {
  duration_minutes: number;
  sleep_quality: null;
  awakenings: null;
  source: typeof SOURCE;
  dedupeKey: string;
}

export function mapSleepSession(raw: unknown): SleepFragment | null {
  if (!isRecord(raw)) return null;
  const input = raw as unknown as HcSleepSessionInput;
  if (!nonEmptyString(input.uid)) return null;
  const startMs = toMs(input.startTime);
  const endMs = toMs(input.endTime);
  if (startMs === null || endMs === null || endMs <= startMs) return null;
  const minutes = Math.floor((endMs - startMs) / 60000);
  if (minutes < 1 || minutes > MAX_SESSION_MINUTES) return null;
  const start = input.startTime as string;
  const end = input.endTime as string;
  return {
    duration_minutes: minutes,
    sleep_quality: null,
    awakenings: null,
    source: SOURCE,
    dedupeKey: dedupeKey('sleep', start, end, input.uid),
  };
}

export interface WeightFragment {
  concept_id: string;
  value: number;
  unit: string;
  source: typeof SOURCE;
  dedupeKey: string;
}

export function mapWeightRecord(raw: unknown): WeightFragment | null {
  if (!isRecord(raw)) return null;
  const input = raw as unknown as HcWeightInput;
  if (!nonEmptyString(input.uid) || !nonEmptyString(input.time)) return null;
  if (toMs(input.time) === null) return null;
  const kg = finiteNumber(input.weightKg);
  const lb = finiteNumber(input.weightLb);
  let value: number | null = null;
  if (kg !== null) value = kg;
  else if (lb !== null) value = Math.round(lb * LB_TO_KG * 10) / 10;
  if (value === null || value <= 0 || value >= MAX_WEIGHT_KG) return null;
  return {
    concept_id: '29463-7',
    value: Math.round(value * 10) / 10,
    unit: 'kg',
    source: SOURCE,
    dedupeKey: `hc:weight:${input.time}:${input.uid}`,
  };
}

const EXERCISE_TYPE_MAP: Record<string, string> = {
  RUNNING: 'running',
  RUNNING_TREADMILL: 'running',
  WALKING: 'walking',
  CYCLING: 'cycling',
  BIKING: 'cycling',
  BIKING_STATIONARY: 'cycling',
  SWIMMING_POOL: 'swimming',
  SWIMMING_OPEN_WATER: 'swimming',
  HIKING: 'hiking',
  YOGA: 'yoga',
  STRENGTH_TRAINING: 'strength',
};

export interface ActivityFragment {
  activity_type: string;
  duration_minutes: number;
  calories_burned: number | null;
  /** Summed Distance-record km overlapping the session; null when none. */
  distanceKm: number | null;
  source: typeof SOURCE;
  dedupeKey: string;
}

export function mapExerciseSession(raw: unknown): ActivityFragment | null {
  if (!isRecord(raw)) return null;
  const input = raw as unknown as HcExerciseSessionInput;
  if (!nonEmptyString(input.uid)) return null;
  const startMs = toMs(input.startTime);
  const endMs = toMs(input.endTime);
  if (startMs === null || endMs === null || endMs <= startMs) return null;
  const minutes = Math.floor((endMs - startMs) / 60000);
  if (minutes < 1 || minutes > MAX_SESSION_MINUTES) return null;
  const rawType = typeof input.exerciseType === 'string' ? input.exerciseType.toUpperCase() : '';
  const calories = finiteNumber(input.activeCaloriesKcal);
  const start = input.startTime as string;
  const end = input.endTime as string;
  return {
    activity_type: EXERCISE_TYPE_MAP[rawType] ?? 'workout',
    duration_minutes: minutes,
    calories_burned: calories !== null && calories >= 0 ? Math.round(calories) : null,
    distanceKm: null,
    source: SOURCE,
    dedupeKey: dedupeKey('exercise', start, end, input.uid),
  };
}

export interface StepsFragment {
  log_date: string;
  steps: number;
  source: typeof SOURCE;
  dedupeKey: string;
}

export function mapStepsRecord(raw: unknown): StepsFragment | null {
  if (!isRecord(raw)) return null;
  const input = raw as unknown as HcStepsInput;
  if (!nonEmptyString(input.uid)) return null;
  const startMs = toMs(input.startTime);
  const endMs = toMs(input.endTime);
  if (startMs === null || endMs === null || endMs < startMs) return null;
  const start = input.startTime as string;
  const day = start.slice(0, 10);
  if (!DAY_RE.test(day)) return null;
  const steps = finiteNumber(input.steps);
  if (steps === null || !Number.isInteger(steps) || steps < 0 || steps > MAX_STEPS_PER_DAY) return null;
  return {
    log_date: day,
    steps,
    source: SOURCE,
    dedupeKey: `hc:steps:${day}:${input.uid}`,
  };
}

/** A validated Distance record: interval + km. */
export interface DistanceFragment {
  startMs: number;
  endMs: number;
  km: number;
}

/**
 * Validate one Distance record. Accepts the adapter-normalized
 * `{ distanceKm }` shape or the raw Health Connect
 * `{ distance: { value, unit } }` shape (meters/kilometers/miles).
 */
export function mapDistanceRecord(raw: unknown): DistanceFragment | null {
  if (!isRecord(raw)) return null;
  const startMs = toMs((raw as { startTime?: unknown }).startTime);
  const endMs = toMs((raw as { endTime?: unknown }).endTime);
  if (startMs === null || endMs === null || endMs < startMs) return null;
  const norm = finiteNumber((raw as Partial<HcDistanceInput>).distanceKm);
  let km: number | null = null;
  if (norm !== null) {
    km = norm;
  } else {
    const d = (raw as { distance?: unknown }).distance;
    if (isRecord(d)) {
      const value = finiteNumber(d.value);
      const unit = typeof d.unit === 'string' ? d.unit.toLowerCase() : '';
      if (value !== null) {
        if (unit === 'kilometers' || unit === 'kilometer' || unit === 'km') km = value;
        else if (unit === 'meters' || unit === 'meter' || unit === 'm') km = value / 1000;
        else if (unit === 'miles' || unit === 'mile' || unit === 'mi') km = value * 1.609344;
      }
    }
  }
  if (km === null || km < 0 || km > MAX_DISTANCE_KM) return null;
  return { startMs, endMs, km: Math.round(km * 100) / 100 };
}

/**
 * Sum validated Distance records fully inside [startISO, endISO].
 * Containment (not overlap-weighting): GPS distance rows are short
 * intervals, so partial edge overlap rounds to the containing session
 * without inventing meters. Null when nothing valid falls inside.
 */
export function sumDistanceKm(
  records: readonly unknown[],
  startISO: string,
  endISO: string,
): number | null {
  const startMs = Date.parse(startISO);
  const endMs = Date.parse(endISO);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  let total = 0;
  let hits = 0;
  for (const raw of records) {
    const m = mapDistanceRecord(raw);
    if (m === null) continue;
    if (m.startMs >= startMs && m.endMs <= endMs) {
      total += m.km;
      hits += 1;
    }
  }
  if (hits === 0) return null;
  return Math.round(total * 100) / 100;
}
