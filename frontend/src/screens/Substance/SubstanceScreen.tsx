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
import { Button, Chip, EmptyState, Input, Modal } from '@/components';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { SPACE } from '@/theme/guava';
import { LG } from '@/theme/liquidGlass';
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
  addPledge,
  getPledges,
  getSavings,
  setSavingsPlan,
} from '@/services/substancePledgeStore';
import {
  hasPledgedToday,
  pledgeStreak,
  savingsSince,
  savingsStatusLine,
} from '@/services/substancePledge';
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

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

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
            <Text style={styles.sectionTitle}>
              {category === 'alcohol' ? 'Alcohol goal' : 'Tobacco goal'}
            </Text>
            <GlassSurface strong style={styles.card}>
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
                    variant="secondary"
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
            </GlassSurface>
          </View>
        );
      })}
    </>
  );
}

function PledgeSection({ today }: { today: string }) {
  const [pledges, setPledges] = useState<{ category: string; day: string; reason: string | null }[]>([]);
  const [reasons, setReasons] = useState<{ alcohol: string; tobacco: string }>({ alcohol: '', tobacco: '' });
  const [spends, setSpends] = useState<{ alcohol: string; tobacco: string }>({ alcohol: '', tobacco: '' });
  const [plans, setPlans] = useState<{ alcohol: { amountPerDay: number; currency: string } | null; tobacco: { amountPerDay: number; currency: string } | null }>({ alcohol: null, tobacco: null });
  const [quitDates, setQuitDates] = useState<{ alcohol?: string; tobacco?: string }>({});
  const [saving, setSaving] = useState<GoalCategory | null>(null);
  const [pledgeError, setPledgeError] = useState<string | null>(null);

  useEffect(() => {
    const patientId = getCachedPatientId();
    if (!patientId) return;
    void Promise.all([getPledges(patientId), getSavings(patientId), getSubstanceGoals(patientId)]).then(
      ([p, s, g]) => {
        setPledges(p.pledges);
        setPlans({ alcohol: s.alcohol, tobacco: s.tobacco });
        setSpends({
          alcohol: s.alcohol != null ? String(s.alcohol.amountPerDay) : '',
          tobacco: s.tobacco != null ? String(s.tobacco.amountPerDay) : '',
        });
        setQuitDates({
          ...(g.alcohol.quitDate ? { alcohol: g.alcohol.quitDate } : {}),
          ...(g.tobacco.quitDate ? { tobacco: g.tobacco.quitDate } : {}),
        });
      },
    );
  }, []);

  const pledge = useCallback(
    async (category: GoalCategory) => {
      const patientId = getCachedPatientId();
      if (!patientId || saving) return;
      setSaving(category);
      setPledgeError(null);
      try {
        const next = await addPledge(patientId, {
          category,
          day: today,
          reason: reasons[category],
        });
        setPledges(next.pledges);
        setReasons((r) => ({ ...r, [category]: '' }));
      } catch (err) {
        setPledgeError(err instanceof Error ? err.message : 'Could not save this pledge.');
      } finally {
        setSaving(null);
      }
    },
    [saving, reasons, today],
  );

  const saveSpend = useCallback(
    async (category: GoalCategory) => {
      const patientId = getCachedPatientId();
      if (!patientId || saving) return;
      setSaving(category);
      try {
        const next = await setSavingsPlan(patientId, {
          category,
          amountPerDay: spends[category].trim() ? Number(spends[category]) : null,
        });
        setPlans({ alcohol: next.alcohol, tobacco: next.tobacco });
      } catch {
        setPledgeError('Enter a typical spend per day above zero.');
      } finally {
        setSaving(null);
      }
    },
    [saving, spends],
  );

  return (
    <>
      {(['alcohol', 'tobacco'] as GoalCategory[]).map((category) => {
        const streak = pledgeStreak(pledges, category, today);
        const pledged = hasPledgedToday(pledges, category, today);
        const plan = plans[category];
        const firstPledge = pledges
          .filter((p) => p.category === category)
          .map((p) => p.day)
          .sort()[0];
        const summary = savingsSince(quitDates[category] ?? firstPledge ?? null, plan?.amountPerDay ?? null, today);
        return (
          <View key={category}>
            <Text style={styles.sectionTitle}>
              {category === 'alcohol' ? 'Alcohol pledge' : 'Tobacco pledge'}
            </Text>
            <GlassSurface strong style={styles.card}>
              <Text style={styles.bigValue}>{streak}</Text>
              <Text style={styles.avgSub}>
                {streak === 1 ? 'day in a row pledged' : 'days in a row pledged'}
              </Text>
              {!pledged ? (
                <>
                  <Input
                    label="Why — optional"
                    value={reasons[category]}
                    onChangeText={(v) => setReasons((r) => ({ ...r, [category]: v }))}
                    placeholder="One line for today"
                  />
                  <Button
                    title={saving === category ? 'Saving…' : 'Pledge today'}
                    variant="secondary"
                    onPress={() => void pledge(category)}
                    disabled={saving === category}
                    fullWidth
                    style={styles.capBtn}
                    textStyle={styles.capBtnText}
                  />
                </>
              ) : (
                <Text style={styles.avgSub}>Pledged for today.</Text>
              )}
              {pledgeError && saving === category ? <Text style={styles.error}>{pledgeError}</Text> : null}
              <View style={styles.capRow}>
                <Input
                  label="Typical spend per day"
                  value={spends[category]}
                  onChangeText={(v) => setSpends((s) => ({ ...s, [category]: v.replace(/[^0-9.]/g, '') }))}
                  placeholder="e.g. 12.50"
                  keyboardType="decimal-pad"
                />
                <Button
                  title="Set"
                  variant="secondary"
                  onPress={() => void saveSpend(category)}
                  disabled={saving === category}
                  style={styles.capBtn}
                  textStyle={styles.capBtnText}
                />
              </View>
              <Text style={styles.avgSub}>
                {savingsStatusLine(summary, plan?.currency ?? '$')}
              </Text>
              <Text style={styles.provenance}>Pledges and spend stay on this device only.</Text>
            </GlassSurface>
          </View>
        );
      })}
    </>
  );
}

export default function SubstanceScreen() {  const [entries, setEntries] = useState<SubstanceEntry[]>([]);
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
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Substance use</Text>
          <Text style={styles.sub}>A private log. Not advice, not a diagnosis.</Text>

          <Text style={styles.sectionTitle}>This week</Text>
          <GlassSurface strong style={styles.card}>
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
          </GlassSurface>

          <GoalsSection entries={entries} today={todayKey()} />

          <PledgeSection today={todayKey()} />

          <Text style={styles.sectionTitle}>Cravings</Text>
          <GlassSurface strong style={styles.card}>
            <Text style={styles.weekTotal}>{cravingLine}</Text>
            {cravingWeek.topTrigger !== null ? (
              <Text style={styles.avgSub}>
                Most logged setting: {triggerLabel(cravingWeek.topTrigger)} ({cravingWeek.byTrigger[cravingWeek.topTrigger] ?? 0} of {cravingWeek.total})
              </Text>
            ) : null}
            <Text style={styles.provenance}>
              Logged moments with their setting · last 7 days.
            </Text>
          </GlassSurface>
          {cravings.length > 0 ? (
            <View style={styles.list}>
              {cravings.slice(0, 10).map((entry) => (
                <GlassSurface key={entry.entry_id} strong style={styles.card}>
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
                </GlassSurface>
              ))}
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>History</Text>
          {loading ? (
            <View style={styles.center}>
              <Text style={styles.loading}>Loading…</Text>
            </View>
          ) : entries.length === 0 ? (
            <EmptyState
              title="No entries yet"
              message="Record alcohol, tobacco, or anything else you track."
            />
          ) : (
            <View style={styles.list}>
              {entries.map((entry) => (
                <GlassSurface key={entry.entry_id} strong style={styles.card}>
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
                </GlassSurface>
              ))}
            </View>
          )}

          <Button
            title="Log entry"
            variant="secondary"
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
            style={styles.logBtn}
            textStyle={styles.logBtnText}
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
              variant="secondary"
              onPress={() => void handleSave()}
              disabled={saving}
              loading={saving}
              fullWidth
              style={styles.logBtn}
              textStyle={styles.logBtnText}
            />
            <Button title="Cancel" variant="ghost" onPress={() => setShowForm(false)} fullWidth textStyle={styles.ghostText} />
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
              variant="secondary"
              onPress={() => void handleSaveCraving()}
              disabled={savingCraving}
              loading={savingCraving}
              fullWidth
              style={styles.logBtn}
              textStyle={styles.logBtnText}
            />
            <Button title="Cancel" variant="ghost" onPress={() => setShowCravingForm(false)} fullWidth textStyle={styles.ghostText} />
          </View>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070F' },
  safe: { flex: 1 },
  content: { paddingHorizontal: SPACE.screenH, paddingVertical: 12, paddingBottom: 32, gap: 12 },
  title: { fontWeight: '600', fontSize: 34, lineHeight: 41, letterSpacing: -0.8, color: '#FFFFFF', textAlign: 'center' },
  sub: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center' },
  sectionTitle: { fontWeight: '600', fontSize: 20, lineHeight: 26, letterSpacing: -0.4, color: '#FFFFFF', marginTop: 8 },
  loading: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center', marginTop: 16 },
  center: { alignItems: 'center', paddingVertical: 24 },
  card: { padding: 16 },
  strip: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  cell: { alignItems: 'center', gap: 6, minWidth: 32 },
  dot: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: '#7CF5D3' },
  dotOff: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)' },
  dotCount: { fontWeight: '700', fontSize: 10, lineHeight: 12, color: '#062A26' },
  cellDay: { fontWeight: '400', fontSize: 12, lineHeight: 16, color: SECONDARY, fontVariant: ['tabular-nums'] },
  weekTotal: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'center', marginTop: 8 },
  bigValue: { fontWeight: '600', fontSize: 40, lineHeight: 48, color: '#FFFFFF', textAlign: 'center', fontVariant: ['tabular-nums'] },
  avgSub: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'center', marginTop: 4, fontVariant: ['tabular-nums'] },
  provenance: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center', marginTop: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  capRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginTop: 8 },
  capBtn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF', paddingHorizontal: 18 },
  capBtnText: { color: '#0B0F1A' },
  list: { gap: 12 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowMain: { flex: 1, gap: 4 },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kindDot: { width: 8, height: 8, borderRadius: 4 },
  rowTitle: { fontWeight: '600', fontSize: 15, lineHeight: 20, color: '#FFFFFF' },
  rowSub: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, fontVariant: ['tabular-nums'] },
  rowNotes: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY },
  rowActions: { flexDirection: 'row', gap: 4 },
  rowBtn: { minWidth: 44, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  rowBtnText: { fontWeight: '600', fontSize: 13, lineHeight: 18, color: '#FFFFFF' },
  deleteText: { color: LG.card.danger },
  logBtn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  logBtnText: { color: '#0B0F1A' },
  ghostText: { color: '#FFFFFF' },
  disclaimer: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center' },
  form: { gap: 12 },
  fieldLabel: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fieldRow: { flexDirection: 'row', gap: 12 },
  fieldHalf: { flex: 1 },
  error: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: LG.card.danger },
});
