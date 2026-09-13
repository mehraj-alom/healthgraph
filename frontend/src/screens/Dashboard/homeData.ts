/**
 * homeData.ts — pure data shaping for the Home / Health Command Center.
 *
 * Lives in the Dashboard feature folder because its types are Home-specific.
 * It performs NO network calls and NO SQLite writes; it transforms the output
 * of the existing hooks / query modules into what the Home UI renders.
 *
 * It never invents health intelligence. Magnitudes are visual-only scaling
 * references (how a petal is sized), never a score or a diagnosis.
 */

import { healthCategories } from '@/theme/tokens';
import type { DailyMetrics } from '@/hooks/useDailyMetrics';
import type {
  Medication,
  MedicationTakenEvent,
  MedicationFrequency,
  DailyCheckInDetail,
} from '@/types';

// ─── Visual scaling references (not goals, not judgments) ────────────────────

export const SLEEP_REFERENCE_MIN = 480; // minutes
export const WATER_REFERENCE_ML = 2500;
export const ACTIVITY_REFERENCE_MIN = 60;
export const HEART_RATE_REFERENCE = 72; // bpm midpoint of a typical resting band

// ─── Dimension model ─────────────────────────────────────────────────────────

export type DimensionId =
  | 'sleep'
  | 'heart'
  | 'water'
  | 'stress'
  | 'activity'
  | 'medication'
  | 'energy'
  | 'wellbeing';

export interface HealthDimension {
  id: DimensionId;
  label: string;
  icon: string;
  valueText: string;
  /** 0..1 visual size — never a health score. */
  magnitude: number;
  color: string;
  /** Concise contextual surface text, e.g. "7h 18m · quality 4/5". */
  detail: string;
}

// ─── Story model (recent health events) ──────────────────────────────────────

export type HomeStoryCategory =
  | 'sleep'
  | 'wellbeing'
  | 'activity'
  | 'nutrition'
  | 'symptom'
  | 'pain'
  | 'vital'
  | 'medication'
  | 'document'
  | 'note';

export interface HomeStoryItem {
  id: string;
  /** ISO timestamp used only for ordering/display. */
  time: string;
  /** YYYY-MM-DD local calendar day. */
  dayKey: string;
  category: HomeStoryCategory;
  title: string;
  detail: string;
  icon: string;
}

// ─── Medication summary ──────────────────────────────────────────────────────

export interface MedicationSummary {
  activeCount: number;
  dosesTaken: number;
  dosesExpected: number;
  hasSchedule: boolean;
  statusText: string;
}

// ─── Formatters ──────────────────────────────────────────────────────────────

export function localDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatSleepMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatDurationMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

export function formatWaterMl(ml: number | null | undefined): string {
  if (ml == null || !Number.isFinite(ml) || ml <= 0) return '—';
  if (ml >= 1000) return `${(ml / 1000).toFixed(1)} L`;
  return `${Math.round(ml)} ml`;
}

export function formatScale(value: number | null | undefined, outOf = 5): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 10) / 10}/${outOf}`;
}

export function formatMonthDay(isoOrDate: string | Date): string {
  const d = new Date(isoOrDate);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatTodayDate(date: Date = new Date()): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

// ─── Clamp + magnitudes ──────────────────────────────────────────────────────

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function magnitudeSleep(minutes: number | null | undefined): number {
  if (minutes == null || minutes <= 0) return 0;
  return clamp01(minutes / SLEEP_REFERENCE_MIN);
}

export function magnitudeHeartRate(value: number | null | undefined): number {
  if (value == null || value <= 0) return 0;
  const off = Math.abs(value - HEART_RATE_REFERENCE) / HEART_RATE_REFERENCE;
  return clamp01(1.18 - off * 0.65);
}

export function magnitudeWater(ml: number | null | undefined): number {
  if (ml == null || ml <= 0) return 0;
  return clamp01(ml / WATER_REFERENCE_ML);
}

export function magnitudeStress(stress: number | null | undefined): number {
  if (stress == null) return 0;
  return clamp01((5 - stress) / 4);
}

export function magnitudeActivity(minutes: number | null | undefined): number {
  if (minutes == null || minutes <= 0) return 0;
  return clamp01(minutes / ACTIVITY_REFERENCE_MIN);
}

export function magnitudeRatio(numerator: number, denominator: number): number {
  return clamp01(denominator > 0 ? numerator / denominator : 0);
}

export function magnitudeScale(value: number | null | undefined, outOf = 5): number {
  if (value == null || value <= 0) return 0;
  return clamp01(value / outOf);
}

// ─── Heart-rate detection (shared with prior Dashboard behavior) ─────────────

export function detectHeartRate(
  metrics: DailyMetrics | null,
): { value: number; unit: string | null; event_time: string } | null {
  const vital = (metrics?.latest_vitals ?? []).find((v) => {
    const name = (v.display_name ?? '').toLowerCase();
    return (
      name.includes('heart') &&
      (name.includes('rate') || name.includes('bpm') || name.includes('pulse'))
    );
  });
  if (!vital || vital.value == null) return null;
  return { value: vital.value, unit: vital.unit, event_time: vital.event_time };
}

// ─── Medication frequency → expected daily doses ─────────────────────────────

const DOSE_COUNTS: Partial<Record<MedicationFrequency, number>> = {
  ONCE_DAILY: 1,
  TWICE_DAILY: 2,
  THREE_TIMES_DAILY: 3,
  FOUR_TIMES_DAILY: 4,
  EVERY_MORNING: 1,
  EVERY_EVENING: 1,
  EVERY_NIGHT: 1,
  EVERY_8_HOURS: 3,
  EVERY_12_HOURS: 2,
};

export function expectedDosesForMedication(med: Medication): number {
  if (med.scheduled_times && med.scheduled_times.length > 0) {
    return med.scheduled_times.length;
  }
  return DOSE_COUNTS[med.frequency] ?? 0;
}

export function buildMedicationSummary(
  medications: Medication[] | null | undefined,
  takenToday: MedicationTakenEvent[] | null | undefined,
): MedicationSummary | null {
  const active = (medications ?? []).filter((m) => m.status === 'ACTIVE');
  if (active.length === 0) return null;

  const dosesExpected = active.reduce(
    (sum, m) => sum + expectedDosesForMedication(m),
    0,
  );
  const dosesTaken = (takenToday ?? []).filter((e) => e.status === 'TAKEN').length;
  const hasSchedule = dosesExpected > 0;

  let statusText: string;
  if (!hasSchedule) {
    statusText = `${active.length} active · as needed`;
  } else if (dosesTaken === 0) {
    statusText = 'No doses taken yet today';
  } else if (dosesTaken >= dosesExpected) {
    statusText = `All ${dosesExpected} dose${dosesExpected > 1 ? 's' : ''} taken today`;
  } else {
    statusText = `${dosesTaken} of ${dosesExpected} doses taken today`;
  }

  return {
    activeCount: active.length,
    dosesTaken,
    dosesExpected,
    hasSchedule,
    statusText,
  };
}

// ─── Dimension builder ───────────────────────────────────────────────────────

/**
 * Build the list of health dimensions shown in the Overall Health hero.
 * Only dimensions with meaningful real data are included.
 */
export function buildHealthDimensions(
  metrics: DailyMetrics | null,
  waterMl: number | null,
  med: MedicationSummary | null,
): HealthDimension[] {
  const dims: HealthDimension[] = [];
  const wellbeing = metrics?.today_wellbeing;
  const sleep = metrics?.latest_sleep;
  const activity = metrics?.today_activity;
  const hr = detectHeartRate(metrics);

  if (sleep && sleep.duration_minutes > 0) {
    dims.push({
      id: 'sleep',
      label: 'Sleep',
      icon: '🌙',
      valueText: formatSleepMinutes(sleep.duration_minutes),
      magnitude: magnitudeSleep(sleep.duration_minutes),
      color: healthCategories.sleep,
      detail:
        sleep.sleep_quality != null
          ? `${formatSleepMinutes(sleep.duration_minutes)} · quality ${sleep.sleep_quality}/5`
          : `${formatSleepMinutes(sleep.duration_minutes)} of sleep`,
    });
  }

  if (wellbeing?.overall_wellbeing != null) {
    dims.push({
      id: 'wellbeing',
      label: 'Wellbeing',
      icon: '🌱',
      valueText: formatScale(wellbeing.overall_wellbeing),
      magnitude: magnitudeScale(wellbeing.overall_wellbeing),
      color: healthCategories.medication,
      detail: `Overall wellbeing ${wellbeing.overall_wellbeing}/5 today`,
    });
  }

  if (wellbeing?.energy_level != null) {
    dims.push({
      id: 'energy',
      label: 'Energy',
      icon: '⚡',
      valueText: formatScale(wellbeing.energy_level),
      magnitude: magnitudeScale(wellbeing.energy_level),
      color: healthCategories.wellbeing,
      detail: `Energy level ${wellbeing.energy_level}/5 today`,
    });
  }

  if (wellbeing?.stress_level != null) {
    dims.push({
      id: 'stress',
      label: 'Stress',
      icon: '🧘',
      valueText: `Lv ${wellbeing.stress_level}`,
      magnitude: magnitudeStress(wellbeing.stress_level),
      color: healthCategories.mood,
      detail:
        wellbeing.stress_level <= 2
          ? `Stress level ${wellbeing.stress_level}/5 · on the calm side`
          : wellbeing.stress_level >= 4
            ? `Stress level ${wellbeing.stress_level}/5 · elevated today`
            : `Stress level ${wellbeing.stress_level}/5 today`,
    });
  }

  if (waterMl != null && waterMl > 0) {
    dims.push({
      id: 'water',
      label: 'Water',
      icon: '💧',
      valueText: formatWaterMl(waterMl),
      magnitude: magnitudeWater(waterMl),
      color: healthCategories.hydration,
      detail: `${formatWaterMl(waterMl)} of water logged today`,
    });
  }

  if (hr) {
    dims.push({
      id: 'heart',
      label: 'Heart rate',
      icon: '❤️',
      valueText: `${hr.value} bpm`,
      magnitude: magnitudeHeartRate(hr.value),
      color: healthCategories.vitals,
      detail: `Latest heart rate check · ${hr.value} bpm`,
    });
  }

  if (activity && activity.duration_minutes > 0) {
    dims.push({
      id: 'activity',
      label: 'Activity',
      icon: '👟',
      valueText: formatDurationMinutes(activity.duration_minutes),
      magnitude: magnitudeActivity(activity.duration_minutes),
      color: healthCategories.activity,
      detail: `${formatDurationMinutes(activity.duration_minutes)} of activity today`,
    });
  }

  if (med && med.activeCount > 0) {
    dims.push({
      id: 'medication',
      label: 'Medication',
      icon: '💊',
      valueText: med.dosesTaken > 0 ? `${med.dosesTaken} dose${med.dosesTaken > 1 ? 's' : ''}` : 'Today',
      magnitude: med.hasSchedule ? magnitudeRatio(med.dosesTaken, med.dosesExpected) : 0.5,
      color: healthCategories.medication,
      detail: med.statusText,
    });
  }

  return dims;
}

// ─── Story building (from local log events) ──────────────────────────────────

interface LocalLogRow {
  group_id: string;
  log_date: string;
}

interface LocalLogEvent {
  event_id: string;
  group_id: string;
  event_type: string;
  concept_id: string | null;
  event_time: string;
  payload_json: string;
  created_at: string;
}

function parsePayload(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json ?? '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function storyItemFromLogEvent(
  ev: LocalLogEvent,
  medicationNames: Map<string, string>,
): HomeStoryItem | null {
  const payload = parsePayload(ev.payload_json);
  const dayKey = localDateString(new Date(ev.event_time));

  switch (ev.event_type) {
    case 'WELLBEING_LOG': {
      const w = num(payload.overall_wellbeing);
      const e = num(payload.energy_level);
      const s = num(payload.stress_level);
      const parts = [
        w != null ? `wellbeing ${w}/5` : null,
        e != null ? `energy ${e}/5` : null,
        s != null ? `stress ${s}/5` : null,
      ].filter(Boolean);
      return {
        id: ev.event_id,
        time: ev.event_time,
        dayKey,
        category: 'wellbeing',
        title: 'Daily log',
        detail: parts.length ? parts.join(' · ') : 'Wellbeing check-in',
        icon: '🌱',
      };
    }
    case 'SLEEP_LOG': {
      const mins = num(payload.duration_minutes);
      const q = num(payload.sleep_quality);
      return {
        id: ev.event_id,
        time: ev.event_time,
        dayKey,
        category: 'sleep',
        title: 'Sleep',
        detail: `${formatSleepMinutes(mins)}${q != null ? ` · quality ${q}/5` : ''}`,
        icon: '🌙',
      };
    }
    case 'ACTIVITY_LOG': {
      const mins = num(payload.duration_minutes);
      const type = str(payload.activity_type);
      return {
        id: ev.event_id,
        time: ev.event_time,
        dayKey,
        category: 'activity',
        title: 'Activity',
        detail: `${formatDurationMinutes(mins ?? 0)}${type ? ` · ${type}` : ''}`,
        icon: '👟',
      };
    }
    case 'NUTRITION_LOG': {
      const w = num(payload.water_ml);
      const meals = num(payload.meals_count);
      const parts = [
        w != null && w > 0 ? `${formatWaterMl(w)} water` : null,
        meals != null ? `${meals} meal${meals > 1 ? 's' : ''}` : null,
      ].filter(Boolean);
      return {
        id: ev.event_id,
        time: ev.event_time,
        dayKey,
        category: 'nutrition',
        title: 'Nutrition',
        detail: parts.length ? parts.join(' · ') : 'Nutrition logged',
        icon: '💧',
      };
    }
    case 'SYMPTOM': {
      const severity = num(payload.severity);
      const name = str(payload.display_name);
      return {
        id: ev.event_id,
        time: ev.event_time,
        dayKey,
        category: 'symptom',
        title: 'Symptom',
        detail: `${name ?? 'Symptom'}${severity != null ? ` · ${severity}/10` : ''}`,
        icon: '⚠️',
      };
    }
    case 'PAIN_LOG': {
      const severity = num(payload.severity);
      const type = str(payload.pain_type);
      return {
        id: ev.event_id,
        time: ev.event_time,
        dayKey,
        category: 'pain',
        title: 'Pain',
        detail: `${type ?? 'Pain'} · ${severity != null ? `${severity}/10` : 'logged'}`,
        icon: '🔥',
      };
    }
    case 'VITAL_SIGN': {
      const v = num(payload.value);
      const unit = str(payload.unit);
      const name = str(payload.display_name) ?? str(payload.concept_display_name);
      return {
        id: ev.event_id,
        time: ev.event_time,
        dayKey,
        category: 'vital',
        title: name ?? 'Vitals',
        detail: v != null ? `${v}${unit ? ` ${unit}` : ''}` : 'Vitals logged',
        icon: '📈',
      };
    }
    case 'MEDICATION_TAKEN': {
      const name =
        str(payload.medication_name) ??
        (ev.concept_id ? medicationNames.get(ev.concept_id) : null) ??
        'Dose taken';
      return {
        id: ev.event_id,
        time: ev.event_time,
        dayKey,
        category: 'medication',
        title: 'Medication taken',
        detail: name ?? 'Dose taken',
        icon: '💊',
      };
    }
    case 'PATIENT_NOTE': {
      return {
        id: ev.event_id,
        time: ev.event_time,
        dayKey,
        category: 'note',
        title: 'Note added',
        detail: 'Personal health note',
        icon: '📝',
      };
    }
    default:
      return null;
  }
}