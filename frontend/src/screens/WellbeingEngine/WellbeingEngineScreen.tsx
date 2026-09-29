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

  // One plotted line: mood first, then energy, then stress. Fixed 1–5 scale.
  const byDate = (pick: (d: (typeof days)[number]) => number | null) =>
    [...days]
      .filter((d) => pick(d) != null)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((d) => ({ date: d.date, value: pick(d) as number }));
  const moodPts = byDate((d) => d.mood);
  const energyPts = byDate((d) => d.energy);
  const stressPts = byDate((d) => d.stress);
  const graph =
    moodPts.length > 0
      ? { title: 'Mood', points: moodPts }
      : energyPts.length > 0
        ? { title: 'Energy', points: energyPts }
        : { title: 'Stress', points: stressPts };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Wellbeing.</Text>
        <Text style={styles.sub}>Recorded ratings only.</Text>

        {isLoading ? (
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : summary.ratedDays === 0 ? (
          <EmptyState
            title="No ratings logged yet"
            message="Rate your mood, energy, and stress to begin."
          />
        ) : (
          <>
            <SectionHeader dark title="This week" titleStyle={styles.histTitle} />
            <Card style={styles.toneCard}>
              <Text style={styles.bigValue}>
                {`${summary.ratedDays} ${summary.ratedDays === 1 ? 'rated day' : 'rated days'}`}
              </Text>
              <Text style={styles.avgSub}>Days with at least one rating</Text>
            </Card>

            {averages.map(({ title, value, line }) =>
              value == null ? null : (
                <View key={title}>
                  <SectionHeader dark title={title} titleStyle={styles.histTitle} />
                  <Card style={styles.toneCard}>
                    <Text style={styles.bigValue}>{formatRating(value)}</Text>
                    {line ? <Text style={styles.change}>{line}</Text> : null}
                    <Text style={styles.provenance}>Your 1–5 ratings.</Text>
                  </Card>
                </View>
              ),
            )}

            {graph.points.length > 0 ? (
              <>
                <SectionHeader dark title={graph.title} titleStyle={styles.histTitle} />
                <Card style={styles.toneCard}>
                  <EngineGraph
                    points={graph.points}
                    tone={TILE_TONES.wellbeing[1]}
                    decimals={0}
                    domain={[1, 5]}
                    ticks={[1, 2, 3, 4, 5]}
                  />
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
                      </View>
                    </View>
                  </Card>
                ))}
            </View>
          </>
        )}

        <Button
          title="Log a check-in"
          onPress={goLog}
          fullWidth
          size="large"
          style={styles.logBtn}
          textStyle={styles.logBtnText}
        />
        <Text style={styles.disclaimer}>
          From your check-ins on this device. Tracking only — not medical advice, diagnosis, or treatment.
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
  bigValue: { ...TYPE.display, fontSize: 40, color: '#FFFFFF', textAlign: 'center', fontVariant: ['tabular-nums'] },
  darkCard: {
    backgroundColor: '#10141F',
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  toneCard: {
    backgroundColor: '#10141F',
    borderColor: 'rgba(255,255,255,0.10)',
    borderLeftWidth: 4,
    borderLeftColor: TILE_TONES.wellbeing[1],
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  change: { ...TYPE.body, color: '#E8ECF1', textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  provenance: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  avgSub: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 4, fontVariant: ['tabular-nums'] },
  list: { gap: SPACE.cardGap },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowMain: { flex: 1, gap: 4 },
  rowTitle: { ...TYPE.button, fontSize: 15, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  logBtn: { backgroundColor: '#4FD1C5' },
  logBtnText: { color: '#062A26' },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
});
