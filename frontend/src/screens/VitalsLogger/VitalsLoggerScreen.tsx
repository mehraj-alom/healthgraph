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
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Button, Input } from '@/components';
import { COLORS, BORDER_RADIUS, SPACING, TYPOGRAPHY, SHADOWS } from '@/constants';
import { api } from '@/services/api';
import { getCachedPatientId } from '@/services/patientIdentity';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { useMedicationSchedule, recordMedicationTaken } from '@/hooks/useMedications';
import {
  getDailyLogDetail as dbGetDailyLogDetail,
  upsertDailyLog as dbUpsertDailyLog,
  hydrateDailyLog as dbHydrateDailyLog,
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
const SECTION_ACCENTS: Record<string, { icon: string; color: string }> = {
  sleep: { icon: '🌙', color: COLORS.catSleep },
  symptomsPain: { icon: '🤕', color: COLORS.catPain },
  activity: { icon: '🏃', color: COLORS.catActivity },
  nutrition: { icon: '💧', color: COLORS.catNutrition },
  medication: { icon: '💊', color: COLORS.catMedication },
  vitals: { icon: '❤️', color: COLORS.catVitals },
  wellbeing: { icon: '✨', color: COLORS.catMood },
  symptoms: { icon: '🩺', color: COLORS.catSymptom },
  notes: { icon: '📝', color: COLORS.textMuted },
};

/** Section wrapper with optional heading, accent icon and category color. */
function Section({
  title,
  subtitle,
  category,
  children,
}: {
  title: string;
  subtitle?: string;
  category?: keyof typeof SECTION_ACCENTS;
  children: React.ReactNode;
}) {
  const accent = category ? SECTION_ACCENTS[category] : null;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {accent ? (
          <View style={[styles.sectionAccent, { backgroundColor: `${accent.color}1A`, borderColor: `${accent.color}55` }]}>
            <Text style={styles.sectionAccentIcon}>{accent.icon}</Text>
          </View>
        ) : null}
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle ? (
            <Text style={styles.sectionSubtitle}>{subtitle}</Text>
          ) : null}
        </View>
      </View>
      {children}
    </View>
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

export default function VitalsLoggerScreen() {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();

  // --- Form state ---
  const [mood, setMood] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [stress, setStress] = useState<number | null>(null);
  const [sleepMinutes, setSleepMinutes] = useState(0);
  const [sleepQuality, setSleepQuality] = useState<number | null>(null);
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
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [formInitialized, setFormInitialized] = useState(false);

  // --- Data queries ---
  const conceptsQuery = useQuery({
    queryKey: ['manual-log-concepts'],
    queryFn: () =>
      api.get<ManualLogConcept[]>('/api/v1/ontology/manual-log-concepts'),
    staleTime: 86_400_000,
  });

  const metrics = useDailyMetrics();

  // Fetch today's medication schedule
  const today = dateToday();
  const { data: medicationSchedule, refetch: refetchMedSchedule } = useMedicationSchedule(today);

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
    setMood(null); setEnergy(null); setStress(null); setSleepMinutes(0); setSleepQuality(null);
    setWaterMl(''); setMealsCount(''); setAppetiteLevel(null); setSymptoms([]); setPain([]);
    setActivities([]); setMedications([]); setVitals([]); setNotes(''); setErrors({});
  }, [selectedDate]);

  const concepts = conceptsQuery.data ?? [];
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
      console.log(`[DailyLog] LOCAL_WRITE_START date=${payload.log_date}`);
      let groupId: string;
      try {
        groupId = await dbUpsertDailyLog(patientId, payload);
        console.log('[DailyLog] LOCAL_WRITE_SUCCESS');
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
      const method = editingGroupId ? 'PUT' : 'POST';
      const path = editingGroupId
        ? `/api/v1/logs/daily-checkin/${editingGroupId}`
        : '/api/v1/logs/daily-checkin';
      let serverSaved = false;
      let serverGroupId: string | null = null;
      try {
        console.log(`[DailyLog] API_SYNC_START method=${method} path=${path}`);
        if (editingGroupId) {
          const response = await api.put<DailyCheckInResponse>(path, payload);
          serverGroupId = response.group_id;
        } else {
          const response = await api.post<DailyCheckInResponse>(path, payload);
          serverGroupId = response.group_id;
        }
        serverSaved = true;
        console.log(`[DailyLog] API_SYNC_SUCCESS method=${method} path=${path}`);
      } catch (error) {
        // Log only method, path, HTTP status and category — never bodies/health data.
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        console.warn(
          `[DailyLog] API_SYNC_FAILURE method=${method} path=${path} status=${status ?? 'none'} category=${classifyApiError(error)}`,
        );
      }

      return { groupId, serverSaved, serverGroupId };
    },
    onSuccess: async ({ serverSaved }) => {
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
  const addMedication = () => setMedications((items) => [...items, { id: Date.now(), name: '', dosage: '', unit: '' }]);
  const addVital = () => setVitals((items) => [...items, { id: Date.now(), conceptId: '', value: '', unit: '' }]);

  // --- Validation ---
  const validate = (): boolean => {
    const e: Record<string, string> = {};
    const hasContent =
      mood != null ||
      energy != null ||
      stress != null ||
      sleepMinutes > 0 ||
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
    if (mealsCount && (!Number.isInteger(Number(mealsCount)) || Number(mealsCount) < 0)) e.meals = 'Use a whole meal count.';
    pain.forEach((item) => {
      if (!item.severity || Number(item.severity) < 1 || Number(item.severity) > 10) e[`pain-${item.id}`] = 'Choose a severity from 1 to 10.';
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
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Daily Log</Text>
              <Text style={styles.subtitle}>
                How are you feeling today?
              </Text>
            </View>
            <View style={styles.dateBadge}>
              <Text style={styles.dateBadgeDay}>
                {new Date(`${selectedDate}T00:00:00`).getDate()}
              </Text>
              <Text style={styles.dateBadgeMonth}>
                {new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short' })}
              </Text>
            </View>
          </View>
          <View style={styles.dateControls}>
            <Pressable onPress={() => setSelectedDate((value) => shiftDate(value, -1))} style={styles.dateControl}>
              <Text style={styles.dateControlText}>Previous</Text>
            </Pressable>
            <Text style={styles.selectedDateText}>{new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
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

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* SLEEP                                                             */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <Section category="sleep" title="Sleep" subtitle="How much did you sleep last night?">
          <View style={styles.card}>
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
          </View>
        </Section>

        <Divider />

        <Section category="symptomsPain" title="Symptoms & pain" subtitle="Record symptoms and pain only when present.">
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Pain entries</Text>
            {pain.map((item) => (
              <View key={item.id} style={styles.entryBlock}>
                <Input label="Structure ID (optional)" value={item.structureId} onChangeText={(value) => setPain((items) => items.map((painItem) => painItem.id === item.id ? { ...painItem, structureId: value } : painItem))} placeholder="e.g. RIGHT_KNEE" />
                <Input label="Body location ID (optional)" value={item.bodyLocationId} onChangeText={(value) => setPain((items) => items.map((painItem) => painItem.id === item.id ? { ...painItem, bodyLocationId: value } : painItem))} />
                <Input label="Pain severity (1–10)" value={item.severity} onChangeText={(value) => setPain((items) => items.map((painItem) => painItem.id === item.id ? { ...painItem, severity: value } : painItem))} keyboardType="number-pad" error={errors[`pain-${item.id}`]} />
                <Input label="Pain type (optional)" value={item.painType} onChangeText={(value) => setPain((items) => items.map((painItem) => painItem.id === item.id ? { ...painItem, painType: value } : painItem))} placeholder="Sharp, dull, throbbing" />
                <Pressable onPress={() => setPain((items) => items.filter((painItem) => painItem.id !== item.id))}><Text style={styles.removeBtn}>Remove pain</Text></Pressable>
              </View>
            ))}
            <Pressable onPress={addPain} style={styles.addBtn}><Text style={styles.addBtnText}>+ Add pain</Text></Pressable>
          </View>
        </Section>

        <Divider />

        <Section category="activity" title="Activity" subtitle="Exercise type, duration, and calories.">
          <View style={styles.card}>
            {activities.map((item) => (
              <View key={item.id} style={styles.entryBlock}>
                <Input label="Activity type" value={item.activityType} onChangeText={(value) => setActivities((items) => items.map((activity) => activity.id === item.id ? { ...activity, activityType: value } : activity))} placeholder="Walking, yoga, running" error={errors[`activity-${item.id}`]} />
                <Input label="Duration (minutes)" value={item.duration} onChangeText={(value) => setActivities((items) => items.map((activity) => activity.id === item.id ? { ...activity, duration: value } : activity))} keyboardType="number-pad" />
                <Input label="Calories (optional)" value={item.calories} onChangeText={(value) => setActivities((items) => items.map((activity) => activity.id === item.id ? { ...activity, calories: value } : activity))} keyboardType="decimal-pad" />
                <Pressable onPress={() => setActivities((items) => items.filter((activity) => activity.id !== item.id))}><Text style={styles.removeBtn}>Remove activity</Text></Pressable>
              </View>
            ))}
            <Pressable onPress={addActivity} style={styles.addBtn}><Text style={styles.addBtnText}>+ Add activity</Text></Pressable>
          </View>
        </Section>

        <Divider />

        <Section category="nutrition" title="Hydration & nutrition" subtitle="Use the fields recorded by HealthGraph.">
          <View style={styles.card}>
            <Input label="Water (ml)" value={waterMl} onChangeText={setWaterMl} keyboardType="number-pad" error={errors.water} />
            <Input label="Meals count" value={mealsCount} onChangeText={setMealsCount} keyboardType="number-pad" error={errors.meals} />
            <Text style={styles.fieldLabel}>Appetite</Text>
            <ScaleSelector value={appetiteLevel} onChange={setAppetiteLevel} labels={ENERGY_LABELS} />
          </View>
        </Section>

        <Divider />

        {/* ── Today's Scheduled Medications ── */}
        {medicationSchedule && medicationSchedule.length > 0 && (
          <Section category="medication" title="Today's Medications" subtitle="Mark doses as taken.">
            <View style={styles.card}>
              {medicationSchedule.map((item) => {
                const med = item.medication;
                const timeStr = item.scheduled_time;
                const [hours, minutes] = timeStr.split(':').map(Number);
                const period = hours >= 12 ? 'PM' : 'AM';
                const displayHours = hours % 12 || 12;
                const formattedTime = `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;

                return (
                  <View key={`${med.medication_id}-${item.scheduled_time}`} style={styles.medScheduleRow}>
                    <View style={styles.medScheduleInfo}>
                      <Text style={styles.medScheduleName}>{med.name}</Text>
                      <Text style={styles.medScheduleDetail}>
                        {med.strength}{med.strength_unit ? ` ${med.strength_unit}` : ''}
                        {` · ${formattedTime}`}
                      </Text>
                    </View>
                    {item.taken ? (
                      <View style={styles.medTakenBadge}>
                        <Text style={styles.medTakenText}>✓ Taken</Text>
                        {item.taken_at && (
                          <Text style={styles.medTakenTime}>
                            {new Date(item.taken_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </Text>
                        )}
                      </View>
                    ) : (
                      <Pressable
                        style={styles.medTakeButton}
                        onPress={async () => {
                          try {
                            const patientId = getCachedPatientId();
                            if (!patientId) return;
                            await recordMedicationTaken(
                              patientId,
                              med.medication_id,
                              med.dose_amount,
                              med.dose_unit,
                              timeStr,
                            );
                            refetchMedSchedule();
                          } catch (error) {
                            // Silent fail - user can retry
                          }
                        }}
                      >
                        <Text style={styles.medTakeButtonText}>Taken</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          </Section>
        )}

        <Divider />

        <Section category="medication" title="Additional Medications" subtitle="Record any other medicine taken today.">
          <View style={styles.card}>
            {medications.map((item) => (
              <View key={item.id} style={styles.entryBlock}>
                <Input label="Medication name" value={item.name} onChangeText={(value) => setMedications((items) => items.map((medication) => medication.id === item.id ? { ...medication, name: value } : medication))} error={errors[`medication-${item.id}`]} />
                <View style={styles.inlineFields}>
                  <Input label="Dosage" value={item.dosage} onChangeText={(value) => setMedications((items) => items.map((medication) => medication.id === item.id ? { ...medication, dosage: value } : medication))} keyboardType="decimal-pad" style={styles.inlineInput} />
                  <Input label="Unit" value={item.unit} onChangeText={(value) => setMedications((items) => items.map((medication) => medication.id === item.id ? { ...medication, unit: value } : medication))} placeholder="mg" style={styles.inlineInput} />
                </View>
                <Pressable onPress={() => setMedications((items) => items.filter((medication) => medication.id !== item.id))}><Text style={styles.removeBtn}>Remove medication</Text></Pressable>
              </View>
            ))}
            <Pressable onPress={addMedication} style={styles.addBtn}><Text style={styles.addBtnText}>+ Add medication</Text></Pressable>
          </View>
        </Section>

        <Divider />

        <Section category="vitals" title="Vitals" subtitle="Select a vital sign, enter a value and unit.">
          <View style={styles.card}>
            {vitals.map((item) => {
              const selectedConcept = concepts.find((c) => c.id === item.conceptId);
              return (
                <View key={item.id} style={styles.entryBlock}>
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
                        placeholder="Heart Rate, Blood Pressure…"
                      />
                      <View style={styles.chipGrid}>
                        {filteredVitalConcepts.slice(0, 20).map((concept) => (
                          <Pressable
                            key={concept.id}
                            onPress={() => setVitals((items) => items.map((v) => v.id === item.id ? { ...v, conceptId: concept.id } : v))}
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
                  <View style={styles.inlineFields}>
                    <Input label="Value (optional)" value={item.value} onChangeText={(value) => setVitals((items) => items.map((vital) => vital.id === item.id ? { ...vital, value } : vital))} keyboardType="decimal-pad" style={styles.inlineInput} />
                    <Input label="Unit (optional)" value={item.unit} onChangeText={(value) => setVitals((items) => items.map((vital) => vital.id === item.id ? { ...vital, unit: value } : vital))} placeholder="bpm, mmHg" style={styles.inlineInput} />
                  </View>
                  {errors[`vital-${item.id}`] ? <Text style={styles.fieldError}>{errors[`vital-${item.id}`]}</Text> : null}
                  <Pressable onPress={() => setVitals((items) => items.filter((vital) => vital.id !== item.id))}><Text style={styles.removeBtn}>Remove vital</Text></Pressable>
                </View>
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
          category="wellbeing"
          title="How you feel"
          subtitle="Rate your mood, energy, and stress today."
        >
          <View style={styles.card}>
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
          category="symptoms"
          title="Symptoms"
          subtitle="Select symptoms and rate their severity."
        >
          {symptoms.map((item) => (
            <View key={item.id} style={styles.symptomCard}>
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
              <Input
                label="Duration (minutes, optional)"
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
            </View>
          ))}

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

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* SAVE                                                             */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <Button           title={mutation.isPending ? 'Saving…' : editingGroupId ? "Update today's log" : "Save today's log"}
          onPress={save}
          fullWidth
          loading={mutation.isPending}
          disabled={conceptsQuery.isLoading || mutation.isPending}
          style={styles.saveButton}
        />

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* RECENT HISTORY                                                   */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {recentLogs.length > 0 && (
          <>
            <Divider />
            <Section title="Recent history" subtitle="Your past daily logs.">
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
  sectionAccent: {
    width: 34,
    height: 34,
    borderRadius: BORDER_RADIUS.medium,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionAccentIcon: {
    fontSize: 16,
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
  severityRow: {
    flexDirection: 'row',
    gap: 6,
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
  medTakeButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  medTakeButtonText: {
    ...TYPOGRAPHY.bodyStrong,
    color: '#07111F',
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
    marginBottom: SPACING.lg,
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
