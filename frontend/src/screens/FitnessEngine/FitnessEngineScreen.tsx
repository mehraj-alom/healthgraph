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

import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, Chip, EmptyState, Input } from '@/components';
import { EngineGraph } from '@/components/EngineGraph';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { SPACE } from '@/theme/guava';
import { LG } from '@/theme/liquidGlass';
import { getCachedPatientId } from '@/services/patientIdentity';
import { todayKey } from '@/screens/Onboarding/momentum';
import {
  deleteStrengthSet,
  exerciseVolume,
  insertStrengthSet,
  listStrengthSets,
  normalizeStrengthInput,
  personalRecords,
  type StrengthSet,
} from '@/db/queries/strength';
import { TILE_TONES } from '@/theme/tones';
import { useFitnessEngine } from '@/hooks/useFitnessEngine';
import {
  formatActiveMinutes,
  formatDistanceKm,
  formatPace,
  paceMinPerKm,
  type FitnessSession,
} from '@/screens/FitnessEngine/fitnessEngine';

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

function formatDayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date.slice(5);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function sessionSub(session: FitnessSession): string {  const parts = [formatDayLabel(session.date)];
  if (session.durationMinutes != null) parts.push(formatActiveMinutes(session.durationMinutes));
  const distance = formatDistanceKm(session.distanceKm);
  if (distance !== null) parts.push(distance);
  const pace = formatPace(paceMinPerKm(session));
  if (pace !== null) parts.push(pace);
  return parts.join(' · ');
}

/**
 * StrengthSection — set logging with volume + estimated PRs.
 * One row per set (exercise, weight, reps); volume sums weight×reps
 * in kg per exercise for today; PRs are best Epley estimates labeled
 * as estimates. Device-only like the sessions above it.
 */
function StrengthSection({ today }: { today: string }) {
  const [sets, setSets] = useState<StrengthSet[]>([]);
  const [exercise, setExercise] = useState('');
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [unit, setUnit] = useState<'kg' | 'lb'>('kg');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const patientId = getCachedPatientId();
      if (!patientId) return;
      setSets(await listStrengthSets(patientId, 200));
    } catch {
      // List is convenience — the form still works.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = useCallback(async () => {
    if (saving) return;
    const patientId = getCachedPatientId();
    if (!patientId) {
      setFormError('Your session has expired. Please sign in again.');
      return;
    }
    let input;
    try {
      input = normalizeStrengthInput({
        exercise,
        weight_value: weight.trim() ? Number(weight) : null,
        weight_unit: unit,
        reps: reps.trim() ? Number(reps) : null,
        occurred_at: `${today}T12:00:00`,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Check the highlighted fields.');
      return;
    }
    setSaving(true);
    try {
      await insertStrengthSet(patientId, input);
      setExercise('');
      setWeight('');
      setReps('');
      setFormError(null);
      await load();
    } catch {
      setFormError('Could not save this set. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [saving, exercise, weight, reps, unit, today, load]);

  const handleDelete = useCallback(
    async (entryId: string) => {
      const patientId = getCachedPatientId();
      if (!patientId) return;
      await deleteStrengthSet(patientId, entryId).catch(() => false);
      await load();
    },
    [load],
  );

  const todaySets = sets.filter((s) => s.occurred_at.slice(0, 10) === today);
  const volume = exerciseVolume(todaySets);
  const prs = personalRecords(sets);
  const prExercises = Object.keys(prs).sort();

  return (
    <>
      <Text style={styles.sectionTitle}>Strength</Text>
      <GlassSurface strong style={styles.card}>
        <Input
          label="Exercise"
          value={exercise}
          onChangeText={setExercise}
          placeholder="e.g. Bench Press"
        />
        <View style={styles.setRow}>
          <View style={styles.setField}>
            <Input
              label="Weight"
              value={weight}
              onChangeText={setWeight}
              placeholder="e.g. 60"
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.setField}>
            <Input
              label="Reps"
              value={reps}
              onChangeText={setReps}
              placeholder="e.g. 8"
              keyboardType="number-pad"
            />
          </View>
          <View style={styles.setUnit}>
            <Chip label="kg" selected={unit === 'kg'} onPress={() => setUnit('kg')} size="medium" />
            <Chip label="lb" selected={unit === 'lb'} onPress={() => setUnit('lb')} size="medium" />
          </View>
        </View>
        {formError ? <Text style={styles.error}>{formError}</Text> : null}
        <Button
          title={saving ? 'Saving…' : 'Add set'}
          variant="secondary"
          onPress={() => void handleAdd()}
          disabled={saving}
          fullWidth
          style={styles.logBtn}
          textStyle={styles.logBtnText}
        />
        {Object.keys(volume).length > 0 ? (
          <Text style={styles.avgSub}>
            {`Today: ${Object.entries(volume).map(([name, v]) => `${name} ${Math.round(v)} kg`).join(' · ')}`}
          </Text>
        ) : null}
        {prExercises.length > 0 ? (
          <Text style={styles.avgSub}>
            {`Best: ${prExercises.map((name) => `${name} ${prs[name]} kg est. 1RM`).join(' · ')}`}
          </Text>
        ) : null}
        <Text style={styles.provenance}>Sets stay on this device only. Estimates, not measurements.</Text>
      </GlassSurface>
      {todaySets.length > 0 ? (
        <View style={styles.list}>
          {todaySets.map((s) => (
            <GlassSurface key={s.entry_id} strong style={styles.card}>
              <View style={styles.rowTop}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle}>{s.exercise}</Text>
                  <Text style={styles.rowSub}>{`${s.weight_value} ${s.weight_unit} × ${s.reps}`}</Text>
                </View>
                <Pressable
                  onPress={() => void handleDelete(s.entry_id)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${s.exercise} set`}
                  style={styles.rowBtn}
                >
                  <Text style={[styles.rowBtnText, styles.deleteText]}>Delete</Text>
                </Pressable>
              </View>
            </GlassSurface>
          ))}
        </View>
      ) : null}
    </>
  );
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
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Fitness</Text>
          <Text style={styles.sub}>Logged activity only.</Text>

          {isLoading ? (
            <View style={styles.center}>
              <Text style={styles.loading}>Loading…</Text>
            </View>
          ) : !hasContent ? (
            <EmptyState
              title="No activity logged yet"
              message="Log a walk, run, or any exercise to begin."
            />
          ) : (
            <>
              {stepDays.length > 0 ? (
                <>
                  <Text style={styles.sectionTitle}>Steps</Text>
                  <GlassSurface strong style={styles.card}>
                    {stepsToday != null ? (
                      <Text style={styles.bigValue}>{stepsToday.toLocaleString()}</Text>
                    ) : null}
                    <Text style={styles.avgSub}>
                      {stepsToday != null ? 'Steps today' : `${stepDays.length} ${stepDays.length === 1 ? 'day' : 'days'} counted`}
                    </Text>
                    <EngineGraph points={stepPoints} tone={TILE_TONES.fitness[1]} decimals={0} />
                    <Text style={styles.provenance}>From Health Connect · on this device only.</Text>
                  </GlassSurface>
                </>
              ) : null}
              {summary.sessions > 0 ? (
                <>
                  <Text style={styles.sectionTitle}>This week</Text>
                  <GlassSurface strong style={styles.card}>
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
                  </GlassSurface>

                  <Text style={styles.sectionTitle}>Sessions per day</Text>
                  <GlassSurface strong style={styles.card}>
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
                  </GlassSurface>

                  {minutesPoints.length > 0 ? (
                    <>
                      <Text style={styles.sectionTitle}>Active minutes</Text>
                      <GlassSurface strong style={styles.card}>
                        <EngineGraph points={minutesPoints} tone={TILE_TONES.fitness[1]} decimals={0} />
                        <Text style={styles.avgSub}>
                          {`${minutesPoints.length} ${minutesPoints.length === 1 ? 'day' : 'days'} with durations`}
                        </Text>
                      </GlassSurface>
                    </>
                  ) : null}

                  <Text style={styles.sectionTitle}>Recent sessions</Text>
                  <View style={styles.list}>
                    {[...sessions]
                      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
                      .slice(0, 14)
                      .map((session, i) => (
                        <GlassSurface key={`${session.date}-${session.type}-${i}`} strong style={styles.card}>
                          <View style={styles.rowTop}>
                            <View style={styles.rowMain}>
                              <Text style={styles.rowTitle}>{session.type}</Text>
                              <Text style={styles.rowSub}>{sessionSub(session)}</Text>
                            </View>
                          </View>
                        </GlassSurface>
                      ))}
                  </View>
                </>
              ) : null}
            </>
          )}

          <StrengthSection today={todayKey()} />

          <Button
            title="Log activity"
            variant="secondary"
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
  bigValue: { fontWeight: '600', fontSize: 40, lineHeight: 48, color: '#FFFFFF', textAlign: 'center', fontVariant: ['tabular-nums'] },
  minutesValue: { fontWeight: '600', fontSize: 28, lineHeight: 34, color: '#FFFFFF', textAlign: 'center', marginTop: 4, fontVariant: ['tabular-nums'] },
  avgSub: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'center', marginTop: 4, fontVariant: ['tabular-nums'] },
  change: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: '#FFFFFF', textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  provenance: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center', marginTop: 8 },
  strip: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  cell: { alignItems: 'center', gap: 6, minWidth: 32 },
  dot: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: TILE_TONES.fitness[1] },
  dotOff: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)' },
  dotCount: { fontSize: 10, fontWeight: '700', color: '#14201D' },
  cellDay: { fontWeight: '400', fontSize: 12, lineHeight: 16, color: SECONDARY, fontVariant: ['tabular-nums'] },
  weekTotal: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'center', marginTop: 8 },
  list: { gap: 12 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowMain: { flex: 1, gap: 4 },
  rowTitle: { fontWeight: '600', fontSize: 15, lineHeight: 20, color: '#FFFFFF' },
  rowSub: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, fontVariant: ['tabular-nums'] },
  rowBtn: { minWidth: 44, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  rowBtnText: { fontWeight: '600', fontSize: 13, lineHeight: 18, color: '#FFFFFF' },
  deleteText: { color: LG.card.danger },
  setRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-end' },
  setField: { flex: 1 },
  setUnit: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  error: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: LG.card.danger },
  logBtn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  logBtnText: { color: '#0B0F1A' },
  disclaimer: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center' },
});
