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
import { Button, EmptyState } from '@/components';
import { EngineGraph } from '@/components/EngineGraph';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { SPACE } from '@/theme/guava';
import { TILE_TONES } from '@/theme/tones';
import { useWellbeingEngine } from '@/hooks/useWellbeingEngine';
import {
  formatRating,
  type WellbeingDay,
} from '@/screens/WellbeingEngine/wellbeingEngine';

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

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
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Wellbeing</Text>
          <Text style={styles.sub}>Recorded ratings only.</Text>

          {isLoading ? (
            <View style={styles.center}>
              <Text style={styles.loading}>Loading…</Text>
            </View>
          ) : summary.ratedDays === 0 ? (
            <EmptyState
              title="No ratings logged yet"
              message="Rate your mood, energy, and stress to begin."
            />
          ) : (
            <>
              <Text style={styles.sectionTitle}>This week</Text>
              <GlassSurface strong style={styles.card}>
                <Text style={styles.bigValue}>
                  {`${summary.ratedDays} ${summary.ratedDays === 1 ? 'rated day' : 'rated days'}`}
                </Text>
                <Text style={styles.avgSub}>Days with at least one rating</Text>
              </GlassSurface>

              {averages.map(({ title, value, line }) =>
                value == null ? null : (
                  <View key={title}>
                    <Text style={styles.sectionTitle}>{title}</Text>
                    <GlassSurface strong style={styles.card}>
                      <Text style={styles.bigValue}>{formatRating(value)}</Text>
                      {line ? <Text style={styles.change}>{line}</Text> : null}
                      <Text style={styles.provenance}>Your 1–5 ratings.</Text>
                    </GlassSurface>
                  </View>
                ),
              )}

              {graph.points.length > 0 ? (
                <>
                  <Text style={styles.sectionTitle}>{graph.title}</Text>
                  <GlassSurface strong style={styles.card}>
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
                  </GlassSurface>
                </>
              ) : null}

              <Text style={styles.sectionTitle}>Recent days</Text>
              <View style={styles.list}>
                {[...days]
                  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
                  .slice(0, 14)
                  .map((day) => (
                    <GlassSurface key={day.date} strong style={styles.card}>
                      <View style={styles.rowTop}>
                        <View style={styles.rowMain}>
                          <Text style={styles.rowTitle}>{daySub(day)}</Text>
                        </View>
                      </View>
                    </GlassSurface>
                  ))}
              </View>
            </>
          )}

          <Button
            title="Log a check-in"
            onPress={goLog}
            fullWidth
            size="large"
            variant="secondary"
            style={styles.logBtn}
            textStyle={styles.logBtnText}
          />
          <Text style={styles.disclaimer}>
            From your check-ins on this device. Tracking only — not medical advice, diagnosis, or treatment.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070F' },
  safe: { flex: 1 },
  content: { paddingHorizontal: SPACE.screenH, paddingVertical: 12, paddingBottom: 32, gap: 12 },
  title: { fontWeight: '600', fontSize: 34, lineHeight: 41, letterSpacing: -0.8, color: '#FFFFFF', textAlign: 'center' },
  sub: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center' },
  sectionTitle: { fontWeight: '600', fontSize: 20, lineHeight: 26, letterSpacing: -0.4, color: '#FFFFFF', marginTop: 8 },
  loading: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center', marginTop: 16 },
  center: { alignItems: 'center', paddingVertical: 24 },
  card: { padding: 16 },
  bigValue: { fontWeight: '600', fontSize: 40, lineHeight: 46, color: '#FFFFFF', textAlign: 'center', fontVariant: ['tabular-nums'] },
  change: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: '#FFFFFF', textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  provenance: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'center', marginTop: 8 },
  avgSub: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'center', marginTop: 4, fontVariant: ['tabular-nums'] },
  list: { gap: 12 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowMain: { flex: 1, gap: 4 },
  rowTitle: { fontWeight: '600', fontSize: 15, lineHeight: 21, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  logBtn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  logBtnText: { color: '#0B0F1A' },
  disclaimer: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center' },
});
