import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api } from '@/services/api';
import { Button, Card, Chip } from '@/components';
import { COLORS, BORDER_RADIUS, SPACING, TYPOGRAPHY } from '@/constants';
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
// Event type classification
// ---------------------------------------------------------------------------

type EventCategory = 'daily_log' | 'medical_record' | 'symptom' | 'vital' | 'observation' | 'other';

function classifyItem(item: TimelineItem): EventCategory {
  if (item.resource_type === 'observation') return 'observation';
  
  const t = item.event_type;
  if (
    t === 'WELLBEING_LOG' ||
    t === 'SLEEP_LOG' ||
    t === 'NUTRITION_LOG' ||
    t === 'ACTIVITY_LOG' ||
    t === 'pain_log'
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
  if (t === 'VITAL_SIGN') return 'vital';
  return 'other';
}

// Marker colors per category — restrained, clinical
const CATEGORY_MARKER: Record<EventCategory, { color: string; bg: string }> = {
  daily_log:     { color: '#31B7A5', bg: 'rgba(49, 183, 165, 0.12)' },
  medical_record:{ color: '#4D8DFF', bg: 'rgba(77, 141, 255, 0.12)' },
  symptom:       { color: '#F05F79', bg: 'rgba(240, 95, 121, 0.12)' },
  vital:         { color: '#4D8DFF', bg: 'rgba(77, 141, 255, 0.12)' },
  observation:   { color: '#9B6CFF', bg: 'rgba(155, 108, 255, 0.12)' },
  other:         { color: '#9AA8B8', bg: 'rgba(154, 168, 184, 0.12)' },
};

const CATEGORY_LABEL: Record<EventCategory, string> = {
  daily_log: 'Daily Log',
  medical_record: 'Medical Record',
  symptom: 'Symptom',
  vital: 'Vital Sign',
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
  { key: 'vital', label: 'Vitals' },
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

function trendLabel(trend: string): string {
  switch (trend) {
    case 'improving': return '↓ Improving';
    case 'worsening': return '↑ Worsening';
    case 'stable': return '→ Stable';
    case 'resolved': return '✓ Resolved';
    default: return trend;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'normal': return COLORS.success ?? '#34C759';
    case 'mild_attention': return COLORS.warning ?? '#FF9500';
    case 'warning': return COLORS.orange ?? '#FF9500';
    case 'critical': return COLORS.error ?? '#FF3B30';
    default: return '#9AA8B8';
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EventMarker({ category }: { category: EventCategory }) {
  const { color, bg } = CATEGORY_MARKER[category];
  return (
    <View style={[styles.marker, { backgroundColor: bg }]}>
      <View style={[styles.markerDot, { backgroundColor: color }]} />
    </View>
  );
}

function ObservationCard({ observation }: { observation: TimelineObservation }) {
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
      <View style={styles.eventContent}>
        <View style={styles.eventHeader}>
          <Text style={[styles.eventCategory, { color }]}>
            {CATEGORY_LABEL[category]}
          </Text>
          <Text style={styles.eventTime}>{timeDisplay(observation.event_time)}</Text>
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
  onDocumentPress,
}: {
  event: TimelineEvent;
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
      <View style={styles.eventContent}>
        <View style={styles.eventHeader}>
          <Text style={[styles.eventCategory, { color }]}>
            {CATEGORY_LABEL[category]}
          </Text>
          <Text style={styles.eventTime}>{timeDisplay(event.event_time)}</Text>
        </View>

        <Text style={styles.eventTitle}>{titleFor(event)}</Text>

        {/* Source badge */}
        <View style={styles.badgeRow}>
          <View style={styles.sourceBadge}>
            <Text style={styles.sourceBadgeText}>{sourceLabel(event.source_type)}</Text>
          </View>
          {event.evidence && (
            <Pressable
              onPress={() => onDocumentPress(event.evidence!.document_id)}
              style={styles.docLink}
            >
              <Text style={styles.docLinkText}>View document →</Text>
            </Pressable>
          )}
        </View>

        {/* Data rows */}
        {event.vital_sign && (
          <View style={styles.dataRow}>
            <Text style={styles.dataLabel}>Value</Text>
            <Text style={styles.dataValue}>
              {event.vital_sign.value}{' '}
              <Text style={styles.dataUnit}>{event.vital_sign.unit}</Text>
            </Text>
          </View>
        )}

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
                <Text style={[styles.dataFlag, { color: COLORS.warning }]}>
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

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function TimelineScreen() {
  const navigation = useNavigation<Nav>();
  const [filter, setFilter] = useState<FilterKey>('all');

  const query = useQuery({
    queryKey: ['timeline'],
    queryFn: async () => {
      const raw = await api.get<any>('/api/v1/timeline');
      
      // ── BUG 1 DIAGNOSTICS: Log exact raw response shape ──
      console.log('[GraphData] raw response type =', typeof raw);
      console.log('[GraphData] raw response keys =', raw !== null ? Object.keys(raw) : 'null');
      console.log('[GraphData] raw response isArray =', Array.isArray(raw));
      
      // Determine the actual items array
      let items: any[];
      if (Array.isArray(raw)) {
        items = raw;
      } else if (raw && typeof raw === 'object') {
        // Check common wrapper patterns
        const keys = Object.keys(raw);
        if ('items' in raw && Array.isArray(raw.items)) {
          console.log('[GraphData] response wrapped in { items: [...] }');
          items = raw.items;
        } else if ('data' in raw && Array.isArray(raw.data)) {
          console.log('[GraphData] response wrapped in { data: [...] }');
          items = raw.data;
        } else if ('results' in raw && Array.isArray(raw.results)) {
          console.log('[GraphData] response wrapped in { results: [...] }');
          items = raw.results;
        } else {
          console.log('[GraphData] response is object but not an array wrapper. Keys:', keys);
          // Try to find the first array-valued key
          const arrayKey = keys.find((k) => Array.isArray(raw[k]));
          if (arrayKey) {
            console.log(`[GraphData] found array at key "${arrayKey}"`);
            items = raw[arrayKey];
          } else {
            console.log('[GraphData] no array found in response — treating whole object as single item');
            items = [raw];
          }
        }
      } else {
        console.log('[GraphData] unexpected response shape:', raw);
        items = [];
      }

      console.log('[GraphData] raw response length =', items.length);
      
      if (items.length > 0) {
        const first = items[0];
        console.log('[GraphData] first record =', JSON.stringify(first, null, 2));
        console.log('[GraphData] first record keys =', Object.keys(first));
        console.log('[GraphData] first record.resource_type =', first.resource_type);
        console.log('[GraphData] first record.event_type =', first.event_type);
        console.log('[GraphData] first record.event_id =', first.event_id);
      }

      // ── Classify ──
      const events = items.filter((i: any) => i.resource_type === 'event');
      const observations = items.filter((i: any) => i.resource_type === 'observation');
      const unknown = items.filter((i: any) => i.resource_type !== 'event' && i.resource_type !== 'observation');
      
      console.log(`[GraphData] events = ${events.length}`);
      console.log(`[GraphData] observations = ${observations.length}`);
      console.log(`[GraphData] unknown resource_type = ${unknown.length}`);
      console.log(`[GraphData] total classified = ${events.length + observations.length + unknown.length}`);
      
      if (unknown.length > 0) {
        console.log('[GraphData] unknown resource_types:', 
          unknown.map((u: any) => u.resource_type));
      }

      // Count event types
      const eventTypes: Record<string, number> = {};
      events.forEach((e: any) => {
        const t = e.event_type ?? 'unknown';
        eventTypes[t] = (eventTypes[t] ?? 0) + 1;
      });
      console.log(`[GraphData] event types:`, JSON.stringify(eventTypes));
      
      // Count observation types
      const obsTypes: Record<string, number> = {};
      observations.forEach((o: any) => {
        const t = o.observation_type ?? 'unknown';
        obsTypes[t] = (obsTypes[t] ?? 0) + 1;
      });
      console.log(`[GraphData] observation types:`, JSON.stringify(obsTypes));
      
      return items as TimelineItem[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await query.refetch();
    setRefreshing(false);
  };

  const items = query.data ?? [];

  const filteredItems = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((i) => classifyItem(i) === filter);
  }, [items, filter]);

  // Group items by date
  const sections = useMemo(() => {
    const grouped: { date: string; items: TimelineItem[] }[] = [];
    let current: { date: string; items: TimelineItem[] } | null = null;

    for (const item of filteredItems) {
      const dk = dateKey(item);
      if (!current || current.date !== dk) {
        current = { date: dk, items: [] };
        grouped.push(current);
      }
      current.items.push(item);
    }

    return grouped;
  }, [filteredItems]);

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
      <FlatList
        data={sections}
        keyExtractor={(section) => section.date}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            colors={[COLORS.primary]}
          />
        }
        ListHeaderComponent={
          <View>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>Health Timeline</Text>
              <Text style={styles.subtitle}>
                Events, observations & clinical records
              </Text>
            </View>

            {/* Summary badges */}
            <View style={styles.summaryRow}>
              {(() => {
                const evCount = items.filter((i) => i.resource_type === 'event').length;
                const obsCount = items.filter((i) => i.resource_type === 'observation').length;
                return (
                  <>
                    {evCount > 0 && (
                      <View style={styles.summaryBadge} key="badge-events">
                        <Text style={styles.summaryBadgeText}>{evCount} events</Text>
                      </View>
                    )}
                    {obsCount > 0 && (
                      <View style={[styles.summaryBadge, { backgroundColor: 'rgba(155, 108, 255, 0.12)' }]} key="badge-observations">
                        <Text style={[styles.summaryBadgeText, { color: '#9B6CFF' }]}>{obsCount} observations</Text>
                      </View>
                    )}
                  </>
                );
              })()}
            </View>

            {/* Filters */}
            <View style={styles.filterRow}>
              {FILTERS.map((f) => {
                const active = filter === f.key;
                return (
                  <Chip
                    key={f.key}
                    label={f.label}
                    selected={active}
                    color={COLORS.accentBlue}
                    onPress={() => setFilter(f.key)}
                  />
                );
              })}
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No events yet</Text>
            <Text style={styles.emptyText}>
              Saved daily logs, medical records, observations, and verified records will
              appear here.
            </Text>
          </View>
        }
        renderItem={({ item: section }) => (
          <View style={styles.dateSection}>
            <Text style={styles.dateHeading}>{displayDate(section.date)}</Text>
            {section.items.map((item) => {
              if (item.resource_type === 'observation') {
                return (
                  <ObservationCard
                    key={item.id}
                    observation={item as TimelineObservation}
                  />
                );
              }
              return (
                <EventCard
                  key={item.id}
                  event={item as TimelineEvent}
                  onDocumentPress={(docId) =>
                    navigation.navigate('DocumentDetail', { documentId: docId })
                  }
                />
              );
            })}
          </View>
        )}
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
    backgroundColor: COLORS.background,
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
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  content: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
  },

  // Header — premium hero with subtle inner depth
  header: {
    paddingVertical: SPACING.md,
    marginBottom: SPACING.sm,
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

  // Summary badges
  summaryRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  summaryBadge: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: 'rgba(77, 141, 255, 0.12)',
  },
  summaryBadgeText: {
    ...TYPOGRAPHY.captionStrong,
    color: '#4D8DFF',
    fontSize: 12,
  },

  // Filters
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginBottom: SPACING.lg,
  },

  // Date sections — hairline separator with restrained gold date label
  dateSection: {
    marginBottom: SPACING.lg,
  },
  dateHeading: {
    ...TYPOGRAPHY.overline,
    color: COLORS.accentGold,
    marginBottom: SPACING.sm,
    letterSpacing: 1,
    opacity: 0.9,
  },

  // Event row (marker + content)
  eventRow: {
    flexDirection: 'row',
    marginBottom: SPACING.sm,
  },

  // Timeline track (marker + vertical line)
  timelineTrack: {
    width: 28,
    alignItems: 'center',
  },
  marker: {
    width: 20,
    height: 20,
    borderRadius: BORDER_RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  markerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  timelineLine: {
    flex: 1,
    width: 1.5,
    backgroundColor: COLORS.borderFaint,
    marginTop: 4,
    marginBottom: -4,
  },

  // Event content — elevated dark card with soft depth (Level 2)
  eventContent: {
    flex: 1,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.borderFaint,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginLeft: SPACING.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 3,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  eventCategory: {
    ...TYPOGRAPHY.label,
    letterSpacing: 0.3,
  },
  eventTime: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },
  eventTitle: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },

  // Badges — muted pill on sunken tone
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  sourceBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surfaceSunken,
    borderWidth: 1,
    borderColor: COLORS.borderFaint,
  },
  sourceBadgeText: {
    ...TYPOGRAPHY.label,
    color: COLORS.textSecondary,
    fontSize: 10,
  },
  docLink: {
    marginLeft: 'auto',
  },
  docLinkText: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.accent,
  },

  // Data rows — hairline on dark elevated
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.xs,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderFaint,
    marginTop: SPACING.xs,
    gap: SPACING.sm,
  },
  dataLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    minWidth: 60,
  },
  dataValue: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
    flex: 1,
    textAlign: 'right',
  },
  dataUnit: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
  },
  dataRef: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
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
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: 3,
    overflow: 'hidden',
  },
  severityBarFill: {
    height: '100%',
    borderRadius: 3,
  },

  // Note block — recessed sunken note
  noteBlock: {
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderFaint,
  },
  noteText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    lineHeight: 20,
  },

  // Evidence — sunken glass edge
  evidenceBlock: {
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderFaint,
    backgroundColor: COLORS.surfaceSunken,
    borderWidth: 1,
    borderColor: COLORS.borderFaint,
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.sm,
  },
  evidenceTitle: {
    ...TYPOGRAPHY.label,
    color: COLORS.textMuted,
    marginBottom: SPACING.xs,
  },
  evidenceText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    lineHeight: 18,
  },

  // Empty state
  empty: {
    paddingVertical: SPACING.xxl,
    alignItems: 'center',
  },
  emptyTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
  },
  emptyText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
});
