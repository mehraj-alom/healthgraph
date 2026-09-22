/**
 * activity.ts — unified on-device health activity projection (pure).
 *
 * Composes the patient-scoped local sources the app already stores into ONE
 * chronological read-only stream for "what happened recently":
 * daily logs, taken doses, camera heart readings, substance + cycle
 * entries, and documents. Server timeline rows are NOT included (the
 * Timeline screen owns those) — this is the local-first complement that
 * renders instantly, including offline and including device-only rows that
 * the server can never return.
 *
 * No duplicates by construction: every source table is disjoint, and each
 * item key embeds (source, row id). Provenance is per row, never inferred:
 * device-only tables report device; synced domain rows report server;
 * anything else pending reports pending. Zero imports: node-testable.
 */

export type ActivitySource =
  | 'daily-log'
  | 'medication'
  | 'heart'
  | 'substance'
  | 'cycle'
  | 'document';

export type ActivityProvenance = 'device' | 'pending' | 'failed' | 'server';

export interface ActivityRoute {
  name: string;
  params?: Record<string, unknown>;
}

export interface ActivityItem {
  key: string;
  source: ActivitySource;
  /** Epoch ms for ordering (NaN timestamps are dropped, never guessed). */
  timeMs: number;
  /** YYYY-MM-DD calendar day. */
  date: string;
  title: string;
  detail: string | null;
  provenance: ActivityProvenance;
  route: ActivityRoute | null;
}

export interface ActivityInputs {
  patientId: string;
  logs: ReadonlyArray<{
    group_id: string;
    patient_id: string;
    log_date: string;
    sync_status?: string | null;
    /** Latest write wins when duplicate group rows share a date. */
    updated_at?: string | null;
  }>;
  taken: ReadonlyArray<{
    event_id: string;
    patient_id: string;
    medication_id: string;
    medication_name?: string | null;
    taken_at: string;
    sync_status?: string | null;
  }>;
  heart: ReadonlyArray<{
    measurementId: string;
    method: 'ppg' | 'rppg';
    bpm: number;
    measuredAt: string;
    pending: boolean;
  }>;
  substance: ReadonlyArray<{
    entry_id: string;
    patient_id: string;
    category: string;
    label: string | null;
    occurred_at: string;
    amount_value: number | null;
    amount_unit: string | null;
  }>;
  cycle: ReadonlyArray<{
    entry_id: string;
    patient_id: string;
    kind: string;
    date: string;
  }>;
  documents: ReadonlyArray<{
    document_id: string;
    patient_id: string;
    status: string;
    created_at: string;
  }>;
}

const MAX_ACTIVITY_ITEMS = 60;

function dayKeyOf(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseTime(iso: string): number | null {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

const SUBSTANCE_LABEL: Record<string, string> = {
  alcohol: 'Alcohol',
  tobacco: 'Tobacco / nicotine',
  other: 'Substance',
};

const CYCLE_LABEL: Record<string, string> = {
  'period-start': 'Period started',
  'period-end': 'Period ended',
  note: 'Cycle note',
};

/**
 * Sync badge for a stored sync_status: synced → server, failed → failed
 * (honest — a stuck failure must never masquerade as "pending"), anything
 * else → pending.
 */
function syncProvenance(syncStatus: string | null | undefined): ActivityProvenance {
  if (syncStatus === 'synced') return 'server';
  if (syncStatus === 'failed') return 'failed';
  return 'pending';
}

/**
 * Build the unified stream, newest first. Rows from other patients are
 * dropped (defense in depth — callers already scope their queries).
 * Duplicate daily-log group rows sharing a date collapse to the latest
 * write (the table carries no uniqueness constraint, so a hydrated
 * server copy can shadow a local row — one date, one card).
 */
export function buildActivityItems(input: ActivityInputs): ActivityItem[] {
  const { patientId } = input;
  const out: ActivityItem[] = [];
  if (!patientId) return out;

  const seenLogDates = new Map<string, { updated: string; index: number }>();
  const logItems: ActivityItem[] = [];
  for (const log of input.logs) {
    if (log.patient_id !== patientId) continue;
    const dayMs = new Date(`${log.log_date}T12:00:00`).getTime();
    if (!Number.isFinite(dayMs)) continue;
    const day = log.log_date.slice(0, 10);
    const updated = typeof log.updated_at === 'string' ? log.updated_at : '';
    const prev = seenLogDates.get(day);
    if (prev && prev.updated >= updated) continue;
    const item: ActivityItem = {
      key: `log-${log.group_id}`,
      source: 'daily-log',
      timeMs: dayMs,
      date: log.log_date,
      title: 'Daily check-in',
      detail: null,
      provenance: syncProvenance(log.sync_status),
      route: { name: 'DailyLog' },
    };
    if (prev) {
      logItems[prev.index] = item;
    } else {
      seenLogDates.set(day, { updated, index: logItems.length });
      logItems.push(item);
    }
  }
  out.push(...logItems);

  for (const dose of input.taken) {
    if (dose.patient_id !== patientId) continue;
    const timeMs = parseTime(dose.taken_at);
    if (timeMs === null) continue;
    out.push({
      key: `dose-${dose.event_id}`,
      source: 'medication',
      timeMs,
      date: dayKeyOf(timeMs),
      title: dose.medication_name ? `Dose taken · ${dose.medication_name}` : 'Dose taken',
      detail: null,
      provenance: syncProvenance(dose.sync_status),
      route: { name: 'Medications' },
    });
  }

  for (const hr of input.heart) {
    const timeMs = parseTime(hr.measuredAt);
    if (timeMs === null) continue;
    if (typeof hr.bpm !== 'number' || !Number.isFinite(hr.bpm)) continue;
    out.push({
      key: `hr-${hr.measurementId}`,
      source: 'heart',
      timeMs,
      date: dayKeyOf(timeMs),
      title: 'Heart rate',
      detail: `${Math.round(hr.bpm)} bpm · ${hr.method === 'rppg' ? 'Face scan' : 'Fingertip'}`,
      provenance: hr.pending ? 'pending' : 'server',
      route: { name: 'Main', params: { screen: 'PpgMeasure' } },
    });
  }

  for (const entry of input.substance) {
    if (entry.patient_id !== patientId) continue;
    const timeMs = parseTime(entry.occurred_at);
    if (timeMs === null) continue;
    const amount =
      entry.amount_value != null
        ? ` · ${entry.amount_value}${entry.amount_unit ? ` ${entry.amount_unit}` : ''}`
        : '';
    out.push({
      key: `substance-${entry.entry_id}`,
      source: 'substance',
      timeMs,
      date: dayKeyOf(timeMs),
      title: `${SUBSTANCE_LABEL[entry.category] ?? 'Substance'}${entry.label ? ` · ${entry.label}` : ''}`,
      detail: `Tracked${amount}`,
      provenance: 'device',
      route: { name: 'Substance' },
    });
  }

  for (const entry of input.cycle) {
    if (entry.patient_id !== patientId) continue;
    const dayMs = new Date(`${entry.date}T12:00:00`).getTime();
    if (!Number.isFinite(dayMs)) continue;
    out.push({
      key: `cycle-${entry.entry_id}`,
      source: 'cycle',
      timeMs: dayMs,
      date: entry.date,
      title: CYCLE_LABEL[entry.kind] ?? 'Cycle entry',
      detail: null,
      provenance: 'device',
      route: { name: 'Cycle' },
    });
  }

  for (const doc of input.documents) {
    if (doc.patient_id !== patientId) continue;
    const timeMs = parseTime(doc.created_at);
    if (timeMs === null) continue;
    const done = doc.status === 'EXTRACTED' || doc.status === 'COMPLETED';
    const failed = doc.status === 'FAILED' || doc.status === 'FAILED_TRIAGE';
    out.push({
      key: `document-${doc.document_id}`,
      source: 'document',
      timeMs,
      date: dayKeyOf(timeMs),
      title: 'Medical document',
      detail: done ? 'Processed' : failed ? 'Failed' : 'Processing',
      provenance: done ? 'server' : failed ? 'failed' : 'pending',
      route: { name: 'DocumentDetail', params: { documentId: doc.document_id } },
    });
  }

  out.sort((a, b) => (a.timeMs < b.timeMs ? 1 : a.timeMs > b.timeMs ? -1 : a.key < b.key ? -1 : 1));
  return out.slice(0, MAX_ACTIVITY_ITEMS);
}

/** True when the stream holds any real signal (empty-state trigger). */
export function isActivityEmpty(items: readonly ActivityItem[]): boolean {
  return items.length === 0;
}
