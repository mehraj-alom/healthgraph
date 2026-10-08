/**
 * InsightsScreen — the cross-engine correlation feed, first-class.
 *
 * Same live feed + curation as the dashboard preview (shared
 * useCuratedFeed), rendered full-bleed on the aurora stage: every insight
 * card with its verdict, pull-to-refresh, honest empty state.
 * Custom-correlation building stays on the Dashboard; this screen is for
 * reading.
 */
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import CorrelationGraphCard from '@/components/home/CorrelationGraphCard';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { SPACE } from '@/theme/guava';
import { graphToneForStream } from '@/theme/tones';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { useTrends } from '@/hooks/useTrends';
import {
  useCorrelationFeed,
  verdictLabel,
  type CorrelationFeedItem,
} from '@/screens/Dashboard/correlations';
import { useCuratedFeed } from '@/screens/Dashboard/useCuratedFeed';
import { useBehaviorImpacts } from '@/hooks/useBehaviorImpacts';
import type { Impact } from '@/services/behaviorImpacts';

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

const IMPACT_CONFIDENCE_COLORS: Record<string, string> = {
  high: '#5CE8B8',
  medium: '#8EA0B8',
  low: '#5A6472',
};

function ImpactRows({ impacts }: { impacts: Impact[] }) {
  if (impacts.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.patternsTitle}>Day patterns</Text>
      <GlassSurface strong noBlur style={styles.impactCard}>
        {impacts.map((item, i) => (
          <View
            key={`${item.factor}-${item.outcome}-${item.lag}-${i}`}
            style={[styles.impactRow, i < impacts.length - 1 && styles.impactDivider]}
          >
            <View style={[styles.verdictDot, { backgroundColor: IMPACT_CONFIDENCE_COLORS[item.confidence] ?? '#8EA0B8' }]} />
            <View style={styles.impactMain}>
              <Text style={styles.impactLine}>{item.line}</Text>
              <Text style={styles.impactConf}>{item.confidence} confidence</Text>
            </View>
          </View>
        ))}
      </GlassSurface>
    </View>
  );
}

const VERDICT_COLORS: Record<string, string> = {
  good: '#5CE8B8',
  bad: '#FF8E8E',
  neutral: '#8EA0B8',
};

function InsightCard({ item }: { item: CorrelationFeedItem }) {
  const color = VERDICT_COLORS[item.verdict] ?? VERDICT_COLORS.neutral;
  return (
    <View style={styles.section}>
      <View style={styles.verdictRow}>
        <View style={[styles.verdictDot, { backgroundColor: color }]} />
        <Text style={[styles.verdictText, { color }]}>{verdictLabel(item.verdict)}</Text>
      </View>
      <CorrelationGraphCard
        title={item.title}
        subtitle={item.subtitle}
        data={item.data}
        lineColor={
          item.data.kind === 'timeSeries' ? graphToneForStream(item.id) : undefined
        }
      />
    </View>
  );
}

export default function InsightsScreen() {
  const trends = useTrends(60);
  const metrics = useDailyMetrics();
  const feedQuery = useCorrelationFeed(trends.data, metrics.data, 60);
  const { visibleFeed } = useCuratedFeed(feedQuery.items, feedQuery.streams, feedQuery.pairs);
  const { impacts } = useBehaviorImpacts();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([
      trends.refetch?.(),
      metrics.refetch?.(),
      feedQuery.refetchLocal(),
    ]);
    setRefreshing(false);
  }, [trends, metrics, feedQuery]);

  const loading = visibleFeed.length === 0 && (feedQuery.isLocalLoading || trends.data == null);

  return (
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Insights</Text>
          <Text style={styles.sub}>
            {visibleFeed.length > 0
              ? `${visibleFeed.length} live ${visibleFeed.length === 1 ? 'connection' : 'connections'} across your engines`
              : 'How your engines move together.'}
          </Text>
        </View>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#5CE8B8" />
            <Text style={styles.body}>Reading your patterns…</Text>
          </View>
        ) : (
          <FlatList
            data={visibleFeed}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <InsightCard item={item} />}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#FFFFFF" />
            }
            ListHeaderComponent={<ImpactRows impacts={impacts} />}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={styles.title2}>No insights yet</Text>
                <Text style={styles.body}>
                  Log a few days — connections appear here.
                </Text>
              </View>
            }
          />
        )}
        <Text style={styles.disclaimer}>
          Patterns from your data — not causes.
        </Text>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070F' },
  safe: { flex: 1 },
  header: { paddingHorizontal: SPACE.screenH, paddingTop: 8, paddingBottom: 4 },
  title: { fontWeight: '600', fontSize: 34, lineHeight: 41, letterSpacing: -0.8, color: '#FFFFFF' },
  sub: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, marginTop: 2 },
  list: { paddingHorizontal: SPACE.screenH, paddingBottom: 24, gap: 12 },
  section: { marginTop: 8 },
  patternsTitle: { color: '#FFFFFF', fontSize: 20, lineHeight: 25, fontWeight: '600', letterSpacing: -0.4, marginBottom: 10 },
  impactCard: { paddingVertical: 6, paddingHorizontal: 16 },
  impactRow: { flexDirection: 'row', gap: 10, paddingVertical: 10, alignItems: 'center' },
  impactDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.10)' },
  impactMain: { flex: 1, gap: 2 },
  impactLine: { color: '#FFFFFF', fontSize: 14, lineHeight: 19, fontVariant: ['tabular-nums'] },
  impactConf: { color: TERTIARY, fontSize: 11, lineHeight: 14, textTransform: 'uppercase', letterSpacing: 0.4 },
  verdictRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, marginLeft: 4 },
  verdictDot: { width: 8, height: 8, borderRadius: 4 },
  verdictText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  title2: { color: '#FFFFFF', fontSize: 18, lineHeight: 23, fontWeight: '600', letterSpacing: -0.3 },
  body: { color: SECONDARY, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  disclaimer: { fontWeight: '400', fontSize: 12, lineHeight: 17, color: TERTIARY, textAlign: 'center', paddingHorizontal: SPACE.screenH, paddingBottom: 8 },
});
