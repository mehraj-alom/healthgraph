/**
 * useDialMetrics — shared health-dial computation (dashboard + Priority world).
 *
 * The dial-day pipeline moved verbatim from HealthDashboardScreen so both
 * surfaces consume one computation: day-keyed series → camera overlay →
 * fractional day scrub → spoke metrics with verdicts. Callers supply
 * already-fetched inputs (no fetching here, no duplicated subscriptions);
 * the memo and its dependency list are unchanged, so rendered output is
 * identical wherever it is used.
 */

import { useMemo, useState } from 'react';
import { useTrends } from '@/hooks/useTrends';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { useHomeStory } from '@/screens/Dashboard/useHomeStory';
import {
  useCorrelationFeed,
  trendStreams,
  localStreams,
  vitalLabelMap,
  assessMetric,
  assessSeries,
} from '@/screens/Dashboard/correlations';
import { useLocalHeartRate } from '@/hooks/useLocalHeartRate';
import { mergeHeartRateSeries } from '@/db/queries/heartRate';
import {
  detectHeartRate,
  formatSleepMinutes,
  formatWaterMl,
  formatDurationMinutes,
  localDateString,
} from '@/screens/Dashboard/homeData';
import type { HMetric } from '@/components/home/HGraphMap';

/** Shift a YYYY-MM-DD day-key by whole days ( noon-anchored, DST-safe ). */
function shiftDay(dateStr: string, delta: number): string {
  return localDateString(new Date(new Date(`${dateStr}T12:00:00`).getTime() + delta * 86400000));
}

export interface DialInputs {
  trendsData: ReturnType<typeof useTrends>['data'];
  metricsData: ReturnType<typeof useDailyMetrics>['data'];
  localDetails: ReturnType<typeof useCorrelationFeed>['localDetails'];
  takenEvents: ReturnType<typeof useCorrelationFeed>['takenEvents'];
  medSummary: ReturnType<typeof useHomeStory>['medSummary'];
  hrPoints: ReturnType<typeof useLocalHeartRate>['points'];
}

export interface DialDay {
  metrics: HMetric[];
  off: number;
  max: number;
  label: string;
  range: number;
}

export function useDialMetrics(input: DialInputs): {
  dialDay: DialDay;
  hMetrics: HMetric[];
  setDayOffset: (n: number) => void;
  setDayRange: (n: number) => void;
} {
  const { trendsData, metricsData, localDetails, takenEvents, medSummary, hrPoints } = input;

  // Day scrubber: the dial shows ONE day at a time. dayOffset 0 = latest
  // day with data, up to 6 back. Spoke values are that day's log
  // (carried forward when a day was skipped); verdicts use the window
  // ENDING on that day, so the past reads exactly as it did. No static
  // multi-day averages anywhere on this screen.
  const [dayOffset, setDayOffset] = useState(0);
  /** How many days back the scrubber reaches — user picks 7 / 14 / 30. */
  const [dayRange, setDayRange] = useState(7);

  const dialDay: DialDay = useMemo(() => {
    const byId = new Map<string, { date: string; value: number }[]>();
    for (const s of [...trendStreams(trendsData), ...localStreams(localDetails, vitalLabelMap(metricsData))]) {
      // Day-keys only: an ISO datetime would poison string comparison.
      byId.set(
        s.def.id,
        [...s.points]
          .map((p) => ({ date: p.date.slice(0, 10), value: p.value }))
          .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
      );
    }
    // Camera overlay (local-first): device PPG/RPPG rows live outside server
    // trends and manual-vital streams, so without this merge a fresh
    // measurement never reaches the Heart spoke. Camera wins same-day ties
    // (freshest on-device truth); purely-server days pass through untouched.
    // All downstream semantics (bands, carry-forward, trend) are unchanged.
    if (hrPoints.length > 0) {
      byId.set('hr', mergeHeartRateSeries(byId.get('hr') ?? [], hrPoints));
    }
    let latest = '';
    let earliest = '';
    for (const pts of byId.values()) {
      for (const p of pts) {
        if (!latest || p.date > latest) latest = p.date;
        if (!earliest || p.date < earliest) earliest = p.date;
      }
    }
    const span = latest && earliest
      ? Math.max(0, Math.round((new Date(`${latest}T12:00:00`).getTime() - new Date(`${earliest}T12:00:00`).getTime()) / 86400000))
      : 0;
    const max = Math.min(Math.max(dayRange - 1, 0), span);
    // Fractional scrub position: lo/hi are the bracketing whole days, f the
    // blend between them. Spoke VALUES interpolate (the dial glides); the
    // good/bad verdict rides the nearest whole day (verdicts don't blend).
    const pos = Math.min(Math.max(dayOffset, 0), max);
    const lo = Math.min(Math.floor(pos + 1e-6), max);
    const hi = Math.min(lo + 1, max);
    const f = Math.min(1, Math.max(0, pos - lo));
    const dateLo = latest ? shiftDay(latest, -lo) : '';
    const dateHi = latest ? shiftDay(latest, -hi) : '';
    const dateNear = f < 0.5 ? dateLo : dateHi;
    const out: HMetric[] = [];
    const uptoNear = (id: string) => (byId.get(id) ?? []).filter((p) => p.date <= dateNear).map((p) => p.value);
    const atDate = (id: string, dateStr: string) => {
      const pts = (byId.get(id) ?? []).filter((p) => p.date <= dateStr);
      return pts.length > 0 ? pts[pts.length - 1].value : null;
    };
    const dayVal = (id: string) => {
      const a = atDate(id, dateLo);
      if (f === 0 || dateHi === dateLo) return a;
      const b = atDate(id, dateHi);
      if (a == null) return b;
      if (b == null) return a;
      return a + (b - a) * f;
    };
    const round1 = (v: number) => Math.round(v * 10) / 10;

    const push = (
      id: string,
      label: string,
      min: number,
      max: number,
      bandLo: number,
      bandHi: number,
      higherBetter: boolean,
      eps: number,
      fmt: (avg: number) => string,
    ) => {
      const day = dayVal(id);
      if (day == null) return;
      const a = assessMetric(uptoNear(id), higherBetter, eps, bandLo, bandHi);
      out.push({
        id, label,
        valueText: fmt(day),
        value: Math.max(min, Math.min(max, day)),
        min, max, bandLo, bandHi,
        good: !a.bad, trend: a.trend, avgDays: a.days,
      });
    };

    push('sleepDur', 'Sleep', 0, 600, 420, 540, true, 8, (a) => formatSleepMinutes(Math.round(a)));
    push('energy', 'Energy', 1, 5, 4, 5, true, 0.08, (a) => `${round1(a)}/5`);
    push('water', 'Water', 0, 3000, 2000, 2500, true, 60, (a) => formatWaterMl(Math.round(a)));
    push('stress', 'Stress', 1, 5, 1, 2, false, 0.08, (a) => `Lv ${Math.round(a)}`);
    push('activity', 'Move', 0, 90, 30, 60, true, 3, (a) => formatDurationMinutes(Math.round(a)));
    push('wellbeing', 'Wellbeing', 1, 5, 4, 5, true, 0.08, (a) => `${round1(a)}/5`);
    push('pain', 'Pain', 0, 10, 0, 2, false, 0.15, (a) => `${round1(a)}/10`);
    push('meals', 'Meals', 0, 4, 2, 3, true, 0.08, (a) => `${round1(a)}`);

    // Heart: red when the average leaves the resting band or the trend walks
    // away from it (distance from 80bpm growing).
    const hrPts = uptoNear('hr');
    if (hrPts.length > 0) {
      const day = dayVal('hr') ?? hrPts[hrPts.length - 1];
      const a = assessSeries(hrPts, 1);
      const inBand = day >= 60 && day <= 100;
      const walkingAway = a.enough && Math.abs(hrPts[hrPts.length - 1] - 80) > Math.abs(hrPts[0] - 80) + 2;
      out.push({
        id: 'heart', label: 'Heart', valueText: `${Math.round(day)} bpm`,
        value: Math.max(40, Math.min(120, day)), min: 40, max: 120, bandLo: 60, bandHi: 100,
        good: inBand && !walkingAway, trend: a.trend, avgDays: a.days,
      });
    } else if (dateNear === latest) {
      const hr = detectHeartRate(metricsData ?? null);
      if (hr) {
        out.push({
          id: 'heart', label: 'Heart', valueText: `${hr.value} bpm`, value: hr.value,
          min: 40, max: 120, bandLo: 60, bandHi: 100,
          good: hr.value >= 60 && hr.value <= 100, trend: 'flat', avgDays: 1,
        });
      }
    }

    // Doses: 7-day adherence — taken (TAKEN) per local day vs the expected
    // schedule; today blends local counts with the server-aware summary.
    const med = medSummary;
    if (med?.hasSchedule && med.dosesExpected > 0 && dateNear) {
      // Adherence windows end on the scrubbed days; the shown pct blends
      // between the bracketing days so scrubbing never steps.
      const pctsFor = (endDate: string) => {
        const dayKeys: string[] = [];
        for (let i = 6; i >= 0; i--) dayKeys.push(shiftDay(endDate, -i));
        return dayKeys.map((d) => Math.min(100, ((takenByDay.get(d) ?? 0) / med.dosesExpected) * 100));
      };
      const todayK = localDateString();
      const takenByDay = new Map<string, number>();
      for (const e of takenEvents) {
        if (e.status !== 'TAKEN') continue;
        const k = localDateString(new Date(e.taken_at));
        takenByDay.set(k, (takenByDay.get(k) ?? 0) + 1);
      }
      if (dateNear === todayK) takenByDay.set(todayK, Math.max(takenByDay.get(todayK) ?? 0, med.dosesTaken));
      const pctsLo = pctsFor(dateLo);
      const pctsHi = dateHi === dateLo ? pctsLo : pctsFor(dateHi);
      const pctsNear = f < 0.5 ? pctsLo : pctsHi;
      const a = assessMetric(pctsNear, true, 2, 80, 100);
      const dayPct = pctsLo[pctsLo.length - 1] + (pctsHi[pctsHi.length - 1] - pctsLo[pctsLo.length - 1]) * f;
      out.push({
        id: 'doses', label: 'Doses', valueText: `${Math.round(dayPct)}%`,
        value: Math.max(0, Math.min(100, dayPct)), min: 0, max: 100, bandLo: 80, bandHi: 100,
        good: !a.bad, trend: a.trend, avgDays: a.days,
      });
    }
    const todayK = localDateString();
    const label = !dateNear
      ? 'Log your first day'
      : dateNear === todayK
        ? 'Today'
        : shiftDay(todayK, -1) === dateNear
          ? 'Yesterday'
          : new Date(`${dateNear}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return { metrics: out.slice(0, 10), off: pos, max, label, range: dayRange };
  }, [trendsData, metricsData, localDetails, takenEvents, medSummary, hrPoints, dayOffset, dayRange]);

  return { dialDay, hMetrics: dialDay.metrics, setDayOffset, setDayRange };
}
