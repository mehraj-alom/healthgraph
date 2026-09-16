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

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TextInput,
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
import { api } from '@/services/api';
import { COLORS, SPACING, BORDER_RADIUS, TYPOGRAPHY } from '@/constants';
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

// ── Status colors ──
const STATUS_COLORS: Record<MedicationStatus, string> = {
  ACTIVE: COLORS.green,
  SCHEDULED: COLORS.accent,
  COMPLETED: COLORS.textMuted,
  PAUSED: COLORS.warning,
  DISCONTINUED: COLORS.error,
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

// ── MAIN COMPONENT ──

export default function MedicationsScreen() {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const [selectedTab, setSelectedTab] = useState<'active' | 'schedule' | 'history'>('active');
  // Side tabs hide on scroll down, return on scroll up (pulse tab stays).
  const onTabScroll = useHideTabBarOnScroll();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingMedication, setEditingMedication] = useState<Medication | null>(null);

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
        Alert.alert('Success', 'Dose recorded successfully');
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
      refetchMedications();
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
      refetchMedications();
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
              refetchMedications();
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Medications</Text>
        <Pressable
          style={styles.addButton}
          onPress={() => {
            setEditingMedication(null);
            setShowAddModal(true);
          }}
        >
          <Text style={styles.addButtonText}>+ Add</Text>
        </Pressable>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tab, selectedTab === 'active' && styles.tabActive]}
          onPress={() => setSelectedTab('active')}
        >
          <Text style={[styles.tabText, selectedTab === 'active' && styles.tabTextActive]}>
            Active ({activeMedications.length})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, selectedTab === 'schedule' && styles.tabActive]}
          onPress={() => setSelectedTab('schedule')}
        >
          <Text style={[styles.tabText, selectedTab === 'schedule' && styles.tabTextActive]}>
            Today's Schedule
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, selectedTab === 'history' && styles.tabActive]}
          onPress={() => setSelectedTab('history')}
        >
          <Text style={[styles.tabText, selectedTab === 'history' && styles.tabTextActive]}>
            History
          </Text>
        </Pressable>
      </View>

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
            tintColor={COLORS.primary}
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
        visible={showAddModal}
        medication={editingMedication}
        onClose={() => {
          setShowAddModal(false);
          setEditingMedication(null);
        }}
        onSave={() => {
          setShowAddModal(false);
          setEditingMedication(null);
          refetchMedications();
          refetchSchedule();
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
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (medications.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>💊</Text>
        <Text style={styles.emptyTitle}>No Active Medications</Text>
        <Text style={styles.emptyText}>
          Add your medications to track doses and schedules.
        </Text>
      </View>
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

  const statusColor = STATUS_COLORS[medication.status];
  const frequencyLabel = FREQUENCY_LABELS[medication.frequency] || medication.frequency;

  return (
    <View style={styles.medicationCard}>
      <Pressable
        style={styles.medicationHeader}
        onPress={() => setShowActions(!showActions)}
      >
        <View style={styles.medicationInfo}>
          <View style={styles.medicationNameRow}>
            <Text style={styles.medicationName}>{medication.name}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>
                {getStatusLabel(medication.status)}
              </Text>
            </View>
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

        <Text style={styles.chevron}>{showActions ? '▲' : '▼'}</Text>
      </Pressable>

      {showActions && (
        <View style={styles.medicationActions}>
          <Pressable style={styles.actionButton} onPress={onEdit}>
            <Text style={styles.actionButtonText}>Edit</Text>
          </Pressable>
          
          {medication.status === 'ACTIVE' ? (
            <Pressable style={[styles.actionButton, styles.pauseButton]} onPress={onPause}>
              <Text style={styles.actionButtonText}>Pause</Text>
            </Pressable>
          ) : medication.status === 'PAUSED' ? (
            <Pressable style={[styles.actionButton, styles.resumeButton]} onPress={onResume}>
              <Text style={styles.actionButtonText}>Resume</Text>
            </Pressable>
          ) : null}
          
          <Pressable style={[styles.actionButton, styles.stopButton]} onPress={onStop}>
            <Text style={[styles.actionButtonText, styles.stopButtonText]}>Stop</Text>
          </Pressable>
        </View>
      )}
    </View>
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
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (schedule.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📅</Text>
        <Text style={styles.emptyTitle}>No Medications Scheduled</Text>
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

  return (
    <View style={styles.scheduleContainer}>
      {Object.entries(groupedByTime).map(([time, items]) => (
        <View key={time} style={styles.timeGroup}>
          <Text style={styles.timeGroupHeader}>{formatTime(time)}</Text>
          {items.map((item) => (
            <ScheduleItem
              key={`${item.medication.medication_id}-${item.scheduled_time}`}
              item={item}
              onTakeDose={() => onTakeDose(item.medication as any, item.scheduled_time)}
            />
          ))}
        </View>
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
    <View style={[styles.scheduleItem, taken && styles.scheduleItemTaken]}>
      <View style={styles.scheduleItemInfo}>
        <Text style={styles.scheduleItemName}>{medication.name}</Text>
        <Text style={styles.scheduleItemDetails}>
          {medication.strength}{medication.strength_unit ? ` ${medication.strength_unit}` : ''}
          {medication.dose_amount ? ` • ${medication.dose_amount}${medication.dose_unit ? ` ${medication.dose_unit}` : ''}` : ''}
        </Text>
      </View>
      
      {taken ? (
        <View style={styles.takenBadge}>
          <Text style={styles.takenText}>✓ Taken</Text>
          {taken_at && (
            <Text style={styles.takenTime}>
              {new Date(taken_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </Text>
          )}
        </View>
      ) : (
        <Pressable style={styles.takeButton} onPress={onTakeDose}>
          <Text style={styles.takeButtonText}>Take</Text>
        </Pressable>
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
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📋</Text>
        <Text style={styles.emptyTitle}>No Medication History</Text>
        <Text style={styles.emptyText}>
          Add medications to track your history.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.historyContainer}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.medicationPicker}>
        <Pressable
          style={[styles.pickerItem, !selectedMedication && styles.pickerItemActive]}
          onPress={() => setSelectedMedication(null)}
        >
          <Text style={[styles.pickerText, !selectedMedication && styles.pickerTextActive]}>
            All
          </Text>
        </Pressable>
        {medications.map((med) => (
          <Pressable
            key={med.medication_id}
            style={[styles.pickerItem, selectedMedication === med.medication_id && styles.pickerItemActive]}
            onPress={() => setSelectedMedication(med.medication_id)}
          >
            <Text style={[styles.pickerText, selectedMedication === med.medication_id && styles.pickerTextActive]}>
              {med.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : history.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No dose history recorded.</Text>
        </View>
      ) : (
        <View style={styles.historyList}>
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
  const statusColor = event.status === 'TAKEN' ? COLORS.green : 
                     event.status === 'MISSED' ? COLORS.error : COLORS.warning;

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
      <View style={[styles.historyStatusBadge, { backgroundColor: statusColor + '20' }]}>
        <Text style={[styles.historyStatusText, { color: statusColor }]}>
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
  onClose,
  onSave,
}: {
  visible: boolean;
  medication: Medication | null;
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
      };

      if (medication) {
        await api.put(`/api/v1/medications/${medication.medication_id}`, payload);
      } else {
        await api.post('/api/v1/medications', payload);
      }

      onSave();
    } catch (error) {
      Alert.alert('Error', 'Failed to save medication');
    } finally {
      setSaving(false);
    }
  }, [name, genericName, brandName, strength, strengthUnit, doseAmount, doseUnit, route, frequency, scheduledTimes, startDate, endDate, purpose, instructions, prescriber, prn, reminderEnabled, notes, medication, onSave]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView
        style={styles.modalContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose}>
            <Text style={styles.modalCancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.modalTitle}>{medication ? 'Edit Medication' : 'Add Medication'}</Text>
          <Pressable onPress={handleSave} disabled={saving}>
            <Text style={[styles.modalSave, saving && styles.modalSaveDisabled]}>
              {saving ? 'Saving...' : 'Save'}
            </Text>
          </Pressable>
        </View>

        <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentContainer}>
          {/* Required: Name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Medication Name *</Text>
            <TextInput
              style={styles.textInput}
              value={name}
              onChangeText={setName}
              placeholder="e.g., AMTIVA"
              placeholderTextColor={COLORS.textMuted}
            />
          </View>

          {/* Optional: Generic/Brand */}
          <View style={styles.fieldRow}>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>Generic Name</Text>
              <TextInput
                style={styles.textInput}
                value={genericName}
                onChangeText={setGenericName}
                placeholder="e.g., amlodipine"
                placeholderTextColor={COLORS.textMuted}
              />
            </View>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>Brand Name</Text>
              <TextInput
                style={styles.textInput}
                value={brandName}
                onChangeText={setBrandName}
                placeholder="e.g., Norvasc"
                placeholderTextColor={COLORS.textMuted}
              />
            </View>
          </View>

          {/* Strength */}
          <View style={styles.fieldRow}>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>Strength</Text>
              <TextInput
                style={styles.textInput}
                value={strength}
                onChangeText={setStrength}
                placeholder="e.g., 5"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
              />
            </View>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>Strength Unit</Text>
              <TextInput
                style={styles.textInput}
                value={strengthUnit}
                onChangeText={setStrengthUnit}
                placeholder="e.g., mg"
                placeholderTextColor={COLORS.textMuted}
              />
            </View>
          </View>

          {/* Dose */}
          <View style={styles.fieldRow}>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>Dose Amount</Text>
              <TextInput
                style={styles.textInput}
                value={doseAmount}
                onChangeText={setDoseAmount}
                placeholder="e.g., 1"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
              />
            </View>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>Dose Unit</Text>
              <TextInput
                style={styles.textInput}
                value={doseUnit}
                onChangeText={setDoseUnit}
                placeholder="e.g., tablet"
                placeholderTextColor={COLORS.textMuted}
              />
            </View>
          </View>

          {/* Frequency */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Frequency</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.frequencyPicker}>
              {(Object.keys(FREQUENCY_LABELS) as MedicationFrequency[]).map((freq) => (
                <Pressable
                  key={freq}
                  style={[styles.frequencyOption, frequency === freq && styles.frequencyOptionActive]}
                  onPress={() => setFrequency(freq)}
                >
                  <Text style={[styles.frequencyText, frequency === freq && styles.frequencyTextActive]}>
                    {FREQUENCY_LABELS[freq]}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* Scheduled Times */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Scheduled Times (comma-separated)</Text>
            <TextInput
              style={styles.textInput}
              value={scheduledTimes}
              onChangeText={setScheduledTimes}
              placeholder="e.g., 08:00, 20:00"
              placeholderTextColor={COLORS.textMuted}
            />
          </View>

          {/* Dates */}
          <View style={styles.fieldRow}>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>Start Date</Text>
              <TextInput
                style={styles.textInput}
                value={startDate}
                onChangeText={setStartDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={COLORS.textMuted}
              />
            </View>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>End Date</Text>
              <TextInput
                style={styles.textInput}
                value={endDate}
                onChangeText={setEndDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={COLORS.textMuted}
              />
            </View>
          </View>

          {/* Purpose */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Purpose</Text>
            <TextInput
              style={styles.textInput}
              value={purpose}
              onChangeText={setPurpose}
              placeholder="e.g., Blood pressure control"
              placeholderTextColor={COLORS.textMuted}
            />
          </View>

          {/* Instructions */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Instructions</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={instructions}
              onChangeText={setInstructions}
              placeholder="e.g., Take with food"
              placeholderTextColor={COLORS.textMuted}
              multiline
              numberOfLines={3}
            />
          </View>

          {/* Prescriber */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Prescriber</Text>
            <TextInput
              style={styles.textInput}
              value={prescriber}
              onChangeText={setPrescriber}
              placeholder="e.g., Dr. Smith"
              placeholderTextColor={COLORS.textMuted}
            />
          </View>

          {/* Toggles */}
          <View style={styles.toggleRow}>
            <Pressable
              style={[styles.toggle, prn && styles.toggleActive]}
              onPress={() => setPrn(!prn)}
            >
              <Text style={[styles.toggleText, prn && styles.toggleTextActive]}>
                PRN (As needed)
              </Text>
            </Pressable>
            <Pressable
              style={[styles.toggle, reminderEnabled && styles.toggleActive]}
              onPress={() => setReminderEnabled(!reminderEnabled)}
            >
              <Text style={[styles.toggleText, reminderEnabled && styles.toggleTextActive]}>
                Enable Reminders
              </Text>
            </Pressable>
          </View>

          {/* Notes */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Additional notes..."
              placeholderTextColor={COLORS.textMuted}
              multiline
              numberOfLines={3}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── STYLES ──

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: COLORS.textPrimary,
  },
  addButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  addButtonText: {
    ...TYPOGRAPHY.bodyStrong,
    color: '#FFFFFF',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tab: {
    flex: 1,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: COLORS.primary,
  },
  tabText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
  },
  tabTextActive: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: SPACING.md,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xxl,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xxl,
    gap: SPACING.md,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
  },
  emptyText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  medicationsList: {
    gap: SPACING.md,
  },
  medicationCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  medicationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
  },
  medicationInfo: {
    flex: 1,
  },
  medicationNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  medicationName: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
  },
  statusBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
  },
  statusText: {
    ...TYPOGRAPHY.captionStrong,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  medicationDetails: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  medicationDetail: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  scheduleLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },
  scheduleTimes: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginTop: SPACING.xs,
  },
  dateLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },
  dateValue: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  dateSeparator: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
    marginHorizontal: SPACING.xs,
  },
  chevron: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
    fontSize: 12,
  },
  medicationActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    paddingTop: SPACING.sm,
  },
  actionButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surfaceSecondary,
  },
  actionButtonText: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.textSecondary,
  },
  pauseButton: {
    backgroundColor: COLORS.warning + '20',
  },
  resumeButton: {
    backgroundColor: COLORS.green + '20',
  },
  stopButton: {
    backgroundColor: COLORS.error + '20',
  },
  stopButtonText: {
    color: COLORS.error,
  },
  scheduleContainer: {
    gap: SPACING.lg,
  },
  timeGroup: {
    gap: SPACING.sm,
  },
  timeGroupHeader: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  scheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  scheduleItemTaken: {
    opacity: 0.7,
  },
  scheduleItemInfo: {
    flex: 1,
  },
  scheduleItemName: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
  },
  scheduleItemDetails: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  takenBadge: {
    alignItems: 'center',
  },
  takenText: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.green,
  },
  takenTime: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    fontSize: 10,
  },
  takeButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  takeButtonText: {
    ...TYPOGRAPHY.bodyStrong,
    color: '#FFFFFF',
  },
  historyContainer: {
    gap: SPACING.md,
  },
  medicationPicker: {
    flexGrow: 0,
  },
  pickerItem: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surfaceSecondary,
    marginRight: SPACING.sm,
  },
  pickerItemActive: {
    backgroundColor: COLORS.primary,
  },
  pickerText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
  },
  pickerTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  historyList: {
    gap: SPACING.sm,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  historyItemInfo: {
    flex: 1,
  },
  historyItemName: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
  },
  historyItemDate: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  historyStatusBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
  },
  historyStatusText: {
    ...TYPOGRAPHY.captionStrong,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalCancel: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
  },
  modalTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
  },
  modalSave: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.primary,
  },
  modalSaveDisabled: {
    color: COLORS.textMuted,
  },
  modalContent: {
    flex: 1,
  },
  modalContentContainer: {
    padding: SPACING.md,
    gap: SPACING.md,
  },
  fieldGroup: {
    gap: SPACING.xs,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  fieldLabel: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.textSecondary,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  textInput: {
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.body,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  frequencyPicker: {
    flexGrow: 0,
  },
  frequencyOption: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surfaceSecondary,
    marginRight: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  frequencyOptionActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  frequencyText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  frequencyTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  toggle: {
    flex: 1,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surfaceSecondary,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  toggleActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  toggleText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  toggleTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});