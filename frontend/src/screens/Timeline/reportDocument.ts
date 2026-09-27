/**
 * reportDocument — Daily Health Report view-model: DiaryDay pages → a formal
 * document structure (header meta + data-driven sections).
 *
 * Pure, UI-free, node-testable. NOT a new source of truth: it only reshapes
 * the already-merged DiaryItemInputs into per-section rows. No queries, no
 * network, no persistence, no invented values — every row traces to a real
 * diary item, and empty sections are simply omitted.
 */

import type { DiaryDay, DiaryItemInput } from './diary';

export type ReportSectionKey =
  | 'symptoms'
  | 'pain'
  | 'measurements'
  | 'medications'
  | 'daily_logs'
  | 'records'
  | 'observations';

export interface ReportRow {
  key: string;
  /** Display clock time ("8:42 AM") or null when the source has none. */
  time: string | null;
  title: string;
  /** One-line detail; may be empty. */
  detail: string;
  /** Secondary line (lab reference range + flag); null when none. */
  meta: string | null;
  /** Document deep-link target, when the row carries evidence. */
  documentId: string | null;
}

export interface ReportSection {
  key: ReportSectionKey;
  heading: string;
  rows: ReportRow[];
}

export interface ReportDocument {
  dayKey: string;
  title: string;
  context: string;
  fullDate: string;
  total: number;
  /** Only sections that contain actual data. Never fabricated. */
  sections: ReportSection[];
  /** Compact "3 symptoms · 2 measurements" line; empty when nothing to say. */
  summaryLine: string;
}

const SECTION_ORDER: ReportSectionKey[] = [
  'symptoms',
  'pain',
  'measurements',
  'medications',
  'daily_logs',
  'records',
  'observations',
];

const HEADINGS: Record<ReportSectionKey, string> = {
  symptoms: 'Symptoms',
  pain: 'Pain',
  measurements: 'Measurements',
  medications: 'Medications',
  daily_logs: 'Daily Logs',
  records: 'Records & Documents',
  observations: 'Observations',
};

/** Singular unit per section for the summary line. */
const UNITS: Record<ReportSectionKey, string> = {
  symptoms: 'symptom',
  pain: 'pain log',
  measurements: 'measurement',
  medications: 'medication',
  daily_logs: 'log',
  records: 'record',
  observations: 'observation',
};

function sectionFor(category: DiaryItemInput['category']): ReportSectionKey | null {
  switch (category) {
    case 'symptom':
      return 'symptoms';
    case 'pain':
      return 'pain';
    case 'vital':
      return 'measurements';
    case 'medication':
      return 'medications';
    case 'daily_log':
      return 'daily_logs';
    case 'medical_record':
      return 'records';
    case 'observation':
      return 'observations';
    default:
      return 'observations';
  }
}

function toRow(item: DiaryItemInput): ReportRow {
  return {
    key: item.key,
    time: item.time || null,
    title: item.title,
    detail: item.detail,
    meta: item.meta ?? null,
    documentId: item.documentId,
  };
}

/**
 * Group one day's items into document sections, preserving the day's item
 * order inside each section. Sections without data are omitted — callers
 * render the explicit empty sentence only when the whole day is empty.
 */
export function buildReportDocument(day: DiaryDay): ReportDocument {
  const buckets = new Map<ReportSectionKey, ReportRow[]>();
  for (const item of day.items) {
    const key = sectionFor(item.category);
    if (!key) continue;
    const list = buckets.get(key);
    if (list) list.push(toRow(item));
    else buckets.set(key, [toRow(item)]);
  }
  const sections: ReportSection[] = [];
  for (const key of SECTION_ORDER) {
    const rows = buckets.get(key);
    if (rows && rows.length > 0) sections.push({ key, heading: HEADINGS[key], rows });
  }
  const parts: string[] = [];
  for (const s of sections) {
    const n = s.rows.length;
    parts.push(`${n} ${UNITS[s.key]}${n === 1 ? '' : 's'}`);
  }
  const summaryLine =
    day.total > 0
      ? `${day.total} ${day.total === 1 ? 'entry' : 'entries'}${parts.length ? ` · ${parts.join(' · ')}` : ''}`
      : '';
  return {
    dayKey: day.dayKey,
    title: day.title,
    context: day.context,
    fullDate: day.fullDate,
    total: day.total,
    sections,
    summaryLine,
  };
}

/** Clock time for ISO instants ("8:42 AM"); null when unparseable. */
export function formatClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "08:00" (24h schedule slot) → "8:00 AM"; raw text back when unparseable. */
export function formatSlot(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(hhmm.trim());
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = m[2];
  if (h < 0 || h > 23) return hhmm;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min} ${suffix}`;
}
