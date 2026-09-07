import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/services/api';
import { getCachedPatientId } from '@/services/patientIdentity';
import {
  getBodyStateSnapshots as dbGetBodyStateSnapshots,
  hydrateBodyStateSnapshots as dbHydrateBodyStateSnapshots,
} from '@/db/queries/observations';
import { useAuth } from '@/context/AuthContext';
import { BodyStateItem } from '@/types';

export function useBodyState() {
  const { user } = useAuth();
  const [data, setData] = useState<BodyStateItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isFromCache, setIsFromCache] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (!user) return;

    const patientId = getCachedPatientId();
    if (!patientId) return;

    try {
      if (showRefreshing) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      // Try local SQLite first
      const localSnapshots = await dbGetBodyStateSnapshots(patientId);
      if (mountedRef.current && localSnapshots.length > 0) {
        setData(localSnapshots);
        setIsFromCache(true);
        setIsLoading(false);
        setIsRefreshing(false);
        // Hydrate from server in background (fire-and-forget)
        hydrateFromServer(patientId).catch(() => {});
        return;
      }

      // Fallback: fetch from server
      const serverSnapshots = await api.get<BodyStateItem[]>('/api/v1/body-state');
      if (mountedRef.current) {
        setData(serverSnapshots);
        setIsFromCache(false);
        // Hydrate local SQLite
        await dbHydrateBodyStateSnapshots(patientId, serverSnapshots);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [user]);

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  const refetch = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  return {
    data,
    isLoading,
    isRefreshing,
    error,
    refetch,
    isFromCache,
  };
}

// Background hydration from server
async function hydrateFromServer(patientId: string): Promise<void> {
  try {
    const serverSnapshots = await api.get<BodyStateItem[]>('/api/v1/body-state');
    await dbHydrateBodyStateSnapshots(patientId, serverSnapshots);
  } catch {
    // Offline or error — ignore
  }
}