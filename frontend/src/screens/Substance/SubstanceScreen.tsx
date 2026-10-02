/**
 * SubstanceScreen — neutral substance-use tracking (device-only).
 *
 * Tracking, NOT treatment: record what happened (category, occasion, amount
 * as entered, notes) and review real history with a weekly strip. Goals,
 * streaks, and milestones below are descriptive counts of logged days —
 * never advice, never conversions of unknown-size units, never withdrawal
 * or treatment content anywhere on this screen. All rows are patient-scoped
 * SQLite; nothing syncs (the UI says so).
 */

import { useCallback, useEffect, useState } from 'react';
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
import { Button, Card, Chip, EmptyState, Input, Modal, SectionHeader } from '@/components';
import { HealthFact } from '@/components/HealthFact';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { EXTRA_TONES } from '@/theme/tones';
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
import {
  goalStatusLine,
  milestonesReached,
  normalizeGoal,
  streakDays,
  weeklyUse,
  type GoalCategory,
  type GoalMode,
  type SubstanceGoal,
} from '@/services/substanceGoals';
import { getSubstanceGoals, setSubstanceGoal } from '@/services/substanceGoalStore';
import {
  CRAVING_TRIGGERS,
  cravingStatusLine,
  deleteCravingEntry,
  insertCravingEntry,
  listCravingEntries,
  normalizeCravingInput,
  summarizeCravingWeek,
  triggerLabel,
  updateCravingEntry,
  type CravingEntry,
  type CravingOutcome,
  type CravingTrigger,
} from '@/db/queries/cravings';

const CATEGORY_COPY: Record<SubstanceCategory, { label: string; hint: string }> = {
  alcohol: { label: 'Alcohol', hint: 'Drinks and occasions' },
  tobacco: { label: 'Tobacco / nicotine', hint: 'Smoked, vaped or chewed' },
  other: { label: 'Other', hint: 'Anything else you track' },
};

/** Category tones: warm sand, cool slate, pine teal. */
const SUBSTANCE_TONES: Record<SubstanceCategory, string> = {
  alcohol: EXTRA_TONES.sand[1],
  tobacco: EXTRA_TONES.slate[1],
  other: EXTRA_TONES.pine[1],
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

const GOAL_MODES: { mode: GoalMode; label: string }[] = [
  { mode: 'track', label: 'Track' },
  { mode: 'reduce', label: 'Cut back' },
  { mode: 'quit', label: 'Quit' },
];

/**
 * GoalsSection — per-category goals with streak + milestone progress.
 * Counts logged days only; unknown-size units are never converted.
 * Goals persist on-device next to the entries they govern.
 */
function GoalsSection({ entries, today }: { entries: SubstanceEntry[]; today: string }) {
  const [goals, setGoals] = useState<{ alcohol: SubstanceGoal; tobacco: SubstanceGoal } | null>(null);
  const [caps, setCaps] = useState<{ alcohol: string; tobacco: string }>({ alcohol: '', tobacco: '' });
  const [saving, setSaving] = useState<GoalCategory | null>(null);

  useEffect(() => {
    const patientId = getCachedPatientId();
    if (!patientId) return;
    void getSubstanceGoals(patientId).then((g) => {
      setGoals({ alcohol: g.alcohol, tobacco: g.tobacco });
      setCaps({
        alcohol: g.alcohol.weeklyCap != null ? String(g.alcohol.weeklyCap) : '',
        tobacco: g.tobacco.weeklyCap != null ? String(g.tobacco.weeklyCap) : '',
      });
    });
  }, []);

  const save = useCallback(
    async (category: GoalCategory, mode: GoalMode) => {
      const patientId = getCachedPatientId();
      if (!patientId) return;
      setSaving(category);
      try {
        const cap = Number(caps[category]);
        const next = await setSubstanceGoal(patientId, normalizeGoal({
          category,
          mode,
          ...(mode === 'reduce' && Number.isInteger(cap) && cap > 0 ? { weeklyCap: cap } : {}),
        }));
        setGoals({ alcohol: next.alcohol, tobacco: next.tobacco });
      } finally {
        setSaving(null);
      }
    },
    [caps],
  );

  if (!goals) return null;
  return (
    <>
      {(['alcohol', 'tobacco'] as GoalCategory[]).map((category) => {
        const goal = goals[category];
        const use = weeklyUse(entries, category, today);
        const streak = streakDays(entries, category, today, goal.quitDate);
        const miles = milestonesReached(streak);
        return (
          <View key={category}>
            <SectionHeader
              dark
              title={category === 'alcohol' ? 'Alcohol goal' : 'Tobacco goal'}
              titleStyle={styles.histTitle}
            />
            <Card style={styles.darkCard}>
              <View style={styles.chipRow}>
                {GOAL_MODES.map((m) => (
                  <Chip
                    key={m.mode}
                    label={m.label}
                    selected={goal.mode === m.mode}
                    onPress={() => void save(category, m.mode)}
                  />
                ))}
              </View>
              {goal.mode === 'reduce' ? (
                <View style={styles.capRow}>
                  <Input
                    label="Weekly cap (drinks)"
                    value={caps[category]}
                    onChangeText={(v) => setCaps((c) => ({ ...c, [category]: v.replace(/[^0-9]/g, '') }))}
                    placeholder="7"
                    keyboardType="number-pad"
                  />
                  <Button
                    title="Set"
                    onPress={() => void save(category, 'reduce')}
                    disabled={saving === category}
                    style={styles.capBtn}
                    textStyle={styles.capBtnText}
                  />
                </View>
              ) : null}
              <Text style={styles.bigValue}>{streak}</Text>
              <Text style={styles.avgSub}>
                {streak === 1 ? 'day without logged use' : 'days without logged use'}
              </Text>
              <Text style={styles.avgSub}>{goalStatusLine(goal, use, streak)}</Text>
              <Text style={styles.provenance}>
                {miles.reached.length > 0
                  ? `Milestones: ${miles.reached.join(' · ')} days${miles.next != null ? ` · next ${miles.next}` : ' · ladder complete'}`
                  : miles.next != null
                    ? `First milestone at ${miles.next} ${miles.next === 1 ? 'day' : 'days'}`
                    : 'No milestones set'}
              </Text>
              <Text style={styles.provenance}>Counts logged days on this device only.</Text>
            </Card>
          </View>
        );
      })}
    </>
  );
}

export default function SubstanceScreen() {
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

  const [cravings, setCravings] = useState<CravingEntry[]>([]);
  const [showCravingForm, setShowCravingForm] = useState(false);
  const [editingCraving, setEditingCraving] = useState<CravingEntry | null>(null);
  const [savingCraving, setSavingCraving] = useState(false);
  const [cravingError, setCravingError] = useState<string | null>(null);

  const [cravingCategory, setCravingCategory] = useState<SubstanceCategory>('alcohol');
  const [cravingTrigger, setCravingTrigger] = useState<CravingTrigger | null>(null);
  const [cravingDate, setCravingDate] = useState('');
  const [cravingTime, setCravingTime] = useState('');
  const [cravingIntensity, setCravingIntensity] = useState('');
  const [cravingOutcome, setCravingOutcome] = useState<CravingOutcome | null>(null);
  const [cravingNotes, setCravingNotes] = useState('');

  const load = useCallback(async () => {
    try {
      const patientId = getCachedPatientId();
      if (!patientId) {
        setEntries([]);
        setCravings([]);
        setLoading(false);
        return;
      }
      setEntries(await listSubstanceEntries(patientId, 200));
      setCravings(await listCravingEntries(patientId, 200));
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

  const openAddCraving = useCallback(() => {
    const now = new Date();
    setEditingCraving(null);
    setCravingCategory('alcohol');
    setCravingTrigger(null);
    setCravingDate(todayKey(now));
    setCravingTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    setCravingIntensity('');
    setCravingOutcome(null);
    setCravingNotes('');
    setCravingError(null);
    setShowCravingForm(true);
  }, []);

  const openEditCraving = useCallback((entry: CravingEntry) => {
    const d = new Date(entry.occurred_at);
    setEditingCraving(entry);
    setCravingCategory(entry.category);
    setCravingTrigger(entry.trigger);
    setCravingDate(Number.isNaN(d.getTime()) ? todayKey() : todayKey(d));
    setCravingTime(
      Number.isNaN(d.getTime())
        ? '12:00'
        : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    );
    setCravingIntensity(entry.intensity != null ? String(entry.intensity) : '');
    setCravingOutcome(entry.outcome);
    setCravingNotes(entry.notes ?? '');
    setCravingError(null);
    setShowCravingForm(true);
  }, []);

  const handleSaveCraving = useCallback(async () => {
    if (savingCraving) return;
    const patientId = getCachedPatientId();
    if (!patientId) {
      setCravingError('Your session has expired. Please sign in again.');
      return;
    }
    let input;
    try {
      input = normalizeCravingInput({
        category: cravingCategory,
        trigger: cravingTrigger,
        occurred_at: `${cravingDate}T${cravingTime || '12:00'}:00`,
        intensity: cravingIntensity.trim() ? Number(cravingIntensity) : null,
        outcome: cravingOutcome,
        notes: cravingNotes,
      });
    } catch (err) {
      setCravingError(err instanceof Error ? err.message : 'Check the highlighted fields.');
      return;
    }
    setSavingCraving(true);
    try {
      if (editingCraving) {
        await updateCravingEntry(patientId, editingCraving.entry_id, input);
      } else {
        await insertCravingEntry(patientId, input);
      }
      setShowCravingForm(false);
      await load();
    } catch {
      setCravingError('Could not save this entry. Please try again.');
    } finally {
      setSavingCraving(false);
    }
  }, [savingCraving, cravingCategory, cravingTrigger, cravingDate, cravingTime, cravingIntensity, cravingOutcome, cravingNotes, editingCraving, load]);

  const confirmDeleteCraving = useCallback(
    (entry: CravingEntry) => {
      Alert.alert('Delete entry?', 'This removes the entry from this device. This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const patientId = getCachedPatientId();
            if (!patientId) return;
            void deleteCravingEntry(patientId, entry.entry_id).then(() => load());
          },
        },
      ]);
    },
    [load],
  );

  const cravingWeek = summarizeCravingWeek(cravings, todayKey());
  const cravingLine = cravingStatusLine(cravingWeek);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Substance use.</Text>
        <Text style={styles.sub}>A private log. Not advice, not a diagnosis.</Text>

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
            {weekTotal === 0 ? 'Nothing recorded this week.' : `${weekTotal} ${weekTotal === 1 ? 'entry' : 'entries'} this week.`}
          </Text>
        </Card>

        <GoalsSection entries={entries} today={todayKey()} />

        <SectionHeader dark title="Cravings" titleStyle={styles.histTitle} />
        <Card style={styles.darkCard}>
          <Text style={styles.weekTotal}>{cravingLine}</Text>
          {cravingWeek.topTrigger !== null ? (
            <Text style={styles.avgSub}>
              Most logged setting: {triggerLabel(cravingWeek.topTrigger)} ({cravingWeek.byTrigger[cravingWeek.topTrigger] ?? 0} of {cravingWeek.total})
            </Text>
          ) : null}
          <Text style={styles.provenance}>
            Logged moments with their setting · last 7 days.
          </Text>
        </Card>
        {cravings.length > 0 ? (
          <View style={styles.list}>
            {cravings.slice(0, 10).map((entry) => (
              <Card key={entry.entry_id} style={styles.darkCard}>
                <View style={styles.rowTop}>
                  <View style={styles.rowMain}>
                    <View style={styles.kindRow}>
                      <View style={[styles.kindDot, { backgroundColor: SUBSTANCE_TONES[entry.category] }]} />
                      <Text style={styles.rowTitle}>
                        {CATEGORY_COPY[entry.category].label}
                        {entry.trigger ? ` · ${triggerLabel(entry.trigger)}` : ''}
                        {entry.intensity != null ? ` · ${entry.intensity}/5` : ''}
                      </Text>
                    </View>
                    <Text style={styles.rowSub}>
                      {formatWhen(entry.occurred_at)}
                      {entry.outcome === 'passed' ? ' · Passed' : entry.outcome === 'used' ? ' · Used after' : ''}
                    </Text>
                    {entry.notes ? <Text style={styles.rowNotes}>{entry.notes}</Text> : null}
                  </View>
                  <View style={styles.rowActions}>
                    <Pressable
                      onPress={() => openEditCraving(entry)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Edit craving entry"
                      style={styles.rowBtn}
                    >
                      <Text style={styles.rowBtnText}>Edit</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => confirmDeleteCraving(entry)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Delete craving entry"
                      style={styles.rowBtn}
                    >
                      <Text style={[styles.rowBtnText, styles.deleteText]}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        ) : null}

        <SectionHeader dark title="History" titleStyle={styles.histTitle} />
        {loading ? (
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : entries.length === 0 ? (
          <EmptyState
            title="No entries yet"
            message="Record alcohol, tobacco, or anything else you track."
          />
        ) : (
          <View style={styles.list}>
            {entries.map((entry) => (
              <Card key={entry.entry_id} style={styles.darkCard}>
                <View style={styles.rowTop}>
                  <View style={styles.rowMain}>
                    <View style={styles.kindRow}>
                      <View style={[styles.kindDot, { backgroundColor: SUBSTANCE_TONES[entry.category] }]} />
                      <Text style={styles.rowTitle}>
                        {CATEGORY_COPY[entry.category].label}
                        {entry.label ? ` · ${entry.label}` : ''}
                      </Text>
                    </View>
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

        <Button
          title="Log entry"
          onPress={openAdd}
          fullWidth
          size="large"
          style={styles.logBtn}
          textStyle={styles.logBtnText}
        />
        <Button
          title="Log craving"
          variant="secondary"
          onPress={openAddCraving}
          fullWidth
          size="large"
        />
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

      <Modal
        visible={showCravingForm}
        onClose={() => setShowCravingForm(false)}
        title={editingCraving ? 'Edit craving' : 'Log craving'}
        subtitle="Stored on this device only."
      >
        <View style={styles.form}>
          <Text style={styles.fieldLabel}>Category</Text>
          <View style={styles.chips}>
            {SUBSTANCE_CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={CATEGORY_COPY[c].label}
                selected={cravingCategory === c}
                onPress={() => setCravingCategory(c)}
                size="medium"
                color={SUBSTANCE_TONES[c]}
              />
            ))}
          </View>
          <Text style={styles.fieldLabel}>What was happening (optional)</Text>
          <View style={styles.chips}>
            {CRAVING_TRIGGERS.map((t) => (
              <Chip
                key={t}
                label={triggerLabel(t)}
                selected={cravingTrigger === t}
                onPress={() => setCravingTrigger(cravingTrigger === t ? null : t)}
                size="medium"
              />
            ))}
          </View>
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <Input label="Date (YYYY-MM-DD)" value={cravingDate} onChangeText={setCravingDate} placeholder="2026-09-21" />
            </View>
            <View style={styles.fieldHalf}>
              <Input label="Time (HH:MM)" value={cravingTime} onChangeText={setCravingTime} placeholder="19:30" />
            </View>
          </View>
          <Text style={styles.fieldLabel}>How strong, 1–5 (optional)</Text>
          <View style={styles.chips}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Chip
                key={n}
                label={String(n)}
                selected={cravingIntensity === String(n)}
                onPress={() => setCravingIntensity(cravingIntensity === String(n) ? '' : String(n))}
                size="medium"
              />
            ))}
          </View>
          <Text style={styles.fieldLabel}>What followed (optional)</Text>
          <View style={styles.chips}>
            <Chip
              label="Passed"
              selected={cravingOutcome === 'passed'}
              onPress={() => setCravingOutcome(cravingOutcome === 'passed' ? null : 'passed')}
              size="medium"
            />
            <Chip
              label="Used after"
              selected={cravingOutcome === 'used'}
              onPress={() => setCravingOutcome(cravingOutcome === 'used' ? null : 'used')}
              size="medium"
            />
          </View>
          <Input label="Notes (optional)" value={cravingNotes} onChangeText={setCravingNotes} placeholder="Anything worth remembering" multiline numberOfLines={3} />
          {cravingError ? <Text style={styles.error}>{cravingError}</Text> : null}
          <Button
            title={savingCraving ? 'Saving…' : editingCraving ? 'Save changes' : 'Save craving'}
            onPress={() => void handleSaveCraving()}
            disabled={savingCraving}
            loading={savingCraving}
            fullWidth
          />
          <Button title="Cancel" variant="ghost" onPress={() => setShowCravingForm(false)} fullWidth />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080A11' },
  content: { paddingHorizontal: SPACE.screenH, paddingVertical: SPACE.sectionGap, paddingBottom: 32, gap: 12 },
  title: { fontFamily: FONT.semi, fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: '#FFFFFF', textAlign: 'center' },
  sub: { ...TYPE.body, color: GV.fog, textAlign: 'center' },
  histTitle: { fontSize: 20, lineHeight: 24, letterSpacing: -0.3 },
  loading: { ...TYPE.body, color: GV.fog, textAlign: 'center', marginTop: 16 },
  fact: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  darkCard: {
    backgroundColor: '#10141F',
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  strip: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  cell: { alignItems: 'center', gap: 6, minWidth: 32 },
  dot: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: '#7CF5D3' },
  dotOff: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)' },
  dotCount: { fontSize: 10, fontWeight: '700', color: '#062A26' },
  cellDay: { ...TYPE.caption, fontSize: 12, color: GV.fog, fontVariant: ['tabular-nums'] },
  weekTotal: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  bigValue: { ...TYPE.display, fontSize: 40, color: '#FFFFFF', textAlign: 'center', fontVariant: ['tabular-nums'] },
  avgSub: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 4, fontVariant: ['tabular-nums'] },
  provenance: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  capRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginTop: 8 },
  capBtn: { backgroundColor: '#4FD1C5', paddingHorizontal: 18 },
  capBtnText: { color: '#062A26' },
  list: { gap: SPACE.cardGap },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowMain: { flex: 1, gap: 4 },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kindDot: { width: 8, height: 8, borderRadius: 4 },
  rowTitle: { ...TYPE.button, fontSize: 15, color: '#FFFFFF' },
  rowSub: { ...TYPE.caption, color: GV.fog, fontVariant: ['tabular-nums'] },
  rowNotes: { ...TYPE.caption, color: '#8B95A7' },
  rowActions: { flexDirection: 'row', gap: 4 },
  rowBtn: { minWidth: 44, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  rowBtnText: { ...TYPE.chip, color: '#3DDC84' },
  deleteText: { color: GV.danger },
  logBtn: { backgroundColor: '#4FD1C5' },
  logBtnText: { color: '#062A26' },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
  form: { gap: 12 },
  fieldLabel: { ...TYPE.caption, color: GV.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fieldRow: { flexDirection: 'row', gap: 12 },
  fieldHalf: { flex: 1 },
  error: { ...TYPE.caption, color: GV.danger },
});
