/**
 * SubstanceScreen — neutral substance-use tracking (device-only).
 *
 * Tracking, NOT treatment: record what happened (category, occasion, amount
 * as entered, notes) and review real history with a weekly strip. No goals
 * framed as medical advice, no streaks, no conversions, no withdrawal or
 * treatment content anywhere on this screen. All rows are patient-scoped
 * SQLite; nothing syncs (the UI says so).
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
import { EXTRA_TONES } from '@/theme/tones';
import { StageGradient } from '@/components/StageGradient';
import { getCachedPatientId } from '@/services/patientIdentity';
import {
  SUBSTANCE_CATEGORIES,
  deleteSubstanceEntry,
  insertSubstanceEntry,
  listSubstanceEntries,
  normalizeSubstanceInput,
  summarizeSubstanceWeeks,
  updateSubstanceEntry,
  type SubstanceCategory,
  type SubstanceEntry,
} from '@/db/queries/substances';
import { todayKey } from '@/screens/Onboarding/momentum';

const CATEGORY_COPY: Record<SubstanceCategory, { label: string; hint: string }> = {
  alcohol: { label: 'Alcohol', hint: 'Drinks and occasions' },
  tobacco: { label: 'Tobacco / nicotine', hint: 'Smoked, vaped or chewed' },
  other: { label: 'Other', hint: 'Anything else you track' },
};

/** Category tones: warm sand, cool slate, pine teal. */
const SUBSTANCE_TONES: Record<SubstanceCategory, string> = {
  alcohol: EXTRA_TONES.sand[0],
  tobacco: EXTRA_TONES.slate[0],
  other: EXTRA_TONES.pine[0],
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatAmount(entry: SubstanceEntry): string | null {
  if (entry.amount_value == null) return null;
  return entry.amount_unit ? `${entry.amount_value} ${entry.amount_unit}` : `${entry.amount_value}`;
}

export default function SubstanceScreen() {
  const navigation = useNavigation();
  const [entries, setEntries] = useState<SubstanceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SubstanceEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [category, setCategory] = useState<SubstanceCategory>('alcohol');
  const [label, setLabel] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    try {
      const patientId = getCachedPatientId();
      if (!patientId) {
        setEntries([]);
        setLoading(false);
        return;
      }
      setEntries(await listSubstanceEntries(patientId, 200));
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

  const openAdd = useCallback(() => {
    const now = new Date();
    setEditing(null);
    setCategory('alcohol');
    setLabel('');
    setDate(todayKey(now));
    setTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    setAmount('');
    setUnit('');
    setNotes('');
    setFormError(null);
    setShowForm(true);
  }, []);

  const openEdit = useCallback((entry: SubstanceEntry) => {
    const d = new Date(entry.occurred_at);
    setEditing(entry);
    setCategory(entry.category);
    setLabel(entry.label ?? '');
    setDate(Number.isNaN(d.getTime()) ? todayKey() : todayKey(d));
    setTime(
      Number.isNaN(d.getTime())
        ? '12:00'
        : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    );
    setAmount(entry.amount_value != null ? String(entry.amount_value) : '');
    setUnit(entry.amount_unit ?? '');
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
      input = normalizeSubstanceInput({
        category,
        label,
        occurred_at: `${date}T${time || '12:00'}:00`,
        amount_value: amount.trim() ? Number(amount) : null,
        amount_unit: unit,
        notes,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Check the highlighted fields.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateSubstanceEntry(patientId, editing.entry_id, input);
      } else {
        await insertSubstanceEntry(patientId, input);
      }
      setShowForm(false);
      await load();
    } catch {
      setFormError('Could not save this entry. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [saving, category, label, date, time, amount, unit, notes, editing, load]);

  const confirmDelete = useCallback(
    (entry: SubstanceEntry) => {
      Alert.alert('Delete entry?', 'This removes the entry from this device. This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const patientId = getCachedPatientId();
            if (!patientId) return;
            void deleteSubstanceEntry(patientId, entry.entry_id).then(() => load());
          },
        },
      ]);
    },
    [load],
  );

  const week = summarizeSubstanceWeeks(entries, todayKey());
  const weekTotal = week.reduce((s, d) => s + d.count, 0);

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
        <Text style={styles.title}>Substance use</Text>
        <Text style={styles.sub}>
          A private log of what happened. Not advice, not a diagnosis.
        </Text>

        <SectionHeader title="This week" />
        <Card>
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
            {weekTotal === 0 ? 'Nothing recorded this week.' : `${weekTotal} ${weekTotal === 1 ? 'entry' : 'entries'} this week.`}
          </Text>
        </Card>

        <SectionHeader title="History" />
        {loading ? (
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : entries.length === 0 ? (
          <EmptyState
            icon="📝"
            title="No entries yet"
            message="Record alcohol, tobacco, or anything else you track. History and weekly counts appear here. Only from real entries."
          />
        ) : (
          <View style={styles.list}>
            {entries.map((entry) => (
              <Card key={entry.entry_id}>
                <View style={styles.rowTop}>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle}>
                      {CATEGORY_COPY[entry.category].label}
                      {entry.label ? ` · ${entry.label}` : ''}
                    </Text>
                    <Text style={styles.rowSub}>
                      {formatWhen(entry.occurred_at)}
                      {formatAmount(entry) ? ` · ${formatAmount(entry)}` : ''}
                    </Text>
                    {entry.notes ? <Text style={styles.rowNotes}>{entry.notes}</Text> : null}
                  </View>
                  <View style={styles.rowActions}>
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
              </Card>
            ))}
          </View>
        )}

        <Button title="+ Log entry" onPress={openAdd} fullWidth />
        <Text style={styles.disclaimer}>
          Tracking only. Not medical advice, diagnosis, or treatment.
        </Text>
      </ScrollView>

      <Modal
        visible={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? 'Edit entry' : 'Log entry'}
        subtitle="Stored on this device only."
      >
        <View style={styles.form}>
          <Text style={styles.fieldLabel}>Category</Text>
          <View style={styles.chips}>
            {SUBSTANCE_CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={CATEGORY_COPY[c].label}
                selected={category === c}
                onPress={() => setCategory(c)}
                size="medium"
                color={SUBSTANCE_TONES[c]}
              />
            ))}
          </View>
          <Input label="Occasion / label (optional)" value={label} onChangeText={setLabel} placeholder="e.g. dinner with friends" />
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <Input label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2026-09-21" />
            </View>
            <View style={styles.fieldHalf}>
              <Input label="Time (HH:MM)" value={time} onChangeText={setTime} placeholder="19:30" />
            </View>
          </View>
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <Input label="Amount (optional)" value={amount} onChangeText={setAmount} placeholder="e.g. 2" keyboardType="numeric" />
            </View>
            <View style={styles.fieldHalf}>
              <Input label="Unit (optional)" value={unit} onChangeText={setUnit} placeholder="e.g. drinks" />
            </View>
          </View>
          <Input label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Anything worth remembering" multiline numberOfLines={3} />
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
  strip: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  cell: { alignItems: 'center', gap: 6, minWidth: 32 },
  dot: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: '#7CF5D3' },
  dotOff: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)' },
  dotCount: { fontSize: 10, fontWeight: '700', color: GV.ink },
  cellDay: { ...TYPE.caption, fontSize: 12, color: GV.fog, fontVariant: ['tabular-nums'] },
  weekTotal: { ...TYPE.caption, color: GV.muted, textAlign: 'center', marginTop: 8 },
  list: { gap: SPACE.cardGap },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowMain: { flex: 1, gap: 4 },
  rowTitle: { ...TYPE.button, fontSize: 15, color: GV.ink },
  rowSub: { ...TYPE.caption, color: GV.body, fontVariant: ['tabular-nums'] },
  rowNotes: { ...TYPE.caption, color: GV.muted },
  rowActions: { flexDirection: 'row', gap: 4 },
  rowBtn: { minWidth: 44, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  rowBtnText: { ...TYPE.chip, color: GV.cta },
  deleteText: { color: GV.danger },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
  form: { gap: 12 },
  fieldLabel: { ...TYPE.caption, color: GV.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fieldRow: { flexDirection: 'row', gap: 12 },
  fieldHalf: { flex: 1 },
  error: { ...TYPE.caption, color: GV.danger },
});
