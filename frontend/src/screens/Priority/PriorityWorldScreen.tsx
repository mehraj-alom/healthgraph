/**
 * PriorityWorldScreen — the Priority destination (post-Batch-6 layer).
 *
 * "My Priorities" opens its own world instead of the onboarding flow:
 * the shared health dial (same pipeline as the dashboard, via
 * useDialMetrics — no duplicated computation), Improve / Keep actions
 * (the existing Improve window with the same metrics), a compact
 * time-vs-correlations preview (the existing correlation feed), one row
 * per active engine (destinations from the 6A catalog, never hardcoded),
 * and Edit priorities (the existing setup flow). Empty selection renders
 * the honest empty state with a path to setup.
 *
 * Composition only: every number here is computed by an existing
 * contract. No Priority score, no new health math, no medical claims.
 */

import { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Chip, EmptyState, SectionHeader } from '@/components';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { toneForCategory } from '@/theme/tones';
import { CategoryTile } from '@/components/CategoryTile';
import { StageGradient } from '@/components/StageGradient';
import HGraphMap from '@/components/home/HGraphMap';
import CorrelationGraphCard from '@/components/home/CorrelationGraphCard';
import { domainHueForStream } from '@/theme/dashboardApple';
import { useTrendRange } from '@/context/TrendRangeContext';
import { useTrends } from '@/hooks/useTrends';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { useHomeStory } from '@/screens/Dashboard/useHomeStory';
import { useLocalHeartRate } from '@/hooks/useLocalHeartRate';
import { useCorrelationFeed } from '@/screens/Dashboard/correlations';
import { useDialMetrics } from '@/hooks/useDialMetrics';
import { usePriority } from '@/hooks/usePriority';
import { ENGINES } from '@/screens/HealthAreas/engines';
import type { RootStackParamList } from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function PriorityWorldScreen() {
  const navigation = useNavigation<Nav>();
  const { entries, isEmpty } = usePriority();
  // Shared dial pipeline (same inputs the dashboard feeds it — the dial
  // reads identically here, including local streams, doses, and camera).
  const { days: trendDays } = useTrendRange();
  const trends = useTrends(trendDays);
  const metrics = useDailyMetrics();
  const story = useHomeStory();
  const localHr = useLocalHeartRate();
  const feedQuery = useCorrelationFeed(trends.data, metrics.data, Math.min(trendDays, 60));
  const {
    dialDay,
    hMetrics,
    setDayRange,
  } = useDialMetrics({
    trendsData: trends.data,
    metricsData: metrics.data,
    localDetails: feedQuery.localDetails,
    takenEvents: feedQuery.takenEvents,
    medSummary: story.medSummary,
    hrPoints: localHr.points,
  });
  const [mapWidth, setMapWidth] = useState(0);

  const goEngine = useCallback(
    (routeName: string, params?: Record<string, unknown>) => {
      (navigation.navigate as (r: string, p?: object) => void)(routeName, params);
    },
    [navigation],
  );

  const goEdit = useCallback(() => navigation.navigate('OnboardingSetup'), [navigation]);
  const goImprove = useCallback(
    (focus: 'improve' | 'keep') => navigation.navigate('Improve', { focus, metrics: hMetrics }),
    [navigation, hMetrics],
  );
  const goFullGraph = useCallback(
    () => navigation.navigate('HealthGraph', { source: 'graph' }),
    [navigation],
  );

  const preview = feedQuery.items.slice(0, 3);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StageGradient />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={() => navigation.canGoBack() && navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
          style={styles.backHit}
        >
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.overline}>My priorities</Text>
        <Text style={styles.title}>Priority</Text>
        {isEmpty ? (
          <Text style={styles.sub}>Selected engines appear here.</Text>
        ) : (
          <Text style={styles.sub}>{entries.map((e) => e.title).join(' · ')}</Text>
        )}

        {isEmpty ? (
          <EmptyState
            icon="🧭"
            title="No priorities selected"
            message="Choose the health areas you'd like to focus on. This world shows your dial, actions, correlations, and engines."
          />
        ) : (
          <>
            <SectionHeader title="Priority dial" />
            <Card>
              <View onLayout={(e) => setMapWidth(e.nativeEvent.layout.width)}>
                {mapWidth > 0 ? <HGraphMap metrics={hMetrics} width={mapWidth} /> : null}
              </View>
              <View style={styles.dialFoot}>
                <Text style={styles.dialLabel}>{dialDay.label}</Text>
                <View style={styles.rangeChips}>
                  {[7, 14, 30].map((n) => (
                    <Chip
                      key={n}
                      label={`${n}D`}
                      selected={dialDay.range === n}
                      onPress={() => setDayRange(n)}
                      accessibilityLabel={`Show past ${n} days`}
                    />
                  ))}
                </View>
              </View>
            </Card>

            <SectionHeader title="Actions" />
            <View style={styles.duo}>
              <View style={styles.duoHalf}>
                <Button title="Improve" onPress={() => goImprove('improve')} fullWidth />
              </View>
              <View style={styles.duoHalf}>
                <Button title="Keep" variant="ghost" onPress={() => goImprove('keep')} fullWidth />
              </View>
            </View>

            <SectionHeader title="Your engines" />
            <View style={styles.list}>
              {entries.map((entry) => {
                const def = ENGINES[entry.id as keyof typeof ENGINES];
                if (!def?.route) return null;
                return (
                  <CategoryTile
                    key={entry.id}
                    tone={toneForCategory(entry.id)}
                    label={entry.title}
                    hint={def.description}
                    glyph={def.glyph}
                    active={false}
                    accessibilityLabel={`Open ${entry.title}`}
                    onPress={() => goEngine(def.route?.name ?? '', def.route?.params)}
                  />
                );
              })}
            </View>

            {preview.length > 0 ? (
              <>
                <SectionHeader title="Time vs correlations" />
                <View style={styles.list}>
                  {preview.map((item) => (
                    <CorrelationGraphCard
                      key={item.id}
                      title={item.title}
                      subtitle={item.subtitle}
                      data={item.data}
                      lineColor={
                        item.data.kind === 'timeSeries'
                          ? domainHueForStream(item.id.replace(/^series-/, ''))
                          : undefined
                      }
                    />
                  ))}
                </View>
                <Button title="Open full graph" variant="ghost" onPress={goFullGraph} fullWidth />
              </>
            ) : null}
          </>
        )}

        <Button
          title={isEmpty ? 'Set priorities' : 'Edit priorities'}
          variant={isEmpty ? undefined : 'ghost'}
          onPress={goEdit}
          fullWidth
        />
        <Text style={styles.disclaimer}>
          Your engines, dial, and graphs in one place. Tracking only.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: GV.stage },
  content: { paddingHorizontal: SPACE.screenH, paddingVertical: SPACE.sectionGap, paddingBottom: 32, gap: 12 },
  backHit: { minHeight: 44, justifyContent: 'center' },
  backText: { ...TYPE.button, fontSize: 16, color: GV.fog },
  overline: { fontFamily: FONT.semi, fontSize: 12, lineHeight: 16, letterSpacing: 3, color: GV.teal, textAlign: 'center' },
  title: { ...TYPE.display, color: GV.card, textAlign: 'center' },
  sub: { ...TYPE.body, color: GV.fog, textAlign: 'center' },
  dialFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  dialLabel: { ...TYPE.caption, color: GV.muted },
  rangeChips: { flexDirection: 'row', gap: 8 },
  duo: { flexDirection: 'row', gap: 12 },
  duoHalf: { flex: 1 },
  list: { gap: SPACE.cardGap },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  glyph: { fontSize: 22 },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { ...TYPE.button, fontSize: 15, color: GV.ink },
  rowSub: { ...TYPE.caption, color: GV.body },
  chev: { fontSize: 20, color: GV.muted },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
});
