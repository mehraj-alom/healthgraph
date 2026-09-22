/**
 * WellbeingEngineScreen — the Wellbeing goal engine (Batch 6G).
 *
 * Reports user-entered 1–5 ratings only: weekly averages for mood,
 * energy, and stress with their original scales, absolute point changes,
 * and real day history. No clinical instruments exist, no emotions are
 * classified, nothing is combined. Empty state is honest when
 * nothing is rated, with a path to the DailyLog check-in that creates
 * the data. Copy reports recorded values — never improved or declined
 * as a health judgment, never causal.
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
import { StageGradient } from '@/components/StageGradient';
import { useWellbeingEngine } from '@/hooks/useWellbeingEngine';
import {
  formatRating,
  type WellbeingDay,
} from '@/screens/WellbeingEngine/wellbeingEngine';

function formatDayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date.slice(5);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ratingPart(label: string, value: number | null): string | null {
  return value == null ? null : `${label} ${value}/5`;
}

function daySub(day: WellbeingDay): string {
  const parts = [formatDayLabel(day.date)];
  for (const part of [
    ratingPart('Mood', day.mood),
    ratingPart('Energy', day.energy),
    ratingPart('Stress', day.stress),
  ]) {
    if (part) parts.push(part);
  }
  return parts.join(' · ');
}

export default function WellbeingEngineScreen() {
  const navigation = useNavigation();
  const { days, summary, moodLine, energyLine, stressLine, isLoading } = useWellbeingEngine();

  const goLog = useCallback(() => {
    const nav = navigation as unknown as {
      navigate: (route: string) => void;
    };
    nav.navigate('DailyLog');
  }, [navigation]);

  const averages: { title: string; value: number | null; line: string | null }[] = [
    { title: 'Average mood', value: summary.avgMood, line: moodLine },
    { title: 'Average energy', value: summary.avgEnergy, line: energyLine },
    { title: 'Average stress', value: summary.avgStress, line: stressLine },
  ];

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
        <Text style={styles.overline}>Wellbeing engine · From your ratings</Text>
        <Text style={styles.title}>Wellbeing</Text>
        <Text style={styles.sub}>
          See your recorded mood, energy, and stress.
        </Text>

        {isLoading ? (
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : summary.ratedDays === 0 ? (
          <EmptyState
            icon="🌿"
            title="No ratings logged yet"
            message="Wellbeing tracking starts with your daily check-in. Rate your mood, energy, and stress and averages and changes appear here. Only from real entries."
          />
        ) : (
          <>
            <SectionHeader title="This week" />
            <Card>
              <Text style={styles.bigValue}>
                {`${summary.ratedDays} ${summary.ratedDays === 1 ? 'rated day' : 'rated days'}`}
              </Text>
              <Text style={styles.avgSub}>Days with at least one rating</Text>
            </Card>

            {averages.map(({ title, value, line }) =>
              value == null ? null : (
                <View key={title}>
                  <SectionHeader title={title} />
                  <Card>
                    <Text style={styles.bigValue}>{formatRating(value)}</Text>
                    {line ? <Text style={styles.change}>{line}</Text> : null}
                    <Text style={styles.provenance}>User-entered 1–5 ratings.</Text>
                  </Card>
                </View>
              ),
            )}

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
                      </View>
                    </View>
                  </Card>
                ))}
            </View>
          </>
        )}

        <Button title="Log a check-in" onPress={goLog} fullWidth />
        <Text style={styles.disclaimer}>
          From your check-ins on this device. Tracking only — not medical advice, diagnosis, or treatment.
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
  change: { ...TYPE.body, color: GV.body, textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  provenance: { ...TYPE.caption, color: GV.muted, textAlign: 'center', marginTop: 8 },
  avgSub: { ...TYPE.caption, color: GV.muted, textAlign: 'center', marginTop: 4 },
  list: { gap: SPACE.cardGap },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowMain: { flex: 1, gap: 4 },
  rowTitle: { ...TYPE.button, fontSize: 15, color: GV.ink, fontVariant: ['tabular-nums'] },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
});
