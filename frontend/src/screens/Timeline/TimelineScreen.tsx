import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api } from '@/services/api';
import { Button, Chip } from '@/components';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { StageGradient } from '@/components/StageGradient';
import { getCachedPatientId } from '@/services/patientIdentity';
import { perfStart } from '@/utils/perfLog';
import { useHideTabBarOnScroll } from '@/components/tabBarVisibility';
import {
  getDailyLogs as dbGetDailyLogs,
  getDailyLogEvents as dbGetDailyLogEvents,
} from '@/db/queries/dailyLogs';
import { getMedications as dbGetMedications } from '@/db/queries/medications';
import { HealthFact } from '@/components/HealthFact';
import { getRecentPpgMeasurements } from '@/db/queries/ppg';
import { getRecentRppgMeasurements } from '@/db/queries/rppg';
import {
  listFoodScanBreakdowns,
  type FoodScanBreakdown,
} from '@/db/queries/foodScans';
import {
  storyItemFromLogEvent,
  localDateString,
  type HomeStoryItem,
} from '../Dashboard/homeData';
import type { RootStackParamList } from '@/types';
import { buildDiaryDays, type DiaryDay, type DiaryItemInput } from './diary';
import { DIARY_PAGE_HEIGHT, DiaryPagePreview, DiaryReportSheet } from './DiaryPaper';
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

// Marker colors per category — Guava functional hues, flat tiles on white.
// `bg` mirrors `color` (solid tile, white glyph); both flow into RowShell.
const CATEGORY_MARKER: Record<EventCategory, { color: string; bg: string }> = {
  daily_log:     { color: GV.fx.green, bg: GV.fx.green },
  medical_record:{ color: GV.fx.blue, bg: GV.fx.blue },
  symptom:       { color: GV.fx.pink, bg: GV.fx.pink },
  pain:          { color: GV.fx.amber, bg: GV.fx.amber },
  vital:         { color: GV.fx.sky, bg: GV.fx.sky },
  medication:    { color: GV.fx.green, bg: GV.fx.green },
  observation:   { color: GV.fx.purple, bg: GV.fx.purple },
  other:         { color: GV.fx.brown, bg: GV.fx.brown },
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
    case 'normal': return GV.fx.green;
    case 'mild_attention': return GV.fx.amber;
    case 'warning': return GV.danger;
    case 'critical': return GV.danger;
    default: return GV.muted;
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

/** One glyph family for every marker — system-font geometric shapes, never
 * mixed emoji styles. Color (domain hue) carries the meaning. */
const CATEGORY_GLYPH: Record<EventCategory, string> = {
  daily_log: '●',
  medical_record: '□',
  symptom: '◆',
  pain: '!',
  vital: '✚',
  medication: '△',
  observation: '◇',
  other: '○',
};

/** Local story sub-category → marker glyph (same family, same rule). */
function localGlyph(category: HomeStoryItem['category']): string {
  switch (category) {
    case 'sleep': return '●';
    case 'wellbeing': return '○';
    case 'activity': return '▲';
    case 'nutrition': return '■';
    case 'note': return '✎';
    case 'symptom': return '◆';
    case 'pain': return '!';
    case 'vital': return '✚';
    case 'medication': return '△';
    case 'document': return '□';
    default: return '○';
  }
}

/** Preferred accent per local category — domain hues, one per family. */
function localAccent(item: HomeStoryItem): { color: string; bg: string } {
  const base = CATEGORY_MARKER[localCategory(item)];
  switch (item.category) {
    case 'sleep':
      return { color: GV.fx.purple, bg: GV.fx.purple };
    case 'activity':
      return { color: GV.fx.green, bg: GV.fx.green };
    case 'nutrition':
      return { color: GV.fx.sky, bg: GV.fx.sky };
    case 'wellbeing':
    case 'note':
      return { color: GV.fx.amber, bg: GV.fx.amber };
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
/**
 * Compact ledger row — one calm line per moment: title left, value right,
 * time + specs beneath. Expandable rows reveal their details inline
 * (progressive disclosure); terminal rows render everything up front.
 */
function RowShell({
  color,
  bg,
  glyph,
  title,
  value,
  subline,
  a11yLabel,
  expanded,
  onToggle,
  children,
}: {
  color: string;
  glyph: string;
  title: string;
  value: string | null;
  subline: string;
  a11yLabel: string;
  expanded: boolean | null;
  onToggle?: () => void;
  children?: React.ReactNode;
  bg: string;
}) {
  const expandable = expanded !== null;
  const body = (
    <>
      <View style={styles.rowTop}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {value ? (
          <Text style={styles.rowValue} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {expandable ? (
          <Text style={styles.rowChev}>{expanded ? '⌄' : '›'}</Text>
        ) : null}
      </View>
      <Text style={styles.rowSub} numberOfLines={1}>
        {subline}
      </Text>
      {expandable && expanded ? (
        <View style={styles.rowDetails}>{children}</View>
      ) : null}
    </>
  );
  return (
    <View style={styles.eventRow}>
      <View style={styles.timelineTrack}>
        <View style={[styles.marker, { backgroundColor: color }]}>
          <Text style={[styles.markerGlyph, { color: '#FFFFFF' }]}>{glyph}</Text>
        </View>
        <View style={styles.timelineLine} />
      </View>
      <View style={styles.rowBody}>
        {expandable ? (
          <Pressable
            onPress={onToggle}
            style={({ pressed }) => [pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={a11yLabel}
          >
            {body}
          </Pressable>
        ) : (
          <View accessible accessibilityLabel={a11yLabel}>
            {body}
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * What the camera saw, per saved scan for the day: food names, grams,
 * kcal and macros, newest scan first. Estimates, labelled as estimates.
 * Rendered only inside an expanded nutrition row (loads on expand).
 */
function NutritionScanDetails({ dayKey }: { dayKey: string }) {
  const [scans, setScans] = useState<FoodScanBreakdown[] | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const patientId = getCachedPatientId();
        if (!patientId) {
          if (live) setScans([]);
          return;
        }
        const rows = await listFoodScanBreakdowns(patientId, dayKey).catch(() => []);
        if (live) setScans(rows);
      } catch {
        if (live) setScans([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [dayKey]);
  if (!scans || scans.length === 0) return null;
  return (
    <View style={styles.scanBlock}>
      {scans.map((scan) => (
        <View key={scan.scan_id} style={styles.scanMeal}>
          <View style={styles.dataRow}>
            <Text style={styles.dataLabel} numberOfLines={1}>
              {scan.meal_label}
            </Text>
            <Text style={styles.dataValue}>~{scan.total_kcal} kcal</Text>
          </View>
          {scan.items.map((food, i) => (
            <View key={`${scan.scan_id}-${i}`} style={styles.dataRow}>
              <Text style={styles.dataLabel} numberOfLines={1}>
                {food.label} · {food.grams}g
              </Text>
              <Text style={styles.dataValue} numberOfLines={1}>
                {food.kcal} kcal · P {food.protein_g}g · C {food.carbs_g}g · F {food.fat_g}g
              </Text>
            </View>
          ))}
        </View>
      ))}
      <Text style={styles.scanNote}>Estimate, not exact. Saved on this device.</Text>
    </View>
  );
}

function LoggedCard({ item, time }: { item: HomeStoryItem; time: string }) {
  const category = localCategory(item);
  const { color, bg } = localAccent(item);
  const { hero, sub } = splitHero(item.title, item.detail);
  const [open, setOpen] = useState(false);
  // Local rows are user-entered on this device (never server-inferred):
  // the expanded detail says so explicitly, matching the source badges on
  // server rows. Vitals measured by the camera appear on the dial, not here.
  return (
    <RowShell
      color={color}
      bg={bg}
      glyph={localGlyph(item.category)}
      title={item.title}
      value={hero}
      subline={sub ? `${time} · ${sub}` : time}
      a11yLabel={`${item.title}, ${hero}`}
      expanded={open}
      onToggle={() => setOpen((o) => !o)}
    >
      <View style={styles.badgeRow}>
        <View style={styles.sourceBadge}>
          <Text style={styles.sourceBadgeText}>On this device</Text>
        </View>
        <View style={styles.sourceBadge}>
          <Text style={styles.sourceBadgeText}>
            {item.category === 'vital' ? 'Entered by you' : 'You logged'}
          </Text>
        </View>
      </View>
      {item.detail ? (
        <View style={styles.noteBlock}>
          <Text style={styles.noteText}>{item.detail}</Text>
        </View>
      ) : null}
      {item.category === 'nutrition' && open ? (
        <NutritionScanDetails dayKey={item.dayKey} />
      ) : null}
    </RowShell>
  );
}

function ObservationCard({ observation, time }: { observation: TimelineObservation; time: string }) {
  const category = classifyItem(observation);
  const { color, bg } = CATEGORY_MARKER[category];
  const severityPct = Math.round(observation.visual_severity_score * 100);
  const [open, setOpen] = useState(false);
  const title = observation.finding_display_name;
  const value = `${severityPct}%`;
  const sub = `${time} · ${trendLabel(observation.trend)}`;

  return (
    <RowShell
      color={color}
      bg={bg}
      glyph={CATEGORY_GLYPH[category]}
      title={title}
      value={value}
      subline={sub}
      a11yLabel={`${title}, severity ${value}, ${sub}`}
      expanded={open}
      onToggle={() => setOpen((o) => !o)}
    >
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
    </RowShell>
  );
}

function EventCard({
  event,
  time,
  onDocumentPress,
}: {
  event: TimelineEvent;
  time: string;
  onDocumentPress: (docId: string) => void;
}) {
  const category = classifyItem(event);
  const { color, bg } = CATEGORY_MARKER[category];
  const [open, setOpen] = useState(false);

  const title = titleFor(event);
  const measure =
    event.vital_sign && event.vital_sign.value != null
      ? `${event.vital_sign.value}${event.vital_sign.unit ? ` ${event.vital_sign.unit}` : ''}`
      : event.lab_result
        ? `${event.lab_result.value}${event.lab_result.unit ? ` ${event.lab_result.unit}` : ''}`
        : null;
  const hasDetails = Boolean(
    event.vital_sign?.value != null ||
      event.lab_result ||
      event.safe_notes ||
      event.evidence,
  );

  return (
    <RowShell
      color={color}
      bg={bg}
      glyph={CATEGORY_GLYPH[category]}
      title={title}
      value={measure}
      subline={time}
      a11yLabel={measure ? `${title}, ${measure}` : title}
      expanded={hasDetails ? open : null}
      onToggle={hasDetails ? () => setOpen((o) => !o) : undefined}
    >
      {/* Source badges */}
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
            style={({ pressed }) => [styles.docLink, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.docLinkText}>View document</Text>
          </Pressable>
        )}
      </View>

      {/* Data rows (vital value already shown in the row) */}
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
              <Text style={[styles.dataFlag, { color: GV.danger }]}>
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
          style={({ pressed }) => [styles.evidenceBlock, pressed && { opacity: 0.7 }]}
          onPress={() => onDocumentPress(event.evidence!.document_id)}
        >
          <Text style={styles.evidenceTitle}>Source evidence</Text>
          <Text style={styles.evidenceText} numberOfLines={3}>
            {event.evidence.extracted_text}
          </Text>
        </Pressable>
      )}
    </RowShell>
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

  // Side tabs hide on scroll down, return on scroll up (pulse tab stays).
  const onTabScroll = useHideTabBarOnScroll();

  // Stable row renderer: a pure function of (item, goToDocument). Previously
  // an inline closure recreated on every parent render, defeating
  // SectionList's row memoization for rows whose props never changed.
  // Rows mount static — no entrance motion anywhere on this screen.
  const renderTimelineItem = useCallback(
    ({ item }: { item: PreparedItem }) => {
      const node = item.node;
      const time = item.time;
      if (node.kind === 'local') {
        return <MemoLoggedCard item={node.item} time={time} />;
      }
      if (node.kind === 'observation') {
        return <MemoObservationCard observation={node.item} time={time} />;
      }
      return (
        <MemoEventCard
          event={node.item}
          time={time}
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
      return { key: item.key, time: item.time, category: item.category, title: s.title, detail: s.detail, icon: s.icon ?? '', documentId: null, node };
    }
    if (node.kind === 'observation') {
      const o = node.item;
      return {
        key: item.key, time: item.time, category: item.category,
        title: o.finding_display_name, detail: (o.clinical_summary ?? '').slice(0, 120),
        icon: '', documentId: null, node,
      };
    }
    const ev = node.item;
    const detail = ev.lab_result
      ? `${ev.lab_result.value}${ev.lab_result.unit ? ` ${ev.lab_result.unit}` : ''}`
      : ev.vital_sign
        ? `${ev.vital_sign.value} ${ev.vital_sign.unit}`
        : (ev.safe_notes ?? '').slice(0, 120);
    return {
      key: item.key, time: item.time, category: item.category,
      title: titleFor(ev), detail, icon: '',
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
  const flatRef = useRef<FlatList<DiaryDay> | null>(null);
  const [openDayKey, setOpenDayKey] = useState<string | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
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

  // AI navigation: search → date → scroll the journal to that page → open
  // its 2/3 report → highlight the evidence row. Consumed once per param so
  // focus returns never re-trigger it; the FlatList stays mounted behind
  // the sheet, so dismissing returns to the exact scroll position.
  useEffect(() => {
    const target = route.params?.dateKey;
    if (!target || diaryDays.length === 0) return;
    const stamp = `${target}|${route.params?.highlightEventId ?? ''}`;
    if (consumedAiNav.current === stamp) return;
    const index = diaryDays.findIndex((d) => d.dayKey === target);
    if (index < 0) return;
    consumedAiNav.current = stamp;
    try {
      flatRef.current?.scrollToIndex({ index, viewPosition: 0.1, animated: true });
    } catch {
      // Fallback: estimated offset (fixed page height keeps this exact).
      flatRef.current?.scrollToOffset({ offset: index * (DIARY_PAGE_HEIGHT + 18), animated: true });
    }
    const day = diaryDays[index];
    const raw = route.params?.highlightEventId;
    openDay(target, raw ? resolveHighlight(day, raw) : null);
    navigation.setParams({ dateKey: undefined, highlightEventId: undefined } as never);
  }, [route.params, diaryDays, navigation, openDay, resolveHighlight]);

  const openDayItem = diaryDays.find((d) => d.dayKey === openDayKey) ?? null;

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
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
        >
          <Text style={styles.backBtnText}>‹ Back</Text>
        </Pressable>
        {/* Hero — one static title line on stage. No entrance motion. */}
        <View style={styles.heroScroll}>
          <Text style={styles.title}>Health Timeline</Text>
        </View>

        {/* …metrics below it. Everything here scrolls away together. */}
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
                color={GV.cta}
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
      <StageGradient />
      {/* The timeline IS the book: virtualized stack of daily report pages.
          Fixed page height → exact getItemLayout → AI scroll + preserved
          position on sheet dismiss (the list never unmounts). */}
      <FlatList
        ref={flatRef}
        data={diaryDays}
        keyExtractor={(day) => day.dayKey}
        getItemLayout={(_, index) => ({
          length: DIARY_PAGE_HEIGHT + 18,
          offset: (DIARY_PAGE_HEIGHT + 18) * index,
          index,
        })}
        onScroll={onTabScroll}
        scrollEventThrottle={16}
        windowSize={7}
        maxToRenderPerBatch={4}
        initialNumToRender={5}
        removeClippedSubviews
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={GV.fog}
            colors={[GV.teal]}
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
                : 'Try another filter, or log something today and come back.'}
            </Text>
          </View>
        }
        renderItem={({ item: day }) => (
          <DiaryPagePreview day={day} patientName={patientName} onOpen={(key) => openDay(key)} />
        )}
        onScrollToIndexFailed={(info) => {
          flatRef.current?.scrollToOffset({
            offset: info.index * (DIARY_PAGE_HEIGHT + 18),
            animated: true,
          });
        }}
      />
      {/* The opened page: 2/3 report over the untouched timeline. Full rows
          reuse the existing card renderers (same components, same handlers). */}
      <DiaryReportSheet
        visible={openDayKey !== null}
        day={openDayItem}
        days={diaryDays}
        patientName={patientName}
        highlightKey={highlightKey}
        renderRow={(diaryItem, _highlighted) =>
          renderTimelineItem({ item: diaryItem.node as PreparedItem })
        }
        onClose={closeSheet}
        onSelectDay={(dayKey) => {
          setHighlightKey(null);
          setOpenDayKey(dayKey);
        }}
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
    paddingBottom: 32,
  },

  // Header content lives in the list header (scrolls away together).
  backBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: SPACE.rPill,
    backgroundColor: GV.card,
    marginBottom: 16,
  },
  backBtnText: {
    ...TYPE.chip,
    color: GV.ink,
  },
  heroScroll: {
    marginBottom: 16,
  },
  // Screen title on stage — Poppins, centered.
  title: {
    ...TYPE.display,
    color: '#FFFFFF',
    textAlign: 'center',
  },

  // Stat strip — one white card, divided tappable stats, dark numerals.
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
    color: GV.muted,
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

  // Day section — a white card: header caps the top, rows fill the middle,
  // sectionFoot caps the bottom. Radius 20, no shadow, dark text.
  dateDivider: {
    backgroundColor: GV.card,
    borderTopLeftRadius: SPACE.rCard,
    borderTopRightRadius: SPACE.rCard,
    paddingHorizontal: SPACE.cardPad,
    paddingTop: 16,
    paddingBottom: 8,
  },
  dateHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateHeading: {
    ...TYPE.title,
    color: GV.ink,
  },
  dateCountPill: {
    minWidth: 24,
    height: 20,
    borderRadius: SPACE.rPill,
    backgroundColor: GV.wash,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  dateCountText: {
    ...TYPE.chip,
    color: GV.ink,
    fontVariant: ['tabular-nums'],
  },
  dateRule: {
    flex: 1,
    height: 1,
    backgroundColor: GV.line,
  },
  // Bottom cap of the day card; the gap below separates day cards.
  sectionFoot: {
    backgroundColor: GV.card,
    borderBottomLeftRadius: SPACE.rCard,
    borderBottomRightRadius: SPACE.rCard,
    height: 12,
    marginBottom: SPACE.cardGap,
  },

  // Event row — ledger rows inside the white day card. The glyph tile is
  // the only hue: a small flat fx square, white glyph, hairline rail.
  eventRow: {
    flexDirection: 'row',
    backgroundColor: GV.card,
    paddingRight: 8,
  },

  // Timeline track (glyph tile + vertical line)
  timelineTrack: {
    width: 44,
    alignItems: 'center',
  },
  marker: {
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
    backgroundColor: GV.wash,
  },
  markerGlyph: {
    fontSize: 15,
    fontFamily: FONT.bold,
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: GV.line,
    marginTop: 4,
    marginBottom: -8,
  },

  // Compact row body — title left, value right, specs beneath.
  rowBody: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 4,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowTitle: {
    flex: 1,
    ...TYPE.button,
    fontSize: 15,
    lineHeight: 20,
    color: GV.ink,
  },
  rowValue: {
    ...TYPE.button,
    fontSize: 15,
    color: GV.ink,
    fontVariant: ['tabular-nums'],
  },
  rowChev: {
    fontSize: 18,
    fontFamily: FONT.semi,
    color: GV.muted,
    width: 16,
    textAlign: 'center',
  },
  rowSub: {
    ...TYPE.caption,
    color: GV.muted,
    fontVariant: ['tabular-nums'],
  },
  rowDetails: {
    marginTop: 12,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: GV.line,
    gap: 0,
  },

  // Badges — quiet pills on white
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  sourceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: SPACE.rPill,
    backgroundColor: GV.wash,
  },
  sourceBadgeText: {
    ...TYPE.chip,
    color: GV.muted,
    fontSize: 10,
  },
  docLink: {
    marginLeft: 'auto',
  },
  docLinkText: {
    ...TYPE.chip,
    color: GV.ink,
  },

  // Data rows — hairline rules on white
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: GV.line,
    marginTop: 8,
    gap: 8,
  },
  dataLabel: {
    ...TYPE.caption,
    color: GV.muted,
    minWidth: 60,
  },
  dataValue: {
    ...TYPE.button,
    fontSize: 15,
    color: GV.ink,
    flex: 1,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  dataUnit: {
    ...TYPE.caption,
    color: GV.muted,
  },
  dataRef: {
    ...TYPE.caption,
    color: GV.muted,
    marginTop: 2,
    textAlign: 'right',
  },
  dataFlag: {
    ...TYPE.chip,
    color: GV.danger,
    marginTop: 2,
    textAlign: 'right',
  },

  // Severity bar (for observations)
  severityBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    justifyContent: 'flex-end',
  },
  severityBarTrack: {
    width: 80,
    height: 6,
    backgroundColor: GV.line,
    borderRadius: 3,
    overflow: 'hidden',
  },
  severityBarFill: {
    height: '100%',
    borderRadius: 3,
  },

  // Note block
  noteBlock: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: GV.line,
  },
  noteText: {
    ...TYPE.caption,
    color: GV.body,
    lineHeight: 20,
  },

  // Scanned-meal breakdown (nutrition rows, on-device estimates)
  scanBlock: {
    marginTop: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: GV.line,
    backgroundColor: GV.wash,
    borderRadius: 8,
    gap: 4,
  },
  scanMeal: {
    gap: 0,
  },
  scanNote: {
    ...TYPE.caption,
    fontSize: 12,
    color: GV.muted,
    marginTop: 4,
  },

  // Evidence — flat wash slip on white
  evidenceBlock: {
    marginTop: 8,
    backgroundColor: GV.wash,
    borderRadius: 8,
    padding: 12,
  },
  evidenceTitle: {
    ...TYPE.chip,
    color: GV.muted,
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  evidenceText: {
    ...TYPE.caption,
    color: GV.body,
    lineHeight: 18,
  },

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
