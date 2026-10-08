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
import { useTheme } from '@/theme';
import { getCachedPatientId } from '@/services/patientIdentity';
import { getDocumentExtraction } from '@/services/documents';
import type { DocumentExtraction } from '@/types';
import { usePremiumTier, tierUnlocks } from '@/services/premium';
import { useOpenPricing } from '@/components/PaywallGate';
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
  updateMedication as dbUpdateMedication,
} from '@/db/queries/medications';
import { reconcileMedicationReminders } from '@/services/medicationReminders';
import {
  isReminderRuntimeSupported,
  requestReminderPermissions,
} from '@/services/reminderNotifications';
import { GV, TYPE, FONT } from '@/theme/guava';
import { LG } from '@/theme/liquidGlass';
import { Button, Card, Chip, Input } from '@/components';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import Entrance from '@/components/home/Entrance';
import { ExploreGlyph } from '@/components/home/ExploreGlyphs';
import FamilyWatchSection from '@/screens/Medications/FamilyWatchSection';
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

/** One short line per scan-session state. */
function scanStatusCopy(status: ScanSession['status']): string {
  switch (status) {
    case 'capturing':
      return 'Unfinished scan.';
    case 'uploading':
      return 'Uploading…';
    case 'awaiting_extraction':
      return 'Reading pages…';
    case 'reviewed':
      return 'Done.';
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

// ── Med row: one frosted glass row per medication ───────────────────────
// Monochrome pill glyph + name + a single dose · time line. No solid
// fills, no per-med hues — status lives in the insight line, not color.
// Tap opens the Edit/Pause/Stop menu floating above the row.

function MedTile({
  medication,
  extraLines,
  expanded,
  onToggle,
  onEdit,
  onPause,
  onResume,
  onStop,
  onRefill,
}: {
  medication: Medication;
  extraLines?: string[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRefill: () => void;
}) {
  const frequencyLabel = FREQUENCY_LABELS[medication.frequency] || medication.frequency;
  const doseLine = [
    medication.strength ? `${medication.strength}${medication.strength_unit ? ` ${medication.strength_unit}` : ''}` : null,
    medication.dose_amount ? `${medication.dose_amount}${medication.dose_unit ? ` ${medication.dose_unit}` : ''}` : null,
  ].filter(Boolean).join(' · ');
  const timeLine = medication.scheduled_times && medication.scheduled_times.length > 0
    ? medication.scheduled_times.map(formatTime).join(' · ')
    : frequencyLabel;
  const metaLine = [doseLine, timeLine].filter(Boolean).join(' · ');

  return (
    <View style={[styles.tileWrap, expanded && styles.tileWrapOpen]}>
      <GlassSurface
        noBlur
        radius={20}
        style={styles.tile}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${medication.name} details`}
      >
        <View style={styles.tileGlyph}>
          <ExploreGlyph name="pill" size={22} color="rgba(255,255,255,0.92)" />
        </View>
        <View style={styles.tileMain}>
          <Text style={styles.tileLabel} numberOfLines={1}>
            {medication.name}
          </Text>
          {metaLine ? (
            <Text style={styles.tileMeta} numberOfLines={1}>
              {metaLine}
            </Text>
          ) : null}
          {(extraLines ?? []).map((line, i) => (
            <Text key={i} style={[styles.tileMeta, styles.tileInsight]} numberOfLines={1}>
              {line}
            </Text>
          ))}
        </View>
        <Text style={styles.tileChevron}>›</Text>
      </GlassSurface>
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
            {medication.status === 'ACTIVE' ? (
              <Pressable
                onPress={onRefill}
                accessibilityRole="button"
                accessibilityLabel={`Log refill for ${medication.name}`}
                hitSlop={8}
                style={({ pressed }) => [styles.popoverBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.popoverBtnText}>Log refill</Text>
              </Pressable>
            ) : null}
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
  const [scanSourceDocIds, setScanSourceDocIds] = useState<string[]>([]);
  const tier = usePremiumTier();
  const openPricing = useOpenPricing();

  // ---- Scanned prescription sessions (local record of scanner runs) ----
  const [scanSessions, setScanSessions] = useState<ScanSession[]>([]);
  // Per-document extraction readiness (fresh from the backend). The row
  // offers Verify & add only once every page reads EXTRACTED.
  const [extractedDocs, setExtractedDocs] = useState<Record<string, boolean>>({});
  const [extractFailed, setExtractFailed] = useState(false);
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

  const loadReadiness = useCallback(async (sessions: ScanSession[]) => {
    const ids = [...new Set(sessions.flatMap((s) => s.document_ids))];
    if (ids.length === 0) {
      setExtractedDocs({});
      setExtractFailed(false);
      return;
    }
    const settled = await Promise.allSettled(ids.map((id) => getDocumentExtraction(id)));
    const ready: Record<string, boolean> = {};
    let failed = false;
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value?.status === 'EXTRACTED') ready[ids[i]] = true;
      else if (r.status === 'rejected') failed = true;
    });
    setExtractedDocs(ready);
    setExtractFailed(failed);
  }, []);

  useEffect(() => {
    void loadReadiness(scanSessions);
  }, [scanSessions, loadReadiness]);

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
    if (!tierUnlocks(tier, 'prescriptionScanner')) {
      openPricing();
      return;
    }
    navigation.navigate('PrescriptionScanner');
  }, [navigation, tier, openPricing]);

  const addMedicationFromScan = useCallback((session: ScanSession) => {
    navigation.navigate('PrescriptionReview', {
      docIds: session.document_ids,
      sessionId: session.session_id,
    });
  }, [navigation]);

  const markSessionReviewed = useCallback((session: ScanSession) => {
    void setScanStatus(session.session_id, 'reviewed').then(() => loadScanSessions());
  }, [loadScanSessions]);

  const dismissScanSession = useCallback((session: ScanSession) => {
    void deleteScanSession(session.session_id).then(() => loadScanSessions());
  }, [loadScanSessions]);

  const openAdd = useCallback(() => {
    setEditingMedication(null);
    setScanSourceDocIds([]);
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

  // Adherence + refill + safety insights (one bounded taken-events fetch per
  // active medication; skipped entirely when the list is empty).
  const [insights, setInsights] = useState<{
    adherence: Record<string, import('@/utils/medicationAdherence').Adherence>;
    refills: Record<string, import('@/utils/medicationAdherence').Refill>;
    flags: import('@/utils/medicationAdherence').SafetyFlag[];
  } | null>(null);
  useEffect(() => {
    let live = true;
    if (activeMedications.length === 0) {
      setInsights(null);
      return () => { live = false; };
    }
    void (async () => {
      try {
        const { computeAdherence, computeRefill, safetyFlags } = await import('@/utils/medicationAdherence');
        const { interactionFlags } = await import('@/utils/drugInteractions');
        const settled = await Promise.allSettled(
          activeMedications.map((m) =>
            api.get<import('@/types').MedicationTakenEvent[]>(`/api/v1/medications/${m.medication_id}/taken`, {
              params: { limit: 200 },
            }),
          ),
        );
        if (!live) return;
        const eventsByMed: Record<string, import('@/types').MedicationTakenEvent[]> = {};
        activeMedications.forEach((m, i) => {
          const r = settled[i];
          eventsByMed[m.medication_id] = r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : [];
        });
        const adherence: Record<string, import('@/utils/medicationAdherence').Adherence> = {};
        const refills: Record<string, import('@/utils/medicationAdherence').Refill> = {};
        for (const m of activeMedications) {
          adherence[m.medication_id] = computeAdherence(m, eventsByMed[m.medication_id] ?? []);
          const refill = computeRefill(m, eventsByMed[m.medication_id] ?? []);
          if (refill) refills[m.medication_id] = refill;
        }
        setInsights({
          adherence,
          refills,
          flags: [...interactionFlags(activeMedications), ...safetyFlags(activeMedications, eventsByMed)],
        });
      } catch {
        if (live) setInsights(null);
      }
    })();
    return () => { live = false; };
  }, [activeMedications]);

  // Per-tile insight lines derived from the fetched insights.
  const tileLines = useMemo(() => {
    const out: Record<string, string[]> = {};
    if (!insights) return out;
    for (const m of activeMedications) {
      const lines: string[] = [];
      const a = insights.adherence[m.medication_id];
      if (a?.percent != null) lines.push(`${a.percent}% · 7 days`);
      const r = insights.refills[m.medication_id];
      if (r) {
        if (r.out) {
          lines.push('Out of supply');
        } else if (r.daysLeft != null) {
          const refillBit = m.refills_left != null ? ` · ${m.refills_left} refills` : '';
          lines.push(`~${Math.max(1, Math.ceil(r.daysLeft))} days left${refillBit}`);
        } else {
          lines.push(`${Math.max(0, Math.floor(r.dosesLeft))} doses left`);
        }
      } else if (m.end_date) {
        const daysLeft = Math.ceil(
          (new Date(`${m.end_date}T12:00:00`).getTime() - Date.now()) / (24 * 3600 * 1000),
        );
        if (daysLeft >= 0 && daysLeft <= 14) lines.push(`Course ends in ${daysLeft}d`);
      }
      if (lines.length > 0) out[m.medication_id] = lines;
    }
    return out;
  }, [insights, activeMedications]);

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

  // Headline + sub: one job per sentence, outcome first. The sub is the
  // next dose, today's count, or the empty nudge — never instructions.
  const sub = nextDose
    ? `Next · ${nextDose.medication.name} at ${formatTime(nextDose.scheduled_time)}`
    : activeMedications.length > 0
      ? `${todayTaken}/${todayTotal} taken today.`
      : 'Add what you take.';

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

  const handleStopMedication = useCallback(async (medication: Medication) => {    Alert.alert(
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

  // ── Refill pickup: one-tap restock of supply + refill count ──

  const [refillMed, setRefillMed] = useState<Medication | null>(null);
  const [refillQty, setRefillQty] = useState('');
  const [refillDate, setRefillDate] = useState('');
  const [refillError, setRefillError] = useState<string | null>(null);
  const [savingRefill, setSavingRefill] = useState(false);

  const openRefill = useCallback((medication: Medication) => {
    setRefillMed(medication);
    setRefillQty(
      medication.supply_quantity != null && medication.supply_quantity > 0
        ? String(medication.supply_quantity)
        : '',
    );
    setRefillDate(todayKey());
    setRefillError(null);
  }, []);

  const handleSaveRefill = useCallback(async () => {
    if (savingRefill || !refillMed) return;
    const patientId = getCachedPatientId();
    if (!patientId) {
      setRefillError('Your session has expired. Please sign in again.');
      return;
    }
    let update;
    try {
      const { refillPickup } = await import('@/utils/medicationAdherence');
      update = refillPickup(
        { supply_quantity: refillMed.supply_quantity, refills_left: refillMed.refills_left },
        { quantity: refillQty.trim() ? Number(refillQty) : null, pickedUpOn: refillDate },
        todayKey(),
      );
    } catch (err) {
      setRefillError(err instanceof Error ? err.message : 'Check the highlighted fields.');
      return;
    }
    setSavingRefill(true);
    try {
      await dbUpdateMedication(patientId, refillMed.medication_id, update);
      setRefillMed(null);
      refetchMedications();
      if (patientId) void reconcileMedicationReminders(patientId);
    } catch {
      setRefillError('Could not save this refill. Please try again.');
    } finally {
      setSavingRefill(false);
    }
  }, [savingRefill, refillMed, refillQty, refillDate, refetchMedications]);

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
    <View style={styles.screen}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top']}>
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
        <Entrance index={0}>
          <Text style={styles.headline}>Medications</Text>
          <Text style={styles.sub} numberOfLines={2}>{sub}</Text>
        </Entrance>

        <Entrance index={1}>
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
              <Text style={styles.scanBtnText}>Scan</Text>
            </Pressable>
          </View>
        </Entrance>

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
          <Entrance index={2}>
            <GlassSurface strong style={styles.scanCard}>
              <Text style={styles.scanTitle}>Scans</Text>
            {scanSessions.map((session) => {
              const ready =
                session.document_ids.length > 0 &&
                session.document_ids.every((id) => extractedDocs[id] === true);
              const open = session.status !== 'reviewed';
              return (
                <View key={session.session_id} style={styles.scanRow}>
                  <View style={styles.scanInfo}>
                    <Text style={styles.scanName}>
                      {session.document_ids.length === 1
                        ? '1 page'
                        : `${session.document_ids.length} pages`}
                      {session.status === 'reviewed' ? ' · done' : ''}
                    </Text>
                    <Text style={styles.scanSub}>
                      {open && !ready && extractFailed
                        ? 'Needs connection to read pages.'
                        : scanStatusCopy(session.status)}
                    </Text>
                  </View>
                  {open && ready ? (
                    <Pressable
                      onPress={() => addMedicationFromScan(session)}
                      accessibilityRole="button"
                      accessibilityLabel="Review extracted medicines"
                      hitSlop={8}
                      style={({ pressed }) => [styles.scanAddBtn, pressed && { opacity: 0.7 }]}
                    >
                      <Text style={styles.scanAddText}>Review medicines</Text>
                    </Pressable>
                  ) : null}
                  {open ? (
                    <Pressable
                      onPress={() => markSessionReviewed(session)}
                      accessibilityRole="button"
                      accessibilityLabel="Mark scan done, no more medicines to add"
                      hitSlop={8}
                      style={({ pressed }) => [styles.scanDoneBtn, pressed && { opacity: 0.7 }]}
                    >
                      <Text style={styles.scanDoneText}>Done</Text>
                    </Pressable>
                  ) : null}
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
              );
            })}
            </GlassSurface>
          </Entrance>
        )}

        {insights && insights.flags.length > 0 && selectedTab === 'active' && (
          <Entrance index={2}>
            <GlassSurface strong tint="#F5B453" tintOpacity={0.12} style={styles.safetyCard}>
              <Text style={styles.safetyTitle}>Worth a look</Text>
              {insights.flags.slice(0, 4).map((f, i) => (
                <Text key={`${f.kind}-${i}`} style={styles.safetyText}>
                  {f.text}
                </Text>
              ))}
            </GlassSurface>
          </Entrance>
        )}

        {selectedTab === 'active' && (
          <Entrance index={3}>
            <ActiveTilesTab
              medications={activeMedications}
              isLoading={medicationsLoading}
              extraLines={tileLines}
              onAdd={openAdd}
              onEdit={(med) => {
                setEditingMedication(med);
                setShowAddModal(true);
              }}
              onPause={handlePauseMedication}
              onResume={handleResumeMedication}
              onStop={handleStopMedication}
              onRefill={openRefill}
            />
          </Entrance>
        )}

        {selectedTab === 'schedule' && (
          <Entrance index={3}>
            <ScheduleTab
              schedule={schedule}
              isLoading={scheduleLoading}
              onTakeDose={handleTakeDose}
            />
          </Entrance>
        )}

        {selectedTab === 'schedule' && (
          <FamilyWatchSection
            medications={activeMedications.map((m) => ({ medication_id: m.medication_id, name: m.name }))}
            schedule={schedule}
            today={today}
          />
        )}

        {selectedTab === 'history' && (
          <Entrance index={3}>
            <HistoryTab medications={medications} onResume={handleResumeMedication} />
          </Entrance>
        )}
      </ScrollView>

      {/* Add/Edit Modal */}
      <AddMedicationModal
        key={editingMedication?.medication_id ?? scanSourceDocIds.join(',') ?? 'new'}
        visible={showAddModal}
        medication={editingMedication}
        sourceDocumentIds={scanSourceDocIds}
        onClose={() => {
          setShowAddModal(false);
          setEditingMedication(null);
          setScanSourceDocIds([]);
        }}
        onSave={() => {
          // One-by-one flow: the session stays open until the user marks
          // it Done. Saving only adds this medication.
          setShowAddModal(false);
          setEditingMedication(null);
          setScanSourceDocIds([]);
          refetchMedications();
          refetchSchedule();
          // Save/edit/scan-accept share this path: rebuild reminders from
          // the fresh schedule (idempotent, offline-safe).
          const patientId = getCachedPatientId();
          if (patientId) void reconcileMedicationReminders(patientId);
        }}
      />
      {/* Refill pickup modal */}
      <Modal
        visible={refillMed !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRefillMed(null)}
      >
        <View style={styles.refillOverlay}>
          <View style={styles.refillBox}>
            <Text style={styles.refillTitle}>
              {refillMed ? `Log refill · ${refillMed.name}` : 'Log refill'}
            </Text>
            <Text style={styles.refillSub}>
              Resets supply to the new fill and uses one refill.
            </Text>
            <Input
              label="New fill size (doses)"
              value={refillQty}
              onChangeText={setRefillQty}
              placeholder="e.g. 30"
              keyboardType="numeric"
            />
            <Input
              label="Pickup day (YYYY-MM-DD)"
              value={refillDate}
              onChangeText={setRefillDate}
              placeholder="2026-10-02"
            />
            {refillError ? <Text style={styles.refillError}>{refillError}</Text> : null}
            <Button
              title={savingRefill ? 'Saving…' : 'Save refill'}
              onPress={() => void handleSaveRefill()}
              disabled={savingRefill}
              loading={savingRefill}
              fullWidth
            />
            <Pressable
              onPress={() => setRefillMed(null)}
              accessibilityRole="button"
              accessibilityLabel="Cancel refill"
              hitSlop={4}
              style={({ pressed }) => [styles.refillCancel, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.refillCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      </SafeAreaView>
    </View>
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
  onRefill,
  extraLines,
}: {
  medications: Medication[];
  isLoading: boolean;
  onAdd: () => void;
  onEdit: (med: Medication) => void;
  onPause: (med: Medication) => void;
  onResume: (med: Medication) => void;
  onStop: (med: Medication) => void;
  onRefill: (med: Medication) => void;
  /** Per-medication insight lines (adherence, refill) keyed by id. */
  extraLines?: Record<string, string[]>;
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
        <Text style={styles.emptyTitle}>Nothing here yet.</Text>
        <Text style={styles.emptyText}>
          Add what you take.
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

  return (
    <View style={styles.medList} accessibilityRole="list">
      {medications.map((med) => (
        <MedTile
          key={med.medication_id}
          medication={med}
          extraLines={extraLines?.[med.medication_id]}
          expanded={expandedId === med.medication_id}
          onToggle={() => setExpandedId((cur) => (cur === med.medication_id ? null : med.medication_id))}
          onEdit={() => { setExpandedId(null); onEdit(med); }}
          onPause={() => { setExpandedId(null); onPause(med); }}
          onResume={() => { setExpandedId(null); onResume(med); }}
          onStop={() => { setExpandedId(null); onStop(med); }}
          onRefill={() => { setExpandedId(null); onRefill(med); }}
        />
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
        <Text style={styles.emptyTitle}>Nothing scheduled.</Text>
        <Text style={styles.emptyText}>
          Add what you take.
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
          <GlassSurface key={time} strong style={styles.timeGroup}>
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
          </GlassSurface>
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
        <Text style={styles.emptyTitle}>No history.</Text>
        <Text style={styles.emptyText}>
          Add what you take.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.historyContainer}>
      {pausedMeds.length > 0 ? (
        <GlassSurface strong style={styles.historyCard}>
          <Text style={styles.pausedTitle}>Paused</Text>
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
        </GlassSurface>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.pickerRow}>
          <GlassChip
            label="All"
            selected={!selectedMedication}
            onPress={() => setSelectedMedication(null)}
            accessibilityLabel="Show all medication history"
          />
          {medications.map((med) => (
            <GlassChip
              key={med.medication_id}
              label={med.name}
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
          <Text style={styles.emptyText}>Nothing recorded yet.</Text>
        </View>
      ) : (
        <GlassSurface strong style={styles.historyCard}>
          {history.map((event) => (
            <HistoryItem key={event.event_id} event={event} medications={medications} />
          ))}
        </GlassSurface>
      )}
    </View>
  );
}

// ── Glass filter chip: quiet hairline pill, white when on ────────────────
// The shared Chip is a white pill everywhere — too loud for dark filter
// rows. Selected wears white with dark text (the dashboard seg recipe).

function GlassChip({
  label,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={4}
      style={({ pressed }) => [
        styles.gchip,
        selected && styles.gchipOn,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.gchipText, selected && styles.gchipTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
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
  const statusDot = event.status === 'TAKEN' ? LG.card.mint :
    event.status === 'MISSED' ? LG.card.danger : 'rgba(255,255,255,0.4)';

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

/** Pre-fill shape for prescription-review rows (superset of the form fields). */
export interface ExtractInitial {
  name: string | null;
  generic_name: string | null;
  brand_name: string | null;
  strength: string | null;
  strength_unit: string | null;
  dose_amount: number | null;
  dose_unit: string | null;
  route: string | null;
  frequency: string | null;
  scheduled_times: string[];
  start_date: string | null;
  end_date: string | null;
  purpose: string | null;
  instructions: string | null;
  prescriber: string | null;
  prn: boolean;
  reminder_enabled: boolean;
  notes: string | null;
  supply_quantity: number | null;
  refills_left: number | null;
}

export function AddMedicationModal({
  visible,
  medication,
  sourceDocumentIds,
  initialExtract,
  onClose,
  onSave,
}: {
  visible: boolean;
  medication: Medication | null;
  /** Set when adding from a scanned prescription — linked, never auto-filled. */
  sourceDocumentIds?: string[];
  /** Prescription-review row: pre-fills every field so review is confirm-or-tweak. */
  initialExtract?: ExtractInitial | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const init = medication == null ? initialExtract ?? null : null;
  const { colors } = useTheme();
  const docIds = sourceDocumentIds ?? [];
  // Verify mode: adding from a scan. The user types every field against
  // the scan text, confirms responsibility, and only then can save.
  const verifyMode = medication == null && docIds.length > 0;
  const [extracts, setExtracts] = useState<
    { id: string; text: string | null; ready: boolean }[] | null
  >(null);
  const [extractFailed, setExtractFailed] = useState(false);
  const [openPage, setOpenPage] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [name, setName] = useState(medication?.name || init?.name || '');
  const [genericName, setGenericName] = useState(medication?.generic_name || init?.generic_name || '');
  const [brandName, setBrandName] = useState(medication?.brand_name || init?.brand_name || '');
  const [strength, setStrength] = useState(medication?.strength || init?.strength || '');
  const [strengthUnit, setStrengthUnit] = useState(medication?.strength_unit || init?.strength_unit || '');
  const [doseAmount, setDoseAmount] = useState(
    medication?.dose_amount?.toString() || (init?.dose_amount != null ? String(init.dose_amount) : '') || '',
  );
  const [doseUnit, setDoseUnit] = useState(medication?.dose_unit || init?.dose_unit || '');
  const [route, setRoute] = useState<MedicationRoute | ''>(
    medication?.route || (init?.route as MedicationRoute | null) || '',
  );
  const [frequency, setFrequency] = useState<MedicationFrequency>(
    medication?.frequency || (init?.frequency as MedicationFrequency | null) || 'ONCE_DAILY',
  );
  const [scheduledTimes, setScheduledTimes] = useState(
    medication?.scheduled_times?.join(', ') || init?.scheduled_times?.join(', ') || '',
  );
  const [startDate, setStartDate] = useState(medication?.start_date || init?.start_date || '');
  const [endDate, setEndDate] = useState(medication?.end_date || init?.end_date || '');
  const [purpose, setPurpose] = useState(medication?.purpose || init?.purpose || '');
  const [instructions, setInstructions] = useState(medication?.instructions || init?.instructions || '');
  const [prescriber, setPrescriber] = useState(medication?.prescriber || init?.prescriber || '');
  const [prn, setPrn] = useState(medication?.prn || init?.prn || false);
  const [reminderEnabled, setReminderEnabled] = useState(medication?.reminder_enabled || init?.reminder_enabled || false);
  const [notes, setNotes] = useState(medication?.notes || init?.notes || '');
  const [supplyQuantity, setSupplyQuantity] = useState(
    medication?.supply_quantity != null
      ? String(medication.supply_quantity)
      : init?.supply_quantity != null
        ? String(init.supply_quantity)
        : '',
  );
  const [refillsLeft, setRefillsLeft] = useState(
    medication?.refills_left != null
      ? String(medication.refills_left)
      : init?.refills_left != null
        ? String(init.refills_left)
        : '',
  );
  const [saving, setSaving] = useState(false);

  // Verify mode loads what the scan actually read (fresh per open — the
  // modal remounts per scan via its key).
  useEffect(() => {
    if (!verifyMode) return;
    setOpenPage(docIds[0] ?? null);
    let live = true;
    void Promise.allSettled(docIds.map((id) => getDocumentExtraction(id))).then(
      (settled) => {
        if (!live) return;
        setExtracts(
          docIds.map((id, i) => {
            const r = settled[i];
            const ext =
              r.status === 'fulfilled'
                ? (r.value as DocumentExtraction | null)
                : null;
            return {
              id,
              text: ext?.markdown_text ?? null,
              ready: ext?.status === 'EXTRACTED',
            };
          }),
        );
        setExtractFailed(settled.some((r) => r.status === 'rejected'));
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyMode]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Medication name is required');
      return;
    }
    if (verifyMode && !verified) {
      Alert.alert(
        'Check first',
        'Confirm you checked every detail against your prescription.',
      );
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
        source_document_id: docIds[0] ?? medication?.source_document_id ?? null,
        supply_quantity: supplyQuantity.trim() && Number.isFinite(parseFloat(supplyQuantity)) ? parseFloat(supplyQuantity) : null,
        refills_left: refillsLeft.trim() && Number.isFinite(parseInt(refillsLeft, 10)) ? parseInt(refillsLeft, 10) : null,
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
  }, [name, genericName, brandName, strength, strengthUnit, doseAmount, doseUnit, route, frequency, scheduledTimes, startDate, endDate, purpose, instructions, prescriber, prn, reminderEnabled, notes, supplyQuantity, refillsLeft, medication, docIds, verifyMode, verified, onSave]);

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
          <Text style={styles.modalTitle}>{medication ? 'Edit Medication' : verifyMode ? 'Verify prescription' : 'Add Medication'}</Text>
          <Button
            title={saving ? 'Saving...' : 'Save'}
            onPress={() => void handleSave()}
            size="small"
            disabled={saving || (verifyMode && !verified)}
            accessibilityLabel="Save medication"
          />
        </View>
        {verifyMode ? (
          <View style={styles.verifyBanner}>
            <Text style={styles.verifyBannerText}>
              Check every detail against your prescription. Wrong or missed entries are your responsibility.
            </Text>
            <Pressable
              onPress={() => setVerified((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: verified }}
              accessibilityLabel="I checked all details against my prescription"
              style={styles.verifyCheck}
            >
              <View style={[styles.verifyBox, verified && styles.verifyBoxOn]}>
                {verified ? <Text style={styles.verifyGlyph}>✓</Text> : null}
              </View>
              <Text style={[styles.verifyLabel, { color: colors.textPrimary }]}>
                I checked all details against my prescription.
              </Text>
            </Pressable>
          </View>
        ) : null}

        <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentContainer}>
          {verifyMode ? (
            <Card style={styles.fieldCard}>
              <Text style={styles.pageTitle}>What the scan read</Text>
              {extracts == null && !extractFailed ? (
                <Text style={styles.pageSub}>Reading pages…</Text>
              ) : null}
              {extracts == null && extractFailed ? (
                <Text style={styles.pageSub}>Could not read pages. Type every field carefully.</Text>
              ) : null}
              {(extracts ?? []).map((p, i) => (
                <View key={p.id}>
                  <Pressable
                    onPress={() => setOpenPage((cur) => (cur === p.id ? null : p.id))}
                    accessibilityRole="button"
                    accessibilityLabel={`${openPage === p.id ? 'Hide' : 'Show'} page ${i + 1} scan text`}
                    style={styles.pageHead}
                  >
                    <Text style={[styles.pageHeadText, { color: colors.textPrimary }]}>
                      {`Page ${i + 1} · ${p.ready ? 'read' : 'reading…'}`}
                    </Text>
                    <Text style={styles.pageHeadChevron}>{openPage === p.id ? '▴' : '▾'}</Text>
                  </Pressable>
                  {openPage === p.id ? (
                    <Text style={[styles.pageText, { color: colors.textSecondary }]}>
                      {p.text ?? 'No readable text on this page.'}
                    </Text>
                  ) : null}
                </View>
              ))}
            </Card>
          ) : null}
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
            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Input
                  label="Supply (doses)"
                  value={supplyQuantity}
                  onChangeText={setSupplyQuantity}
                  placeholder="e.g., 30"
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.fieldHalf}>
                <Input
                  label="Refills left"
                  value={refillsLeft}
                  onChangeText={setRefillsLeft}
                  placeholder="e.g., 2"
                  keyboardType="numeric"
                />
              </View>
            </View>
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
  screen: {
    flex: 1,
    backgroundColor: LG.stage.bottom,
  },
  safe: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 26,
    paddingTop: 20,
    paddingBottom: 48,
    gap: 16,
  },
  headline: {
    fontWeight: '600',
    fontSize: 34,
    lineHeight: 41,
    letterSpacing: -0.8,
    color: '#FFFFFF',
    textAlign: 'left',
  },
  sub: {
    fontWeight: '400',
    fontSize: 17,
    lineHeight: 22,
    color: 'rgba(233,240,255,0.66)',
    textAlign: 'left',
    fontVariant: ['tabular-nums'],
  },
  progressWrap: {
    alignItems: 'flex-start',
    paddingTop: 2,
  },
  progressTrack: {
    flexDirection: 'row',
    width: 160,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: LG.card.mint,
    borderRadius: 3,
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
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.2,
    color: 'rgba(255, 255, 255, 0.72)',
  },
  segmentTextSelected: {
    color: '#0B0F1A',
    fontWeight: '700',
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
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 20,
    color: '#0B0F1A',
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
    fontWeight: '600',
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
    padding: 16,
    gap: 4,
  },
  scanTitle: {
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.3,
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
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  scanSub: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233,240,255,0.66)',
  },
  scanAddBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  scanAddText: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: LG.card.mint,
  },
  scanDoneBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  scanDoneText: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
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
  verifyBanner: {
    marginHorizontal: 24,
    marginTop: 8,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    backgroundColor: 'rgba(214,69,69,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(214,69,69,0.4)',
  },
  verifyBannerText: {
    ...TYPE.body,
    fontFamily: FONT.semi,
    fontSize: 14,
    color: '#F09696',
  },
  verifyCheck: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
  },
  verifyBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: GV.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifyBoxOn: {
    backgroundColor: GV.teal,
  },
  verifyGlyph: {
    color: '#062A26',
    fontSize: 13,
    fontWeight: '700',
  },
  verifyLabel: {
    ...TYPE.body,
    fontSize: 14,
    flex: 1,
  },
  pageTitle: {
    ...TYPE.title,
    fontSize: 16,
    color: '#FFFFFF',
    marginBottom: 4,
  },
  pageSub: {
    ...TYPE.caption,
    color: GV.fog,
  },
  pageHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    minHeight: 44,
  },
  pageHeadText: {
    ...TYPE.chip,
  },
  pageHeadChevron: {
    fontSize: 14,
    color: GV.fog,
  },
  pageText: {
    ...TYPE.caption,
    lineHeight: 18,
    paddingBottom: 8,
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
  // Med rows: translucent material without blur (repeated tiles),
  // monochrome glyph + headline + quiet meta. ≥44pt by construction.
  medList: {
    gap: 12,
  },
  tileWrap: {
    position: 'relative',
  },
  tileWrapOpen: {
    zIndex: 10,
    elevation: 8,
  },
  // Menu floats over its own row: dim sheet, actions in a row.
  tileOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 20,
    backgroundColor: 'rgba(5, 7, 15, 0.78)',
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
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
  },
  refillOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  refillBox: {
    backgroundColor: LG.card.fillOpaque,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    padding: 20,
    gap: 12,
  },
  refillTitle: {
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
    color: '#FFFFFF',
  },
  refillSub: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233,240,255,0.66)',
  },
  refillError: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: LG.card.danger,
  },
  refillCancel: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refillCancelText: {
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 20,
    color: 'rgba(233,240,255,0.66)',
  },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 68,
  },
  tileGlyph: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileMain: {
    flex: 1,
    gap: 2,
  },
  tileChevron: {
    fontSize: 22,
    color: 'rgba(233,240,255,0.45)',
  },
  tileLabel: {
    fontWeight: '600',
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.1,
    color: '#FFFFFF',
  },
  tileMeta: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233,240,255,0.66)',
    fontVariant: ['tabular-nums'],
  },
  tileInsight: {
    fontWeight: '600',
    color: '#FFFFFF',
  },
  safetyCard: {
    padding: 16,
    gap: 6,
    marginBottom: 4,
  },
  safetyTitle: {
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.1,
    color: '#FFFFFF',
  },
  safetyText: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233,240,255,0.80)',
  },
  emptyWrap: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 24,
  },
  emptyTitle: {
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  emptyText: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(233,240,255,0.66)',
    textAlign: 'center',
    maxWidth: 300,
    marginBottom: 8,
  },
  scheduleContainer: {
    gap: 12,
    marginTop: 4,
  },
  timeGroup: {
    padding: 16,
  },
  timeHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 4,
    gap: 8,
  },
  timeTitle: {
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.3,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  timeCount: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233,240,255,0.66)',
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
    fontWeight: '600',
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.1,
    color: '#FFFFFF',
  },
  scheduleItemDetails: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233,240,255,0.66)',
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
    backgroundColor: LG.card.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  takenGlyph: {
    color: '#0B0F1A',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
  takenTexts: {
    alignItems: 'flex-start',
  },
  takenText: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
  },
  takenTime: {
    fontWeight: '400',
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(233,240,255,0.66)',
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
    fontWeight: '600',
    fontSize: 14,
    lineHeight: 18,
    color: '#0B0F1A',
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
    padding: 16,
  },
  pausedTitle: {
    fontWeight: '600',
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.1,
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
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  historyItemDate: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233,240,255,0.66)',
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
    fontWeight: '600',
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(255, 255, 255, 0.8)',
    fontVariant: ['tabular-nums'],
  },
  // Quiet hairline filter pills (the shared Chip is a white pill — too
  // loud for dark filter rows). Selected wears white with dark text.
  gchip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  gchipOn: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  gchipText: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.2,
    color: 'rgba(255,255,255,0.72)',
  },
  gchipTextOn: {
    color: '#0B0F1A',
    fontWeight: '700',
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
