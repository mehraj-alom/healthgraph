/**
 * FitnessEngineScreen — the Fitness goal engine (Batch 6E).
 *
 * Reports logged activity only: sessions this week, active minutes from
 * recorded durations, period change lines, and real session history.
 * Duration-less sessions count as sessions but contribute no minutes;
 * user-logged calories appear only as labeled logged sums. Step counts
 * from the device-only Health Connect import render in their own card
 * and never enter the session/minute math. No composite metrics, no
 * targets, no predictions. Empty state is honest when no activity is
 * logged, with a path to the DailyLog check-in that creates the data.
 * Copy is descriptive — never fitter/healthier, never causal.
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
  const { sessions, summary, week, sessionsLine, minutesLine, stepDays, stepsToday, isLoading } = useFitnessEngine();

  const goLog = useCallback(() => {
    const nav = navigation as unknown as {
      navigate: (route: string) => void;
    };
    nav.navigate('DailyLog');
  }, [navigation]);

  const weekSessions = week.reduce((s, d) => s + d.sessions, 0);
  // Active minutes per day — only days with a recorded duration plot.
  const minutesByDay = new Map<string, number>();
  for (const s of sessions) {
    if (s.durationMinutes == null) continue;
    minutesByDay.set(s.date, (minutesByDay.get(s.date) ?? 0) + s.durationMinutes);
  }
  const minutesPoints = [...minutesByDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, value]) => ({ date, value }));
  const hasContent = summary.sessions > 0 || stepDays.length > 0;
  const stepPoints = stepDays.map((d) => ({ date: d.log_date, value: d.steps }));

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Fitness.</Text>
        <Text style={styles.sub}>Logged activity only.</Text>

        {isLoading ? (
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : !hasContent ? (
          <EmptyState
            title="No activity logged yet"
            message="Log a walk, run, or any exercise to begin."
          />
        ) : (
          <>
            {stepDays.length > 0 ? (
              <>
                <SectionHeader dark title="Steps" titleStyle={styles.histTitle} />
                <Card style={styles.darkCard}>
                  {stepsToday != null ? (
                    <Text style={styles.bigValue}>{stepsToday.toLocaleString()}</Text>
                  ) : null}
                  <Text style={styles.avgSub}>
                    {stepsToday != null ? 'Steps today' : `${stepDays.length} ${stepDays.length === 1 ? 'day' : 'days'} counted`}
                  </Text>
                  <EngineGraph points={stepPoints} tone={TILE_TONES.fitness[1]} decimals={0} />
                  <Text style={styles.provenance}>From Health Connect · on this device only.</Text>
                </Card>
              </>
            ) : null}
            {summary.sessions > 0 ? (
              <>
            <SectionHeader dark title="This week" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
              <Text style={styles.bigValue}>
                {`${summary.sessions} ${summary.sessions === 1 ? 'session' : 'sessions'}`}
              </Text>
              {summary.activeMinutes != null ? (
                <Text style={styles.minutesValue}>{formatActiveMinutes(summary.activeMinutes)}</Text>
              ) : null}
              <Text style={styles.avgSub}>
                {summary.activeMinutes != null
                  ? `Active minutes · ${summary.activeDays} ${summary.activeDays === 1 ? 'day' : 'days'}`
                  : `${summary.activeDays} ${summary.activeDays === 1 ? 'day' : 'days'} · no durations recorded`}
              </Text>
              {sessionsLine ? <Text style={styles.change}>{sessionsLine}</Text> : null}
              {minutesLine ? <Text style={styles.change}>{minutesLine}</Text> : null}
              {summary.caloriesLogged != null ? (
                <Text style={styles.provenance}>
                  {`${summary.caloriesLogged} calories logged alongside activity.`}
                </Text>
              ) : null}
            </Card>

            <SectionHeader dark title="Sessions per day" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
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

            {minutesPoints.length > 0 ? (
              <>
                <SectionHeader dark title="Active minutes" titleStyle={styles.histTitle} />
                <Card style={styles.darkCard}>
                  <EngineGraph points={minutesPoints} tone={TILE_TONES.fitness[1]} decimals={0} />
                  <Text style={styles.avgSub}>
                    {`${minutesPoints.length} ${minutesPoints.length === 1 ? 'day' : 'days'} with durations`}
                  </Text>
                </Card>
              </>
            ) : null}

            <SectionHeader dark title="Recent sessions" titleStyle={styles.histTitle} />
            <View style={styles.list}>
              {[...sessions]
                .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
                .slice(0, 14)
                .map((session, i) => (
                  <Card key={`${session.date}-${session.type}-${i}`} style={styles.darkCard}>
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
            ) : null}
          </>
        )}

        <Button
          title="Log activity"
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
  minutesValue: { ...TYPE.display, fontSize: 28, color: '#FFFFFF', textAlign: 'center', marginTop: 4, fontVariant: ['tabular-nums'] },
  avgSub: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 4, fontVariant: ['tabular-nums'] },
  change: { ...TYPE.body, color: '#E8ECF1', textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  provenance: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  strip: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  cell: { alignItems: 'center', gap: 6, minWidth: 32 },
  dot: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: TILE_TONES.fitness[1] },
  dotOff: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)' },
  dotCount: { fontSize: 10, fontWeight: '700', color: '#14201D' },
  cellDay: { ...TYPE.caption, fontSize: 12, color: GV.fog, fontVariant: ['tabular-nums'] },
  weekTotal: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  list: { gap: SPACE.cardGap },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowMain: { flex: 1, gap: 4 },
  rowTitle: { ...TYPE.button, fontSize: 15, color: '#FFFFFF' },
  rowSub: { ...TYPE.caption, color: GV.fog, fontVariant: ['tabular-nums'] },
  logBtn: { backgroundColor: '#4FD1C5' },
  logBtnText: { color: '#062A26' },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
});
