/**
 * NutritionEngineScreen — the Nutrition goal engine (Batch 6F + targets).
 *
 * Reports logged meals only: meal counts, food-scan estimated calories
 * (labeled as estimates, never measured), meal-type distribution over
 * logged meals, and real day history. Scan-derived macro sums light up
 * the rings against targets the user sets for themselves (device-only,
 * editable, starting-point suggestions). No adequacy judgments, no diet
 * ratings, no predictions. Empty state is honest when nothing is logged,
 * with paths to the DailyLog check-in and FoodScan flows that create the
 * data. Copy is descriptive — never healthy or unhealthy, never causal.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Svg, { Circle } from 'react-native-svg';
import { Button, Card, EmptyState, SectionHeader } from '@/components';
import { getFasting, startFast, endFast } from '@/services/fastingStore';
import {
  FASTING_WINDOWS,
  fastStatus,
  fmtFastDuration,
  type FastState,
} from '@/services/fasting';
import { EngineGraph } from '@/components/EngineGraph';
import { HealthFact } from '@/components/HealthFact';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { TILE_TONES } from '@/theme/tones';
import { useNutritionEngine } from '@/hooks/useNutritionEngine';
import {
  formatKcal,
  type NutritionDay,
} from '@/screens/NutritionEngine/nutritionEngine';
import {
  nutrientProgress,
  suggestTargets,
  weekOnTarget,
  type ActivityBand,
  type IntakeGoal,
  type MacroTargets,
} from '@/screens/NutritionEngine/macroTargets';
import { getCachedPatientId } from '@/services/patientIdentity';
import { saveMacroTargets } from '@/services/macroTargetStore';

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

function CalorieRing({ progress }: { progress: { actual: number; target: number; ratio: number; remaining: number } | null }) {
  const size = 148;
  const stroke = 13;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = progress ? Math.max(0, Math.min(1, progress.ratio)) : 0;
  return (
    <View style={{ alignItems: 'center', marginVertical: 8 }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#4FD1C5"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c.toFixed(1)}`}
          strokeDashoffset={(c * (1 - frac)).toFixed(1)}
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={{ position: 'absolute', top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: '#FFFFFF', fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
          {progress ? Math.round(progress.actual).toLocaleString('en-US') : '—'}
        </Text>
        <Text style={{ color: '#8EA0B8', fontSize: 12 }}>
          {progress ? `of ${Math.round(progress.target).toLocaleString('en-US')} kcal` : 'no target'}
        </Text>
        {progress && progress.remaining > 0 ? (
          <Text style={{ color: '#8EA0B8', fontSize: 12 }}>{`${Math.round(progress.remaining).toLocaleString('en-US')} left`}</Text>
        ) : null}
      </View>
    </View>
  );
}

function MacroBar({
  label,
  color,
  progress,
  unit,
}: {
  label: string;
  color: string;
  progress: { actual: number; target: number; ratio: number; remaining: number } | null;
  unit: string;
}) {
  const frac = progress ? Math.max(0, Math.min(1, progress.ratio)) : 0;
  return (
    <View style={{ marginTop: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: '#8EA0B8', fontSize: 12, fontVariant: ['tabular-nums'] }}>
          {progress ? `${Math.round(progress.actual)}${unit} of ${Math.round(progress.target)}${unit}` : '—'}
        </Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.12)' }}>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: color, width: `${Math.round(frac * 100)}%` }} />
      </View>
    </View>
  );
}

/**
 * FastingCard — on-device fasting timer. One tap starts a preset window;
 * elapsed derives from the stored start time (kill-safe, no background
 * timer). Ending at or past target completes, earlier ends early. Timer
 * only — no stage guidance, no health claims.
 */
function FastingCard() {
  const [state, setState] = useState<FastState | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getFasting().then((s) => {
      if (live) setState(s);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (state?.active === null) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state?.active !== null]);

  const start = useCallback(async (windowId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setState(await startFast(windowId));
      setNowMs(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start this fast.');
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const end = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { state: next } = await endFast();
      setState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not end this fast.');
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const status = fastStatus(state?.active ?? null, nowMs);
  const last = state && state.history.length > 0 ? state.history[state.history.length - 1] : null;
  const lastMs = last ? new Date(last.endedAt).getTime() - new Date(last.startedAt).getTime() : 0;

  return (
    <>
      <SectionHeader dark title="Fasting" titleStyle={styles.histTitle} />
      <Card style={styles.darkCard}>
        {state === null ? (
          <Text style={styles.avgSub}>Loading…</Text>
        ) : status.phase === 'idle' ? (
          <>
            <Text style={styles.avgSub}>Pick a window to start fasting.</Text>
            <View style={styles.presetRow}>
              {FASTING_WINDOWS.map((w) => (
                <Pressable
                  key={w.id}
                  onPress={() => void start(w.id)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Start ${w.id} fast`}
                  style={({ pressed }) => [styles.presetBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.presetText}>{w.id}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <>
            <Text style={styles.bigValue}>
              {fmtFastDuration(status.elapsedMs)} / {status.targetMs !== null ? fmtFastDuration(status.targetMs) : '—'}
            </Text>
            <Text style={styles.avgSub}>
              {status.phase === 'done' ? 'Target reached — end your fast below.' : 'Fasting'}
            </Text>
            <Button
              title={busy ? 'Saving…' : 'End fast'}
              onPress={() => void end()}
              disabled={busy}
              fullWidth
            />
          </>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {last ? (
          <Text style={styles.avgSub}>
            {`Last: ${last.windowId} · ${last.completed ? 'completed' : 'ended early'} in ${fmtFastDuration(lastMs)}`}
          </Text>
        ) : null}
        <Text style={styles.provenance}>Timer only. Stays on this device.</Text>
      </Card>
    </>
  );
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
    todayMacros,
    weekMacros,
    storedTargets,
    profileMeasures,
    reloadTargets,
  } = useNutritionEngine();

  const targets: MacroTargets = useMemo(() => ({
    calories: storedTargets?.targets.calories ?? null,
    protein: storedTargets?.targets.protein ?? null,
    carbs: storedTargets?.targets.carbs ?? null,
    fat: storedTargets?.targets.fat ?? null,
  }), [storedTargets]);
  const hasTargets = targets.calories != null;

  const calProgress = useMemo(
    () => nutrientProgress(todayMacros?.kcal ?? null, targets.calories),
    [todayMacros, targets.calories],
  );
  const proteinProgress = useMemo(
    () => nutrientProgress(todayMacros?.protein ?? null, targets.protein),
    [todayMacros, targets.protein],
  );
  const carbsProgress = useMemo(
    () => nutrientProgress(todayMacros?.carbs ?? null, targets.carbs),
    [todayMacros, targets.carbs],
  );
  const fatProgress = useMemo(
    () => nutrientProgress(todayMacros?.fat ?? null, targets.fat),
    [todayMacros, targets.fat],
  );
  const weekLine = useMemo(() => {
    const r = weekOnTarget(
      weekMacros.map((d) => ({ date: d.log_date, kcal: d.kcal })),
      targets.calories,
    );
    if (!r) return null;
    return `${r.onTarget} of ${r.withData} days on target`;
  }, [weekMacros, targets.calories]);

  // ---- Targets editor state ----
  const [editorOpen, setEditorOpen] = useState(false);
  const [savingTargets, setSavingTargets] = useState(false);
  const [editGoal, setEditGoal] = useState<IntakeGoal>('maintain');
  const [editActivity, setEditActivity] = useState<ActivityBand>('moderate');
  const [editAge, setEditAge] = useState('');
  const [editSex, setEditSex] = useState<'female' | 'male' | null>(null);
  const [editCalories, setEditCalories] = useState('');
  const [editProtein, setEditProtein] = useState('');
  const [editCarbs, setEditCarbs] = useState('');
  const [editFat, setEditFat] = useState('');

  const openEditor = useCallback(() => {
    setEditGoal(storedTargets?.goal ?? 'maintain');
    setEditActivity(storedTargets?.activity ?? 'moderate');
    setEditAge(storedTargets?.ageYears != null ? String(storedTargets.ageYears) : '');
    setEditSex(storedTargets?.sex ?? null);
    setEditCalories(targets.calories != null ? String(targets.calories) : '');
    setEditProtein(targets.protein != null ? String(targets.protein) : '');
    setEditCarbs(targets.carbs != null ? String(targets.carbs) : '');
    setEditFat(targets.fat != null ? String(targets.fat) : '');
    setEditorOpen(true);
  }, [storedTargets, targets]);

  const suggestFromProfile = useCallback(() => {
    const age = editAge.trim() ? parseInt(editAge, 10) : null;
    const s = suggestTargets({
      weightKg: profileMeasures.weightKg,
      heightCm: profileMeasures.heightCm,
      ageYears: age != null && Number.isFinite(age) && age > 0 ? age : null,
      sex: editSex,
      goal: editGoal,
      activity: editActivity,
    });
    if (s.calories != null) setEditCalories(String(s.calories));
    if (s.protein != null) setEditProtein(String(s.protein));
    if (s.carbs != null) setEditCarbs(String(s.carbs));
    if (s.fat != null) setEditFat(String(s.fat));
  }, [profileMeasures, editAge, editSex, editGoal, editActivity]);

  const saveTargets = useCallback(async () => {
    const patientId = getCachedPatientId();
    if (!patientId) return;
    const num = (v: string): number | null => {
      const n = parseFloat(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const age = editAge.trim() ? parseInt(editAge, 10) : null;
    setSavingTargets(true);
    try {
      await saveMacroTargets(patientId, {
        targets: {
          calories: num(editCalories),
          protein: num(editProtein),
          carbs: num(editCarbs),
          fat: num(editFat),
        },
        goal: editGoal,
        activity: editActivity,
        ageYears: age != null && Number.isFinite(age) && age > 0 ? age : null,
        sex: editSex,
        savedAt: Date.now(),
      });
      await reloadTargets();
      setEditorOpen(false);
    } finally {
      setSavingTargets(false);
    }
  }, [editCalories, editProtein, editCarbs, editFat, editGoal, editActivity, editAge, editSex, reloadTargets]);

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

            <SectionHeader dark title="Today" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
              {!hasTargets ? (
                <>
                  <Text style={styles.bigValue}>—</Text>
                  <Text style={styles.avgSub}>Set your targets to light up today&apos;s rings.</Text>
                  <Button title="Set targets" onPress={openEditor} fullWidth textStyle={styles.ringBtnText} />
                </>
              ) : !todayMacros ? (
                <>
                  <Text style={styles.bigValue}>—</Text>
                  <Text style={styles.avgSub}>No scans today yet — rings fill from food scans.</Text>
                  <Button title="Set targets" variant="ghost" onPress={openEditor} fullWidth textStyle={styles.scanText} />
                </>
              ) : (
                <>
                  <CalorieRing progress={calProgress} />
                  <MacroBar label="Protein" color="#7E9BF5" progress={proteinProgress} unit="g" />
                  <MacroBar label="Carbs" color="#6BAFD4" progress={carbsProgress} unit="g" />
                  <MacroBar label="Fat" color="#C9A24B" progress={fatProgress} unit="g" />
                  {weekLine ? <Text style={styles.change}>{weekLine}</Text> : null}
                  <Text style={styles.provenance}>From today&apos;s scans. Your targets, your call.</Text>
                  <Button title="Edit targets" variant="ghost" onPress={openEditor} fullWidth textStyle={styles.scanText} />
                </>
              )}
            </Card>

            <FastingCard />

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

        <Modal visible={editorOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditorOpen(false)}>
          <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              <Text style={styles.title}>Your targets.</Text>
              <Text style={styles.sub}>Starting points only — adjust to what works for you.</Text>

              <Text style={styles.editLabel}>Goal</Text>
              <View style={styles.chipRow}>
                {(['lose', 'maintain', 'gain'] as const).map((g) => (
                  <Pressable
                    key={g}
                    onPress={() => setEditGoal(g)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: editGoal === g }}
                    style={[styles.chip, editGoal === g && styles.chipOn]}
                  >
                    <Text style={[styles.chipTxt, editGoal === g && styles.chipTxtOn]}>
                      {g === 'lose' ? 'Eat less' : g === 'gain' ? 'Eat more' : 'Stay steady'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.editLabel}>Activity</Text>
              <View style={styles.chipRow}>
                {(['light', 'moderate', 'active', 'very-active'] as const).map((a) => (
                  <Pressable
                    key={a}
                    onPress={() => setEditActivity(a)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: editActivity === a }}
                    style={[styles.chip, editActivity === a && styles.chipOn]}
                  >
                    <Text style={[styles.chipTxt, editActivity === a && styles.chipTxtOn]}>{a}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.editRow}>
                <View style={styles.editHalf}>
                  <Text style={styles.editLabel}>Age (optional)</Text>
                  <TextInput
                    value={editAge}
                    onChangeText={setEditAge}
                    placeholder="—"
                    placeholderTextColor="#5A6B85"
                    keyboardType="numeric"
                    style={styles.editInput}
                  />
                </View>
                <View style={styles.editHalf}>
                  <Text style={styles.editLabel}>Sex (optional)</Text>
                  <View style={styles.chipRow}>
                    {(['female', 'male'] as const).map((s) => (
                      <Pressable
                        key={s}
                        onPress={() => setEditSex(editSex === s ? null : s)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: editSex === s }}
                        style={[styles.chip, editSex === s && styles.chipOn]}
                      >
                        <Text style={[styles.chipTxt, editSex === s && styles.chipTxtOn]}>
                          {s === 'female' ? 'F' : 'M'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>

              <Pressable
                onPress={suggestFromProfile}
                accessibilityRole="button"
                accessibilityLabel="Suggest targets from profile"
                style={({ pressed }) => [styles.suggestBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.suggestTxt}>
                  {profileMeasures.weightKg != null
                    ? `Suggest from profile (${profileMeasures.weightKg} kg)`
                    : 'Add weight in your profile to unlock suggestions'}
                </Text>
              </Pressable>

              <Text style={styles.editLabel}>Calories / day</Text>
              <TextInput
                value={editCalories}
                onChangeText={setEditCalories}
                placeholder="e.g., 2200"
                placeholderTextColor="#5A6B85"
                keyboardType="numeric"
                style={styles.editInput}
              />
              <Text style={styles.editLabel}>Protein g / day</Text>
              <TextInput
                value={editProtein}
                onChangeText={setEditProtein}
                placeholder="e.g., 140"
                placeholderTextColor="#5A6B85"
                keyboardType="numeric"
                style={styles.editInput}
              />
              <Text style={styles.editLabel}>Carbs g / day</Text>
              <TextInput
                value={editCarbs}
                onChangeText={setEditCarbs}
                placeholder="e.g., 250"
                placeholderTextColor="#5A6B85"
                keyboardType="numeric"
                style={styles.editInput}
              />
              <Text style={styles.editLabel}>Fat g / day</Text>
              <TextInput
                value={editFat}
                onChangeText={setEditFat}
                placeholder="e.g., 70"
                placeholderTextColor="#5A6B85"
                keyboardType="numeric"
                style={styles.editInput}
              />

              <Button
                title={savingTargets ? 'Saving…' : 'Save targets'}
                onPress={() => void saveTargets()}
                disabled={savingTargets}
                fullWidth
                style={styles.logBtn}
                textStyle={styles.logBtnText}
              />
              <Button title="Cancel" variant="ghost" onPress={() => setEditorOpen(false)} fullWidth textStyle={styles.scanText} />
            </ScrollView>
          </SafeAreaView>
        </Modal>
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
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  presetBtn: {
    borderRadius: 9999,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 16,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetText: { ...TYPE.chip, color: '#FFFFFF' },
  error: { ...TYPE.caption, color: GV.danger },
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
  ringBtnText: { color: '#062A26' },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
  editLabel: { ...TYPE.caption, color: GV.fog, marginTop: 14, marginBottom: 6 },
  editInput: {
    backgroundColor: '#10141F',
    borderColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderRadius: 10,
    color: '#FFFFFF',
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontVariant: ['tabular-nums'],
  },
  editRow: { flexDirection: 'row', gap: 12 },
  editHalf: { flex: 1 },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipOn: { backgroundColor: '#4FD1C5', borderColor: '#4FD1C5' },
  chipTxt: { color: '#A7B8B2', fontSize: 13, fontWeight: '600' },
  chipTxtOn: { color: '#062A26' },
  suggestBtn: {
    borderWidth: 1,
    borderColor: '#2A4A73',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 14,
  },
  suggestTxt: { color: '#8EA0B8', fontSize: 13, fontWeight: '600' },
});
