/**
 * InsightsScreen — the cross-engine correlation feed, first-class.
 *
 * Same live feed + curation as the dashboard preview (shared
 * useCuratedFeed), rendered full-bleed: every insight card with its
 * verdict, pull-to-refresh, honest empty state. Custom-correlation
 * building stays on the Dashboard; this screen is for reading.
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
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { graphToneForStream } from '@/theme/tones';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { useTrends } from '@/hooks/useTrends';
import {
  useCorrelationFeed,
  verdictLabel,
  type CorrelationFeedItem,
} from '@/screens/Dashboard/correlations';
import { useCuratedFeed } from '@/screens/Dashboard/useCuratedFeed';

const VERDICT_COLORS: Record<string, string> = {
  good: '#4FD1C5',
  bad: '#F27E7E',
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
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Insights.</Text>
        <Text style={styles.sub}>
          {visibleFeed.length > 0
            ? `${visibleFeed.length} live ${visibleFeed.length === 1 ? 'connection' : 'connections'} across your engines`
            : 'How your engines move together.'}
        </Text>
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4FD1C5" />
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
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#4FD1C5" />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.title2}>No insights yet</Text>
              <Text style={styles.body}>
                Log sleep, mood, activity, and water for a few days — connections appear here.
              </Text>
            </View>
          }
        />
      )}
      <Text style={styles.disclaimer}>
        Correlations from your logged data — patterns, not causes. Tracking only.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080A11' },
  header: { paddingHorizontal: SPACE.screenH, paddingTop: 8, paddingBottom: 4 },
  title: { fontFamily: FONT.semi, fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: '#FFFFFF', textAlign: 'center' },
  sub: { ...TYPE.body, color: GV.fog, textAlign: 'center', marginTop: 2 },
  list: { paddingHorizontal: SPACE.screenH, paddingBottom: 24, gap: 12 },
  section: { marginTop: 4 },
  verdictRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, marginLeft: 4 },
  verdictDot: { width: 8, height: 8, borderRadius: 4 },
  verdictText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  title2: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  body: { color: '#8EA0B8', fontSize: 14, textAlign: 'center' },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center', paddingHorizontal: SPACE.screenH, paddingBottom: 8 },
});
