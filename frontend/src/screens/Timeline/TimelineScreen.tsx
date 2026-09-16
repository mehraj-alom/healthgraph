import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeInDown,
  FadeInLeft,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api } from '@/services/api';
import { AmbientBackground, Button, Card, Chip } from '@/components';
import { COLORS, BORDER_RADIUS, SPACING, TYPOGRAPHY } from '@/constants';
import { useReducedMotion } from '@/theme';
import { getCachedPatientId } from '@/services/patientIdentity';
import { perfStart } from '@/utils/perfLog';
import {
  getDailyLogs as dbGetDailyLogs,
  getDailyLogEvents as dbGetDailyLogEvents,
} from '@/db/queries/dailyLogs';
import { getMedications as dbGetMedications } from '@/db/queries/medications';
import { getRecentPpgMeasurements } from '@/db/queries/ppg';
import { getRecentRppgMeasurements } from '@/db/queries/rppg';
import {
  storyItemFromLogEvent,
  localDateString,
  type HomeStoryItem,
} from '../Dashboard/homeData';
import type { RootStackParamList } from '@/types';

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
// Warm clinical theme — scoped to this screen (cream canvas, ink + peach
// accents, warm ink typography). Matches the app-wide Dribbble reference.
// ---------------------------------------------------------------------------
const CLIN = {
  bg: '#EAE4D6',
  card: '#FFFBF3',
  ink: '#1D1B17',
  muted: '#797166',
  faint: '#E6DBC6',
  red: '#1D1B17',
  redSoft: '#FBEEDC',
};

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

// Marker colors per category — warm clinical set on the cream chart.
const CATEGORY_MARKER: Record<EventCategory, { color: string; bg: string }> = {
  daily_log:     { color: '#4E9B5F', bg: '#DDF0DF' },
  medical_record:{ color: '#4A90C2', bg: '#D9EAF7' },
  symptom:       { color: '#C2503E', bg: 'rgba(194, 80, 62, 0.10)' },
  pain:          { color: '#C2503E', bg: 'rgba(194, 80, 62, 0.10)' },
  vital:         { color: '#C96A1E', bg: '#FBE3C8' },
  medication:    { color: '#8A7BC8', bg: 'rgba(138, 123, 200, 0.12)' },
  observation:   { color: '#4A90C2', bg: '#D9EAF7' },
  other:         { color: '#797166', bg: '#F4EDDF' },
};

const CATEGORY_LABEL: Record<EventCategory, string> = {
  daily_log: 'Daily Log',
  medical_record: 'Medical Record',
  symptom: 'Symptom',
  pain: 'Pain',
  vital: 'Vital Sign',
  medication: 'Medication',
  observation: 'Observation',
  other: 'Clinical Event',
};

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

function displayDate(dateStr: string): string {
  const today = new Date();
  const date = new Date(dateStr + 'T00:00:00');
  const diffDays = Math.floor(
    (today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function timeDisplay(eventTime: string): string {
  return new Date(eventTime).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'PATIENT_REPORTED': return 'Patient';
    case 'AI_INFERRED': return 'AI';
    case 'DOCTOR_ENTERED': return 'Doctor';
    case 'IMAGING_REPORT': return 'Imaging';
    case 'LAB_REPORT': return 'Lab';
    case 'DEVICE_WEARABLE': return 'Device';
    case 'imaging_report': return 'Imaging';
    case 'lab_report': return 'Lab';
    case 'device_wearable': return 'Device';
    default: return source.replaceAll('_', ' ');
  }
}

/** Quality word for on-device pulse rows (matches the measure screens). */
function pulseQualityLabel(quality: number): string {
  if (quality >= 0.75) return 'Good';
  if (quality >= 0.5) return 'Fair';
  return 'Poor';
}

function trendLabel(trend: string): string {  switch (trend) {
    case 'improving': return '↓ Improving';
    case 'worsening': return '↑ Worsening';
    case 'stable': return '→ Stable';
    case 'resolved': return '✓ Resolved';
    default: return trend;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'normal': return '#2B8A3E';
    case 'mild_attention': return '#E67700';
    case 'warning': return '#D9480F';
    case 'critical': return CLIN.red;
    default: return '#5C6B7A';
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Local (on-device) daily-log entries — the value-rich timeline rows
// ---------------------------------------------------------------------------

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

/** Preferred accent per local category (deepened for the white chart). */
function localAccent(item: HomeStoryItem): { color: string; bg: string } {
  const base = CATEGORY_MARKER[localCategory(item)];
  switch (item.category) {
    case 'sleep':
      return { color: '#4263EB', bg: 'rgba(66, 99, 235, 0.08)' };
    case 'activity':
      return { color: '#0C8599', bg: 'rgba(12, 133, 153, 0.08)' };
    case 'nutrition':
      return { color: '#2B8A3E', bg: 'rgba(43, 138, 62, 0.08)' };
    case 'wellbeing':
    case 'note':
      return { color: '#E67700', bg: 'rgba(230, 119, 0, 0.10)' };
    default:
      return base;
  }
}

/**
 * Split a "value · spec · spec" detail line into a chart hero (first value)
 * and a muted spec line, without repeating the card title:
 * "Headache · 6/10 · 45 min" → hero "6/10", sub "45 min".
 */
function splitHero(title: string, detail: string): { hero: string; sub: string | null } {
  let d = detail.trim();
  if (d.toLowerCase().startsWith(title.toLowerCase())) {
    d = d.slice(title.length).replace(/^[\s·:|-]+/, '');
  }
  const parts = d.split('·').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { hero: title, sub: null };
  return { hero: parts[0]!, sub: parts.length > 1 ? parts.slice(1).join(' · ') : null };
}

/**
 * A logged moment with its actual values — e.g. "Sleep / 7h 30m · quality
 * 4/5", "Resting pulse / 72 bpm", "Paracetamol · 500 mg". Built from the
 * on-device daily log (full payload values), never just "reported by patient".
 */
function LoggedCard({ item, when }: { item: HomeStoryItem; when: string }) {
  const category = localCategory(item);
  const { color, bg } = localAccent(item);
  const { hero, sub } = splitHero(item.title, item.detail);
  return (
    <View style={styles.eventRow}>
      <View style={styles.timelineTrack}>
        <View style={[styles.marker, { backgroundColor: bg, borderColor: color }]}>
          <Text style={styles.markerIcon}>{item.icon}</Text>
        </View>
        <View style={styles.timelineLine} />
      </View>
      <View style={[styles.eventContent, { borderLeftColor: color }]}>
        <View style={styles.eventHeader}>
          <Text style={[styles.eventCategory, { color }]}>
            {CATEGORY_LABEL[category]}
          </Text>
          <Text style={styles.eventTime}>{when}</Text>
        </View>
        <Text style={styles.eventTitle} numberOfLines={1}>{item.title}</Text>
        {/* The logged value — chart hero: big ink reading, specs beneath */}
        <Text style={styles.loggedValue} numberOfLines={1} selectable>
          {hero}
        </Text>
        {sub ? (
          <Text style={styles.loggedSub} numberOfLines={1}>{sub}</Text>
        ) : null}
      </View>
    </View>
  );
}

function EventMarker({ category }: { category: EventCategory }) {
  const { color, bg } = CATEGORY_MARKER[category];
  return (
    <View style={[styles.marker, { backgroundColor: bg, borderColor: color }]}>
      <View style={[styles.markerDot, { backgroundColor: color }]} />
    </View>
  );
}

function ObservationCard({ observation, when }: { observation: TimelineObservation; when: string }) {
  const category = classifyItem(observation);
  const { color } = CATEGORY_MARKER[category];
  const severityPct = Math.round(observation.visual_severity_score * 100);

  return (
    <View style={styles.eventRow}>
      {/* Timeline line + marker */}
      <View style={styles.timelineTrack}>
        <EventMarker category={category} />
        <View style={styles.timelineLine} />
      </View>

      {/* Content */}
      <View style={[styles.eventContent, { borderLeftColor: color }]}>
        <View style={styles.eventHeader}>
          <Text style={[styles.eventCategory, { color }]}>
            {CATEGORY_LABEL[category]}
          </Text>
          <Text style={styles.eventTime}>{when}</Text>
        </View>

        <Text style={styles.eventTitle}>{observation.finding_display_name}</Text>

        {/* Body structure */}
        <View style={styles.badgeRow}>
          <View style={styles.sourceBadge}>
            <Text style={styles.sourceBadgeText}>
              {observation.structure_id.replace(/_/g, ' ')}
            </Text>
          </View>
          {observation.source_type && (
            <View style={styles.sourceBadge}>
              <Text style={styles.sourceBadgeText}>
                {sourceLabel(observation.source_type)}
              </Text>
            </View>
          )}
        </View>

        {/* Severity bar */}
        <View style={styles.dataRow}>
          <Text style={styles.dataLabel}>Severity</Text>
          <View style={styles.severityBarContainer}>
            <View style={styles.severityBarTrack}>
              <View
                style={[
                  styles.severityBarFill,
                  {
                    width: `${severityPct}%`,
                    backgroundColor: statusColor(observation.visual_status),
                  },
                ]}
              />
            </View>
            <Text style={styles.dataValue}>{severityPct}%</Text>
          </View>
        </View>

        {/* Trend */}
        <View style={styles.dataRow}>
          <Text style={styles.dataLabel}>Trend</Text>
          <Text style={styles.dataValue}>{trendLabel(observation.trend)}</Text>
        </View>

        {/* Finding code */}
        {observation.finding_code && (
          <View style={styles.dataRow}>
            <Text style={styles.dataLabel}>Code</Text>
            <Text style={[styles.dataValue, { fontSize: 12 }]}>
              {observation.finding_code}
            </Text>
          </View>
        )}

        {/* Clinical summary */}
        {observation.clinical_summary && (
          <View style={styles.noteBlock}>
            <Text style={styles.noteText}>{observation.clinical_summary}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function EventCard({
  event,
  when,
  onDocumentPress,
}: {
  event: TimelineEvent;
  when: string;
  onDocumentPress: (docId: string) => void;
}) {
  const category = classifyItem(event);
  const { color } = CATEGORY_MARKER[category];

  return (
    <View style={styles.eventRow}>
      {/* Timeline line + marker */}
      <View style={styles.timelineTrack}>
        <EventMarker category={category} />
        <View style={styles.timelineLine} />
      </View>

      {/* Content */}
      <View style={[styles.eventContent, { borderLeftColor: color }]}>
        <View style={styles.eventHeader}>
          <Text style={[styles.eventCategory, { color }]}>
            {CATEGORY_LABEL[category]}
          </Text>
          <Text style={styles.eventTime}>{when}</Text>
        </View>

        <Text style={styles.eventTitle}>{titleFor(event)}</Text>

        {/* Hero value — big ink reading + red unit */}
        {event.vital_sign && event.vital_sign.value != null ? (
          <Text style={styles.loggedValue} selectable>
            {event.vital_sign.value}
            {event.vital_sign.unit ? <Text style={styles.heroUnit}> {event.vital_sign.unit}</Text> : null}
          </Text>
        ) : null}
        {event.lab_result ? (
          <Text style={styles.loggedValue} selectable>
            {event.lab_result.value}
            {event.lab_result.unit ? <Text style={styles.heroUnit}> {event.lab_result.unit}</Text> : null}
          </Text>
        ) : null}

        {/* Source badge */}
        <View style={styles.badgeRow}>
          <View style={styles.sourceBadge}>
            <Text style={styles.sourceBadgeText}>{sourceLabel(event.source_type)}</Text>
          </View>
          {event.verification_status ? (
            <View style={styles.sourceBadge}>
              <Text style={styles.sourceBadgeText}>
                {event.verification_status.replaceAll('_', ' ').toLowerCase()}
              </Text>
            </View>
          ) : null}
          {event.evidence && (
            <Pressable
              onPress={() => onDocumentPress(event.evidence!.document_id)}
              style={styles.docLink}
            >
              <Text style={styles.docLinkText}>View document →</Text>
            </Pressable>
          )}
        </View>

        {/* Data rows (vital value already shown as hero above) */}
        {event.lab_result && (
          <View style={styles.dataRow}>
            <Text style={styles.dataLabel}>Result</Text>
            <View>
              <Text style={styles.dataValue}>
                {event.lab_result.value}{' '}
                <Text style={styles.dataUnit}>{event.lab_result.unit ?? ''}</Text>
              </Text>
              {event.lab_result.reference_range && (
                <Text style={styles.dataRef}>
                  Ref: {event.lab_result.reference_range}
                </Text>
              )}
              {event.lab_result.abnormal_flag && (
                <Text style={[styles.dataFlag, { color: CLIN.red }]}>
                  Flag: {event.lab_result.abnormal_flag}
                </Text>
              )}
            </View>
          </View>
        )}

        {event.safe_notes && (
          <View style={styles.noteBlock}>
            <Text style={styles.noteText}>{event.safe_notes}</Text>
          </View>
        )}

        {event.evidence && (
          <Pressable
            style={styles.evidenceBlock}
            onPress={() => onDocumentPress(event.evidence!.document_id)}
          >
            <Text style={styles.evidenceTitle}>📎 Source Evidence</Text>
            <Text style={styles.evidenceText} numberOfLines={3}>
              {event.evidence.extracted_text}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

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
  return item;
}

// Memoized rows — props come from memoized arrays, so refresh toggles and
// unrelated parent renders skip every card.
const MemoLoggedCard = memo(LoggedCard);
const MemoObservationCard = memo(ObservationCard);
const MemoEventCard = memo(EventCard);

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function TimelineScreen() {
  const navigation = useNavigation<Nav>();
  const [filter, setFilter] = useState<FilterKey>('all');
  const reducedMotion = useReducedMotion();

  // Resting heartbeat on the hero title: lub… dub… pause. Small amplitude,
  // slow cycle, UI-thread loop. Static text under reduced motion.
  const beat = useSharedValue(1);
  useEffect(() => {
    if (reducedMotion) return;
    beat.value = withRepeat(
      withSequence(
        withTiming(1.035, { duration: 150, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 170 }),
        withTiming(1.055, { duration: 130, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 230 }),
        withTiming(1, { duration: 1000 }),
      ),
      -1,
    );
  }, [beat, reducedMotion]);
  const beatStyle = useAnimatedStyle(() => ({
    transform: [{ scale: beat.value }],
  }));

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
            icon: '❤️',
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
            icon: '❤️',
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

  // Stable row renderer: a pure function of (item, goToDocument). Previously
  // an inline closure recreated on every parent render, defeating
  // SectionList's row memoization for rows whose props never changed.
  const renderTimelineItem = useCallback(
    ({ item }: { item: PreparedItem }) => {
      const node = item.node;
      const when = item.when;
      if (node.kind === 'local') {
        return <MemoLoggedCard item={node.item} when={when} />;
      }
      if (node.kind === 'observation') {
        return <MemoObservationCard observation={node.item} when={when} />;
      }
      return (
        <MemoEventCard
          event={node.item}
          when={when}
          onDocumentPress={goToDocument}
        />
      );
    },
    [goToDocument],
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
    when: string;
  }

  function prepareItem(m: MergedItem): PreparedItem {
    const key = m.kind === 'local' ? `local-${m.item.id}` : m.item.id;
    const rawTime = m.kind === 'local' ? m.item.time : m.item.event_time;
    const timeMs = new Date(rawTime).getTime();
    const day = m.kind === 'local' ? m.item.dayKey : dateKey(m.item);
    const category = m.kind === 'local' ? localCategory(m.item) : classifyItem(m.item);
    const when = `${displayDate(day)} · ${timeDisplay(typeof rawTime === 'string' ? rawTime : new Date(rawTime).toISOString())}`;
    return { node: m, key, timeMs, day, category, when };
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

  // Rising water, no index math: a SectionList pins each date deck
  // natively (stickySectionHeadersEnabled) while cards flow beneath the
  // translucent deck — every card visibly overlaps at the top as the water
  // moves upward. Section headers need no sticky indices by construction.
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

  // Header (back + hero + tappable stats + filter rail), memoized so filter
  // changes and refresh toggles don't re-measure/re-mount the list chrome.
  const listHeader = useMemo(
    () => (
      <View>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
        >
          <Text style={styles.backBtnText}>‹ Back</Text>
        </Pressable>
        {/* Hero first… single animated title line. */}
        <View style={styles.heroScroll}>
          <View style={styles.heroCompact}>
            <View style={styles.heroGlowA} pointerEvents="none" />
            <Animated.View entering={reducedMotion ? undefined : FadeInDown.duration(350)}>
              <Animated.Text style={[styles.title, !reducedMotion && beatStyle]}>
                Health Timeline
              </Animated.Text>
            </Animated.View>
            <Animated.View
              entering={reducedMotion ? undefined : FadeInLeft.delay(150).duration(400)}
              style={styles.titleRule}
            />
          </View>
        </View>

        {/* …metrics below it. Everything here scrolls away together. */}
        {(() => {
          const stats = [
            { key: 'logged', n: loggedCount, label: loggedCount === 1 ? 'entry logged' : 'entries logged', color: '#0E9F8A' },
            { key: 'records', n: serverRecCount, label: serverRecCount === 1 ? 'record' : 'records', color: '#2B6CB0' },
            { key: 'observations', n: serverObsCount, label: serverObsCount === 1 ? 'observation' : 'observations', color: '#6741D9' },
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
                    style={[styles.stat, i > 0 && styles.statDivided, active && styles.statActive]}
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
                color={COLORS.accentBlue}
                onPress={() => toggleFilter(f.key)}
              />
            );
          })}
        </ScrollView>
      </View>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter, loggedCount, serverRecCount, serverObsCount, navigation, toggleFilter, reducedMotion],
  );

  // -----------------------------------------------------------------------
  // Loading / error states
  // -----------------------------------------------------------------------

  if (query.isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.centerText}>Loading your clinical timeline…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (query.isError) {
    return (
      <SafeAreaView style={styles.container}>
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
      <AmbientBackground tone="clinical" />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.key}
        stickySectionHeadersEnabled
        windowSize={7}
        maxToRenderPerBatch={6}
        initialNumToRender={8}
        removeClippedSubviews
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            colors={[COLORS.primary]}
          />
        }
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {filter === 'all' ? 'No events yet' : `No ${FILTERS.find((f) => f.key === filter)?.label.toLowerCase() ?? 'events'} yet`}
            </Text>
            <Text style={styles.emptyText}>
              {filter === 'all'
                ? 'Saved daily logs, medical records, observations, and verified records will appear here.'
                : 'Try another filter — or log something today and come back.'}
            </Text>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.dateDivider}>
            <View style={styles.dateHeaderRow}>
              <Text style={styles.dateHeading}>{displayDate(section.date)}</Text>
              <View style={styles.dateCountPill}>
                <Text style={styles.dateCountText}>{section.count}</Text>
              </View>
              <View style={styles.dateRule} />
            </View>
          </View>
        )}
        renderItem={renderTimelineItem}
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
    backgroundColor: CLIN.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
    gap: SPACING.md,
  },
  centerText: {
    ...TYPOGRAPHY.body,
    color: CLIN.muted,
    textAlign: 'center',
  },
  content: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
  },

  // Header content lives in the list header (scrolls away together).
  backBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: CLIN.card,
    borderWidth: 1,
    borderColor: CLIN.faint,
    marginBottom: SPACING.sm,
  },
  backBtnText: {
    ...TYPOGRAPHY.captionStrong,
    color: CLIN.red,
  },
  heroScroll: {
    marginBottom: SPACING.sm,
  },
  // Header — white chart hero with red/blue glow
  heroCompact: {
    borderWidth: 1,
    borderColor: CLIN.faint,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: CLIN.card,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    overflow: 'hidden',
    shadowColor: '#16212C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  heroGlowA: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    top: -80,
    right: -50,
    backgroundColor: 'rgba(215, 38, 61, 0.07)',
  },
  title: {
    ...TYPOGRAPHY.h1,
    color: CLIN.ink,
  },
  titleRule: {
    width: 64,
    height: 3,
    borderRadius: 2,
    backgroundColor: CLIN.red,
    marginTop: SPACING.xs,
  },

  // Stat strip — one white surface, divided tappable stats
  statStrip: {
    flexDirection: 'row',
    backgroundColor: CLIN.card,
    borderWidth: 1,
    borderColor: CLIN.faint,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.xs,
    shadowColor: '#16212C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.md,
  },
  statActive: {
    backgroundColor: 'rgba(215, 38, 61, 0.06)',
  },
  statDivided: {
    borderLeftWidth: 1,
    borderLeftColor: CLIN.faint,
  },
  statNum: {
    ...TYPOGRAPHY.h2,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    ...TYPOGRAPHY.caption,
    color: CLIN.muted,
  },
  statLabelActive: {
    color: CLIN.red,
    fontWeight: '800',
  },

  // Filters — horizontal rail
  filterRail: {
    gap: SPACING.xs,
    paddingRight: SPACING.md,
    paddingBottom: SPACING.xs,
  },

  // Pinned date deck — translucent so cards visibly flow beneath it,
  // soft shadow so the overlap reads as floating, not clipped.
  dateDivider: {
    backgroundColor: 'rgba(245, 247, 250, 0.94)',
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
    marginBottom: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: CLIN.faint,
    shadowColor: '#16212C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  dateHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  dateHeading: {
    ...TYPOGRAPHY.overline,
    color: CLIN.ink,
    fontWeight: '800',
    letterSpacing: 1,
  },
  dateCountPill: {
    minWidth: 24,
    height: 20,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: CLIN.redSoft,
    borderWidth: 1,
    borderColor: 'rgba(215, 38, 61, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  dateCountText: {
    ...TYPOGRAPHY.label,
    color: CLIN.red,
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  dateRule: {
    flex: 1,
    height: 1,
    backgroundColor: CLIN.faint,
  },

  // Event row — compact: real margins only, no decorative gaps.
  eventRow: {
    flexDirection: 'row',
    marginBottom: SPACING.sm,
  },

  // Timeline track (marker + vertical line)
  timelineTrack: {
    width: 26,
    alignItems: 'center',
  },
  marker: {
    width: 20,
    height: 20,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
    backgroundColor: CLIN.card,
  },
  markerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: CLIN.faint,
    marginTop: 3,
    marginBottom: -6,
  },

  // Event content — compact white chart card with category rail
  eventContent: {
    flex: 1,
    backgroundColor: CLIN.card,
    borderWidth: 1,
    borderColor: CLIN.faint,
    borderLeftWidth: 3,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    marginLeft: SPACING.xs,
    shadowColor: '#16212C',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eventCategory: {
    ...TYPOGRAPHY.label,
    fontWeight: '800',
    letterSpacing: 0.6,
    fontSize: 10,
  },
  eventTime: {
    ...TYPOGRAPHY.caption,
    fontSize: 11,
    color: CLIN.muted,
    fontVariant: ['tabular-nums'],
  },
  eventTitle: {
    ...TYPOGRAPHY.bodyStrong,
    fontSize: 15,
    color: CLIN.ink,
  },

  // Logged value — chart hero: big ink reading, specs beneath in muted
  loggedValue: {
    fontSize: 24,
    fontWeight: '800',
    color: CLIN.ink,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  loggedSub: {
    fontSize: 12,
    color: CLIN.muted,
    marginTop: 1,
  },
  heroUnit: {
    fontSize: 14,
    fontWeight: '800',
    color: CLIN.red,
  },
  markerIcon: {
    fontSize: 10,
  },

  // Badges — light pill on paper
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  sourceBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: '#F1F4F7',
    borderWidth: 1,
    borderColor: CLIN.faint,
  },
  sourceBadgeText: {
    ...TYPOGRAPHY.label,
    color: CLIN.muted,
    fontSize: 10,
    fontWeight: '700',
  },
  docLink: {
    marginLeft: 'auto',
  },
  docLinkText: {
    ...TYPOGRAPHY.captionStrong,
    color: CLIN.red,
  },

  // Data rows — hairline rules on white
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.xs,
    borderTopWidth: 1,
    borderTopColor: CLIN.faint,
    marginTop: SPACING.xs,
    gap: SPACING.sm,
  },
  dataLabel: {
    ...TYPOGRAPHY.caption,
    color: CLIN.muted,
    minWidth: 60,
  },
  dataValue: {
    ...TYPOGRAPHY.bodyStrong,
    color: CLIN.ink,
    flex: 1,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  dataUnit: {
    ...TYPOGRAPHY.body,
    color: CLIN.red,
    fontWeight: '700',
  },
  dataRef: {
    ...TYPOGRAPHY.caption,
    color: CLIN.muted,
    marginTop: 2,
    textAlign: 'right',
  },
  dataFlag: {
    ...TYPOGRAPHY.captionStrong,
    marginTop: 2,
    textAlign: 'right',
  },

  // Severity bar (for observations)
  severityBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flex: 1,
    justifyContent: 'flex-end',
  },
  severityBarTrack: {
    width: 80,
    height: 6,
    backgroundColor: '#EDF1F5',
    borderRadius: 3,
    overflow: 'hidden',
  },
  severityBarFill: {
    height: '100%',
    borderRadius: 3,
  },

  // Note block — paper note
  noteBlock: {
    marginTop: SPACING.xs,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: CLIN.faint,
  },
  noteText: {
    ...TYPOGRAPHY.caption,
    color: '#3E4C59',
    lineHeight: 20,
  },

  // Evidence — inset paper slip
  evidenceBlock: {
    marginTop: SPACING.xs,
    borderTopWidth: 1,
    borderTopColor: CLIN.faint,
    backgroundColor: '#F7F9FB',
    borderWidth: 1,
    borderColor: CLIN.faint,
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.sm,
  },
  evidenceTitle: {
    ...TYPOGRAPHY.label,
    color: CLIN.muted,
    marginBottom: SPACING.xs,
  },
  evidenceText: {
    ...TYPOGRAPHY.caption,
    color: '#3E4C59',
    lineHeight: 18,
  },

  // Empty state
  empty: {
    paddingVertical: SPACING.xxl,
    alignItems: 'center',
  },
  emptyTitle: {
    ...TYPOGRAPHY.h3,
    color: CLIN.ink,
  },
  emptyText: {
    ...TYPOGRAPHY.body,
    color: CLIN.muted,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
});
