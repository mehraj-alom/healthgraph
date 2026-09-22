/**
 * HealthAreasScreen - one honest hub for every health area.
 *
 * Oura style summary first (one hero number, live of total, thin
 * progress track), live areas as a 2 column bento of tappable tiles,
 * the rest as one quiet inset grouped list, activity as one grouped
 * card with a timeline rail. Only real rows ever render. Tapping a
 * tile with a destination opens that area's existing screen; skin is
 * display only by design.
 */

import { ScrollView, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { StageGradient } from '@/components/StageGradient';
import { Skeleton } from '@/components/Skeleton';
import { HealthFact } from '@/components/HealthFact';
import { useHealthAreas } from '@/hooks/useHealthAreas';
import { useActiveEngines } from '@/hooks/useActiveEngines';
import { orderAreasByEngines } from '@/screens/HealthAreas/areas';
import { useHealthActivity, type ActivityItem } from '@/hooks/useHealthActivity';
import { useHealthChanges } from '@/hooks/useHealthChanges';
import { HealthAreaTile, HealthAreaRow } from '@/components/health/HealthAreaCard';
import { areaRouteName, type HealthAreaId } from '@/screens/HealthAreas/areas';
import type { RootStackParamList } from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Compact day label relative to today (Today / Yesterday / Mon DD). */
function relativeDay(date: string): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const today = `${y}-${m}-${d}`;
  if (date === today) return 'Today';
  const dt = new Date(`${date}T12:00:00`);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yy = yesterday.getFullYear();
  const ym = String(yesterday.getMonth() + 1).padStart(2, '0');
  const yd = String(yesterday.getDate()).padStart(2, '0');
  if (date === `${yy}-${ym}-${yd}`) return 'Yesterday';
  if (Number.isNaN(dt.getTime())) return date;
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function provenanceDot(p: string): string {
  if (p === 'device') return GV.cta;
  if (p === 'pending') return GV.fx.amber;
  if (p === 'failed') return GV.danger;
  return GV.muted;
}

export default function HealthAreasScreen() {
  const navigation = useNavigation<Nav>();
  const { areas, isLoading } = useHealthAreas();
  const activity = useHealthActivity();
  const { changes } = useHealthChanges();
  // Engine influence (Batch 6A integration point): active-engine areas pin
  // to the top, stably. No dashboards yet, order only.
  const { ids: activeEngineIds } = useActiveEngines();
  const orderedAreas = orderAreasByEngines(areas, activeEngineIds);

  const go = (id: HealthAreaId) => {
    // Typed dispatch (tsc-verified route params); the mapping itself lives
    // in areaRouteName so completeness is unit-pinned.
    switch (areaRouteName(id)) {
      case 'Main':
        navigation.navigate('Main', { screen: 'PpgMeasure' });
        break;
      case 'DailyLog':
        navigation.navigate('DailyLog');
        break;
      case 'Medications':
        navigation.navigate('Medications');
        break;
      case 'Timeline':
        navigation.navigate('Timeline');
        break;
      case 'Substance':
        navigation.navigate('Substance');
        break;
      case 'Cycle':
        navigation.navigate('Cycle');
        break;
      case 'SleepEngine':
        navigation.navigate('SleepEngine');
        break;
      case 'WeightEngine':
        navigation.navigate('WeightEngine');
        break;
      case 'DisciplineEngine':
        navigation.navigate('DisciplineEngine');
        break;
      case 'FitnessEngine':
        navigation.navigate('FitnessEngine');
        break;
      case 'NutritionEngine':
        navigation.navigate('NutritionEngine');
        break;
      case 'WellbeingEngine':
        navigation.navigate('WellbeingEngine');
        break;
      case 'HeartEngine':
        navigation.navigate('HeartEngine');
        break;
      case null:
        break;
    }
  };

  const pressable = (id: HealthAreaId): boolean =>
    id !== 'skin';

  const goActivity = (item: ActivityItem) => {
    const route = item.route;
    if (!route) return;
    // Typed dispatch per route (tsc-verified params).
    switch (route.name) {
      case 'DailyLog':
        navigation.navigate('DailyLog');
        break;
      case 'Medications':
        navigation.navigate('Medications');
        break;
      case 'Main':
        navigation.navigate('Main', { screen: 'PpgMeasure' });
        break;
      case 'Substance':
        navigation.navigate('Substance');
        break;
      case 'Cycle':
        navigation.navigate('Cycle');
        break;
      case 'DocumentDetail':
        navigation.navigate('DocumentDetail', {
          documentId: String(route.params?.documentId ?? ''),
        });
        break;
    }
  };

  const live = orderedAreas.filter((a) => a.status === 'available');
  const todo = orderedAreas.filter((a) => a.status !== 'available');
  const total = orderedAreas.length;
  const pct = total > 0 ? Math.round((live.length / total) * 100) : 0;

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
          <Text style={styles.backText} maxFontSizeMultiplier={1.4}>‹ Back</Text>
        </Pressable>

        <View style={styles.hero}>
          <Text style={styles.title} maxFontSizeMultiplier={1.4}>Everything you track</Text>
          <Text style={styles.sub}>One place for every area. Only real entries count.</Text>
        </View>

        {isLoading ? (
          <View style={styles.heroCard} accessible accessibilityLabel="Loading areas">
            <Skeleton width="45%" height={14} />
            <Skeleton width="70%" height={34} />
            <Skeleton width="100%" height={6} />
          </View>
        ) : (
          <View style={styles.heroCard} accessible accessibilityLabel={`${live.length} of ${total} areas live`}>
            <View style={styles.heroRow}>
              <Text style={styles.heroNumber} maxFontSizeMultiplier={1.3}>{live.length}</Text>
              <View style={styles.heroMeta}>
                <Text style={styles.heroOf} maxFontSizeMultiplier={1.4}>of {total} live</Text>
                <Text style={styles.heroHint} maxFontSizeMultiplier={1.4}>
                  {live.length === 0
                    ? 'Start one area below'
                    : todo.length === 0
                      ? 'Every area is live'
                      : `${todo.length} still to start`}
                </Text>
              </View>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${pct}%` as `${number}%` }]} />
            </View>
            <Text style={styles.heroFoot}>The rest wait until you log them.</Text>
          </View>
        )}

        {isLoading ? (
          <>
            <View style={styles.grid}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <View key={i} style={styles.skelTile}>
                  <Skeleton width="45%" height={12} />
                  <Skeleton width="80%" height={24} />
                  <Skeleton width="60%" height={12} />
                </View>
              ))}
            </View>
            <HealthFact style={styles.fact} />
          </>
        ) : (
          <>
            {live.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.4}>Live now</Text>
                <View style={styles.grid}>
                  {live.map((area) => (
                    <HealthAreaTile
                      key={area.id}
                      area={area}
                      change={changes[area.id] ?? null}
                      onPress={pressable(area.id) ? () => go(area.id) : undefined}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {todo.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.4}>
                  {live.length > 0 ? 'To start' : 'Start tracking'}
                </Text>
                <Text style={styles.sectionSub}>Nothing estimated. Pick one when ready.</Text>
                <View style={styles.groupedCard}>
                  {todo.map((area, i, arr) => (
                    <HealthAreaRow
                      key={area.id}
                      area={area}
                      last={i === arr.length - 1}
                      onPress={pressable(area.id) ? () => go(area.id) : undefined}
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.4}>Recent activity</Text>
          <Text style={styles.sectionSub}>Newest first, from real entries.</Text>
          {activity.isLoading ? (
            <View style={styles.groupedCard}>
              <Skeleton width="60%" height={14} />
              <Skeleton width="100%" height={14} />
              <Skeleton width="80%" height={14} />
            </View>
          ) : activity.items.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle} maxFontSizeMultiplier={1.4}>No recent activity yet</Text>
              <Text style={styles.emptyBody}>
                Log a day, take a measurement, or add a record. It shows up here first.
              </Text>
            </View>
          ) : (
            <View style={styles.groupedCard}>
              {activity.items.slice(0, 8).map((item, i, arr) => (
                <Pressable
                  key={item.key}
                  onPress={item.route ? () => goActivity(item) : undefined}
                  disabled={!item.route}
                  accessibilityRole={item.route ? 'button' : undefined}
                  accessibilityLabel={`${item.title}${item.detail ? `, ${item.detail}` : ''}`}
                  hitSlop={4}
                  style={({ pressed }) => [
                    styles.tlRow,
                    i < arr.length - 1 && styles.tlDivider,
                    pressed && item.route && { opacity: 0.85 },
                  ]}
                >
                  <View style={styles.rail}>
                    <View style={[styles.railDot, { backgroundColor: provenanceDot(item.provenance) }]} />
                    {i < arr.length - 1 ? <View style={styles.railLine} /> : null}
                  </View>
                  <View style={styles.activityMain}>
                    <Text style={styles.activityTitle} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                      {item.title}
                    </Text>
                    <Text style={styles.activitySub} numberOfLines={1}>
                      {relativeDay(item.date)}
                      {item.detail ? ` ${item.detail}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.sourceText} maxFontSizeMultiplier={1.4}>
                    {item.provenance === 'device'
                      ? 'On this device'
                      : item.provenance === 'pending'
                        ? 'Sync pending'
                        : item.provenance === 'failed'
                          ? "Couldn't sync"
                          : 'Synced'}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <Text style={styles.footnote}>
          Device-only areas stay on this phone. Synced areas back up with your account.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: GV.stage,
  },
  content: {
    paddingHorizontal: SPACE.screenH,
    paddingVertical: SPACE.sectionGap,
    paddingBottom: 32,
    gap: 20,
  },
  backHit: { minHeight: 44, justifyContent: 'center' },
  backText: { ...TYPE.button, fontSize: 16, color: GV.fog },
  hero: {
    gap: 6,
  },
  title: {
    ...TYPE.display,
    color: GV.card,
    textAlign: 'left',
    letterSpacing: -0.4,
  },
  sub: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'left',
  },
  heroCard: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
    gap: 12,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  heroNumber: {
    fontFamily: FONT.semi,
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -0.9,
    color: GV.ink,
    fontVariant: ['tabular-nums'],
  },
  heroMeta: {
    flex: 1,
    gap: 2,
    paddingBottom: 4,
  },
  heroOf: {
    ...TYPE.button,
    fontSize: 15,
    color: GV.ink,
  },
  heroHint: {
    ...TYPE.caption,
    color: GV.muted,
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: GV.wash,
    overflow: 'hidden',
  },
  fill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: GV.cta,
  },
  heroFoot: {
    ...TYPE.caption,
    color: GV.muted,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    ...TYPE.title,
    color: '#FFFFFF',
    textAlign: 'left',
  },
  sectionSub: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONT.regular,
    color: GV.fog,
    textAlign: 'left',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.cardGap,
    marginTop: 4,
  },
  skelTile: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: 16,
    gap: 8,
    minHeight: 132,
  },
  fact: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    marginTop: 4,
  },
  groupedCard: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    paddingHorizontal: SPACE.cardPad,
    paddingVertical: 4,
    marginTop: 4,
  },
  tlRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    minHeight: 64,
  },
  tlDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GV.line,
  },
  rail: {
    width: 10,
    alignItems: 'center',
    paddingTop: 6,
    alignSelf: 'stretch',
  },
  railDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  railLine: {
    flex: 1,
    width: StyleSheet.hairlineWidth,
    backgroundColor: GV.line,
    marginTop: 4,
  },
  activityMain: {
    flex: 1,
    gap: 2,
  },
  activityTitle: {
    ...TYPE.button,
    fontSize: 15,
    color: GV.ink,
  },
  activitySub: {
    ...TYPE.caption,
    color: GV.body,
    fontVariant: ['tabular-nums'],
  },
  sourceText: {
    ...TYPE.caption,
    fontSize: 12,
    color: GV.muted,
    paddingTop: 2,
  },
  emptyCard: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
    gap: 4,
    marginTop: 4,
  },
  emptyTitle: {
    ...TYPE.title,
    color: GV.ink,
    textAlign: 'center',
  },
  emptyBody: {
    ...TYPE.body,
    color: GV.body,
    textAlign: 'center',
  },
  footnote: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    marginTop: 4,
  },
});
