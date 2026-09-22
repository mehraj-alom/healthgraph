/**
 * useLocalHeartRate — SQLite-direct heart-rate feed for the dial.
 *
 * Reads the unified camera feed (ppg_measurements + rppg_measurements via
 * db/queries/heartRate) so a successful measurement moves local UI without
 * any server round trip. Updates arrive through the existing dataRefresh
 * pub/sub (no polling) plus focus reloads; patient scoping comes from
 * reading getCachedPatientId() on every load (no patient → empty, never the
 * previous user's rows). React Query and server aggregates are untouched.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getCachedPatientId } from '@/services/patientIdentity';
import {
  getRecentLocalHeartRates,
  toHeartDayPoints,
  type HeartDayPoint,
} from '@/db/queries/heartRate';
import { subscribeDataRefresh } from '@/services/dataRefresh';

export type { HeartDayPoint };

export interface UseLocalHeartRate {
  /** Day-collapsed camera points, ascending (dial-stream shape). */
  points: HeartDayPoint[];
  /** Newest point, or null when no local camera measurement exists. */
  latest: HeartDayPoint | null;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

export function useLocalHeartRate(limit = 30): UseLocalHeartRate {
  const [points, setPoints] = useState<HeartDayPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const patientId = getCachedPatientId();
      if (!patientId) {
        if (mounted.current) {
          setPoints([]);
          setIsLoading(false);
        }
        return;
      }
      const rows = await getRecentLocalHeartRates(patientId, limit);
      if (mounted.current) {
        setPoints(toHeartDayPoints(rows));
        setIsLoading(false);
      }
    } catch {
      if (mounted.current) setIsLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    mounted.current = true;
    void load();
    // Live propagation: measurement saves announce via requestDataRefresh()
    // immediately after their local SQLite insert (never gated on the POST).
    const unsubscribe = subscribeDataRefresh(() => {
      void load();
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refetch = useCallback(async () => {
    await load();
  }, [load]);

  return {
    points,
    latest: points.length > 0 ? points[points.length - 1] : null,
    isLoading,
    refetch,
  };
}
