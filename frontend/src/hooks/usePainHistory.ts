import { useEffect, useMemo, useState } from 'react';
import { getDailyLogs, getDailyLogEvents } from '@/db/queries/dailyLogs';
import { getCachedPatientId } from '@/services/patientIdentity';
import {
  mapLocationToPart,
  severityToIntensity,
} from '@/components/bodyParts';
import type { SymptomDatum } from '@/components/SymptomBodyMap';

export interface HistoryDay {
  /** Calendar date, YYYY-MM-DD. */
  date: string;
  /** Human label: Today / Yesterday / Mar 4. */
  label: string;
  /** Strongest marking per part that day (already merged). */
  marks: SymptomDatum[];
}

interface PainHistory {
  /** Continuous calendar, oldest → today. Precomputed so scrubbing is free. */
  history: HistoryDay[];
  loading: boolean;
  /** Pain entries whose location matched no catalog part (never guessed). */
  unmapped: number;
  /** True when showing built-in demo data (no patient or no history yet). */
  isSample: boolean;
}

const toDateString = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function dayLabel(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return 'Today';
  const d = new Date(`${dateStr}T00:00:00`);
  const t = new Date(`${todayStr}T00:00:00`);
  const diff = Math.round((t.getTime() - d.getTime()) / 86400000);
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return `${diff} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Deterministic demo history so the slider works before any logs exist.
 * Fixed offsets — stable across renders, clearly labelled as sample upstream.
 */
function sampleHistory(days: number, todayStr: string): HistoryDay[] {
  const marks: Record<number, SymptomDatum[]> = {
    0: [{ slug: 'lower-back', intensity: 2 }],
    2: [
      { slug: 'deltoids', intensity: 1, side: 'left' },
      { slug: 'knees', intensity: 2, side: 'right' },
    ],
    5: [{ slug: 'neck', intensity: 1 }],
    9: [
      { slug: 'lower-back', intensity: 3 },
      { slug: 'hamstring', intensity: 2, side: 'left' },
    ],
    14: [{ slug: 'head', intensity: 2 }],
    21: [{ slug: 'feet', intensity: 1, side: 'right' }],
  };
  const out: HistoryDay[] = [];
  for (let ago = days - 1; ago >= 0; ago--) {
    const d = new Date(`${todayStr}T00:00:00`);
    d.setDate(d.getDate() - ago);
    const date = toDateString(d);
    out.push({ date, label: dayLabel(date, todayStr), marks: marks[ago] ?? [] });
  }
  return out;
}

/**
 * Pain-location history for the time slider. Pain entries carry
 * structure_id + 1–10 severity; each day keeps the strongest marking per
 * part. Symptoms carry no body site, so only pain drives the figure.
 */
export function usePainHistory(days = 30): PainHistory {
  const [byDate, setByDate] = useState<Map<string, SymptomDatum[]>>(new Map());
  const [unmapped, setUnmapped] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasPatient, setHasPatient] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const patientId = getCachedPatientId();
        if (!patientId) return;
        if (cancelled) return;
        setHasPatient(true);
        const logs = await getDailyLogs(patientId, days).catch(() => []);
        const perLog = await Promise.all(
          logs.map((log) => getDailyLogEvents(patientId, log.group_id).catch(() => [])),
        );
        if (cancelled) return;
        const grouped = new Map<string, Map<string, SymptomDatum>>();
        let missed = 0;
        for (let li = 0; li < logs.length; li++) {
          for (const ev of perLog[li] ?? []) {
            if (ev.event_type !== 'PAIN_LOG') continue;
            let payload: Record<string, unknown> = {};
            try {
              payload = JSON.parse(ev.payload_json ?? '{}');
            } catch {
              continue;
            }
            const severity = Number(payload.severity);
            if (!Number.isFinite(severity) || severity <= 0) continue;
            const mapped =
              mapLocationToPart(
                typeof payload.structure_id === 'string' ? payload.structure_id : null,
              ) ??
              mapLocationToPart(
                typeof payload.body_location_id === 'string' ? payload.body_location_id : null,
              );
            if (!mapped) {
              missed += 1;
              continue;
            }
            const day = logs[li].log_date;
            const key = `${mapped.slug}:${mapped.side ?? 'whole'}`;
            const entry: SymptomDatum = {
              slug: mapped.slug,
              intensity: severityToIntensity(severity),
              side: mapped.side ?? undefined,
            };
            const dayMap = grouped.get(day) ?? new Map<string, SymptomDatum>();
            const existing = dayMap.get(key);
            if (!existing || existing.intensity < entry.intensity) {
              dayMap.set(key, entry);
            }
            grouped.set(day, dayMap);
          }
        }
        setByDate(new Map([...grouped].map(([d, m]) => [d, [...m.values()]])));
        setUnmapped(missed);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days]);

  const history = useMemo<HistoryDay[]>(() => {
    const today = new Date();
    const todayStr = toDateString(today);
    const out: HistoryDay[] = [];
    for (let ago = days - 1; ago >= 0; ago--) {
      const d = new Date(today);
      d.setDate(d.getDate() - ago);
      const date = toDateString(d);
      out.push({ date, label: dayLabel(date, todayStr), marks: byDate.get(date) ?? [] });
    }
    return out;
  }, [byDate, days]);

  const totalMarks = useMemo(
    () => history.reduce((n, d) => n + d.marks.length, 0),
    [history],
  );
  const isSample = !hasPatient || (!loading && totalMarks === 0);

  return {
    history: isSample && !loading ? sampleHistory(days, toDateString(new Date())) : history,
    loading,
    unmapped,
    isSample: isSample && !loading,
  };
}
