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
import { GV, TYPE, FONT } from '@/theme/guava';
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
  // One meaningful color only: failed syncs read red, everything else
  // stays quiet. The words beside the dot carry the rest.
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
      case 'Documents':
        navigation.navigate('Documents');
        break;
      case 'Substance':
        navigation.navigate('Substance');
        break;
      case 'Cycle':
        navigation.navigate('Cycle');
        break;
      case 'MeditationEngine':
        navigation.navigate('MeditationEngine');
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

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.title}>Everything you track.</Text>
          <Text style={styles.sub}>This page fills in as you log.</Text>
        </View>

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
            ) : null}

            {todo.length > 0 ? (
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
            ) : null}
          </>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.4}>Recent activity</Text>
          <Text style={styles.sectionSub}>Newest first.</Text>
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
                Log a day and it will show up here.
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
      </ScrollView>
    </SafeAreaView>
  );
}

const NAVY = '#080A11';
const TILE_BG = '#2A3049';
const HAIRLINE_ON_NAVY = 'rgba(255, 255, 255, 0.12)';

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: NAVY,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 12,
  },
  hero: {
    gap: 6,
    alignItems: 'center',
  },
  title: {
    fontFamily: FONT.semi,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.3,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  sub: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
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
    gap: 12,
    marginTop: 4,
  },
  skelTile: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
    padding: 12,
    gap: 8,
    minHeight: 104,
  },
  fact: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    marginTop: 4,
  },
  groupedCard: {
    backgroundColor: TILE_BG,
    borderWidth: 1,
    borderColor: HAIRLINE_ON_NAVY,
    borderRadius: 8,
    paddingHorizontal: 16,
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
    borderBottomColor: HAIRLINE_ON_NAVY,
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
    backgroundColor: HAIRLINE_ON_NAVY,
    marginTop: 4,
  },
  activityMain: {
    flex: 1,
    gap: 2,
  },
  activityTitle: {
    ...TYPE.button,
    fontSize: 15,
    color: '#FFFFFF',
  },
  activitySub: {
    ...TYPE.caption,
    color: GV.fog,
    fontVariant: ['tabular-nums'],
  },
  sourceText: {
    ...TYPE.caption,
    fontSize: 12,
    color: GV.fog,
    paddingTop: 2,
  },
  emptyCard: {
    backgroundColor: TILE_BG,
    borderWidth: 1,
    borderColor: HAIRLINE_ON_NAVY,
    borderRadius: 8,
    padding: 16,
    gap: 4,
    marginTop: 4,
  },
  emptyTitle: {
    ...TYPE.title,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  emptyBody: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
  },
});
