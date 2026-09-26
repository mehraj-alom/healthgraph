/**
 * MedicationCallScreen — app-local incoming-call medication reminder.
 *
 * NOT a telecom call: an on-device, event-driven experience built on the
 * existing reminder engine (same scheduler rows, same OS alarms, same
 * takeReminderDose / snoozeReminder paths, same taken-event sync).
 *
 * One call at a time (callMachineReducer): late/duplicate OS callbacks for
 * an already-handled occurrence land in STALE and can never resurrect it.
 * Every exit stops ringtone + vibration + animation + timers (see cleanup
 * effect + phase effects below). RINGING presentation is in-app only; when
 * the app is backgrounded/killed the platform notification (unchanged)
 * remains the waker and its tap routes here.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { getCachedPatientId } from '@/services/patientIdentity';
import { getMedicationById } from '@/db/queries/medications';
import {
  getReminderInstance,
  listReminderInstancesFrom,
} from '@/db/queries/reminderInstances';
import {
  snoozeReminder,
  takeReminderDose,
} from '@/services/medicationReminders';
import {
  computeReminderOccurrences,
  snoozeOptionsFor,
  type SnoozeOption,
} from '@/services/medicationReminderSchedule';
import {
  CALL_GROUP_WINDOW_MIN,
  INITIAL_CALL_STATE,
  callMachineReducer,
  groupDueOccurrences,
  isCallTerminal,
} from '@/services/medicationCall/callMachine';
import {
  RINGTONE_ASSET,
  startCallVibration,
  startRing,
  stopCallVibration,
  stopRing,
  tapTick,
} from '@/services/medicationCall/ringtone';
import type { RootStackParamList } from '@/types';
import { FONT } from '@/theme/guava';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'MedicationCall'>;

interface CallMember {
  occurrenceId: string;
  medName: string;
  doseText: string | null;
  scheduledTime: string;
}

const RUNTIME_SUPPORTED =
  Platform.OS !== 'web' && Constants.appOwnership !== 'expo';

/** Looping chime, owned by mount lifetime: unmount always stops audio. */
function RingAudio() {
  const player = useAudioPlayer(RINGTONE_ASSET);
  useEffect(() => {
    try {
      void setAudioModeAsync({ playsInSilentMode: true });
    } catch {
      // Best-effort: default audio behavior still rings audibly.
    }
    startRing(player);
    return () => stopRing(player);
  }, [player]);
  return null;
}

/** Expanding ripple rings around the call emblem (pure decoration). */
function RingRipple({ active }: { active: boolean }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, t]);
  if (!active) return null;
  return (
    <View style={rippleStyles.host} pointerEvents="none">
      {[0, 1, 2].map((i) => {
        const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.5] });
        const opacity = t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.5, 0.25, 0] });
        return <Animated.View key={i} style={[rippleStyles.ring, { transform: [{ scale }], opacity }]} />;
      })}
    </View>
  );
}

const rippleStyles = StyleSheet.create({
  host: { position: 'absolute', width: 220, height: 220, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 170, height: 170, borderRadius: 85, borderWidth: 2, borderColor: '#3ddc84' },
});

export default function MedicationCallScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { occurrenceId } = route.params;
  const [machine, dispatch] = useReducer(callMachineReducer, INITIAL_CALL_STATE);
  const [members, setMembers] = useState<CallMember[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [gone, setGone] = useState(false);
  const [busyMed, setBusyMed] = useState<string | null>(null);
  const [snoozeBusy, setSnoozeBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [options, setOptions] = useState<SnoozeOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  const machineRef = useRef(machine);
  machineRef.current = machine;

  const exit = useCallback(() => {
    stopCallVibration();
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Main', { screen: 'Dashboard' } as never);
  }, [navigation]);

  // Load + stale guard: a missing/non-scheduled row means this callback is
  // late (taken, snoozed elsewhere, dismissed, pruned) — show "handled" and
  // never fire a call for it.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const patientId = getCachedPatientId();
        if (!patientId) {
          if (live) {
            setGone(true);
            setLoaded(true);
          }
          return;
        }
        const row = await getReminderInstance(patientId, occurrenceId).catch(() => null);
        if (!live) return;
        if (!row || row.patient_id !== patientId || row.status !== 'scheduled') {
          setGone(true);
          setLoaded(true);
          return;
        }
        const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const siblings = await listReminderInstancesFrom(patientId, from).catch(() => []);
        const ids = groupDueOccurrences(
          { occurrence_id: row.occurrence_id, scheduled_at: row.scheduled_at, status: row.status },
          siblings.map((s) => ({ occurrence_id: s.occurrence_id, scheduled_at: s.scheduled_at, status: s.status })),
          CALL_GROUP_WINDOW_MIN,
        );
        const infos: CallMember[] = [];
        for (const id of ids) {
          const inst = id === row.occurrence_id ? row : siblings.find((s) => s.occurrence_id === id);
          if (!inst) continue;
          const med = await getMedicationById(patientId, inst.medication_id).catch(() => null);
          infos.push({
            occurrenceId: id,
            medName: med?.name ?? 'Medication',
            doseText: med?.dose_amount != null ? `${med.dose_amount}${med.dose_unit ? ` ${med.dose_unit}` : ''}` : null,
            scheduledTime: inst.scheduled_time,
          });
          if (med && id === row.occurrence_id) {
            const future = computeReminderOccurrences(
              [
                {
                  medication_id: med.medication_id,
                  name: med.name,
                  dose_amount: med.dose_amount,
                  dose_unit: med.dose_unit,
                  frequency: med.frequency,
                  scheduled_times: med.scheduled_times,
                  scheduled_weekdays: med.scheduled_weekdays,
                  start_date: med.start_date,
                  end_date: med.end_date,
                  status: med.status,
                  prn: med.prn,
                  reminder_enabled: true,
                },
              ],
              new Date(),
            );
            setOptions(
              snoozeOptionsFor({ scheduledAt: row.scheduled_at, medicationId: row.medication_id }, future),
            );
          }
        }
        if (!live) return;
        if (infos.length === 0) {
          setGone(true);
        } else {
          setMembers(infos);
          dispatch({ type: 'FIRE', callId: occurrenceId, members: infos.map((m) => m.occurrenceId) });
        }
      } catch {
        if (live) setGone(true);
      } finally {
        if (live) setLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [occurrenceId]);

  // Ringing ambience follows the machine phase: start on RINGING, stop on
  // every other phase. Unmount always stops (cleanup below).
  const ringing = machine.phase === 'RINGING';
  useEffect(() => {
    if (ringing) startCallVibration();
    else stopCallVibration();
  }, [ringing]);
  useEffect(() => () => stopCallVibration(), []);

  const answer = useCallback(() => {
    tapTick();
    stopCallVibration();
    dispatch({ type: 'ANSWER' });
  }, []);

  const decline = useCallback(() => {
    tapTick();
    stopCallVibration();
    dispatch({ type: 'DECLINE' });
    setSheetOpen(true);
  }, []);

  const confirmTaken = useCallback(
    async (memberOccurrenceId: string) => {
      setError(null);
      setBusyMed(memberOccurrenceId);
      try {
        const patientId = getCachedPatientId();
        if (!patientId) throw new Error('Your session has expired. Please sign in again.');
        await takeReminderDose(patientId, memberOccurrenceId);
        tapTick();
        dispatch({ type: 'MED_TAKEN', occurrenceId: memberOccurrenceId });
        const rest = machineRef.current.members.filter(
          (m) => m !== memberOccurrenceId && !machineRef.current.taken[m],
        );
        if (rest.length === 0) {
          setDoneMessage(
            members.length > 1 ? 'All due medications recorded.' : 'Medication marked as taken.',
          );
          dispatch({ type: 'ALL_CONFIRMED' });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not record this dose. Try again.');
      } finally {
        setBusyMed(null);
      }
    },
    [members.length],
  );

  const applySnooze = useCallback(
    async (minutes: number | null) => {
      if (minutes == null) return;
      setError(null);
      setSnoozeBusy(true);
      try {
        const patientId = getCachedPatientId();
        if (!patientId) throw new Error('Your session has expired. Please sign in again.');
        const pending = machineRef.current.members.filter((m) => !machineRef.current.taken[m]);
        for (const id of pending) {
          await snoozeReminder(patientId, id, minutes);
        }
        setSheetOpen(false);
        dispatch({ type: 'SNOOZED' });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not delay this reminder. Try again.');
      } finally {
        setSnoozeBusy(false);
      }
    },
    [],
  );

  const title = useMemo(() => {
    if (members.length > 1) return `${members.length} medications are due`;
    return members[0]?.medName ?? 'Medication reminder';
  }, [members]);

  if (!loaded) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.dim}>Preparing your reminder…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (gone || machine.phase === 'STALE') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.h1}>Already handled</Text>
          <Text style={styles.dim}>This reminder was taken, delayed, or dismissed elsewhere.</Text>
          <Pressable onPress={exit} accessibilityRole="button" accessibilityLabel="Close" style={styles.primaryBtn}>
            <Text style={styles.primaryText}>CLOSE</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {ringing && RUNTIME_SUPPORTED ? <RingAudio /> : null}
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>HealthGraph</Text>
        <Text style={styles.incoming}>
          {machine.phase === 'RINGING' ? '● incoming reminder' : 'Medication Reminder'}
        </Text>

        <View style={styles.emblemWrap}>
          <RingRipple active={ringing} />
          <View style={styles.emblem}>
            <Text style={styles.emblemGlyph}>✚</Text>
          </View>
        </View>

        <Text style={styles.title}>{title}</Text>
        {members.map((m) => (
          <View key={m.occurrenceId} style={styles.medRow}>
            <View style={styles.medInfo}>
              <Text style={styles.medName}>{m.medName}</Text>
              <Text style={styles.medMeta}>
                {[m.doseText, m.scheduledTime ? `due ${m.scheduledTime}` : null].filter(Boolean).join(' · ') || 'Scheduled dose'}
              </Text>
            </View>
            {machine.taken[m.occurrenceId] ? <Text style={styles.takenTick}>✓</Text> : null}
          </View>
        ))}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {machine.phase === 'RINGING' && (
          <View style={styles.callRow}>
            <Pressable
              onPress={decline}
              accessibilityRole="button"
              accessibilityLabel="Decline reminder"
              style={({ pressed }) => [styles.declineBtn, pressed && styles.pressed]}
            >
              <Text style={styles.declineGlyph}>✕</Text>
              <Text style={styles.callLabel}>Decline</Text>
            </Pressable>
            <Pressable
              onPress={answer}
              accessibilityRole="button"
              accessibilityLabel="Answer reminder"
              style={({ pressed }) => [styles.answerBtn, pressed && styles.pressed]}
            >
              <Text style={styles.answerGlyph}>✓</Text>
              <Text style={styles.callLabel}>Answer</Text>
            </Pressable>
          </View>
        )}

        {machine.phase === 'CONFIRMING' && (
          <View style={styles.confirmBlock}>
            <Text style={styles.confirmQ}>Did you take it?</Text>
            {members
              .filter((m) => !machine.taken[m.occurrenceId])
              .map((m) => (
                <Pressable
                  key={m.occurrenceId}
                  onPress={() => void confirmTaken(m.occurrenceId)}
                  disabled={busyMed !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`Yes, took ${m.medName}`}
                  style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed, busyMed !== null && styles.disabledBtn]}
                >
                  <Text style={styles.primaryText}>
                    {busyMed === m.occurrenceId ? 'RECORDING…' : members.length > 1 ? `YES — TOOK ${m.medName.toUpperCase()}` : 'YES, TAKEN'}
                  </Text>
                </Pressable>
              ))}
            <Pressable
              onPress={() => setSheetOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Remind me later"
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryText}>Remind me later</Text>
            </Pressable>
          </View>
        )}

        {(machine.phase === 'COMPLETED' || machine.phase === 'REMIND_LATER') && (
          <View style={styles.confirmBlock}>
            <Text style={styles.doneTick}>✓</Text>
            <Text style={styles.doneText}>
              {doneMessage ?? (machine.phase === 'COMPLETED' ? 'Medication recorded.' : 'Reminder delayed.')}
            </Text>
            <Pressable onPress={exit} accessibilityRole="button" accessibilityLabel="Done" style={styles.primaryBtn}>
              <Text style={styles.primaryText}>DONE</Text>
            </Pressable>
          </View>
        )}

        {isCallTerminal(machine.phase) && machine.phase !== 'COMPLETED' && machine.phase !== 'REMIND_LATER' && (
          <View style={styles.confirmBlock}>
            <Text style={styles.doneText}>{machine.reason ?? 'This call has ended.'}</Text>
            <Pressable onPress={exit} accessibilityRole="button" accessibilityLabel="Close" style={styles.primaryBtn}>
              <Text style={styles.primaryText}>CLOSE</Text>
            </Pressable>
          </View>
        )}

        {sheetOpen && (machine.phase === 'DECLINED' || machine.phase === 'CONFIRMING') && (
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Remind me</Text>
            {options.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => void applySnooze(o.minutes)}
                disabled={snoozeBusy}
                accessibilityRole="button"
                accessibilityLabel={o.label}
                style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}
              >
                <Text style={styles.sheetLabel}>{o.label}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setSheetOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Keep this reminder"
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryText}>Cancel — keep this reminder</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.fineprint}>App reminder — not a phone call. Sound and vibration stop when you answer, decline, or leave.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0f0d' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  content: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 40, gap: 14, alignItems: 'stretch' },
  brand: { fontFamily: FONT.semi, fontSize: 13, letterSpacing: 4, color: '#7d8f96', textAlign: 'center' },
  incoming: { fontFamily: FONT.semi, fontSize: 12, letterSpacing: 2, color: '#3ddc84', textAlign: 'center' },
  emblemWrap: { alignItems: 'center', justifyContent: 'center', height: 220, marginVertical: 4 },
  emblem: {
    width: 120, height: 120, borderRadius: 60, backgroundColor: '#122019',
    borderWidth: 2, borderColor: '#3ddc84', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#3ddc84', shadowOpacity: 0.35, shadowRadius: 18, elevation: 8,
  },
  emblemGlyph: { fontSize: 52, color: '#3ddc84' },
  title: { fontFamily: FONT.semi, fontSize: 24, lineHeight: 30, color: '#e8f0ec', textAlign: 'center' },
  medRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#141c19', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
    borderWidth: 1, borderColor: '#223028',
  },
  medInfo: { flex: 1, gap: 2 },
  medName: { fontFamily: FONT.semi, fontSize: 17, color: '#e8f0ec' },
  medMeta: { fontSize: 13, color: '#93a5a0', fontVariant: ['tabular-nums'] },
  takenTick: { fontSize: 22, color: '#3ddc84' },
  h1: { fontFamily: FONT.semi, fontSize: 22, color: '#e8f0ec', textAlign: 'center' },
  dim: { fontSize: 14, color: '#93a5a0', textAlign: 'center' },
  error: { fontSize: 13, color: '#ff5d5d', textAlign: 'center' },
  callRow: { flexDirection: 'row', justifyContent: 'space-evenly', marginTop: 12 },
  answerBtn: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#0e5c40', alignItems: 'center', justifyContent: 'center', gap: 2 },
  declineBtn: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#4a1a1a', alignItems: 'center', justifyContent: 'center', gap: 2 },
  answerGlyph: { fontSize: 30, color: '#eafff3' },
  declineGlyph: { fontSize: 26, color: '#ffd9d9' },
  callLabel: { fontFamily: FONT.semi, fontSize: 11, letterSpacing: 1, color: '#e8f0ec' },
  pressed: { opacity: 0.75 },
  confirmBlock: { gap: 10, marginTop: 4 },
  confirmQ: { fontFamily: FONT.semi, fontSize: 18, color: '#e8f0ec', textAlign: 'center' },
  primaryBtn: { backgroundColor: '#0e5c40', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  disabledBtn: { opacity: 0.5 },
  primaryText: { fontFamily: FONT.semi, fontSize: 15, letterSpacing: 1, color: '#eafff3' },
  secondaryBtn: { borderRadius: 14, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: '#2c3a34' },
  secondaryText: { fontFamily: FONT.semi, fontSize: 14, color: '#c9d5da' },
  doneTick: { fontSize: 44, color: '#3ddc84', textAlign: 'center' },
  doneText: { fontSize: 15, lineHeight: 21, color: '#e8f0ec', textAlign: 'center' },
  sheet: { backgroundColor: '#141c19', borderRadius: 16, padding: 14, gap: 6, borderWidth: 1, borderColor: '#223028' },
  sheetTitle: { fontFamily: FONT.semi, fontSize: 15, letterSpacing: 1, color: '#c9d5da', textAlign: 'center', marginBottom: 4 },
  sheetRow: { paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#223028' },
  sheetLabel: { fontSize: 15, color: '#e8f0ec' },
  fineprint: { fontSize: 11, lineHeight: 15, color: '#5b6b72', textAlign: 'center', marginTop: 8 },
});
