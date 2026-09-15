import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type TrendRangeKey = 'week' | 'month' | 'year';

export const TREND_RANGES: Record<TrendRangeKey, { label: string; days: number }> = {
  week: { label: 'Week', days: 7 },
  month: { label: 'Month', days: 30 },
  year: { label: 'Year', days: 365 },
};

export const TREND_RANGE_ORDER: TrendRangeKey[] = ['week', 'month', 'year'];

const STORAGE_KEY = 'trend-range-key';

interface TrendRangeValue {
  range: TrendRangeKey;
  days: number;
  setRange: (range: TrendRangeKey) => void;
}

const TrendRangeContext = createContext<TrendRangeValue>({
  range: 'month',
  days: 30,
  setRange: () => {},
});

/**
 * Global correlation time range — selected once, applied to every graph
 * (dashboard feed, local curves, Trends screen). Persisted so the choice
 * survives restarts.
 */
export function TrendRangeProvider({ children }: { children: React.ReactNode }) {
  const [range, setRangeState] = useState<TrendRangeKey>('month');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved === 'week' || saved === 'month' || saved === 'year') {
          setRangeState(saved);
        }
      })
      .catch(() => {
        // Storage unavailable — month default stands.
      });
  }, []);

  const setRange = useCallback((next: TrendRangeKey) => {
    setRangeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  return (
    <TrendRangeContext.Provider value={{ range, days: TREND_RANGES[range].days, setRange }}>
      {children}
    </TrendRangeContext.Provider>
  );
}

export function useTrendRange(): TrendRangeValue {
  return useContext(TrendRangeContext);
}
