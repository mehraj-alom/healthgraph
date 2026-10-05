/**
 * ReportDocumentView — the opened daily report as a formal health document.
 *
 * Rendered ON the functional-layer glass sheet (DiaryReportSheet paints the
 * blur), so this view is transparent — content only: monochrome type on
 * glass, hairline section rules, restrained tables, small metadata, and a
 * subordinate footer with the visualization disclaimer. One tinted status
 * color (LG.card.mint) for links; no SaaS cards, no paper palette.
 *
 * Typography: lgType scale (system face — SF Pro on iOS).
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
import { LG, lgType } from '@/theme/liquidGlass';
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
      {/* Masthead — document identity on glass: brand overline, big title,
          date line, prepared-for. No SaaS hero. */}
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
        <Text style={styles.emptyNote}>Nothing recorded for this section yet.</Text>
      ) : null}

      {/* Footer — brand wordmark + visualization disclaimer. */}
      <View style={styles.footer}>
        <View style={styles.rule} />
        <Text style={styles.footerBrand}>HealthGraph</Text>
        <Text style={styles.footerSub}>Health record visualization</Text>
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
    ...lgType.overline,
    letterSpacing: 2.4,
    color: LG.card.labelTertiary,
  },
  docTitleBig: {
    ...lgType.title,
    fontSize: 24,
    lineHeight: 30,
    color: LG.card.label,
    marginTop: 4,
  },
  docDate: {
    ...lgType.headline,
    color: LG.card.label,
    marginTop: 6,
  },
  docPatient: {
    ...lgType.caption,
    color: LG.card.labelSecondary,
    marginTop: 2,
  },
  ruleHeavy: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.30)',
    marginTop: 14,
    marginBottom: 12,
  },
  summary: {
    ...lgType.bodySmall,
    color: LG.card.labelSecondary,
    marginBottom: 8,
    fontVariant: ['tabular-nums'],
  },
  sectionHead: {
    ...lgType.overline,
    color: LG.card.label,
    marginTop: 20,
  },
  rule: {
    height: 1,
    backgroundColor: LG.card.border,
    marginTop: 8,
    marginBottom: 2,
  },
  // Generic document row: title + time, detail, meta, hairline.
  docRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: LG.card.border,
  },
  docRowHighlight: {
    borderWidth: 1,
    borderColor: 'rgba(92, 232, 184, 0.55)',
    borderRadius: 12,
    paddingHorizontal: 10,
    marginHorizontal: -10,
    backgroundColor: 'rgba(92, 232, 184, 0.10)',
  },
  docTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  docTitle: {
    flex: 1,
    ...lgType.headline,
    color: LG.card.label,
  },
  docTime: {
    ...lgType.caption,
    color: LG.card.labelSecondary,
    fontVariant: ['tabular-nums'],
  },
  docDetail: {
    ...lgType.bodySmall,
    color: LG.card.label,
    marginTop: 3,
  },
  docMeta: {
    ...lgType.caption,
    color: LG.card.labelSecondary,
    marginTop: 3,
    fontVariant: ['tabular-nums'],
  },
  docLink: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingRight: 8,
  },
  docLinkText: {
    ...lgType.bodySmall,
    fontWeight: '600',
    color: LG.card.mint,
  },
  emptyNote: {
    ...lgType.bodySmall,
    color: LG.card.labelSecondary,
    marginTop: 16,
  },
  // Medication regimen rows: label/value table treatment.
  medBlock: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: LG.card.border,
  },
  kvRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  medName: {
    flex: 1,
    ...lgType.headline,
    color: LG.card.label,
  },
  medDose: {
    ...lgType.headline,
    color: LG.card.label,
    fontVariant: ['tabular-nums'],
  },
  meta: {
    ...lgType.caption,
    color: LG.card.labelSecondary,
    marginTop: 3,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginTop: 5,
  },
  statusText: {
    flex: 1,
    ...lgType.bodySmall,
    fontWeight: '600',
    color: LG.card.label,
  },
  statusTime: {
    ...lgType.caption,
    color: LG.card.labelSecondary,
    fontVariant: ['tabular-nums'],
  },
  noRecord: {
    ...lgType.bodySmall,
    color: LG.card.labelSecondary,
    marginTop: 5,
  },
  footer: {
    alignItems: 'center',
    marginTop: 28,
  },
  footerBrand: {
    ...lgType.headline,
    letterSpacing: 0.6,
    color: LG.card.label,
    marginTop: 14,
  },
  footerSub: {
    ...lgType.caption,
    color: LG.card.labelSecondary,
    marginTop: 3,
  },
  disclaimer: {
    ...lgType.caption,
    fontSize: 11,
    lineHeight: 16,
    color: LG.card.labelTertiary,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 12,
  },
});

export default ReportDocumentView;
