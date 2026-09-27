/**
 * MedicationsScreen — Manage medications, view schedule, record taken events.
 *
 * Provides:
 * - List of active medications
 * - Add/Edit medication form
 * - Daily schedule view
 * - Record medication taken
 * - Medication history
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
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { TILE_TONES } from '@/theme/tones';
import { StageGradient } from '@/components/StageGradient';
void FONT;
import { Button, Card, Chip, Input, SectionHeader } from '@/components';
import { HealthFact } from '@/components/HealthFact';
import type { Medication, MedicationFrequency, MedicationRoute, MedicationStatus, DailyMedicationSchedule, MedicationTakenEvent } from '@/types';
import type { RootStackParamList } from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

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

// ── Status dot hues — small flat icons inside white cards only ──
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

  // Get today's date for schedule
  const today = new Date().toISOString().split('T')[0];

  // Fetch data
  const { data: medications, isLoading: medicationsLoading, refetch: refetchMedications } = useMedications();
  const { data: schedule, isLoading: scheduleLoading, refetch: refetchSchedule } = useMedicationSchedule(today);

  // Filter active medications
  const activeMedications = useMemo(
    () => medications.filter(m => m.status === 'ACTIVE'),
    [medications],
  );

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
      <StageGradient />
      <Text style={styles.title}>Medications</Text>
      <Text style={styles.subtitle}>Track doses and daily schedules.</Text>

      <View style={styles.addWrap}>
        <Button
          title="Add"
          onPress={() => {
            setEditingMedication(null);
            setScanSourceDocId(null);
            setShowAddModal(true);
          }}
          accessibilityLabel="Add medication"
        />
        <Button
          title="Scan prescription"
          variant="outline"
          onPress={openScanner}
          accessibilityLabel="Scan prescription pages"
        />
      </View>

      {__DEV__ ? (
        <View style={styles.addWrap}>
          <Button
            title="Preview reminder"
            variant="ghost"
            onPress={() => void previewReminder()}
            accessibilityLabel="Preview medication reminder (development only)"
          />
          <Button
            title="Voice test (sanoTTS, isolated)"
            variant="ghost"
            onPress={() => navigation.navigate('SattsTest')}
            accessibilityLabel="Open isolated sanoTTS voice test (development only)"
          />
          <Button
            title="Voice turn test (isolated)"
            variant="ghost"
            onPress={() => navigation.navigate('VoiceTurn')}
            accessibilityLabel="Open isolated turn-based voice test (development only)"
          />
        </View>
      ) : null}

      {scanSessions.length > 0 && (
        <Card style={styles.scanCard}>
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
                  style={styles.scanAddBtn}
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
        </Card>
      )}

      <Card style={styles.tabCard}>
        <View style={styles.tabRow}>
          <Chip
            label={`Active (${activeMedications.length})`}
            size="large"
            selected={selectedTab === 'active'}
            onPress={() => setSelectedTab('active')}
            accessibilityLabel="Show active medications"
          />
          <Chip
            label="Today's Schedule"
            size="large"
            selected={selectedTab === 'schedule'}
            onPress={() => setSelectedTab('schedule')}
            accessibilityLabel="Show today's schedule"
          />
          <Chip
            label="History"
            size="large"
            selected={selectedTab === 'history'}
            onPress={() => setSelectedTab('history')}
            accessibilityLabel="Show medication history"
          />
        </View>
      </Card>

      {/* Content */}
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
            tintColor={GV.cta}
          />
        }
      >
        {selectedTab === 'active' && (
          <ActiveMedicationsTab
            medications={activeMedications}
            isLoading={medicationsLoading}
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
          <HistoryTab medications={medications} />
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

// ── Active Medications Tab ──

function ActiveMedicationsTab({
  medications,
  isLoading,
  onEdit,
  onPause,
  onResume,
  onStop,
}: {
  medications: Medication[];
  isLoading: boolean;
  onEdit: (med: Medication) => void;
  onPause: (med: Medication) => void;
  onResume: (med: Medication) => void;
  onStop: (med: Medication) => void;
}) {
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={GV.cta} />
        <HealthFact style={styles.medFact} />
      </View>
    );
  }

  if (medications.length === 0) {
    return (
      <Card style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>No Active Medications</Text>
        <Text style={styles.emptyText}>
          Add your medications to track doses and schedules.
        </Text>
      </Card>
    );
  }

  return (
    <View style={styles.medicationsList}>
      {medications.map((medication) => (
        <MedicationCard
          key={medication.medication_id}
          medication={medication}
          onEdit={() => onEdit(medication)}
          onPause={() => onPause(medication)}
          onResume={() => onResume(medication)}
          onStop={() => onStop(medication)}
        />
      ))}
    </View>
  );
}

// ── Medication Card ──

function MedicationCard({
  medication,
  onEdit,
  onPause,
  onResume,
  onStop,
}: {
  medication: Medication;
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const [showActions, setShowActions] = useState(false);

  const statusDot = STATUS_DOTS[medication.status];
  const frequencyLabel = FREQUENCY_LABELS[medication.frequency] || medication.frequency;

  return (
    <Card style={styles.medicationCard}>
      <Pressable
        style={styles.medicationHeader}
        onPress={() => setShowActions(!showActions)}
        accessibilityRole="button"
        accessibilityLabel={`${medication.name} details`}
        accessibilityState={{ expanded: showActions }}
      >
        <View style={styles.medicationInfo}>
          <View style={styles.medicationNameRow}>
            <View style={[styles.statusDot, { backgroundColor: statusDot }]} />
            <Text style={styles.medicationName}>{medication.name}</Text>
            <Text style={styles.statusText}>
              {getStatusLabel(medication.status)}
            </Text>
          </View>

          <View style={styles.medicationDetails}>
            {medication.strength && (
              <Text style={styles.medicationDetail}>
                {medication.strength}{medication.strength_unit ? ` ${medication.strength_unit}` : ''}
              </Text>
            )}
            {medication.dose_amount && (
              <Text style={styles.medicationDetail}>
                {medication.dose_amount}{medication.dose_unit ? ` ${medication.dose_unit}` : ''}
              </Text>
            )}
            <Text style={styles.medicationDetail}>{frequencyLabel}</Text>
          </View>

          {medication.scheduled_times && medication.scheduled_times.length > 0 && (
            <View style={styles.scheduleRow}>
              <Text style={styles.scheduleLabel}>Schedule:</Text>
              <Text style={styles.scheduleTimes}>
                {medication.scheduled_times.map(formatTime).join(', ')}
              </Text>
            </View>
          )}

          {medication.start_date && (
            <View style={styles.dateRow}>
              <Text style={styles.dateLabel}>Started:</Text>
              <Text style={styles.dateValue}>{formatDate(medication.start_date)}</Text>
              {medication.end_date && (
                <>
                  <Text style={styles.dateSeparator}>→</Text>
                  <Text style={styles.dateValue}>{formatDate(medication.end_date)}</Text>
                </>
              )}
            </View>
          )}
        </View>

        <Text style={styles.chevron}>{showActions ? '‹' : '›'}</Text>
      </Pressable>

      {showActions && (
        <View style={styles.medicationActions}>
          <Chip label="Edit" size="large" selected={false} onPress={onEdit} accessibilityLabel={`Edit ${medication.name}`} />

          {medication.status === 'ACTIVE' ? (
            <Chip label="Pause" size="large" selected={false} onPress={onPause} accessibilityLabel={`Pause ${medication.name}`} />
          ) : medication.status === 'PAUSED' ? (
            <Chip label="Resume" size="large" selected={false} onPress={onResume} accessibilityLabel={`Resume ${medication.name}`} />
          ) : null}

          <Chip label="Stop" size="large" selected={false} onPress={onStop} accessibilityLabel={`Stop ${medication.name}`} />
        </View>
      )}
    </Card>
  );
}

// ── Schedule Tab ──

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
        <ActivityIndicator size="large" color={GV.cta} />
        <HealthFact style={styles.medFact} />
      </View>
    );
  }

  if (schedule.length === 0) {
    return (
      <Card style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>No Medications Scheduled</Text>
        <Text style={styles.emptyText}>
          Add medications to see your daily schedule.
        </Text>
      </Card>
    );
  }

  // Group by time
  const groupedByTime = schedule.reduce((acc, item) => {
    const time = item.scheduled_time;
    if (!acc[time]) acc[time] = [];
    acc[time].push(item);
    return acc;
  }, {} as Record<string, DailyMedicationSchedule[]>);

  return (
    <View style={styles.scheduleContainer}>
      {Object.entries(groupedByTime).map(([time, items]) => (
        <Card key={time} style={styles.timeGroupCard}>
          <SectionHeader title={formatTime(time)} />
          {items.map((item) => (
            <ScheduleItem
              key={`${item.medication.medication_id}-${item.scheduled_time}`}
              item={item}
              onTakeDose={() => onTakeDose(item.medication as any, item.scheduled_time)}
            />
          ))}
        </Card>
      ))}
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
        <Text style={styles.scheduleItemName}>{medication.name}</Text>
        <Text style={styles.scheduleItemDetails}>
          {medication.strength}{medication.strength_unit ? ` ${medication.strength_unit}` : ''}
          {medication.dose_amount ? ` • ${medication.dose_amount}${medication.dose_unit ? ` ${medication.dose_unit}` : ''}` : ''}
        </Text>
      </View>

      {taken ? (
        <View style={styles.takenBadge}>
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
        <Button title="Take" onPress={onTakeDose} size="small" accessibilityLabel={`Take ${medication.name}`} />
      )}
    </View>
  );
}

// ── History Tab ──

function HistoryTab({ medications }: { medications: Medication[] }) {
  const [selectedMedication, setSelectedMedication] = useState<string | null>(null);
  const { data: history, isLoading } = useMedicationTakenEvents(selectedMedication || '');

  if (medications.length === 0) {
    return (
      <Card style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>No Medication History</Text>
        <Text style={styles.emptyText}>
          Add medications to track your history.
        </Text>
      </Card>
    );
  }

  return (
    <View style={styles.historyContainer}>
      <Card style={styles.pickerCard}>
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
      </Card>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={GV.cta} />
          <HealthFact style={styles.medFact} />
        </View>
      ) : history.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyText}>No dose history recorded.</Text>
        </Card>
      ) : (
        <Card style={styles.historyCard}>
          {history.map((event) => (
            <HistoryItem key={event.event_id} event={event} medications={medications} />
          ))}
        </Card>
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
        <Text style={styles.historyItemName}>{medication?.name || 'Unknown'}</Text>
        <Text style={styles.historyItemDate}>
          {new Date(event.taken_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {' at '}
          {new Date(event.taken_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </Text>
      </View>
      <View style={styles.historyStatus}>
        <View style={[styles.statusDot, { backgroundColor: statusDot }]} />
        <Text style={styles.historyStatusText}>
          {event.status}
        </Text>
      </View>
    </View>
  );
}

// ── Add/Edit Medication Modal ──

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
          {sourceDocumentId && !medication ? (
            <Text style={styles.scanLinkHint}>Linked to your scanned prescription. Review each field before saving.</Text>
          ) : null}
          <Button
            title={saving ? 'Saving...' : 'Save'}
            onPress={() => void handleSave()}
            size="small"
            disabled={saving}
            accessibilityLabel="Save medication"
          />
        </View>

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
                  color={TILE_TONES.weight[0]}
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
                  color={TILE_TONES.discipline[0]}
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

// ── STYLES ──

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GV.stage,
  },
  title: {
    ...TYPE.display,
    color: GV.card,
    textAlign: 'center',
    marginTop: 8,
  },
  subtitle: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
    marginBottom: 8,
  },
  addWrap: {
    paddingHorizontal: SPACE.screenH,
    marginBottom: SPACE.cardGap,
    flexDirection: 'row',
    gap: 8,
  },
  scanCard: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
    marginHorizontal: SPACE.screenH,
    marginBottom: SPACE.cardGap,
    gap: 12,
  },
  scanTitle: {
    ...TYPE.title,
    color: GV.ink,
  },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scanInfo: {
    flex: 1,
    gap: 2,
  },
  scanName: {
    ...TYPE.body,
    fontFamily: FONT.semi,
    color: GV.ink,
  },
  scanSub: {
    ...TYPE.caption,
    color: GV.muted,
  },
  scanAddBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GV.cta,
  },
  scanAddText: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    color: GV.cta,
  },
  scanDismissBtn: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanDismissText: {
    ...TYPE.body,
    color: GV.muted,
  },
  scanLinkHint: {
    ...TYPE.caption,
    color: GV.cta,
    marginTop: 4,
  },
  tabCard: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
    marginHorizontal: SPACE.screenH,
    marginBottom: SPACE.cardGap,
  },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: SPACE.screenH,
    paddingBottom: 40,
    gap: SPACE.cardGap,
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
    color: GV.muted,
    textAlign: 'center',
    maxWidth: 300,
  },
  emptyCard: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    ...TYPE.title,
    color: GV.ink,
    textAlign: 'center',
  },
  emptyText: {
    ...TYPE.body,
    color: GV.body,
    textAlign: 'center',
  },
  medicationsList: {
    gap: SPACE.cardGap,
  },
  medicationCard: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
  },
  medicationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  medicationInfo: {
    flex: 1,
  },
  medicationNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  medicationName: {
    ...TYPE.title,
    color: GV.ink,
    flex: 1,
  },
  statusText: {
    ...TYPE.chip,
    color: GV.muted,
    textTransform: 'uppercase',
  },
  medicationDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  medicationDetail: {
    ...TYPE.body,
    color: GV.body,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  scheduleLabel: {
    ...TYPE.caption,
    color: GV.muted,
  },
  scheduleTimes: {
    ...TYPE.body,
    color: GV.body,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  dateLabel: {
    ...TYPE.caption,
    color: GV.muted,
  },
  dateValue: {
    ...TYPE.body,
    color: GV.body,
  },
  dateSeparator: {
    ...TYPE.body,
    color: GV.muted,
  },
  chevron: {
    ...TYPE.title,
    color: GV.muted,
    minWidth: 44,
    textAlign: 'center',
  },
  medicationActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: GV.line,
  },
  scheduleContainer: {
    gap: SPACE.cardGap,
  },
  timeGroupCard: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
    gap: 0,
  },
  scheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 12,
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: GV.line,
  },
  scheduleItemInfo: {
    flex: 1,
  },
  scheduleItemName: {
    ...TYPE.button,
    color: GV.ink,
  },
  scheduleItemDetails: {
    ...TYPE.caption,
    color: GV.body,
    marginTop: 2,
  },
  takenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
  },
  takenIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: GV.fx.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  takenGlyph: {
    ...TYPE.chip,
    color: GV.card,
  },
  takenTexts: {
    alignItems: 'flex-start',
  },
  takenText: {
    ...TYPE.chip,
    color: GV.body,
  },
  takenTime: {
    ...TYPE.caption,
    color: GV.muted,
  },
  historyContainer: {
    gap: SPACE.cardGap,
  },
  pickerCard: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
  },
  pickerRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 8,
  },
  historyCard: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 12,
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: GV.line,
  },
  historyItemInfo: {
    flex: 1,
  },
  historyItemName: {
    ...TYPE.button,
    color: GV.ink,
  },
  historyItemDate: {
    ...TYPE.caption,
    color: GV.muted,
    marginTop: 2,
  },
  historyStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  historyStatusText: {
    ...TYPE.chip,
    color: GV.body,
    textTransform: 'uppercase',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: GV.stage,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: SPACE.screenH,
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
    color: GV.card,
    flex: 1,
    textAlign: 'center',
  },
  modalContent: {
    flex: 1,
  },
  modalContentContainer: {
    paddingHorizontal: SPACE.screenH,
    paddingBottom: 40,
    gap: SPACE.cardGap,
  },
  fieldCard: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
  },
  fieldLabel: {
    ...TYPE.caption,
    color: GV.muted,
    marginBottom: 8,
  },
  fieldHint: {
    ...TYPE.caption,
    color: GV.muted,
    marginBottom: 8,
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
