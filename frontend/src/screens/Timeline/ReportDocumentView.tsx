/**
 * ReportDocumentView — the opened daily report as a formal health document.
 *
 * Editorial paper document, not a dashboard: engraved header, hairline
 * sections, restrained tables, small metadata, document margins, and a
 * subordinate footer with the visualization disclaimer. No glassmorphism,
 * no SaaS cards.
 *
 * Every row traces to a real DiaryItemInput (titles, times, values). The
 * medication section additionally joins the on-device medication
 * architecture (regimen + taken events + reminder instances) — and never
 * implies a dose was taken merely because it was scheduled: unscheduled
 * evidence renders as "No dose recorded".
 *
 * Lazy by construction: the parent mounts this only for the opened day, so
 * only the selected report instantiates the detailed view.
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { DiaryDay } from './diary';
import {
  buildReportDocument,
  formatClock,
  formatSlot,
  type ReportDocument,
  type ReportRow,
  type ReportSection,
} from './reportDocument';
import { PAPER } from './paperTheme';
import { FONT } from '@/theme/guava';
import { getMedications } from '@/db/queries/medications';
import {
  getMedicationTakenEventsForDate,
  localDayUtcBounds,
} from '@/db/queries/medicationTakenEvents';
import { listReminderInstancesFrom } from '@/db/queries/reminderInstances';
import type { Medication, MedicationTakenEvent } from '@/types';

// ---------------------------------------------------------------------------
// Medication evidence (on-device architecture as source of truth)
// ---------------------------------------------------------------------------

interface MedStatusLine {
  text: string;
  time: string | null;
}

interface MedEntry {
  key: string;
  name: string;
  doseLabel: string | null;
  scheduleLabel: string | null;
  prescriber: string | null;
  lines: MedStatusLine[];
}

function doseLabelFor(m: {
  strength: string | null;
  strength_unit: string | null;
  dose_amount: number | null;
  dose_unit: string | null;
}): string | null {
  if (m.strength) return `${m.strength}${m.strength_unit ? ` ${m.strength_unit}` : ''}`;
  if (m.dose_amount != null) return `${m.dose_amount}${m.dose_unit ? ` ${m.dose_unit}` : ''}`;
  return null;
}

function inRange(m: { start_date: string | null; end_date: string | null }, dayKey: string): boolean {
  if (m.start_date && dayKey < m.start_date) return false;
  if (m.end_date && dayKey > m.end_date) return false;
  return true;
}

function takenLine(e: MedicationTakenEvent): MedStatusLine {
  const dose = e.dose_taken != null ? `${e.dose_taken}${e.dose_unit ? ` ${e.dose_unit}` : ''}` : null;
  const time = formatClock(e.taken_at);
  switch (e.status) {
    case 'TAKEN':
      return { text: dose ? `Taken · ${dose}` : 'Taken', time };
    case 'LATE':
      return { text: dose ? `Taken late · ${dose}` : 'Taken late', time };
    case 'MISSED':
      return { text: 'Missed', time };
    case 'SKIPPED':
      return { text: 'Skipped', time };
    default:
      return { text: e.status, time };
  }
}

async function loadMedicationEntries(patientId: string, dayKey: string): Promise<MedEntry[]> {
  const [meds, taken, bounds] = await Promise.all([
    getMedications(patientId),
    getMedicationTakenEventsForDate(patientId, dayKey),
    Promise.resolve(localDayUtcBounds(dayKey)),
  ]);
  const reminders =
    bounds != null ? await listReminderInstancesFrom(patientId, bounds[0]) : [];
  const dayEnd = bounds?.[1] ?? null;
  const inDayReminders = dayEnd
    ? reminders.filter((r) => r.scheduled_at < dayEnd)
    : reminders;

  const byId = new Map(meds.map((m) => [m.medication_id, m]));
  const takenByMed = new Map<string, MedicationTakenEvent[]>();
  for (const e of taken) {
    const list = takenByMed.get(e.medication_id);
    if (list) list.push(e);
    else takenByMed.set(e.medication_id, [e]);
  }
  const snoozeByMed = new Map<string, number>();
  const dismissedByMed = new Set<string>();
  for (const r of inDayReminders) {
    if (r.snooze_count > 0) {
      snoozeByMed.set(r.medication_id, (snoozeByMed.get(r.medication_id) ?? 0) + r.snooze_count);
    }
    if (r.status === 'dismissed') dismissedByMed.add(r.medication_id);
  }

  const entries: MedEntry[] = [];
  const covered = new Set<string>();
  const regimen = meds
    .filter((m) => m.status === 'ACTIVE' && inRange(m, dayKey))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const m of regimen) {
    covered.add(m.medication_id);
    const lines: MedStatusLine[] = [];
    for (const e of takenByMed.get(m.medication_id) ?? []) lines.push(takenLine(e));
    const snoozed = snoozeByMed.get(m.medication_id) ?? 0;
    if (snoozed > 0) lines.push({ text: `Snoozed ×${snoozed}`, time: null });
    if (dismissedByMed.has(m.medication_id) && lines.length === 0) {
      lines.push({ text: 'Reminder dismissed', time: null });
    }
    entries.push({
      key: m.medication_id,
      name: m.name,
      doseLabel: doseLabelFor(m),
      scheduleLabel:
        m.scheduled_times && m.scheduled_times.length > 0
          ? `Scheduled ${m.scheduled_times.map(formatSlot).join(', ')}`
          : m.prn
            ? 'As needed'
            : null,
      prescriber: m.prescriber,
      lines,
    });
  }
  // Taken events for meds outside the active regimen (completed courses…):
  // shown strictly as recorded evidence, never as scheduled.
  const extras = [...takenByMed.keys()].filter((id) => !covered.has(id)).sort();
  for (const id of extras) {
    const events = takenByMed.get(id) ?? [];
    const m = byId.get(id) as Medication | undefined;
    const lines = events.map(takenLine);
    const snoozed = snoozeByMed.get(id) ?? 0;
    if (snoozed > 0) lines.push({ text: `Snoozed ×${snoozed}`, time: null });
    entries.push({
      key: id,
      name: m?.name ?? 'Dose',
      doseLabel: m ? doseLabelFor(m) : null,
      scheduleLabel: null,
      prescriber: m?.prescriber ?? null,
      lines,
    });
  }
  return entries;
}

/** Regimen + recorded evidence for one day. Replaces the diary fallback
 *  rows once loaded (never shown alongside them — no double counting). */
function MedicationSection({
  patientId,
  dayKey,
  fallback,
}: {
  patientId: string | null;
  dayKey: string;
  fallback: ReportRow[];
}) {
  const [entries, setEntries] = useState<MedEntry[] | null>(null);
  useEffect(() => {
    if (!patientId) return;
    let live = true;
    (async () => {
      try {
        const loaded = await loadMedicationEntries(patientId, dayKey);
        if (live) setEntries(loaded);
      } catch {
        if (live) setEntries([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [patientId, dayKey]);

  if (entries !== null && entries.length > 0) {
    return (
      <View>
        <Text style={styles.sectionHead}>Medications</Text>
        <View style={styles.rule} />
        {entries.map((e) => (
          <View key={e.key} style={styles.medBlock}>
            <View style={styles.kvRow}>
              <Text style={styles.medName} numberOfLines={2}>
                {e.name}
              </Text>
              {e.doseLabel ? (
                <Text style={styles.medDose} numberOfLines={1}>
                  {e.doseLabel}
                </Text>
              ) : null}
            </View>
            {e.scheduleLabel ? <Text style={styles.meta}>{e.scheduleLabel}</Text> : null}
            {e.prescriber ? (
              <Text style={styles.meta}>Prescribed by {e.prescriber}</Text>
            ) : null}
            {e.lines.length > 0 ? (
              e.lines.map((l, i) => (
                <View key={i} style={styles.statusLine}>
                  <Text style={styles.statusText} numberOfLines={1}>
                    {l.text}
                  </Text>
                  {l.time ? <Text style={styles.statusTime}>{l.time}</Text> : null}
                </View>
              ))
            ) : (
              <Text style={styles.noRecord}>No dose recorded</Text>
            )}
          </View>
        ))}
      </View>
    );
  }
  if (fallback.length === 0) return null;
  return (
    <View>
      <Text style={styles.sectionHead}>Medications</Text>
      <View style={styles.rule} />
      {fallback.map((row) => (
        <View key={row.key} style={styles.docRow}>
          <View style={styles.docTop}>
            <Text style={styles.docTitle} numberOfLines={2}>
              Logged dose · {row.detail || row.title}
            </Text>
            {row.time ? <Text style={styles.docTime}>{row.time}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

function DocRow({
  row,
  highlighted,
  onLayout,
  onDocumentPress,
}: {
  row: ReportRow;
  highlighted: boolean;
  onLayout: (key: string, y: number) => void;
  onDocumentPress: (documentId: string) => void;
}) {
  return (
    <View
      onLayout={(e) => onLayout(row.key, e.nativeEvent.layout.y)}
      style={[styles.docRow, highlighted && styles.docRowHighlight]}
    >
      <View style={styles.docTop}>
        <Text style={styles.docTitle} numberOfLines={2}>
          {row.title}
        </Text>
        {row.time ? <Text style={styles.docTime}>{row.time}</Text> : null}
      </View>
      {row.detail ? <Text style={styles.docDetail}>{row.detail}</Text> : null}
      {row.meta ? <Text style={styles.docMeta}>{row.meta}</Text> : null}
      {row.documentId ? (
        <Pressable
          onPress={() => onDocumentPress(row.documentId!)}
          accessibilityRole="button"
          accessibilityLabel={`Open document for ${row.title}`}
          hitSlop={8}
          style={styles.docLink}
        >
          <Text style={styles.docLinkText}>View document ›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ReportDocumentView({
  day,
  patientName,
  patientId,
  highlightKey,
  onDocumentPress,
}: {
  day: DiaryDay;
  patientName: string | null;
  patientId: string | null;
  highlightKey: string | null;
  onDocumentPress: (documentId: string) => void;
}) {
  const doc: ReportDocument = buildReportDocument(day);
  const scrollRef = useRef<ScrollView | null>(null);
  const rowY = useRef(new Map<string, number>());

  useEffect(() => {
    rowY.current.clear();
  }, [day.dayKey]);

  // After the rise animation, bring AI-highlighted evidence into view.
  useEffect(() => {
    if (!highlightKey) return;
    const t = setTimeout(() => {
      const y = rowY.current.get(highlightKey);
      if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
    }, 450);
    return () => clearTimeout(t);
  }, [highlightKey, day.dayKey]);

  const onRowLayout = (key: string, y: number) => {
    rowY.current.set(key, y);
  };

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.body}
      showsVerticalScrollIndicator={false}
    >
      {/* Masthead — document identity, never a SaaS hero. */}
      <Text style={styles.brand}>HealthGraph</Text>
      <Text style={styles.docTitleBig} accessibilityRole="header">
        Daily Health Report
      </Text>
      <Text style={styles.docDate}>
        {doc.fullDate}
        {doc.context === 'Today' || doc.context === 'Yesterday' ? ` · ${doc.context}` : ''}
      </Text>
      {patientName ? <Text style={styles.docPatient}>Prepared for {patientName}</Text> : null}
      {/* No company/legal address is configured anywhere in the project
          metadata — the address block stays out until one is verified. */}
      <View style={styles.ruleHeavy} />
      {doc.summaryLine ? <Text style={styles.summary}>{doc.summaryLine}</Text> : null}

      {doc.sections.map((section: ReportSection) =>
        section.key === 'medications' ? (
          <MedicationSection
            key={section.key}
            patientId={patientId}
            dayKey={day.dayKey}
            fallback={section.rows}
          />
        ) : (
          <View key={section.key}>
            <Text style={styles.sectionHead}>{section.heading}</Text>
            <View style={styles.rule} />
            {section.rows.map((row) => (
              <DocRow
                key={row.key}
                row={row}
                highlighted={highlightKey === row.key}
                onLayout={onRowLayout}
                onDocumentPress={onDocumentPress}
              />
            ))}
          </View>
        ),
      )}

      {doc.total === 0 ? (
        <Text style={styles.emptyNote}>No health activity recorded for this section.</Text>
      ) : null}

      {/* Footer — brand wordmark + visualization disclaimer. */}
      <View style={styles.footer}>
        <View style={styles.rule} />
        <Text style={styles.footerBrand}>HealthGraph</Text>
        <Text style={styles.footerSub}>Digital Health Record Visualization</Text>
        <Text style={styles.disclaimer}>
          For visualization purposes only. Not a medical prescription, medical record, or medical
          report.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 28,
  },
  brand: {
    fontFamily: FONT.semi,
    fontSize: 12,
    letterSpacing: 3,
    color: PAPER.muted,
  },
  docTitleBig: {
    fontFamily: FONT.semi,
    fontSize: 22,
    lineHeight: 28,
    color: PAPER.ink,
    marginTop: 2,
  },
  docDate: {
    fontFamily: FONT.semi,
    fontSize: 15,
    lineHeight: 21,
    color: PAPER.ink,
    marginTop: 4,
  },
  docPatient: {
    fontSize: 13,
    lineHeight: 18,
    color: PAPER.muted,
    marginTop: 2,
  },
  ruleHeavy: {
    height: 2,
    backgroundColor: PAPER.ink,
    marginTop: 12,
    marginBottom: 10,
  },
  summary: {
    fontSize: 13,
    lineHeight: 19,
    color: PAPER.muted,
    marginBottom: 6,
    fontVariant: ['tabular-nums'],
  },
  sectionHead: {
    fontFamily: FONT.semi,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1.5,
    color: PAPER.ink,
    marginTop: 18,
  },
  rule: {
    height: 1,
    backgroundColor: PAPER.rule,
    marginTop: 6,
    marginBottom: 2,
  },
  // Generic document row: title + time, detail, meta, hairline.
  docRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: PAPER.rule,
  },
  docRowHighlight: {
    borderWidth: 2,
    borderColor: PAPER.highlight,
    borderRadius: 8,
    paddingHorizontal: 8,
    marginHorizontal: -8,
    backgroundColor: '#f8ecc9',
  },
  docTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  docTitle: {
    flex: 1,
    fontFamily: FONT.semi,
    fontSize: 15,
    lineHeight: 21,
    color: PAPER.ink,
  },
  docTime: {
    fontSize: 12,
    lineHeight: 16,
    color: PAPER.muted,
    fontVariant: ['tabular-nums'],
  },
  docDetail: {
    fontSize: 13,
    lineHeight: 19,
    color: PAPER.ink,
    marginTop: 2,
  },
  docMeta: {
    fontSize: 12,
    lineHeight: 17,
    color: PAPER.muted,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  docLink: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingRight: 8,
  },
  docLinkText: {
    fontFamily: FONT.semi,
    fontSize: 13,
    lineHeight: 18,
    color: PAPER.accent,
  },
  emptyNote: {
    fontSize: 13,
    lineHeight: 19,
    color: PAPER.muted,
    marginTop: 14,
  },
  // Medication regimen rows: label/value table treatment.
  medBlock: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: PAPER.rule,
  },
  kvRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  medName: {
    flex: 1,
    fontFamily: FONT.semi,
    fontSize: 15,
    lineHeight: 21,
    color: PAPER.ink,
  },
  medDose: {
    fontFamily: FONT.semi,
    fontSize: 14,
    lineHeight: 19,
    color: PAPER.ink,
    fontVariant: ['tabular-nums'],
  },
  meta: {
    fontSize: 12,
    lineHeight: 17,
    color: PAPER.muted,
    marginTop: 2,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginTop: 4,
  },
  statusText: {
    flex: 1,
    fontFamily: FONT.semi,
    fontSize: 13,
    lineHeight: 18,
    color: PAPER.ink,
  },
  statusTime: {
    fontSize: 12,
    lineHeight: 16,
    color: PAPER.muted,
    fontVariant: ['tabular-nums'],
  },
  noRecord: {
    fontSize: 13,
    lineHeight: 18,
    color: PAPER.muted,
    marginTop: 4,
  },
  footer: {
    alignItems: 'center',
    marginTop: 26,
  },
  footerBrand: {
    fontFamily: FONT.semi,
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: 1,
    color: PAPER.ink,
    marginTop: 12,
  },
  footerSub: {
    fontSize: 12,
    lineHeight: 17,
    color: PAPER.muted,
    marginTop: 2,
  },
  disclaimer: {
    fontSize: 11,
    lineHeight: 16,
    color: PAPER.muted,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 12,
  },
});

export default ReportDocumentView;
