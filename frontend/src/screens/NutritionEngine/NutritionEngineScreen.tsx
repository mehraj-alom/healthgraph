/**
 * NutritionEngineScreen — the Nutrition goal engine (Batch 6F).
 *
 * Reports logged meals only: meal counts, food-scan estimated calories
 * (labeled as estimates, never measured), meal-type distribution over
 * logged meals, and real day history. Macros are not persisted anywhere
 * and therefore never appear. No deficit math, no targets, no adequacy
 * judgments, no diet ratings. Empty state is honest when nothing is logged, with
 * paths to the DailyLog check-in and FoodScan flows that create the
 * data. Copy is descriptive — never healthy or unhealthy, never causal.
 */

import { useCallback } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, Card, EmptyState, SectionHeader } from '@/components';
import { EngineGraph } from '@/components/EngineGraph';
import { HealthFact } from '@/components/HealthFact';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { TILE_TONES } from '@/theme/tones';
import { useNutritionEngine } from '@/hooks/useNutritionEngine';
import {
  formatKcal,
  type NutritionDay,
} from '@/screens/NutritionEngine/nutritionEngine';

function formatDayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date.slice(5);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function daySub(day: NutritionDay): string {
  const parts = [formatDayLabel(day.date)];
  if (day.meals != null) parts.push(day.meals === 1 ? '1 meal' : `${day.meals} meals`);
  if (day.kcal != null) parts.push(`est. ${formatKcal(day.kcal)}`);
  return parts.join(' · ');
}

export default function NutritionEngineScreen() {
  const navigation = useNavigation();
  const {
    days,
    summary,
    week,
    mealsLine,
    kcalLine,
    typeCounts,
    classifiedMeals,
    isLoading,
  } = useNutritionEngine();

  const go = useCallback(
    (route: string) => {
      const nav = navigation as unknown as {
        navigate: (r: string) => void;
      };
      nav.navigate(route);
    },
    [navigation],
  );

  const weekMeals = week.reduce((s, d) => s + d.meals, 0);
  // Calories where scanned, otherwise meals per day — only logged days plot.
  const kcalPoints = [...days]
    .filter((d) => d.kcal != null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((d) => ({ date: d.date, value: d.kcal as number }));
  const mealPoints = [...days]
    .filter((d) => d.meals != null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((d) => ({ date: d.date, value: d.meals as number }));
  const graph = kcalPoints.length > 0
    ? { title: 'Calories', points: kcalPoints, decimals: 0 }
    : { title: 'Meals per day', points: mealPoints, decimals: 0 };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Nutrition.</Text>
        <Text style={styles.sub}>Logged meals only.</Text>

        {isLoading ? (
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : summary.activeDays === 0 ? (
          <EmptyState
            title="No meals logged yet"
            message="Log meals or scan food to begin."
          />
        ) : (
          <>
            <SectionHeader dark title="This week" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
              <Text style={styles.bigValue}>
                {`${summary.mealsLogged} ${summary.mealsLogged === 1 ? 'meal' : 'meals'}`}
              </Text>
              <Text style={styles.avgSub}>
                {`Logged meals · ${summary.activeDays} ${summary.activeDays === 1 ? 'day' : 'days'}`}
              </Text>
              {mealsLine ? <Text style={styles.change}>{mealsLine}</Text> : null}
            </Card>

            {summary.kcalLogged != null ? (
              <>
                <SectionHeader dark title="Estimated calories" titleStyle={styles.histTitle} />
                <Card style={styles.darkCard}>
                  <Text style={styles.bigValue}>{formatKcal(summary.kcalLogged)}</Text>
                  <Text style={styles.avgSub}>
                    {summary.avgKcalPerDay != null
                      ? `Avg ${formatKcal(summary.avgKcalPerDay)}/day · ${summary.kcalDays} ${summary.kcalDays === 1 ? 'day' : 'days'}`
                      : 'Estimated intake'}
                  </Text>
                  {kcalLine ? <Text style={styles.change}>{kcalLine}</Text> : null}
                  <Text style={styles.provenance}>
                    Scans estimate. Not measured, not a target.
                  </Text>
                </Card>
              </>
            ) : null}

            {classifiedMeals > 0 ? (
              <>
                <SectionHeader dark title="Logged meals by type" titleStyle={styles.histTitle} />
                <Card style={styles.darkCard}>
                  {typeCounts.map(({ type, count }) => (
                    <View key={type} style={styles.typeRow}>
                      <View style={[styles.typeDot, { backgroundColor: TILE_TONES.nutrition[1] }]} />
                      <Text style={styles.typeLabel}>{type}</Text>
                      <Text style={styles.typeCount}>{`${count} of ${classifiedMeals}`}</Text>
                    </View>
                  ))}
                  <Text style={styles.provenance}>
                    Logged meals only.
                  </Text>
                </Card>
              </>
            ) : null}

            {graph.points.length > 0 ? (
              <>
                <SectionHeader dark title={graph.title} titleStyle={styles.histTitle} />
                <Card style={styles.darkCard}>
                  <EngineGraph points={graph.points} tone={TILE_TONES.nutrition[1]} decimals={graph.decimals} />
                  <Text style={styles.avgSub}>
                    {`${graph.points.length} ${graph.points.length === 1 ? 'day' : 'days'}`}
                  </Text>
                </Card>
              </>
            ) : null}

            <SectionHeader dark title="Recent days" titleStyle={styles.histTitle} />
            <View style={styles.list}>
              {[...days]
                .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
                .slice(0, 14)
                .map((day) => (
                  <Card key={day.date} style={styles.darkCard}>
                    <View style={styles.rowTop}>
                      <View style={styles.rowMain}>
                        <Text style={styles.rowTitle}>{daySub(day)}</Text>
                        {day.label ? (
                          <Text style={styles.rowSub} numberOfLines={2}>
                            {day.label}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </Card>
                ))}
            </View>
          </>
        )}

        <Button
          title="Log meals"
          onPress={() => go('DailyLog')}
          fullWidth
          size="large"
          style={styles.logBtn}
          textStyle={styles.logBtnText}
        />
        <Button
          title="Scan food"
          variant="ghost"
          onPress={() => go('FoodScan')}
          fullWidth
          textStyle={styles.scanText}
        />
        <Text style={styles.disclaimer}>
          From your check-ins and food scans on this device. Tracking only — not medical advice, diagnosis, or treatment.
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
  loading: { ...TYPE.body, color: GV.fog, textAlign: 'center', marginTop: 16 },
  fact: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  darkCard: {
    backgroundColor: '#10141F',
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  bigValue: { ...TYPE.display, fontSize: 40, color: '#FFFFFF', textAlign: 'center', fontVariant: ['tabular-nums'] },
  avgSub: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 4, fontVariant: ['tabular-nums'] },
  change: { ...TYPE.body, color: '#E8ECF1', textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  provenance: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  typeDot: { width: 8, height: 8, borderRadius: 4 },
  typeLabel: { ...TYPE.body, color: '#FFFFFF', flex: 1 },
  typeCount: { ...TYPE.body, color: GV.fog, fontVariant: ['tabular-nums'] },
  list: { gap: SPACE.cardGap },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowMain: { flex: 1, gap: 4 },
  rowTitle: { ...TYPE.button, fontSize: 15, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  rowSub: { ...TYPE.caption, color: GV.fog },
  logBtn: { backgroundColor: '#4FD1C5' },
  logBtnText: { color: '#062A26' },
  scanText: { color: '#A7B8B2' },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
});
