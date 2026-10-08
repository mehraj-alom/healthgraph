/**
 * CycleScreen — explicit cycle tracking (device-only).
 *
 * User-entered starts, ends, and notes grouped into plain history spans,
 * plus estimates from recorded starts: an expected next-period range and
 * an approximate fertile window. Estimates are labeled as estimates with
 * their basis attached — never certainties, never for contraception, no
 * condition inference. A per-patient reproductive mode (standard / trying
 * to conceive / pregnant / perimenopause) reshapes the top card: TTC
 * surfaces the fertile window for planning with an ovulation-test log,
 * pregnant shows the week from a recorded LMP or due date with a
 * logistics checklist, perimenopause frames cycle variability with no
 * condition claims. All rows are patient-scoped SQLite or device storage;
 * nothing syncs (the UI says so).
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
import { useFocusEffect } from '@react-navigation/native';
import { Button, Chip, EmptyState, Input, Modal } from '@/components';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { SPACE } from '@/theme/guava';
import { LG } from '@/theme/liquidGlass';
import { todayKeyLocal } from '@/utils/dayKey';
import { EXTRA_TONES, TILE_TONES } from '@/theme/tones';
import { getCachedPatientId } from '@/services/patientIdentity';
import {
  describePrediction,
  cycleStats,
  fertileEstimate,
  predictNextPeriod,
} from '@/services/cyclePredictions';
import {
  PRENATAL_CHECKLIST,
  TTC_DISCLAIMER,
  periNote,
  pregnancyWeekFromDueDate,
  pregnancyWeekFromLmp,
  ttcCard,
  type OvulationResult,
  type ReproductiveMode,
} from '@/services/reproductiveModes';
import {
  addOvulationTest,
  getAnchor,
  getMode,
  getOvulationTests,
  setAnchor,
  setMode,
  type StoredAnchor,
  type StoredOvulationTests,
} from '@/services/reproductiveModeStore';
import { useCyclePatterns } from '@/hooks/useCyclePatterns';
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

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

const KIND_COPY: Record<CycleKind, { label: string; hint: string }> = {
  'period-start': { label: 'Period start', hint: 'First day of bleeding' },
  'period-end': { label: 'Period end', hint: 'Last day of bleeding' },
  note: { label: 'Note', hint: 'Symptom or observation' },
};

/** Kind tones: start berry, end pine (complete), note slate. */
const CYCLE_TONES: Record<CycleKind, string> = {
  'period-start': EXTRA_TONES.berry[1],
  'period-end': TILE_TONES.heart[1],
  note: EXTRA_TONES.slate[1],
};

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function dayKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Month grid, Monday-first. Cells hold an ISO date or null (padding). */
function monthMatrix(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => dayKey(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Month calendar: recorded days carry kind dots. Tap a day to log it. */
function CycleCalendar({
  entries,
  monthOffset,
  onOffset,
  onPickDay,
}: {
  entries: CycleEntry[];
  monthOffset: number;
  onOffset: (delta: number) => void;
  onPickDay: (dateKey: string) => void;
}) {
  const now = new Date();
  const view = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const year = view.getFullYear();
  const month = view.getMonth();
  const today = dayKey(now.getFullYear(), now.getMonth(), now.getDate());
  const byDate = new Map<string, CycleKind[]>();
  for (const e of entries) {
    const list = byDate.get(e.date) ?? [];
    if (list.length < 3) list.push(e.kind);
    byDate.set(e.date, list);
  }
  return (
    <GlassSurface strong style={styles.calCard}>
      <View style={styles.calHead}>
        <Pressable
          onPress={() => onOffset(-1)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          style={styles.calNav}
        >
          <Text style={styles.calNavText}>‹</Text>
        </Pressable>
        <Text style={styles.calTitle}>
          {view.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </Text>
        <Pressable
          onPress={() => onOffset(1)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          style={styles.calNav}
        >
          <Text style={styles.calNavText}>›</Text>
        </Pressable>
      </View>
      <View style={styles.calWeekRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={i} style={styles.calWeekday}>
            {w}
          </Text>
        ))}
      </View>
      {monthMatrix(year, month).map((week, wi) => (
        <View key={wi} style={styles.calWeekRow}>
          {week.map((key, di) => {
            if (key == null) return <View key={di} style={styles.calCell} />;
            const kinds = byDate.get(key) ?? [];
            const isToday = key === today;
            return (
              <Pressable
                key={di}
                onPress={() => onPickDay(key)}
                accessibilityRole="button"
                accessibilityLabel={`${key}${kinds.length > 0 ? `, ${kinds.length} entries` : ''}`}
                style={styles.calCell}
              >
                <View style={[styles.calDay, isToday && styles.calDayToday]}>
                  <Text style={[styles.calNum, isToday && styles.calNumToday]}>{Number(key.slice(8))}</Text>
                </View>
                <View style={styles.calDots}>
                  {kinds.map((k, ki) => (
                    <View key={ki} style={[styles.calDot, { backgroundColor: CYCLE_TONES[k] }]} />
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </GlassSurface>
  );
}

function shortDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function spanTitle(start: string | null, endExclusive: string | null): string {
  if (!start) return 'Notes';
  if (!endExclusive) return `Started ${shortDay(start)} · ongoing`;
  const days = Math.round(
    (new Date(`${endExclusive}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()) /
      86400000,
  );
  return `Started ${shortDay(start)} · ${days} day${days === 1 ? '' : 's'}`;
}

export default function CycleScreen() {
  const [entries, setEntries] = useState<CycleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CycleEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);

  const [kind, setKind] = useState<CycleKind>('period-start');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');

  const [mode, setModeState] = useState<ReproductiveMode>('standard');
  const [anchor, setAnchorState] = useState<StoredAnchor | null>(null);
  const [ovu, setOvu] = useState<StoredOvulationTests | null>(null);
  const [lmpInput, setLmpInput] = useState('');
  const [dueInput, setDueInput] = useState('');
  const [ovuResult, setOvuResult] = useState<OvulationResult>('positive');
  const [modeMsg, setModeMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const patientId = getCachedPatientId();
      if (!patientId) {
        setEntries([]);
        setLoading(false);
        return;
      }
      setEntries(await listCycleEntries(patientId, 200));
      setModeState(await getMode(patientId));
      const a = await getAnchor(patientId);
      setAnchorState(a);
      setLmpInput(a.lmp ?? '');
      setDueInput(a.due ?? '');
      setOvu(await getOvulationTests(patientId));
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

  const todayKey = () => todayKeyLocal();

  const openAdd = useCallback((presetDate?: string) => {
    setEditing(null);
    setKind('period-start');
    setDate(presetDate ?? todayKey());
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

  const switchMode = useCallback(async (next: ReproductiveMode) => {
    const patientId = getCachedPatientId();
    if (!patientId) return;
    setModeState(await setMode(patientId, next));
    setModeMsg(null);
  }, []);

  const saveAnchor = useCallback(async () => {
    const patientId = getCachedPatientId();
    if (!patientId) return;
    const next = await setAnchor(patientId, { lmp: lmpInput.trim(), due: dueInput.trim() });
    setAnchorState(next);
    setLmpInput(next.lmp ?? '');
    setDueInput(next.due ?? '');
    setModeMsg(
      next.lmp === null && next.due === null
        ? 'Enter your last period start or due date to see the week.'
        : 'Saved on this device only.',
    );
  }, [lmpInput, dueInput]);

  const logOvu = useCallback(async () => {
    const patientId = getCachedPatientId();
    if (!patientId) return;
    try {
      setOvu(await addOvulationTest(patientId, { day: todayKeyLocal(), result: ovuResult }));
      setModeMsg('Logged on this device only.');
    } catch {
      setModeMsg('Could not log this test. Please try again.');
    }
  }, [ovuResult]);

  const starts = entries
    .filter((e) => e.kind === 'period-start')
    .map((e) => ({ date: e.date }));
  const periodPred = predictNextPeriod(starts);
  const fertileEst = fertileEstimate(starts);

  // Symptom patterns live in the hook so this tracker screen stays
  // device-only (batch3 wiring guard): no API imports, no network calls.
  const patternLines = useCyclePatterns(entries);

  return (
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Cycle</Text>
          <Text style={styles.sub}>Recorded days only.</Text>

          <Text style={styles.sectionTitle}>Mode</Text>
          <View style={styles.chips}>
            {(
              [
                ['standard', 'Standard'],
                ['ttc', 'Trying to conceive'],
                ['pregnant', 'Pregnant'],
                ['perimenopause', 'Perimenopause'],
              ] as [ReproductiveMode, string][]
            ).map(([m, label]) => (
              <Chip
                key={m}
                label={label}
                selected={mode === m}
                onPress={() => void switchMode(m)}
                size="medium"
                accessibilityLabel={`Cycle mode: ${label}`}
              />
            ))}
          </View>
          {modeMsg !== null ? <Text style={styles.avgSub}>{modeMsg}</Text> : null}

          {mode === 'ttc' ? (
            <>
              <Text style={styles.sectionTitle}>Trying to conceive</Text>
              <GlassSurface strong style={styles.card}>
                {(() => {
                  const card = ttcCard(starts);
                  if (card === null) {
                    return (
                      <Text style={styles.avgSub}>
                        Log at least 3 period starts to see a fertile-window estimate.
                      </Text>
                    );
                  }
                  return (
                    <>
                      <Text style={styles.bigValue}>
                        {`Fertile window roughly ${shortDay(card.fertileFrom)} – ${shortDay(card.fertileTo)}`}
                      </Text>
                      <Text style={styles.avgSub}>
                        {`Ovulation around ${shortDay(card.ovulationAround)} · from ${card.basedOn} past cycles`}
                      </Text>
                    </>
                  );
                })()}
                <Text style={styles.provenance}>{TTC_DISCLAIMER}</Text>
              </GlassSurface>
              <Text style={styles.sectionTitle}>Ovulation tests</Text>
              <GlassSurface strong style={styles.card}>
                <View style={styles.chips}>
                  {(['positive', 'negative'] as OvulationResult[]).map((r) => (
                    <Chip
                      key={r}
                      label={r === 'positive' ? 'Positive' : 'Negative'}
                      selected={ovuResult === r}
                      onPress={() => setOvuResult(r)}
                      size="medium"
                      accessibilityLabel={`Ovulation test result: ${r}`}
                    />
                  ))}
                </View>
                <Button title="Log today's test" variant="secondary" onPress={() => void logOvu()} size="medium" style={styles.whiteBtn} textStyle={styles.whiteBtnText} />
                {(ovu?.tests ?? []).length > 0 ? (
                  <Text style={styles.avgSub}>
                    {(ovu?.tests ?? [])
                      .slice(-5)
                      .reverse()
                      .map((t) => `${shortDay(t.day)}: ${t.result}`)
                      .join(' · ')}
                  </Text>
                ) : (
                  <Text style={styles.avgSub}>No tests logged yet.</Text>
                )}
              </GlassSurface>
            </>
          ) : null}
          {mode === 'pregnant' ? (
            <>
              <Text style={styles.sectionTitle}>Pregnancy</Text>
              <GlassSurface strong style={styles.card}>
                {(() => {
                  const today = todayKeyLocal();
                  const week =
                    anchor?.lmp !== null && anchor?.lmp !== undefined
                      ? pregnancyWeekFromLmp(anchor.lmp, today)
                      : anchor?.due
                        ? pregnancyWeekFromDueDate(anchor.due, today)
                        : null;
                  if (week === null) {
                    return (
                      <Text style={styles.avgSub}>
                        Enter your last period start or your due date below to see the current week.
                      </Text>
                    );
                  }
                  return (
                    <>
                      <Text style={styles.bigValue}>{`Week ${week} of pregnancy`}</Text>
                      <Text style={styles.avgSub}>
                        From your recorded {anchor?.lmp ? 'last period start' : 'due date'} — an
                        estimate, not medical advice. Discuss everything with your provider.
                      </Text>
                    </>
                  );
                })()}
                <Input
                  label="Last period start (YYYY-MM-DD)"
                  value={lmpInput}
                  onChangeText={setLmpInput}
                  placeholder="2026-08-01"
                />
                <Input
                  label="Due date (YYYY-MM-DD)"
                  value={dueInput}
                  onChangeText={setDueInput}
                  placeholder="2027-05-08"
                />
                <Button title="Save dates" variant="secondary" onPress={() => void saveAnchor()} size="medium" style={styles.whiteBtn} textStyle={styles.whiteBtnText} />
              </GlassSurface>
              <Text style={styles.sectionTitle}>Before your visit</Text>
              <GlassSurface strong style={styles.card}>
                {PRENATAL_CHECKLIST.map((item) => (
                  <Text key={item} style={styles.avgSub}>{`• ${item}`}</Text>
                ))}
                <Text style={styles.provenance}>
                  Logistics topics for your provider — not medical guidance.
                </Text>
              </GlassSurface>
            </>
          ) : null}
          {mode === 'perimenopause' ? (
            <>
              <Text style={styles.sectionTitle}>Perimenopause</Text>
              <GlassSurface strong style={styles.card}>
                {(() => {
                  const note = periNote(cycleStats(starts));
                  return (
                    <Text style={styles.avgSub}>
                      {note ?? 'Log period starts to see how your cycle timing varies over time.'}
                    </Text>
                  );
                })()}
                <Text style={styles.provenance}>
                  Timing variability only — this screen does not assess symptoms or conditions.
                </Text>
              </GlassSurface>
            </>
          ) : null}

          <Text style={styles.sectionTitle}>History</Text>
          {mode === 'standard' && !loading && (periodPred !== null || fertileEst !== null) ? (
            <>
              <Text style={styles.sectionTitle}>Coming up</Text>
              <GlassSurface strong style={styles.card}>
                {periodPred !== null ? (
                  <>
                    <Text style={styles.bigValue}>{describePrediction(periodPred)}</Text>
                    <Text style={styles.avgSub}>Next period · estimated range</Text>
                  </>
                ) : null}
                {fertileEst !== null ? (
                  <Text style={styles.avgSub}>
                    {`Fertile window roughly ${shortDay(fertileEst.fertileFrom)} – ${shortDay(fertileEst.fertileTo)}`}
                  </Text>
                ) : null}
                <Text style={styles.provenance}>
                  Estimates from recorded starts — not for contraception, not medical advice.
                </Text>
              </GlassSurface>
            </>
          ) : null}
          {patternLines !== null && patternLines.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Patterns</Text>
              <GlassSurface strong style={styles.card}>
                {patternLines.map((line) => (
                  <Text key={line} style={styles.avgSub}>{line}</Text>
                ))}
                <Text style={styles.provenance}>
                  Logged symptoms placed in cycle phases · co-occurrence counts only.
                </Text>
              </GlassSurface>
            </>
          ) : null}
          {!loading && (
            <CycleCalendar
              entries={entries}
              monthOffset={monthOffset}
              onOffset={(d) => setMonthOffset((m) => m + d)}
              onPickDay={(key) => openAdd(key)}
            />
          )}
          {loading ? (
            <View style={styles.center}>
              <Text style={styles.loading}>Loading…</Text>
            </View>
          ) : spans.length === 0 ? (
            <EmptyState
              title="No cycle entries yet"
              message="Record a period start to begin."
            />
          ) : (
            <View style={styles.list}>
              {spans.map((span, i) => (
                <GlassSurface key={`${span.start ?? 'notes'}-${i}`} strong style={styles.card}>
                  <Text style={styles.spanTitle}>{spanTitle(span.start, span.endExclusive)}</Text>
                  {span.entries.map((entry, j) => (
                    <View
                      key={entry.entry_id}
                      style={[styles.entryRow, j > 0 && styles.entryRowDivided]}
                    >
                      <View style={styles.entryMain}>
                        <View style={styles.kindRow}>
                          <View style={[styles.kindDot, { backgroundColor: CYCLE_TONES[entry.kind] }]} />
                          <Text style={styles.entryKind}>{KIND_COPY[entry.kind].label}</Text>
                        </View>
                        <Text style={styles.entryDate}>{shortDay(entry.date)}</Text>
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
                </GlassSurface>
              ))}
            </View>
          )}

          <Text style={styles.disclaimer}>
            Recorded history plus estimates. Estimates are not for contraception — not medical advice, diagnosis, or treatment.
          </Text>
          <Button
            title="Add entry"
            variant="secondary"
            onPress={() => openAdd()}
            fullWidth
            size="large"
            style={styles.addBtn}
            textStyle={styles.addBtnText}
          />
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
                  color={CYCLE_TONES[k]}
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
              variant="secondary"
              onPress={() => void handleSave()}
              disabled={saving}
              loading={saving}
              fullWidth
              style={styles.whiteBtn}
              textStyle={styles.whiteBtnText}
            />
            <Button title="Cancel" variant="ghost" onPress={() => setShowForm(false)} fullWidth textStyle={styles.ghostText} />
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
  addBtn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  addBtnText: { color: '#0B0F1A' },
  whiteBtn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  whiteBtnText: { color: '#0B0F1A' },
  ghostText: { color: '#FFFFFF' },
  title: { fontWeight: '600', fontSize: 34, lineHeight: 41, letterSpacing: -0.8, color: '#FFFFFF', textAlign: 'center' },
  sub: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center' },
  sectionTitle: { fontWeight: '600', fontSize: 20, lineHeight: 26, letterSpacing: -0.4, color: '#FFFFFF', marginTop: 8 },
  loading: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: SECONDARY, textAlign: 'center', marginTop: 16 },
  center: { alignItems: 'center', paddingVertical: 24 },
  list: { gap: 12 },
  calCard: { padding: 16 },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  calNav: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  calNavText: { fontWeight: '600', fontSize: 22, lineHeight: 28, color: '#FFFFFF' },
  calTitle: { fontWeight: '600', fontSize: 17, lineHeight: 22, color: '#FFFFFF' },
  calWeekRow: { flexDirection: 'row' },
  calWeekday: {
    flex: 1,
    textAlign: 'center',
    fontWeight: '600',
    fontSize: 11,
    lineHeight: 16,
    color: SECONDARY,
    paddingVertical: 4,
  },
  calCell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  calDay: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calDayToday: { borderWidth: 1.5, borderColor: LG.card.mint },
  calNum: { fontSize: 14, lineHeight: 18, fontWeight: '400', color: 'rgba(255,255,255,0.85)', fontVariant: ['tabular-nums'] },
  calNumToday: { fontWeight: '600', color: '#FFFFFF' },
  calDots: { flexDirection: 'row', gap: 3, height: 8, alignItems: 'center', justifyContent: 'center' },
  calDot: { width: 6, height: 6, borderRadius: 3 },
  spanTitle: { fontWeight: '600', fontSize: 17, lineHeight: 22, color: '#FFFFFF', marginBottom: 8, fontVariant: ['tabular-nums'] },
  card: { padding: 16 },
  bigValue: { fontWeight: '600', fontSize: 20, lineHeight: 26, color: '#FFFFFF', textAlign: 'center', fontVariant: ['tabular-nums'] },
  avgSub: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, textAlign: 'center', marginTop: 4, fontVariant: ['tabular-nums'] },
  provenance: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center', marginTop: 8 },
  entryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8 },
  entryRowDivided: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  entryMain: { flex: 1, gap: 2 },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kindDot: { width: 8, height: 8, borderRadius: 4 },
  entryKind: { fontWeight: '600', fontSize: 15, lineHeight: 20, color: '#FFFFFF' },
  entryDate: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, fontVariant: ['tabular-nums'] },
  entryNotes: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY },
  entryActions: { flexDirection: 'row', gap: 4 },
  rowBtn: { minWidth: 44, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  rowBtnText: { fontWeight: '600', fontSize: 13, lineHeight: 18, color: '#FFFFFF' },
  deleteText: { color: LG.card.danger },
  disclaimer: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY, textAlign: 'center' },
  form: { gap: 12 },
  fieldLabel: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: TERTIARY },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  error: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: LG.card.danger },
});
