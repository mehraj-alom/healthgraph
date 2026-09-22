/**
 * useWeightEngine — Weight Engine data hook (Batch 6C).
 *
 * Reads the single real weight source: the cached server profile
 * (profile_cache.weight_kg via getProfileCache). Patient-scoped,
 * single-row read; refreshes on focus and on dataRefresh; logged-out
 * yields absent (the screen shows the honest empty state). No polling,
 * no writes, no derived series — a profile field is not a measurement
 * history and this hook never pretends otherwise.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { getCachedPatientId } from '@/services/patientIdentity';
import { waitForIdentityReady } from '@/services/backendIdentity';
import { getProfileCache } from '@/db/queries/homeCache';
import { subscribeDataRefresh } from '@/services/dataRefresh';
import {
  buildWeightEngineModel,
  type WeightEngineModel,
} from '@/screens/WeightEngine/weightEngine';

export function useWeightEngine(): {
  model: WeightEngineModel;
  isLoading: boolean;
  refetch: () => Promise<void>;
} {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [model, setModel] = useState<WeightEngineModel>(() =>
    buildWeightEngineModel(null),
  );
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      if (!uid) {
        if (mounted.current) {
          setModel(buildWeightEngineModel(null));
          setIsLoading(false);
        }
        return;
      }
      await waitForIdentityReady().catch(() => {});
      const patientId = getCachedPatientId();
      if (!patientId || !mounted.current) {
        if (mounted.current) setIsLoading(false);
        return;
      }
      const { data } = await getProfileCache(patientId).catch(() => ({
        data: null,
      }));
      if (!mounted.current) return;
      setModel(buildWeightEngineModel(data?.weight_kg ?? null));
      setIsLoading(false);
    } catch {
      if (mounted.current) setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => {
    mounted.current = true;
    setIsLoading(true);
    void load();
    const unsub = subscribeDataRefresh(() => {
      if (mounted.current) {
        setIsLoading(true);
        void load();
      }
    });
    return () => {
      mounted.current = false;
      unsub();
    };
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      void load();
    }, [load]),
  );

  return { model, isLoading, refetch: load };
}
