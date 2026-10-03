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
import { Button, Card, Chip, EmptyState, Input, Modal, SectionHeader } from '@/components';
import { HealthFact } from '@/components/HealthFact';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
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
    <View style={styles.calCard}>
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
    </View>
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
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Cycle.</Text>
        <Text style={styles.sub}>Recorded days only.</Text>

        <SectionHeader dark title="Mode" titleStyle={styles.histTitle} />
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
            <SectionHeader dark title="Trying to conceive" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
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
            </Card>
            <SectionHeader dark title="Ovulation tests" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
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
              <Button title="Log today's test" onPress={() => void logOvu()} size="medium" />
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
            </Card>
          </>
        ) : null}
        {mode === 'pregnant' ? (
          <>
            <SectionHeader dark title="Pregnancy" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
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
              <Button title="Save dates" onPress={() => void saveAnchor()} size="medium" />
            </Card>
            <SectionHeader dark title="Before your visit" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
              {PRENATAL_CHECKLIST.map((item) => (
                <Text key={item} style={styles.avgSub}>{`• ${item}`}</Text>
              ))}
              <Text style={styles.provenance}>
                Logistics topics for your provider — not medical guidance.
              </Text>
            </Card>
          </>
        ) : null}
        {mode === 'perimenopause' ? (
          <>
            <SectionHeader dark title="Perimenopause" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
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
            </Card>
          </>
        ) : null}

        <SectionHeader dark title="History" titleStyle={styles.histTitle} />
        {mode === 'standard' && !loading && (periodPred !== null || fertileEst !== null) ? (
          <>
            <SectionHeader dark title="Coming up" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
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
            </Card>
          </>
        ) : null}
        {patternLines !== null && patternLines.length > 0 ? (
          <>
            <SectionHeader dark title="Patterns" titleStyle={styles.histTitle} />
            <Card style={styles.darkCard}>
              {patternLines.map((line) => (
                <Text key={line} style={styles.avgSub}>{line}</Text>
              ))}
              <Text style={styles.provenance}>
                Logged symptoms placed in cycle phases · co-occurrence counts only.
              </Text>
            </Card>
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
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : spans.length === 0 ? (
          <EmptyState
            title="No cycle entries yet"
            message="Record a period start to begin."
          />
        ) : (
          <View style={styles.list}>
            {spans.map((span, i) => (
              <Card key={`${span.start ?? 'notes'}-${i}`} style={styles.spanCard}>
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
              </Card>
            ))}
          </View>
        )}

        <Text style={styles.disclaimer}>
          Recorded history plus estimates. Estimates are not for contraception — not medical advice, diagnosis, or treatment.
        </Text>
        <Button
          title="Add entry"
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
  safe: { flex: 1, backgroundColor: '#080A11' },
  content: { paddingHorizontal: 26, paddingVertical: SPACE.sectionGap, paddingBottom: 32, gap: 12 },
  backHit: { minHeight: 44, justifyContent: 'center' },
  backText: { ...TYPE.button, fontSize: 16, color: GV.fog },
  addBtn: { backgroundColor: '#4FD1C5' },
  addBtnText: { color: '#062A26' },
  title: { fontFamily: FONT.semi, fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: '#FFFFFF', textAlign: 'center' },
  sub: { ...TYPE.body, color: GV.fog, textAlign: 'center' },
  histTitle: { fontSize: 20, lineHeight: 24, letterSpacing: -0.3 },
  loading: { ...TYPE.body, color: GV.fog, textAlign: 'center', marginTop: 16 },
  fact: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  list: { gap: SPACE.cardGap },
  calCard: {
    backgroundColor: '#10141F',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  calNav: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  calNavText: { fontSize: 22, fontFamily: FONT.semi, color: '#FFFFFF' },
  calTitle: { fontFamily: FONT.semi, fontSize: 17, lineHeight: 22, color: '#FFFFFF' },
  calWeekRow: { flexDirection: 'row' },
  calWeekday: {
    flex: 1,
    textAlign: 'center',
    fontFamily: FONT.semi,
    fontSize: 11,
    lineHeight: 16,
    color: GV.fog,
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
  calDayToday: { borderWidth: 1.5, borderColor: '#4FD1C5' },
  calNum: { fontSize: 14, lineHeight: 18, fontFamily: FONT.regular, color: 'rgba(255,255,255,0.85)', fontVariant: ['tabular-nums'] },
  calNumToday: { fontFamily: FONT.semi, color: '#FFFFFF' },
  calDots: { flexDirection: 'row', gap: 3, height: 8, alignItems: 'center', justifyContent: 'center' },
  calDot: { width: 6, height: 6, borderRadius: 3 },
  spanCard: {
    backgroundColor: '#10141F',
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  spanTitle: { fontFamily: FONT.semi, fontSize: 17, lineHeight: 22, color: '#FFFFFF', marginBottom: 8, fontVariant: ['tabular-nums'] },
  darkCard: {
    backgroundColor: '#10141F',
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  bigValue: { fontFamily: FONT.semi, fontSize: 20, lineHeight: 26, color: '#FFFFFF', textAlign: 'center', fontVariant: ['tabular-nums'] },
  avgSub: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 4, fontVariant: ['tabular-nums'] },
  provenance: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  entryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8 },
  entryRowDivided: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  entryMain: { flex: 1, gap: 2 },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kindDot: { width: 8, height: 8, borderRadius: 4 },
  entryKind: { ...TYPE.button, fontSize: 15, color: '#FFFFFF' },
  entryDate: { ...TYPE.caption, color: GV.fog, fontVariant: ['tabular-nums'] },
  entryNotes: { ...TYPE.caption, color: '#8B95A7' },
  entryActions: { flexDirection: 'row', gap: 4 },
  rowBtn: { minWidth: 44, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  rowBtnText: { ...TYPE.chip, color: '#3DDC84' },
  deleteText: { color: GV.danger },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
  form: { gap: 12 },
  fieldLabel: { ...TYPE.caption, color: GV.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  error: { ...TYPE.caption, color: GV.danger },
});
