/**
 * CycleScreen — explicit cycle tracking (device-only).
 *
 * User-entered starts, ends, and notes grouped into plain history spans.
 * No predictions of any kind: no fertility, ovulation, pregnancy, or
 * condition inference — the history below shows recorded days only. All
 * rows are patient-scoped SQLite; nothing syncs (the UI says so).
 */

import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Button, Card, Chip, EmptyState, Input, Modal, SectionHeader } from '@/components';
import { HealthFact } from '@/components/HealthFact';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { StageGradient } from '@/components/StageGradient';
import { getCachedPatientId } from '@/services/patientIdentity';
import {
  CYCLE_KINDS,
  deleteCycleEntry,
  groupCycleSpans,
  insertCycleEntry,
  listCycleEntries,
  normalizeCycleInput,
  updateCycleEntry,
  type CycleEntry,
  type CycleKind,
} from '@/db/queries/cycle';

const KIND_COPY: Record<CycleKind, { label: string; hint: string }> = {
  'period-start': { label: 'Period start', hint: 'First day of bleeding' },
  'period-end': { label: 'Period end', hint: 'Last day of bleeding' },
  note: { label: 'Note', hint: 'Symptom or observation' },
};

function spanTitle(start: string | null, endExclusive: string | null): string {
  if (!start) return 'Notes';
  if (!endExclusive) return `Started ${start} · ongoing record`;
  const days = Math.round(
    (new Date(`${endExclusive}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()) /
      86400000,
  );
  return `Started ${start} · ${days}-day recorded span`;
}

export default function CycleScreen() {
  const navigation = useNavigation();
  const [entries, setEntries] = useState<CycleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CycleEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [kind, setKind] = useState<CycleKind>('period-start');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    try {
      const patientId = getCachedPatientId();
      if (!patientId) {
        setEntries([]);
        setLoading(false);
        return;
      }
      setEntries(await listCycleEntries(patientId, 200));
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

  const todayKey = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const openAdd = useCallback(() => {
    setEditing(null);
    setKind('period-start');
    setDate(todayKey());
    setNotes('');
    setFormError(null);
    setShowForm(true);
  }, []);

  const openEdit = useCallback((entry: CycleEntry) => {
    setEditing(entry);
    setKind(entry.kind);
    setDate(entry.date);
    setNotes(entry.notes ?? '');
    setFormError(null);
    setShowForm(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (saving) return;
    const patientId = getCachedPatientId();
    if (!patientId) {
      setFormError('Your session has expired. Please sign in again.');
      return;
    }
    let input;
    try {
      input = normalizeCycleInput({ kind, date: date.trim(), notes });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Check the highlighted fields.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateCycleEntry(patientId, editing.entry_id, input);
      } else {
        await insertCycleEntry(patientId, input);
      }
      setShowForm(false);
      await load();
    } catch {
      setFormError('Could not save this entry. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [saving, kind, date, notes, editing, load]);

  const confirmDelete = useCallback(
    (entry: CycleEntry) => {
      Alert.alert('Delete entry?', 'This removes the entry from this device. This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const patientId = getCachedPatientId();
            if (!patientId) return;
            void deleteCycleEntry(patientId, entry.entry_id).then(() => load());
          },
        },
      ]);
    },
    [load],
  );

  const spans = groupCycleSpans(entries);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StageGradient />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={() => navigation.canGoBack() && navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
          style={styles.backHit}
        >
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.overline}>TRACKING · ON THIS DEVICE</Text>
        <Text style={styles.title}>Cycle</Text>
        <Text style={styles.sub}>
          Your recorded days, grouped for review. Estimates are never shown as facts.
        </Text>

        <SectionHeader title="History" />
        {loading ? (
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : spans.length === 0 ? (
          <EmptyState
            icon="📅"
            title="No cycle entries yet"
            message="Record a period start to begin your history. Ends and notes are optional. Predictions are never made."
          />
        ) : (
          <View style={styles.list}>
            {spans.map((span, i) => (
              <Card key={`${span.start ?? 'notes'}-${i}`}>
                <Text style={styles.spanTitle}>{spanTitle(span.start, span.endExclusive)}</Text>
                {span.entries.map((entry) => (
                  <View key={entry.entry_id} style={styles.entryRow}>
                    <View style={styles.entryMain}>
                      <Text style={styles.entryKind}>{KIND_COPY[entry.kind].label}</Text>
                      <Text style={styles.entryDate}>{entry.date}</Text>
                      {entry.notes ? <Text style={styles.entryNotes}>{entry.notes}</Text> : null}
                    </View>
                    <View style={styles.entryActions}>
                      <Pressable
                        onPress={() => openEdit(entry)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Edit entry"
                        style={styles.rowBtn}
                      >
                        <Text style={styles.rowBtnText}>Edit</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => confirmDelete(entry)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Delete entry"
                        style={styles.rowBtn}
                      >
                        <Text style={[styles.rowBtnText, styles.deleteText]}>Delete</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </Card>
            ))}
          </View>
        )}

        <Button title="+ Add entry" onPress={openAdd} fullWidth />
        <Text style={styles.disclaimer}>
          Recorded history only. No fertility, ovulation, or pregnancy predictions.
        </Text>
      </ScrollView>

      <Modal
        visible={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? 'Edit entry' : 'Add entry'}
        subtitle="Stored on this device only."
      >
        <View style={styles.form}>
          <Text style={styles.fieldLabel}>Type</Text>
          <View style={styles.chips}>
            {CYCLE_KINDS.map((k) => (
              <Chip
                key={k}
                label={KIND_COPY[k].label}
                selected={kind === k}
                onPress={() => setKind(k)}
                size="medium"
                color={GV.cta}
                accessibilityLabel={`${KIND_COPY[k].label}. ${KIND_COPY[k].hint}`}
              />
            ))}
          </View>
          <Input label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2026-09-21" />
          <Input
            label="Notes (optional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="Symptoms or observations"
            multiline
            numberOfLines={3}
          />
          {formError ? <Text style={styles.error}>{formError}</Text> : null}
          <Button
            title={saving ? 'Saving…' : editing ? 'Save changes' : 'Save entry'}
            onPress={() => void handleSave()}
            disabled={saving}
            loading={saving}
            fullWidth
          />
          <Button title="Cancel" variant="ghost" onPress={() => setShowForm(false)} fullWidth />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: GV.stage },
  content: { paddingHorizontal: SPACE.screenH, paddingVertical: SPACE.sectionGap, paddingBottom: 32, gap: 12 },
  backHit: { minHeight: 44, justifyContent: 'center' },
  backText: { ...TYPE.button, fontSize: 16, color: GV.fog },
  overline: { fontFamily: FONT.semi, fontSize: 12, lineHeight: 16, letterSpacing: 3, color: GV.teal, textAlign: 'center' },
  title: { ...TYPE.display, color: GV.card, textAlign: 'center' },
  sub: { ...TYPE.body, color: GV.fog, textAlign: 'center' },
  loading: { ...TYPE.body, color: GV.fog, textAlign: 'center', marginTop: 16 },
  fact: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  list: { gap: SPACE.cardGap },
  spanTitle: { ...TYPE.title, color: GV.ink, marginBottom: 8, fontVariant: ['tabular-nums'] },
  entryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 6 },
  entryMain: { flex: 1, gap: 2 },
  entryKind: { ...TYPE.button, fontSize: 15, color: GV.ink },
  entryDate: { ...TYPE.caption, color: GV.body, fontVariant: ['tabular-nums'] },
  entryNotes: { ...TYPE.caption, color: GV.muted },
  entryActions: { flexDirection: 'row', gap: 4 },
  rowBtn: { minWidth: 44, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  rowBtnText: { ...TYPE.chip, color: GV.cta },
  deleteText: { color: GV.danger },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
  form: { gap: 12 },
  fieldLabel: { ...TYPE.caption, color: GV.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  error: { ...TYPE.caption, color: GV.danger },
});
