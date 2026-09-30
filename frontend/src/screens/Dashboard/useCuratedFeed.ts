/**
 * useCuratedFeed — curated correlations shared by the dashboard preview
 * and the first-class Insights feed.
 *
 * Unusual cards dropped, 6–8 core cards by default, user-added series +
 * custom-built pairs persisted in AsyncStorage. Pure derivation over the
 * live feed; no fetching of its own.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  correlationPairKey,
  pairToFeedItem,
  type CorrelationFeedItem,
  type CorrelationPair,
  type StreamSeries,
} from '@/screens/Dashboard/correlations';

// Unusual/system streams never reach the feed: records processed, logging
// rhythm, calories (a pure derivative of active minutes), and unlabeled
// generic vitals ("Vital (mg)" with no concept name).
const DROPPED_ITEM_IDS = new Set(['series-records', 'series-rhythm', 'series-calories']);

function isUnusualItem(item: CorrelationFeedItem): boolean {
  if (DROPPED_ITEM_IDS.has(item.id)) return true;
  if (item.id.startsWith('series-vital:') && /^Vital(\s|\(|$)/i.test(item.title)) return true;
  return false;
}

// Core daily signals in display order — the default 6–8 cards.
const CORE_STREAM_ORDER = [
  'sleepDur',
  'wellbeing',
  'energy',
  'stress',
  'water',
  'activity',
  'pain',
  'hr',
];
const MAX_CORE_SERIES = 5;
const MAX_TOP_SCATTERS = 3;

const FEED_PREFS_KEY = 'hg:feed-custom:v1';

interface FeedPrefs {
  series: string[];
  pairs: string[];
}

export function useCuratedFeed(
  liveItems: CorrelationFeedItem[],
  streams: StreamSeries[],
  pairs: CorrelationPair[],
): {
  visibleFeed: CorrelationFeedItem[];
  poolItems: CorrelationFeedItem[];
  addedSeries: string[];
  addedPairs: string[];
  toggleSeries: (streamId: string) => void;
  togglePair: (pairKey: string) => void;
} {
  const [addedSeries, setAddedSeries] = useState<string[]>([]);
  const [addedPairs, setAddedPairs] = useState<string[]>([]);
  const loadedRef = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(FEED_PREFS_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw) as FeedPrefs;
          if (Array.isArray(parsed.series)) setAddedSeries(parsed.series.filter((s) => typeof s === 'string'));
          if (Array.isArray(parsed.pairs)) setAddedPairs(parsed.pairs.filter((s) => typeof s === 'string'));
        } catch {
          // Corrupt prefs — fall back to defaults.
        }
      })
      .catch(() => {})
      .finally(() => {
        loadedRef.current = true;
      });
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    AsyncStorage.setItem(FEED_PREFS_KEY, JSON.stringify({ series: addedSeries, pairs: addedPairs } satisfies FeedPrefs)).catch(
      () => {},
    );
  }, [addedSeries, addedPairs]);

  const toggleSeries = useCallback((streamId: string) => {
    setAddedSeries((prev) => (prev.includes(streamId) ? prev.filter((s) => s !== streamId) : [...prev, streamId]));
  }, []);

  const togglePair = useCallback((pairKey: string) => {
    setAddedPairs((prev) => (prev.includes(pairKey) ? prev.filter((s) => s !== pairKey) : [...prev, pairKey]));
  }, []);

  const curated = useMemo(() => {
    const live = liveItems.filter((i) => !isUnusualItem(i));
    const series = live.filter((i) => i.data.kind === 'timeSeries');
    const scatters = live.filter((i) => i.data.kind === 'correlation');
    const seriesById = new Map(series.map((s) => [s.id, s]));

    // Default core: first present core streams (≤5) + top verdict scatters (≤3).
    const core: CorrelationFeedItem[] = [];
    for (const sid of CORE_STREAM_ORDER) {
      if (core.length >= MAX_CORE_SERIES) break;
      const it = seriesById.get(`series-${sid}`);
      if (it) core.push(it);
    }
    const top = scatters.slice(0, MAX_TOP_SCATTERS);

    // User additions, resolved against live data (stale ids drop out).
    const added: CorrelationFeedItem[] = [];
    for (const sid of addedSeries) {
      const it = seriesById.get(`series-${sid}`);
      if (it) added.push(it);
    }
    for (const key of addedPairs) {
      const p = pairs.find((q) => correlationPairKey(q.aId, q.bId) === key) ?? null;
      if (p) added.push(pairToFeedItem(p));
    }

    const seen = new Set<string>();
    const visibleFeed: CorrelationFeedItem[] = [];
    for (const it of [...core, ...top, ...added]) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      visibleFeed.push(it);
    }
    const poolItems = live.filter((i) => !seen.has(i.id));
    return { visibleFeed, poolItems };
  }, [liveItems, pairs, addedSeries, addedPairs]);

  return {
    visibleFeed: curated.visibleFeed,
    poolItems: curated.poolItems,
    addedSeries,
    addedPairs,
    toggleSeries,
    togglePair,
  };
}
