import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import Svg, { Circle, Path } from 'react-native-svg';
import { Button, Card, Chip, DialInput, Input, LogCelebration, Slider } from '@/components';
import { useHideTabBarOnScroll } from '@/components/tabBarVisibility';
import { useReducedMotion } from '@/theme';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { shiftDayKey, todayKeyLocal } from '@/utils/dayKey';
import { TILE_TONES } from '@/theme/tones';
import { api } from '@/services/api';
import { getCachedPatientId } from '@/services/patientIdentity';
import { requestDataRefresh } from '@/services/dataRefresh';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { usePriority } from '@/hooks/usePriority';
import { useActiveMedications } from '@/hooks/useMedications';
import { durationFromBedWake, parseClockTime } from '@/screens/SleepEngine/sleepEngine';
import {
  getBpReadings as dbGetBpReadings,
  getDailyLogDetail as dbGetDailyLogDetail,
  upsertDailyLog as dbUpsertDailyLog,
  hydrateDailyLog as dbHydrateDailyLog,
  getPendingMutationId as dbGetPendingMutationId,
  reconcileDailyLogGroupId as dbReconcileDailyLogGroupId,
} from '@/db/queries/dailyLogs';
import { bpAverages, pairBpDays } from '@/services/bloodPressure';
import type {
  DailyCheckInRequest,
  DailyCheckInResponse,
  DailyCheckInDetail,
  ManualLogConcept,
  RootStackParamList,
} from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// ---------------------------------------------------------------------------
// Backend field names
// ---------------------------------------------------------------------------
type ScoreName = 'overall_wellbeing' | 'energy_level' | 'stress_level';

// ---------------------------------------------------------------------------
// Mood labels mapped to backend 1–5
// ---------------------------------------------------------------------------
const MOOD_OPTIONS = [
  { value: 1, label: 'Very low' },
  { value: 2, label: 'Low' },
  { value: 3, label: 'Neutral' },
  { value: 4, label: 'Good' },
  { value: 5, label: 'Very good' },
] as const;

const ENERGY_LABELS: Record<number, string> = {
  1: 'Very low',
  2: 'Low',
  3: 'Moderate',
  4: 'High',
  5: 'Very high',
};

const STRESS_LABELS: Record<number, string> = {
  1: 'Very calm',
  2: 'Calm',
  3: 'Moderate',
  4: 'High',
  5: 'Very high',
};

const APPETITE_LABELS: Record<number, string> = {
  1: 'Very poor',
  2: 'Poor',
  3: 'Fair',
  4: 'Good',
  5: 'Excellent',
};

// ---------------------------------------------------------------------------
// Sleep quality 1–5 labels
// ---------------------------------------------------------------------------
const SLEEP_QUALITY_LABELS: Record<number, string> = {
  1: 'Very poor',
  2: 'Poor',
  3: 'Fair',
  4: 'Good',
  5: 'Excellent',
};

// ---------------------------------------------------------------------------
// Quick-pick presets — one tap instead of typing (convenience over complexity)
// ---------------------------------------------------------------------------
const MEAL_LABELS: Record<number, string> = {
  1: 'One meal',
  2: 'Two meals',
  3: 'Three meals',
  4: 'Four meals',
  5: 'Five or more',
};

const PAIN_TYPE_OPTIONS = ['Sharp', 'Dull', 'Throbbing', 'Aching', 'Burning', 'Stabbing'] as const;

const ACTIVITY_OPTIONS = [
  'Walking',
  'Running',
  'Yoga',
  'Cycling',
  'Swimming',
  'Strength',
  'Dancing',
  'Sports',
] as const;

const DURATION_QUICK = ['15', '30', '45', '60', '90'] as const;
const WATER_QUICK = ['250', '500', '750', '1000', '2000'] as const;

/** Body-region quick picks for pain structure_id (free text stays available). */
const BODY_REGION_OPTIONS = [
  'Head',
  'Neck',
  'Shoulder',
  'Back',
  'Chest',
  'Arm',
  'Hand',
  'Hip',
  'Leg',
  'Knee',
  'Foot',
] as const;

/** Quick unit picks for vitals — tap beats typing ("mm or whatever"). */
const VITAL_UNIT_OPTIONS = ['bpm', 'mmHg', 'mg/dL', '°F', '°C', 'kg', '%'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Local calendar day (YYYY-MM-DD). NEVER UTC: toISOString() shifts the day
 *  for timezones ahead of UTC (IST evenings logged "today" landed yesterday,
 *  invisible on the timeline's local-day pages). */
const dateToday = (): string => todayKeyLocal();

const shiftDate = (value: string, days: number) => shiftDayKey(value, days);

const formatRelativeDate = (dateStr: string): string => {
  const today = new Date();
  const date = new Date(dateStr + 'T00:00:00');
  const diffDays = Math.floor(
    (today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const formatSleepDuration = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
};

// A local (device-side) failure with a safe, user-facing message.
// Deliberately kept separate from axios errors so a SQLite/session problem
// is never reported to the user as a connection problem.
type LocalSaveError = { kind: 'auth' | 'local'; message: string };

// Classify an API error into a coarse category for logging.
// Logs method/path/status/category only — never request or response bodies.
function classifyApiError(error: unknown): string {
  if (!axios.isAxiosError(error)) return 'unknown';
  if (
    error.code === 'ECONNABORTED' ||
    error.code === 'ERR_NETWORK' ||
    error.response == null
  ) {
    return 'network';
  }
  const status = error.response.status;
  if (status === 401) return 'auth';
  if (status >= 500) return 'server';
  if (status >= 400) return 'client';
  return 'unknown';
}

function apiMessage(error: unknown): string {
  if (!axios.isAxiosError(error))
    return 'Something went wrong on this device. Your data was not saved. Please try again.';
  if (error.code === 'ECONNABORTED')
    return 'The request timed out. Please try again.';
  if (error.response?.status === 401)
    return 'Your session has expired. Please sign in again.';
  if (error.response?.status === 403)
    return 'You do not have permission to save this daily log.';
  if (error.response?.status === 422)
    return typeof error.response.data?.detail === 'string'
      ? error.response.data.detail
      : 'Please review the highlighted fields.';
  if ((error.response?.status ?? 0) >= 500)
    return 'MedGraph could not save your log. Please try again shortly.';
  return 'Unable to save your daily log. Please try again.';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// Per-category dots — small flat icons inside white cards only (Guava).
const SECTION_ACCENTS: Record<string, { color: string }> = {
  sleep: { color: GV.fx.purple },
  symptomsPain: { color: GV.fx.pink },
  activity: { color: GV.fx.blue },
  nutrition: { color: GV.fx.green },
  medication: { color: GV.fx.brown },
  vitals: { color: GV.fx.sky },
  wellbeing: { color: GV.fx.amber },
  symptoms: { color: GV.fx.brown },
  notes: { color: GV.muted },
};

/** Section wrapper — dark skill card per log group, no entrance motion. */
function Section({
  title,
  subtitle,
  category,
  index = 0,
  animate = true,
  children,
  onLayout,
}: {
  title: string;
  subtitle?: string;
  category?: keyof typeof SECTION_ACCENTS;
  /** Order on screen — kept for call-site compatibility; no stagger. */
  index?: number;
  animate?: boolean;
  children: React.ReactNode;
  /** Exposes the section's Y offset for Priority-log scroll targets. */
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  void index;
  void animate;
  const accent = category ? SECTION_ACCENTS[category] : null;
  return (
    <View style={styles.section} onLayout={onLayout}>
      <Card style={styles.sectionCard}>
        <View style={styles.sectionHead}>
          {accent ? (
            <View style={[styles.sectionDot, { backgroundColor: accent.color }]} />
          ) : null}
          <View style={styles.sectionHeadText}>
            <Text style={styles.sectionHeadTitle}>{title}</Text>
            {subtitle ? (
              <Text style={styles.sectionHeadSub}>{subtitle}</Text>
            ) : null}
          </View>
        </View>
        <View style={styles.sectionBody}>{children}</View>
      </Card>
    </View>
  );
}

/** Horizontal divider — hairline on stage */
function Divider() {
  return <View style={styles.divider} />;
}

/** Single-select pill row for mood (shows label text) */
function MoodSelector({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <View style={styles.moodRow}>
      {MOOD_OPTIONS.map((opt) => {
        const selected = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.moodPill, selected && styles.moodPillSelected]}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={opt.label}
          >
            <Text
              style={[styles.moodPillText, selected && styles.moodPillTextSelected]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 1–5 number selector with label underneath */
function ScaleSelector({
  value,
  onChange,
  labels,
  tone = GV.cta,
}: {
  value: number | null;
  onChange: (v: number) => void;
  labels: Record<number, string>;
  tone?: string;
}) {
  return (
    <View>
      <View style={styles.scaleRow}>
        {[1, 2, 3, 4, 5].map((n) => {
          const selected = value === n;
          return (
            <Pressable
              key={n}
              onPress={() => onChange(n)}
              style={[styles.scaleDot, selected && [styles.scaleDotSelected, { backgroundColor: tone, borderColor: tone }]]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${n} out of 5`}
            >
              <Text
                style={[
                  styles.scaleDotText,
                  selected && styles.scaleDotTextSelected,
                ]}
              >
                {n}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {value != null && labels[value] ? (
        <Text style={styles.scaleLabel}>{labels[value]}</Text>
      ) : (
        <View style={styles.scaleLabelRow}>
          <Text style={styles.scaleHint}>Low</Text>
          <Text style={styles.scaleHint}>High</Text>
        </View>
      )}
    </View>
  );
}

/** Sleep duration stepper (hours + minutes) */
function SleepDurationPicker({
  totalMinutes,
  onChange,
}: {
  totalMinutes: number;
  onChange: (minutes: number) => void;
}) {
  // Defensive: a non-finite value (NaN/undefined from a corrupt stored row)
  // renders every segment empty and poisons every tap (NaN + 30 = NaN),
  // leaving the display permanently blank. Coerce to 0 so the stepper
  // always shows a value and the first tap heals the state for good.
  const total = Number.isFinite(totalMinutes)
    ? Math.max(0, Math.min(24 * 60, Math.round(totalMinutes as number)))
    : 0;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;

  const adjust = (delta: number) => {
    const next = Math.max(0, Math.min(24 * 60, total + delta));
    onChange(next);
  };

  return (
    <View style={styles.stepperRow}>
      <Pressable
        onPress={() => adjust(-30)}
        style={styles.stepperBtn}
        accessibilityLabel="Decrease by 30 minutes"
      >
        <Text style={styles.stepperBtnText}>−30m</Text>
      </Pressable>
      <Pressable
        onPress={() => adjust(-15)}
        style={styles.stepperBtn}
        accessibilityLabel="Decrease by 15 minutes"
      >
        <Text style={styles.stepperBtnText}>−15m</Text>
      </Pressable>
      <View style={styles.stepperDisplay}>
        <Text style={styles.stepperValue}>
          {hours > 0 ? `${hours}h` : ''}
          {hours > 0 && minutes > 0 ? ' ' : ''}
          {minutes > 0 || hours === 0 ? `${minutes}m` : ''}
        </Text>
      </View>
      <Pressable
        onPress={() => adjust(15)}
        style={styles.stepperBtn}
        accessibilityLabel="Increase by 15 minutes"
      >
        <Text style={styles.stepperBtnText}>+15m</Text>
      </Pressable>
      <Pressable
        onPress={() => adjust(30)}
        style={styles.stepperBtn}
        accessibilityLabel="Increase by 30 minutes"
      >
        <Text style={styles.stepperBtnText}>+30m</Text>
      </Pressable>
    </View>
  );
}

/** Compact 1–5 quality selector for sleep */
function QualitySelector({
  value,
  onChange,
  labels,
  tone = GV.cta,
}: {
  value: number | null;
  onChange: (v: number) => void;
  labels: Record<number, string>;
  tone?: string;
}) {
  return (
    <View style={styles.qualityRow}>
      {[1, 2, 3, 4, 5].map((n) => {
        const selected = value === n;
        return (
          <Pressable
            key={n}
            onPress={() => onChange(n)}
            style={[styles.qualityDot, selected && [styles.qualityDotSelected, { backgroundColor: tone, borderColor: tone }]]}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={labels[n] || `${n} out of 5`}
          >
            <Text
              style={[
                styles.qualityDotText,
                selected && styles.qualityDotTextSelected,
              ]}
            >
              {n}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * OptionChips — single-select wrap chips tinted per section. Tapping the
 * selected chip clears it when allowClear (optional fields). Writes straight
 * into the same string state the free-text Inputs use, so chips and custom
 * typing stay consistent with zero new state.
 */
function OptionChips({
  options,
  value,
  onChange,
  color,
  tone,
  allowClear = false,
  label,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  color: string;
  /** Category duotone deep color: selected chips wear the section tone. */
  tone?: string;
  allowClear?: boolean;
  label: string;
}) {
  const selectedBg = tone ?? color;
  return (
    <View style={styles.optRow}>
      {options.map((opt) => {
        const selected = value === opt;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(selected && allowClear ? '' : opt)}
            style={[styles.optChip, selected && [styles.optChipSelected, { backgroundColor: selectedBg, borderColor: selectedBg }]]}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${opt}${selected ? ', selected' : ''}`}
          >
            <Text style={[styles.optChipText, selected && styles.optChipTextSelected]}>
              {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Smart vital inputs — per-concept "doctor's device" dials
// ---------------------------------------------------------------------------

type VitalPresetKind = 'hr' | 'glucose' | 'temp' | 'bpSys' | 'bpDia';

/** Recognize backend manual-log concepts that deserve a dedicated dial. */
function vitalPresetFor(concept: ManualLogConcept | undefined): VitalPresetKind | null {
  if (!concept) return null;
  if (concept.terminology === 'LOINC' && concept.code === '8867-4') return 'hr';
  if (concept.terminology === 'LOINC' && concept.code === '2339-0') return 'glucose';
  if (concept.terminology === 'LOINC' && concept.code === '8480-6') return 'bpSys';
  if (concept.terminology === 'LOINC' && concept.code === '8462-4') return 'bpDia';
  const name = `${concept.short_name ?? ''} ${concept.display_name}`.toLowerCase();
  if (/heart|pulse/.test(name)) return 'hr';
  if (/gluc|sugar/.test(name)) return 'glucose';
  if (/temp|thermal/.test(name)) return 'temp';
  if (/systolic/.test(name)) return 'bpSys';
  if (/diastolic/.test(name)) return 'bpDia';
  return null;
}

function isFeverConcept(concept: ManualLogConcept | undefined): boolean {
  if (!concept) return false;
  if (concept.code === '386661006') return true;
  const name = `${concept.short_name ?? ''} ${concept.display_name}`.toLowerCase();
  return /fever|pyrexia/.test(name);
}

const VITAL_DIALS: Record<
  VitalPresetKind,
  { min: number; max: number; step: number; unit: string; label: string }
> = {
  hr: { min: 30, max: 220, step: 1, unit: 'bpm', label: 'Heart rate' },
  glucose: { min: 20, max: 600, step: 1, unit: 'mg/dL', label: 'Blood glucose' },
  temp: { min: 95, max: 108, step: 0.1, unit: '°F', label: 'Temperature' },
  bpSys: { min: 50, max: 300, step: 1, unit: 'mmHg', label: 'Systolic' },
  bpDia: { min: 30, max: 200, step: 1, unit: 'mmHg', label: 'Diastolic' },
};

/** Default unit stamped when a vital concept is picked. */
function autoUnitFor(concept: ManualLogConcept): string {
  const preset = vitalPresetFor(concept);
  return preset ? VITAL_DIALS[preset].unit : '';
}

/** Curated pain sites (valid structure_ids) when the registry is unreachable. */
const FALLBACK_BODY_SITES = [
  { structure_id: 'CERVICAL_SPINE', display_name: 'Neck' },
  { structure_id: 'THORACIC_SPINE', display_name: 'Upper back' },
  { structure_id: 'LUMBAR_SPINE', display_name: 'Lower back' },
  { structure_id: 'JAW', display_name: 'Jaw' },
  { structure_id: 'LEFT_HAND', display_name: 'Left hand' },
  { structure_id: 'RIGHT_HAND', display_name: 'Right hand' },
  { structure_id: 'LEFT_KNEE', display_name: 'Left knee' },
  { structure_id: 'RIGHT_KNEE', display_name: 'Right knee' },
  { structure_id: 'LEFT_FOOT', display_name: 'Left foot' },
  { structure_id: 'RIGHT_FOOT', display_name: 'Right foot' },
];

const TEMP_TOKEN_RE = /Temp\s+[\d.]+\s*°[CF]/;

function readTempToken(notes: string): number | null {
  const m = notes.match(TEMP_TOKEN_RE);
  if (!m) return null;
  const n = Number(m[0].replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function writeTempToken(notes: string, token: string): string {
  if (TEMP_TOKEN_RE.test(notes)) return notes.replace(TEMP_TOKEN_RE, token);
  return notes.trim() ? `${notes.trim()} · ${token}` : token;
}

/**
 * FeverTempDial — temperature dial for the Fever symptom.
 *
 * Symptom payloads carry severity/duration/notes (no temperature field), so
 * the dial writes an explicit, user-visible `Temp 101.3 °F` token into the
 * notes the user already controls — honest, editable, and shown on the
 * timeline. °F/°C toggle converts the same reading.
 */
function FeverTempDial({
  notes,
  onNotes,
  color,
}: {
  notes: string;
  onNotes: (next: string) => void;
  color: string;
}) {
  void color;
  const [unit, setUnit] = useState<'°F' | '°C'>('°F');
  const stored = readTempToken(notes);
  // Internal value is always °F; display converts.
  const toDisplay = (f: number) => (unit === '°F' ? f : (f - 32) * (5 / 9));
  const fromDisplay = (d: number) => (unit === '°F' ? d : d * (9 / 5) + 32);
  const range = unit === '°F' ? { min: 95, max: 108 } : { min: 35, max: 42.2 };
  const displayValue = stored == null ? null : Math.min(range.max, Math.max(range.min, toDisplay(stored)));

  return (
    <View>
      <View style={styles.unitToggleRow}>
        <Text style={styles.fieldLabel}>Temperature</Text>
        <View style={styles.unitToggle}>
          {(['°F', '°C'] as const).map((u) => (
            <Pressable
              key={u}
              onPress={() => setUnit(u)}
              style={[styles.unitToggleBtn, unit === u && styles.unitToggleBtnSelected]}
              accessibilityRole="radio"
              accessibilityState={{ selected: unit === u }}
              accessibilityLabel={`Degrees ${u === '°F' ? 'Fahrenheit' : 'Celsius'}`}
            >
              <Text style={[styles.unitToggleText, unit === u && styles.unitToggleTextSelected]}>{u}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <DialInput
        value={displayValue}
        onChange={(d) => {
          const f = fromDisplay(d);
          onNotes(writeTempToken(notes, `Temp ${f.toFixed(1)} °F`));
        }}
        min={range.min}
        max={range.max}
        step={0.1}
        unit={unit}
        color={GV.cta}
        accessibilityLabel="Fever temperature"
      />
      <Text style={styles.dialHint}>Saved into your symptom notes. Visible on your timeline.</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

type SymptomDraft = {
  id: number;
  conceptId: string;
  severity: string;
  duration: string;
  notes: string;
};

type ActivityDraft = { id: number; activityType: string; duration: string; calories: string; distance: string };
type MedicationDraft = { id: number; name: string; dosage: string; unit: string };
type VitalDraft = { id: number; conceptId: string; value: string; unit: string };
type PainDraft = { id: number; structureId: string; bodyLocationId: string; severity: string; painType: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * BpHistoryCard — cuff readings the user logged, as neutral history.
 * Latest pair plus trailing averages with reading counts. No ranges,
 * no staging, no alerts — log and averages only. Reads SQLite directly;
 * refreshes when the daily log saves (bp-readings invalidation).
 */
function BpHistoryCard() {
  const bpQuery = useQuery({
    queryKey: ['bp-readings'],
    queryFn: async () => {
      const patientId = getCachedPatientId();
      if (!patientId) return [];
      const today = todayKeyLocal();
      const start = shiftDayKey(today, -89);
      return dbGetBpReadings(patientId, start, today);
    },
    staleTime: 60_000,
  });
  const pairs = pairBpDays(bpQuery.data ?? []);
  const today = todayKeyLocal();
  const week = bpAverages(pairs, today, 7);
  const month = bpAverages(pairs, today, 30);
  const latest = pairs.length > 0 ? pairs[pairs.length - 1] : null;
  return (
    <View style={styles.bpCard}>
      <Text style={styles.fieldLabel}>Blood pressure history</Text>
      {bpQuery.isLoading ? (
        <Text style={styles.bpSub}>Loading…</Text>
      ) : !latest ? (
        <Text style={styles.bpSub}>No readings yet. Log systolic + diastolic above.</Text>
      ) : (
        <>
          <Text style={styles.bpLatest}>
            {latest.systolic}/{latest.diastolic} mmHg · {latest.log_date.slice(5)}
          </Text>
          {week.count > 0 ? (
            <Text style={styles.bpSub}>
              7-day avg {week.avgSystolic}/{week.avgDiastolic} · {week.count} {week.count === 1 ? 'reading' : 'readings'}
            </Text>
          ) : null}
          {month.count > 0 ? (
            <Text style={styles.bpSub}>
              30-day avg {month.avgSystolic}/{month.avgDiastolic} · {month.count} {month.count === 1 ? 'reading' : 'readings'}
            </Text>
          ) : null}
        </>
      )}
      <Text style={styles.bpSub}>Cuff readings you logged. Averages only.</Text>
    </View>
  );
}

export default function VitalsLoggerScreen() {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();

  // --- Form state ---
  const [mood, setMood] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [stress, setStress] = useState<number | null>(null);
  const [sleepMinutes, setSleepMinutes] = useState(0);
  const [sleepQuality, setSleepQuality] = useState<number | null>(null);
  const [awakenings, setAwakenings] = useState<number | null>(null);
  const [bedtime, setBedtime] = useState('');
  const [wakeTime, setWakeTime] = useState('');
  const [waterMl, setWaterMl] = useState('');
  const [mealsCount, setMealsCount] = useState('');
  const [appetiteLevel, setAppetiteLevel] = useState<number | null>(null);
  const [symptoms, setSymptoms] = useState<SymptomDraft[]>([]);
  const [pain, setPain] = useState<PainDraft[]>([]);
  const [activities, setActivities] = useState<ActivityDraft[]>([]);
  const [medications, setMedications] = useState<MedicationDraft[]>([]);
  const [vitals, setVitals] = useState<VitalDraft[]>([]);
  const [symptomSearch, setSymptomSearch] = useState('');
  const [vitalSearch, setVitalSearch] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [nextId, setNextId] = useState(1);
  // Log mode — Normal (default) shows the full form; Quick shows only the
  // essentials (mood + water) that turn the dashboard green.
  const [logMode, setLogMode] = useState<'normal' | 'quick'>('normal');
  // Side tabs hide on scroll down, return on scroll up (pulse tab stays).
  const onTabScroll = useHideTabBarOnScroll();

  // Essentials customization — first run shows everything; the user picks
  // which rows belong to their Quick card and can re-edit anytime via the
  // Customize toggle below. Persisted per device.
  type EssentialRowKey = 'mood' | 'water' | 'sleep' | 'nutrition' | 'meds';
  const ESSENTIAL_ROWS: { key: EssentialRowKey; label: string }[] = [
    { key: 'mood', label: 'Mood' },
    { key: 'water', label: 'Water' },
    { key: 'sleep', label: 'Sleep' },
    { key: 'nutrition', label: 'Meals' },
    { key: 'meds', label: 'Medicines' },
  ];
  const ESSENTIALS_KEY = 'essentials-rows-v1';
  const [essentialRows, setEssentialRows] = useState<EssentialRowKey[] | null>(null);
  const [customizing, setCustomizing] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(ESSENTIALS_KEY)
      .then((saved) => {
        if (!saved) {
          setEssentialRows(ESSENTIAL_ROWS.map((r) => r.key));
          return;
        }
        try {
          const parsed = JSON.parse(saved) as unknown;
          const valid = Array.isArray(parsed)
            ? (parsed as string[]).filter((k): k is EssentialRowKey =>
                ESSENTIAL_ROWS.some((r) => r.key === k),
              )
            : [];
          setEssentialRows(valid.length > 0 ? valid : ESSENTIAL_ROWS.map((r) => r.key));
        } catch {
          setEssentialRows(ESSENTIAL_ROWS.map((r) => r.key));
        }
      })
      .catch(() => setEssentialRows(ESSENTIAL_ROWS.map((r) => r.key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleEssentialRow = (key: EssentialRowKey) => {
    setEssentialRows((prev) => {
      const base = prev ?? ESSENTIAL_ROWS.map((r) => r.key);
      const next = base.includes(key)
        ? base.filter((k) => k !== key)
        : [...ESSENTIAL_ROWS.map((r) => r.key).filter((k) => base.includes(k) || k === key)];
      AsyncStorage.setItem(ESSENTIALS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };
  const showEssential = (key: EssentialRowKey) =>
    (essentialRows ?? ESSENTIAL_ROWS.map((r) => r.key)).includes(key);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  // Collapsed summary vs open form: once a day is logged, the whole form
  // hides behind its summary until "Edit daily log" opens it again.
  const [editing, setEditing] = useState(false);
  const [formInitialized, setFormInitialized] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const reducedMotion = useReducedMotion();

  // ── Body-map pain logging (POST /api/v1/body-state/log — separate from
  // the daily check-in; lands on the body state + timeline) ──
  const [bodySites, setBodySites] = useState(FALLBACK_BODY_SITES);
  const [bodySite, setBodySite] = useState('');
  const [bodySeverity, setBodySeverity] = useState<number | null>(null);
  const [bodyNote, setBodyNote] = useState('');
  const [bodySaving, setBodySaving] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const items = await api.get<{ structure_id: string; display_name: string }[]>(
          '/api/v1/body-state/structures',
        );
        if (live && Array.isArray(items) && items.length > 0) {
          const seen = new Set<string>();
          const clean = items
            .filter((s) => s && typeof s.structure_id === 'string' && typeof s.display_name === 'string')
            .filter((s) => (seen.has(s.structure_id) ? false : (seen.add(s.structure_id), true)))
            .slice(0, 40);
          if (clean.length > 0) setBodySites(clean);
        }
      } catch {
        // Offline — curated fallback sites stay.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const saveBodyPain = async () => {
    setBodyError(null);
    setFeedback(null);
    if (!bodySite) {
      setBodyError('Choose where it hurts first.');
      return;
    }
    if (bodySeverity == null) {
      setBodyError('Set the pain severity on the dial.');
      return;
    }
    setBodySaving(true);
    try {
      await api.post('/api/v1/body-state/log', {
        structure_id: bodySite,
        finding_code: 'pain_level',
        visual_severity_score: Math.min(1, Math.max(0, bodySeverity / 10)),
        visual_status: bodySeverity >= 7 ? 'warning' : bodySeverity >= 4 ? 'mild_attention' : 'normal',
        ...(bodyNote.trim() ? { clinical_summary: bodyNote.trim().slice(0, 500) } : {}),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['timeline'] }),
        queryClient.invalidateQueries({ queryKey: ['bodyState'] }),
      ]);
      setFeedback({ type: 'success', message: 'Body pain logged to your body map and timeline.' });
      setBodySeverity(null);
      setBodyNote('');
      setCelebrate(true);
    } catch (error) {
      setBodyError(apiMessage(error));
    } finally {
      setBodySaving(false);
    }
  };

  // --- Data queries ---
  const conceptsQuery = useQuery({
    queryKey: ['manual-log-concepts'],
    queryFn: () =>
      api.get<ManualLogConcept[]>('/api/v1/ontology/manual-log-concepts'),
    staleTime: 86_400_000,
  });

  const metrics = useDailyMetrics();

  // Active prescriptions for the essentials medicines row.
  const { data: activeMeds } = useActiveMedications();

  /** Stage a prescription dose into today's drafts (tick on). */
  const stageEssentialMed = (name: string, dosage: string, unit: string) => {
    if (medications.some((m) => m.name === name)) return;
    setMedications((items) => [...items, { id: Date.now(), name, dosage, unit }]);
  };

  /** Remove a staged prescription dose (tick off). */
  const unstageEssentialMed = (name: string) =>
    setMedications((items) => items.filter((m) => m.name !== name));

  // Fetch today's existing check-in for edit mode — local-first
  const [selectedDate, setSelectedDate] = useState(dateToday());
  const todayCheckinQuery = useQuery<DailyCheckInDetail | null>({
    queryKey: ['daily-checkin', selectedDate],
    queryFn: async () => {
      const patientId = getCachedPatientId();
      if (!patientId) return null;

      // Try local SQLite first
      const localDetail = await dbGetDailyLogDetail(patientId, selectedDate);
      if (localDetail) {
        // Hydrate from server in background (fire-and-forget)
        hydrateFromServer(selectedDate).catch(() => {});
        return localDetail;
      }

      // Fallback: fetch from server
      try {
        const serverDetail = await api.get<DailyCheckInDetail>(`/api/v1/logs/daily-checkin/${selectedDate}`);
        // Hydrate local SQLite
        await dbHydrateDailyLog(patientId, serverDetail);
        return serverDetail;
      } catch (err: any) {
        // 404 means no check-in exists for this date — return null (not an error)
        if (err?.response?.status === 404) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  // Background hydration from server
  const hydrateFromServer = async (date: string) => {
    const patientId = getCachedPatientId();
    if (!patientId) return;
    try {
      const serverDetail = await api.get<DailyCheckInDetail>(`/api/v1/logs/daily-checkin/${date}`);
      await dbHydrateDailyLog(patientId, serverDetail);
    } catch {
      // Offline or 404 — ignore
    }
  };

  // Initialize form from existing entry for the selected date.
  useEffect(() => {
    if (formInitialized || todayCheckinQuery.isLoading) return;
    const existing = todayCheckinQuery.data;
    if (!existing) {
      setEditingGroupId(null);
      setFormInitialized(true);
      return;
    }

    setEditingGroupId(existing.group_id);
    if (existing.overall_wellbeing != null) setMood(existing.overall_wellbeing);
    if (existing.energy_level != null) setEnergy(existing.energy_level);
    if (existing.stress_level != null) setStress(existing.stress_level);
    if (existing.sleep_duration_minutes != null && Number.isFinite(existing.sleep_duration_minutes)) setSleepMinutes(existing.sleep_duration_minutes);
    if (existing.sleep_quality != null) setSleepQuality(existing.sleep_quality);
    if (existing.sleep_awakenings != null) setAwakenings(existing.sleep_awakenings);
    if (existing.bedtime) setBedtime(existing.bedtime);
    if (existing.wake_time) setWakeTime(existing.wake_time);
    if (existing.water_ml != null) setWaterMl(String(existing.water_ml));
    if (existing.meals_count != null) setMealsCount(String(existing.meals_count));
    if (existing.appetite_level != null) setAppetiteLevel(existing.appetite_level);
    if (existing.notes) setNotes(existing.notes);
    if (existing.symptoms.length > 0) {
      setSymptoms(existing.symptoms.map((s, i) => ({
        id: i + 1,
        conceptId: s.concept_id ?? '',
        severity: String(s.severity),
        duration: s.duration_minutes != null ? String(s.duration_minutes) : '',
        notes: s.notes ?? '',
      })));
      setNextId(existing.symptoms.length + 1);
    }
    setPain(existing.pain.map((item, i) => ({ id: i + 1, structureId: '', bodyLocationId: item.body_location_id ?? '', severity: String(item.severity), painType: item.pain_type ?? '' })));
    setActivities(existing.activities.map((item, i) => ({ id: i + 1, activityType: item.activity_type, duration: item.duration_minutes == null ? '' : String(item.duration_minutes), calories: item.calories_burned == null ? '' : String(item.calories_burned), distance: item.distance_km == null ? '' : String(item.distance_km) })));
    setMedications(existing.medications.map((item, i) => ({ id: i + 1, name: item.medication_name, dosage: item.dosage_value == null ? '' : String(item.dosage_value), unit: item.dosage_unit ?? '' })));
    setVitals(existing.vitals.map((item, i) => ({ id: i + 1, conceptId: item.concept_id ?? '', value: item.value == null ? '' : String(item.value), unit: item.unit ?? '' })));
    setFormInitialized(true);
  }, [todayCheckinQuery.data, todayCheckinQuery.isLoading, formInitialized]);

  useEffect(() => {
    setFormInitialized(false);
    setEditingGroupId(null);
    setEditing(false);
    setMood(null); setEnergy(null); setStress(null); setSleepMinutes(0); setSleepQuality(null); setAwakenings(null); setBedtime(''); setWakeTime('');
    setWaterMl(''); setMealsCount(''); setAppetiteLevel(null); setSymptoms([]); setPain([]);
    setActivities([]); setMedications([]); setVitals([]); setNotes(''); setErrors({});
  }, [selectedDate]);

  const concepts = conceptsQuery.data ?? [];
  // Date square strings — memoized so every keystroke doesn't rebuild them.
  const dateBadge = useMemo(() => {
    const d = new Date(`${selectedDate}T00:00:00`);
    return {
      day: d.getDate(),
      month: d.toLocaleDateString('en-US', { month: 'short' }),
    };
  }, [selectedDate]);
  // Date colour — one skill-family solid per day, stable per date.
  // The Today chip and the Edit button wear the same colour.
  const dateColor = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < selectedDate.length; i++) {
      hash = (hash * 31 + selectedDate.charCodeAt(i)) >>> 0;
    }
    return DATE_SOLIDS[hash % DATE_SOLIDS.length];
  }, [selectedDate]);
  // A day with a saved check-in collapses to its summary + edit button.
  const logged = !todayCheckinQuery.isLoading && editingGroupId != null;
  const formOpen = !logged || editing;
  // All concepts are available for symptom selection.
  // LOINC concepts (Blood glucose, Heart rate) are vitals;
  // SNOMED concepts (Headache, Nausea, etc.) are symptoms.
  // Users pick whichever is relevant to their daily log entry.
  const symptomConcepts = concepts;
  const filteredSymptomConcepts = useMemo(() => {
    const q = symptomSearch.trim().toLowerCase();
    return q
      ? symptomConcepts.filter(
          (c) =>
            `${c.short_name ?? ''} ${c.display_name}`
              .toLowerCase()
              .includes(q),
        )
      : symptomConcepts;
  }, [symptomConcepts, symptomSearch]);

  const filteredVitalConcepts = useMemo(() => {
    const q = vitalSearch.trim().toLowerCase();
    return q
      ? concepts.filter(
          (c) =>
            `${c.short_name ?? ''} ${c.display_name}`
              .toLowerCase()
              .includes(q),
        )
      : concepts;
  }, [concepts, vitalSearch]);

  // Today's logged data from daily-metrics
  const todayWellbeing = metrics.data?.today_wellbeing;
  const latestSleep = metrics.data?.latest_sleep;
  const recentLogs = metrics.data?.recent_daily_logs ?? [];

  // --- Mutations ---
  const mutation = useMutation({
    mutationFn: async (payload: DailyCheckInRequest) => {
      const patientId = getCachedPatientId();
      if (!patientId) {
        const authError: LocalSaveError = {
          kind: 'auth',
          message: 'Your session has expired. Please sign in again.',
        };
        throw authError;
      }

      // Step 1: Write to SQLite immediately (offline-first)
      if (__DEV__) console.log(`[DailyLog] LOCAL_WRITE_START date=${payload.log_date}`);
      let groupId: string;
      try {
        groupId = await dbUpsertDailyLog(patientId, payload);
        if (__DEV__) console.log('[DailyLog] LOCAL_WRITE_SUCCESS');
      } catch (error) {
        const name = error instanceof Error ? error.name : 'unknown';
        if (__DEV__) {
          const detail = error instanceof Error ? error.message : String(error);
          console.error(`[DailyLog] LOCAL_WRITE_FAILURE name=${name} detail=${detail}`);
        } else {
          console.error(`[DailyLog] LOCAL_WRITE_FAILURE name=${name}`);
        }
        const localError: LocalSaveError = {
          kind: 'local',
          message: 'Could not save to this device\u2019s secure storage. Please try again.',
        };
        throw localError;
      }

      // Step 2: Try server persistence (fire-and-forget)
      const hasServerGroupId = editingGroupId != null &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(editingGroupId);
      const method = hasServerGroupId ? 'PUT' : 'POST';
      const path = hasServerGroupId
        ? `/api/v1/logs/daily-checkin/${editingGroupId}`
        : '/api/v1/logs/daily-checkin';
      let serverSaved = false;
      let serverGroupId: string | null = null;
      try {
        if (__DEV__) console.log(`[DailyLog] API_SYNC_START method=${method} path=${path}`);
        // Share the queued mutation's idempotency key so a racing sync-engine
        // POST of the same record cannot create a duplicate check-in.
        const idempotencyKey = await dbGetPendingMutationId('daily_logs', groupId);
        const config = idempotencyKey
          ? { headers: { 'Idempotency-Key': idempotencyKey } }
          : undefined;
        if (hasServerGroupId) {
          const response = await api.put<DailyCheckInResponse>(path, payload, config);
          serverGroupId = response.group_id;
        } else {
          try {
            const response = await api.post<DailyCheckInResponse>(path, payload, config);
            serverGroupId = response.group_id;
          } catch (keyedError) {
            // 409 = this key is bound to a different payload hash server-side
            // (stale queued key after local edits). Retry once keyless so the
            // server evaluates the current payload on its own merits.
            const keyedStatus = axios.isAxiosError(keyedError) ? keyedError.response?.status : undefined;
            if (keyedStatus !== 409) throw keyedError;
            const response = await api.post<DailyCheckInResponse>(path, payload);
            serverGroupId = response.group_id;
          }
        }
        serverSaved = true;
        if (__DEV__) console.log(`[DailyLog] API_SYNC_SUCCESS method=${method} path=${path}`);
        // Point local rows at the server check-in and retire the queued
        // duplicate so the sync engine does not POST it again.
        if (serverGroupId) {
          await dbReconcileDailyLogGroupId(groupId, serverGroupId);
        }
      } catch (error) {
        // Log only method, path, HTTP status and category — never bodies/health data.
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        console.warn(
          `[DailyLog] API_SYNC_FAILURE method=${method} path=${path} status=${status ?? 'none'} category=${classifyApiError(error)}`,
        );
      }

      return { groupId, serverSaved, serverGroupId };
    },
    onSuccess: async ({ serverSaved, serverGroupId }) => {
      // useDailyMetrics/useTrends hold local state (not React Query), so the
      // React Query invalidations below do not refresh them — refetch the
      // metrics directly or "Recent history" never shows the new entry.
      void metrics.refetch();
      // Dashboard reads SQLite through gated focus refetches only — tell it
      // a fresh save landed so its next focus reloads immediately instead
      // of serving up to 30 s of stale numbers (e.g. an unticked medicine
      // still showing as taken).
      requestDataRefresh();
      // Remember the server check-in so the next save updates (PUT) instead
      // of creating a duplicate (POST).
      if (serverGroupId) {
        setEditingGroupId(serverGroupId);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['timeline'] }),
        queryClient.invalidateQueries({ queryKey: ['bodyState'] }),
        queryClient.invalidateQueries({ queryKey: ['daily-metrics'] }),
        queryClient.invalidateQueries({ queryKey: ['daily-log'] }),
        queryClient.invalidateQueries({ queryKey: ['daily-checkin'] }),
        queryClient.invalidateQueries({ queryKey: ['bp-readings'] }),
      ]);
      if (serverSaved) {
        setFeedback({
          type: 'success',
          message: editingGroupId
            ? 'Daily log updated. Your timeline and dashboard are updated.'
            : 'Daily log saved. Your timeline and dashboard are updated.',
        });
      } else {
        // Local save succeeded but the server is unreachable — offline-first.
        setFeedback({
          type: 'success',
          message: 'Saved on this device. It will sync to your account when you are back online.',
        });
      }
      setCelebrate(true);
      // Back to the collapsed summary with its edit button.
      setEditing(false);
    },
    onError: (error) => {
      if (
        error &&
        typeof error === 'object' &&
        'kind' in error &&
        ((error as { kind?: unknown }).kind === 'auth' ||
          (error as { kind?: unknown }).kind === 'local')
      ) {
        setFeedback({ type: 'error', message: (error as LocalSaveError).message });
        return;
      }
      setFeedback({ type: 'error', message: apiMessage(error) });
    },
  });

  // --- Symptom helpers ---
  const updateSymptom = (id: number, changes: Partial<SymptomDraft>) =>
    setSymptoms((items) =>
      items.map((s) => (s.id === id ? { ...s, ...changes } : s)),
    );

  const addSymptom = () => {
    setSymptoms((items) => [
      ...items,
      { id: nextId, conceptId: '', severity: '', duration: '', notes: '' },
    ]);
    setNextId((n) => n + 1);
  };

  const removeSymptom = (id: number) =>
    setSymptoms((items) => items.filter((s) => s.id !== id));

  const addPain = () => setPain((items) => [...items, { id: Date.now(), structureId: '', bodyLocationId: '', severity: '', painType: '' }]);
  const addActivity = () => setActivities((items) => [...items, { id: Date.now(), activityType: '', duration: '', calories: '', distance: '' }]);
  const addVital = () => setVitals((items) => [...items, { id: Date.now(), conceptId: '', value: '', unit: '' }]);

  const conceptByCode = (terminology: string, code: string) =>
    concepts.find((c) => c.terminology === terminology && c.code === code);

  /** One-tap quick logs: prefilled drafts for the common vitals/symptoms. */
  const quickAddVital = (terminology: string, code: string, unit: string) => {
    const concept = conceptByCode(terminology, code);
    if (!concept) return;
    setVitals((items) => [
      ...items,
      { id: Date.now(), conceptId: concept.id, value: '', unit },
    ]);
  };
  // --- Priority log: shortcuts from the user's chosen engines ------------
  // Stress + Vitals are always present; every other chip appears only
  // when its engine is selected. Tapping jumps to the section's mode and
  // scrolls to it (prefilling a draft row where the pattern exists).
  // Replaces the old fixed quick-add buttons (pulse/glucose/fever).
  type PriorityTarget = 'essentials' | 'sleep' | 'activity' | 'nutrition' | 'vitals' | 'feel';
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Partial<Record<PriorityTarget, number>>>({});
  const { entries: priorityEntries } = usePriority();
  const priorityIds = useMemo(
    () => new Set(priorityEntries.map((e) => e.id)),
    [priorityEntries],
  );

  const scrollToSection = useCallback((target: PriorityTarget) => {
    requestAnimationFrame(() => {
      const y = sectionY.current[target];
      if (y == null) return;
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
    });
  }, []);

  const recordSectionY =
    (target: PriorityTarget) =>
    (e: LayoutChangeEvent): void => {
      sectionY.current[target] = e.nativeEvent.layout.y;
    };

  interface PriorityChip {
    key: string;
    label: string;
    target: PriorityTarget;
    mode: 'quick' | 'normal';
    prefill?: () => void;
  }

  const priorityChips: PriorityChip[] = useMemo(() => {
    const chips: PriorityChip[] = [
      { key: 'stress', label: 'Stress', target: 'feel', mode: 'normal' },
      { key: 'vitals', label: 'Vitals', target: 'vitals', mode: 'normal' },
    ];
    const push = (chip: PriorityChip): void => {
      chips.push(chip);
    };
    if (priorityIds.has('sleep')) push({ key: 'sleep', label: 'Sleep', target: 'sleep', mode: 'normal' });
    if (priorityIds.has('nutrition'))
      push({ key: 'meals', label: 'Meals', target: 'nutrition', mode: 'normal' });
    if (priorityIds.has('fitness'))
      push({
        key: 'activity',
        label: 'Activity',
        target: 'activity',
        mode: 'normal',
        prefill: () => addActivity(),
      });
    if (priorityIds.has('wellbeing'))
      push({ key: 'mood', label: 'Mood', target: 'feel', mode: 'normal' });
    if (priorityIds.has('weight'))
      push({ key: 'weight', label: 'Weight', target: 'vitals', mode: 'normal' });
    if (priorityIds.has('discipline'))
      push({ key: 'doses', label: 'Doses', target: 'essentials', mode: 'quick' });
    if (priorityIds.has('heart'))
      push({
        key: 'pulse',
        label: 'Pulse',
        target: 'vitals',
        mode: 'normal',
        prefill: () => quickAddVital('LOINC', '8867-4', 'bpm'),
      });
    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priorityIds]);

  // Priority chips turn green once their domain has something logged
  // (draft counts — colours fill in as the user logs, retentional).
  const chipDone = (key: string): boolean => {
    switch (key) {
      case 'stress':
        return stress != null;
      case 'mood':
        return mood != null;
      case 'sleep':
        return sleepMinutes > 0;
      case 'meals':
        return waterMl.trim() !== '' || mealsCount.trim() !== '' || appetiteLevel != null;
      case 'activity':
        return activities.length > 0;
      case 'vitals':
        return vitals.length > 0;
      case 'pulse':
        return vitals.some((v) => v.unit === 'bpm' || v.conceptId === '8867-4');
      case 'weight':
        return vitals.some(
          (v) =>
            v.unit === 'kg' ||
            v.unit === 'lb' ||
            v.conceptId.toLowerCase().includes('weight'),
        );
      case 'doses':
        return medications.length > 0;
      default:
        return false;
    }
  };

  // --- Validation ---
  const validate = (): boolean => {
    const e: Record<string, string> = {};
    const hasContent =
      mood != null ||
      energy != null ||
      stress != null ||
      sleepMinutes > 0 ||
      awakenings != null ||
      symptoms.length > 0 ||
      pain.length > 0 ||
      activities.length > 0 ||
      medications.length > 0 ||
      vitals.length > 0 ||
      waterMl.trim() !== '' ||
      mealsCount.trim() !== '' ||
      appetiteLevel != null ||
      notes.trim().length > 0;

    if (!hasContent) {
      e.form = 'Add at least one item to save a daily log.';
    }

    symptoms.forEach((s) => {
      if (!s.conceptId) e[`symptom-${s.id}`] = 'Choose a symptom.';
      if (!s.severity) e[`symptom-sev-${s.id}`] = 'Choose a severity.';
      if (
        s.duration &&
        (!Number.isInteger(Number(s.duration)) || Number(s.duration) < 0)
      ) {
        e[`symptom-dur-${s.id}`] = 'Use whole minutes.';
      }
    });

    if (notes.length > 4000) {
      e.notes = 'Keep the note to 4,000 characters or fewer.';
    }

    if (waterMl && (!Number.isInteger(Number(waterMl)) || Number(waterMl) < 0)) e.water = 'Use whole millilitres.';
    if (awakenings != null && sleepMinutes === 0) e.sleepAwakenings = 'Log sleep duration to record wake-ups.';
    if (bedtime.trim() !== '' && parseClockTime(bedtime.trim()) === null) e.bedtime = 'Use 24-hour HH:MM, e.g. 22:30.';
    if (wakeTime.trim() !== '' && parseClockTime(wakeTime.trim()) === null) e.wakeTime = 'Use 24-hour HH:MM, e.g. 06:30.';
    if (mealsCount && (!Number.isInteger(Number(mealsCount)) || Number(mealsCount) < 0)) e.meals = 'Use a whole meal count.';
    pain.forEach((item) => {
      if (!item.severity || Number(item.severity) < 1 || Number(item.severity) > 10) e[`pain-${item.id}`] = 'Choose a severity from 1 to 10.';
      if (item.bodyLocationId.trim() && !UUID_PATTERN.test(item.bodyLocationId.trim())) e[`pain-location-${item.id}`] = 'Use a valid body location UUID or leave this blank.';
    });
    activities.forEach((item) => { if (!item.activityType.trim()) e[`activity-${item.id}`] = 'Enter an activity type.'; });
    medications.forEach((item) => { if (!item.name.trim()) e[`medication-${item.id}`] = 'Enter a medication name.'; });
    vitals.forEach((item) => {
      if (!item.conceptId.trim()) e[`vital-${item.id}`] = 'Choose a vital sign.';
    });

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // --- Submit ---
  // Essentials fast-path: mood + water are the two signals that turn the
  // dashboard green (doses live on the dashboard med card). Same save path
  // and same honesty rules as a full save — never invented, only what the
  // user actually entered. Small button by design; the full log stays big.
  const saveEssentials = () => {
    setFeedback(null);
    const missing: string[] = [];
    if (mood == null) missing.push('mood');
    if (waterMl.trim() === '') missing.push('water');
    if (missing.length > 0) {
      setFeedback({
        type: 'error',
        message: `Essentials need your ${missing.join(' and ')} first. Add ${missing.length > 1 ? 'them' : 'it'} above, then tap again.`,
      });
      return;
    }
    save();
  };
  const save = () => {
    setFeedback(null);
    if (!validate()) return;

    const payload: DailyCheckInRequest = {
      log_date: selectedDate,
      ...(mood != null ? { overall_wellbeing: mood } : {}),
      ...(energy != null ? { energy_level: energy } : {}),
      ...(stress != null ? { stress_level: stress } : {}),
      ...(sleepMinutes > 0
        ? {
            sleep: {
              duration_minutes: sleepMinutes,
              ...(sleepQuality != null ? { sleep_quality: sleepQuality } : {}),
              ...(awakenings != null ? { awakenings } : {}),
              ...(parseClockTime(bedtime.trim()) !== null ? { bedtime: bedtime.trim() } : {}),
              ...(parseClockTime(wakeTime.trim()) !== null ? { wake_time: wakeTime.trim() } : {}),
            },
          }
        : {}),
      symptoms: symptoms.map((s) => ({
        concept_id: s.conceptId,
        severity: Number(s.severity),
        ...(s.duration ? { duration_minutes: Number(s.duration) } : {}),
        ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
      })),
      vitals: vitals.map((item) => ({
        concept_id: item.conceptId.trim(),
        value: item.value.trim() ? Number(item.value) : null,
        unit: item.unit.trim() || null,
      })),
      pain: pain.map((item) => ({ severity: Number(item.severity), ...(item.bodyLocationId.trim() ? { body_location_id: item.bodyLocationId.trim() } : {}), ...(item.structureId.trim() ? { structure_id: item.structureId.trim() } : {}), ...(item.painType.trim() ? { pain_type: item.painType.trim() } : {}) })),
      activities: activities.map((item) => ({ activity_type: item.activityType.trim(), ...(item.duration ? { duration_minutes: Number(item.duration) } : {}), ...(item.calories ? { calories_burned: Number(item.calories) } : {}), ...(item.distance ? { distance_km: Number(item.distance) } : {}) })),
      medications: medications.map((item) => ({ medication_name: item.name.trim(), ...(item.dosage ? { dosage_value: Number(item.dosage) } : {}), ...(item.unit.trim() ? { dosage_unit: item.unit.trim() } : {}) })),
      ...((waterMl || mealsCount || appetiteLevel != null) ? { nutrition: { ...(waterMl ? { water_ml: Number(waterMl) } : {}), ...(mealsCount ? { meals_count: Number(mealsCount) } : {}), ...(appetiteLevel != null ? { appetite_level: appetiteLevel } : {}) } } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };

    mutation.mutate(payload);
  };

  // =========================================================================
  // Render
  // =========================================================================
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* ── Static header: date square + title stay put while logging ── */}
      <View style={styles.topBar}>
          <View style={styles.titleRow}>
            <View style={[styles.dateBadge, { backgroundColor: dateColor }]}>
            <Text style={styles.dateBadgeDay}>
              {dateBadge.day}
            </Text>
            <Text style={styles.dateBadgeMonth}>
              {dateBadge.month}
            </Text>
          </View>
          <View style={styles.titleText}>
            <Text style={styles.title}>Daily Log</Text>
            <Text style={styles.subtitle}>
              How are you feeling today?
            </Text>
          </View>
        </View>
      </View>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onScroll={onTabScroll}
        scrollEventThrottle={16}
      >
        {/* ── Day navigation: no card, Prev left · Today middle · Next right ── */}
        <View style={styles.header}>
          <View style={styles.dateNav}>
            <View style={styles.dateEdge}>
              <Chip label="Prev" size="large" selected={false} onPress={() => setSelectedDate((value) => shiftDate(value, -1))} accessibilityLabel="Previous day" />
            </View>
            <View style={styles.dateMiddle}>
              <Chip label="Today" size="large" selected={selectedDate === dateToday()} color={dateColor} onPress={() => setSelectedDate(dateToday())} accessibilityLabel="Go to today" />
            </View>
            <View style={styles.dateEdgeRight}>
              <Chip label="Next" size="large" selected={false} onPress={() => setSelectedDate((value) => shiftDate(value, 1))} accessibilityLabel="Next day" />
            </View>
          </View>
        </View>

        {/* ── Feedback banner ── */}
        {feedback ? (
          <Card style={styles.bannerCard}>
            <View style={[styles.bannerDot, { backgroundColor: feedback.type === 'success' ? GV.cta : GV.danger }]} />
            <Text style={styles.bannerText}>{feedback.message}</Text>
            <Pressable onPress={() => setFeedback(null)} accessibilityLabel="Dismiss" style={styles.bannerDismissBtn} hitSlop={8}>
              <Text style={styles.bannerDismiss}>Dismiss</Text>
            </Pressable>
          </Card>
        ) : null}

        {/* ── Today's logged data (read-only summary, before first save) ── */}
        {!logged && selectedDate === dateToday() && todayWellbeing && (
          <Card style={styles.todayCard}>
            <View style={styles.todayGrid}>
              {todayWellbeing.overall_wellbeing != null && <View style={styles.todayItem}>
                <Text style={styles.todayLabel}>Mood</Text>
                <Text style={styles.todayValue}>
                  {MOOD_OPTIONS.find((m) => m.value === todayWellbeing.overall_wellbeing)?.label ??
                    `${todayWellbeing.overall_wellbeing}/5`}
                </Text>
              </View>}
              {todayWellbeing.energy_level != null && <View style={styles.todayItem}>
                <Text style={styles.todayLabel}>Energy</Text>
                <Text style={styles.todayValue}>{todayWellbeing.energy_level}/5</Text>
              </View>}
              {todayWellbeing.stress_level != null && <View style={styles.todayItem}>
                <Text style={styles.todayLabel}>Stress</Text>
                <Text style={styles.todayValue}>{todayWellbeing.stress_level}/5</Text>
              </View>}
              {latestSleep && (
                <View style={styles.todayItem}>
                  <Text style={styles.todayLabel}>Sleep</Text>
                  <Text style={styles.todayValue}>
                    {formatSleepDuration(latestSleep.duration_minutes)}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.todayNote}>
              Saving again updates this day's log when one exists.
            </Text>
          </Card>
        )}

        {/* ── Logged day: summary details + edit button, form hidden ── */}
        {logged && !editing && todayCheckinQuery.data ? (
          <Card style={styles.todayCard}>
            <View style={styles.todayGrid}>
              {todayCheckinQuery.data.overall_wellbeing != null && <View style={styles.todayItem}>
                <Text style={styles.todayLabel}>Mood</Text>
                <Text style={styles.todayValue}>
                  {MOOD_OPTIONS.find((m) => m.value === todayCheckinQuery.data!.overall_wellbeing)?.label ??
                    `${todayCheckinQuery.data!.overall_wellbeing}/5`}
                </Text>
              </View>}
              {todayCheckinQuery.data.energy_level != null && <View style={styles.todayItem}>
                <Text style={styles.todayLabel}>Energy</Text>
                <Text style={styles.todayValue}>{todayCheckinQuery.data.energy_level}/5</Text>
              </View>}
              {todayCheckinQuery.data.stress_level != null && <View style={styles.todayItem}>
                <Text style={styles.todayLabel}>Stress</Text>
                <Text style={styles.todayValue}>{todayCheckinQuery.data.stress_level}/5</Text>
              </View>}
              {todayCheckinQuery.data.sleep_duration_minutes != null && (
                <View style={styles.todayItem}>
                  <Text style={styles.todayLabel}>Sleep</Text>
                  <Text style={styles.todayValue}>
                    {formatSleepDuration(todayCheckinQuery.data.sleep_duration_minutes)}
                  </Text>
                </View>
              )}
            </View>
            <Pressable
              onPress={() => setEditing(true)}
              accessibilityRole="button"
              accessibilityLabel="Edit daily log"
              style={({ pressed }) => [styles.editBtn, { backgroundColor: dateColor }, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.editBtnText}>Edit</Text>
            </Pressable>
          </Card>
        ) : null}

        {/* ── Form error ── */}
        {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}

        {/* ── Priority log + mode switch live with the form ── */}
        {formOpen && (
        <>
        {/* ── Priority log: engine-driven shortcuts (Stress + Vitals fixed,
            the rest follows the user's chosen priorities) ── */}
        <Card style={styles.modeCard}>
          <Text style={styles.priorityTitle}>Priority log</Text>
          <Text style={styles.prioritySub}>Jump to what you focus on. Your engines decide.</Text>
          <View style={styles.priorityChips}>
            {priorityChips.map((chip) => (
              <Chip
                key={chip.key}
                label={chip.label}
                selected={chipDone(chip.key)}
                onPress={() => {
                  chip.prefill?.();
                  if (logMode !== chip.mode) setLogMode(chip.mode);
                  // Let the mode switch lay out before scrolling to it.
                  setTimeout(() => scrollToSection(chip.target), logMode !== chip.mode ? 150 : 0);
                }}
                accessibilityLabel={`Log ${chip.label}`}
              />
            ))}
          </View>
        </Card>

        {/* ── Log mode: Quick essentials vs full log ── */}
        <Card style={styles.modeCard}>
          <View
            style={styles.modeRow}
            accessibilityRole="radiogroup"
            accessibilityLabel="Log mode"
          >
            <Chip
              label="Quick"
              size="large"
              selected={logMode === 'quick'}
              onPress={() => setLogMode('quick')}
              accessibilityLabel="Quick essentials log"
            />
            <Chip
              label="Normal"
              size="large"
              selected={logMode === 'normal'}
              onPress={() => setLogMode('normal')}
              accessibilityLabel="Normal full log"
            />
          </View>
        </Card>
        </>
        )}

        {/* Quick mode: essentials only (all rows share the main form's
            state, so switching modes never loses input). */}
        {formOpen && logMode === 'quick' && (
          <Section index={0} category="wellbeing" title="Essentials" subtitle="Only what turns today green. Customize below." onLayout={recordSectionY('essentials')}>
            <View style={styles.fieldWrap}>
              {showEssential('mood') && (
                <>
                  <Text style={styles.fieldLabel}>Mood</Text>
                  <MoodSelector value={mood} onChange={setMood} />
                  <View style={styles.fieldSpacer} />
                </>
              )}
              {showEssential('water') && (
                <>
                  <Text style={styles.fieldLabel}>Water</Text>
                  <Slider
                    value={waterMl ? Number(waterMl) : 0}
                    onValueChange={(v) => setWaterMl(String(v))}
                    min={0}
                    max={3000}
                    step={50}
                    color={GV.cta}
                    showValue
                    displayValue={waterMl ? `${Number(waterMl).toLocaleString('en-US')} ml` : 'Not set'}
                  />
                  <OptionChips
                    options={WATER_QUICK}
                    value={waterMl}
                    onChange={setWaterMl}
                    color={GV.cta}
                    allowClear
                    label="Quick water amounts"
                  />
                  {errors.water ? <Text style={styles.fieldError}>{errors.water}</Text> : null}
                  <View style={styles.fieldSpacer} />
                </>
              )}
              {showEssential('sleep') && (
                <>
                  <Text style={styles.fieldLabel}>Sleep (minutes last night)</Text>
                  <SleepDurationPicker totalMinutes={sleepMinutes} onChange={setSleepMinutes} />
                  <View style={styles.fieldSpacer} />
                </>
              )}
              {showEssential('nutrition') && (
                <>
                  <Text style={styles.fieldLabel}>Meals</Text>
                  <QualitySelector
                    value={mealsCount ? Number(mealsCount) : null}
                    onChange={(v) => setMealsCount(String(v))}
                    labels={MEAL_LABELS}
                  />
                  <View style={styles.fieldSpacer} />
                  <Text style={styles.fieldLabel}>Appetite</Text>
                  <ScaleSelector value={appetiteLevel} onChange={setAppetiteLevel} labels={APPETITE_LABELS}
                    tone={TILE_TONES.nutrition[0]}
                    />
                  <View style={styles.fieldSpacer} />
                </>
              )}
              {showEssential('meds') && activeMeds && activeMeds.length > 0 && (
                <>
                  <Text style={styles.fieldLabel}>Medicines</Text>
                  {activeMeds.map((med) => {
                    const staged = medications.some((m) => m.name === med.name);
                    return (
                      <View key={med.medication_id} style={styles.essMedRow}>
                        <View style={styles.essMedInfo}>
                          <Text style={styles.essMedName} numberOfLines={1}>{med.name}</Text>
                          {(med.strength || med.strength_unit) ? (
                            <Text style={styles.essMedDetail} numberOfLines={1}>
                              {[med.strength, med.strength_unit].filter(Boolean).join(' ')}
                            </Text>
                          ) : null}
                        </View>
                        <Pressable
                          onPress={() => {
                            if (staged) {
                              unstageEssentialMed(med.name);
                            } else {
                              stageEssentialMed(
                                med.name,
                                med.dose_amount != null ? String(med.dose_amount) : '',
                                med.dose_unit ?? med.strength_unit ?? '',
                              );
                            }
                          }}
                          style={[styles.essMedToggle, staged ? styles.essMedToggleOn : styles.essMedToggleOff]}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: staged }}
                          accessibilityLabel={staged ? `${med.name} staged. Tap to remove` : `Stage ${med.name} dose`}
                          hitSlop={8}
                        >
                          <Text style={[styles.essMedToggleGlyph, staged ? styles.essMedToggleGlyphOn : styles.essMedToggleGlyphOff]}>
                            {staged ? '✓' : '✕'}
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })}
                  <View style={styles.fieldSpacer} />
                </>
              )}
              {/* First-time pick + edit-later: choose which rows belong here. */}
              <Pressable
                onPress={() => setCustomizing((v) => !v)}
                style={styles.essCustomizeBtn}
                accessibilityRole="button"
                accessibilityState={{ expanded: customizing }}
                accessibilityLabel={customizing ? 'Close essentials customization' : 'Customize essentials rows'}
                hitSlop={8}
              >
                <Text style={styles.essCustomizeText}>
                  {customizing ? 'Done customizing ▴' : 'Customize · choose rows ▾'}
                </Text>
              </Pressable>
              {customizing && (
                <View style={styles.essCustomizeList}>
                  {ESSENTIAL_ROWS.map((row) => {
                    const on = showEssential(row.key);
                    return (
                      <Pressable
                        key={row.key}
                        onPress={() => toggleEssentialRow(row.key)}
                        style={styles.essCustomizeRow}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${row.label} ${on ? 'shown' : 'hidden'}`}
                        hitSlop={6}
                      >
                        <View style={[styles.essCheck, on && styles.essCheckOn]}>
                          {on ? <Text style={styles.essCheckGlyph}>✓</Text> : null}
                        </View>
                        <Text style={styles.essCheckLabel}>{row.label}</Text>
                      </Pressable>
                    );
                  })}
                  <Text style={styles.essCustomizeHint}>
                    Your picks are remembered on this device — edit them here anytime.
                  </Text>
                </View>
              )}
            </View>
          </Section>
        )}

        {formOpen && logMode === 'normal' && (
        <>
        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* SLEEP                                                             */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <Section index={0} category="sleep" title="Sleep" subtitle="How much did you sleep last night?" onLayout={recordSectionY('sleep')}>
          <View style={styles.fieldWrap}>
            <Text style={styles.fieldLabel}>Duration</Text>
            <SleepDurationPicker
              totalMinutes={sleepMinutes}
              onChange={setSleepMinutes}
            />

            <View style={styles.fieldSpacer} />
            <Text style={styles.fieldLabel}>Bedtime (optional)</Text>
            <Input
              value={bedtime}
              onChangeText={setBedtime}
              placeholder="22:30"
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
            />
            {errors.bedtime ? <Text style={styles.fieldError}>{errors.bedtime}</Text> : null}
            <View style={styles.fieldSpacer} />
            <Text style={styles.fieldLabel}>Wake time (optional)</Text>
            <Input
              value={wakeTime}
              onChangeText={setWakeTime}
              placeholder="06:30"
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
            />
            {errors.wakeTime ? <Text style={styles.fieldError}>{errors.wakeTime}</Text> : null}
            {parseClockTime(bedtime.trim()) !== null && parseClockTime(wakeTime.trim()) !== null ? (
              <Pressable
                onPress={() => {
                  const mins = durationFromBedWake(bedtime.trim(), wakeTime.trim());
                  if (mins != null) setSleepMinutes(mins);
                }}
                accessibilityRole="button"
                accessibilityLabel="Fill duration from bedtime and wake time"
                hitSlop={8}
              >
                <Text style={styles.qualityHint}>
                  {`Bedtime to wake is ${formatSleepDuration(durationFromBedWake(bedtime.trim(), wakeTime.trim()) ?? 0)} — tap to use it as the duration.`}
                </Text>
              </Pressable>
            ) : null}

            <View style={styles.fieldSpacer} />
            <Text style={styles.fieldLabel}>Quality</Text>
            <QualitySelector
              value={sleepQuality}
              onChange={setSleepQuality}
              labels={SLEEP_QUALITY_LABELS}
              tone={TILE_TONES.sleep[0]}
            />
            {sleepQuality != null && (
              <Text style={styles.qualityHint}>
                {SLEEP_QUALITY_LABELS[sleepQuality]}
              </Text>
            )}

            <View style={styles.fieldSpacer} />
            <Text style={styles.fieldLabel}>Wake-ups during the night</Text>
            <View style={styles.stepperRow}>
              <Pressable
                onPress={() => setAwakenings((v) => (v == null || v <= 0 ? null : v - 1))}
                style={styles.stepperBtn}
                accessibilityLabel="Fewer wake-ups"
              >
                <Text style={styles.stepperBtnText}>−</Text>
              </Pressable>
              <View style={styles.stepperDisplay}>
                <Text style={styles.stepperValue}>
                  {awakenings == null ? 'Not set' : awakenings === 0 ? 'None' : `${awakenings}×`}
                </Text>
              </View>
              <Pressable
                onPress={() => setAwakenings((v) => Math.min(6, (v ?? -1) + 1))}
                style={styles.stepperBtn}
                accessibilityLabel="More wake-ups"
              >
                <Text style={styles.stepperBtnText}>+</Text>
              </Pressable>
            </View>
            {errors.sleepAwakenings ? <Text style={styles.fieldError}>{errors.sleepAwakenings}</Text> : null}
          </View>
        </Section>

        <Divider />

        <Section index={1} category="symptomsPain" title="Symptoms & pain" subtitle="Record symptoms and pain only when present.">
          <View style={styles.fieldWrap}>
            <Text style={styles.fieldLabel}>Pain entries</Text>
            {pain.map((item) => (
              <View
                key={item.id}
                style={styles.entryBlock}
              >
                <Text style={styles.fieldLabel}>Where does it hurt?</Text>
                <OptionChips
                  options={BODY_REGION_OPTIONS}
                  value={item.structureId}
                  onChange={(value) => setPain((items) => items.map((painItem) => painItem.id === item.id ? { ...painItem, structureId: value } : painItem))}
                  color={GV.cta}
                  allowClear
                  label="Pain body region"
                />
                <Input label="Or describe the spot" value={item.structureId} onChangeText={(value) => setPain((items) => items.map((painItem) => painItem.id === item.id ? { ...painItem, structureId: value } : painItem))} placeholder="e.g. RIGHT_KNEE" />
                <Input label="Body location ID (optional)" value={item.bodyLocationId} onChangeText={(value) => setPain((items) => items.map((painItem) => painItem.id === item.id ? { ...painItem, bodyLocationId: value } : painItem))} error={errors[`pain-location-${item.id}`]} />
                <Text style={styles.fieldLabel}>Pain severity (1-10)</Text>
                <View style={styles.severityRow}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => setPain((items) => items.map((painItem) => painItem.id === item.id ? { ...painItem, severity: String(n) } : painItem))}
                      style={[styles.severityDot, item.severity === String(n) && styles.severityDotSelected]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: item.severity === String(n) }}
                      accessibilityLabel={`Pain severity ${n} out of 10`}
                    >
                      <Text style={[styles.severityDotText, item.severity === String(n) && styles.severityDotTextSelected]}>
                        {n}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {errors[`pain-${item.id}`] ? <Text style={styles.fieldError}>{errors[`pain-${item.id}`]}</Text> : null}
                <Text style={styles.fieldLabel}>Pain type</Text>
                <OptionChips
                  options={PAIN_TYPE_OPTIONS}
                  value={item.painType}
                  onChange={(value) => setPain((items) => items.map((painItem) => painItem.id === item.id ? { ...painItem, painType: value } : painItem))}
                  color={GV.cta}
                  allowClear
                  label="Pain type"
                />
                <Input label="Or describe your own" value={item.painType} onChangeText={(value) => setPain((items) => items.map((painItem) => painItem.id === item.id ? { ...painItem, painType: value } : painItem))} placeholder="Sharp, dull, throbbing" />
                <Pressable onPress={() => setPain((items) => items.filter((painItem) => painItem.id !== item.id))}><Text style={styles.removeBtn}>Remove pain</Text></Pressable>
              </View>
            ))}
            <Pressable onPress={addPain} style={styles.addBtn}><Text style={styles.addBtnText}>+ Add pain</Text></Pressable>
          </View>
        </Section>

        <Divider />

        <Section index={2} category="symptomsPain" title="Body map" subtitle="Log pain on a real anatomical structure. Saved to your body state and timeline.">
          <View style={styles.fieldWrap}>
            <Text style={styles.fieldLabel}>Where does it hurt?</Text>
            <View style={styles.chipGrid}>
              {bodySites.map((site) => {
                const selected = bodySite === site.structure_id;
                return (
                  <Pressable
                    key={site.structure_id}
                    onPress={() => setBodySite(selected ? '' : site.structure_id)}
                    style={[styles.chip, selected && styles.chipSelected]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${site.display_name}${selected ? ', selected' : ''}`}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {site.display_name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {bodySite ? (
              <>
                <View style={styles.fieldSpacer} />
                <DialInput
                  value={bodySeverity}
                  onChange={setBodySeverity}
                  min={0}
                  max={10}
                  step={1}
                  unit="/10"
                  label="Pain severity"
                  color={GV.cta}
                  accessibilityLabel="Body map pain severity"
                />
                <Input
                  label="Note for your doctor (optional)"
                  value={bodyNote}
                  onChangeText={setBodyNote}
                  placeholder="What were you doing when it started…"
                  multiline
                  autoCapitalize="sentences"
                  maxLength={500}
                />
              </>
            ) : null}
            {bodyError ? <Text style={styles.fieldError}>{bodyError}</Text> : null}
            <Button
              title={bodySaving ? 'Logging…' : 'Log body pain'}
              onPress={() => void saveBodyPain()}
              fullWidth
              loading={bodySaving}
              disabled={bodySaving}
              style={styles.saveButton}
            />
          </View>
        </Section>

        <Divider />

        <Section index={2} category="activity" title="Activity" subtitle="Exercise type, duration, and calories." onLayout={recordSectionY('activity')}>
          <View style={styles.fieldWrap}>
            {activities.map((item) => (
              <View
                key={item.id}
                style={styles.entryBlock}
              >
                <Text style={styles.fieldLabel}>Activity type</Text>
                <OptionChips
                  options={ACTIVITY_OPTIONS}
                  value={item.activityType}
                  onChange={(value) => setActivities((items) => items.map((activity) => activity.id === item.id ? { ...activity, activityType: value } : activity))}
                  color={GV.cta}
                  label="Activity type"
                />
                <Input label="Or type your own" value={item.activityType} onChangeText={(value) => setActivities((items) => items.map((activity) => activity.id === item.id ? { ...activity, activityType: value } : activity))} placeholder="Walking, yoga, running" error={errors[`activity-${item.id}`]} />
                <Text style={styles.fieldLabel}>Duration (minutes)</Text>
                <OptionChips
                  options={DURATION_QUICK}
                  value={item.duration}
                  onChange={(value) => setActivities((items) => items.map((activity) => activity.id === item.id ? { ...activity, duration: value } : activity))}
                  color={GV.cta}
                  allowClear
                  label="Duration minutes"
                />
                <Input label="Or enter exact minutes" value={item.duration} onChangeText={(value) => setActivities((items) => items.map((activity) => activity.id === item.id ? { ...activity, duration: value } : activity))} keyboardType="number-pad" />
                <Input label="Calories (optional)" value={item.calories} onChangeText={(value) => setActivities((items) => items.map((activity) => activity.id === item.id ? { ...activity, calories: value } : activity))} keyboardType="decimal-pad" />
                <Input label="Distance in km (optional)" value={item.distance} onChangeText={(value) => setActivities((items) => items.map((activity) => activity.id === item.id ? { ...activity, distance: value } : activity))} keyboardType="decimal-pad" />
                <Pressable onPress={() => setActivities((items) => items.filter((activity) => activity.id !== item.id))}><Text style={styles.removeBtn}>Remove activity</Text></Pressable>
              </View>
            ))}
            <Pressable onPress={addActivity} style={styles.addBtn}><Text style={styles.addBtnText}>+ Add activity</Text></Pressable>
          </View>
        </Section>

        <Divider />

        <Section index={3} category="nutrition" title="Hydration & nutrition" subtitle="Use the fields recorded by HealthGraph." onLayout={recordSectionY('nutrition')}>
          <View style={styles.fieldWrap}>
            <Text style={styles.fieldLabel}>Water</Text>
            <Slider
              value={waterMl ? Number(waterMl) : 0}
              onValueChange={(v) => setWaterMl(String(v))}
              min={0}
              max={3000}
              step={50}
              color={GV.cta}
              showValue
              displayValue={waterMl ? `${Number(waterMl).toLocaleString('en-US')} ml` : 'Not set'}
            />
            <OptionChips
              options={WATER_QUICK}
              value={waterMl}
              onChange={setWaterMl}
              color={GV.cta}
              allowClear
              label="Quick water amounts"
            />
            {errors.water ? <Text style={styles.fieldError}>{errors.water}</Text> : null}
            <View style={styles.fieldSpacer} />
            <Text style={styles.fieldLabel}>Meals</Text>
            <QualitySelector
              value={mealsCount ? Number(mealsCount) : null}
              onChange={(v) => setMealsCount(String(v))}
              labels={MEAL_LABELS}
            />
            {mealsCount ? (
              <Text style={styles.qualityHint}>{MEAL_LABELS[Number(mealsCount)]}</Text>
            ) : null}
            {errors.meals ? <Text style={styles.fieldError}>{errors.meals}</Text> : null}
            <View style={styles.fieldSpacer} />
            <Text style={styles.fieldLabel}>Appetite</Text>
            <ScaleSelector value={appetiteLevel} onChange={setAppetiteLevel} labels={APPETITE_LABELS} tone={TILE_TONES.nutrition[0]} />
            <View style={styles.fieldSpacer} />
            <Pressable
              onPress={() => navigation.navigate('FoodScan')}
              accessibilityRole="button"
              accessibilityLabel="Scan food with the camera"
              style={({ pressed }) => [styles.scanFoodCta, pressed && { opacity: 0.75 }]}
            >
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M4 8.5h3l1.8-2.5h6.4L17 8.5h3v10H4v-10Z"
                  stroke="#FFFFFF"
                  strokeWidth={1.9}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <Circle
                  cx={12}
                  cy={13.2}
                  r={3.1}
                  stroke="#FFFFFF"
                  strokeWidth={1.9}
                />
              </Svg>
              <Text style={styles.scanFoodCtaText}>Scan food</Text>
            </Pressable>
          </View>
        </Section>

        <Divider />

        <Section index={6} category="vitals" title="Vitals" subtitle="Pick a vital. The right device-style input appears." onLayout={recordSectionY('vitals')}>
          <View style={styles.fieldWrap}>
            {conceptsQuery.isError ? (
              <Text style={styles.dialHint}>Options need a connection. Typing still works.</Text>
            ) : null}
            {vitals.map((item) => {
              const selectedConcept = concepts.find((c) => c.id === item.conceptId);
              const presetKind = vitalPresetFor(selectedConcept);
              const preset = presetKind ? VITAL_DIALS[presetKind] : null;
              const dialValue = item.value.trim() === '' ? null : Number(item.value);
              return (
                <View
                  key={item.id}
                  style={styles.entryBlock}
                >
                  {selectedConcept ? (
                    <View style={styles.selectedVitalRow}>
                      <View style={styles.selectedVitalInfo}>
                        <Text style={styles.selectedVitalName}>{selectedConcept.short_name || selectedConcept.display_name}</Text>
                        <Text style={styles.selectedVitalSub}>{selectedConcept.display_name}</Text>
                      </View>
                      <Pressable onPress={() => setVitals((items) => items.map((v) => v.id === item.id ? { ...v, conceptId: '' } : v))}>
                        <Text style={styles.removeBtn}>Change</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <>
                      <Input
                        label="Search vitals"
                        value={vitalSearch}
                        onChangeText={setVitalSearch}
                        placeholder="Heart Rate, Blood Glucose…"
                      />
                      <View style={styles.chipGrid}>
                        {filteredVitalConcepts.slice(0, 20).map((concept) => (
                          <Pressable
                            key={concept.id}
                            onPress={() => setVitals((items) => items.map((v) => v.id === item.id ? { ...v, conceptId: concept.id, unit: v.unit || autoUnitFor(concept) } : v))}
                            style={[styles.chip, item.conceptId === concept.id && styles.chipSelected]}
                          >
                            <Text style={[styles.chipText, item.conceptId === concept.id && styles.chipTextSelected]}>
                              {concept.short_name || concept.display_name}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </>
                  )}
                  {preset ? (
                    <>
                      <DialInput
                        value={dialValue != null && Number.isFinite(dialValue) ? dialValue : null}
                        onChange={(v) => {
                          const decimals = preset.step < 1 ? 1 : 0;
                          setVitals((items) => items.map((vital) => vital.id === item.id ? { ...vital, value: v.toFixed(decimals), unit: preset.unit } : vital));
                        }}
                        min={preset.min}
                        max={preset.max}
                        step={preset.step}
                        unit={preset.unit}
                        label={preset.label}
                        color={GV.cta}
                        accessibilityLabel={`${preset.label} dial`}
                      />
                      <Input label="Or type the exact value" value={item.value} onChangeText={(value) => setVitals((items) => items.map((vital) => vital.id === item.id ? { ...vital, value } : vital))} keyboardType="decimal-pad" />
                    </>
                  ) : (
                    <>
                      <View style={styles.inlineFields}>
                        <Input label="Value (optional)" value={item.value} onChangeText={(value) => setVitals((items) => items.map((vital) => vital.id === item.id ? { ...vital, value } : vital))} keyboardType="decimal-pad" style={styles.inlineInput} />
                        <Input label="Unit (optional)" value={item.unit} onChangeText={(value) => setVitals((items) => items.map((vital) => vital.id === item.id ? { ...vital, unit: value } : vital))} placeholder="bpm, mmHg" style={styles.inlineInput} />
                      </View>
                      <Text style={styles.fieldLabel}>Unit</Text>
                      <OptionChips
                        options={VITAL_UNIT_OPTIONS}
                        value={item.unit}
                        onChange={(value) => setVitals((items) => items.map((vital) => vital.id === item.id ? { ...vital, unit: value } : vital))}
                        color={GV.cta}
                        allowClear
                        label="Vital unit"
                      />
                    </>
                  )}
                  {errors[`vital-${item.id}`] ? <Text style={styles.fieldError}>{errors[`vital-${item.id}`]}</Text> : null}
                  <Pressable onPress={() => setVitals((items) => items.filter((vital) => vital.id !== item.id))}><Text style={styles.removeBtn}>Remove vital</Text></Pressable>
                </View>
              );
            })}
            <Pressable onPress={addVital} style={styles.addBtn}><Text style={styles.addBtnText}>+ Add vital</Text></Pressable>
            <BpHistoryCard />
          </View>
        </Section>

        <Divider />

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* HOW YOU FEEL                                                     */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <Section
          index={7}
          category="wellbeing"
          title="How you feel"
          subtitle="Rate your mood, energy, and stress today."
          onLayout={recordSectionY('feel')}
        >
          <View style={styles.fieldWrap}>
            <Text style={styles.fieldLabel}>Mood</Text>
            <MoodSelector value={mood} onChange={setMood} />


            <View style={styles.fieldSpacer} />
            <Text style={styles.fieldLabel}>Energy</Text>
            <ScaleSelector value={energy} onChange={setEnergy} labels={ENERGY_LABELS}
              tone={TILE_TONES.wellbeing[0]}
              />

            <View style={styles.fieldSpacer} />
            <Text style={styles.fieldLabel}>Stress</Text>
            <ScaleSelector value={stress} onChange={setStress} labels={STRESS_LABELS} />
          </View>
        </Section>

        <Divider />

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* SYMPTOMS                                                         */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <Section
          index={8}
          category="symptoms"
          title="Symptoms"
          subtitle="Select symptoms and rate their severity."
        >
          {symptoms.map((item) => {
            const selectedSymptom = symptomConcepts.find((c) => c.id === item.conceptId);
            const showFeverDial = isFeverConcept(selectedSymptom);
            return (
            <View
              key={item.id}
              style={styles.entryBlock}
            >
              <View style={styles.symptomHeader}>
                <Text style={styles.symptomIndex}>Symptom</Text>
                <Pressable
                  onPress={() => removeSymptom(item.id)}
                  accessibilityLabel="Remove symptom"
                >
                  <Text style={styles.removeBtn}>Remove</Text>
                </Pressable>
              </View>

              {symptomConcepts.length > 0 ? (
                <>
                  <Input
                    label="Search symptoms"
                    value={symptomSearch}
                    onChangeText={setSymptomSearch}
                    placeholder="Type to search…"
                  />
                  <View style={styles.chipGrid}>
                    {filteredSymptomConcepts.slice(0, 20).map((concept) => (
                      <Pressable
                        key={concept.id}
                        onPress={() =>
                          updateSymptom(item.id, { conceptId: concept.id })
                        }
                        style={[
                          styles.chip,
                          item.conceptId === concept.id && styles.chipSelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            item.conceptId === concept.id && styles.chipTextSelected,
                          ]}
                        >
                          {concept.short_name || concept.display_name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : (
                <Text style={styles.muted}>
                  No symptom concepts available.
                </Text>
              )}

              {errors[`symptom-${item.id}`] ? (
                <Text style={styles.fieldError}>
                  {errors[`symptom-${item.id}`]}
                </Text>
              ) : null}

              <View style={styles.fieldSpacer} />
              <Text style={styles.fieldLabel}>Severity (1–10)</Text>
              <View style={styles.severityRow}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => updateSymptom(item.id, { severity: String(n) })}
                    style={[
                      styles.severityDot,
                      item.severity === String(n) && styles.severityDotSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.severityDotText,
                        item.severity === String(n) && styles.severityDotTextSelected,
                      ]}
                    >
                      {n}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {errors[`symptom-sev-${item.id}`] ? (
                <Text style={styles.fieldError}>
                  {errors[`symptom-sev-${item.id}`]}
                </Text>
              ) : null}

              <View style={styles.fieldSpacer} />
              <Text style={styles.fieldLabel}>Duration (minutes, optional)</Text>
              <OptionChips
                options={DURATION_QUICK}
                value={item.duration}
                onChange={(duration) => updateSymptom(item.id, { duration })}
                color={GV.cta}
                allowClear
                label="Symptom duration minutes"
              />
              <Input
                label="Or enter exact minutes"
                value={item.duration}
                onChangeText={(duration) =>
                  updateSymptom(item.id, { duration })
                }
                keyboardType="number-pad"
                error={errors[`symptom-dur-${item.id}`]}
              />

              <Input
                label="Notes (optional)"
                value={item.notes}
                onChangeText={(text) => updateSymptom(item.id, { notes: text })}
                multiline
                autoCapitalize="sentences"
                placeholder="Any additional context…"
              />
              {showFeverDial ? (
                <>
                  <View style={styles.fieldSpacer} />
                  <FeverTempDial
                    notes={item.notes}
                    onNotes={(text) => updateSymptom(item.id, { notes: text })}
                    color={GV.cta}
                  />
                </>
              ) : null}
            </View>
            );
          })}

          <Pressable
            onPress={addSymptom}
            style={styles.addBtn}
            disabled={mutation.isPending || !symptomConcepts.length}
          >
            <Text style={styles.addBtnText}>+ Add symptom</Text>
          </Pressable>
        </Section>

        <Divider />

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* NOTES                                                            */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <Section
          index={9}
          category="notes"
          title="Notes"
          subtitle="Optional. Anything else you want to record."
        >
          <View style={styles.fieldWrap}>
            <Input
              value={notes}
              onChangeText={setNotes}
              placeholder="Write a note…"
              multiline
              autoCapitalize="sentences"
              disabled={mutation.isPending}
              error={errors.notes}
              hint={`${notes.length}/4000`}
            />
          </View>
        </Section>
        </>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* SAVE                                                             */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {formOpen && (
        <Button           title={mutation.isPending ? 'Saving…' : editingGroupId ? "Update today's log" : "Save today's log"}
          onPress={logMode === 'quick' ? saveEssentials : save}
          fullWidth
          loading={mutation.isPending}
          disabled={conceptsQuery.isLoading || mutation.isPending}
          style={styles.saveButton}
        />
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* RECENT HISTORY (full mode only — quick stays minimal)            */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {logMode === 'normal' && recentLogs.length > 0 && (
          <>
            <Divider />
            <Section animate={false} title="Recent history" subtitle="Your past daily logs.">
              {recentLogs.slice(0, 14).map((log) => (
                <View key={log.log_date} style={styles.historyRow}>
                  <View style={styles.historyLeft}>
                    <Text style={styles.historyDate}>
                      {formatRelativeDate(log.log_date)}
                    </Text>
                    <Text style={styles.historyCats}>
                      {log.categories
                        .map((c) =>
                          c
                            .replaceAll('_', ' ')
                            .toLowerCase()
                            .replace(/\b\w/g, (l) => l.toUpperCase()),
                        )
                        .join(' · ')}
                    </Text>
                  </View>
                  <Text style={styles.historyCount}>
                    {log.event_count} {log.event_count === 1 ? 'event' : 'events'}
                  </Text>
                </View>
              ))}
            </Section>
          </>
        )}

        {metrics.isError ? (
          <Text style={styles.globalError}>
            Daily data is temporarily unavailable. Pull down to retry.
          </Text>
        ) : null}

        {/* Spacer */}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Celebration overlay — one-shot delight on save */}
      <LogCelebration visible={celebrate} onDone={() => setCelebrate(false)} />
    </SafeAreaView>
  );
}

// ===========================================================================
// Styles
// ===========================================================================

const NAVY = '#080A11';
const TILE_BG = '#2A3049';
const HAIRLINE_ON_NAVY = 'rgba(255, 255, 255, 0.12)';
const EDGE_ON_NAVY = 'rgba(255, 255, 255, 0.25)';
// Date solids — skill-family muted fills, one per day, white text safe.
const DATE_SOLIDS: readonly string[] = [
  '#57507A',
  '#96684A',
  '#5C6E7C',
  '#6E7F4E',
  '#56837B',
  '#66666F',
  '#5A6078',
  '#7C6272',
  '#8A4A55',
  '#8A7A5C',
  '#527A6E',
  '#3A3F55',
  '#6B4A3A',
  '#37605A',
];

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NAVY,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 40,
    gap: 12,
  },
  header: {
    marginBottom: 12,
  },
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateEdge: {
    flex: 1,
    alignItems: 'flex-start',
  },
  dateEdgeRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  dateMiddle: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    fontFamily: FONT.semi,
    fontSize: 30,
    lineHeight: 37,
    letterSpacing: -0.3,
    color: '#FFFFFF',
    textAlign: 'left',
  },
  subtitle: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'left',
  },
  topBar: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  titleText: {
    flex: 1,
    gap: 2,
  },
  dateBadge: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: GV.cta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateBadgeDay: {
    ...TYPE.title,
    color: '#FFFFFF',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  dateBadgeMonth: {
    ...TYPE.caption,
    color: '#FFFFFF',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  bannerCard: {
    backgroundColor: TILE_BG,
    borderWidth: 1,
    borderColor: HAIRLINE_ON_NAVY,
    borderRadius: 8,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bannerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bannerText: {
    ...TYPE.body,
    color: '#FFFFFF',
    flex: 1,
  },
  bannerDismissBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  bannerDismiss: {
    ...TYPE.caption,
    color: GV.fog,
  },
  todayCard: {
    backgroundColor: TILE_BG,
    borderWidth: 1,
    borderColor: HAIRLINE_ON_NAVY,
    borderRadius: 8,
    padding: 16,
  },
  todaySummaryTitle: {
    ...TYPE.title,
    color: '#FFFFFF',
    marginBottom: 8,
  },
  todayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  todayItem: {
    minWidth: 72,
    flexGrow: 1,
  },
  todayLabel: {
    ...TYPE.caption,
    color: GV.fog,
  },
  todayValue: {
    ...TYPE.button,
    color: '#FFFFFF',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  todayNote: {
    ...TYPE.caption,
    color: GV.fog,
    marginTop: 8,
  },
  editBtn: {
    minHeight: 52,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  editBtnText: {
    fontFamily: FONT.semi,
    fontSize: 16,
    lineHeight: 22,
    color: '#FFFFFF',
  },
  formError: {
    ...TYPE.caption,
    color: GV.danger,
    textAlign: 'center',
    marginBottom: 4,
  },
  modeCard: {
    backgroundColor: TILE_BG,
    borderWidth: 1,
    borderColor: HAIRLINE_ON_NAVY,
    borderRadius: 8,
    padding: 16,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  section: {
    marginBottom: 24,
  },
  sectionCard: {
    backgroundColor: TILE_BG,
    borderWidth: 1,
    borderColor: HAIRLINE_ON_NAVY,
    borderRadius: 8,
    padding: 16,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sectionHeadText: {
    flex: 1,
    gap: 2,
  },
  sectionHeadTitle: {
    ...TYPE.title,
    fontSize: 17,
    color: '#FFFFFF',
  },
  sectionHeadSub: {
    ...TYPE.caption,
    color: GV.fog,
  },
  sectionBody: {
    marginTop: 12,
    gap: 8,
  },
  divider: {
    height: 1,
    backgroundColor: HAIRLINE_ON_NAVY,
    marginVertical: 8,
  },
  fieldWrap: {
    gap: 8,
  },
  fieldLabel: {
    ...TYPE.caption,
    color: GV.fog,
    marginBottom: 4,
  },
  fieldSpacer: {
    height: 16,
  },
  fieldError: {
    ...TYPE.caption,
    color: GV.danger,
    marginTop: 4,
  },
  entryBlock: {
    gap: 8,
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE_ON_NAVY,
  },
  inlineFields: {
    flexDirection: 'row',
    gap: 8,
  },
  inlineInput: {
    flex: 1,
  },
  selectedVitalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 8,
    minHeight: 44,
  },
  selectedVitalInfo: {
    flex: 1,
  },
  selectedVitalName: {
    ...TYPE.button,
    color: '#FFFFFF',
  },
  selectedVitalSub: {
    ...TYPE.caption,
    color: GV.fog,
    marginTop: 2,
  },
  moodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  moodPill: {
    flex: 1,
    minWidth: 56,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: SPACE.rPill,
    borderWidth: 1,
    borderColor: EDGE_ON_NAVY,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodPillSelected: {
    backgroundColor: GV.cta,
    borderColor: GV.cta,
  },
  moodPillText: {
    ...TYPE.chip,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  moodPillTextSelected: {
    color: '#FFFFFF',
  },
  scaleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  scaleDot: {
    width: 44,
    height: 44,
    borderRadius: SPACE.rPill,
    borderWidth: 1,
    borderColor: EDGE_ON_NAVY,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaleDotSelected: {
    backgroundColor: GV.cta,
    borderColor: GV.cta,
  },

  scaleDotText: {
    ...TYPE.button,
    color: '#FFFFFF',
  },
  scaleDotTextSelected: {
    color: '#FFFFFF',
  },
  scaleLabel: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    marginTop: 4,
  },
  scaleLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  scaleHint: {
    ...TYPE.caption,
    color: GV.fog,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepperBtn: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: EDGE_ON_NAVY,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: {
    ...TYPE.button,
    color: '#FFFFFF',
  },
  stepperDisplay: {
    flex: 1,
    alignItems: 'center',
  },
  stepperValue: {
    ...TYPE.title,
    color: '#FFFFFF',
  },
  qualityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  qualityDot: {
    width: 44,
    height: 44,
    borderRadius: SPACE.rPill,
    borderWidth: 1,
    borderColor: EDGE_ON_NAVY,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qualityDotSelected: {
    backgroundColor: GV.cta,
    borderColor: GV.cta,
  },
  qualityDotText: {
    ...TYPE.button,
    color: '#FFFFFF',
  },
  qualityDotTextSelected: {
    color: '#FFFFFF',
  },
  qualityHint: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    marginTop: 4,
  },
  symptomHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
    marginBottom: 8,
  },
  symptomIndex: {
    ...TYPE.button,
    color: '#FFFFFF',
  },
  removeBtn: {
    ...TYPE.caption,
    color: GV.fog,
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: EDGE_ON_NAVY,
    borderRadius: SPACE.rPill,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: GV.cta,
    borderColor: GV.cta,
  },
  chipText: {
    ...TYPE.chip,
    color: '#FFFFFF',
  },
  chipTextSelected: {
    color: '#FFFFFF',
  },
  optRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  optChip: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: SPACE.rPill,
    borderWidth: 1,
    borderColor: EDGE_ON_NAVY,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optChipSelected: {
    backgroundColor: GV.cta,
    borderColor: GV.cta,
  },
  optChipText: {
    ...TYPE.chip,
    color: '#FFFFFF',
  },
  optChipTextSelected: {
    color: '#FFFFFF',
  },
  severityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  severityDot: {
    width: 44,
    height: 44,
    borderRadius: SPACE.rPill,
    borderWidth: 1,
    borderColor: EDGE_ON_NAVY,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  severityDotSelected: {
    backgroundColor: GV.cta,
    borderColor: GV.cta,
  },
  severityDotText: {
    ...TYPE.chip,
    color: '#FFFFFF',
  },
  severityDotTextSelected: {
    color: '#FFFFFF',
  },
  addBtn: {
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: EDGE_ON_NAVY,
    borderRadius: SPACE.rPill,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  addBtnText: {
    ...TYPE.button,
    color: '#FFFFFF',
  },
  // Priority log chips live in a wrapping row inside the Priority card.
  priorityTitle: {
    ...TYPE.title,
    fontSize: 17,
    color: '#FFFFFF',
  },
  prioritySub: {
    ...TYPE.caption,
    color: GV.fog,
    marginTop: 2,
    marginBottom: 8,
  },
  priorityChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  scanFoodCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: SPACE.rPill,
    backgroundColor: GV.cta,
    marginTop: 8,
  },
  scanFoodCtaText: {
    ...TYPE.button,
    color: '#FFFFFF',
  },
  unitToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
    minHeight: 44,
  },
  unitToggle: {
    flexDirection: 'row',
    gap: 8,
  },
  unitToggleBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: EDGE_ON_NAVY,
    borderRadius: SPACE.rPill,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitToggleBtnSelected: {
    backgroundColor: GV.cta,
    borderColor: GV.cta,
  },
  unitToggleText: {
    ...TYPE.chip,
    color: '#FFFFFF',
  },
  unitToggleTextSelected: {
    color: '#FFFFFF',
  },
  dialHint: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    marginTop: 8,
  },
  bpCard: {
    backgroundColor: '#10141F',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 16,
    padding: 14,
    gap: 4,
    marginTop: 12,
  },
  bpLatest: {
    ...TYPE.button,
    fontSize: 17,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  bpSub: {
    ...TYPE.caption,
    color: GV.fog,
    fontVariant: ['tabular-nums'],
  },
  essMedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE_ON_NAVY,
  },
  essMedInfo: {
    flex: 1,
  },
  essMedName: {
    ...TYPE.button,
    color: '#FFFFFF',
  },
  essMedDetail: {
    ...TYPE.caption,
    color: GV.fog,
  },
  essMedToggle: {
    width: 44,
    height: 44,
    borderRadius: SPACE.rPill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  essMedToggleOn: {
    backgroundColor: GV.cta,
    borderColor: GV.cta,
  },
  essMedToggleOff: {
    backgroundColor: 'transparent',
    borderColor: EDGE_ON_NAVY,
  },
  essMedToggleGlyph: {
    ...TYPE.chip,
    color: '#FFFFFF',
  },
  essMedToggleGlyphOn: {
    color: '#FFFFFF',
  },
  essMedToggleGlyphOff: {
    color: '#FFFFFF',
  },
  essCustomizeBtn: {
    alignSelf: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  essCustomizeText: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
  },
  essCustomizeList: {
    gap: 8,
    marginTop: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  essCustomizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingVertical: 4,
  },
  essCheck: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: EDGE_ON_NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  essCheckOn: {
    backgroundColor: GV.cta,
    borderColor: GV.cta,
  },
  essCheckGlyph: {
    color: '#FFFFFF',
    ...TYPE.chip,
  },
  essCheckLabel: {
    ...TYPE.body,
    color: '#FFFFFF',
  },
  essCustomizeHint: {
    ...TYPE.caption,
    color: GV.fog,
    marginTop: 4,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE_ON_NAVY,
  },
  historyLeft: {
    flex: 1,
  },
  historyDate: {
    ...TYPE.button,
    color: '#FFFFFF',
  },
  historyCats: {
    ...TYPE.caption,
    color: GV.fog,
    marginTop: 2,
  },
  historyCount: {
    ...TYPE.chip,
    color: GV.fog,
    marginLeft: 8,
  },
  muted: {
    ...TYPE.caption,
    color: GV.fog,
  },
  globalError: {
    ...TYPE.caption,
    color: GV.danger,
    textAlign: 'center',
    marginTop: 12,
  },
  saveButton: {
    marginTop: 8,
    marginBottom: 8,
  },
});

