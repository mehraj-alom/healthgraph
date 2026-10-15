/**
 * importer.ts — Health Connect import orchestration (Slice 2).
 *
 * Every side effect is injected (storage, adapter, day store, clock), so
 * this module is fully unit-testable and imports nothing native, nothing
 * from the database layer, and nothing from the network layer.
 *
 * Safety rules (enforced by tests):
 * - consent gate first: no consent or no ready adapter means no reads;
 * - manual data wins: an existing hand-logged sleep duration is never
 *   overwritten; identical workouts are never duplicated;
 * - bounded load: each type reads at most a trailing 30-day window, and the
 *   watermark advances only past successfully processed reads;
 * - Slice 3 scope: sleep + exercise + weight + steps. Weight imports only
 *   with a server-valid concept UUID resolved from manual-log concepts
 *   (never the bare code the backend rejects with 422); steps land in the
 *   device-only step_counts table and never enter the Fitness session math.
 */

import { canImport, type ConsentStoragePort } from './consent.ts';
import { IMPORTED_DATA_TYPES } from './capability.ts';

export { IMPORTED_DATA_TYPES };

import {
  mapExerciseSession,
  mapSleepSession,
  mapStepsRecord,
  mapWeightRecord,
  sumDistanceKm,
  type ActivityFragment,
  type SleepFragment,
  type StepsFragment,
  type WeightFragment,
} from './mapping.ts';

export const WATERMARK_STORAGE_KEY = 'hg:hc-watermark:v1';
const MAX_WINDOW_DAYS = 30;

export interface ImportAdapter {
  isAvailable: () => boolean;
  ensurePermissions: () => Promise<boolean>;
  readSleep: (startISO: string, endISO: string) => Promise<unknown[]>;
  readExercise: (startISO: string, endISO: string) => Promise<unknown[]>;
  readWeight: (startISO: string, endISO: string) => Promise<unknown[]>;
  readSteps: (startISO: string, endISO: string) => Promise<unknown[]>;
  /** Distance rows for session attribution; [] when unsupported/denied. */
  readDistance: (startISO: string, endISO: string) => Promise<unknown[]>;
}

export interface ImportDayDetail {
  group_id: string;
  sleep_duration_minutes: number | null;
  vitals: { concept_id: string | null; unit: string | null }[];
  activities: {
    activity_type: string;
    duration_minutes: number | null;
    calories_burned: number | null;
    distance_km: number | null;
  }[];
}

export interface DayOverlay {
  sleep_minutes?: number;
  vitals?: { concept_id: string; value: number; unit: string }[];
}

export interface ImportStore {
  getDetail: (logDate: string) => Promise<ImportDayDetail | null>;
  mergeDay: (logDate: string, overlay: DayOverlay) => Promise<string>;
  insertActivity: (
    groupId: string,
    eventTime: string,
    activity: {
      activity_type: string;
      duration_minutes: number;
      calories_burned: number | null;
      distance_km: number | null;
    },
  ) => Promise<void>;
  resolveWeightConcept: () => Promise<string | null>;
  saveSteps: (logDate: string, steps: number) => Promise<void>;
  refresh: () => void;
  nowISO: () => string;
}

export interface ImportReport {
  status: 'ok' | 'blocked';
  reason?: 'no-consent' | 'unavailable' | 'permission-denied';
  daysTouched: number;
  sleepImported: number;
  activitiesImported: number;
  weightImported: number;
  stepDaysImported: number;
  stepsTotal: number;
  dropped: number;
  windowStart: string | null;
  windowEnd: string | null;
}

interface Watermark {
  sleep: string | null;
  exercise: string | null;
  weight: string | null;
  steps: string | null;
}

const EMPTY_WATERMARK: Watermark = { sleep: null, exercise: null, weight: null, steps: null };

function isWatermark(raw: unknown): raw is Watermark {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  // Partial watermarks from older slices are accepted; missing keys read null.
  const ok = (v: unknown) =>
    v === null ||
    v === undefined ||
    (typeof v === 'string' && Number.isFinite(Date.parse(v)));
  return ok(r.sleep) && ok(r.exercise) && ok(r.weight) && ok(r.steps);
}

export async function loadWatermark(storage: ConsentStoragePort): Promise<Watermark> {
  try {
    const raw = await storage.getItem(WATERMARK_STORAGE_KEY);
    if (raw === null) return { ...EMPTY_WATERMARK };
    const parsed: unknown = JSON.parse(raw);
    return isWatermark(parsed) ? { ...EMPTY_WATERMARK, ...parsed } : { ...EMPTY_WATERMARK };
  } catch {
    return { ...EMPTY_WATERMARK };
  }
}

async function saveWatermark(storage: ConsentStoragePort, mark: Watermark): Promise<void> {
  await storage.setItem(WATERMARK_STORAGE_KEY, JSON.stringify(mark));
}

function clampWindowStart(candidate: string | null, nowMs: number): string {
  const floor = new Date(nowMs - MAX_WINDOW_DAYS * 86400000).toISOString();
  if (candidate === null) return floor;
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed)) return floor;
  return parsed < Date.parse(floor) ? floor : candidate;
}

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/** Start/end/time instants straight from the raw record (validated, never trusted). */
function rawInstant(raw: unknown, field: 'startTime' | 'endTime' | 'time'): string | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>)[field];
  if (typeof value !== 'string' || value.length < 10) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

/** Mirrors the Weight Engine recognition: concept code, weight-ish concept, or kg/lb unit. */
function isWeightVital(conceptId: string | null, unit: string | null): boolean {
  const concept = (conceptId ?? '').toLowerCase();
  const u = (unit ?? '').trim().toLowerCase();
  return (
    concept === '29463-7' ||
    concept.includes('weight') ||
    u === 'kg' ||
    u === 'kgs' ||
    u === 'kilogram' ||
    u === 'kilograms' ||
    u === 'lb' ||
    u === 'lbs' ||
    u === 'pound' ||
    u === 'pounds'
  );
}

function sameActivity(
  a: { activity_type: string; duration_minutes: number | null; calories_burned: number | null },
  b: ActivityFragment,
): boolean {
  return (
    a.activity_type === b.activity_type &&
    (a.duration_minutes ?? null) === b.duration_minutes &&
    (a.calories_burned ?? null) === b.calories_burned
  );
}

export async function runHealthConnectImport(deps: {
  storage: ConsentStoragePort;
  adapter: ImportAdapter;
  store: ImportStore;
}): Promise<ImportReport> {
  const { storage, adapter, store } = deps;
  const empty: ImportReport = {
    status: 'blocked',
    daysTouched: 0,
    sleepImported: 0,
    activitiesImported: 0,
    weightImported: 0,
    stepDaysImported: 0,
    stepsTotal: 0,
    dropped: 0,
    windowStart: null,
    windowEnd: null,
  };
  if (!(await canImport(storage, adapter))) {
    return { ...empty, reason: adapter.isAvailable() ? 'no-consent' : 'unavailable' };
  }
  const nowISO = store.nowISO();
  const nowMs = Date.parse(nowISO);
  if (!Number.isFinite(nowMs)) return { ...empty, reason: 'no-consent' };
  if (!(await adapter.ensurePermissions())) {
    return { ...empty, reason: 'permission-denied' };
  }

  const watermark = await loadWatermark(storage);
  const report: ImportReport = {
    status: 'ok',
    daysTouched: 0,
    sleepImported: 0,
    activitiesImported: 0,
    weightImported: 0,
    stepDaysImported: 0,
    stepsTotal: 0,
    dropped: 0,
    windowStart: null,
    windowEnd: null,
  };

  const readers: Record<
    'sleep' | 'exercise' | 'weight' | 'steps',
    (s: string, e: string) => Promise<unknown[]>
  > = {
    sleep: (s, e) => adapter.readSleep(s, e),
    exercise: (s, e) => adapter.readExercise(s, e),
    weight: (s, e) => adapter.readWeight(s, e),
    steps: (s, e) => adapter.readSteps(s, e),
  };

  for (const kind of IMPORTED_DATA_TYPES) {
    const start = clampWindowStart(watermark[kind], nowMs);
    if (report.windowStart === null || start < (report.windowStart as string)) {
      report.windowStart = start;
    }
    report.windowEnd = nowISO;
    let raw: unknown[];
    try {
      raw = await readers[kind](start, nowISO);
    } catch {
      continue;
    }

    if (kind === 'sleep') {
      // Group by the session end day (the morning the sleep belongs to);
      // the longest session wins and manual entries always win overall.
      // Records outside the read window are ignored (adapters filter
      // server-side; this is the local backstop).
      const grouped = new Map<string, SleepFragment>();
      for (const r of raw) {
        const m = mapSleepSession(r);
        if (m === null) {
          report.dropped += 1;
          continue;
        }
        const end = rawInstant(r, 'endTime');
        if (end === null || end < start || end > nowISO) {
          report.dropped += 1;
          continue;
        }
        const endDay = dayOf(end);
        const prev = grouped.get(endDay);
        if (!prev || m.duration_minutes > prev.duration_minutes) grouped.set(endDay, m);
      }
      for (const [logDate, frag] of grouped) {
        const detail = await store.getDetail(logDate).catch(() => null);
        if (detail?.sleep_duration_minutes != null) continue;
        await store.mergeDay(logDate, { sleep_minutes: frag.duration_minutes });
        report.sleepImported += 1;
        report.daysTouched += 1;
      }
    } else if (kind === 'exercise') {
      const items: { frag: ActivityFragment; eventTime: string; endTime: string }[] = [];
      for (const r of raw) {
        const m = mapExerciseSession(r);
        if (m === null) {
          report.dropped += 1;
          continue;
        }
        const startInstant = rawInstant(r, 'startTime');
        const endInstant = rawInstant(r, 'endTime');
        if (startInstant === null || startInstant < start || startInstant > nowISO) {
          report.dropped += 1;
          continue;
        }
        if (endInstant === null) {
          report.dropped += 1;
          continue;
        }
        items.push({ frag: m, eventTime: startInstant, endTime: endInstant });
      }
      // Distance attribution (best-effort): one Distance read per import,
      // summed per session by containment. A denied/empty read leaves every
      // session at distanceKm null — the import still succeeds.
      let distanceRows: unknown[] = [];
      try {
        distanceRows = await adapter.readDistance(start, nowISO);
      } catch {
        distanceRows = [];
      }
      for (const item of items) {
        item.frag.distanceKm = sumDistanceKm(distanceRows, item.eventTime, item.endTime);
      }
      const byDay = new Map<string, { frag: ActivityFragment; eventTime: string; endTime: string }[]>();
      for (const item of items) {
        const day = dayOf(item.eventTime);
        const list = byDay.get(day) ?? [];
        list.push(item);
        byDay.set(day, list);
      }
      for (const [logDate, dayItems] of byDay) {
        const detail = await store.getDetail(logDate).catch(() => null);
        const existing = detail?.activities ?? [];
        const fresh = dayItems.filter(({ frag }) => !existing.some((a) => sameActivity(a, frag)));
        if (fresh.length === 0) continue;
        const groupId =
          detail !== null ? detail.group_id : await store.mergeDay(logDate, {});
        for (const { frag, eventTime } of fresh) {
          await store.insertActivity(groupId, eventTime, {
            activity_type: frag.activity_type,
            duration_minutes: frag.duration_minutes,
            calories_burned: frag.calories_burned,
            distance_km: frag.distanceKm,
          });
          report.activitiesImported += 1;
        }
        report.daysTouched += 1;
      }
    } else if (kind === 'weight') {
      // Weight imports only with a resolved server concept UUID. Existing
      // weight vitals (manual or prior imports) always win.
      const conceptId = await store.resolveWeightConcept().catch(() => null);
      if (conceptId !== null) {
        const byDay = new Map<string, { frag: WeightFragment; time: string }>();
        for (const r of raw) {
          const m = mapWeightRecord(r);
          if (m === null) {
            report.dropped += 1;
            continue;
          }
          const time = rawInstant(r, 'time');
          if (time === null || time < start || time > nowISO) {
            report.dropped += 1;
            continue;
          }
          const day = dayOf(time);
          const prev = byDay.get(day);
          if (!prev || time >= prev.time) byDay.set(day, { frag: m, time });
        }
        for (const [logDate, { frag }] of byDay) {
          const detail = await store.getDetail(logDate).catch(() => null);
          const hasWeight = (detail?.vitals ?? []).some((v) =>
            isWeightVital(v.concept_id, v.unit),
          );
          if (hasWeight) continue;
          await store.mergeDay(logDate, {
            vitals: [{ concept_id: conceptId, value: frag.value, unit: frag.unit }],
          });
          report.weightImported += 1;
          report.daysTouched += 1;
        }
      }
    } else {
      // Steps aggregate into device-only daily totals (monotonic max in
      // storage, never double-counted, never in the Fitness session math).
      const totals = new Map<string, number>();
      for (const r of raw) {
        const m = mapStepsRecord(r);
        if (m === null) {
          report.dropped += 1;
          continue;
        }
        const startInstant = rawInstant(r, 'startTime');
        if (startInstant === null || startInstant < start || startInstant > nowISO) {
          report.dropped += 1;
          continue;
        }
        totals.set(m.log_date, (totals.get(m.log_date) ?? 0) + m.steps);
      }
      for (const [logDate, steps] of totals) {
        await store.saveSteps(logDate, Math.min(steps, 300000));
        report.stepDaysImported += 1;
        report.stepsTotal += Math.min(steps, 300000);
        report.daysTouched += 1;
      }
    }

    watermark[kind] = nowISO;
    await saveWatermark(storage, { ...watermark });
  }

  if (
    report.sleepImported > 0 ||
    report.activitiesImported > 0 ||
    report.weightImported > 0 ||
    report.stepDaysImported > 0
  ) {
    store.refresh();
  }
  return report;
}
