/**
 * useBehaviorImpacts — day-pattern impacts from device rows.
 *
 * Assembles trailing-day records from daily logs, substance entries,
 * cravings, and activities (all SQLite, all bounded) and computes
 * group-comparison impacts. Storage only — no network, no backend.
 */

import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getCachedPatientId } from '@/services/patientIdentity';
import { getActivityLogs, getDailyLogs } from '@/db/queries/dailyLogs';
import { listCravingEntries } from '@/db/queries/cravings';
import { listSubstanceEntries } from '@/db/queries/substances';
import { todayKeyLocal } from '@/utils/dayKey';
import {
  buildImpactDays,
  computeImpacts,
  type Impact,
} from '@/services/behaviorImpacts';

export const IMPACT_FACTORS = [
  { id: 'alcohol', label: 'alcohol days' },
  { id: 'tobacco', label: 'tobacco days' },
  { id: 'craving', label: 'craving days' },
  { id: 'exercise', label: 'exercise days' },
];

export const IMPACT_OUTCOMES = [
  { id: 'mood', label: 'mood' },
  { id: 'energy', label: 'energy' },
  { id: 'stress', label: 'stress' },
  { id: 'sleep', label: 'sleep' },
];

function shiftDay(dayKey: string, deltaDays: number): string {
  const d = new Date(`${dayKey}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function useBehaviorImpacts(days = 60): {
  impacts: Impact[];
  loading: boolean;
  reload: () => void;
} {
  const [impacts, setImpacts] = useState<Impact[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const patientId = getCachedPatientId();
      if (!patientId) {
        setImpacts([]);
        setLoading(false);
        return;
      }
      const today = todayKeyLocal();
      const start = shiftDay(today, -(days - 1));
      const [groups, substance, cravings, activities] = await Promise.all([
        getDailyLogs(patientId, days).catch(() => []),
        listSubstanceEntries(patientId, 500).catch(() => []),
        listCravingEntries(patientId, 500).catch(() => []),
        getActivityLogs(patientId, start, today).catch(() => []),
      ]);
      const rows = buildImpactDays({ groups, substance, cravings, activities });
      setImpacts(computeImpacts(rows, IMPACT_FACTORS, IMPACT_OUTCOMES));
      setLoading(false);
    } catch {
      setImpacts([]);
      setLoading(false);
    }
  }, [days]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  return { impacts, loading, reload: load };
}
