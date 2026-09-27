import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api } from '@/services/api';
import { Button, Chip } from '@/components';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { toneForTimelineFilter } from '@/theme/tones';
import { StageGradient } from '@/components/StageGradient';
import { getCachedPatientId } from '@/services/patientIdentity';
import { perfStart } from '@/utils/perfLog';
import {
  getDailyLogs as dbGetDailyLogs,
  getDailyLogEvents as dbGetDailyLogEvents,
} from '@/db/queries/dailyLogs';
import { getMedications as dbGetMedications } from '@/db/queries/medications';
import { HealthFact } from '@/components/HealthFact';
import { getRecentPpgMeasurements } from '@/db/queries/ppg';
import { getRecentRppgMeasurements } from '@/db/queries/rppg';
import {
  storyItemFromLogEvent,
  localDateString,
  type HomeStoryItem,
} from '../Dashboard/homeData';
import type { RootStackParamList } from '@/types';
import { buildDiaryDays, type DiaryDay, type DiaryItemInput } from './diary';
import { DiaryReportSheet } from './DiaryPaper';
import { TimelineWheel } from './TimelineWheel';
import { useAuth } from '@/context/AuthContext';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// ---------------------------------------------------------------------------
// Types — unified timeline item (events + observations)
// ---------------------------------------------------------------------------

interface TimelineEvent {
  resource_type: 'event';
  id: string;
  event_id: string;
  event_type: string;
  source_type: string;
  event_time: string;
  verification_status: string;
  concept_display_name: string | null;
  concept_id: string | null;
  lab_result: {
    value: string;
    unit: string | null;
    reference_range: string | null;
    abnormal_flag: string | null;
  } | null;
  vital_sign: { value: number; unit: string } | null;
  safe_notes: string | null;
  evidence: {
    document_id: string;
    extracted_text: string;
    bounding_box: Record<string, number> | number[] | null;
  } | null;
  created_at: string;
  updated_at: string;
}

interface TimelineObservation {
  resource_type: 'observation';
  id: string;
  observation_id: string;
  structure_id: string;
  observation_type: string;
  finding_code: string;
  finding_display_name: string;
  visual_status: string;
  visual_severity_score: number;
  trend: string;
  source_type: string;
  clinical_summary: string | null;
  event_time: string;
  created_at: string;
}

type TimelineItem = TimelineEvent | TimelineObservation;

// ---------------------------------------------------------------------------
// Guava-flat accents — every marker is a small flat GV.fx tile inside a
// white card. Color is information; hues never touch text, fills, or rails.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Event type classification
// ---------------------------------------------------------------------------

type EventCategory =
  | 'daily_log'
  | 'medical_record'
  | 'symptom'
  | 'pain'
  | 'vital'
  | 'medication'
  | 'observation'
  | 'other';

function classifyItem(item: TimelineItem): EventCategory {
  if (item.resource_type === 'observation') return 'observation';

  // The server mixes cases: check-in logs arrive lowercase (sleep_log,
  // wellbeing_log, …) while clinical types arrive uppercase. Normalize once.
  const t = (item.event_type ?? '').toUpperCase();
  if (
    t === 'WELLBEING_LOG' ||
    t === 'SLEEP_LOG' ||
    t === 'NUTRITION_LOG' ||
    t === 'ACTIVITY_LOG' ||
    t === 'PATIENT_NOTE'
  ) {
    return 'daily_log';
  }
  if (
    t === 'LAB_RESULT' ||
    t === 'DIAGNOSIS' ||
    t === 'IMAGING_RESULT' ||
    t === 'IMMUNIZATION' ||
    t === 'procedure' ||
    t === 'prescription'
  ) {
    return 'medical_record';
  }
  if (t === 'SYMPTOM') return 'symptom';
  if (t === 'PAIN_LOG') return 'pain';
  if (t === 'VITAL_SIGN') return 'vital';
  if (t === 'MEDICATION_TAKEN') return 'medication';
  return 'other';
}

// Server event types that the on-device daily log already describes with
// full values (payload_json). Compared UPPERCASE — the server mixes cases
// (sleep_log vs MEDICATION_TAKEN). When a local entry covers the same
// calendar day, the server duplicate is hidden so each logged moment
// appears once — with its values, not just its label.
const SERVER_DAILY_TYPES = new Set([
  'WELLBEING_LOG',
  'SLEEP_LOG',
  'NUTRITION_LOG',
  'ACTIVITY_LOG',
  'PAIN_LOG',
  'SYMPTOM',
  'VITAL_SIGN',
  'MEDICATION_TAKEN',
  'PATIENT_NOTE',
]);

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

type FilterKey = 'all' | EventCategory;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'daily_log', label: 'Daily Logs' },
  { key: 'medical_record', label: 'Records' },
  { key: 'symptom', label: 'Symptoms' },
  { key: 'pain', label: 'Pain' },
  { key: 'vital', label: 'Vitals' },
  { key: 'medication', label: 'Meds' },
  { key: 'observation', label: 'Observations' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function titleFor(item: TimelineItem): string {
  if (item.resource_type === 'observation') {
    return item.finding_display_name;
  }
  if (item.concept_display_name) return item.concept_display_name;
  return item.event_type
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

function dateKey(item: TimelineItem): string {
  return new Date(item.event_time).toLocaleDateString('en-CA');
}

function timeDisplay(eventTime: string): string {
  return new Date(eventTime).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Quality word for on-device pulse rows (matches the measure screens). */
function pulseQualityLabel(quality: number): string {
  if (quality >= 0.75) return 'Good';
  if (quality >= 0.5) return 'Fair';
  return 'Poor';
}

/** Local story category → timeline category. */
function localCategory(item: HomeStoryItem): EventCategory {
  switch (item.category) {
    case 'wellbeing':
    case 'sleep':
    case 'activity':
    case 'nutrition':
    case 'note':
      return 'daily_log';
    case 'symptom':
      return 'symptom';
    case 'pain':
      return 'pain';
    case 'vital':
      return 'vital';
    case 'medication':
      return 'medication';
    default:
      return 'other';
  }
}

/**
 * Compact ledger row — one calm line per moment: title left, value right,
 * time + specs beneath. Expandable rows reveal their details inline
 * (progressive disclosure); terminal rows render everything up front.
 */
/** Append duration + fever temperature tokens to a symptom detail line. */
function withSymptomExtras(detail: string, payload: Record<string, unknown>): string {
  const extras: string[] = [];
  const dur = payload['duration_minutes'];
  if (typeof dur === 'number' && Number.isFinite(dur) && dur > 0) {
    extras.push(dur >= 60 ? `${Math.floor(dur / 60)}h ${dur % 60}m` : `${dur} min`);
  }
  const notes = payload['notes'];
  if (typeof notes === 'string') {
    const m = notes.match(/Temp\s+[\d.]+\s*°[CF]/);
    if (m) extras.push(m[0]);
  }
  return extras.length ? `${detail} · ${extras.join(' · ')}` : detail;
}

/**
 * Enrich a local story item with concept names + dose values from the raw
 * payload (all on-device, no new endpoints):
 * - symptom/vital UUIDs become real names ("Headache", "Resting pulse")
 * - medication doses become "Paracetamol · 500 mg"
 */
function enrichLocalItem(
  item: HomeStoryItem,
  payloadJson: string,
  conceptId: string | null,
  names: Map<string, string>,
): HomeStoryItem {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(payloadJson ?? '{}') as Record<string, unknown>;
  } catch {
    payload = {};
  }
  if ((item.category === 'symptom' || item.category === 'vital') && conceptId) {
    const name = names.get(conceptId);
    if (name) {
      // detail already carries the value ("· 6/10", "72 bpm"); swap title.
      const detail = item.category === 'symptom' && item.detail.startsWith('Symptom')
        ? item.detail.replace(/^Symptom/, name)
        : item.detail;
      return { ...item, title: name, detail: withSymptomExtras(detail, payload) };
    }
  }
  if (item.category === 'symptom') {
    return { ...item, detail: withSymptomExtras(item.detail, payload) };
  }
  if (item.category === 'medication') {
    const dose = payload['dosage_value'];
    const unit = payload['dosage_unit'];
    if (typeof dose === 'number' && Number.isFinite(dose)) {
      const doseText = `${dose}${typeof unit === 'string' && unit ? ` ${unit}` : ''}`;
      return { ...item, detail: `${item.detail} · ${doseText}` };
    }
  }
  if (item.category === 'pain') {
    const sev = payload['severity'];
    const ptype = payload['pain_type'];
    const bits = [
      typeof ptype === 'string' && ptype ? ptype : 'Pain',
      typeof sev === 'number' ? `${sev}/10` : null,
    ].filter(Boolean);
    return { ...item, detail: bits.join(' · ') };
  }
  // Nutrition carries the day's food story in the payload (food_label like
  // "Lunch — eggs, toast" plus the summed estimate): surface food names and
  // calories on the collapsed row so a scan is visible without expanding.
  if (item.category === 'nutrition') {
    const bits: string[] = [];
    const foodLabel =
      typeof payload['food_label'] === 'string' && payload['food_label'].trim()
        ? payload['food_label'].trim()
        : null;
    const kcal =
      typeof payload['calories_kcal'] === 'number' &&
      Number.isFinite(payload['calories_kcal'])
        ? Math.round(payload['calories_kcal'])
        : null;
    if (foodLabel) bits.push(foodLabel);
    if (kcal != null && kcal > 0) bits.push(`~${kcal} kcal`);
    if (bits.length > 0) return { ...item, detail: `${item.detail} · ${bits.join(' · ')}` };
  }
  return item;
}

// Main screen
// ---------------------------------------------------------------------------

export default function TimelineScreen() {
  const navigation = useNavigation<Nav>();
  const { height: windowH } = useWindowDimensions();
  const [filter, setFilter] = useState<FilterKey>('all');

  // ── On-device daily logs (full values) + concept names ──
  const [localItems, setLocalItems] = useState<HomeStoryItem[]>([]);
  const [localDays, setLocalDays] = useState<Set<string>>(new Set());
  const [localRefresh, setLocalRefresh] = useState(0);

  // Freshness stamp shared by the load effect and the focus gate below.
  const lastFocusReload = useRef(0);

  const loadLocal = useCallback(async () => {
    // Dev-only load timing (counts only, never item contents).
    const endLoadLog = perfStart('timeline.loadLocal');
    let itemCount = 0;
    try {
      const patientId = getCachedPatientId();
      if (!patientId) return;
      // Concept names (best-effort): turn symptom/vital UUIDs into labels.
      let names = new Map<string, string>();
      try {
        const concepts = await api.get<{ id: string; short_name: string | null; display_name: string }[]>(
          '/api/v1/ontology/manual-log-concepts',
        );
        names = new Map(
          (Array.isArray(concepts) ? concepts : []).map((c) => [
            c.id,
            c.short_name || c.display_name,
          ]),
        );
      } catch {
        // Offline — titles fall back to generic labels, values still show.
      }
      const meds = await dbGetMedications(patientId).catch(() => []);
      const medName = new Map(meds.map((m) => [m.medication_id, m.name]));
      const logs = await dbGetDailyLogs(patientId, 90).catch(() => []);
      // Concurrent event fetch — sequential awaits stall first paint.
      const perLog = await Promise.all(
        logs.map((log) => dbGetDailyLogEvents(patientId, log.group_id).catch(() => [])),
      );
      const out: HomeStoryItem[] = [];
      for (let li = 0; li < logs.length; li++) {
        const events = perLog[li] ?? [];
        for (const ev of events) {
          const item = storyItemFromLogEvent(
            {
              event_id: ev.event_id,
              group_id: ev.group_id,
              event_type: ev.event_type,
              concept_id: ev.concept_id,
              event_time: ev.event_time,
              payload_json: ev.payload_json,
              created_at: ev.created_at,
            },
            medName,
          );
          if (!item) continue;
          out.push(enrichLocalItem(item, ev.payload_json, ev.concept_id, names));
        }
      }
      out.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      // On-device pulse measurements (both modalities, newest first).
      // Source provenance rides in the title — "Pulse — Fingertip" vs
      // "Pulse — Face scan" — so the two methods are never confused.
      // Only real readings (non-null HR); unreliable runs were never stored.
      try {
        const [ppgRows, rppgRows] = await Promise.all([
          getRecentPpgMeasurements(patientId, 20).catch(() => []),
          getRecentRppgMeasurements(patientId, 20).catch(() => []),
        ]);
        for (const row of ppgRows) {
          if (row.heart_rate_bpm == null) continue;
          out.push({
            id: `ppg-${row.measurement_id}`,
            time: row.measured_at,
            dayKey: localDateString(new Date(row.measured_at)),
            category: 'vital',
            title: 'Pulse — Fingertip',
            detail: `${Math.round(row.heart_rate_bpm)} BPM · ${pulseQualityLabel(row.signal_quality)}`,
            icon: '✚',
          });
        }
        for (const row of rppgRows) {
          if (row.heart_rate_bpm == null) continue;
          out.push({
            id: `rppg-${row.measurement_id}`,
            time: row.measured_at,
            dayKey: localDateString(new Date(row.measured_at)),
            category: 'vital',
            title: 'Pulse — Face scan',
            detail: `${Math.round(row.heart_rate_bpm)} BPM · ${pulseQualityLabel(row.signal_quality)}`,
            icon: '✚',
          });
        }
      } catch {
        // Pulse history is additive; daily logs still render without it.
      }
      out.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      itemCount = out.length;
      setLocalItems(out);
      setLocalDays(new Set(out.map((i) => i.dayKey)));
    } catch {
      // Local-first is best-effort; the server timeline still renders.
    }
    endLoadLog(`items=${itemCount}`);
  }, []);

  useEffect(() => {
    // Every loadLocal run (mount, focus bump, manual refresh) stamps
    // freshness, so the focus gate above never re-fires for data that
    // was just loaded — including screen entry (mount + focus coincide).
    lastFocusReload.current = Date.now();
    void loadLocal();
  }, [loadLocal, localRefresh]);

  const query = useQuery({
    queryKey: ['timeline'],
    queryFn: async () => {
      const raw = await api.get<any>('/api/v1/timeline');

      // Unwrap common envelope shapes; fall back to a single item.
      let items: any[];
      if (Array.isArray(raw)) {
        items = raw;
      } else if (raw && typeof raw === 'object') {
        if (Array.isArray(raw.items)) {
          items = raw.items;
        } else if (Array.isArray(raw.data)) {
          items = raw.data;
        } else if (Array.isArray(raw.results)) {
          items = raw.results;
        } else {
          const arrayKey = Object.keys(raw).find((k) => Array.isArray(raw[k]));
          items = arrayKey ? raw[arrayKey] : [raw];
        }
      } else {
        items = [];
      }

      return items as TimelineItem[];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Reload on focus, time-gated to a 30 s freshness window: a daily log
  // saved on another screen writes to SQLite after this screen mounted, so
  // focus must refresh — but tab-hopping must not reload 90 days of SQLite
  // plus the full server timeline every time. Data loaded <30 s ago counts
  // as fresh; manual pull-to-refresh (`refresh` below) always bypasses.
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastFocusReload.current < 30_000) return;
      lastFocusReload.current = now;
      setLocalRefresh((n) => n + 1);
      void query.refetch();
    }, [query.refetch]),
  );

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    setLocalRefresh((n) => n + 1);
    await query.refetch();
    setRefreshing(false);
  };

  const goToDocument = useCallback(
    (docId: string) => navigation.navigate('DocumentDetail', { documentId: docId }),
    [navigation],
  );

  const serverItems = query.data ?? [];

  // Hide server daily-log duplicates only for days the on-device log covers
  // with full values; older server-only days still render (basic cards).
  const visibleServer = useMemo(
    () =>
      serverItems.filter((i) => {
        if (i.resource_type !== 'event') return true;
        const ev = i as TimelineEvent;
        if (!ev.event_type || !SERVER_DAILY_TYPES.has(ev.event_type.toUpperCase())) return true;
        return !localDays.has(dateKey(i));
      }),
    [serverItems, localDays],
  );

  type MergedItem =
    | { kind: 'local'; item: HomeStoryItem }
    | { kind: 'event'; item: TimelineEvent }
    | { kind: 'observation'; item: TimelineObservation };

  // Numeric sort key + day + display strings, computed ONCE at merge time so
  // render never allocates Dates or runs locale formatters per row.
  interface PreparedItem {
    node: MergedItem;
    key: string;
    timeMs: number;
    day: string;
    category: EventCategory;
    /** Short clock time for compact rows, e.g. "8:42 AM". */
    time: string;
  }

  function prepareItem(m: MergedItem): PreparedItem {
    const key = m.kind === 'local' ? `local-${m.item.id}` : m.item.id;
    const rawTime = m.kind === 'local' ? m.item.time : m.item.event_time;
    const timeMs = new Date(rawTime).getTime();
    const day = m.kind === 'local' ? m.item.dayKey : dateKey(m.item);
    const category = m.kind === 'local' ? localCategory(m.item) : classifyItem(m.item);
    const time = timeDisplay(typeof rawTime === 'string' ? rawTime : new Date(rawTime).toISOString());
    return { node: m, key, timeMs, day, category, time };
  }

  const merged: PreparedItem[] = useMemo(() => {
    const all: PreparedItem[] = [
      ...localItems.map((item) => prepareItem({ kind: 'local', item })),
      ...visibleServer.map((item) =>
        prepareItem(
          item.resource_type === 'observation'
            ? { kind: 'observation', item: item as TimelineObservation }
            : { kind: 'event', item: item as TimelineEvent },
        ),
      ),
    ];
    all.sort((a, b) => b.timeMs - a.timeMs);
    return all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localItems, visibleServer]);

  const filteredItems = useMemo(() => {
    if (filter === 'all') return merged;
    return merged.filter((i) => i.category === filter);
  }, [merged, filter]);

  // Each date is one white card: the section header caps the top, rows fill
  // the middle, the section footer caps the bottom. SectionList pins each
  // header natively (stickySectionHeadersEnabled). Section headers need no
  // sticky indices by construction.
  const sections = useMemo(() => {
    const grouped: { date: string; count: number; data: PreparedItem[] }[] = [];
    let current: { date: string; count: number; data: PreparedItem[] } | null = null;
    for (const item of filteredItems) {
      if (!current || current.date !== item.day) {
        current = { date: item.day, count: 0, data: [] };
        grouped.push(current);
      }
      current.data.push(item);
      current.count += 1;
    }
    return grouped;
  }, [filteredItems]);

  // ---- Book journal: view-model over the SAME merged sections -------------
  // No new data source: DiaryDay pages project PreparedItems (titles via the
  // existing titleFor + story fields, origin node kept opaque for the full
  // report renderer below).

  function toDiaryInput(item: PreparedItem): DiaryItemInput {
    const node = item.node;
    if (node.kind === 'local') {
      const s = node.item;
      return { key: item.key, time: item.time, category: item.category, title: s.title, detail: s.detail, meta: null, icon: s.icon ?? '', documentId: null, node };
    }
    if (node.kind === 'observation') {
      const o = node.item;
      return {
        key: item.key, time: item.time, category: item.category,
        title: o.finding_display_name, detail: (o.clinical_summary ?? '').slice(0, 120),
        meta: null, icon: '', documentId: null, node,
      };
    }
    const ev = node.item;
    const detail = ev.lab_result
      ? `${ev.lab_result.value}${ev.lab_result.unit ? ` ${ev.lab_result.unit}` : ''}`
      : ev.vital_sign
        ? `${ev.vital_sign.value} ${ev.vital_sign.unit}`
        : (ev.safe_notes ?? '').slice(0, 120);
    // Reference range + abnormal flag ride as a secondary line — real
    // values from the same record, surfaced in the document view.
    const metaBits: string[] = [];
    if (ev.lab_result?.reference_range) metaBits.push(`Ref: ${ev.lab_result.reference_range}`);
    if (ev.lab_result?.abnormal_flag) metaBits.push(`Flag: ${ev.lab_result.abnormal_flag}`);
    return {
      key: item.key, time: item.time, category: item.category,
      title: titleFor(ev), detail, meta: metaBits.length ? metaBits.join(' · ') : null, icon: '',
      documentId: ev.evidence?.document_id ?? null, node,
    };
  }

  const diaryDays: DiaryDay[] = useMemo(
    () => buildDiaryDays(sections.map((s) => ({ dayKey: s.date, items: s.data.map(toDiaryInput) }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections],
  );

  const route = useRoute<RouteProp<RootStackParamList, 'Timeline'>>();
  const { userProfile } = useAuth();
  const patientName = userProfile?.displayName ?? null;
  const [openDayKey, setOpenDayKey] = useState<string | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [focusDayKey, setFocusDayKey] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  // Day currently in front of the wheel. Drives the page indicator only;
  // updates once per page settle, never per animation frame.
  const [activeDayKey, setActiveDayKey] = useState<string | null>(null);
  const consumedAiNav = useRef<string | null>(null);

  const openDay = useCallback((dayKey: string, highlight: string | null = null) => {
    setHighlightKey(highlight);
    setOpenDayKey(dayKey);
  }, []);

  const closeSheet = useCallback(() => {
    setOpenDayKey(null);
    setHighlightKey(null);
  }, []);

  const resolveHighlight = useCallback(
    (day: DiaryDay, rawId: string): string | null => {
      const hit = day.items.find((i) => i.key === rawId || i.key === `local-${rawId}`);
      return hit ? hit.key : null;
    },
    [],
  );

  // AI navigation: search → date → bring that page to the front of the
  // wheel → open its 2/3 report → highlight the evidence row. Consumed
  // once per param so focus returns never re-trigger it.
  useEffect(() => {
    const target = route.params?.dateKey;
    if (!target || diaryDays.length === 0) return;
    const stamp = `${target}|${route.params?.highlightEventId ?? ''}`;
    if (consumedAiNav.current === stamp) return;
    const index = diaryDays.findIndex((d) => d.dayKey === target);
    if (index < 0) return;
    consumedAiNav.current = stamp;
    setFocusDayKey(target);
    setFocusNonce((n) => n + 1);
    const day = diaryDays[index];
    const raw = route.params?.highlightEventId;
    openDay(target, raw ? resolveHighlight(day, raw) : null);
    navigation.setParams({ dateKey: undefined, highlightEventId: undefined } as never);
  }, [route.params, diaryDays, navigation, openDay, resolveHighlight]);

  const openDayItem = diaryDays.find((d) => d.dayKey === openDayKey) ?? null;
  const patientId = getCachedPatientId();

  // Page-indicator model: index + month label for the day in front.
  const indicator = useMemo(() => {
    if (diaryDays.length === 0) return null;
    const idx = Math.max(
      0,
      diaryDays.findIndex((d) => d.dayKey === activeDayKey),
    );
    const day = diaryDays[idx];
    if (!day) return null;
    const month = new Date(`${day.dayKey}T00:00:00`).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
    return { idx, text: `${month} · ${idx + 1} of ${diaryDays.length}`, fullDate: day.fullDate };
  }, [diaryDays, activeDayKey]);

  // Single-select with toggle: tapping the active view releases back to All,
  // so a tap always shows ONLY the selected view — never a mixed state.
  const toggleFilter = useCallback(
    (key: FilterKey) => setFilter((prev) => (prev === key ? 'all' : key)),
    [],
  );

  // Stat strip taps isolate their view too.
  const STAT_FILTER: Record<string, FilterKey> = {
    logged: 'daily_log',
    records: 'medical_record',
    observations: 'observation',
  };

  const loggedCount = localItems.length;  const serverRecCount = useMemo(
    () => visibleServer.filter((i) => i.resource_type === 'event').length,
    [visibleServer],
  );
  const serverObsCount = useMemo(
    () => visibleServer.filter((i) => i.resource_type === 'observation').length,
    [visibleServer],
  );

  // Header (tappable stats + filter rail). No back control: this stack
  // route relies on the platform back path (swipe-back on iOS, system
  // back on Android).
  const listHeader = useMemo(
    () => (
      <View>
        {/* Metrics band. Everything here scrolls away together. */}
        {(() => {
          const stats = [
            { key: 'logged', n: loggedCount, label: loggedCount === 1 ? 'entry logged' : 'entries logged', color: GV.ink },
            { key: 'records', n: serverRecCount, label: serverRecCount === 1 ? 'record' : 'records', color: GV.ink },
            { key: 'observations', n: serverObsCount, label: serverObsCount === 1 ? 'observation' : 'observations', color: GV.ink },
          ];
          return (
            <View style={styles.statStrip}>
              {stats.map((s, i) => {
                const target = STAT_FILTER[s.key]!;
                const active = filter === target;
                return (
                  <Pressable
                    key={s.key}
                    onPress={() => toggleFilter(target)}
                    style={({ pressed }) => [
                      styles.stat,
                      i > 0 && styles.statDivided,
                      active && styles.statActive,
                      pressed && { opacity: 0.7 },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Show only ${s.label}, ${s.n}`}
                  >
                    <Text style={[styles.statNum, { color: s.color }]}>{s.n}</Text>
                    <Text style={[styles.statLabel, active && styles.statLabelActive]}>{s.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          );
        })()}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRail}
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Chip
                key={f.key}
                label={f.label}
                selected={active}
                color={f.key === 'all' ? GV.cta : toneForTimelineFilter(f.key)[0]}
                size="medium"
                onPress={() => toggleFilter(f.key)}
              />
            );
          })}
        </ScrollView>
      </View>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter, loggedCount, serverRecCount, serverObsCount, navigation, toggleFilter],
  );

  // -----------------------------------------------------------------------
  // Loading / error states
  // -----------------------------------------------------------------------

  if (query.isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <StageGradient variant="navy" />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={GV.teal} />
          <Text style={styles.centerText}>Loading timeline…</Text>
          <HealthFact style={styles.factText} />
        </View>
      </SafeAreaView>
    );
  }

  if (query.isError) {
    return (
      <SafeAreaView style={styles.container}>
        <StageGradient variant="navy" />
        <View style={styles.center}>
          <Text style={styles.centerText}>We couldn't load your timeline.</Text>
          <Button title="Try again" onPress={() => void query.refetch()} />
        </View>
      </SafeAreaView>
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StageGradient variant="navy" />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={GV.fog}
            colors={[GV.teal]}
          />
        }
      >
        {listHeader}
        {/* Page position: month + "n of N" for the day in front. The wheel
            snaps page-by-page, so this is its page control. */}
        {indicator ? (
          <View style={styles.pageIndicatorRow}>
            <Text
              style={styles.pageIndicator}
              accessibilityRole="text"
              accessibilityLabel={`Showing ${indicator.fullDate}, page ${indicator.idx + 1} of ${diaryDays.length}`}
            >
              {indicator.text}
            </Text>
          </View>
        ) : null}
        {/* The journal IS the wheel: ~fixed-height daily report pages stacked
            on an invisible vertical wheel. Dragging up/down turns it; the
            newest page sits in front and every older page fans out behind. */}
        <View style={[styles.wheelBox, { height: Math.max(400, Math.min(560, windowH * 0.52)) }]}>
          {diaryDays.length > 0 ? (
            <TimelineWheel
              days={diaryDays}
              patientName={patientName}
              focusDayKey={focusDayKey}
              focusNonce={focusNonce}
              onOpen={(key) => openDay(key)}
              onActiveChange={(key) => setActiveDayKey(key)}
            />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                {filter === 'all'
                  ? 'No events yet'
                  : `No ${FILTERS.find((f) => f.key === filter)?.label.toLowerCase() ?? 'events'} yet`}
              </Text>
              <Text style={styles.emptyText}>
                {filter === 'all'
                  ? 'Saved daily logs, medical records, observations, and verified records will appear here.'
                  : 'Try another filter, or log something today and come back.'}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
      {/* The opened page: 2/3 report over the untouched wheel. Full rows
          reuse the existing card renderers (same components, same handlers). */}
      <DiaryReportSheet
        visible={openDayKey !== null}
        day={openDayItem}
        days={diaryDays}
        patientName={patientName}
        patientId={patientId}
        highlightKey={highlightKey}
        onClose={closeSheet}
        onSelectDay={(dayKey) => {
          setHighlightKey(null);
          setOpenDayKey(dayKey);
        }}
        onDocumentPress={(docId) => goToDocument(docId)}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GV.stage,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  centerText: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
  },
  factText: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    maxWidth: 300,
  },
  content: {
    paddingHorizontal: SPACE.screenH,
    paddingBottom: 40,
  },

  // Header content lives in the list header (scrolls away together).
  // Wheel stage: pages overlay absolutely; height is set inline from the
  // window so the deck breathes on tall phones and tablets.
  wheelBox: {
    marginTop: SPACE.cardGap,
  },
  // Page position caption — the wheel's page control.
  pageIndicatorRow: {
    alignItems: 'flex-end',
    paddingRight: 4,
    marginTop: SPACE.cardGap,
  },
  pageIndicator: {
    fontFamily: FONT.semi,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.5,
color: GV.fog,
    fontVariant: ['tabular-nums'],
  },

  statStrip: {
    flexDirection: 'row',
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    paddingVertical: 8,
    marginBottom: SPACE.cardGap,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statActive: {
    backgroundColor: GV.wash,
  },
  statDivided: {
    borderLeftWidth: 1,
    borderLeftColor: GV.line,
  },
  statNum: {
    ...TYPE.title,
    fontVariant: ['tabular-nums'],
    color: GV.ink,
  },
  statLabel: {
    ...TYPE.caption,
    color: GV.body,
  },
  statLabelActive: {
    color: GV.ink,
    fontFamily: FONT.semi,
  },

  // Filters — horizontal rail of shared Chips.
  filterRail: {
    gap: 8,
    paddingRight: SPACE.screenH,
    paddingBottom: 8,
    paddingTop: 4,
  },

  // Event row — ledger rows inside the white day card. The glyph tile is
  // the only hue: a small flat fx square, white glyph, hairline rail.

  // Timeline track (glyph tile + vertical line)

  // Compact row body — title left, value right, specs beneath.

  // Badges — quiet pills on white

  // Data rows — hairline rules on white

  // Severity bar (for observations)

  // Note block

  // Scanned-meal breakdown (nutrition rows, on-device estimates)

  // Evidence — flat wash slip on white

  // Empty state
  empty: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyTitle: {
    ...TYPE.title,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  emptyText: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
    marginTop: 8,
  },
});
