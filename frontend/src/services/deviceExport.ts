/**
 * deviceExport.ts — user-facing CSV export of on-device tables (pure).
 *
 * Article 20 portability in a file the user owns: one long-format CSV
 * (date,domain,metric,value,unit,note) covering the device-only tables
 * plus the locally cached daily logs and medication lists. Server-side
 * records are out of scope here (the account-deletion screen covers the
 * server bundle) — this file is exactly what sits on the phone, nothing more.
 *
 * Zero imports: safe for node unit tests. The RN layer
 * (deviceExportShare.ts) collects the rows and writes/shares the file.
 */

export type ExportDomain =
  | 'meditation'
  | 'substance'
  | 'craving'
  | 'cycle'
  | 'ppg'
  | 'rppg'
  | 'food'
  | 'daily-log'
  | 'medication'
  | 'medication-taken';

export interface ExportRow {
  date: string;
  domain: ExportDomain;
  metric: string;
  value: string;
  unit: string | null;
  note: string | null;
}

export interface DeviceExportInput {
  meditation: readonly {
    started_at: string;
    preset_min: number;
    duration_sec: number;
    completed: number;
    notes: string | null;
  }[];
  substance: readonly {
    occurred_at: string;
    category: string;
    amount_value: number | null;
    amount_unit: string | null;
    notes: string | null;
  }[];
  cravings: readonly {
    occurred_at: string;
    category: string;
    intensity: number | null;
    outcome: string | null;
    notes: string | null;
  }[];
  cycle: readonly { date: string; kind: string; notes: string | null }[];
  ppg: readonly {
    measured_at: string;
    heart_rate_bpm: number | null;
    rmssd_ms: number | null;
  }[];
  rppg: readonly { measured_at: string; heart_rate_bpm: number | null }[];
  foodItems: readonly {
    log_date: string;
    label: string;
    kcal: number;
    barcode?: string;
  }[];
  dailyLogs: readonly {
    log_date: string;
    overall_wellbeing: number | null;
    energy_level: number | null;
    stress_level: number | null;
    sleep_duration_minutes: number | null;
    water_ml: number | null;
    meals_count: number | null;
    calories_kcal: number | null;
    food_label: string | null;
    notes: string | null;
  }[];
  medications: readonly { name: string; status: string; frequency: string | null }[];
  taken: readonly {
    taken_at: string;
    medication_name: string | null;
    status: string;
  }[];
}

const EMPTY: DeviceExportInput = {
  meditation: [],
  substance: [],
  cravings: [],
  cycle: [],
  ppg: [],
  rppg: [],
  foodItems: [],
  dailyLogs: [],
  medications: [],
  taken: [],
};

function dayOf(value: string): string {
  return String(value ?? '').slice(0, 10);
}

function num(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return String(Math.round(value * 100) / 100);
}

/**
 * Flatten domain rows into long-format export rows. Null measurements
 * are skipped (a missing value is absent, never zero); text is passed
 * through verbatim and escaped at CSV time.
 */
export function buildExportRows(input: DeviceExportInput): ExportRow[] {
  const src: DeviceExportInput = { ...EMPTY, ...input };
  const rows: ExportRow[] = [];

  for (const s of src.meditation) {
    rows.push({
      date: dayOf(s.started_at),
      domain: 'meditation',
      metric: 'sit',
      value: `${s.preset_min}min/${Math.floor(s.duration_sec / 60)}min${s.completed === 1 ? '' : '/early'}`,
      unit: 'min',
      note: s.notes,
    });
  }
  for (const e of src.substance) {
    const amount = num(e.amount_value);
    rows.push({
      date: dayOf(e.occurred_at),
      domain: 'substance',
      metric: String(e.category),
      value: amount ?? '1',
      unit: amount !== null ? (e.amount_unit ?? null) : null,
      note: e.notes,
    });
  }
  for (const c of src.cravings) {
    rows.push({
      date: dayOf(c.occurred_at),
      domain: 'craving',
      metric: String(c.category),
      value: c.intensity !== null && c.intensity !== undefined ? String(c.intensity) : (c.outcome ?? 'logged'),
      unit: c.intensity !== null && c.intensity !== undefined ? '1-5' : null,
      note: c.notes,
    });
  }
  for (const c of src.cycle) {
    rows.push({
      date: dayOf(c.date),
      domain: 'cycle',
      metric: String(c.kind),
      value: '1',
      unit: null,
      note: c.notes,
    });
  }
  for (const m of src.ppg) {
    const bpm = num(m.heart_rate_bpm);
    if (bpm !== null) {
      rows.push({ date: dayOf(m.measured_at), domain: 'ppg', metric: 'heart-rate', value: bpm, unit: 'bpm', note: null });
    }
    const hrv = num(m.rmssd_ms);
    if (hrv !== null) {
      rows.push({ date: dayOf(m.measured_at), domain: 'ppg', metric: 'hrv-rmssd', value: hrv, unit: 'ms', note: null });
    }
  }
  for (const m of src.rppg) {
    const bpm = num(m.heart_rate_bpm);
    if (bpm !== null) {
      rows.push({ date: dayOf(m.measured_at), domain: 'rppg', metric: 'heart-rate', value: bpm, unit: 'bpm', note: null });
    }
  }
  for (const f of src.foodItems) {
    rows.push({
      date: dayOf(f.log_date),
      domain: 'food',
      metric: 'food-item',
      value: num(f.kcal) ?? '0',
      unit: 'kcal',
      note: [f.label, f.barcode ? `barcode ${f.barcode}` : null].filter(Boolean).join(' · ') || null,
    });
  }
  for (const l of src.dailyLogs) {
    const d = dayOf(l.log_date);
    const fields: [string, number | null, string | null][] = [
      ['wellbeing', l.overall_wellbeing, '1-5'],
      ['energy', l.energy_level, '1-5'],
      ['stress', l.stress_level, '1-5'],
      ['sleep', l.sleep_duration_minutes, 'min'],
      ['water', l.water_ml, 'ml'],
      ['meals', l.meals_count, 'count'],
      ['calories', l.calories_kcal, 'kcal'],
    ];
    for (const [metric, v, unit] of fields) {
      const value = num(v);
      if (value !== null) {
        rows.push({
          date: d,
          domain: 'daily-log',
          metric,
          value,
          unit,
          note: metric === 'calories' ? l.food_label : null,
        });
      }
    }
    if (l.notes) {
      rows.push({ date: d, domain: 'daily-log', metric: 'note', value: l.notes, unit: null, note: null });
    }
  }
  for (const m of src.medications) {
    rows.push({
      date: '',
      domain: 'medication',
      metric: 'prescription',
      value: String(m.name),
      unit: null,
      note: [m.status, m.frequency].filter(Boolean).join(' · ') || null,
    });
  }
  for (const t of src.taken) {
    rows.push({
      date: dayOf(t.taken_at),
      domain: 'medication-taken',
      metric: 'dose',
      value: String(t.status),
      unit: null,
      note: t.medication_name,
    });
  }

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.domain < b.domain ? -1 : 1));
  return rows;
}

function escapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** RFC 4180 CSV with a fixed header; header-only when there are no rows. */
export function toCsv(rows: readonly ExportRow[]): string {
  const lines = ['date,domain,metric,value,unit,note'];
  for (const r of rows) {
    lines.push(
      [r.date, r.domain, r.metric, r.value, r.unit ?? '', r.note ?? '']
        .map(escapeCell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Stable, sortable filename for the share sheet. */
export function exportFileName(today: string): string {
  const day = String(today ?? '').slice(0, 10).replace(/[^0-9-]/g, '') || 'undated';
  return `healthgraph-export-${day}.csv`;
}
