import { useState, useEffect, useCallback, useRef } from 'react';
import { homeCache, CACHE_TTL } from '@/services/homeCache';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';

type CacheKey = keyof typeof CACHE_TTL;

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
    
    try {
      if (showRefreshing) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      // Check cache first
      const cached = showRefreshing
        ? { data: null, fromCache: false, age: 0 }
        : await homeCache.get<T>(userId, cacheKey);
      
      if (mountedRef.current && fetchId === fetchCountRef.current) {
        if (cached.data) {
          setData(cached.data);
          dataRef.current = cached.data;
          setIsFromCache(true);
          
          // If cache is fresh enough, don't fetch
          if (!cached.fromCache || cached.age < CACHE_TTL[cacheKey] * 0.5) {
            setIsLoading(false);
            setIsRefreshing(false);
            return;
          }
        }
      }

      // Fetch fresh data
      const freshData = await queryFn();
      
      if (mountedRef.current && fetchId === fetchCountRef.current) {
        setData(freshData);
        dataRef.current = freshData;
        setIsFromCache(false);
        lastFetchTimeRef.current = Date.now();
        
        // Cache the fresh data
        await homeCache.set(userId, cacheKey, freshData);
        
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