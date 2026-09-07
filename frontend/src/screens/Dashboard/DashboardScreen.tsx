import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, Dimensions, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useBodyState } from '@/hooks/useBodyState';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { useDocuments } from '@/context/DocumentsContext';
import { useAuth } from '@/context/AuthContext';
import { useCachedQuery } from '@/hooks/useCachedQuery';
import { useMedications } from '@/hooks/useMedications';
import { useSyncStatus, getSyncStatusMessage } from '@/hooks/useSyncStatus';
import { Card, ProcessingBadge } from '@/components';
import TrendsScreen from '@/screens/Trends/TrendsScreen';
import { COLORS, BORDER_RADIUS, SPACING, TYPOGRAPHY, CATEGORY_COLORS } from '@/constants';
import { statusLabel } from '@/services/documents';
import { api } from '@/services/api';
import type { RootStackParamList } from '@/types';
import type { DocumentListItem, PatientProfile, MedicationFrequency } from '@/types';

// ── Frequency labels (shared with MedicationsScreen) ──
const FREQUENCY_LABELS: Record<MedicationFrequency, string> = {
  ONCE_DAILY: 'Once daily',
  TWICE_DAILY: 'Twice daily',
  THREE_TIMES_DAILY: 'Three times daily',
  FOUR_TIMES_DAILY: 'Four times daily',
  EVERY_MORNING: 'Every morning',
  EVERY_EVENING: 'Every evening',
  EVERY_NIGHT: 'Every night',
  EVERY_8_HOURS: 'Every 8 hours',
  EVERY_12_HOURS: 'Every 12 hours',
  WEEKLY: 'Weekly',
  AS_NEEDED: 'As needed',
  CUSTOM: 'Custom',
};

// ── Greeting helper ──

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatMinutesToHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

type Nav = NativeStackNavigationProp<RootStackParamList>;

// ── MAIN COMPONENT ──

export default function DashboardScreen() {
  const navigation = useNavigation<Nav>();
  const { userProfile } = useAuth();
  const body = useBodyState();
  const metrics = useDailyMetrics();
  const docs = useDocuments();
  const { data: medications, refetch: refetchMedications } = useMedications();
  const syncStatus = useSyncStatus();
  const activeMedications = useMemo(
    () => (medications ?? []).filter(m => m.status === 'ACTIVE'),
    [medications],
  );

  useFocusEffect(
    useCallback(() => {
      void Promise.all([refetchMedications(), metrics.refetch()]);
    }, [refetchMedications, metrics.refetch]),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [showTrends, setShowTrends] = useState(false);
  const trendsSentinelRef = useRef<View>(null);
  const [connectivity, setConnectivity] = useState<'checking' | 'ok' | 'failed'>('checking');
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  // Lazy-load TrendsScreen when the sentinel becomes visible
  const handleTrendsSentinelLayout = useCallback(() => {
    if (!showTrends) setShowTrends(true);
  }, [showTrends]);

  // Profile query with caching
  const profileQuery = useCachedQuery<PatientProfile>({
    cacheKey: 'profile',
    queryFn: useCallback(() => api.get<PatientProfile>('/api/v1/profile'), []),
  });

  const profileName = profileQuery.data?.display_name ?? userProfile?.displayName ?? null;
  const greeting = getGreeting();

  // Network logging for development diagnostics
  useEffect(() => {
    if (__DEV__) {
      console.log('[DashboardPerf] requestsStarted=initial');
      console.log(`[DashboardPerf] cacheHit=profile cacheAge=${profileQuery.isFromCache ? 'cached' : 'fresh'}`);
      console.log(`[DashboardPerf] cacheHit=bodyState cacheAge=${body.isFromCache ? 'cached' : 'fresh'}`);
      console.log(`[DashboardPerf] cacheHit=dailyMetrics cacheAge=${metrics.isFromCache ? 'cached' : 'fresh'}`);
      console.log(`[DashboardPerf] requestsDeduped=0`);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    console.log('[DashboardPerf] requestsStarted=refresh');
    await Promise.all([
      body.refetch(),
      metrics.refetch(),
      docs.refetchDocuments(),
      profileQuery.refetch(),
    ]);
    console.log('[DashboardPerf] backgroundRefresh=true');
    setRefreshing(false);
  }, [body.refetch, metrics.refetch, docs.refetchDocuments, profileQuery.refetch]);

  const bodyItems = body.data ?? [];
  const clinical = metrics.data;
  const wellbeing = clinical?.today_wellbeing;
  const latestVitals = clinical?.latest_vitals ?? [];
  const heartRate = latestVitals.find((v) => {
    const name = v.display_name.toLowerCase();
    return name.includes('heart') && name.includes('rate');
  });
  const hrv = latestVitals.find((v) => {
    const name = v.display_name.toLowerCase();
    return name.includes('hrv') || name.includes('heart rate variability');
  });
  const recentDocs = docs.documents.slice(0, 5);
  const isNarrow = screenWidth < 340;

  // Compute a responsive score from the signals recorded today.
  const healthScore = useMemo(() => {
    const scores: number[] = [];
    if (wellbeing?.overall_wellbeing != null) scores.push(wellbeing.overall_wellbeing * 20);
    if (wellbeing?.energy_level != null) scores.push(wellbeing.energy_level * 20);
    if (wellbeing?.stress_level != null) scores.push((6 - wellbeing.stress_level) * 20);
    if (clinical?.latest_sleep?.sleep_quality != null) scores.push(clinical.latest_sleep.sleep_quality * 20);
    if (clinical?.latest_sleep) scores.push(Math.min(100, (clinical.latest_sleep.duration_minutes / 480) * 100));
    if (clinical?.today_activity) scores.push(Math.min(100, (clinical.today_activity.duration_minutes / 30) * 100));
    if (clinical?.latest_pain) scores.push(Math.max(0, 100 - clinical.latest_pain.severity * 10));
    if (scores.length === 0) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }, [clinical, wellbeing]);

  // ── Connectivity diagnostic ──
  useEffect(() => {
    let mounted = true;
    const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://10.22.93.11:8000';
    if (__DEV__) {
      console.log(`[NetworkDiag] API baseURL = ${API_URL}`);
      console.log('[NetworkDiag] connectivity test START');
    }
    const t0 = Date.now();
    fetch(`${API_URL}/health`)
      .then((res) => {
        const elapsed = Date.now() - t0;
        if (mounted) {
          if (res.ok) {
            if (__DEV__) {
              console.log(`[NetworkDiag] connectivity test SUCCESS status=${res.status} duration=${elapsed}ms`);
            }
            setConnectivity('ok');
          } else {
            if (__DEV__) {
              console.log(`[NetworkDiag] connectivity test FAILED status=${res.status} duration=${elapsed}ms`);
            }
            setConnectivity('failed');
          }
        }
      })
      .catch((err: any) => {
        const elapsed = Date.now() - t0;
        if (__DEV__) {
          console.error(`[NetworkDiag] connectivity test FAILED code=${err?.code ?? 'UNKNOWN'} message=${err?.message ?? String(err)} duration=${elapsed}ms`);
        }
        if (mounted) setConnectivity('failed');
      });
    return () => { mounted = false; };
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingLeft: insets.left + SPACING.md, paddingRight: insets.right + SPACING.md },
        ]}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={COLORS.primary} />
        }
      >
        {/* ── HEADER ── */}
        <HeaderSection profileName={profileName} greeting={greeting} navigation={navigation} />

        {/* ── SYNC STATUS ── */}
        {syncStatus.status !== 'SYNCED' && (
          <View style={styles.syncStatusContainer}>
            <Text style={styles.syncStatusText}>
              {getSyncStatusMessage(syncStatus.status)}
            </Text>
            {syncStatus.status === 'SYNC_FAILED' && (
              <Pressable onPress={syncStatus.retry} style={styles.syncRetryButton}>
                <Text style={styles.syncRetryText}>Retry</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* ── HEALTH OVERVIEW ── */}
        <View style={[styles.healthOverview, isNarrow && styles.healthOverviewNarrow]}>
          {/* Health Score */}
          <View style={[styles.healthScoreCard, styles.glassCard, !isNarrow && { flex: 1 }]}> 
            <View pointerEvents="none" style={styles.glassHighlight} />
            <Text style={styles.cardTitle}>Health Score</Text>
            <View style={styles.scoreContent}>
              <ScoreRing score={healthScore} size={100} />
            </View>
          </View>

          {/* Today's Summary */}
          <View style={[styles.summaryCard, styles.glassCard, !isNarrow && { flex: 1 }]}> 
            <View pointerEvents="none" style={styles.glassHighlight} />
            <View style={styles.summaryHeader}>
              <Text style={styles.cardTitle}>Today's Summary</Text>
              <Text style={styles.seeAll}>›</Text>
            </View>
            <View style={styles.summaryMetrics}>
              <SummaryMetric
                icon="❤️"
                iconBg={COLORS.pinkBg}
                label="Heart Rate"
                value={heartRate?.value}
                unit="bpm"
              />
              <SummaryMetric
                icon="📈"
                iconBg={COLORS.greenBg}
                label="HRV"
                value={hrv?.value}
                unit="ms"
              />
              <SummaryMetric
                icon="👟"
                iconBg={COLORS.tealBg}
                label="Activity"
                displayValue={clinical?.today_activity ? formatMinutesToHours(clinical.today_activity.duration_minutes) : undefined}
              />
              {clinical?.latest_sleep && (
                <SummaryMetric
                  icon="😴"
                  iconBg={COLORS.purpleBg}
                  label="Sleep"
                  displayValue={formatMinutesToHours(clinical.latest_sleep.duration_minutes)}
                />
              )}
            </View>
          </View>
        </View>

        {/* ── CONNECTIVITY BANNER ── */}
        {connectivity === 'failed' && (
          <View style={styles.connectivityBanner}>
            <Text style={styles.connectivityIcon}>⚠️</Text>
            <View style={styles.connectivityTextWrap}>
              <Text style={styles.connectivityTitle}>Backend unreachable</Text>
              <Text style={styles.connectivityHint}>
                Cannot reach the API server. Ensure your phone and laptop are on the same Wi-Fi network.
              </Text>
            </View>
          </View>
        )}

        {/* ── HEALTH GRAPH (Premium) ── */}
        <Pressable
          style={({ pressed }) => [
            styles.graphCard,
            pressed && styles.graphCardPressed,
          ]}
          onPress={() => navigation.navigate('HealthGraph' as any)}
          accessibilityRole="button"
          accessibilityLabel="Open Health Graph"
        >
          {/* Gradient background layers (no native gradient needed) */}
          <View style={styles.graphCardGradientBg} pointerEvents="none">
            <View style={[styles.graphCardGradientLayer, { backgroundColor: 'rgba(77, 141, 255, 0.07)', top: 0, left: 0, width: '100%', height: '60%' }]} />
            <View style={[styles.graphCardGradientLayer, { backgroundColor: 'rgba(155, 108, 255, 0.04)', bottom: 0, right: 0, width: '70%', height: '70%' }]} />
          </View>

          {/* Decorative network nodes + lines */}
          <View style={styles.graphNetworkBg} pointerEvents="none">
            <View style={[styles.graphNetNode, { top: 10, right: 18, width: 5, height: 5, backgroundColor: 'rgba(77, 141, 255, 0.18)' }]} />
            <View style={[styles.graphNetNode, { top: 22, right: 40, width: 3.5, height: 3.5, backgroundColor: 'rgba(155, 108, 255, 0.14)' }]} />
            <View style={[styles.graphNetNode, { top: 8, right: 52, width: 3, height: 3, backgroundColor: 'rgba(77, 141, 255, 0.10)' }]} />
            <View style={[styles.graphNetNode, { bottom: 12, right: 30, width: 4, height: 4, backgroundColor: 'rgba(155, 108, 255, 0.12)' }]} />
            <View style={[styles.graphNetLine, { top: 13, right: 22, width: 16, opacity: 0.08, transform: [{ rotate: '30deg' }] }]} />
            <View style={[styles.graphNetLine, { top: 11, right: 34, width: 12, opacity: 0.06, transform: [{ rotate: '-10deg' }] }]} />
            <View style={[styles.graphNetLine, { bottom: 14, right: 33, width: 10, opacity: 0.05, transform: [{ rotate: '55deg' }] }]} />
          </View>

          {/* Icon */}
          <View style={styles.graphCardIconWrap}>
            {/* Mini network graph icon */}
            <View style={styles.graphIconNet} pointerEvents="none">
              <View style={[styles.graphIconNode, { top: 4, left: 8, width: 5, height: 5, backgroundColor: '#7BA3FF' }]} />
              <View style={[styles.graphIconNode, { top: 14, left: 18, width: 4, height: 4, backgroundColor: '#9B6CFF' }]} />
              <View style={[styles.graphIconNode, { top: 5, left: 20, width: 3.5, height: 3.5, backgroundColor: '#4D8DFF' }]} />
              <View style={[styles.graphIconLine, { top: 7, left: 12, width: 10, transform: [{ rotate: '50deg' }] }]} />
              <View style={[styles.graphIconLine, { top: 6, left: 11, width: 12, transform: [{ rotate: '-15deg' }] }]} />
            </View>
          </View>

          {/* Text content */}
          <View style={styles.graphCardInfo}>
            <Text style={styles.graphCardTitle}>Health Graph</Text>
            <Text style={styles.graphCardSubtitle}>
              Explore your health connections
            </Text>
          </View>

          {/* Arrow */}
          <View style={styles.graphCardArrowWrap}>
            <Text style={styles.graphCardArrow}>›</Text>
          </View>
        </Pressable>

        {/* ── PROCESSING BADGE ── */}
        <ProcessingBadge onPress={() => navigation.navigate('DocumentUpload')} />

        {/* ── TODAY'S HEALTH ── */}
        <View style={styles.section}>
          <SectionHeader
            title="Today's Health"
            action="View all"
            onPress={() => navigation.navigate('DailyLog' as any)}
          />
          <Card padding="md">
            {metrics.isLoading ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : metrics.error ? (
              <Text style={styles.emptyText}>Unable to load health data.</Text>
            ) : (
              <View style={styles.metricGrid}>
                {wellbeing?.overall_wellbeing != null ? (
                  <MetricTile label="Wellbeing" value={`${wellbeing.overall_wellbeing}`} max={5} color={COLORS.teal} />
                ) : null}
                {wellbeing?.energy_level != null ? (
                  <MetricTile label="Energy" value={`${wellbeing.energy_level}`} max={5} color={COLORS.green} />
                ) : null}
                {wellbeing?.stress_level != null ? (
                  <MetricTile label="Stress" value={`${wellbeing.stress_level}`} max={5} color={COLORS.orange} />
                ) : null}
                {clinical?.latest_pain ? (
                  <MetricTile label="Pain" value={`${clinical.latest_pain.severity}`} max={10} color={COLORS.coral} />
                ) : null}
                {clinical?.today_activity ? (
                  <MetricTile label="Activity" value={`${clinical.today_activity.duration_minutes}m`} max={30} color={COLORS.teal} />
                ) : null}
              </View>
            )}
            {!metrics.isLoading && !wellbeing && !clinical?.latest_pain && !clinical?.today_activity ? (
              <Text style={styles.emptyText}>No wellbeing or pain log recorded today.</Text>
            ) : null}
          </Card>
        </View>

        {/* ── RECENT VITALS ── */}
        <View style={styles.section}>
          <SectionHeader title="Recent Vitals" />
          <Card padding="md">
            {metrics.isLoading ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : metrics.error ? (
              <Text style={styles.emptyText}>Unable to load vitals.</Text>
            ) : clinical?.latest_vitals.length ? (
              clinical.latest_vitals.map((vital) => (
                <View key={`${vital.concept_id}-${vital.unit}`} style={styles.vitalRow}>
                  <View style={styles.vitalLeft}>
                    <View style={[styles.vitalDot, { backgroundColor: COLORS.accent }]} />
                    <View>
                      <Text style={styles.vitalName}>{vital.display_name}</Text>
                      <Text style={styles.vitalDate}>
                        {new Date(vital.event_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.vitalRight}>
                    <Text style={styles.vitalValue}>{vital.value}</Text>
                    <Text style={styles.vitalUnit}>{vital.unit}</Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={styles.emptyText}>No daily vitals recorded yet.</Text>
            )}
          </Card>
        </View>

        {/* ── RECENT RECORDS ── */}
        {recentDocs.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Recent Records"
              action="See all"
              onPress={() => navigation.navigate('DocumentUpload')}
            />
            {recentDocs.map((doc) => (
              <DocumentCard
                key={doc.document_id}
                document={doc}
                onPress={() => navigation.navigate('DocumentDetail', { documentId: doc.document_id })}
              />
            ))}
          </View>
        )}

        {/* ── LATEST SLEEP ── */}
        {clinical?.latest_sleep && (
          <View style={styles.section}>
            <SectionHeader title="Latest Sleep" />
            <Card padding="md">
              <View style={styles.sleepStats}>
                <SleepStat label="Duration" value={formatMinutesToHours(clinical.latest_sleep.duration_minutes)} color={COLORS.purple} />
                {clinical.latest_sleep.sleep_quality != null && (
                  <SleepStat label="Quality" value={`${clinical.latest_sleep.sleep_quality}/5`} color={COLORS.teal} />
                )}
                {clinical.latest_sleep.awakenings != null && (
                  <SleepStat label="Awakenings" value={String(clinical.latest_sleep.awakenings)} color={COLORS.orange} />
                )}
              </View>
            </Card>
          </View>
        )}

        {/* ── BODY STATUS ── */}
        {bodyItems.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Body Status" subtitle="Anatomical observations" />
            {bodyItems.slice(0, 3).map((item) => (
              <Card key={item.structure_id} padding="md" style={styles.bodyCard}>
                <View style={styles.vitalRow}>
                  <View style={styles.vitalLeft}>
                    <View style={[styles.vitalDot, { backgroundColor: COLORS.teal }]} />
                    <View>
                      <Text style={styles.vitalName}>{item.display_name}</Text>
                      <Text style={styles.vitalDate}>{item.latest_summary ?? item.trend}</Text>
                    </View>
                  </View>
                  <StatusBadge status={item.visual_status} />
                </View>
              </Card>
            ))}
          </View>
        )}

        {/* ── ACTIVE MEDICATIONS ── */}
        {activeMedications.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Active Medications"
              action="See all"
              onPress={() => navigation.navigate('Medications')}
            />
            <Card padding="md" style={styles.medicationCard}>
              <View style={styles.medicationRow}>
                <Text style={styles.medicationCount}>{activeMedications.length} active</Text>
              </View>
              {activeMedications.slice(0, 2).map((med) => (
                <View key={med.medication_id} style={styles.medicationItem}>
                  <View style={styles.medicationItemLeft}>
                    <Text style={styles.medicationItemName}>{med.name}</Text>
                    <Text style={styles.medicationItemDetail}>
                      {med.strength}{med.strength_unit ? ` ${med.strength_unit}` : ''}
                      {med.frequency ? ` · ${FREQUENCY_LABELS[med.frequency] ?? med.frequency}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          </View>
        )}

        {/* ── TRENDS (lazy-loaded when scrolled into view) ── */}
        <View style={styles.section} onLayout={handleTrendsSentinelLayout}>
          <SectionHeader title="Health Trends" />
          {showTrends ? (
            <TrendsScreen embedded />
          ) : (
            <View ref={trendsSentinelRef} style={{ height: 120, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={COLORS.primary} />
            </View>
          )}
        </View>

        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── SUB-COMPONENTS ──

function HeaderSection({
  profileName,
  greeting,
  navigation,
}: {
  profileName: string | null;
  greeting: string;
  navigation: Nav;
}) {
  const initials = getInitials(profileName);

  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={styles.greetingContainer}>
          <Text style={styles.greetingLabel}>{greeting},</Text>
          <Text style={styles.greetingName}>{profileName || 'User'} 👋</Text>
        </View>
      </View>
      <View style={styles.headerRight}>
        <Pressable
          style={styles.headerIconButton}
          accessibilityRole="button"
          accessibilityLabel="Notifications"
        >
          <Text style={styles.headerIcon}>🔔</Text>
        </Pressable>
        <Pressable
          style={styles.headerIconButton}
          accessibilityRole="button"
          accessibilityLabel="Account settings"
          onPress={() => navigation.navigate('Settings')}
        >
          <View style={styles.avatarSmall}>
            <Text style={styles.avatarSmallText}>{initials}</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

function ScoreRing({ score, size }: { score: number | null; size: number }) {
  const statusColor = score === null
    ? COLORS.textMuted
    : score >= 80
      ? COLORS.green
      : score >= 60
        ? COLORS.warning
        : COLORS.error;

  return (
    <View style={[styles.scoreRingOuter, { width: size, height: size }]}>
      <View style={[styles.scoreRingInner, { width: size - 12, height: size - 12 }]}>
        {score !== null ? (
          <>
            <Text style={[styles.scoreNumber, { color: statusColor }]}>{score}</Text>
            <Text style={styles.scoreLabel}>
              {score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : 'Fair'}
            </Text>
          </>
        ) : (
          <>
            <Text style={[styles.scoreNumber, { color: COLORS.textMuted }]}>—</Text>
            <Text style={styles.scoreLabel}>No data</Text>
          </>
        )}
      </View>
    </View>
  );
}

function SummaryMetric({
  icon,
  iconBg,
  label,
  value,
  unit,
  displayValue,
}: {
  icon: string;
  iconBg: string;
  label: string;
  value?: number;
  unit?: string;
  displayValue?: string;
}) {
  return (
    <View style={styles.summaryMetric}>
      <View style={[styles.summaryMetricIcon, { backgroundColor: iconBg }]}>
        <Text style={styles.summaryMetricIconText}>{icon}</Text>
      </View>
      <View style={styles.summaryMetricInfo}>
        <Text style={styles.summaryMetricLabel}>{label}</Text>
        <Text style={styles.summaryMetricValue}>
          {displayValue ?? (value != null ? `${value}` : '—')}
          {unit && !displayValue && value != null ? ` ${unit}` : ''}
        </Text>
      </View>
    </View>
  );
}

function SectionHeader({
  title,
  subtitle,
  action,
  onPress,
}: {
  title: string;
  subtitle?: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderLeft}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {action && onPress ? (
        <Pressable onPress={onPress}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const MetricTile = React.memo(function MetricTile({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: string;
  max: number;
  color: string;
}) {
  const numericValue = parseFloat(value);
  const percentage = (numericValue / max) * 100;

  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricTileLabel}>{label}</Text>
      <View style={styles.metricTileBar}>
        <View
          style={[
            styles.metricTileBarFill,
            {
              width: `${Math.min(percentage, 100)}%`,
              backgroundColor: color,
            },
          ]}
        />
      </View>
      <Text style={[styles.metricTileValue, { color }]}>{value}<Text style={styles.metricTileMax}>/{max}</Text></Text>
    </View>
  );
});

const DocumentCard = React.memo(function DocumentCard({
  document,
  onPress,
}: {
  document: DocumentListItem;
  onPress: () => void;
}) {
  const date = new Date(document.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const isActive = document.status === 'UPLOADED' || document.status === 'PROCESSING' || document.status === 'EXTRACTED';

  return (
    <Card padding="md" onPress={onPress} style={styles.docCard}>
      <View style={styles.docRow}>
        <View style={styles.docIcon}>
          <Text style={styles.docIconText}>📄</Text>
        </View>
        <View style={styles.docInfo}>
          <Text style={styles.docTitle} numberOfLines={1}>
            {document.file_hash.slice(0, 12)}
          </Text>
          <Text style={styles.docDate}>{date}</Text>
        </View>
        <View style={styles.docStatus}>
          {isActive && <ActivityIndicator size="small" color={COLORS.primary} style={styles.docSpinner} />}
          <Text
            style={[
              styles.docStatusText,
              document.status === 'COMPLETED'
                ? styles.statusComplete
                : document.status === 'FAILED'
                  ? styles.statusFailed
                  : styles.statusActive,
            ]}
          >
            {statusLabel(document.status)}
          </Text>
        </View>
      </View>
    </Card>
  );
});

const SleepStat = React.memo(function SleepStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.sleepStat}>
      <Text style={styles.sleepStatLabel}>{label}</Text>
      <Text style={[styles.sleepStatValue, { color }]}>{value}</Text>
    </View>
  );
});

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'normal'
      ? COLORS.green
      : status === 'mild_attention'
        ? COLORS.warning
        : status === 'warning'
          ? COLORS.orange
          : COLORS.error;

  return (
    <View style={[styles.statusBadge, { backgroundColor: color + '20' }]}>
      <Text style={[styles.statusBadgeText, { color }]}>{status.replace('_', ' ')}</Text>
    </View>
  );
}

// ── STYLES ──

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    paddingVertical: SPACING.md,
    paddingBottom: SPACING.xxl,
    gap: SPACING.md,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    gap: SPACING.md,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    minWidth: 0,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    ...TYPOGRAPHY.h3,
    color: '#07111F',
    fontWeight: '700',
  },
  greetingContainer: {
    flex: 1,
    minWidth: 0,
  },
  greetingLabel: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
    fontSize: 13,
  },
  greetingName: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
    fontSize: 16,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flexShrink: 0,
  },
  headerIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  headerIcon: {
    fontSize: 18,
  },
  avatarSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSmallText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#07111F',
  },

  // ── Sync Status ──
  syncStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.sm,
    marginBottom: SPACING.sm,
  },
  syncStatusText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  syncRetryButton: {
    marginLeft: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.sm,
  },
  syncRetryText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },

  // ── Health Overview ──
  healthOverview: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  healthOverviewNarrow: {
    flexDirection: 'column',
  },
  healthScoreCard: {
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    minWidth: 0,
  },
  cardTitle: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.textSecondary,
    fontSize: 13,
    marginBottom: SPACING.sm,
  },
  scoreContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
  },
  scoreRingOuter: {
    borderRadius: 999,
    borderWidth: 3,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreRingInner: {
    borderRadius: 999,
    backgroundColor: COLORS.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreNumber: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 32,
  },
  scoreLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  summaryCard: {
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    minWidth: 0,
  },
  glassCard: {
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  glassHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: COLORS.glassHighlight,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  seeAll: {
    fontSize: 18,
    color: COLORS.textMuted,
  },
  summaryMetrics: {
    gap: SPACING.xs,
  },
  summaryMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: 4,
  },
  summaryMetricIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryMetricIconText: {
    fontSize: 14,
  },
  summaryMetricInfo: {
    flex: 1,
  },
  summaryMetricLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    fontSize: 11,
  },
  summaryMetricValue: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
    fontSize: 14,
    marginTop: 1,
  },

  // ── Section ──
  section: {
    gap: SPACING.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionHeaderLeft: {
    flex: 1,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
  },
  sectionSubtitle: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  sectionAction: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.primary,
  },

  // ── Metric Grid ──
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  metricTile: {
    minWidth: 70,
    flexGrow: 1,
    gap: 4,
  },
  metricTileLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    fontSize: 11,
  },
  metricTileBar: {
    height: 4,
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: 2,
    overflow: 'hidden',
    marginVertical: 4,
  },
  metricTileBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  metricTileValue: {
    ...TYPOGRAPHY.bodyStrong,
    fontSize: 16,
  },
  metricTileMax: {
    fontSize: 12,
    color: COLORS.textMuted,
  },

  // ── Vitals ──
  vitalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  vitalLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flex: 1,
  },
  vitalDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  vitalName: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
    fontSize: 14,
  },
  vitalDate: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 1,
  },
  vitalRight: {
    alignItems: 'flex-end',
  },
  vitalValue: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
    fontSize: 16,
  },
  vitalUnit: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    fontSize: 11,
  },

  // ── Document Cards ──
  docCard: {
    marginBottom: SPACING.xs,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  docIcon: {
    width: 40,
    height: 40,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docIconText: {
    fontSize: 18,
  },
  docInfo: {
    flex: 1,
  },
  docTitle: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
  },
  docDate: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  docStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  docSpinner: {
    marginRight: 2,
  },
  docStatusText: {
    ...TYPOGRAPHY.captionStrong,
  },
  statusComplete: { color: COLORS.success },
  statusFailed: { color: COLORS.error },
  statusActive: { color: COLORS.primary },

  // ── Sleep ──
  sleepStats: {
    flexDirection: 'row',
    gap: SPACING.lg,
  },
  sleepStat: {
    alignItems: 'center',
    flex: 1,
  },
  sleepStatLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    fontSize: 11,
    marginBottom: 4,
  },
  sleepStatValue: {
    ...TYPOGRAPHY.metricSmall,
    fontSize: 20,
  },

  // ── Body Status ──
  bodyCard: {
    marginBottom: SPACING.xs,
  },
  statusBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
  },
  statusBadgeText: {
    ...TYPOGRAPHY.captionStrong,
    fontSize: 11,
    textTransform: 'capitalize',
  },

  // ── Active Medications ──
  medicationCard: {
    gap: SPACING.sm,
  },
  medicationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  medicationCount: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
  },
  medicationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.xs,
  },
  medicationItemLeft: {
    flex: 1,
  },
  medicationItemName: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
  },
  medicationItemDetail: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },

  // ── Connectivity Banner ──
  connectivityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: 'rgba(255, 59, 48, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 48, 0.25)',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
  },
  connectivityIcon: {
    fontSize: 20,
  },
  connectivityTextWrap: {
    flex: 1,
  },
  connectivityTitle: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.error,
    fontSize: 13,
  },
  connectivityHint: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },

  // ── Health Graph Card (Premium Glass) ──
  graphCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141929',
    borderRadius: BORDER_RADIUS.lg + 2,
    padding: SPACING.md,
    paddingVertical: 16,
    gap: SPACING.md,
    borderWidth: 1,
    borderColor: 'rgba(77, 141, 255, 0.12)',
    overflow: 'hidden',
    shadowColor: '#4D8DFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 12,
    elevation: 6,
  },
  graphCardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  graphCardGradientBg: {
    ...StyleSheet.absoluteFill,
  },
  graphCardGradientLayer: {
    position: 'absolute',
  },
  // ── Decorative network background ──
  graphNetworkBg: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  graphNetNode: {
    position: 'absolute',
    borderRadius: 999,
  },
  graphNetLine: {
    position: 'absolute',
    height: 1,
    backgroundColor: '#4D8DFF',
    borderRadius: 1,
  },
  // ── Icon with mini network graph ──
  graphCardIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(77, 141, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderWidth: 1,
    borderColor: 'rgba(77, 141, 255, 0.18)',
    shadowColor: '#4D8DFF',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  graphIconNet: {
    width: 28,
    height: 22,
    position: 'relative',
  },
  graphIconNode: {
    position: 'absolute',
    borderRadius: 999,
  },
  graphIconLine: {
    position: 'absolute',
    height: 1,
    backgroundColor: 'rgba(123, 163, 255, 0.5)',
    borderRadius: 1,
  },
  // ── Text ──
  graphCardInfo: {
    flex: 1,
  },
  graphCardTitle: {
    ...TYPOGRAPHY.bodyStrong,
    color: '#EDF1F7',
    fontSize: 16,
    letterSpacing: 0.3,
    fontWeight: '600',
  },
  graphCardSubtitle: {
    ...TYPOGRAPHY.caption,
    color: 'rgba(180, 195, 220, 0.55)',
    marginTop: 3,
    lineHeight: 16,
    letterSpacing: 0.15,
  },
  // ── Arrow ──
  graphCardArrowWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(77, 141, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  graphCardArrow: {
    fontSize: 18,
    color: 'rgba(123, 163, 255, 0.55)',
    fontWeight: '300',
    marginTop: -1,
  },

  // ── Empty ──
  emptyText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingVertical: SPACING.sm,
  },
});
