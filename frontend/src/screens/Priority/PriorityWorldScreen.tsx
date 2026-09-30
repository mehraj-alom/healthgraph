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
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, EmptyState, SectionHeader } from '@/components';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { toneForCategory, graphToneForStream } from '@/theme/tones';
import { CategoryTile } from '@/components/CategoryTile';
import { GlassCuboid } from '@/components/GlassCuboid';
import HGraphMap from '@/components/home/HGraphMap';
import CorrelationGraphCard from '@/components/home/CorrelationGraphCard';
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
  } = useDialMetrics({
    trendsData: trends.data,
    metricsData: metrics.data,
    localDetails: feedQuery.localDetails,
    takenEvents: feedQuery.takenEvents,
    medSummary: story.medSummary,
    hrPoints: localHr.points,
  });
  const [mapWidth, setMapWidth] = useState(0);
  const [showAllPatterns, setShowAllPatterns] = useState(false);

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

  const preview = showAllPatterns ? feedQuery.items : feedQuery.items.slice(0, 3);
  const hasMorePatterns = feedQuery.items.length > 3;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Priority.</Text>
        {isEmpty ? (
          <Text style={styles.sub}>Selected engines appear here.</Text>
        ) : (
          <Text style={styles.sub}>{entries.map((e) => e.title).join(' · ')}</Text>
        )}

        {isEmpty ? (
          <EmptyState
            title="No priorities selected"
            message="Choose the health areas to focus on."
          />
        ) : (
          <>
            <SectionHeader dark title="Priority dial" titleStyle={styles.histTitle} />
            <View style={styles.panel}>
              <View
                style={styles.panelMap}
                onLayout={(e) => setMapWidth(e.nativeEvent.layout.width)}
              >
                {mapWidth > 0 ? (
                  <View style={styles.dialCol}>
                    <HGraphMap metrics={hMetrics} width={mapWidth} />
                    <Text style={styles.dialLabel}>{dialDay.label}</Text>
                  </View>
                ) : null}
              </View>
              <GlassCuboid overlay auraColor={GV.teal} auraOpacity={0.1} radius={24} />
            </View>

            <SectionHeader dark title="Actions" titleStyle={styles.histTitle} />
            <View style={styles.duo}>
              <View style={styles.duoHalf}>
                <Button title="Improve" onPress={() => goImprove('improve')} fullWidth />
              </View>
              <View style={styles.duoHalf}>
                <Button title="Keep" variant="ghost" onPress={() => goImprove('keep')} fullWidth textStyle={styles.ghostText} />
              </View>
            </View>

            <SectionHeader dark title="Your engines" titleStyle={styles.histTitle} />
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
                <SectionHeader dark title="Your patterns" titleStyle={styles.histTitle} />
                <View style={styles.list}>
                  {preview.map((item) => (
                    <CorrelationGraphCard
                      key={item.id}
                      title={item.title}
                      subtitle={item.subtitle}
                      data={item.data}
                      lineColor={
                        item.data.kind === 'timeSeries'
                          ? graphToneForStream(item.id)
                          : undefined
                      }
                    />
                  ))}
                </View>
                {hasMorePatterns ? (
                  <Button
                    title={showAllPatterns ? `Show less (${feedQuery.items.length})` : `Show all ${feedQuery.items.length} patterns`}
                    variant="ghost"
                    onPress={() => setShowAllPatterns((v) => !v)}
                    fullWidth
                    textStyle={styles.ghostText}
                  />
                ) : null}
                <Button title="Open full graph" variant="ghost" onPress={goFullGraph} fullWidth textStyle={styles.ghostText} />
              </>
            ) : feedQuery.isLocalLoading ? (
              <Text style={styles.disclaimer}>Loading patterns…</Text>
            ) : null}
          </>
        )}

        <Button
          title={isEmpty ? 'Set priorities' : 'Edit priorities'}
          variant={isEmpty ? undefined : 'ghost'}
          onPress={goEdit}
          fullWidth
          textStyle={isEmpty ? undefined : styles.ghostText}
        />
        <Text style={styles.disclaimer}>
          Your engines, dial, and graphs in one place. Tracking only.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080A11' },
  content: { paddingHorizontal: SPACE.screenH, paddingVertical: SPACE.sectionGap, paddingBottom: 32, gap: 12 },
  title: { fontFamily: FONT.semi, fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: '#FFFFFF', textAlign: 'center' },
  sub: { ...TYPE.body, color: GV.fog, textAlign: 'center' },
  histTitle: { fontSize: 20, lineHeight: 24, letterSpacing: -0.3 },
  panel: { position: 'relative' },
  panelMap: { alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  dialCol: { alignItems: 'center', justifyContent: 'center' },
  dialLabel: {
    ...TYPE.chip,
    color: '#2E8B7E',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  duo: { flexDirection: 'row', gap: 12 },
  duoHalf: { flex: 1 },
  ghostText: { color: '#A7B8B2' },
  list: { gap: SPACE.cardGap },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
});
