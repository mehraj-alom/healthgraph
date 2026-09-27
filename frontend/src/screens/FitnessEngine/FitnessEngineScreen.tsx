/**
 * FitnessEngineScreen — the Fitness goal engine (Batch 6E).
 *
 * Reports logged activity only: sessions this week, active minutes from
 * recorded durations, period change lines, and real session history.
 * Duration-less sessions count as sessions but contribute no minutes;
 * user-logged calories appear only as labeled logged sums. No step
 * source, no composite metrics, no targets, no predictions. Empty state is honest
 * when no activity is logged, with a path to the DailyLog check-in that
 * creates the data. Copy is descriptive — never fitter/healthier,
 * never causal.
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
import { useFitnessEngine } from '@/hooks/useFitnessEngine';
import {
  formatActiveMinutes,
  type FitnessSession,
} from '@/screens/FitnessEngine/fitnessEngine';

function formatDayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date.slice(5);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function sessionSub(session: FitnessSession): string {
  const parts = [formatDayLabel(session.date)];
  if (session.durationMinutes != null) parts.push(formatActiveMinutes(session.durationMinutes));
  return parts.join(' · ');
}

export default function FitnessEngineScreen() {
  const navigation = useNavigation();
  const { sessions, summary, week, sessionsLine, minutesLine, isLoading } = useFitnessEngine();

  const goLog = useCallback(() => {
    const nav = navigation as unknown as {
      navigate: (route: string) => void;
    };
    nav.navigate('DailyLog');
  }, [navigation]);

  const weekSessions = week.reduce((s, d) => s + d.sessions, 0);

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
        <Text style={styles.overline}>Fitness engine · From your logged activity</Text>
        <Text style={styles.title}>Fitness</Text>
        <Text style={styles.sub}>
          See your logged activity and exercise minutes.
        </Text>

        {isLoading ? (
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : summary.sessions === 0 ? (
          <EmptyState
            icon="👟"
            title="No activity logged yet"
            message="Activity tracking starts with your daily check-in. Log a walk, run, or any exercise and sessions, minutes and changes appear here. Only from real entries."
          />
        ) : (
          <>
            <SectionHeader title="This week" />
            <Card>
              <Text style={styles.bigValue}>
                {`${summary.sessions} ${summary.sessions === 1 ? 'session' : 'sessions'}`}
              </Text>
              {summary.activeMinutes != null ? (
                <Text style={styles.minutesValue}>{formatActiveMinutes(summary.activeMinutes)}</Text>
              ) : null}
              <Text style={styles.avgSub}>
                {summary.activeMinutes != null
                  ? `Active minutes from recorded durations · ${summary.activeDays} ${summary.activeDays === 1 ? 'active day' : 'active days'}`
                  : `${summary.activeDays} ${summary.activeDays === 1 ? 'active day' : 'active days'} · no durations recorded`}
              </Text>
              {sessionsLine ? <Text style={styles.change}>{sessionsLine}</Text> : null}
              {minutesLine ? <Text style={styles.change}>{minutesLine}</Text> : null}
              {summary.caloriesLogged != null ? (
                <Text style={styles.provenance}>
                  {`${summary.caloriesLogged} calories logged alongside activity (as entered, not measured).`}
                </Text>
              ) : null}
            </Card>

            <SectionHeader title="Sessions per day" />
            <Card>
              <View style={styles.strip}>
                {week.map((d) => (
                  <View key={d.date} style={styles.cell}>
                    <View style={[styles.dot, d.sessions > 0 ? styles.dotOn : styles.dotOff]}>
                      {d.sessions > 1 ? <Text style={styles.dotCount}>{d.sessions}</Text> : null}
                    </View>
                    <Text style={styles.cellDay}>{d.date.slice(8)}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.weekTotal}>
                {weekSessions === 0
                  ? 'Nothing recorded this week.'
                  : `${weekSessions} ${weekSessions === 1 ? 'session' : 'sessions'} this week.`}
              </Text>
            </Card>

            <SectionHeader title="Recent sessions" />
            <View style={styles.list}>
              {[...sessions]
                .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
                .slice(0, 14)
                .map((session, i) => (
                  <Card key={`${session.date}-${session.type}-${i}`}>
                    <View style={styles.rowTop}>
                      <View style={styles.rowMain}>
                        <Text style={styles.rowTitle}>{session.type}</Text>
                        <Text style={styles.rowSub}>{sessionSub(session)}</Text>
                      </View>
                    </View>
                  </Card>
                ))}
            </View>
          </>
        )}

        <Button title="+ Log activity" onPress={goLog} fullWidth />
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
  minutesValue: { ...TYPE.display, fontSize: 28, color: GV.ink, textAlign: 'center', marginTop: 4, fontVariant: ['tabular-nums'] },
  avgSub: { ...TYPE.caption, color: GV.muted, textAlign: 'center', marginTop: 4 },
  change: { ...TYPE.body, color: GV.body, textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  provenance: { ...TYPE.caption, color: GV.muted, textAlign: 'center', marginTop: 8 },
  strip: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  cell: { alignItems: 'center', gap: 6, minWidth: 32 },
  dot: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: TILE_TONES.fitness[1] },
  dotOff: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)' },
  dotCount: { fontSize: 10, fontWeight: '700', color: GV.ink },
  cellDay: { ...TYPE.caption, fontSize: 12, color: GV.fog, fontVariant: ['tabular-nums'] },
  weekTotal: { ...TYPE.caption, color: GV.muted, textAlign: 'center', marginTop: 8 },
  list: { gap: SPACE.cardGap },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowMain: { flex: 1, gap: 4 },
  rowTitle: { ...TYPE.button, fontSize: 15, color: GV.ink },
  rowSub: { ...TYPE.caption, color: GV.body, fontVariant: ['tabular-nums'] },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
});
