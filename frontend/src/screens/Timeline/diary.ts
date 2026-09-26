/**
 * diary — DiaryDayViewModel: existing HealthGraph data → daily report pages.
 *
 * Pure, UI-free, node-testable. NOT a new source of truth: it only reshapes
 * the already-merged timeline items (local story rows + server events +
 * observations) into per-day report view-models. No queries, no network,
 * no persistence here.
 */

export type DiaryCategory =
  | 'daily_log'
  | 'medical_record'
  | 'symptom'
  | 'pain'
  | 'vital'
  | 'medication'
  | 'observation'
  | 'other';

/** Minimal item surface the diary needs (mapped from PreparedItem). */
export interface DiaryItemInput {
  key: string;
  /** Display clock time, e.g. "8:42 AM". */
  time: string;
  category: DiaryCategory;
  /** Row title (concept name, finding name, story title...). */
  title: string;
  /** One-line detail (value, dose, detail text...). May be empty. */
  detail: string;
  /** Glyph for the preview strip (may be empty). */
  icon: string;
  /** Document deep-link target, when the row carries evidence. */
  documentId: string | null;
  /**
   * Opaque origin reference (the PreparedItem node) for the full report
   * renderer. Never inspected here — the view-model stays presentation-only.
   */
  node: unknown;
}

export interface DiaryDay {
  /** YYYY-MM-DD (en-CA). Stable identity for scroll + AI nav. */
  dayKey: string;
  /** Engraved page header, e.g. "25 JUN". */
  title: string;
  /** "Today" | "Yesterday" | weekday, e.g. "Monday". */
  context: string;
  /** Full date line, e.g. "Thursday, September 26". */
  fullDate: string;
  items: DiaryItemInput[];
  total: number;
  counts: Partial<Record<DiaryCategory, number>>;
  /** Hero block of the preview (most report-worthy row), or null. */
  primary: DiaryItemInput | null;
}

/** Report-worthiness order for the preview hero block. */
const PRIMARY_PRIORITY: DiaryCategory[] = [
  'vital',
  'medication',
  'medical_record',
  'symptom',
  'pain',
  'daily_log',
  'observation',
  'other',
];

function priorityOf(category: DiaryCategory): number {
  const i = PRIMARY_PRIORITY.indexOf(category);
  return i < 0 ? PRIMARY_PRIORITY.length : i;
}

export interface DayLabelParts {
  title: string;
  context: string;
  fullDate: string;
}

/** Day labels with an injectable "now" so tests are deterministic. */
export function labelDay(dayKey: string, now: Date = new Date()): DayLabelParts {
  const date = new Date(dayKey + 'T00:00:00');
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  const context =
    diffDays === 0 ? 'Today' : diffDays === 1 ? 'Yesterday' : date.toLocaleDateString('en-US', { weekday: 'long' });
  const mon = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  const title = `${date.getDate()} ${mon}`;
  const fullDate = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return { title, context, fullDate };
}

/**
 * Group already-sorted items into day pages (newest day first). Input order
 * within a day is preserved. Days arrive in first-seen order, so callers
 * pass newest-first lists to keep the journal newest-first.
 */
export function buildDiaryDays(
  days: { dayKey: string; items: DiaryItemInput[] }[],
  now: Date = new Date(),
): DiaryDay[] {
  return days.map(({ dayKey, items }) => {
    const counts: Partial<Record<DiaryCategory, number>> = {};
    for (const item of items) counts[item.category] = (counts[item.category] ?? 0) + 1;
    let primary: DiaryItemInput | null = null;
    for (const item of items) {
      if (!primary || priorityOf(item.category) < priorityOf(primary.category)) primary = item;
    }
    const { title, context, fullDate } = labelDay(dayKey, now);
    return { dayKey, title, context, fullDate, items, total: items.length, counts, primary };
  });
}

/** Compact bottom-strip summary, e.g. ["♥ 72 BPM", "◆ Meal", "● 2 meds"]. */
export function stripSummary(day: DiaryDay, maxParts = 3): string[] {
  const parts: string[] = [];
  if (day.primary) {
    const p = day.primary;
    parts.push(`${p.icon ? `${p.icon} ` : ''}${p.detail || p.title}`.trim());
  }
  const order: DiaryCategory[] = ['medication', 'daily_log', 'symptom', 'medical_record', 'pain', 'observation', 'other'];
  for (const cat of order) {
    if (parts.length >= maxParts) break;
    const n = day.counts[cat] ?? 0;
    if (n === 0) continue;
    if (day.primary && day.primary.category === cat && n === 1) continue;
    parts.push(cat === 'medication' ? `● ${n} med${n === 1 ? '' : 's'}` : `◆ ${labelFor(cat)}${n > 1 ? ` ×${n}` : ''}`);
  }
  return parts.slice(0, maxParts);
}

function labelFor(category: DiaryCategory): string {
  switch (category) {
    case 'daily_log':
      return 'Log';
    case 'medical_record':
      return 'Record';
    case 'symptom':
      return 'Symptom';
    case 'pain':
      return 'Pain';
    case 'vital':
      return 'Vital';
    case 'medication':
      return 'Med';
    case 'observation':
      return 'Note';
    default:
      return 'Item';
  }
}
