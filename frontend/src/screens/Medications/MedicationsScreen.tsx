/**
 * MedicationsScreen — GoalsStep reference style.
 *
 * Design Read: health product screen for patients, with a calm
 * onboarding-picker language, leaning toward the GoalsStep navy +
 * duotone bento tiles.
 * Dials: VARIANCE 6 / MOTION 4 / DENSITY 3.
 * Shape rule: tiles radius 8 (reference lock), pills only for
 * segmented + buttons. One accent (teal) + CTA green for Take.
 * Single eyebrow (live status). Sentence case throughout.
 *
 * Reference tokens (from OnboardingSetupScreen + GoalsStep + FocusStep):
 * - Backdrop #20263D, tile base #2A3049, duotones from TILE_TONES
 * - Overline semi 12/16 ls 3 teal centered; headline semi 32/38
 *   white centered ls -0.3; sub body fog centered
 * - Tiles: 2-col grid, radius 8, 2px transparent border (teal when
 *   expanded), gradient art + black 0.22 overlay, label medium
 *   15/20 white centered with shadow; odd last tile full-width h112
 *
 * Logic is untouched (same hooks, same API, same navigation).
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMedications, useMedicationSchedule, useMedicationTakenEvents, recordMedicationTaken } from '@/hooks/useMedications';
import { useHideTabBarOnScroll } from '@/components/tabBarVisibility';
import { useAuth } from '@/context/AuthContext';
import { getCachedPatientId } from '@/services/patientIdentity';
import { usePremiumEntitled } from '@/services/premium';
import { todayKey } from '@/screens/Onboarding/momentum';
import {
  listScanSessions,
  setScanStatus,
  deleteScanSession,
  type ScanSession,
} from '@/db/queries/scanSessions';
import { api } from '@/services/api';
import {
  hydrateMedications as dbHydrateMedications,
  markMedicationStatusLocal as dbMarkMedicationStatusLocal,
} from '@/db/queries/medications';
import { reconcileMedicationReminders } from '@/services/medicationReminders';
import {
  isReminderRuntimeSupported,
  requestReminderPermissions,
} from '@/services/reminderNotifications';
import { GV, TYPE, FONT } from '@/theme/guava';
import { Button, Card, Chip, Input } from '@/components';
import { HealthFact } from '@/components/HealthFact';
import type { Medication, MedicationFrequency, MedicationRoute, MedicationStatus, DailyMedicationSchedule, MedicationTakenEvent } from '@/types';
import type { RootStackParamList } from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// Reference backdrop in black; tile base + duotone solids unchanged.
const NAVY = '#080A11';
const TILE_BG = '#2A3049';
const HAIRLINE_ON_NAVY = 'rgba(255, 255, 255, 0.12)';

// Solid tile fills — one full colour per medication (no split gradient).
// Stable per medication id so each new medication keeps its own colour.
// Exported: the reminder (incoming-call) screen uses the same palette.
export const MED_SOLIDS: readonly string[] = [
  '#57507A',
  '#96684A',
  '#5C6E7C',
  '#6E7F4E',
  '#56837B',
  '#66666F',
  '#5A6078',
];

export function solidForMedication(medicationId: string, fallbackIndex: number): string {
  let hash = 0;
  for (let i = 0; i < medicationId.length; i++) {
    hash = (hash * 31 + medicationId.charCodeAt(i)) >>> 0;
  }
  if (hash === 0) return MED_SOLIDS[fallbackIndex % MED_SOLIDS.length];
  return MED_SOLIDS[hash % MED_SOLIDS.length];
}

// ── Frequency labels ──
const FREQUENCY_LABELS: Record<MedicationFrequency, string> = {
  ONCE_DAILY: 'Once daily',
  TWICE_DAILY: 'Twice daily',
  THREE_TIMES_DAILY: 'Three times daily',
  FOUR_TIMES_DAILY: 'Four times daily',
  EVERY_MORNING: 'Every morning',
  EVERY_EVENING: 'Every evening',
  EVERY_NIGHT: 'Every night',
  EVERY_8_HOURS: 'Every 8 hours',
  EVERY_12_HOURS: 'Every 12 hours',
  WEEKLY: 'Weekly',
  AS_NEEDED: 'As needed',
  CUSTOM: 'Custom',
};

// ── Route labels (review step — previously collected but never shown/saved) ──
const ROUTE_LABELS: Record<MedicationRoute, string> = {
  ORAL: 'Oral',
  TOPICAL: 'Topical',
  INJECTION: 'Injection',
  INHALED: 'Inhaled',
  SUBLINGUAL: 'Sublingual',
  RECTAL: 'Rectal',
  NASAL: 'Nasal',
  OPHTHALMIC: 'Eye drops',
  OTHER: 'Other',
};

// ── Status dot hues — small flat dots on dark tiles ──
const STATUS_DOTS: Record<MedicationStatus, string> = {
  ACTIVE: GV.fx.green,
  SCHEDULED: GV.fx.blue,
  COMPLETED: GV.muted,
  PAUSED: GV.fx.amber,
  DISCONTINUED: GV.muted,
};

// ── Helper functions ──
function formatTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Not set';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getStatusLabel(status: MedicationStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

/** Friendly one-liner per scan-session lifecycle state. */
function scanStatusCopy(status: ScanSession['status']): string {
  switch (status) {
    case 'capturing':
      return 'Unfinished scan. Pages were never uploaded.';
    case 'uploading':
      return 'Uploading pages…';
    case 'awaiting_extraction':
      return 'Saved. Reading finishes automatically. Confirm each medicine with Add med. Nothing is added automatically.';
    case 'reviewed':
      return 'Done. Medicines confirmed from this scan.';
  }
}

// ── Navy segmented control (reference segments language) ─────────────────
// Track white 8% + hairline; selected is solid white with navy text
// (mirrors segmentOn). 44pt targets.

function NavySegmented({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: 'active' | 'schedule' | 'history'; label: string }[];
  value: 'active' | 'schedule' | 'history';
  onChange: (k: 'active' | 'schedule' | 'history') => void;
}) {
  return (
    <View
      style={styles.segmentTrack}
      accessibilityRole="tablist"
      accessibilityLabel="Medication views"
    >
      {tabs.map((t) => {
        const selected = value === t.key;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={t.label}
            hitSlop={4}
            style={({ pressed }) => [
              styles.segment,
              selected && styles.segmentSelected,
              pressed && !selected && { opacity: 0.7 },
            ]}
          >
            <Text
              style={[styles.segmentText, selected && styles.segmentTextSelected]}
              numberOfLines={1}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Med tile: FocusTile language for a medication ────────────────────────
// Solid full-colour box with name + details only. Tap shows the
// Edit/Pause/Stop menu floating ABOVE the box (sibling overlay, never
// inside the tile), with a teal 2px ring while open.

function MedTile({
  index,
  medication,
  fullWidth,
  expanded,
  onToggle,
  onEdit,
  onPause,
  onResume,
  onStop,
}: {
  index: number;
  medication: Medication;
  fullWidth?: boolean;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const solid = solidForMedication(medication.medication_id, index);
  const frequencyLabel = FREQUENCY_LABELS[medication.frequency] || medication.frequency;
  const doseLine = [
    medication.strength ? `${medication.strength}${medication.strength_unit ? ` ${medication.strength_unit}` : ''}` : null,
    medication.dose_amount ? `${medication.dose_amount}${medication.dose_unit ? ` ${medication.dose_unit}` : ''}` : null,
  ].filter(Boolean).join(' · ');
  const timeLine = medication.scheduled_times && medication.scheduled_times.length > 0
    ? medication.scheduled_times.map(formatTime).join(' · ')
    : frequencyLabel;

  return (
    <View style={[styles.tileWrap, fullWidth && styles.tileWrapFull, expanded && styles.tileWrapOpen]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${medication.name} details`}
        accessibilityState={{ expanded }}
        style={({ pressed }) => [
          styles.tile,
          { backgroundColor: solid },
          fullWidth && styles.tileFull,
          expanded && styles.tileOn,
          pressed && { opacity: 0.88 },
        ]}
      >
        <View style={[styles.statusDot, { backgroundColor: STATUS_DOTS[medication.status] }]} />
        <Text style={styles.tileLabel} numberOfLines={2}>
          {medication.name}
        </Text>
        {doseLine ? (
          <Text style={styles.tileMeta} numberOfLines={1}>
            {doseLine}
          </Text>
        ) : null}
        <Text style={styles.tileMeta} numberOfLines={1}>
          {timeLine}
        </Text>
      </Pressable>
      {expanded ? (
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          style={styles.tileOverlay}
        >
          <View style={styles.popoverMenu}>
            <Pressable
              onPress={onEdit}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${medication.name}`}
              hitSlop={8}
              style={({ pressed }) => [styles.popoverBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.popoverBtnText}>Edit</Text>
            </Pressable>
            {medication.status === 'ACTIVE' ? (
              <Pressable
                onPress={onPause}
                accessibilityRole="button"
                accessibilityLabel={`Pause ${medication.name}`}
                hitSlop={8}
                style={({ pressed }) => [styles.popoverBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.popoverBtnText}>Pause</Text>
              </Pressable>
            ) : medication.status === 'PAUSED' ? (
              <Pressable
                onPress={onResume}
                accessibilityRole="button"
                accessibilityLabel={`Resume ${medication.name}`}
                hitSlop={8}
                style={({ pressed }) => [styles.popoverBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.popoverBtnText}>Resume</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onStop}
              accessibilityRole="button"
              accessibilityLabel={`Stop ${medication.name}`}
              hitSlop={8}
              style={({ pressed }) => [styles.popoverBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.popoverBtnText}>Stop</Text>
            </Pressable>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── MAIN COMPONENT ──

export default function MedicationsScreen() {
  const navigation = useNavigation<Nav>();
  void navigation;
  const { user } = useAuth();
  void user;
  const [selectedTab, setSelectedTab] = useState<'active' | 'schedule' | 'history'>('active');
  // Side tabs hide on scroll down, return on scroll up (pulse tab stays).
  const onTabScroll = useHideTabBarOnScroll();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingMedication, setEditingMedication] = useState<Medication | null>(null);
  // Prefilled link when adding a medication from a scanned prescription.
  const [scanSourceDocId, setScanSourceDocId] = useState<string | null>(null);
  const premiumEntitled = usePremiumEntitled();

  // ---- Scanned prescription sessions (local record of scanner runs) ----
  const [scanSessions, setScanSessions] = useState<ScanSession[]>([]);
  const loadScanSessions = useCallback(async () => {
    const patientId = getCachedPatientId();
    if (!patientId) {
      setScanSessions([]);
      return;
    }
    try {
      setScanSessions(await listScanSessions(patientId));
    } catch {
      // Sessions are convenience only — the documents list is unaffected.
    }
  }, []);

  useEffect(() => {
    void loadScanSessions();
  }, [loadScanSessions]);

  // Refresh when coming back from the scanner.
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      void loadScanSessions();
    });
    return unsubscribe;
  }, [navigation, loadScanSessions]);

  const openScanner = useCallback(() => {
    if (!premiumEntitled) {
      Alert.alert(
        'Premium feature',
        'Prescription scanner requires Premium. See Profile > Premium (3 days free).',
        [{ text: 'OK' }],
      );
      return;
    }
    navigation.navigate('PrescriptionScanner');
  }, [navigation, premiumEntitled]);

  const addMedicationFromScan = useCallback((session: ScanSession) => {
    setEditingMedication(null);
    setScanSourceDocId(session.document_ids[0] ?? null);
    setShowAddModal(true);
  }, []);

  const dismissScanSession = useCallback((session: ScanSession) => {
    void deleteScanSession(session.session_id).then(() => loadScanSessions());
  }, [loadScanSessions]);

  const openAdd = useCallback(() => {
    setEditingMedication(null);
    setScanSourceDocId(null);
    setShowAddModal(true);
  }, []);

  // Local calendar day: UTC slicing (toISOString) shifts the day for
  // timezones ahead of UTC and desyncs the schedule from the logger.
  const today = todayKey();

  // Fetch data
  const { data: medications, isLoading: medicationsLoading, refetch: refetchMedications } = useMedications();
  const { data: schedule, isLoading: scheduleLoading, refetch: refetchSchedule } = useMedicationSchedule(today);

  // Filter active medications
  const activeMedications = useMemo(
    () => medications.filter(m => m.status === 'ACTIVE'),
    [medications],
  );

  const todayTaken = useMemo(() => schedule.filter((s) => s.taken).length, [schedule]);
  const todayTotal = schedule.length;
  const todayPct = todayTotal > 0 ? todayTaken / todayTotal : 0;
  const nextDose = useMemo(() => {
    const pending = schedule
      .filter((s) => !s.taken)
      .slice()
      .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));
    return pending[0] ?? null;
  }, [schedule]);

  // Headline + sub mirror the reference rhythm (big centered title,
  // one short helper line). No eyebrow line above the title.
  const sub = nextDose
    ? `Next · ${nextDose.medication.name} at ${formatTime(nextDose.scheduled_time)}`
    : activeMedications.length > 0
      ? 'Tap a tile to edit, pause, or stop.'
      : 'Add your medications to begin.';

  // Handle medication taken — local-first with server reconciliation
  const handleTakeDose = useCallback(async (medication: Medication, scheduledTime: string) => {
    try {
      const patientId = getCachedPatientId();
      if (!patientId) {
        Alert.alert('Error', 'Not authenticated');
        return;
      }

      // Local-first: write to SQLite immediately, then reconcile with server
      const { serverEventId } = await recordMedicationTaken(
        patientId,
        medication.medication_id,
        medication.dose_amount,
        medication.dose_unit,
        scheduledTime,
      );

      // Refresh schedule from local SQLite
      refetchSchedule();

      if (serverEventId) {
        Alert.alert('Saved', 'Dose recorded');
      } else {
        Alert.alert('Saved Locally', 'Dose saved. Will sync when online.');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to record dose');
    }
  }, [refetchSchedule]);

  // Handle medication actions
  const handlePauseMedication = useCallback(async (medication: Medication) => {
    try {
      await api.put(`/api/v1/medications/${medication.medication_id}`, {
        status: 'PAUSED',
      });
      // Mirror the confirmed status locally (queue-free): the list reads
      // the local mirror, which otherwise stays stale until hydration.
      const patientId = getCachedPatientId();
      if (patientId) {
        await dbMarkMedicationStatusLocal(patientId, medication.medication_id, 'PAUSED').catch(
          () => {},
        );
      }
      refetchMedications();
      if (patientId) void reconcileMedicationReminders(patientId);
      Alert.alert('Success', 'Medication paused');
    } catch (error) {
      Alert.alert('Error', 'Failed to pause medication');
    }
  }, [refetchMedications]);

  const handleResumeMedication = useCallback(async (medication: Medication) => {
    try {
      await api.put(`/api/v1/medications/${medication.medication_id}`, {
        status: 'ACTIVE',
      });
      const patientId = getCachedPatientId();
      if (patientId) {
        await dbMarkMedicationStatusLocal(patientId, medication.medication_id, 'ACTIVE').catch(
          () => {},
        );
      }
      refetchMedications();
      if (patientId) void reconcileMedicationReminders(patientId);
      Alert.alert('Success', 'Medication resumed');
    } catch (error) {
      Alert.alert('Error', 'Failed to resume medication');
    }
  }, [refetchMedications]);

  const handleStopMedication = useCallback(async (medication: Medication) => {
    Alert.alert(
      'Stop Medication',
      `Are you sure you want to stop ${medication.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/api/v1/medications/${medication.medication_id}`);
              const patientId = getCachedPatientId();
              if (patientId) {
                await dbMarkMedicationStatusLocal(
                  patientId,
                  medication.medication_id,
                  'DISCONTINUED',
                ).catch(() => {});
              }
              refetchMedications();
              if (patientId) void reconcileMedicationReminders(patientId);
              Alert.alert('Success', 'Medication discontinued');
            } catch (error) {
              Alert.alert('Error', 'Failed to stop medication');
            }
          },
        },
      ],
    );
  }, [refetchMedications]);

  // ── Render ──

  // DEV-ONLY preview entry so the call-like screen can be opened where
  // OS notifications cannot fire (Expo Go). The full Taken/snooze flow
  // runs for real; only the banner, sound and exact timing need a dev
  // build. Stripped from production builds.
  const previewReminder = useCallback(async () => {
    try {
      const patientId = getCachedPatientId();
      if (!patientId) {
        Alert.alert('Error', 'Not authenticated');
        return;
      }
      await reconcileMedicationReminders(patientId).catch(() => {});
      const { listReminderInstancesFrom } = await import(
        '@/db/queries/reminderInstances'
      );
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const rows = await listReminderInstancesFrom(patientId, yesterday.toISOString()).catch(
        () => [],
      );
      const next = rows.find((r) => r.status === 'scheduled');
      if (!next) {
        Alert.alert(
          'No reminder yet',
          'Save a medication with reminders on and daily times first, then preview again.',
        );
        return;
      }
      navigation.navigate('MedicationReminder', { occurrenceId: next.occurrence_id });
    } catch {
      Alert.alert('Error', 'Could not open the reminder preview.');
    }
  }, [navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        onScroll={onTabScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={medicationsLoading || scheduleLoading}
            onRefresh={() => {
              refetchMedications();
              refetchSchedule();
            }}
            tintColor="#FFFFFF"
          />
        }
      >
        {/* Reference hero: big centered title, one helper. */}
        <Text style={styles.headline}>Medications.</Text>
        <Text style={styles.sub} numberOfLines={2}>{sub}</Text>

        {todayTotal > 0 ? (
          <View style={styles.progressWrap} accessibilityLabel={`${todayTaken} of ${todayTotal} doses taken`}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { flex: todayPct }]} />
              <View style={{ flex: Math.max(0, 1 - todayPct) }} />
            </View>
          </View>
        ) : null}

        <NavySegmented
          value={selectedTab}
          onChange={setSelectedTab}
          tabs={[
            { key: 'active', label: `Active · ${activeMedications.length}` },
            { key: 'schedule', label: `Today · ${todayTaken}/${todayTotal}` },
            { key: 'history', label: 'History' },
          ]}
        />

        <View style={styles.actionRow}>
          <Pressable
            onPress={openAdd}
            accessibilityRole="button"
            accessibilityLabel="Add medication"
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.addBtnText}>Add</Text>
          </Pressable>
          <Pressable
            onPress={openScanner}
            accessibilityRole="button"
            accessibilityLabel="Scan prescription pages"
            style={({ pressed }) => [styles.scanBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.scanBtnText}>Scan prescription</Text>
          </Pressable>
        </View>

        {__DEV__ ? (
          <View style={styles.devRow}>
            <Pressable
              onPress={() => void previewReminder()}
              accessibilityRole="button"
              accessibilityLabel="Preview medication reminder (development only)"
              style={styles.devHit}
            >
              <Text style={styles.devText}>Preview reminder</Text>
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('SattsTest')}
              accessibilityRole="button"
              accessibilityLabel="Open isolated sanoTTS voice test (development only)"
              style={styles.devHit}
            >
              <Text style={styles.devText}>Voice test</Text>
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('VoiceTurn')}
              accessibilityRole="button"
              accessibilityLabel="Open isolated turn-based voice test (development only)"
              style={styles.devHit}
            >
              <Text style={styles.devText}>Voice turn</Text>
            </Pressable>
          </View>
        ) : null}

        {scanSessions.length > 0 && (
          <View style={styles.scanCard}>
            <Text style={styles.scanTitle}>Scanned prescriptions</Text>
            {scanSessions.map((session) => (
              <View key={session.session_id} style={styles.scanRow}>
                <View style={styles.scanInfo}>
                  <Text style={styles.scanName}>
                    {session.document_ids.length === 1
                      ? '1 page'
                      : `${session.document_ids.length} pages`}
                    {session.status === 'reviewed' ? ' · reviewed ✓' : ''}
                  </Text>
                  <Text style={styles.scanSub}>{scanStatusCopy(session.status)}</Text>
                </View>
                {session.status !== 'reviewed' && session.document_ids.length > 0 && (
                  <Pressable
                    onPress={() => addMedicationFromScan(session)}
                    accessibilityRole="button"
                    accessibilityLabel="Add medication from this scan"
                    hitSlop={8}
                    style={({ pressed }) => [styles.scanAddBtn, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.scanAddText}>Add med</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => dismissScanSession(session)}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss scanned prescription"
                  hitSlop={8}
                  style={styles.scanDismissBtn}
                >
                  <Text style={styles.scanDismissText}>✕</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {selectedTab === 'active' && (
          <ActiveTilesTab
            medications={activeMedications}
            isLoading={medicationsLoading}
            onAdd={openAdd}
            onEdit={(med) => {
              setEditingMedication(med);
              setShowAddModal(true);
            }}
            onPause={handlePauseMedication}
            onResume={handleResumeMedication}
            onStop={handleStopMedication}
          />
        )}

        {selectedTab === 'schedule' && (
          <ScheduleTab
            schedule={schedule}
            isLoading={scheduleLoading}
            onTakeDose={handleTakeDose}
          />
        )}

        {selectedTab === 'history' && (
          <HistoryTab medications={medications} onResume={handleResumeMedication} />
        )}
      </ScrollView>

      {/* Add/Edit Modal */}
      <AddMedicationModal
        key={editingMedication?.medication_id ?? scanSourceDocId ?? 'new'}
        visible={showAddModal}
        medication={editingMedication}
        sourceDocumentId={scanSourceDocId}
        onClose={() => {
          setShowAddModal(false);
          setEditingMedication(null);
          setScanSourceDocId(null);
        }}
        onSave={() => {
          // Saving from a scan confirms review of every session holding it.
          if (scanSourceDocId) {
            const matched = scanSessions.filter((s) =>
              s.document_ids.includes(scanSourceDocId),
            );
            void Promise.all(
              matched.map((s) => setScanStatus(s.session_id, 'reviewed')),
            ).then(() => loadScanSessions());
          }
          setShowAddModal(false);
          setEditingMedication(null);
          setScanSourceDocId(null);
          refetchMedications();
          refetchSchedule();
          // Save/edit/scan-accept share this path: rebuild reminders from
          // the fresh schedule (idempotent, offline-safe).
          const patientId = getCachedPatientId();
          if (patientId) void reconcileMedicationReminders(patientId);
        }}
      />
    </SafeAreaView>
  );
}

// ── Active tiles tab (reference 2-col grid) ──

function ActiveTilesTab({
  medications,
  isLoading,
  onAdd,
  onEdit,
  onPause,
  onResume,
  onStop,
}: {
  medications: Medication[];
  isLoading: boolean;
  onAdd: () => void;
  onEdit: (med: Medication) => void;
  onPause: (med: Medication) => void;
  onResume: (med: Medication) => void;
  onStop: (med: Medication) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <HealthFact style={styles.medFact} />
      </View>
    );
  }

  if (medications.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>No active medications</Text>
        <Text style={styles.emptyText}>
          Add your medications to track doses and schedules.
        </Text>
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="Add medication"
          style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.addBtnText}>Add medication</Text>
        </Pressable>
      </View>
    );
  }

  const rows: Medication[][] = [];
  for (let i = 0; i < medications.length; i += 2) {
    rows.push(medications.slice(i, i + 2));
  }

  return (
    <View style={styles.grid} accessibilityRole="list">
      {rows.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((med) => {
            const globalIndex = r * 2 + row.indexOf(med);
            return (
              <MedTile
                key={med.medication_id}
                index={globalIndex}
                medication={med}
                fullWidth={row.length === 1}
                expanded={expandedId === med.medication_id}
                onToggle={() => setExpandedId((cur) => (cur === med.medication_id ? null : med.medication_id))}
                onEdit={() => { setExpandedId(null); onEdit(med); }}
                onPause={() => { setExpandedId(null); onPause(med); }}
                onResume={() => { setExpandedId(null); onResume(med); }}
                onStop={() => { setExpandedId(null); onStop(med); }}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ── Schedule Tab (full-width dark tiles, reference radius) ──

function ScheduleTab({
  schedule,
  isLoading,
  onTakeDose,
}: {
  schedule: DailyMedicationSchedule[];
  isLoading: boolean;
  onTakeDose: (medication: Medication, scheduledTime: string) => void;
}) {
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <HealthFact style={styles.medFact} />
      </View>
    );
  }

  if (schedule.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>Nothing scheduled today</Text>
        <Text style={styles.emptyText}>
          Add medications to see your daily schedule.
        </Text>
      </View>
    );
  }

  // Group by time
  const groupedByTime = schedule.reduce((acc, item) => {
    const time = item.scheduled_time;
    if (!acc[time]) acc[time] = [];
    acc[time].push(item);
    return acc;
  }, {} as Record<string, DailyMedicationSchedule[]>);

  const sortedTimes = Object.keys(groupedByTime).sort((a, b) => a.localeCompare(b));

  return (
    <View style={styles.scheduleContainer}>
      {sortedTimes.map((time) => {
        const items = groupedByTime[time];
        const done = items.filter((i) => i.taken).length;
        return (
          <View key={time} style={styles.timeGroup}>
            <View style={styles.timeHead}>
              <Text style={styles.timeTitle}>{formatTime(time)}</Text>
              <Text style={styles.timeCount}>{done}/{items.length} taken</Text>
            </View>
            {items.map((item) => (
              <ScheduleItem
                key={`${item.medication.medication_id}-${item.scheduled_time}`}
                item={item}
                onTakeDose={() => onTakeDose(item.medication as any, item.scheduled_time)}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
}

// ── Schedule Item ──

function ScheduleItem({
  item,
  onTakeDose,
}: {
  item: DailyMedicationSchedule;
  onTakeDose: () => void;
}) {
  const { medication, taken, taken_at } = item;

  return (
    <View style={styles.scheduleItem}>
      <View style={styles.scheduleItemInfo}>
        <Text style={styles.scheduleItemName} numberOfLines={1}>{medication.name}</Text>
        <Text style={styles.scheduleItemDetails} numberOfLines={1}>
          {medication.strength}{medication.strength_unit ? ` ${medication.strength_unit}` : ''}
          {medication.dose_amount ? ` · ${medication.dose_amount}${medication.dose_unit ? ` ${medication.dose_unit}` : ''}` : ''}
        </Text>
      </View>

      {taken ? (
        <View style={styles.takenBadge} accessibilityLabel={`${medication.name} taken`}>
          <View style={styles.takenIcon}>
            <Text style={styles.takenGlyph}>✓</Text>
          </View>
          <View style={styles.takenTexts}>
            <Text style={styles.takenText}>Taken</Text>
            {taken_at && (
              <Text style={styles.takenTime}>
                {new Date(taken_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </Text>
            )}
          </View>
        </View>
      ) : (
        <Pressable
          onPress={onTakeDose}
          accessibilityRole="button"
          accessibilityLabel={`Take ${medication.name}`}
          hitSlop={4}
          style={({ pressed }) => [styles.takeBtn, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.takeBtnText}>Take</Text>
        </Pressable>
      )}
    </View>
  );
}

// ── History Tab ──

function HistoryTab({ medications, onResume }: { medications: Medication[]; onResume: (med: Medication) => void }) {
  const [selectedMedication, setSelectedMedication] = useState<string | null>(null);
  const { data: history, isLoading } = useMedicationTakenEvents(selectedMedication || '');
  const pausedMeds = useMemo(() => medications.filter((m) => m.status === 'PAUSED'), [medications]);

  if (medications.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>No history yet</Text>
        <Text style={styles.emptyText}>
          Add medications to track your history.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.historyContainer}>
      {pausedMeds.length > 0 ? (
        <View style={styles.historyCard}>
          <Text style={styles.pausedTitle}>Paused · resume anytime</Text>
          {pausedMeds.map((med) => (
            <View key={med.medication_id} style={styles.historyItem}>
              <View style={styles.historyItemInfo}>
                <Text style={styles.historyItemName} numberOfLines={1}>{med.name}</Text>
                <Text style={styles.historyItemDate}>Paused</Text>
              </View>
              <Pressable
                onPress={() => onResume(med)}
                accessibilityRole="button"
                accessibilityLabel={`Resume ${med.name}`}
                hitSlop={4}
                style={({ pressed }) => [styles.takeBtn, pressed && { opacity: 0.8 }]}
              >
                <Text style={styles.takeBtnText}>Resume</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.pickerRow}>
          <Chip
            label="All"
            size="large"
            selected={!selectedMedication}
            onPress={() => setSelectedMedication(null)}
            accessibilityLabel="Show all medication history"
          />
          {medications.map((med) => (
            <Chip
              key={med.medication_id}
              label={med.name}
              size="large"
              selected={selectedMedication === med.medication_id}
              onPress={() => setSelectedMedication(med.medication_id)}
              accessibilityLabel={`Show history for ${med.name}`}
            />
          ))}
        </View>
      </ScrollView>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <HealthFact style={styles.medFact} />
        </View>
      ) : history.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>No dose history recorded.</Text>
        </View>
      ) : (
        <View style={styles.historyCard}>
          {history.map((event) => (
            <HistoryItem key={event.event_id} event={event} medications={medications} />
          ))}
        </View>
      )}
    </View>
  );
}

// ── History Item ──

function HistoryItem({
  event,
  medications,
}: {
  event: MedicationTakenEvent;
  medications: Medication[];
}) {
  const medication = medications.find(m => m.medication_id === event.medication_id);
  const statusDot = event.status === 'TAKEN' ? GV.fx.green :
    event.status === 'MISSED' ? GV.muted : GV.fx.amber;

  return (
    <View style={styles.historyItem}>
      <View style={styles.historyItemInfo}>
        <Text style={styles.historyItemName} numberOfLines={1}>{medication?.name || 'Unknown'}</Text>
        <Text style={styles.historyItemDate}>
          {new Date(event.taken_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {' at '}
          {new Date(event.taken_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </Text>
      </View>
      <View style={styles.historyStatus}>
        <View style={[styles.statusDotSm, { backgroundColor: statusDot }]} />
        <Text style={styles.historyStatusText}>
          {event.status}
        </Text>
      </View>
    </View>
  );
}

// ── Add/Edit Medication Modal (sheet over navy; white wells like Chat) ──

function AddMedicationModal({
  visible,
  medication,
  sourceDocumentId,
  onClose,
  onSave,
}: {
  visible: boolean;
  medication: Medication | null;
  /** Set when adding from a scanned prescription — linked, never auto-filled. */
  sourceDocumentId?: string | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [name, setName] = useState(medication?.name || '');
  const [genericName, setGenericName] = useState(medication?.generic_name || '');
  const [brandName, setBrandName] = useState(medication?.brand_name || '');
  const [strength, setStrength] = useState(medication?.strength || '');
  const [strengthUnit, setStrengthUnit] = useState(medication?.strength_unit || '');
  const [doseAmount, setDoseAmount] = useState(medication?.dose_amount?.toString() || '');
  const [doseUnit, setDoseUnit] = useState(medication?.dose_unit || '');
  const [route, setRoute] = useState<MedicationRoute | ''>(medication?.route || '');
  const [frequency, setFrequency] = useState<MedicationFrequency>(medication?.frequency || 'ONCE_DAILY');
  const [scheduledTimes, setScheduledTimes] = useState(medication?.scheduled_times?.join(', ') || '');
  const [startDate, setStartDate] = useState(medication?.start_date || '');
  const [endDate, setEndDate] = useState(medication?.end_date || '');
  const [purpose, setPurpose] = useState(medication?.purpose || '');
  const [instructions, setInstructions] = useState(medication?.instructions || '');
  const [prescriber, setPrescriber] = useState(medication?.prescriber || '');
  const [prn, setPrn] = useState(medication?.prn || false);
  const [reminderEnabled, setReminderEnabled] = useState(medication?.reminder_enabled || false);
  const [notes, setNotes] = useState(medication?.notes || '');
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Medication name is required');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        generic_name: genericName.trim() || null,
        brand_name: brandName.trim() || null,
        strength: strength.trim() || null,
        strength_unit: strengthUnit.trim() || null,
        dose_amount: doseAmount ? parseFloat(doseAmount) : null,
        dose_unit: doseUnit.trim() || null,
        route: route || null,
        frequency,
        scheduled_times: scheduledTimes ? scheduledTimes.split(',').map(t => t.trim()).filter(Boolean) : null,
        start_date: startDate || null,
        end_date: endDate || null,
        purpose: purpose.trim() || null,
        instructions: instructions.trim() || null,
        prescriber: prescriber.trim() || null,
        prn,
        reminder_enabled: reminderEnabled,
        notes: notes.trim() || null,
        source_document_id: sourceDocumentId ?? medication?.source_document_id ?? null,
      };

      let saved: Medication | null = null;
      if (medication) {
        saved = await api.put<Medication>(
          `/api/v1/medications/${medication.medication_id}`,
          payload,
        );
      } else {
        saved = await api.post<Medication>('/api/v1/medications', payload);
      }

      // Mirror the server-confirmed row locally (hydration marks it
      // synced, never queued): the list reads this mirror, so without
      // this a new medication stays invisible until a full hydration.
      const patientId = getCachedPatientId();
      if (patientId && saved && typeof saved.medication_id === 'string') {
        await dbHydrateMedications(patientId, [saved]).catch(() => {});
      }

      // Moment-of-intent permission: only when reminders were just switched
      // on with actual times (never on mount, never on cold start), and
      // only where the runtime can actually deliver (never in Expo Go).
      if (reminderEnabled && scheduledTimes.trim() && isReminderRuntimeSupported()) {
        const granted = await requestReminderPermissions().catch(() => false);
        if (!granted) {
          Alert.alert(
            'Notifications off',
            'The medication was saved, but reminders cannot fire until notifications are allowed in system settings.',
          );
        }
      }

      onSave();
    } catch (error) {
      Alert.alert('Error', 'Failed to save medication');
    } finally {
      setSaving(false);
    }
  }, [name, genericName, brandName, strength, strengthUnit, doseAmount, doseUnit, route, frequency, scheduledTimes, startDate, endDate, purpose, instructions, prescriber, prn, reminderEnabled, notes, medication, sourceDocumentId, onSave]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView
        style={styles.modalContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose} style={styles.modalCancelBtn} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={styles.modalCancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.modalTitle}>{medication ? 'Edit Medication' : 'Add Medication'}</Text>
          <Button
            title={saving ? 'Saving...' : 'Save'}
            onPress={() => void handleSave()}
            size="small"
            disabled={saving}
            accessibilityLabel="Save medication"
          />
        </View>
        {sourceDocumentId && !medication ? (
          <Text style={styles.scanLinkHint}>Linked to your scanned prescription. Review each field before saving.</Text>
        ) : null}

        <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentContainer}>
          <Card style={styles.fieldCard}>
            <Input
              label="Medication Name *"
              value={name}
              onChangeText={setName}
              placeholder="e.g., AMTIVA"
            />
          </Card>

          <Card style={styles.fieldCard}>
            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Input
                  label="Generic Name"
                  value={genericName}
                  onChangeText={setGenericName}
                  placeholder="e.g., amlodipine"
                />
              </View>
              <View style={styles.fieldHalf}>
                <Input
                  label="Brand Name"
                  value={brandName}
                  onChangeText={setBrandName}
                  placeholder="e.g., Norvasc"
                />
              </View>
            </View>
          </Card>

          <Card style={styles.fieldCard}>
            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Input
                  label="Strength"
                  value={strength}
                  onChangeText={setStrength}
                  placeholder="e.g., 5"
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.fieldHalf}>
                <Input
                  label="Strength Unit"
                  value={strengthUnit}
                  onChangeText={setStrengthUnit}
                  placeholder="e.g., mg"
                />
              </View>
            </View>
          </Card>

          <Card style={styles.fieldCard}>
            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Input
                  label="Dose Amount"
                  value={doseAmount}
                  onChangeText={setDoseAmount}
                  placeholder="e.g., 1"
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.fieldHalf}>
                <Input
                  label="Dose Unit"
                  value={doseUnit}
                  onChangeText={setDoseUnit}
                  placeholder="e.g., tablet"
                />
              </View>
            </View>
          </Card>

          <Card style={styles.fieldCard}>
            <Text style={styles.fieldLabel}>Route</Text>
            <Text style={styles.fieldHint}>
              How this medicine is taken. Review it before saving.
            </Text>
            <View style={styles.frequencyWrap}>
              {(Object.keys(ROUTE_LABELS) as MedicationRoute[]).map((r) => (
                <Chip
                  key={r}
                  label={ROUTE_LABELS[r]}
                  size="large"
                  selected={route === r}
                  onPress={() => setRoute((prev) => (prev === r ? '' : r))}
                  accessibilityLabel={`Route ${ROUTE_LABELS[r]}`}
                />
              ))}
            </View>
          </Card>

          <Card style={styles.fieldCard}>
            <Text style={styles.fieldLabel}>Frequency</Text>
            <View style={styles.frequencyWrap}>
              {(Object.keys(FREQUENCY_LABELS) as MedicationFrequency[]).map((freq) => (
                <Chip
                  key={freq}
                  label={FREQUENCY_LABELS[freq]}
                  size="large"
                  selected={frequency === freq}
                  onPress={() => setFrequency(freq)}
                  accessibilityLabel={`Frequency ${FREQUENCY_LABELS[freq]}`}
                />
              ))}
            </View>
          </Card>

          <Card style={styles.fieldCard}>
            <Input
              label="Scheduled Times (comma-separated)"
              value={scheduledTimes}
              onChangeText={setScheduledTimes}
              placeholder="e.g., 08:00, 20:00"
            />
          </Card>

          <Card style={styles.fieldCard}>
            <Text style={styles.fieldLabel}>Reminders</Text>
            <Text style={styles.fieldHint}>Alerts fire at the times above.</Text>
            <View style={styles.toggleRow}>
              <Chip
                label="PRN (As needed)"
                size="large"
                selected={prn}
                onPress={() => setPrn(!prn)}
                accessibilityLabel="Toggle as needed"
              />
              <Chip
                label="Enable Reminders"
                size="large"
                selected={reminderEnabled}
                onPress={() => setReminderEnabled(!reminderEnabled)}
                accessibilityLabel="Toggle reminders"
              />
            </View>
          </Card>

          <Card style={styles.fieldCard}>
            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Input
                  label="Start Date"
                  value={startDate}
                  onChangeText={setStartDate}
                  placeholder="YYYY-MM-DD"
                />
              </View>
              <View style={styles.fieldHalf}>
                <Input
                  label="End Date"
                  value={endDate}
                  onChangeText={setEndDate}
                  placeholder="YYYY-MM-DD"
                />
              </View>
            </View>
          </Card>

          <Card style={styles.fieldCard}>
            <Input
              label="Purpose"
              value={purpose}
              onChangeText={setPurpose}
              placeholder="e.g., Blood pressure control"
            />
          </Card>

          <Card style={styles.fieldCard}>
            <Input
              label="Instructions"
              value={instructions}
              onChangeText={setInstructions}
              placeholder="e.g., Take with food"
              multiline
              numberOfLines={3}
            />
          </Card>

          <Card style={styles.fieldCard}>
            <Input
              label="Prescriber"
              value={prescriber}
              onChangeText={setPrescriber}
              placeholder="e.g., Dr. Smith"
            />
          </Card>

          <Card style={styles.fieldCard}>
            <Input
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Additional notes..."
              multiline
              numberOfLines={3}
            />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── STYLES — GoalsStep reference system ─────────────────────────────────
// Backdrop #20263D. Tiles radius 8 with duotone art + black 0.22.
// Header centered: overline teal / headline white 32 / sub fog.
// Pills only for segmented + buttons. Times tabular-nums.

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NAVY,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 40,
    gap: 12,
  },
  headline: {
    fontFamily: FONT.semi,
    fontSize: 32,
    lineHeight: 38,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  sub: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
    alignSelf: 'center',
    maxWidth: 330,
    fontVariant: ['tabular-nums'],
  },
  progressWrap: {
    alignItems: 'center',
    paddingTop: 2,
  },
  progressTrack: {
    flexDirection: 'row',
    width: 160,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
  },
  segmentTrack: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 9999,
    padding: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: HAIRLINE_ON_NAVY,
    marginTop: 4,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  segmentSelected: {
    backgroundColor: '#FFFFFF',
  },
  segmentText: {
    fontFamily: FONT.semi,
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(255, 255, 255, 0.75)',
  },
  segmentTextSelected: {
    color: NAVY,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  addBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  addBtnText: {
    fontFamily: FONT.semi,
    fontSize: 15,
    lineHeight: 20,
    color: NAVY,
  },
  scanBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 9999,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  scanBtnText: {
    fontFamily: FONT.semi,
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  devRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'center',
  },
  devHit: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  devText: {
    fontFamily: FONT.regular,
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  scanCard: {
    backgroundColor: TILE_BG,
    borderRadius: 8,
    padding: 16,
    gap: 4,
    borderWidth: 1,
    borderColor: HAIRLINE_ON_NAVY,
  },
  scanTitle: {
    fontFamily: FONT.semi,
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
    marginBottom: 4,
  },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE_ON_NAVY,
  },
  scanInfo: {
    flex: 1,
    gap: 2,
  },
  scanName: {
    fontFamily: FONT.semi,
    fontSize: 14,
    lineHeight: 18,
    color: '#FFFFFF',
  },
  scanSub: {
    fontFamily: FONT.regular,
    fontSize: 12,
    lineHeight: 16,
    color: GV.fog,
  },
  scanAddBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: GV.teal,
  },
  scanAddText: {
    fontFamily: FONT.semi,
    fontSize: 13,
    lineHeight: 18,
    color: GV.teal,
  },
  scanDismissBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanDismissText: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  scanLinkHint: {
    ...TYPE.caption,
    color: GV.teal,
    paddingHorizontal: 24,
    paddingTop: 8,
    textAlign: 'center',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    minHeight: 120,
    gap: 12,
  },
  medFact: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    maxWidth: 300,
  },
  // Reference grid — each cell is a relative wrap so the action
  // menu can float ABOVE its own tile without resizing it.
  grid: {
    gap: 12,
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  tileWrap: {
    flex: 1,
    position: 'relative',
  },
  tileWrapFull: {
    flex: 1,
  },
  tileWrapOpen: {
    zIndex: 10,
    elevation: 8,
  },
  // Menu sits directly ON the tile (zero gap): full-cover dim
  // overlay with the three actions centered on the box.
  tileOverlay: {
    position: 'absolute',
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(10, 14, 30, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  popoverMenu: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    gap: 2,
  },
  popoverBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  popoverBtnText: {
    fontFamily: FONT.semi,
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
  },
  tile: {
    width: '100%',
    aspectRatio: 1.5,
    borderRadius: 8,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: TILE_BG,
    paddingHorizontal: 10,
    paddingVertical: 12,
    gap: 2,
  },
  tileFull: {
    aspectRatio: undefined,
    minHeight: 112,
  },
  tileOn: {
    borderColor: GV.teal,
  },
  statusDot: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tileLabel: {
    fontFamily: FONT.medium,
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
    textAlign: 'center',
    paddingHorizontal: 6,
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  tileMeta: {
    fontFamily: FONT.regular,
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  emptyWrap: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 24,
  },
  emptyTitle: {
    fontFamily: FONT.semi,
    fontSize: 18,
    lineHeight: 24,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  emptyText: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
    maxWidth: 300,
    marginBottom: 8,
  },
  scheduleContainer: {
    gap: 12,
    marginTop: 4,
  },
  timeGroup: {
    backgroundColor: TILE_BG,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: HAIRLINE_ON_NAVY,
  },
  timeHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 4,
    gap: 8,
  },
  timeTitle: {
    fontFamily: FONT.semi,
    fontSize: 18,
    lineHeight: 24,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  timeCount: {
    fontFamily: FONT.regular,
    fontSize: 13,
    lineHeight: 18,
    color: GV.fog,
    fontVariant: ['tabular-nums'],
  },
  scheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 12,
    minHeight: 56,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE_ON_NAVY,
  },
  scheduleItemInfo: {
    flex: 1,
    gap: 2,
  },
  scheduleItemName: {
    fontFamily: FONT.semi,
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  scheduleItemDetails: {
    fontFamily: FONT.regular,
    fontSize: 12,
    lineHeight: 16,
    color: GV.fog,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  takenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
  },
  takenIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: GV.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  takenGlyph: {
    color: '#06231B',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
  takenTexts: {
    alignItems: 'flex-start',
  },
  takenText: {
    fontFamily: FONT.semi,
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
  },
  takenTime: {
    fontFamily: FONT.regular,
    fontSize: 12,
    lineHeight: 16,
    color: GV.fog,
    fontVariant: ['tabular-nums'],
  },
  takeBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
  },
  takeBtnText: {
    fontFamily: FONT.semi,
    fontSize: 14,
    lineHeight: 18,
    color: NAVY,
  },
  historyContainer: {
    gap: 12,
    marginTop: 4,
  },
  pickerRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 8,
  },
  historyCard: {
    backgroundColor: TILE_BG,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: HAIRLINE_ON_NAVY,
  },
  pausedTitle: {
    fontFamily: FONT.semi,
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
    marginBottom: 4,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 12,
    minHeight: 56,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE_ON_NAVY,
  },
  historyItemInfo: {
    flex: 1,
    gap: 2,
  },
  historyItemName: {
    fontFamily: FONT.semi,
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  historyItemDate: {
    fontFamily: FONT.regular,
    fontSize: 12,
    lineHeight: 16,
    color: GV.fog,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  historyStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDotSm: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  historyStatusText: {
    fontFamily: FONT.semi,
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: NAVY,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 8,
    minHeight: 56,
  },
  modalCancelBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  modalCancel: {
    ...TYPE.body,
    color: GV.fog,
  },
  modalTitle: {
    ...TYPE.title,
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
  },
  modalContent: {
    flex: 1,
  },
  modalContentContainer: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 12,
  },
  fieldCard: {
    backgroundColor: GV.card,
    borderRadius: 8,
    padding: 16,
  },
  fieldLabel: {
    ...TYPE.button,
    fontSize: 15,
    color: GV.ink,
    marginBottom: 4,
  },
  fieldHint: {
    ...TYPE.caption,
    color: GV.muted,
    marginBottom: 8,
    lineHeight: 18,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 8,
  },
  fieldHalf: {
    flex: 1,
  },
  frequencyWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});
