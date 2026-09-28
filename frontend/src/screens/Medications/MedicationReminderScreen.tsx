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
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '@/components';
import { GV, TYPE, FONT } from '@/theme/guava';
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
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!loaded ? (
          <Text style={styles.status}>Loading reminder…</Text>
        ) : gone || !instance ? (
          <View style={styles.card}>
            <Text style={styles.goneTitle}>Nothing to show</Text>
            <Text style={styles.goneBody}>
              This reminder is no longer active. It may already be handled or removed.
            </Text>
            <Button title="Done" onPress={exit} fullWidth />
          </View>
        ) : doneMessage ? (
          <View style={styles.card}>
            <Text style={styles.goneTitle}>{medName}</Text>
            <Text style={styles.goneBody}>{doneMessage}</Text>
            <Button title="Done" onPress={exitToDashboard} fullWidth />
          </View>
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
                    <Text style={styles.callGlyph}>✕</Text>
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
                    <Text style={styles.callGlyph}>✓</Text>
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
                <View style={styles.sheet}>
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
                </View>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const NAVY = '#080A11';
const TILE_BG = '#2A3049';
const HAIRLINE_ON_NAVY = 'rgba(255, 255, 255, 0.12)';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: NAVY },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
    gap: 12,
    justifyContent: 'space-between',
  },
  status: { ...TYPE.body, color: GV.fog, textAlign: 'center', marginTop: 48 },
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
    fontFamily: FONT.semi,
    fontSize: 34,
    lineHeight: 40,
    color: '#FFFFFF',
  },
  medName: {
    fontFamily: FONT.semi,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.3,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  subline: { ...TYPE.body, color: GV.fog, textAlign: 'center', fontVariant: ['tabular-nums'] },
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
  },
  acceptBtn: { backgroundColor: GV.cta },
  declineBtn: { backgroundColor: GV.danger },
  callGlyph: {
    fontFamily: FONT.semi,
    fontSize: 30,
    lineHeight: 34,
    color: '#FFFFFF',
  },
  callLabel: {
    fontFamily: FONT.regular,
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  laterBtn: {
    minHeight: 56,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  laterText: { fontFamily: FONT.semi, fontSize: 16, lineHeight: 22, color: '#FFFFFF' },
  card: {
    backgroundColor: TILE_BG,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: HAIRLINE_ON_NAVY,
    padding: 20,
    gap: 12,
    marginTop: 48,
  },
  goneTitle: { ...TYPE.title, color: '#FFFFFF', textAlign: 'center' },
  goneBody: { ...TYPE.body, color: GV.fog, textAlign: 'center' },
  sheet: {
    backgroundColor: TILE_BG,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: HAIRLINE_ON_NAVY,
    padding: 16,
    gap: 4,
  },
  snoozeTitle: { fontFamily: FONT.semi, fontSize: 15, lineHeight: 20, color: '#FFFFFF' },
  snoozeNote: { ...TYPE.body, color: GV.fog },
  snoozeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    minHeight: 48,
  },
  snoozeDivider: { borderTopWidth: 1, borderTopColor: HAIRLINE_ON_NAVY },
  snoozeLabel: { fontFamily: FONT.semi, fontSize: 15, lineHeight: 20, color: '#FFFFFF' },
  snoozeChev: { fontSize: 20, color: GV.fog },
});
