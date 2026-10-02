import { useEffect, useState } from 'react';

import { getSymptomDays } from '@/db/queries/dailyLogs';
import { api } from '@/services/api';
import { cycleStats } from '@/services/cyclePredictions';
import { buildPatternLines } from '@/services/cycleSymptomLink';
import { resolveConceptNames } from '@/services/healthConnect/conceptResolver';
import { getCachedPatientId } from '@/services/patientIdentity';
import { todayKeyLocal } from '@/utils/dayKey';

export interface PatternSourceEntry {
  kind: string;
  date: string;
}

/**
 * useCyclePatterns — symptom-phase co-occurrence lines for the Cycle screen.
 *
 * Keeps the tracker screen device-only (batch3 wiring guard): all network
 * access (concept labels) happens here in the hook, never in the screen.
 * Returns null while loading, when history is thin, or when offline —
 * the card simply stays hidden.
 */
export function useCyclePatterns(entries: PatternSourceEntry[]): string[] | null {
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    const startDays = entries
      .filter((e) => e.kind === 'period-start' && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
      .map((e) => e.date)
      .sort()
      .slice(-7);
    const patientId = getCachedPatientId();
    if (startDays.length < 2 || !patientId) {
      setLines(null);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const stats = cycleStats(startDays.map((date) => ({ date })));
        if (!stats) {
          if (live) setLines(null);
          return;
        }
        const [symptoms, concepts] = await Promise.all([
          getSymptomDays(patientId, startDays[0], todayKeyLocal()).catch(() => []),
          api.get('/api/v1/ontology/manual-log-concepts').catch(() => []),
        ]);
        const names = await resolveConceptNames(async () => concepts);
        const occ = symptoms.map((s) => ({
          date: s.log_date,
          label: (s.concept_id && names.get(s.concept_id)) || 'Logged symptom',
        }));
        if (live) setLines(buildPatternLines(occ, startDays, stats.medianLength));
      } catch {
        if (live) setLines(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [entries]);

  return lines;
}
