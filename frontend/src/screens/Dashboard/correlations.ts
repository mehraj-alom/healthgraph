/**
 * correlations.ts — the dashboard "correlations feed" data layer.
 *
 * Pure builders + one hook, no JSX. Every card is LIVE:
 *   - `useTrends` → per-date wellbeing / energy / stress / sleep / symptom /
 *     records streams.
 *   - SQLite daily logs (last 30 days, offline-first) → water, meals,
 *     appetite, awakenings, activity minutes, calories, pain, and vitals by
 *     concept (labels resolved from `daily-metrics` latest vitals).
 *
 * Two card families:
 *   - date vs observation: one time-series card per stream with real points.
 *   - obs1 vs obs2: one scatter card per stream pair with ≥3 paired dates.
 *
 * Each scatter carries a HEALTH VERDICT (not just |r| strength): pairs with a
 * known clinically-favorable direction are green when the observed sign
 * matches it, red when it contradicts it, and neutral ("normal") when the
 * link is weak or has no known healthy direction. A card is only emitted
 * when it has real points — no fabricated/demo data anywhere in this file.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DailyMetrics } from '@/hooks/useDailyMetrics';
import type { DailyCheckInDetail, MedicationTakenEvent, TrendsResponse } from '@/types';
import { getCachedPatientId } from '@/services/patientIdentity';
import { getDailyLogs, getDailyLogDetail } from '@/db/queries/dailyLogs';
import { getMedicationTakenEvents } from '@/db/queries/medicationTakenEvents';
import {
  correlationCoefficient,
  type CorrelationGraphData,
  type HealthVerdict,
  type ScatterDatum,
  type TimeSeriesPoint,
} from '@/components/home/CorrelationGraphCard';

export interface CorrelationFeedItem {
  id: string;
  title: string;
  subtitle?: string;
  data: CorrelationGraphData;
  verdict: HealthVerdict;
  /** Always 'live' — the feed carries only real data. */
  source: 'live';
}

export interface StreamDef {
  /** Stable id, e.g. 'sleepDur' | 'symptom:2' | 'vital:<conceptId>' | 'hr'. */
  id: string;
  label: string;
  unit?: string;
  /** Short axis caption, e.g. 'min' | '/5'. */
  axis: string;
}

export interface StreamSeries {
  def: StreamDef;
  points: TimeSeriesPoint[];
}

/** Chronological-ascending sort for date-keyed series. */
const byDate = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Base id for verdict keying ('symptom:2' → 'symptom'). */
export function baseId(id: string): string {
  const i = id.indexOf(':');
  return i === -1 ? id : id.slice(0, i);
}

function pairKey(a: string, b: string): string {
  const [x, y] = [baseId(a), baseId(b)].sort();
  return `${x}|${y}`;
}

/**
 * Clinically-favorable direction per unordered stream pair (+1 = higher-with-
 * higher is healthy, -1 = inverse is healthy). Only pairs we can defend are
 * listed; everything else reads as neutral ("normal").
 */
const HEALTHY_SIGN: Record<string, 1 | -1> = {
  'activity|energy': 1,
  'activity|stress': -1,
  'activity|wellbeing': 1,
  'appetite|wellbeing': 1,
  'awakenings|energy': -1,
  'awakenings|sleepQual': -1,
  'energy|sleepDur': 1,
  'energy|stress': -1,
  'energy|water': 1,
  'energy|wellbeing': 1,
  'hr|sleepDur': -1,
  'pain|energy': -1,
  'pain|sleepDur': -1,
  'pain|wellbeing': -1,
  'sleepDur|sleepQual': 1,
  'sleepDur|stress': -1,
  'sleepDur|wellbeing': 1,
  'stress|water': -1,
  'stress|wellbeing': -1,
  'symptom|sleepDur': -1,
  'symptom|wellbeing': -1,
  'water|wellbeing': 1,
};

export function healthVerdict(aId: string, bId: string, r: number | null, n: number): HealthVerdict {
  if (r == null || !Number.isFinite(r) || n < 3) return 'neutral';
  if (Math.abs(r) < 0.35) return 'neutral';
  const s = HEALTHY_SIGN[pairKey(aId, bId)];
  if (s == null) return 'neutral';
  return Math.sign(r) === s ? 'good' : 'bad';
}

export function verdictLabel(v: HealthVerdict): string {
  return v === 'good' ? 'healthy pattern' : v === 'bad' ? 'needs attention' : 'normal';
}

// ─── Multi-day trend assessment (At-a-glance verdicts) ──────────────────────
//
// A spoke shows the average of its last ≤7 days. It goes red when the metric
// has been moving the wrong way for 3+ days (≥4 points + least-squares slope
// beyond a per-metric epsilon) or when its average sits outside the healthy
// band; otherwise green. Slope over a window beats strict day-over-day
// monotonicity — real logs are noisy and a single good day shouldn't flip the
// picture (or hide a slide).

export type MetricTrend = 'up' | 'down' | 'flat';

export interface MetricAssessment {
  /** Mean of the last ≤7 values. */
  avg: number;
  trend: MetricTrend;
  /** Days actually averaged. */
  days: number;
  /** ≥4 points — the "more than three days" gate. */
  enough: boolean;
  /** Red when true. */
  bad: boolean;
}

export function assessSeries(values: number[], eps: number): Omit<MetricAssessment, 'bad'> {
  const window = values.slice(-7);
  const n = window.length;
  if (n === 0) return { avg: 0, trend: 'flat', days: 0, enough: false };
  const avg = window.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { avg, trend: 'flat', days: n, enough: false };
  // Least-squares slope per step.
  const mx = (n - 1) / 2;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (window[i] - avg);
    den += (i - mx) * (i - mx);
  }
  const slope = den === 0 ? 0 : num / den;
  const trend: MetricTrend = slope > eps ? 'up' : slope < -eps ? 'down' : 'flat';
  return { avg, trend, days: n, enough: n >= 4 };
}

/**
 * Full verdict for a spoke. higherBetter=true: sliding down is bad (sleep,
 * energy, water…); false: climbing is bad (stress, pain…). Outside the band
 * is bad even when flat — stable-but-bad shouldn't read green.
 */
export function assessMetric(
  values: number[],
  higherBetter: boolean,
  eps: number,
  bandLo: number,
  bandHi: number,
): MetricAssessment {
  const base = assessSeries(values, eps);
  if (base.days === 0) return { ...base, bad: false };
  const trendBad = base.enough && (higherBetter ? base.trend === 'down' : base.trend === 'up');
  const bandBad = base.avg < bandLo || base.avg > bandHi;
  return { ...base, bad: trendBad || bandBad };
}

// ─── Stream extraction — server trends ──────────────────────────────────────

export function vitalLabelMap(dailyMetrics: DailyMetrics | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const v of dailyMetrics?.latest_vitals ?? []) {
    if (v.concept_id) map.set(v.concept_id, v.display_name);
  }
  return map;
}

export function trendStreams(trends: TrendsResponse | null): StreamSeries[] {
  const out: StreamSeries[] = [];
  if (!trends) return out;

  const sleepDur = (trends.sleep_points ?? [])
    .filter((p) => p.duration_minutes != null)
    .sort((a, b) => byDate(a.date, b.date))
    .slice(-30)
    .map((p) => ({ date: p.date, value: p.duration_minutes! }));
  if (sleepDur.length > 0) {
    out.push({ def: { id: 'sleepDur', label: 'Sleep duration', unit: 'min', axis: 'min' }, points: sleepDur });
  }

  const wellbeing = (trends.wellbeing_points ?? []).slice().sort((a, b) => byDate(a.date, b.date));
  const scalar = (sel: (p: (typeof wellbeing)[number]) => number | null) =>
    wellbeing.filter((p) => sel(p) != null).map((p) => ({ date: p.date, value: sel(p)! }));
  const wb = scalar((p) => p.wellbeing);
  if (wb.length > 0) out.push({ def: { id: 'wellbeing', label: 'Overall wellbeing', unit: '/5', axis: '/5' }, points: wb });
  const en = scalar((p) => p.energy);
  if (en.length > 0) out.push({ def: { id: 'energy', label: 'Energy level', unit: '/5', axis: '/5' }, points: en });
  const st = scalar((p) => p.stress);
  if (st.length > 0) out.push({ def: { id: 'stress', label: 'Stress level', unit: '/5', axis: '/5' }, points: st });

  const sleepQual = (trends.sleep_points ?? [])
    .filter((p) => p.sleep_quality != null)
    .sort((a, b) => byDate(a.date, b.date))
    .slice(-30)
    .map((p) => ({ date: p.date, value: p.sleep_quality! }));
  if (sleepQual.length > 0) {
    out.push({ def: { id: 'sleepQual', label: 'Sleep quality', unit: '/5', axis: '/5' }, points: sleepQual });
  }

  let symptomCard = 0;
  for (const series of trends.symptom_time_series ?? []) {
    if (symptomCard >= 3) break;
    const points = [...series.points]
      .sort((a, b) => byDate(a.date, b.date))
      .map((p) => ({ date: p.date, value: p.severity }));
    if (points.length === 0) continue;
    out.push({
      def: { id: `symptom:${symptomCard}`, label: `${series.display_name} severity`, unit: '/10', axis: '/10' },
      points,
    });
    symptomCard += 1;
  }

  const records = (trends.medical_record_activity ?? [])
    .slice()
    .sort((a, b) => byDate(a.date, b.date))
    .slice(-30)
    .map((p) => ({ date: p.date, value: p.event_count }));
  if (records.length > 0) {
    out.push({ def: { id: 'records', label: 'Records processed', unit: 'events', axis: 'events' }, points: records });
  }

  return out;
}

// ─── Stream extraction — local SQLite daily logs ────────────────────────────

function isHeartLabel(label: string): boolean {
  const n = label.toLowerCase();
  return n.includes('heart') || n.includes('pulse') || n.includes('bpm');
}

export function localStreams(
  details: DailyCheckInDetail[],
  vitalLabels: Map<string, string>,
): StreamSeries[] {
  const out: StreamSeries[] = [];
  const byDay = (sel: (d: DailyCheckInDetail) => number | null) =>
    details
      .filter((d) => sel(d) != null)
      .sort((a, b) => byDate(a.log_date, b.log_date))
      .map((d) => ({ date: d.log_date, value: sel(d)! }));

  const push = (def: StreamDef, points: TimeSeriesPoint[]) => {
    if (points.length > 0) out.push({ def, points });
  };

  push({ id: 'water', label: 'Water intake', unit: 'ml', axis: 'ml' }, byDay((d) => d.water_ml));
  push({ id: 'meals', label: 'Meals', axis: 'meals' }, byDay((d) => d.meals_count));
  push({ id: 'appetite', label: 'Appetite', unit: '/5', axis: '/5' }, byDay((d) => d.appetite_level));
  push({ id: 'awakenings', label: 'Night awakenings', axis: 'wake-ups' }, byDay((d) => d.sleep_awakenings));
  push(
    { id: 'activity', label: 'Active minutes', unit: 'min', axis: 'min' },
    byDay((d) => {
      const mins = (d.activities ?? []).reduce((s, a) => s + (a.duration_minutes ?? 0), 0);
      return mins > 0 ? mins : null;
    }),
  );
  push(
    { id: 'calories', label: 'Calories burned', unit: 'kcal', axis: 'kcal' },
    byDay((d) => {
      const kcal = (d.activities ?? []).reduce((s, a) => s + (a.calories_burned ?? 0), 0);
      return kcal > 0 ? kcal : null;
    }),
  );
  push(
    { id: 'pain', label: 'Pain severity', unit: '/10', axis: '/10' },
    byDay((d) => {
      const sev = (d.pain ?? []).map((p) => p.severity).filter((v) => v != null);
      return sev.length > 0 ? Math.max(...sev) : null;
    }),
  );

  // Vitals by concept — one stream per logged vital (heart rate resolves to
  // the 'hr' id so it can carry a health verdict).
  const byConcept = new Map<string, TimeSeriesPoint[]>();
  const conceptUnit = new Map<string, string>();
  for (const d of details) {
    for (const v of d.vitals ?? []) {
      if (v.value == null || !Number.isFinite(v.value)) continue;
      const cid = v.concept_id ?? `unit:${v.unit ?? 'x'}`;
      const arr = byConcept.get(cid) ?? [];
      arr.push({ date: d.log_date, value: v.value });
      byConcept.set(cid, arr);
      if (v.unit) conceptUnit.set(cid, v.unit);
    }
  }
  for (const [cid, points] of byConcept) {
    points.sort((a, b) => byDate(a.date, b.date));
    const label = vitalLabels.get(cid) ?? (conceptUnit.get(cid) ? `Vital (${conceptUnit.get(cid)})` : 'Vital sign');
    const id = isHeartLabel(label) ? 'hr' : `vital:${cid}`;
    const unit = conceptUnit.get(cid);
    push({ id, label, unit, axis: unit ?? '' }, points);
  }

  return out;
}

// ─── Feed assembly ──────────────────────────────────────────────────────────

// Pairs from the same log event are artifactual (e.g. calories vs active
// minutes) — never correlate them.
const EXCLUDED_PAIRS = new Set(['activity|calories']);

const MAX_SCATTERS = 8;

export interface CorrelationPair {
  aId: string;
  bId: string;
  aLabel: string;
  bLabel: string;
  aAxis: string;
  bAxis: string;
  r: number | null;
  paired: number;
  verdict: HealthVerdict;
  points: ScatterDatum[];
}

/**
 * All stream pairings with ≥3 shared dates (single math source for the feed
 * cards AND the 3D graph's semantic edges — keep them in sync here).
 */
export function computeCorrelationPairs(streams: StreamSeries[]): CorrelationPair[] {
  const byStream = new Map(streams.map((s) => [s.def.id, new Map(s.points.map((p) => [p.date, p.value]))]));
  const out: CorrelationPair[] = [];
  for (let i = 0; i < streams.length; i++) {
    for (let j = i + 1; j < streams.length; j++) {
      const a = streams[i];
      const b = streams[j];
      if (EXCLUDED_PAIRS.has(pairKey(a.def.id, b.def.id))) continue;
      const am = byStream.get(a.def.id)!;
      const bm = byStream.get(b.def.id)!;
      let paired = 0;
      const pairedPts: ScatterDatum[] = [];
      for (const [date, x] of am) {
        const y = bm.get(date);
        if (y != null) { paired++; pairedPts.push({ x, y }); }
      }
      if (paired < 3) continue;
      const r = correlationCoefficient(pairedPts);
      out.push({
        aId: a.def.id,
        bId: b.def.id,
        aLabel: a.def.label,
        bLabel: b.def.label,
        aAxis: a.def.axis,
        bAxis: b.def.axis,
        r,
        paired,
        verdict: healthVerdict(a.def.id, b.def.id, r, paired),
        points: pairedPts,
      });
    }
  }
  return out;
}

export function buildCorrelationFeed(
  trends: TrendsResponse | null,
  dailyMetrics: DailyMetrics | null,
  localDetails: DailyCheckInDetail[] = [],
  vitalLabels: Map<string, string> = new Map(),
): CorrelationFeedItem[] {
  const items: CorrelationFeedItem[] = [];
  const streams: StreamSeries[] = [
    ...trendStreams(trends),
    ...localStreams(localDetails, vitalLabels),
  ];

  // ── date vs observation: one curve per stream ──
  for (const s of streams) {
    items.push({
      id: `series-${s.def.id}`,
      title: s.def.label,
      subtitle: `${s.points.length} ${s.points.length === 1 ? 'day' : 'days'}`,
      data: { kind: 'timeSeries', points: s.points, unit: s.def.unit },
      verdict: 'neutral',
      source: 'live',
    });
  }

  // ── Daily logging rhythm (system stream) ──
  const rhythm = (dailyMetrics?.recent_daily_logs ?? [])
    .slice()
    .sort((a, b) => byDate(a.log_date, b.log_date))
    .slice(-30)
    .map((p) => ({ date: p.log_date, value: p.event_count }));
  if (rhythm.length > 0) {
    items.push({
      id: 'series-rhythm',
      title: 'Daily logging rhythm',
      subtitle: `${rhythm.length} ${rhythm.length === 1 ? 'day' : 'days'}`,
      data: { kind: 'timeSeries', points: rhythm, unit: 'events' },
      verdict: 'neutral',
      source: 'live',
    });
  }

  // ── obs1 vs obs2: every pairing with ≥3 shared dates ──
  const candidates: CorrelationFeedItem[] = computeCorrelationPairs(streams).map((p) => ({
    id: `x-${p.aId}-${p.bId}`,
    title: `${p.aLabel} vs ${p.bLabel}`,
    subtitle: `${p.paired} paired days · ${verdictLabel(p.verdict)}`,
    data: {
      kind: 'correlation',
      points: p.points,
      r: p.r,
      verdict: p.verdict,
      xLabel: `${p.aLabel} (${p.aAxis})`,
      yLabel: `${p.bLabel} (${p.bAxis})`,
    },
    verdict: p.verdict,
    source: 'live',
  }));

  // Verdict cards first (bad before good — attention first), then by |r|.
  const rank = (v: HealthVerdict) => (v === 'bad' ? 0 : v === 'good' ? 1 : 2);
  candidates.sort((p, q) => {
    const pv = p.data.kind === 'correlation' ? rank(p.data.verdict) : 2;
    const qv = q.data.kind === 'correlation' ? rank(q.data.verdict) : 2;
    if (pv !== qv) return pv - qv;
    const pr = Math.abs(p.data.kind === 'correlation' ? p.data.r ?? 0 : 0);
    const qr = Math.abs(q.data.kind === 'correlation' ? q.data.r ?? 0 : 0);
    return qr - pr;
  });
  items.push(...candidates.slice(0, MAX_SCATTERS));

  return items;
}

// ─── Hook: feed + offline-first local streams ───────────────────────────────

/**
 * useCorrelationFeed — assembles the live feed, merging server trends with
 * the last 30 days of local SQLite logs (so vitals, water, activity and pain
 * get real date-vs-observation curves and obs-vs-obs pairs).
 *
 * Per the data-fetching rules: cached/server data renders immediately while
 * local streams hydrate underneath; a local failure keeps the server-only
 * feed rather than emptying it.
 */
export function useCorrelationFeed(
  trends: TrendsResponse | null,
  dailyMetrics: DailyMetrics | null,
  days = 30,
): {
  items: CorrelationFeedItem[];
  isLocalLoading: boolean;
  refetchLocal: () => void;
  localDetails: DailyCheckInDetail[];
  takenEvents: MedicationTakenEvent[];
} {
  const [localDetails, setLocalDetails] = useState<DailyCheckInDetail[]>([]);
  const [takenEvents, setTakenEvents] = useState<MedicationTakenEvent[]>([]);
  const [isLocalLoading, setIsLocalLoading] = useState(true);
  const runRef = useRef(0);

  const loadLocal = useCallback(async () => {
    const run = ++runRef.current;
    setIsLocalLoading(true);
    try {
      const patientId = getCachedPatientId();
      if (!patientId) {
        if (run === runRef.current) {
          setLocalDetails([]);
          setTakenEvents([]);
          setIsLocalLoading(false);
        }
        return;
      }
      const logs = await getDailyLogs(patientId, days).catch(() => []);
      // Concurrent detail hydration — sequential awaits stall the feed.
      const details = await Promise.all(
        logs.map((log) => getDailyLogDetail(patientId, log.log_date).catch(() => null)),
      );
      const out = details.filter((d): d is DailyCheckInDetail => d !== null);
      const taken = await getMedicationTakenEvents(patientId, Math.min(400, Math.max(50, days))).catch(() => []);
      if (run === runRef.current) {
        setLocalDetails(out);
        setTakenEvents(taken);
      }
    } catch {
      if (run === runRef.current) {
        setLocalDetails([]);
        setTakenEvents([]);
      }
    } finally {
      if (run === runRef.current) setIsLocalLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void loadLocal();
  }, [loadLocal]);

  const items = useMemo(() => {
    const vitalLabels = vitalLabelMap(dailyMetrics);
    return buildCorrelationFeed(trends, dailyMetrics, localDetails, vitalLabels);
  }, [trends, dailyMetrics, localDetails]);

  return { items, isLocalLoading, refetchLocal: loadLocal, localDetails, takenEvents };
}
