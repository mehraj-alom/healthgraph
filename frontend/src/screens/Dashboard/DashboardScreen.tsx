/**
 * DashboardScreen — Home, rebuilt in the "Movements+" theme
 * (see .opencode/skills/ui-skill/SKILL.md).
 *
 * Exact reference tokens come from <theme/movements.ts>. Layout rules followed:
 *   - Base surface offwhite, flat color-blocking, no shadows.
 *   - One lime focal per card; the hub ring + selected petal are the lime focal.
 *   - Giant tabular numerals, ultra-rounded (≥30) card radii, pill buttons.
 *   - Every "see more" action uses the 45° ↗ in-circle icon.
 *
 * Data is identical to the previous Home (no invented scores): DailyMetrics,
 * useHomeStory (SQLite), useMedications, useTrends, docs, profile, sync status.
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, RefreshControl, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { mv, mvType } from '@/theme/movements';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { useMedications } from '@/hooks/useMedications';
import { useTrends } from '@/hooks/useTrends';
import { useCachedQuery } from '@/hooks/useCachedQuery';
import { useSyncStatus, getSyncStatusMessage } from '@/hooks/useSyncStatus';
import { useAuth } from '@/context/AuthContext';
import { useDocuments } from '@/context/DocumentsContext';
import { isOnline, subscribe as subscribeNetwork } from '@/services/networkMonitor';
import { api } from '@/services/api';
import {
  MovementsCard,
  IconButton,
  StatusPill,
  FilterChips,
  StatCard,
  ProgressCard,
  BarChart,
  AvatarStack,
  type Avatar,
} from '@/components/movements';
import {
  OverallHealthVisualization,
  type OverallPalette,
} from '@/components/home/OverallHealthVisualization';
import {
  buildHealthDimensions,
  localDateString,
  formatMonthDay,
  formatSleepMinutes,
  formatWaterMl,
  detectHeartRate,
  magnitudeSleep,
  magnitudeHeartRate,
  magnitudeWater,
  type DimensionId,
  type HealthDimension,
  type HomeStoryItem,
} from './homeData';
import { useHomeStory } from './useHomeStory';
import type { RootStackParamList, MainTabParamList, PatientProfile } from '@/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Dashboard'>,
  NativeStackNavigationProp<RootStackParamList>
>;

// ─── Movements+ OverallHealth palette ────────────────────────────────────────

const OVERALL_PALETTE: OverallPalette = {
  petal: 'rgba(255,255,255,0.16)',
  petalSelected: mv.accentLime,
  hubFill: mv.surfaceDarkCard,
  hubStroke: 'rgba(255,255,255,0.14)',
  hubStrokeFocused: mv.accentLime,
  hubText: mv.textOnDarkPrimary,
  hubSub: mv.textOnDarkSecondary,
  label: 'rgba(255,255,255,0.45)',
  labelSelected: mv.accentLime,
  emptyBg: mv.surfaceDarkCard,
  emptyText: mv.textOnDarkPrimary,
};

// ─── Small helpers ───────────────────────────────────────────────────────────

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function dayLabel(dayKey: string): string {
  const today = localDateString();
  if (dayKey === today) return 'Today';
  const yesterday = localDateString(new Date(Date.now() - 86_400_000));
  if (dayKey === yesterday) return 'Yesterday';
  return formatMonthDay(dayKey);
}

function shortDate(isoOrDate: string): string {
  return new Date(isoOrDate).toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
  });
}

function initialsOf(name: string | null | undefined): string {
  if (!name) return 'You';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'You';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return `${first}${last}`.toUpperCase();
}

// ─── Story row (timeline preview + important events) ─────────────────────────

interface StoryRowProps {
  item: HomeStoryItem;
  onPress?: () => void;
  index: number;
  dividerBetween: boolean;
}

function StoryRow({ item, onPress, index, dividerBetween }: StoryRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [
        storyStyles.row,
        pressed && onPress && { opacity: 0.6 },
        index === 0 && { paddingTop: 0 },
      ]}
    >
      <View style={storyStyles.icon}>
        <Text style={storyStyles.iconText}>{item.icon}</Text>
      </View>
      <View style={storyStyles.body}>
        <Text style={[mvType.caption, { color: mv.textOnLightPrimary, fontWeight: '600' }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[mvType.caption, { color: mv.textOnLightSecondary }]} numberOfLines={1}>
          {item.detail}
        </Text>
      </View>
      <View style={storyStyles.time}>
        <Text style={[mvType.pill, { color: mv.textOnLightSecondary }]}>
          {dayLabel(item.dayKey)}
        </Text>
        <Text style={[mvType.pill, { color: mv.textOnLightSecondary, fontSize: 11 }]}>
          {formatClock(item.time)}
        </Text>
      </View>
      {dividerBetween ? <View style={storyStyles.divider} /> : null}
    </Pressable>
  );
}

const storyStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: mv.spaceIconLabel + 5,
    paddingVertical: 11,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: mv.radiusPill,
    backgroundColor: 'rgba(20,20,20,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 17,
  },
  body: {
    flex: 1,
    gap: 1,
  },
  time: {
    alignItems: 'flex-end',
    gap: 1,
  },
  divider: {
    position: 'absolute',
    left: 46,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(20,20,20,0.08)',
  },
});

// ─── Main screen ─────────────────────────────────────────────────────────────

type RangeKey = 'day' | 'week' | 'month';

export default function DashboardScreen() {
  const navigation = useNavigation<Nav>();
  const { userProfile } = useAuth();
  const metrics = useDailyMetrics();
  const medications = useMedications();
  const trends = useTrends(30);
  const story = useHomeStory();
  const docs = useDocuments();
  const syncStatus = useSyncStatus();

  const profileQuery = useCachedQuery<PatientProfile>({
    cacheKey: 'profile',
    queryFn: useCallback(() => api.get<PatientProfile>('/api/v1/profile'), []),
  });
  const profileName = profileQuery.data?.display_name ?? userProfile?.displayName ?? null;

  const [online, setOnline] = useState<boolean>(isOnline());
  useEffect(() => subscribeNetwork(() => setOnline(isOnline())), []);

  const [selectedDimId, setSelectedDimId] = useState<DimensionId | null>(null);
  const [range, setRange] = useState<RangeKey>('week');
  const [refreshing, setRefreshing] = useState(false);

  // Focus refetch is time-gated (same 30 s freshness window as
  // HealthDashboardScreen): tab-hopping must not refetch on every focus.
  // Manual pull-to-refresh (`refresh` below) always bypasses the gate.
  const lastFocusRefetch = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastFocusRefetch.current < 30_000) return;
      lastFocusRefetch.current = now;
      void story.refetch();
      void metrics.refetch();
      void medications.refetch();
    }, [story.refetch, metrics.refetch, medications.refetch]),
  );

  // ── Derived ──
  const today = localDateString();

  const dimensions = useMemo(
    () => buildHealthDimensions(metrics.data, story.water, story.medSummary),
    [metrics.data, story.water, story.medSummary],
  );

  const selectedDim: HealthDimension | null = useMemo(
    () => dimensions.find((d) => d.id === selectedDimId) ?? null,
    [dimensions, selectedDimId],
  );

  const sleep = metrics.data?.latest_sleep ?? null;
  const activity = metrics.data?.today_activity ?? null;
  const hr = useMemo(() => detectHeartRate(metrics.data), [metrics.data]);

  const waterDim = dimensions.find((d) => d.id === 'water') ?? null;
  const medDim = dimensions.find((d) => d.id === 'medication') ?? null;

  const activeMedCount = story.medSummary?.activeCount ?? 0;
  const hasActiveData =
    dimensions.length > 0 || story.story.length > 0 || activeMedCount > 0;
  const booting = !hasActiveData && (metrics.isLoading || story.isLoading);
  const showError =
    !hasActiveData && metrics.isError && !metrics.isLoading && !story.isLoading;

  // ── Recent vitals (from the live metrics payload) ──
  const recentVitals = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ name: string; value: string }> = [];
    for (const v of metrics.data?.latest_vitals ?? []) {
      if (v.value == null) continue;
      const name = v.display_name ?? 'Vital';
      const slug = name.toLowerCase();
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push({
        name,
        value: `${v.value}${v.unit ? ` ${v.unit}` : ''}`,
      });
      if (out.length >= 3) break;
    }
    return out;
  }, [metrics.data]);

  // ── Bar chart: last-7-day wellbeing (fallback sleep, then story counts) ──
  const chart = useMemo(() => {
    const pts = trends.data?.wellbeing_points ?? [];
    const last7 = pts.slice(-7);
    let values: number[] = [];
    if (last7.length >= 2) {
      values = last7.map((p) => (p.wellbeing != null ? Math.max(0, Math.min(1, p.wellbeing / 5)) : 0.08));
    } else {
      const sleepPts = (trends.data?.sleep_points ?? []).slice(-7);
      if (sleepPts.length >= 2) {
        values = sleepPts.map((p) =>
          p.duration_minutes != null ? Math.max(0, Math.min(1, p.duration_minutes / 480)) : 0.08,
        );
      }
    }
    if (values.length === 0) return null;
    const last = last7.length >= 2 ? last7[last7.length - 1] : null;
    const highlight = last && last.date === today ? values.length - 1 : -1;
    return {
      values,
      highlightIndex: highlight,
      startLabel: last7[0]?.date ?? '',
      endLabel: last7[last7.length - 1]?.date ?? '',
      caption: last7[last7.length - 1]?.wellbeing != null ? `${last7[last7.length - 1]?.wellbeing}/5 avg` : undefined,
    };
  }, [trends.data, today]);

  // ── Important events today (notable categories, max 3) ──
  const importantEvents = useMemo(() => {
    const notable = new Set(['sleep', 'medication', 'pain', 'symptom', 'vital', 'wellbeing', 'document']);
    return story.story.filter((s) => s.dayKey === today && notable.has(s.category)).slice(0, 3);
  }, [story.story, today]);

  // ── Recent timeline preview, filtered by the Day/Week/Month chip ──
  const recentItems = useMemo(() => {
    const daysAgo = range === 'day' ? 1 : range === 'week' ? 7 : 30;
    const cutoff = localDateString(new Date(Date.now() - (daysAgo - 1) * 86_400_000));
    return story.story
      .filter((s) => s.dayKey >= cutoff)
      .slice(0, range === 'day' ? 5 : 6);
  }, [story.story, range]);

  // ── Progress cards — sleep (lime) + heart or water (teal) ──
  const sleepCard = useMemo(() => {
    if (!sleep || sleep.duration_minutes <= 0) return null;
    return {
      variant: 'lime' as const,
      label: 'Sleep',
      value: formatSleepMinutes(sleep.duration_minutes),
      progress: magnitudeSleep(sleep.duration_minutes),
    };
  }, [sleep]);

  const secondaryCard = useMemo(() => {
    if (hr) {
      return {
        variant: 'teal' as const,
        label: 'Heart rate',
        value: `${hr.value} bpm`,
        progress: magnitudeHeartRate(hr.value),
      };
    }
    if (story.water != null && story.water > 0) {
      return {
        variant: 'teal' as const,
        label: 'Water',
        value: formatWaterMl(story.water),
        progress: magnitudeWater(story.water),
      };
    }
    return null;
  }, [hr, story.water]);

  const showProgressRow = sleepCard != null || secondaryCard != null;

  // ── Actions ──
  const selectDimension = useCallback((id: DimensionId) => {
    setSelectedDimId((prev) => (prev === id ? null : id));
  }, []);

  const clearSelection = useCallback(() => setSelectedDimId(null), []);

  const goToDailyLog = useCallback(() => navigation.navigate('DailyLog'), [navigation]);
  const goToMedications = useCallback(() => navigation.navigate('Medications'), [navigation]);
  const goToUpload = useCallback(() => navigation.navigate('DocumentUpload'), [navigation]);
  const goToTimeline = useCallback(() => navigation.navigate('Timeline'), [navigation]);
  const goToSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);
  const goToHealthGraph = useCallback(
    () => navigation.navigate('HealthGraph', { source: 'graph' }),
    [navigation],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([
        metrics.refetch(),
        medications.refetch(),
        profileQuery.refetch(),
        docs.refetchDocuments(),
        story.refetch(),
        trends.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [metrics.refetch, medications.refetch, profileQuery.refetch, docs.refetchDocuments, story.refetch, trends.refetch]);

  // ── Banner (offline / sync attention) ──
  const banner = !online
    ? { text: "You're offline — changes are saved locally and sync soon." }
    : syncStatus.status === 'SYNC_FAILED'
      ? { text: `${getSyncStatusMessage(syncStatus.status)} — retrying in the background.` }
      : null;

  const avatarList: Avatar[] = profileName ? [{ initials: initialsOf(profileName) }] : [];

  // ── Render ──
  let content;
  if (booting) {
    content = <HomeSkeleton />;
  } else if (showError) {
    content = <CenteredNotice icon="⚠️" title="Can't reach the health server" message="Check your connection, then try again." onRetry={refresh} />;
  } else if (!hasActiveData) {
    content = (
      <CenteredNotice
        icon="🌱"
        title="Welcome to your health dashboard"
        message="Log your first check-in to start seeing your day bloom."
        onRetry={goToDailyLog}
        actionLabel="Log today"
      />
    );
  } else {
    content = (
      <>
        <MovementsCard kind="dark">
          <View style={cardHeaderRow}>
            <Text style={[mvType.labelCard, { color: mv.textOnDarkPrimary }]}>Overall health</Text>
            <IconButton
              onPress={goToHealthGraph}
              kind="white"
              size={32}
              glyph="↗"
              accessibilityLabel="Open health graph"
            />
          </View>
          <OverallHealthVisualization
            dimensions={dimensions}
            selectedDimensionId={selectedDimId}
            onSelectDimension={selectDimension}
            onSelectHub={clearSelection}
            palette={OVERALL_PALETTE}
          />
          <StatusPill
            variant="limeOnDark"
            text={
              selectedDim
                ? `${selectedDim.label} · ${selectedDim.valueText}`
                : `${dimensions.length} area${dimensions.length === 1 ? '' : 's'} today`
            }
          />
        </MovementsCard>

        {showProgressRow ? (
          <View style={styles.progressRow}>
            {sleepCard ? (
              <ProgressCard
                variant="lime"
                label={sleepCard.label}
                caption="Your progress"
                value={sleepCard.value}
                progress={sleepCard.progress}
                buttonLabel="Log sleep"
                onPress={goToDailyLog}
                avatars={avatarList}
              />
            ) : null}
            {secondaryCard ? (
              <ProgressCard
                variant="teal"
                label={secondaryCard.label}
                caption="Today's reading"
                value={secondaryCard.value}
                progress={secondaryCard.progress}
                buttonLabel={secondaryCard.label === 'Water' ? 'Log water' : 'Add vitals'}
                onPress={goToDailyLog}
                avatars={avatarList}
              />
            ) : null}
          </View>
        ) : null}

        {waterDim ? (
          <StatCard
            label="Water"
            value={waterDim.valueText}
            support={<StatusPill text="of 2.5L daily goal" />}
            onPress={goToDailyLog}
            actionLabel="Log water"
          />
        ) : null}

        {medDim ? (
          <StatCard
            label="Medication"
            value={medDim.valueText}
            support={
              <StatusPill
                text={
                  story.medSummary?.hasSchedule
                    ? `${story.medSummary.dosesTaken}/${story.medSummary.dosesExpected} doses today`
                    : `${story.medSummary?.activeCount ?? 0} active`
                }
              />
            }
            onPress={goToMedications}
            actionLabel="Open medications"
          />
        ) : null}

        {chart ? (
          <BarChart
            title="This week"
            values={chart.values}
            highlightIndex={chart.highlightIndex}
            caption={chart.caption}
            startLabel={chart.startLabel ? shortDate(chart.startLabel) : undefined}
            endLabel={chart.endLabel ? shortDate(chart.endLabel) : undefined}
          />
        ) : null}

        {importantEvents.length > 0 ? (
          <MovementsCard kind="white">
            <View style={styles.cardHeader}>
              <Text style={[mvType.labelCard, { color: mv.textOnLightPrimary }]}>Important today</Text>
              <IconButton
                onPress={goToTimeline}
                kind="solid"
                size={32}
                accessibilityLabel="View timeline"
              />
            </View>
            {importantEvents.map((item, i) => (
              <StoryRow key={item.id} item={item} onPress={goToTimeline} index={i} dividerBetween={i < importantEvents.length - 1} />
            ))}
          </MovementsCard>
        ) : null}

        <MovementsCard kind="white">
          <View style={styles.cardHeader}>
            <Text style={[mvType.labelCard, { color: mv.textOnLightPrimary }]}>
              {range === 'day' ? 'Today' : range === 'week' ? 'Recent' : 'This month'}
            </Text>
            <IconButton
              onPress={goToTimeline}
              kind="solid"
              size={32}
              accessibilityLabel="View timeline"
            />
          </View>
          {recentItems.length > 0 ? (
            recentItems.map((item, i) => (
              <StoryRow key={item.id} item={item} onPress={goToTimeline} index={i} dividerBetween={i < recentItems.length - 1} />
            ))
          ) : (
            <Text style={[mvType.caption, { color: mv.textOnLightSecondary, paddingVertical: 6 }]}>
              Nothing here yet — log your day to start your timeline.
            </Text>
          )}
        </MovementsCard>

        {recentVitals.length > 0 ? (
          <MovementsCard kind="white">
            <View style={styles.cardHeader}>
              <Text style={[mvType.labelCard, { color: mv.textOnLightPrimary }]}>Recent vitals</Text>
              <IconButton onPress={goToTimeline} kind="solid" size={32} accessibilityLabel="View vitals" />
            </View>
            <View style={styles.vitalsGrid}>
              {recentVitals.map((v) => (
                <View key={v.name} style={styles.vitalCell}>
                  <Text style={[mvType.caption, { color: mv.textOnLightSecondary }]} numberOfLines={1}>
                    {v.name}
                  </Text>
                  <Text style={[mvType.statGiantSm, styles.statNums, { color: mv.textOnLightPrimary }]}>
                    {v.value}
                  </Text>
                </View>
              ))}
            </View>
          </MovementsCard>
        ) : null}

        <MovementsCard kind="white">
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <Text style={[mvType.labelCard, { color: mv.textOnLightPrimary }]}>Records</Text>
              <Text style={[mvType.caption, { color: mv.textOnLightSecondary }]}>
                {docs.documents.length === 0
                  ? 'Upload a document to extract health data'
                  : `${docs.documents.length} document${docs.documents.length > 1 ? 's' : ''} synced`}
              </Text>
            </View>
            <IconButton onPress={goToUpload} kind="solid" size={32} accessibilityLabel="Upload document" />
          </View>
        </MovementsCard>
      </>
    );
  }

  return (
    <SafeAreaView style={[screen.safe, { backgroundColor: mv.surfaceOffwhite }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={screen.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={mv.textOnLightPrimary}
          />
        }
      >
        {banner ? (
          <MovementsCard kind="dark" style={screen.banner}>
            <Text style={[mvType.caption, { color: mv.textOnDarkPrimary, flex: 1 }]}>
              {banner.text}
            </Text>
            <IconButton
              onPress={refresh}
              kind="softWhite"
              size={30}
              glyph="↻"
              accessibilityLabel="Retry sync"
            />
          </MovementsCard>
        ) : null}

        <View style={screen.navRow}>
          <DateBadge />
          <IconButton
            onPress={goToSettings}
            kind="white"
            glyph="i"
            accessibilityLabel="Settings"
          />
        </View>

        <View style={screen.hero}>
          <Text style={[mvType.hero, { color: mv.textOnLightPrimary }]}>
            Today,{profileName ? ` ${profileName.split(' ')[0]}` : ''}
          </Text>
          <Text style={[mvType.caption, { color: mv.textOnLightSecondary, marginTop: 2 }]}>
            Your health at a glance
          </Text>
        </View>

        <FilterChips<RangeKey>
          options={[
            { key: 'day', label: 'Day' },
            { key: 'week', label: 'Week' },
            { key: 'month', label: 'Month' },
          ]}
          active={range}
          onChange={setRange}
        />

        {content}
        <View style={{ height: 48 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Supporting widgets ──────────────────────────────────────────────────────

function DateBadge() {
  const now = new Date();
  const label = now
    .toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
    .replace(',', '')
    .toLowerCase();
  return (
    <View style={dateStyles.pill}>
      <Text style={[mvType.navTitle, { color: mv.textOnLightPrimary }]}>{label}</Text>
      <Text style={[mvType.pill, { color: mv.textOnLightSecondary }]}>
        {now.toLocaleDateString('en-US', { month: 'long' })}
      </Text>
    </View>
  );
}

const dateStyles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    backgroundColor: mv.surfaceWhite,
    borderRadius: mv.radiusPill,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
});

interface CenteredNoticeProps {
  icon: string;
  title: string;
  message: string;
  onRetry: () => void;
  actionLabel?: string;
}

function CenteredNotice({ icon, title, message, onRetry, actionLabel = 'Try again' }: CenteredNoticeProps) {
  return (
    <MovementsCard kind="white" style={noticeStyles.card}>
      <Text style={noticeStyles.icon}>{icon}</Text>
      <Text style={[mvType.labelCard, { color: mv.textOnLightPrimary, textAlign: 'center' }]}>{title}</Text>
      <Text style={[mvType.caption, { color: mv.textOnLightSecondary, textAlign: 'center' }]}>{message}</Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        style={({ pressed }) => [
          noticeStyles.button,
          pressed && { opacity: 0.75, transform: [{ scale: 0.97 }] },
        ]}
      >
        <Text style={[mvType.pill, { color: mv.surfaceWhite, fontWeight: '700' }]}>{actionLabel}</Text>
      </Pressable>
    </MovementsCard>
  );
}

const noticeStyles = StyleSheet.create({
  card: {
    alignItems: 'center',
    gap: mv.spaceIconLabel,
    paddingVertical: 28,
    paddingHorizontal: 24,
  },
  icon: {
    fontSize: 32,
  },
  button: {
    marginTop: 8,
    backgroundColor: mv.textOnLightPrimary,
    borderRadius: mv.radiusPill,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
});

// ─── Loading skeleton ────────────────────────────────────────────────────────

function HomeSkeleton() {
  return (
    <>
      <View style={{ aspectRatio: 1, width: '100%', borderRadius: mv.radiusCard, overflow: 'hidden' }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(20,20,20,0.05)' }} />
      </View>
      <View style={styles.progressRow}>
        <View style={{ flex: 1, height: 200, borderRadius: mv.radiusCard, backgroundColor: 'rgba(20,20,20,0.05)' }} />
        <View style={{ flex: 1, height: 200, borderRadius: mv.radiusCard, backgroundColor: 'rgba(20,20,20,0.05)' }} />
      </View>
      <View style={{ height: 120, borderRadius: mv.radiusCard, backgroundColor: 'rgba(20,20,20,0.05)' }} />
      <View style={{ height: 120, borderRadius: mv.radiusCard, backgroundColor: 'rgba(20,20,20,0.05)' }} />
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const cardHeaderRow = {
  flexDirection: 'row' as const,
  justifyContent: 'space-between' as const,
  alignItems: 'center' as const,
};

const styles = StyleSheet.create({
  progressRow: {
    flexDirection: 'row',
    gap: mv.spaceSideBySide,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardHeaderLeft: {
    flex: 1,
    gap: 2,
    paddingRight: 12,
  },
  vitalsGrid: {
    flexDirection: 'row',
    gap: mv.spaceSideBySide,
  },
  vitalCell: {
    flex: 1,
    backgroundColor: mv.surfaceOffwhite,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  statNums: {
    fontVariant: ['tabular-nums'],
  },
});

const screen = StyleSheet.create({
  safe: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: mv.spaceScreen,
    gap: mv.spaceStack,
    paddingBottom: 24,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
  },
  hero: {
    paddingTop: 16,
  },
});