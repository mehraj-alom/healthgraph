import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';
import { getCachedPatientId } from '@/services/patientIdentity';
import {
  CACHE_TTL,
  getProfileCache,
  setProfileCache,
  getDailyMetricsCache,
  setDailyMetricsCache,
  getTrendsCache,
  setTrendsCache,
} from '@/db/queries/homeCache';

type CacheKey = 'profile' | 'dailyMetrics' | 'trends';

interface UseCachedQueryOptions<T> {
  cacheKey: CacheKey;
  queryFn: () => Promise<T>;
  enabled?: boolean;
  onSuccess?: (data: T) => void;
}

interface UseCachedQueryResult<T> {
  data: T | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
  isError: boolean;
  refetch: () => Promise<void>;
  isFromCache: boolean;
}

// Helper to get cache based on key
async function getCache(patientId: string, key: CacheKey): Promise<{ data: any | null; cachedAt: number }> {
  switch (key) {
    case 'profile':
      return getProfileCache(patientId);
    case 'dailyMetrics':
      return getDailyMetricsCache(patientId);
    case 'trends':
      return getTrendsCache(patientId, 30); // Default 30 days
    default:
      return { data: null, cachedAt: 0 };
  }
}

// Helper to set cache based on key
async function setCache(patientId: string, key: CacheKey, data: any): Promise<void> {
  switch (key) {
    case 'profile':
      return setProfileCache(patientId, data);
    case 'dailyMetrics':
      return setDailyMetricsCache(patientId, data);
    case 'trends':
      return setTrendsCache(patientId, 30, data); // Default 30 days
    default:
      return;
  }
}

export function useCachedQuery<T>({
  cacheKey,
  queryFn,
  enabled = true,
  onSuccess,
}: UseCachedQueryOptions<T>): UseCachedQueryResult<T> {
  const { user } = useAuth();
  const userId = user?.uid ?? 'anonymous';
  
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isFromCache, setIsFromCache] = useState(false);
  const dataRef = useRef<T | null>(null);
  
  const mountedRef = useRef(true);
  const fetchCountRef = useRef(0);
  const lastFetchTimeRef = useRef(0);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (!enabled || !user) return;

    const fetchId = ++fetchCountRef.current;
    const patientId = getCachedPatientId();
    
    try {
      if (showRefreshing) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      // Check SQLite cache first — cache failure must NOT block the API call.
      // On first launch the DB may not exist yet; on crypto init failure the
      // DB cannot open. In both cases we skip the cache and go straight to
      // the network.
      let cached: { data: T | null; cachedAt: number } = { data: null, cachedAt: 0 };
      if (!showRefreshing && patientId) {
        try {
          cached = await getCache(patientId, cacheKey);
        } catch {
          // SQLite not ready or cache corrupted — proceed to API
        }
      }

      if (mountedRef.current && fetchId === fetchCountRef.current) {
        if (cached.data) {
          const age = Date.now() - cached.cachedAt;
          setData(cached.data);
          dataRef.current = cached.data;
          setIsFromCache(true);
          
          // If cache is fresh enough, don't fetch
          if (age < CACHE_TTL[cacheKey] * 0.5) {
            setIsLoading(false);
            setIsRefreshing(false);
            return;
          }
        }
      }

      // Fetch fresh data from the network
      const freshData = await queryFn();
      
      if (mountedRef.current && fetchId === fetchCountRef.current) {
        setData(freshData);
        dataRef.current = freshData;
        setIsFromCache(false);
        lastFetchTimeRef.current = Date.now();
        
        // Best-effort: cache the fresh data in SQLite (ignore write failure)
        if (patientId) {
          try {
            await setCache(patientId, cacheKey, freshData);
          } catch {
            // SQLite not ready — data is still held in memory state
          }
        }
        
        onSuccess?.(freshData);
      }
    } catch (err) {
      if (mountedRef.current && fetchId === fetchCountRef.current) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        
        // If we have cached data, don't show error
        if (dataRef.current) {
          setError(null);
        }
      }
    } finally {
      if (mountedRef.current && fetchId === fetchCountRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [userId, cacheKey, queryFn, enabled, user, onSuccess]);

  // Initial fetch
  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  // Refetch function for pull-to-refresh
  const refetch = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  return {
    data,
    isLoading,
    isRefreshing,
    error,
    isError: error !== null,
    refetch,
    isFromCache,
  };
}