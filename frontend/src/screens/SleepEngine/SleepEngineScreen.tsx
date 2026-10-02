/**
 * SleepEngineScreen — the Sleep goal engine (Batch 6B).
 *
 * Active when 'sleep' is among the Batch 6A active-engine ids. Tracking,
 * NOT treatment: average duration, trailing-week strip, period comparison,
 * bedtime consistency from optionally logged clock times, one daily bedtime
 * reminder, and real night history — all from logged daily-check-in sleep
 * columns on this device. No stages, no wearables, no smart alarm.
 *
 * Empty state is honest ("no sleep logged yet") with a path to the DailyLog
 * check-in that creates the data. Copy is descriptive ("Track your sleep
 * patterns") — never improve/fix/prevent, never diagnosis.
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
import { Button, Card, EmptyState, SectionHeader } from '@/components';
import { EngineGraph } from '@/components/EngineGraph';
import { HealthFact } from '@/components/HealthFact';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { TILE_TONES } from '@/theme/tones';
import { useSleepEngine } from '@/hooks/useSleepEngine';
import { describeReminder, type SleepReminderState } from '@/services/sleepReminderPlan';
import { getSleepReminder, setSleepReminder } from '@/services/sleepReminders';
import {
  formatSleepDuration,
  type SleepNight,
} from '@/screens/SleepEngine/sleepEngine';

const QUALITY_LABELS: Record<number, string> = {
  1: 'Very poor',
  2: 'Poor',
  3: 'Fair',
  4: 'Good',
  5: 'Excellent',
};

function formatDayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date.slice(5);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function qualityCopy(quality: number | null): string | null {
  if (quality == null) return null;
  const label = QUALITY_LABELS[quality];
  return label ? `quality ${label.toLowerCase()}` : null;
}

function nightSub(night: SleepNight): string {
  const parts = [formatDayLabel(night.date)];
  const q = qualityCopy(night.quality);
  if (q) parts.push(q);
  if (night.awakenings != null && night.awakenings > 0) {
    parts.push(night.awakenings === 1 ? '1 wake-up' : `${night.awakenings} wake-ups`);
  }
  return parts.join(' · ');
}

/**
 * BedtimeReminderSection — one daily nudge at a fixed clock time.
 * Local state only; saving persists + (re)arms the OS schedule. A plain
 * reminder, never a smart alarm: no staging, no wake windows.
 */
function BedtimeReminderSection() {
  const [state, setState] = useState<SleepReminderState>({ enabled: false, hour: 22, minute: 30 });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void getSleepReminder().then((s) => {
      setState(s);
      setLoaded(true);
    });
  }, []);

  const adjust = useCallback((field: 'hour' | 'minute', delta: number) => {
    setMsg(null);
    setState((s) => {
      if (field === 'hour') return { ...s, hour: (s.hour + delta + 24) % 24 };
      const stepped = Math.round(s.minute / 5) * 5;
      return { ...s, minute: (((stepped + delta) % 60) + 60) % 60 };
    });
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setMsg(null);
    const ok = await setSleepReminder(state).catch(() => false);
    setMsg(
      !ok
        ? 'Could not arm the reminder (notifications unavailable here).'
        : state.enabled
          ? 'Bedtime reminder set. It fires daily at your time.'
          : 'Bedtime reminder off.',
    );
    setSaving(false);
  }, [state]);

  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <>
      <SectionHeader dark title="Bedtime reminder" titleStyle={styles.histTitle} />
      <Card style={styles.darkCard}>
        {!loaded ? (
          <Text style={styles.avgSub}>Loading…</Text>
        ) : (
          <>
            <View style={styles.timeRow}>
              <View style={styles.stepper}>
                <Pressable onPress={() => adjust('hour', -1)} hitSlop={12} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="Hour down">
                  <Text style={styles.stepText}>−</Text>
                </Pressable>
                <Text style={styles.timeValue}>{pad(state.hour)}</Text>
                <Pressable onPress={() => adjust('hour', 1)} hitSlop={12} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="Hour up">
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
              </View>
              <Text style={styles.timeColon}>:</Text>
              <View style={styles.stepper}>
                <Pressable onPress={() => adjust('minute', -5)} hitSlop={12} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="Minute down">
                  <Text style={styles.stepText}>−</Text>
                </Pressable>
                <Text style={styles.timeValue}>{pad(state.minute)}</Text>
                <Pressable onPress={() => adjust('minute', 5)} hitSlop={12} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="Minute up">
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
              </View>
              <Pressable
                onPress={() => {
                  setMsg(null);
                  setState((s) => ({ ...s, enabled: !s.enabled }));
                }}
                accessibilityRole="switch"
                accessibilityState={{ checked: state.enabled }}
                accessibilityLabel="Bedtime reminder on or off"
                style={[styles.toggle, state.enabled && styles.toggleOn]}
              >
                <Text style={[styles.toggleText, state.enabled && styles.toggleTextOn]}>
                  {state.enabled ? 'On' : 'Off'}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.avgSub}>{describeReminder(state)}</Text>
            <Button
              title={saving ? 'Saving…' : 'Save reminder'}
              onPress={() => void save()}
              disabled={saving}
              fullWidth
              style={styles.remindBtn}
              textStyle={styles.remindBtnText}
            />
            {msg ? <Text style={styles.avgSub}>{msg}</Text> : null}
          </>
        )}
      </Card>
    </>
  );
}

export default function SleepEngineScreen() {
  const navigation = useNavigation();
  const { nights, summary, week, changeLine, consistencyLine, isLoading } = useSleepEngine();

  const goLog = useCallback(() => {
    const nav = navigation as unknown as {
      navigate: (route: string) => void;
    };
    nav.navigate('DailyLog');
  }, [navigation]);

  const loggedWeek = week.filter((d) => d.logged).length;
  const graphPoints = [...nights]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((n) => ({ date: n.date, value: Math.round((n.durationMinutes / 60) * 10) / 10 }));

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Sleep.</Text>
        <Text style={styles.sub}>Logged nights only.</Text>

        {isLoading ? (
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : summary.loggedNights === 0 ? (
          <EmptyState
            title="No sleep logged yet"
            message="Log last night's sleep to begin."
          />
        ) : (
          <>
            <SectionHeader dark title="Average" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
              <Text style={styles.avgValue}>
                {summary.avgMinutes != null ? formatSleepDuration(summary.avgMinutes) : '—'}
              </Text>
              <Text style={styles.avgSub}>
                {`Across ${summary.loggedNights} ${summary.loggedNights === 1 ? 'night' : 'nights'} (last 28 days)`}
              </Text>
              {changeLine ? <Text style={styles.change}>{changeLine}</Text> : null}
            </Card>

            {consistencyLine ? (
              <>
                <SectionHeader dark title="Bedtime consistency" titleStyle={styles.histTitle} />
                <Card style={styles.darkCard}>
                  <Text style={styles.change}>{consistencyLine}</Text>
                  <Text style={styles.provenance}>From nights with a logged bedtime (last 7 days).</Text>
                </Card>
              </>
            ) : null}

            <BedtimeReminderSection />

            <SectionHeader dark title="This week" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
              <View style={styles.strip}>
                {week.map((d) => (
                  <View key={d.date} style={styles.cell}>
                    <View
                      style={[styles.bar, d.logged ? styles.barOn : styles.barOff]}
                      accessibilityLabel={`${d.date} ${d.logged ? `slept ${formatSleepDuration(d.durationMinutes ?? 0)}` : 'no entry'}`}
                    />
                    <Text style={styles.cellDay}>{d.date.slice(8)}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.weekTotal}>
                {loggedWeek === 0
                  ? 'Nothing recorded this week.'
                  : `${loggedWeek} ${loggedWeek === 1 ? 'night' : 'nights'} logged this week.`}
              </Text>
            </Card>

            <SectionHeader dark title="Sleep graph" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
              <EngineGraph points={graphPoints} tone={TILE_TONES.sleep[1]} decimals={1} />
              <Text style={styles.avgSub}>
                {`${graphPoints.length} ${graphPoints.length === 1 ? 'night' : 'nights'}`}
              </Text>
            </Card>

            <SectionHeader dark title="Recent nights" titleStyle={styles.histTitle} />
            <View style={styles.list}>
              {[...nights]
                .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
                .slice(0, 14)
                .map((night) => (
                  <Card key={night.date} style={styles.darkCard}>
                    <View style={styles.rowTop}>
                      <View style={styles.rowMain}>
                        <Text style={styles.rowTitle}>
                          {formatSleepDuration(night.durationMinutes)}
                        </Text>
                        <Text style={styles.rowSub}>{nightSub(night)}</Text>
                      </View>
                    </View>
                  </Card>
                ))}
            </View>
          </>
        )}

        <Button
          title="Log sleep"
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
  avgValue: { ...TYPE.display, fontSize: 40, color: '#FFFFFF', textAlign: 'center', fontVariant: ['tabular-nums'] },
  avgSub: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 4, fontVariant: ['tabular-nums'] },
  change: { ...TYPE.body, color: '#E8ECF1', textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  provenance: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  stepper: { alignItems: 'center', gap: 4 },
  stepBtn: { minWidth: 56, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 26, color: '#FFFFFF', fontFamily: FONT.semi },
  timeValue: { fontSize: 44, lineHeight: 50, color: '#FFFFFF', fontFamily: FONT.semi, fontVariant: ['tabular-nums'] },
  timeColon: { fontSize: 40, color: GV.fog, fontFamily: FONT.semi },
  toggle: {
    borderRadius: 9999,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    minWidth: 84,
    alignItems: 'center',
  },
  toggleOn: { backgroundColor: '#4FD1C5', borderColor: '#4FD1C5' },
  toggleText: { ...TYPE.chip, color: GV.fog },
  toggleTextOn: { color: '#062A26' },
  remindBtn: { backgroundColor: '#4FD1C5', marginTop: 8 },
  remindBtnText: { color: '#062A26' },
  strip: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  cell: { alignItems: 'center', gap: 6, minWidth: 32 },
  bar: { width: 16, height: 44, borderRadius: 8, justifyContent: 'flex-end' },
  barOn: { backgroundColor: TILE_TONES.sleep[1] },
  barOff: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)' },
  cellDay: { ...TYPE.caption, fontSize: 12, color: GV.fog, fontVariant: ['tabular-nums'] },
  weekTotal: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  list: { gap: SPACE.cardGap },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowMain: { flex: 1, gap: 4 },
  rowTitle: { ...TYPE.button, fontSize: 17, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  rowSub: { ...TYPE.caption, color: GV.fog, fontVariant: ['tabular-nums'] },
  logBtn: { backgroundColor: '#4FD1C5' },
  logBtnText: { color: '#062A26' },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
});
