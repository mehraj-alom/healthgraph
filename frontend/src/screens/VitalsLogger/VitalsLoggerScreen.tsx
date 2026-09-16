import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import Animated, { FadeInDown, FadeInUp, FadeOut, Layout } from 'react-native-reanimated';
import { Button, AmbientBackground, DialInput, Input, LogCelebration, Slider, feverTint, severityTint } from '@/components';
import { useHideTabBarOnScroll } from '@/components/tabBarVisibility';
import { useReducedMotion } from '@/theme';
import { COLORS, BORDER_RADIUS, SPACING, TYPOGRAPHY, SHADOWS } from '@/constants';
import { api } from '@/services/api';
import { getCachedPatientId } from '@/services/patientIdentity';
import { requestDataRefresh } from '@/services/dataRefresh';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { useActiveMedications } from '@/hooks/useMedications';
import {
  getDailyLogDetail as dbGetDailyLogDetail,
  upsertDailyLog as dbUpsertDailyLog,
  hydrateDailyLog as dbHydrateDailyLog,
  getPendingMutationId as dbGetPendingMutationId,
  reconcileDailyLogGroupId as dbReconcileDailyLogGroupId,
} from '@/db/queries/dailyLogs';
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

/** Card tint from a 6-digit hex category color (alpha-suffixed wash). */
const tint = (c: string) => ({ backgroundColor: `${c}14`, borderColor: `${c}38` });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const dateToday = () => new Date().toISOString().slice(0, 10);

const shiftDate = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

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

// Per-category accents — same restrained palette as the Health Graph nodes.
// Text and dots only; no emoji anywhere in the log form.
const SECTION_ACCENTS: Record<string, { color: string }> = {
  sleep: { color: COLORS.catSleep },
  symptomsPain: { color: COLORS.catPain },
  activity: { color: COLORS.catActivity },
  nutrition: { color: COLORS.catNutrition },
  medication: { color: COLORS.catMedication },
  vitals: { color: COLORS.catVitals },
  wellbeing: { color: COLORS.catMood },
  symptoms: { color: COLORS.catSymptom },
  notes: { color: COLORS.textMuted },
};

/** Section wrapper with optional heading, accent icon and category color. */
function Section({
  title,
  subtitle,
  category,
  index = 0,
  animate = true,
  children,
}: {
  title: string;
  subtitle?: string;
  category?: keyof typeof SECTION_ACCENTS;
  /** Order on screen — drives the staggered entrance. */
  index?: number;
  animate?: boolean;
  children: React.ReactNode;
}) {
  const accent = category ? SECTION_ACCENTS[category] : null;
  const reduced = useReducedMotion();
  const entering =
    animate && !reduced ? FadeInUp.duration(300).delay(Math.min(index * 60, 360)) : undefined;
  return (
    <Animated.View entering={entering} style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeading}>
          {accent ? (
            <View style={[styles.sectionTitleChip, { backgroundColor: `${accent.color}1A` }]}>
              <View style={[styles.sectionTitleDot, { backgroundColor: accent.color }]} />
              <Text style={[styles.sectionTitle, { color: accent.color }]}>{title}</Text>
            </View>
          ) : (
            <Text style={styles.sectionTitle}>{title}</Text>
          )}
          {subtitle ? (
            <Text style={styles.sectionSubtitle}>{subtitle}</Text>
          ) : null}
        </View>
      </View>
      {children}
    </Animated.View>
  );
}

/** Horizontal divider */
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
}: {
  value: number | null;
  onChange: (v: number) => void;
  labels: Record<number, string>;
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
              style={[styles.scaleDot, selected && styles.scaleDotSelected]}
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
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const adjust = (delta: number) => {
    const next = Math.max(0, Math.min(24 * 60, totalMinutes + delta));
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
}: {
  value: number | null;
  onChange: (v: number) => void;
  labels: Record<number, string>;
}) {
  return (
    <View style={styles.qualityRow}>
      {[1, 2, 3, 4, 5].map((n) => {
        const selected = value === n;
        return (
          <Pressable
            key={n}
            onPress={() => onChange(n)}
            style={[styles.qualityDot, selected && styles.qualityDotSelected]}
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
  allowClear = false,
  label,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  color: string;
  allowClear?: boolean;
  label: string;
}) {
  return (
    <View style={styles.optRow}>
      {options.map((opt) => {
        const selected = value === opt;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(selected && allowClear ? '' : opt)}
            style={[styles.optChip, selected && { backgroundColor: color, borderColor: color }]}
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

type VitalPresetKind = 'hr' | 'glucose' | 'temp';

/** Recognize backend manual-log concepts that deserve a dedicated dial. */
function vitalPresetFor(concept: ManualLogConcept | undefined): VitalPresetKind | null {
  if (!concept) return null;
  if (concept.terminology === 'LOINC' && concept.code === '8867-4') return 'hr';
  if (concept.terminology === 'LOINC' && concept.code === '2339-0') return 'glucose';
  const name = `${concept.short_name ?? ''} ${concept.display_name}`.toLowerCase();
  if (/heart|pulse/.test(name)) return 'hr';
  if (/gluc|sugar/.test(name)) return 'glucose';
  if (/temp|thermal/.test(name)) return 'temp';
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
              style={[styles.unitToggleBtn, unit === u && { backgroundColor: color, borderColor: color }]}
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
        color={color}
        tint={feverTint}
        accessibilityLabel="Fever temperature"
      />
      <Text style={styles.dialHint}>Saved into your symptom notes — visible on your timeline.</Text>
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

type ActivityDraft = { id: number; activityType: string; duration: string; calories: string };
type MedicationDraft = { id: number; name: string; dosage: string; unit: string };
type VitalDraft = { id: number; conceptId: string; value: string; unit: string };
type PainDraft = { id: number; structureId: string; bodyLocationId: string; severity: string; painType: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    if (existing.sleep_duration_minutes != null) setSleepMinutes(existing.sleep_duration_minutes);
    if (existing.sleep_quality != null) setSleepQuality(existing.sleep_quality);
    if (existing.sleep_awakenings != null) setAwakenings(existing.sleep_awakenings);
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
    setActivities(existing.activities.map((item, i) => ({ id: i + 1, activityType: item.activity_type, duration: item.duration_minutes == null ? '' : String(item.duration_minutes), calories: item.calories_burned == null ? '' : String(item.calories_burned) })));
    setMedications(existing.medications.map((item, i) => ({ id: i + 1, name: item.medication_name, dosage: item.dosage_value == null ? '' : String(item.dosage_value), unit: item.dosage_unit ?? '' })));
    setVitals(existing.vitals.map((item, i) => ({ id: i + 1, conceptId: item.concept_id ?? '', value: item.value == null ? '' : String(item.value), unit: item.unit ?? '' })));
    setFormInitialized(true);
  }, [todayCheckinQuery.data, todayCheckinQuery.isLoading, formInitialized]);

  useEffect(() => {
    setFormInitialized(false);
    setEditingGroupId(null);
    setMood(null); setEnergy(null); setStress(null); setSleepMinutes(0); setSleepQuality(null); setAwakenings(null);
    setWaterMl(''); setMealsCount(''); setAppetiteLevel(null); setSymptoms([]); setPain([]);
    setActivities([]); setMedications([]); setVitals([]); setNotes(''); setErrors({});
  }, [selectedDate]);

  const concepts = conceptsQuery.data ?? [];
  // Date badge strings — memoized so every keystroke doesn't rebuild them.
  const dateBadge = useMemo(() => {
    const d = new Date(`${selectedDate}T00:00:00`);
    return {
      day: d.getDate(),
      month: d.toLocaleDateString('en-US', { month: 'short' }),
      long: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    };
  }, [selectedDate]);
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
          const response = await api.post<DailyCheckInResponse>(path, payload, config);
          serverGroupId = response.group_id;
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
  const addActivity = () => setActivities((items) => [...items, { id: Date.now(), activityType: '', duration: '', calories: '' }]);
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
  const quickAddSymptom = (code: string) => {
    const concept = concepts.find((c) => c.code === code);
    if (!concept) return;
    setSymptoms((items) => [
      ...items,
      { id: nextId, conceptId: concept.id, severity: '', duration: '', notes: '' },
    ]);
    setNextId((n) => n + 1);
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
        message: `Essentials need your ${missing.join(' and ')} first — add ${missing.length > 1 ? 'them' : 'it'} above, then tap again.`,
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
      activities: activities.map((item) => ({ activity_type: item.activityType.trim(), ...(item.duration ? { duration_minutes: Number(item.duration) } : {}), ...(item.calories ? { calories_burned: Number(item.calories) } : {}) })),
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
      <AmbientBackground />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onScroll={onTabScroll}
        scrollEventThrottle={16}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
          >
            <Text style={styles.backBtnText}>‹ Back</Text>
          </Pressable>
          <View style={styles.hero}>
            <View style={styles.heroGlowA} pointerEvents="none" />
            <View style={styles.heroGlowB} pointerEvents="none" />
            <View style={styles.headerRow}>
              <View style={styles.headerText}>
                <Text style={styles.title}>Daily Log</Text>
                <Text style={styles.subtitle}>
                  {!todayCheckinQuery.isLoading && editingGroupId != null
                    ? 'This day is logged — change anything below to update it.'
                    : 'How are you feeling today?'}
                </Text>
                {!todayCheckinQuery.isLoading && editingGroupId != null ? (
                  <View style={styles.editingPill}>
                    <Text style={styles.editingPillText}>
                      {selectedDate === dateToday() ? "●  VIEWING · EDIT TODAY'S LOG" : '●  VIEWING · EDIT THIS LOG'}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.dateBadge}>
                <Text style={styles.dateBadgeDay}>
                  {dateBadge.day}
                </Text>
                <Text style={styles.dateBadgeMonth}>
                  {dateBadge.month}
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.dateControls}>
            <Pressable onPress={() => setSelectedDate((value) => shiftDate(value, -1))} style={styles.dateControl}>
              <Text style={styles.dateControlText}>Previous</Text>
            </Pressable>
            <Text style={styles.selectedDateText}>{dateBadge.long}</Text>
            <Pressable onPress={() => setSelectedDate(dateToday())} style={styles.dateControl}>
              <Text style={styles.dateControlText}>Today</Text>
            </Pressable>
            <Pressable onPress={() => setSelectedDate((value) => shiftDate(value, 1))} style={styles.dateControl}>
              <Text style={styles.dateControlText}>Next</Text>
            </Pressable>
          </View>
        </View>

        {/* ── Feedback banner ── */}
        {feedback ? (
          <View
            style={[
              styles.banner,
              feedback.type === 'success' ? styles.bannerSuccess : styles.bannerError,
            ]}
          >
            <Text style={styles.bannerText}>{feedback.message}</Text>
            <Pressable onPress={() => setFeedback(null)} accessibilityLabel="Dismiss">
              <Text style={styles.bannerDismiss}>✕</Text>
            </Pressable>
          </View>
        ) : null}

        {/* ── Today's logged data (read-only summary) ── */}
        {selectedDate === dateToday() && todayWellbeing && (
          <View style={styles.todaySummary}>
            <Text style={styles.todaySummaryTitle}>Today's log</Text>
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
          </View>
        )}

        {/* ── Form error ── */}
        {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}

        {/* ── Log mode: Quick essentials vs full log ── */}
        <View
          style={styles.modeRow}
          accessibilityRole="radiogroup"
          accessibilityLabel="Log mode"
        >
          {(['quick', 'normal'] as const).map((m) => {
            const selected = logMode === m;
            return (
              <Pressable
                key={m}
                onPress={() => setLogMode(m)}
                style={[styles.modeBtn, selected && styles.modeBtnSelected]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={m === 'quick' ? 'Quick essentials log' : 'Normal full log'}
                hitSlop={6}
              >
                <Text style={[styles.modeBtnText, selected && styles.modeBtnTextSelected]}>
                  {m === 'quick' ? 'Quick' : 'Normal'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Quick mode: essentials only (all rows share the main form's
            state, so switching modes never loses input). */}
        {logMode === 'quick' && (
          <Section index={0} category="wellbeing" title="Essentials" subtitle="Only what turns today green — customize below.">
            <View style={[styles.card, tint(COLORS.catMood)]}>
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
                    color={COLORS.catNutrition}
                    showValue
                    displayValue={waterMl ? `${Number(waterMl).toLocaleString('en-US')} ml` : 'Not set'}
                  />
                  <OptionChips
                    options={WATER_QUICK}
                    value={waterMl}
                    onChange={setWaterMl}
                    color={COLORS.catNutrition}
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
                  <ScaleSelector value={appetiteLevel} onChange={setAppetiteLevel} labels={APPETITE_LABELS} />
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
                          accessibilityLabel={staged ? `${med.name} staged — tap to remove` : `Stage ${med.name} dose`}
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

        {logMode === 'normal' && (
        <>
        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* SLEEP                                                             */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <Section index={0} category="sleep" title="Sleep" subtitle="How much did you sleep last night?">
          <View style={[styles.card, tint(COLORS.catSleep)]}>
            <Text style={styles.fieldLabel}>Duration</Text>
            <SleepDurationPicker
              totalMinutes={sleepMinutes}
              onChange={setSleepMinutes}
            />

            <View style={styles.fieldSpacer} />
            <Text style={styles.fieldLabel}>Quality</Text>
            <QualitySelector
              value={sleepQuality}
              onChange={setSleepQuality}
              labels={SLEEP_QUALITY_LABELS}
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
          <View style={[styles.card, tint(COLORS.catPain)]}>
            <Text style={styles.fieldLabel}>Pain entries</Text>
            {pain.map((item) => (
              <Animated.View
                key={item.id}
                entering={reducedMotion ? undefined : FadeInDown.duration(260)}
                exiting={reducedMotion ? undefined : FadeOut.duration(180)}
                layout={reducedMotion ? undefined : Layout.springify()}
              >
              <View style={styles.entryBlock}>
                <Text style={styles.fieldLabel}>Where does it hurt?</Text>
                <OptionChips
                  options={BODY_REGION_OPTIONS}
                  value={item.structureId}
                  onChange={(value) => setPain((items) => items.map((painItem) => painItem.id === item.id ? { ...painItem, structureId: value } : painItem))}
                  color={COLORS.catPain}
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
                  color={COLORS.catPain}
                  allowClear
                  label="Pain type"
                />
                <Input label="Or describe your own" value={item.painType} onChangeText={(value) => setPain((items) => items.map((painItem) => painItem.id === item.id ? { ...painItem, painType: value } : painItem))} placeholder="Sharp, dull, throbbing" />
                <Pressable onPress={() => setPain((items) => items.filter((painItem) => painItem.id !== item.id))}><Text style={styles.removeBtn}>Remove pain</Text></Pressable>
              </View>
              </Animated.View>
            ))}
            <Pressable onPress={addPain} style={styles.addBtn}><Text style={styles.addBtnText}>+ Add pain</Text></Pressable>
          </View>
        </Section>

        <Divider />

        <Section index={2} category="symptomsPain" title="Body map" subtitle="Log pain on a real anatomical structure — saved to your body state and timeline.">
          <View style={[styles.card, tint(COLORS.catPain)]}>
            <Text style={styles.fieldLabel}>Where does it hurt?</Text>
            <View style={styles.chipGrid}>
              {bodySites.map((site) => {
                const selected = bodySite === site.structure_id;
                return (
                  <Pressable
                    key={site.structure_id}
                    onPress={() => setBodySite(selected ? '' : site.structure_id)}
                    style={[styles.chip, selected && { backgroundColor: COLORS.catPain, borderColor: COLORS.catPain }]}
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
                  color={COLORS.catPain}
                  tint={severityTint}
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

        <Section index={2} category="activity" title="Activity" subtitle="Exercise type, duration, and calories.">
          <View style={[styles.card, tint(COLORS.catActivity)]}>
            {activities.map((item) => (
              <Animated.View
                key={item.id}
                entering={reducedMotion ? undefined : FadeInDown.duration(260)}
                exiting={reducedMotion ? undefined : FadeOut.duration(180)}
                layout={reducedMotion ? undefined : Layout.springify()}
              >
              <View style={styles.entryBlock}>
                <Text style={styles.fieldLabel}>Activity type</Text>
                <OptionChips
                  options={ACTIVITY_OPTIONS}
                  value={item.activityType}
                  onChange={(value) => setActivities((items) => items.map((activity) => activity.id === item.id ? { ...activity, activityType: value } : activity))}
                  color={COLORS.catActivity}
                  label="Activity type"
                />
                <Input label="Or type your own" value={item.activityType} onChangeText={(value) => setActivities((items) => items.map((activity) => activity.id === item.id ? { ...activity, activityType: value } : activity))} placeholder="Walking, yoga, running" error={errors[`activity-${item.id}`]} />
                <Text style={styles.fieldLabel}>Duration (minutes)</Text>
                <OptionChips
                  options={DURATION_QUICK}
                  value={item.duration}
                  onChange={(value) => setActivities((items) => items.map((activity) => activity.id === item.id ? { ...activity, duration: value } : activity))}
                  color={COLORS.catActivity}
                  allowClear
                  label="Duration minutes"
                />
                <Input label="Or enter exact minutes" value={item.duration} onChangeText={(value) => setActivities((items) => items.map((activity) => activity.id === item.id ? { ...activity, duration: value } : activity))} keyboardType="number-pad" />
                <Input label="Calories (optional)" value={item.calories} onChangeText={(value) => setActivities((items) => items.map((activity) => activity.id === item.id ? { ...activity, calories: value } : activity))} keyboardType="decimal-pad" />
                <Pressable onPress={() => setActivities((items) => items.filter((activity) => activity.id !== item.id))}><Text style={styles.removeBtn}>Remove activity</Text></Pressable>
              </View>
              </Animated.View>
            ))}
            <Pressable onPress={addActivity} style={styles.addBtn}><Text style={styles.addBtnText}>+ Add activity</Text></Pressable>
          </View>
        </Section>

        <Divider />

        <Section index={3} category="nutrition" title="Hydration & nutrition" subtitle="Use the fields recorded by HealthGraph.">
          <View style={[styles.card, tint(COLORS.catNutrition)]}>
            <Text style={styles.fieldLabel}>Water</Text>
            <Slider
              value={waterMl ? Number(waterMl) : 0}
              onValueChange={(v) => setWaterMl(String(v))}
              min={0}
              max={3000}
              step={50}
              color={COLORS.catNutrition}
              showValue
              displayValue={waterMl ? `${Number(waterMl).toLocaleString('en-US')} ml` : 'Not set'}
            />
            <OptionChips
              options={WATER_QUICK}
              value={waterMl}
              onChange={setWaterMl}
              color={COLORS.catNutrition}
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
            <ScaleSelector value={appetiteLevel} onChange={setAppetiteLevel} labels={APPETITE_LABELS} />
          </View>
        </Section>

        <Divider />

        <Section index={6} category="vitals" title="Vitals" subtitle="Pick a vital — the right device-style input appears.">
          <View style={[styles.card, tint(COLORS.catVitals)]}>
            <View style={styles.quickRow}>
              <Pressable
                onPress={() => quickAddVital('LOINC', '8867-4', 'bpm')}
                style={styles.quickBtn}
                disabled={mutation.isPending || conceptsQuery.isLoading}
                accessibilityRole="button"
                accessibilityLabel="Quick log heart rate"
              >
                <Text style={styles.quickBtnText}>Quick: Pulse</Text>
              </Pressable>
              <Pressable
                onPress={() => quickAddVital('LOINC', '2339-0', 'mg/dL')}
                style={styles.quickBtn}
                disabled={mutation.isPending || conceptsQuery.isLoading}
                accessibilityRole="button"
                accessibilityLabel="Quick log blood glucose"
              >
                <Text style={styles.quickBtnText}>Quick: Glucose</Text>
              </Pressable>
            </View>
            {conceptsQuery.isError ? (
              <Text style={styles.dialHint}>Options need a connection — typing still works.</Text>
            ) : null}
            {vitals.map((item) => {
              const selectedConcept = concepts.find((c) => c.id === item.conceptId);
              const presetKind = vitalPresetFor(selectedConcept);
              const preset = presetKind ? VITAL_DIALS[presetKind] : null;
              const dialValue = item.value.trim() === '' ? null : Number(item.value);
              return (
                <Animated.View
                  key={item.id}
                  entering={reducedMotion ? undefined : FadeInDown.duration(260)}
                  exiting={reducedMotion ? undefined : FadeOut.duration(180)}
                  layout={reducedMotion ? undefined : Layout.springify()}
                >
                <View style={styles.entryBlock}>
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
                        color={COLORS.catVitals}
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
                        color={COLORS.catVitals}
                        allowClear
                        label="Vital unit"
                      />
                    </>
                  )}
                  {errors[`vital-${item.id}`] ? <Text style={styles.fieldError}>{errors[`vital-${item.id}`]}</Text> : null}
                  <Pressable onPress={() => setVitals((items) => items.filter((vital) => vital.id !== item.id))}><Text style={styles.removeBtn}>Remove vital</Text></Pressable>
                </View>
                </Animated.View>
              );
            })}
            <Pressable onPress={addVital} style={styles.addBtn}><Text style={styles.addBtnText}>+ Add vital</Text></Pressable>
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
        >
          <View style={[styles.card, tint(COLORS.catMood)]}>
            <Text style={styles.fieldLabel}>Mood</Text>
            <MoodSelector value={mood} onChange={setMood} />

            <View style={styles.fieldSpacer} />
            <Text style={styles.fieldLabel}>Energy</Text>
            <ScaleSelector value={energy} onChange={setEnergy} labels={ENERGY_LABELS} />

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
            <Animated.View
              key={item.id}
              entering={reducedMotion ? undefined : FadeInDown.duration(260)}
              exiting={reducedMotion ? undefined : FadeOut.duration(180)}
              layout={reducedMotion ? undefined : Layout.springify()}
            >
            <View style={[styles.symptomCard, tint(COLORS.catSymptom)]}>
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
                color={COLORS.catSymptom}
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
                    color={COLORS.catSymptom}
                  />
                </>
              ) : null}
            </View>
            </Animated.View>
            );
          })}

          <View style={styles.quickRow}>
            <Pressable
              onPress={() => quickAddSymptom('386661006')}
              style={styles.quickBtn}
              disabled={mutation.isPending || conceptsQuery.isLoading}
              accessibilityRole="button"
              accessibilityLabel="Quick log fever"
            >
              <Text style={styles.quickBtnText}>Quick: Fever</Text>
            </Pressable>
          </View>

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
          <View style={styles.card}>
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
        <Button           title={mutation.isPending ? 'Saving…' : editingGroupId ? "Update today's log" : "Save today's log"}
          onPress={logMode === 'quick' ? saveEssentials : save}
          fullWidth
          loading={mutation.isPending}
          disabled={conceptsQuery.isLoading || mutation.isPending}
          style={styles.saveButton}
        />

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
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>

      {/* Celebration overlay — one-shot delight on save */}
      <LogCelebration visible={celebrate} onDone={() => setCelebrate(false)} />
    </SafeAreaView>
  );
}

// ===========================================================================
// Styles
// ===========================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
  },

  // ── Header ──
  backBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  backBtnText: { ...TYPOGRAPHY.captionStrong, color: COLORS.primary },
  // Hero header card — deep gradient illusion via layered glows.
  hero: {
    borderWidth: 1,
    borderColor: 'rgba(77, 141, 255, 0.35)',
    borderRadius: BORDER_RADIUS.xl,
    backgroundColor: '#101F38',
    padding: SPACING.lg,
    overflow: 'hidden',
    marginBottom: SPACING.sm,
  },
  heroGlowA: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    top: -90,
    right: -60,
    backgroundColor: 'rgba(77, 141, 255, 0.35)',
  },
  heroGlowB: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    bottom: -100,
    left: -50,
    backgroundColor: 'rgba(49, 183, 165, 0.28)',
  },
  header: {
    paddingVertical: SPACING.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    ...TYPOGRAPHY.h1,
    color: COLORS.textPrimary,
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  editingPill: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primaryBg,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    marginTop: SPACING.sm,
  },
  editingPillText: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.primary,
    fontSize: 11,
    letterSpacing: 1.1,
  },
  dateBadge: {
    width: 52,
    height: 52,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateBadgeDay: {
    ...TYPOGRAPHY.h2,
    color: COLORS.primary,
    lineHeight: 26,
  },
  dateBadgeMonth: {
    ...TYPOGRAPHY.label,
    color: COLORS.primaryLight,
    fontSize: 10,
    lineHeight: 14,
  },
  dateControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.xs,
    marginTop: SPACING.md,
  },
  dateControl: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.surface,
  },
  dateControlText: { ...TYPOGRAPHY.captionStrong, color: COLORS.primary },
  selectedDateText: { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, flex: 1, textAlign: 'center' },

  // ── Banner ──
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
  },
  bannerSuccess: {
    backgroundColor: COLORS.successBg,
  },
  bannerError: {
    backgroundColor: COLORS.errorBg,
  },
  bannerText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    flex: 1,
  },
  bannerDismiss: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textMuted,
    marginLeft: SPACING.sm,
  },

  // ── Today's summary ──
  todaySummary: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  todaySummaryTitle: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SPACING.sm,
  },
  todayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  todayItem: {
    minWidth: 72,
    flexGrow: 1,
  },
  todayLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },
  todayValue: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
    marginTop: 2,
  },
  todayNote: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginTop: SPACING.sm,
    fontStyle: 'italic',
  },

  // ── Form error ──
  formError: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.error,
    marginBottom: SPACING.md,
  },

  // ── Sections ──
  section: {
    marginBottom: SPACING.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  // Category-tinted title chip + dot (replaces the old emoji badge).
  sectionTitleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: 9999,
  },
  sectionTitleDot: {
    width: 8,
    height: 8,
    borderRadius: 9999,
  },
  sectionHeading: {
    flex: 1,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
  },
  sectionSubtitle: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: SPACING.sm,
  },

  // ── Card (section surface) ──
  card: {
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.borderFaint,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 2,
  },

  // ── Field labels ──
  fieldLabel: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  fieldSpacer: {
    height: SPACING.md,
  },
  fieldError: {
    ...TYPOGRAPHY.caption,
    color: COLORS.error,
    marginTop: SPACING.xs,
  },
  entryBlock: { gap: SPACING.sm, marginBottom: SPACING.md, paddingBottom: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  inlineFields: { flexDirection: 'row', gap: SPACING.sm },
  inlineInput: { flex: 1 },
  selectedVitalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.sm },
  selectedVitalInfo: { flex: 1 },
  selectedVitalName: { ...TYPOGRAPHY.bodyStrong, color: COLORS.primary },
  selectedVitalSub: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, marginTop: 2 },

  // ── Mood selector ──
  moodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
  },
  moodPill: {
    flex: 1,
    minWidth: 56,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
  },
  moodPillSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  moodPillText: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.textSecondary,
    textAlign: 'center',
    fontSize: 12,
  },
  moodPillTextSelected: {
    color: COLORS.textOnAccent,
    fontWeight: '700',
  },

  // ── Scale selector (energy / stress) ──
  scaleRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  scaleDot: {
    width: 44,
    height: 44,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaleDotSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  scaleDotText: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textSecondary,
  },
  scaleDotTextSelected: {
    color: '#FFFFFF',
  },
  scaleLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.primary,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
  scaleLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: SPACING.xs,
  },
  scaleHint: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },

  // ── Sleep duration stepper ──
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  stepperBtn: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm + 2,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceElevated,
  },
  stepperBtnText: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.textSecondary,
  },
  stepperDisplay: {
    flex: 1,
    alignItems: 'center',
  },
  stepperValue: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
  },

  // ── Sleep quality ──
  qualityRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  qualityDot: {
    width: 40,
    height: 40,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qualityDotSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  qualityDotText: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textSecondary,
  },
  qualityDotTextSelected: {
    color: '#FFFFFF',
  },
  qualityHint: {
    ...TYPOGRAPHY.caption,
    color: COLORS.primary,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },

  // ── Symptoms ──
  symptomCard: {
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.borderFaint,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 5,
    elevation: 2,
  },
  symptomHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  symptomIndex: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
  },
  removeBtn: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.error,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginTop: SPACING.xs,
  },
  // ── Quick-pick option chips (one tap instead of typing) ──
  optRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  optChip: {
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.sm + 2,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  optChipText: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.textSecondary,
  },
  optChipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  chip: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs + 2,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surfaceSunken,
  },
  chipSelected: {
    backgroundColor: COLORS.primaryBg,
    borderColor: COLORS.primary,
  },
  chipText: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.textSecondary,
  },
  chipTextSelected: {
    color: COLORS.primary,
  },
  // 10 fixed dots overflow narrow screens (10×32 + 9×6 = 374px > ~300px
  // usable), so the row wraps into a clean grid instead of spilling past
  // the card edge. Dots keep fixed size for stable tap targets.
  severityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    rowGap: 8,
  },
  severityDot: {
    width: 32,
    height: 32,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  severityDotSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  severityDotText: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.textSecondary,
  },
  severityDotTextSelected: {
    color: COLORS.textOnAccent,
    fontWeight: '700',
  },
  addBtn: {
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  addBtnText: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.primary,
  },

  // ── Quick-log + unit toggles ──
  quickRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  quickBtn: {
    flex: 1,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
  },
  quickBtnText: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.textPrimary,
  },
  unitToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  unitToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.full,
    overflow: 'hidden',
  },
  unitToggleBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: BORDER_RADIUS.full,
  },
  unitToggleText: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.textSecondary,
  },
  unitToggleTextSelected: {
    color: COLORS.textOnAccent,
  },
  dialHint: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },

  // ── Active medicines (tap-to-log) ──
  activeMedRow: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
    paddingVertical: SPACING.xs,
  },
  activeMedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.xs,
    minHeight: 44,
  },
  activeMedIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: `${COLORS.catMedication}1A`,
    borderWidth: 1,
    borderColor: `${COLORS.catMedication}55`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeMedDot: {
    width: 14,
    height: 14,
    borderRadius: 9999,
    backgroundColor: COLORS.catMedication,
  },
  activeMedInfo: {
    flex: 1,
    gap: 2,
  },
  activeMedName: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
  },
  activeMedDetail: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  activeMedTimes: {
    ...TYPOGRAPHY.caption,
    color: COLORS.primary,
    fontVariant: ['tabular-nums'],
  },
  prnBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: `${COLORS.catMedication}1A`,
    borderWidth: 1,
    borderColor: `${COLORS.catMedication}55`,
  },
  prnText: {
    ...TYPOGRAPHY.label,
    color: COLORS.catMedication,
    fontSize: 10,
    fontWeight: '700',
  },
  expandGlyph: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
  },
  activeMedBody: {
    gap: SPACING.sm,
    paddingTop: SPACING.xs,
    paddingBottom: SPACING.sm,
  },
  logDoseBtn: {
    paddingVertical: SPACING.sm + 2,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.catMedication,
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  logDoseBtnDone: {
    backgroundColor: COLORS.successBg,
    borderWidth: 1,
    borderColor: COLORS.success,
  },
  logDoseText: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textOnAccent,
  },
  logDoseTextDone: {
    color: COLORS.success,
  },

  // ── Today's Medications ──
  medScheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  medScheduleInfo: {
    flex: 1,
  },
  medScheduleName: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
  },
  medScheduleDetail: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  medTakenBadge: {
    alignItems: 'center',
  },
  medTakenText: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.green,
  },
  medTakenTime: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    fontSize: 10,
  },
  // Read-only schedule state (dose toggling lives on the active rows).
  medPendingText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  // Tick/cross dose toggle, right of the medicine name.
  medTakenToggle: {
    width: 34,
    height: 34,
    borderRadius: 9999,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medTakenToggleOn: {
    backgroundColor: COLORS.green,
    borderColor: COLORS.green,
  },
  medTakenToggleOff: {
    backgroundColor: 'transparent',
    borderColor: COLORS.error,
  },
  medTakenToggleGlyph: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 20,
  },
  medTakenToggleGlyphOn: {
    color: '#FFFFFF',
  },
  medTakenToggleGlyphOff: {
    color: COLORS.error,
  },
  medTakeButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  medTakeButtonText: {
    ...TYPOGRAPHY.bodyStrong,
    color: '#FFFFFF',
  },

  // ── Notes ──
  textArea: {
    ...TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    minHeight: 100,
    textAlignVertical: 'top',
    paddingTop: SPACING.sm,
  },
  notesFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  charCount: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },

  // ── Save ──
  saveButton: {
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  // Log-mode segmented switch: compact pills, Normal selected by default.
  modeRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: SPACING.sm,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
  },
  modeBtnSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  modeBtnText: {
    ...TYPOGRAPHY.bodyStrong,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  modeBtnTextSelected: {
    color: '#FFFFFF',
  },
  // Essentials rows (quick mode): compact medicine tick rows + customize UI.
  essMedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  essMedInfo: {
    flex: 1,
    gap: 1,
  },
  essMedName: {
    ...TYPOGRAPHY.bodyStrong,
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  essMedDetail: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  essMedToggle: {
    width: 32,
    height: 32,
    borderRadius: 9999,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  essMedToggleOn: {
    backgroundColor: COLORS.green,
    borderColor: COLORS.green,
  },
  essMedToggleOff: {
    backgroundColor: 'transparent',
    borderColor: COLORS.error,
  },
  essMedToggleGlyph: {
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  essMedToggleGlyphOn: {
    color: '#FFFFFF',
  },
  essMedToggleGlyphOff: {
    color: COLORS.error,
  },
  essCustomizeBtn: {
    alignSelf: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  essCustomizeText: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.textSecondary,
  },
  essCustomizeList: {
    gap: SPACING.xs,
    marginTop: SPACING.xs,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  essCustomizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  essCheck: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  essCheckOn: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  essCheckGlyph: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 16,
  },
  essCheckLabel: {
    ...TYPOGRAPHY.body,
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  essCustomizeHint: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  // Essentials fast-path sits under the big save, deliberately smaller and
  // centered so the full log reads as the primary action.
  essentialsWrap: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  essentialsButton: {
    paddingHorizontal: SPACING.lg,
  },

  // ── History ──
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  historyLeft: {
    flex: 1,
  },
  historyDate: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
  },
  historyCats: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  historyCount: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.primary,
    marginLeft: SPACING.sm,
  },

  // ── Muted text ──
  muted: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },

  // ── Global error ──
  globalError: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.error,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
});
