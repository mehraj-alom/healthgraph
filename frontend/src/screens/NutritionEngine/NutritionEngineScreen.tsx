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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, Card, EmptyState, SectionHeader } from '@/components';
import { HealthFact } from '@/components/HealthFact';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { TILE_TONES } from '@/theme/tones';
import { StageGradient } from '@/components/StageGradient';
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
        <Text style={styles.overline}>Nutrition engine · From your logged meals</Text>
        <Text style={styles.title}>Nutrition</Text>
        <Text style={styles.sub}>
          See your logged meals and estimated calories.
        </Text>

        {isLoading ? (
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : summary.activeDays === 0 ? (
          <EmptyState
            icon="🍽️"
            title="No meals logged yet"
            message="Nutrition tracking starts with your daily check-in or a food scan. Logged meals, estimated calories and changes appear here. Only from real entries."
          />
        ) : (
          <>
            <SectionHeader title="This week" />
            <Card>
              <Text style={styles.bigValue}>
                {`${summary.mealsLogged} ${summary.mealsLogged === 1 ? 'meal' : 'meals'}`}
              </Text>
              <Text style={styles.avgSub}>
                {`Logged meals · ${summary.activeDays} ${summary.activeDays === 1 ? 'active day' : 'active days'}`}
              </Text>
              {mealsLine ? <Text style={styles.change}>{mealsLine}</Text> : null}
            </Card>

            {summary.kcalLogged != null ? (
              <>
                <SectionHeader title="Estimated calories" />
                <Card>
                  <Text style={styles.bigValue}>{formatKcal(summary.kcalLogged)}</Text>
                  <Text style={styles.avgSub}>
                    {summary.avgKcalPerDay != null
                      ? `Average estimated intake: ${formatKcal(summary.avgKcalPerDay)}/day over ${summary.kcalDays} ${summary.kcalDays === 1 ? 'day' : 'days'}`
                      : 'Estimated intake'}
                  </Text>
                  {kcalLine ? <Text style={styles.change}>{kcalLine}</Text> : null}
                  <Text style={styles.provenance}>
                    Estimated by food scans. Not measured, not a target.
                  </Text>
                </Card>
              </>
            ) : null}

            {classifiedMeals > 0 ? (
              <>
                <SectionHeader title="Logged meals by type" />
                <Card>
                  {typeCounts.map(({ type, count }) => (
                    <View key={type} style={styles.typeRow}>
                      <View style={[styles.typeDot, { backgroundColor: TILE_TONES.nutrition[1] }]} />
                      <Text style={styles.typeLabel}>{type}</Text>
                      <Text style={styles.typeCount}>{`${count} of ${classifiedMeals}`}</Text>
                    </View>
                  ))}
                  <Text style={styles.provenance}>
                    Logged meals only. Not dietary quality.
                  </Text>
                </Card>
              </>
            ) : null}

            <SectionHeader title="Recent days" />
            <View style={styles.list}>
              {[...days]
                .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
                .slice(0, 14)
                .map((day) => (
                  <Card key={day.date}>
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

        <Button title="Log meals" onPress={() => go('DailyLog')} fullWidth />
        <Button title="Scan food" variant="ghost" onPress={() => go('FoodScan')} fullWidth />
        <Text style={styles.disclaimer}>
          From your check-ins and food scans on this device. Tracking only — not medical advice, diagnosis, or treatment.
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
  loading: { ...TYPE.body, color: GV.fog, textAlign: 'center', marginTop: 16 },
  fact: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  bigValue: { ...TYPE.display, fontSize: 40, color: GV.ink, textAlign: 'center', fontVariant: ['tabular-nums'] },
  avgSub: { ...TYPE.caption, color: GV.muted, textAlign: 'center', marginTop: 4 },
  change: { ...TYPE.body, color: GV.body, textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  provenance: { ...TYPE.caption, color: GV.muted, textAlign: 'center', marginTop: 8 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  typeDot: { width: 8, height: 8, borderRadius: 4 },
  typeLabel: { ...TYPE.body, color: GV.ink, flex: 1 },
  typeCount: { ...TYPE.body, color: GV.body, fontVariant: ['tabular-nums'] },
  list: { gap: SPACE.cardGap },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowMain: { flex: 1, gap: 4 },
  rowTitle: { ...TYPE.button, fontSize: 15, color: GV.ink, fontVariant: ['tabular-nums'] },
  rowSub: { ...TYPE.caption, color: GV.body },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
});
