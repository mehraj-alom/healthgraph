/**
 * useDeviceHeartNodes — pending camera readings as graph nodes.
 *
 * Reads the SQLite pending sets directly (both modalities), so a fresh
 * measurement appears on the HealthGraph canvas without waiting for server
 * sync + projection. Synced rows are deliberately excluded (the server
 * projects those). Refreshes on focus and on dataRefresh; logged-out
 * yields no nodes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { getCachedPatientId } from '@/services/patientIdentity';
import { waitForIdentityReady } from '@/services/backendIdentity';
import { getPendingPpgMeasurements } from '@/db/queries/ppg';
import { getPendingRppgMeasurements } from '@/db/queries/rppg';
import { subscribeDataRefresh } from '@/services/dataRefresh';
import { buildDeviceHeartNodes } from '@/screens/Body/deviceNodes';
import type { GraphNode } from '@/hooks/useHealthGraph';

export function useDeviceHeartNodes(): GraphNode[] {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      if (!uid) {
        if (mounted.current) setNodes([]);
        return;
      }
      await waitForIdentityReady().catch(() => {});
      const patientId = getCachedPatientId();
      if (!patientId || !mounted.current) {
        if (mounted.current) setNodes([]);
        return;
      }
      const [ppg, rppg] = await Promise.all([
        getPendingPpgMeasurements(patientId).catch(() => []),
        getPendingRppgMeasurements(patientId).catch(() => []),
      ]);
      if (mounted.current) setNodes(buildDeviceHeartNodes(ppg, rppg));
    } catch {
      if (mounted.current) setNodes([]);
    }
  }, [uid]);

  useEffect(() => {
    mounted.current = true;
    void load();
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

  return nodes;
}
