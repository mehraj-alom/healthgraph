/**
 * MedicationReminderScreen — call-like local reminder surface.
 *
 * One dose, three big one-tap decisions: green Taken records the
 * existing TAKEN event and dismisses; red Still not taken means "not
 * yet" (it records nothing) and opens
 * the delay sheet; neutral Remind me later opens the SAME delay sheet
 * instead of scheduling anything by itself. The sheet offers fixed
 * delays plus later-today and next-suitable-time; every choice creates
 * one temporary snooze instance and never mutates the recurring
 * schedule. No calls, no speech, no server.
 *
 * PREMIUM: intentionally NOT gated (stays free). This is plain on-device
 * local-notification dose logging (Taken / snooze rows) — no voice alarms,
 * no call-style ringing, no speech. Voice/call alarms (voiceAlarms,
 * All-in) live in MedicationCallScreen and the VoiceCheckin scheduler,
 * which are gated separately.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '@/components';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { LG } from '@/theme/liquidGlass';
import { getCachedPatientId } from '@/services/patientIdentity';
import { getReminderInstance } from '@/db/queries/reminderInstances';
import type { ReminderInstance } from '@/db/queries/reminderInstances';
import { getMedicationById } from '@/db/queries/medications';
import {
  MAX_SNOOZE_COUNT,
  computeReminderOccurrences,
  snoozeOptionsFor,
  snoozeReminder,
  takeReminderDose,
  type SnoozeOption,
} from '@/services/medicationReminders';
import type { RootStackParamList } from '@/types';
import { solidForMedication } from './MedicationsScreen';

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'MedicationReminder'>;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today · ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${time}`;
}

/** "Now" while the dose is due (first 30 minutes past schedule). */
function isDueNow(iso: string, nowMs: number = Date.now()): boolean {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return false;
  return nowMs >= at && nowMs - at < 30 * 60000;
}

export default function MedicationReminderScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { occurrenceId, action } = route.params;
  const [instance, setInstance] = useState<ReminderInstance | null>(null);
  const [medId, setMedId] = useState('');
  const [medName, setMedName] = useState('Medication');
  const [doseText, setDoseText] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  // One shared delay sheet behind both "Still not taken" and
  // "Remind me later" — the latter never schedules anything itself.
  const [showSheet, setShowSheet] = useState(false);
  const [options, setOptions] = useState<SnoozeOption[]>([]);
  const autoRan = useRef(false);

  const exitToDashboard = useCallback(() => {
    navigation.navigate('Main', { screen: 'Dashboard' } as never);
  }, [navigation]);

  const exit = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else exitToDashboard();
  }, [navigation, exitToDashboard]);

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
        if (!row || row.patient_id !== patientId) {
          setGone(true);
        } else {
          setInstance(row);
          setMedId(row.medication_id);
          const med = await getMedicationById(patientId, row.medication_id).catch(() => null);
          if (!live) return;
          if (med) {
            setMedName(med.name);
            setDoseText(
              med.dose_amount != null
                ? `${med.dose_amount}${med.dose_unit ? ` ${med.dose_unit}` : ''}`
                : null,
            );
          }
          // "Later" resolves against this medication's own future slots.
          if (med) {
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
              snoozeOptionsFor(
                { scheduledAt: row.scheduled_at, medicationId: row.medication_id },
                future,
              ),
            );
          }
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

  const doTaken = useCallback(async () => {
    if (busy) return;
    const patientId = getCachedPatientId();
    if (!patientId) {
      Alert.alert('Error', 'Not authenticated');
      return;
    }
    setBusy(true);
    try {
      await takeReminderDose(patientId, occurrenceId);
      setDoneMessage('Dose recorded.');
    } catch (error) {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'Could not record this dose.',
      );
    } finally {
      setBusy(false);
    }
  }, [busy, occurrenceId]);

  const doSnooze = useCallback(
    async (minutes: number | null) => {
      if (busy || minutes == null) return;
      const patientId = getCachedPatientId();
      if (!patientId) {
        Alert.alert('Error', 'Not authenticated');
        return;
      }
      setBusy(true);
      try {
        await snoozeReminder(patientId, occurrenceId, minutes);
        setDoneMessage('Snoozed. The reminder will fire again.');
      } catch (error) {
        Alert.alert(
          'Error',
          error instanceof Error ? error.message : 'Could not snooze this reminder.',
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, occurrenceId],
  );

  // Notification action shortcuts (Taken / Snooze from the shade) land
  // here and run once — the screen then shows the outcome.
  useEffect(() => {
    if (!loaded || gone || doneMessage || autoRan.current) return;
    if (action === 'taken') {
      autoRan.current = true;
      void doTaken();
    } else if (action === 'snooze-30') {
      autoRan.current = true;
      void doSnooze(30);
    } else if (action === 'snooze-60') {
      autoRan.current = true;
      void doSnooze(60);
    }
  }, [loaded, gone, doneMessage, action, doTaken, doSnooze]);

  const solid = solidForMedication(medId || occurrenceId, 0);
  const initial = (medName.trim().charAt(0) || 'M').toUpperCase();

  return (
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {!loaded ? (
            <Text style={styles.status}>Loading reminder…</Text>
          ) : gone || !instance ? (
            <GlassSurface strong style={styles.card}>
              <Text style={styles.goneTitle}>Nothing to show</Text>
              <Text style={styles.goneBody}>
                This reminder is no longer active. It may already be handled or removed.
              </Text>
              <Button title="Done" variant="secondary" onPress={exit} fullWidth />
            </GlassSurface>
          ) : doneMessage ? (
            <GlassSurface strong style={styles.card}>
              <Text style={styles.goneTitle}>{medName}</Text>
              <Text style={styles.goneBody}>{doneMessage}</Text>
              <Button title="Done" variant="secondary" onPress={exitToDashboard} fullWidth />
            </GlassSurface>
          ) : (
            <>
              <View style={styles.caller}>
                <View style={[styles.avatar, { backgroundColor: solid }]}>
                  <Text style={styles.avatarInitial}>{initial}</Text>
                </View>
                <Text style={styles.medName} numberOfLines={2}>
                  {medName}
                </Text>
                <Text style={styles.subline}>
                  {doseText ? `${doseText} · ` : ''}
                  {isDueNow(instance.scheduled_at) ? 'Now' : formatWhen(instance.scheduled_at)}
                </Text>
              </View>
              <View style={styles.controls}>
                <View style={styles.callRow}>
                  <View style={styles.callCol}>
                    <Pressable
                      onPress={() => setShowSheet(true)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel="Still not taken, show delay options"
                      hitSlop={4}
                      style={({ pressed }) => [
                        styles.callBtn,
                        styles.declineBtn,
                        pressed && !busy && { opacity: 0.8 },
                        busy && { opacity: 0.6 },
                      ]}
                    >
                      <Text style={[styles.callGlyph, styles.declineGlyph]}>✕</Text>
                    </Pressable>
                    <Text style={styles.callLabel}>Not taken</Text>
                  </View>
                  <View style={styles.callCol}>
                    <Pressable
                      onPress={() => void doTaken()}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={`Record ${medName} taken`}
                      hitSlop={4}
                      style={({ pressed }) => [
                        styles.callBtn,
                        styles.acceptBtn,
                        pressed && !busy && { opacity: 0.8 },
                        busy && { opacity: 0.6 },
                      ]}
                    >
                      <Text style={[styles.callGlyph, styles.acceptGlyph]}>✓</Text>
                    </Pressable>
                    <Text style={styles.callLabel}>Taken</Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => setShowSheet(true)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Remind me later, show delay options"
                  hitSlop={4}
                  style={({ pressed }) => [
                    styles.laterBtn,
                    pressed && !busy && { opacity: 0.7 },
                    busy && { opacity: 0.6 },
                  ]}
                >
                  <Text style={styles.laterText}>Remind me later</Text>
                </Pressable>
                {showSheet ? (
                  <GlassSurface strong style={styles.sheet}>
                    <Text style={styles.snoozeTitle}>Remind me</Text>
                    {instance.snooze_count >= MAX_SNOOZE_COUNT ? (
                      <Text style={styles.snoozeNote}>
                        Snooze limit reached for this dose.
                      </Text>
                    ) : (
                      options.map((opt, idx) => (
                        <Pressable
                          key={opt.key}
                          onPress={() => void doSnooze(opt.minutes)}
                          disabled={busy}
                          accessibilityRole="button"
                          accessibilityLabel={opt.label}
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.snoozeRow,
                            idx > 0 && styles.snoozeDivider,
                            pressed && !busy && { opacity: 0.7 },
                          ]}
                        >
                          <Text style={styles.snoozeLabel}>{opt.label}</Text>
                          <Text style={styles.snoozeChev}>›</Text>
                        </Pressable>
                      ))
                    )}
                    <Pressable
                      onPress={() => setShowSheet(false)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel, keep this reminder"
                      hitSlop={8}
                      style={({ pressed }) => [
                        styles.snoozeRow,
                        styles.snoozeDivider,
                        pressed && !busy && { opacity: 0.7 },
                      ]}
                    >
                      <Text style={styles.snoozeLabel}>Cancel — keep this reminder</Text>
                    </Pressable>
                  </GlassSurface>
                ) : null}
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070F' },
  safe: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
    gap: 12,
    justifyContent: 'space-between',
  },
  status: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
    marginTop: 48,
  },
  caller: { alignItems: 'center', gap: 8, paddingTop: 32 },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    marginBottom: 4,
  },
  avatarInitial: {
    fontWeight: '600',
    fontSize: 34,
    lineHeight: 40,
    color: '#FFFFFF',
  },
  medName: {
    fontWeight: '600',
    fontSize: 34,
    lineHeight: 41,
    letterSpacing: -0.8,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  subline: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  controls: { gap: 12 },
  callRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingVertical: 8,
  },
  callCol: { alignItems: 'center', gap: 8, minWidth: 96 },
  callBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  // Taken is the prominent action: the single white pill.
  acceptBtn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  // Not-taken is status, not action: tinted danger glass.
  declineBtn: {
    backgroundColor: 'rgba(255, 142, 142, 0.16)',
    borderColor: 'rgba(255, 142, 142, 0.45)',
  },
  callGlyph: { fontWeight: '600', fontSize: 30, lineHeight: 34 },
  acceptGlyph: { color: '#0B0F1A' },
  declineGlyph: { color: LG.card.danger },
  callLabel: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
  },
  laterBtn: {
    minHeight: 56,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  laterText: { fontWeight: '600', fontSize: 16, lineHeight: 22, color: '#FFFFFF' },
  card: { padding: 20, gap: 12, marginTop: 48 },
  goneTitle: {
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.4,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  goneBody: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
  },
  sheet: { padding: 16, gap: 4 },
  snoozeTitle: { fontWeight: '600', fontSize: 15, lineHeight: 20, color: '#FFFFFF' },
  snoozeNote: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
  },
  snoozeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    minHeight: 48,
  },
  snoozeDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
  },
  snoozeLabel: { fontWeight: '600', fontSize: 15, lineHeight: 20, color: '#FFFFFF' },
  snoozeChev: { fontSize: 20, lineHeight: 22, color: SECONDARY },
});
