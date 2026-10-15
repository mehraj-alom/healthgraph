/**
 * MeditationScreen — bell-timed meditation sits (device-only).
 *
 * Tracking, NOT treatment: time a sit with a start/end bell, save the
 * finished sit (preset minutes, actual seconds, optional note), and review
 * real history with descriptive totals. No guided content, no claims about
 * stress/mood outcomes, no diagnoses anywhere on this screen. All rows are
 * patient-scoped SQLite; nothing syncs (the UI says so).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { Button, Card, Chip, EmptyState, Input, SectionHeader } from '@/components';
import { HealthFact } from '@/components/HealthFact';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { TILE_TONES } from '@/theme/tones';
import { RINGTONE_ASSET } from '@/services/medicationCall/ringtone';
import { getCachedPatientId } from '@/services/patientIdentity';
import {
  MEDITATION_PRESETS,
  deleteMeditationSession,
  insertMeditationSession,
  listMeditationSessions,
  normalizeMeditationInput,
  summarizeMeditation,
  summarizeMeditationWeek,
  type MeditationPreset,
  type MeditationSession,
} from '@/db/queries/meditation';
import { todayKey } from '@/screens/Onboarding/momentum';
import {
  DEFAULT_MEDITATION_REMINDER_TIME,
  describeMeditationReminder,
  type MeditationReminderState,
} from '@/services/meditationReminderPlan';
import {
  getMeditationReminder,
  setMeditationReminder,
} from '@/services/meditationReminders';

const TONE = TILE_TONES.meditation[1];

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatMinutes(durationSec: number): string {
  const minutes = Math.floor(durationSec / 60);
  const secs = durationSec % 60;
  if (minutes === 0) return `${secs}s`;
  if (secs === 0) return `${minutes} min`;
  return `${minutes}m ${secs}s`;
}

type TimerPhase = 'idle' | 'running' | 'paused';

export default function MeditationScreen() {
  const [entries, setEntries] = useState<MeditationSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Timer state. The deadline lives in a ref so ticks stay correct when
  // the OS throttles JS timers with the screen off.
  const [phase, setPhase] = useState<TimerPhase>('idle');
  const [preset, setPreset] = useState<MeditationPreset>(10);
  const [remainingSec, setRemainingSec] = useState<number>(10 * 60);
  const [note, setNote] = useState('');
  const deadlineRef = useRef<number | null>(null);
  const startedAtRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [reminder, setReminder] = useState<MeditationReminderState>({
    enabled: false,
    ...DEFAULT_MEDITATION_REMINDER_TIME,
  });
  const [reminderBusy, setReminderBusy] = useState(false);

  const player = useAudioPlayer(RINGTONE_ASSET);

  const ringOnce = useCallback(() => {
    try {
      void setAudioModeAsync({ playsInSilentMode: true });
    } catch {
      // Best-effort: default audio behavior still rings audibly.
    }
    try {
      player.loop = false;
      void player.play();
    } catch {
      // A silent bell must never break the timer.
    }
  }, [player]);

  const stopTick = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => stopTick, [stopTick]);

  const load = useCallback(async () => {
    try {
      const patientId = getCachedPatientId();
      if (!patientId) {
        setEntries([]);
        setLoading(false);
        return;
      }
      setEntries(await listMeditationSessions(patientId, 200));
      setReminder(await getMeditationReminder().catch(() => ({
        enabled: false,
        ...DEFAULT_MEDITATION_REMINDER_TIME,
      })));
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  const persistSit = useCallback(
    async (input: {
      presetMin: MeditationPreset;
      durationSec: number;
      startedAt: string;
      endedAt: string;
      completed: boolean;
      notes: string;
    }) => {
      const patientId = getCachedPatientId();
      if (!patientId) {
        setSaveError('Your session has expired. Please sign in again.');
        return;
      }
      try {
        const clean = normalizeMeditationInput({
          preset_min: input.presetMin,
          duration_sec: input.durationSec,
          started_at: input.startedAt,
          ended_at: input.endedAt,
          completed: input.completed,
          notes: input.notes,
        });
        await insertMeditationSession(patientId, clean);
        setNote('');
        setSaveError(null);
        await load();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Could not save this sit.');
      }
    },
    [load],
  );

  const finishSit = useCallback(() => {
    stopTick();
    deadlineRef.current = null;
    const startedAt = startedAtRef.current;
    startedAtRef.current = null;
    setPhase('idle');
    if (!startedAt) {
      setRemainingSec(preset * 60);
      return;
    }
    const endedAt = new Date().toISOString();
    const durationSec = Math.max(
      1,
      Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
    );
    ringOnce();
    void persistSit({
      presetMin: preset,
      durationSec,
      startedAt,
      endedAt,
      completed: true,
      notes: note,
    });
    setRemainingSec(preset * 60);
  }, [stopTick, preset, note, ringOnce, persistSit]);

  // Completion watcher: the interval only ticks the display; the deadline
  // decides the finish so late ticks still complete exactly once.
  useEffect(() => {
    if (phase !== 'running') return;
    intervalRef.current = setInterval(() => {
      const deadline = deadlineRef.current;
      if (deadline === null) return;
      const left = Math.max(0, (deadline - Date.now()) / 1000);
      setRemainingSec(left);
      if (left <= 0) finishSit();
    }, 250);
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [phase, finishSit]);

  const startSit = useCallback(() => {
    if (phase === 'running') return;
    const now = new Date();
    startedAtRef.current = now.toISOString();
    deadlineRef.current = now.getTime() + preset * 60 * 1000;
    setRemainingSec(preset * 60);
    setSaveError(null);
    ringOnce();
    setPhase('running');
  }, [phase, preset, ringOnce]);

  const pauseSit = useCallback(() => {
    if (phase !== 'running' || deadlineRef.current === null) return;
    setRemainingSec(Math.max(0, (deadlineRef.current - Date.now()) / 1000));
    deadlineRef.current = null;
    stopTick();
    setPhase('paused');
  }, [phase, stopTick]);

  const resumeSit = useCallback(() => {
    if (phase !== 'paused') return;
    deadlineRef.current = Date.now() + Math.max(0, remainingSec) * 1000;
    setPhase('running');
  }, [phase, remainingSec]);

  const endEarly = useCallback(() => {
    if (phase === 'idle' || !startedAtRef.current) return;
    const startedAt = startedAtRef.current;
    const endedAt = new Date().toISOString();
    const durationSec = Math.max(
      1,
      Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
    );
    Alert.alert(
      'End this sit early?',
      'The partial sit is saved but does not count toward your totals.',
      [
        { text: 'Keep sitting', style: 'cancel' },
        {
          text: 'End early',
          style: 'destructive',
          onPress: () => {
            stopTick();
            deadlineRef.current = null;
            startedAtRef.current = null;
            setPhase('idle');
            setRemainingSec(preset * 60);
            void persistSit({
              presetMin: preset,
              durationSec,
              startedAt,
              endedAt,
              completed: false,
              notes: note,
            });
          },
        },
      ],
    );
  }, [phase, preset, note, stopTick, persistSit]);

  const confirmDelete = useCallback(
    (entry: MeditationSession) => {
      Alert.alert('Delete sit?', 'This removes the sit from this device. This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const patientId = getCachedPatientId();
            if (!patientId) return;
            void deleteMeditationSession(patientId, entry.entry_id).then(() => load());
          },
        },
      ]);
    },
    [load],
  );

  const toggleReminder = useCallback(async () => {
    if (reminderBusy) return;
    setReminderBusy(true);
    try {
      const next = {
        enabled: !reminder.enabled,
        hour: DEFAULT_MEDITATION_REMINDER_TIME.hour,
        minute: DEFAULT_MEDITATION_REMINDER_TIME.minute,
      };
      await setMeditationReminder(next);
      setReminder(await getMeditationReminder());
    } finally {
      setReminderBusy(false);
    }
  }, [reminderBusy, reminder.enabled]);

  const totals = summarizeMeditation(entries);
  const week = summarizeMeditationWeek(entries, todayKey());
  const weekTotal = week.reduce((s, d) => s + d.count, 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Meditation.</Text>
        <Text style={styles.sub}>Timed sits. Nothing leaves this device.</Text>

        <SectionHeader dark title="Timer" titleStyle={styles.histTitle} />
        <Card kind="highlighted" accentColor={TONE} style={styles.darkCard}>
          <View style={styles.chipRow}>
            {MEDITATION_PRESETS.map((m) => (
              <Chip
                key={m}
                label={`${m} min`}
                selected={preset === m}
                onPress={() => {
                  if (phase !== 'idle') return;
                  setPreset(m);
                  setRemainingSec(m * 60);
                }}
                size="medium"
              />
            ))}
          </View>
          <Text style={styles.clock}>{formatClock(remainingSec)}</Text>
          <Text style={styles.avgSub}>
            {phase === 'idle'
              ? 'A bell rings at the start and the end.'
              : phase === 'running'
                ? 'Sitting… the bell rings at zero.'
                : 'Paused. Resume when ready.'}
          </Text>
          {phase === 'idle' ? (
            <Button
              title="Start sit"
              onPress={startSit}
              fullWidth
              size="large"
              style={styles.logBtn}
              textStyle={styles.logBtnText}
            />
          ) : phase === 'running' ? (
            <View style={styles.btnRow}>
              <View style={styles.btnHalf}>
                <Button title="Pause" variant="secondary" onPress={pauseSit} fullWidth />
              </View>
              <View style={styles.btnHalf}>
                <Button title="End early" variant="ghost" onPress={endEarly} fullWidth />
              </View>
            </View>
          ) : (
            <View style={styles.btnRow}>
              <View style={styles.btnHalf}>
                <Button
                  title="Resume"
                  onPress={resumeSit}
                  fullWidth
                  style={styles.logBtn}
                  textStyle={styles.logBtnText}
                />
              </View>
              <View style={styles.btnHalf}>
                <Button title="End early" variant="ghost" onPress={endEarly} fullWidth />
              </View>
            </View>
          )}
          {phase === 'idle' ? (
            <Input
              label="Note for this sit (optional)"
              value={note}
              onChangeText={setNote}
              placeholder="One line for today"
            />
          ) : null}
          {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
        </Card>

        <SectionHeader dark title="This week" titleStyle={styles.histTitle} />
        <Card style={styles.darkCard}>
          <View style={styles.strip}>
            {week.map((d) => (
              <View key={d.date} style={styles.cell}>
                <View style={[styles.dot, d.count > 0 ? styles.dotOn : styles.dotOff]}>
                  {d.count > 1 ? <Text style={styles.dotCount}>{d.count}</Text> : null}
                </View>
                <Text style={styles.cellDay}>{d.date.slice(8)}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.weekTotal}>
            {weekTotal === 0
              ? 'No completed sits this week.'
              : `${weekTotal} ${weekTotal === 1 ? 'sit' : 'sits'} this week · ${totals.minutes} min total.`}
          </Text>
          <Text style={styles.provenance}>Completed sits only. Counts logged days on this device only.</Text>
        </Card>

        <SectionHeader dark title="Practice reminder" titleStyle={styles.histTitle} />
        <Card style={styles.darkCard}>
          <Text style={styles.avgSub}>{describeMeditationReminder(reminder)}</Text>
          <Button
            title={reminderBusy ? 'Saving…' : reminder.enabled ? 'Turn reminder off' : 'Remind me daily at 08:00'}
            variant="secondary"
            onPress={() => void toggleReminder()}
            disabled={reminderBusy}
            fullWidth
          />
          <Text style={styles.provenance}>One quiet nudge a day. Off until you turn it on.</Text>
        </Card>

        <SectionHeader dark title="History" titleStyle={styles.histTitle} />
        {loading ? (
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : entries.length === 0 ? (
          <EmptyState
            title="No sits yet"
            message="Pick a preset above and start your first timed sit."
          />
        ) : (
          <View style={styles.list}>
            {entries.map((entry) => (
              <Card key={entry.entry_id} style={styles.darkCard}>
                <View style={styles.rowTop}>
                  <View style={styles.rowMain}>
                    <View style={styles.kindRow}>
                      <View style={[styles.kindDot, { backgroundColor: TONE }]} />
                      <Text style={styles.rowTitle}>
                        {formatMinutes(entry.duration_sec)}
                        {entry.completed === 1 ? '' : ' · ended early'}
                      </Text>
                    </View>
                    <Text style={styles.rowSub}>{formatWhen(entry.started_at)}</Text>
                    {entry.notes ? <Text style={styles.rowNotes}>{entry.notes}</Text> : null}
                  </View>
                  <View style={styles.rowActions}>
                    <Pressable
                      onPress={() => confirmDelete(entry)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Delete sit"
                      style={styles.rowBtn}
                    >
                      <Text style={[styles.rowBtnText, styles.deleteText]}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}
        <Text style={styles.disclaimer}>
          Tracking only. Not medical advice, diagnosis, or treatment.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080A11' },
  content: {
    paddingHorizontal: SPACE.screenH,
    paddingVertical: SPACE.sectionGap,
    paddingBottom: 32,
    gap: 12,
  },
  title: {
    fontFamily: FONT.semi,
    fontSize: 24,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  sub: { ...TYPE.body, color: GV.fog, textAlign: 'center' },
  histTitle: { color: '#FFFFFF' },
  darkCard: {
    backgroundColor: '#10141F',
    borderColor: 'rgba(255,255,255,0.10)',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  clock: {
    fontFamily: FONT.semi,
    fontSize: 56,
    fontWeight: '700',
    letterSpacing: -1,
    color: '#FFFFFF',
    textAlign: 'center',
    marginVertical: 4,
  },
  bigValue: {
    fontFamily: FONT.semi,
    fontSize: 36,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  avgSub: { ...TYPE.body, color: GV.fog, marginBottom: 8 },
  provenance: { ...TYPE.caption, color: GV.fog, marginTop: 8 },
  weekTotal: { ...TYPE.body, color: '#FFFFFF', marginTop: 8 },
  loading: { ...TYPE.body, color: GV.fog },
  fact: { marginTop: 8 },
  error: { ...TYPE.body, color: '#E07864', marginTop: 8 },
  logBtn: { backgroundColor: '#4FD1C5', marginTop: 4 },
  logBtnText: { color: '#062A26' },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  btnHalf: { flex: 1 },
  strip: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  cell: { alignItems: 'center', gap: 4, flex: 1 },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotOn: { backgroundColor: TONE },
  dotOff: { backgroundColor: 'rgba(255,255,255,0.10)' },
  dotCount: { color: '#080A11', fontSize: 12, fontWeight: '700' },
  cellDay: { ...TYPE.caption, color: GV.fog },
  list: { gap: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start' },
  rowMain: { flex: 1 },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kindDot: { width: 10, height: 10, borderRadius: 5 },
  rowTitle: { ...TYPE.button, color: '#FFFFFF', flex: 1 },
  rowSub: { ...TYPE.caption, color: GV.fog, marginTop: 2 },
  rowNotes: { ...TYPE.body, color: GV.fog, marginTop: 4 },
  rowActions: { flexDirection: 'row', gap: 4 },
  rowBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  rowBtnText: { ...TYPE.chip, color: GV.fog },
  deleteText: { color: '#E07864' },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 4 },
});
