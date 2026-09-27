/**
 * TimelineWheel — the health journal as a 3D stack of daily report pages.
 *
 * The newest day sits in front; every older day fans out behind it, each
 * receding in scale, tilt and opacity like a stack of physical report
 * sheets on an invisible vertical wheel. Dragging up/down turns the wheel;
 * it settles snapped to whole pages.
 *
 * - Tap the front page → open its full daily report.
 * - Tap a page peeking behind → bring it to the front.
 * - Nothing here owns data: pages are pure DiaryDay view-models.
 *
 * One plain Animated.Value (`pos`, wheel position in index units) drives
 * every page: each page interpolates `pos` with an input range centred on
 * its own index. Interpolations are called ONLY on the Value itself —
 * never on composed nodes (Animated.add/subtract results), which do not
 * support .interpolate() on this RN build.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import type { DiaryDay } from './diary';
import { DIARY_PAGE_HEIGHT, DiarySheet } from './DiaryPaper';
import { SPACE } from '@/theme/guava';
import { useReducedMotion } from '@/theme/useReducedMotion';

/** Peek step: how far each neighbouring page is offset (px). */
const PEEK = 30;
/** Drag distance that advances one page (px). */
const DRAG_PER_STEP = 130;
/** Pages rendered around the active one; beyond ±3 steps they are invisible. */
const WINDOW = 8;
const SNAP_MS = 250;
const PERSPECTIVE = 900;

const clampIndex = (i: number, n: number) => Math.max(0, Math.min(n - 1, i));

export function TimelineWheel({
  days,
  patientName,
  focusDayKey,
  focusNonce = 0,
  onOpen,
  onActiveChange,
}: {
  days: DiaryDay[];
  patientName: string | null;
  /** Ask the wheel to bring this day to the front (AI nav / deep link). */
  focusDayKey: string | null;
  /** Bump to re-trigger a focus request for the same day. */
  focusNonce?: number;
  onOpen: (dayKey: string) => void;
  onActiveChange?: (dayKey: string) => void;
}) {
  const reduced = useReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRef = useRef(0);
  const [stageH, setStageH] = useState(0);

  // Wheel position in index units. Plain Value so every page can
  // interpolate it directly with a range centred on its own index.
  const pos = useRef(new Animated.Value(0)).current;
  // Numeric mirror — Animated.Value has no public getter.
  const posVal = useRef(0);
  // Wheel position where the current drag started.
  const dragStart = useRef(0);

  const daysRef = useRef(days);
  daysRef.current = days;
  // A behind-page tap queues that page to open once it lands in front —
  // tap → page comes forward → report opens, one continuous gesture.
  const pendingOpen = useRef<string | null>(null);

  const commit = useCallback(
    (target: number) => {
      const t = clampIndex(target, daysRef.current.length);
      Animated.timing(pos, {
        toValue: t,
        duration: reduced ? 0 : SNAP_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        posVal.current = t;
        activeRef.current = t;
        setActiveIndex(t);
        const day = daysRef.current[t];
        if (day) onActiveChange?.(day.dayKey);
        const queued = pendingOpen.current;
        pendingOpen.current = null;
        if (queued) {
          const hit = daysRef.current.find((d) => d.dayKey === queued);
          if (hit) onOpen(hit.dayKey);
        }
      });
    },
    [pos, onActiveChange, onOpen, reduced],
  );

  // Keep the numeric mirror and the active index (z-order + window) live
  // while the wheel turns.
  useEffect(() => {
    const id = pos.addListener(({ value }) => {
      posVal.current = value;
      const r = clampIndex(Math.round(value), daysRef.current.length);
      if (r !== activeRef.current) {
        activeRef.current = r;
        setActiveIndex(r);
      }
    });
    return () => pos.removeListener(id);
  }, [pos]);

  // External focus request (search → date): spin the wheel to that page.
  useEffect(() => {
    if (focusDayKey == null) return;
    const idx = daysRef.current.findIndex((d) => d.dayKey === focusDayKey);
    if (idx >= 0) commit(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDayKey, focusNonce]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Claim only clear vertical drags, so taps still reach the pages.
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
        onPanResponderGrant: () => {
          pos.stopAnimation();
          // A fresh drag cancels any queued behind-tap open.
          pendingOpen.current = null;
          dragStart.current = posVal.current;
        },
        onPanResponderMove: (_e, g) => {
          pos.setValue(clampIndex(dragStart.current - g.dy / DRAG_PER_STEP, daysRef.current.length));
        },
        onPanResponderRelease: (_e, g) => {
          // A quick fling carries momentum past the midpoint.
          const fling = Math.abs(g.vy) > 0.6 ? (g.vy < 0 ? 1 : -1) : 0;
          commit(Math.round(posVal.current) + fling);
        },
        onPanResponderTerminate: () => {
          commit(Math.round(posVal.current));
        },
      }),
    [pos, commit],
  );

  const onStageLayout = useCallback((e: LayoutChangeEvent) => {
    setStageH(e.nativeEvent.layout.height);
  }, []);

  const range = useMemo(() => {
    const lo = Math.max(0, activeIndex - WINDOW);
    const hi = Math.min(days.length - 1, activeIndex + WINDOW);
    const out: number[] = [];
    for (let i = lo; i <= hi; i++) out.push(i);
    return out;
  }, [activeIndex, days.length]);

  if (days.length === 0) return <View style={styles.stage} />;
  const centerTop = stageH > 0 ? (stageH - DIARY_PAGE_HEIGHT) / 2 : 0;

  return (
    <View style={styles.stage} onLayout={onStageLayout} {...pan.panHandlers}>
      {range.map((i) => {
        const day = days[i];
        const dist = i - activeIndex;
        const adist = Math.abs(dist);
        const front = dist === 0;
        // Input range centred on this page's own index — the wheel position
        // at which this page sits exactly in front.
        const inputRange = [i - 3, i - 2, i - 1, i, i + 1, i + 2, i + 3];
        const translateY = pos.interpolate({
          inputRange,
          outputRange: [-3 * PEEK, -2 * PEEK, -PEEK, 0, PEEK, 2 * PEEK, 3 * PEEK],
          extrapolate: 'clamp',
        });
        const rotateX = pos.interpolate({
          inputRange,
          outputRange: reduced
            ? ['0deg', '0deg', '0deg', '0deg', '0deg', '0deg', '0deg']
            : ['22deg', '16deg', '9deg', '0deg', '-9deg', '-16deg', '-22deg'],
          extrapolate: 'clamp',
        });
        const scale = pos.interpolate({
          inputRange,
          outputRange: [0.72, 0.82, 0.93, 1, 0.93, 0.82, 0.72],
          extrapolate: 'clamp',
        });
        const opacity = pos.interpolate({
          inputRange: [i - 3.2, i - 1, i, i + 1, i + 3.2],
          outputRange: [0, 0.45, 1, 0.45, 0],
          extrapolate: 'clamp',
        });
        return (
          <Animated.View
            key={day.dayKey}
            pointerEvents={adist <= 3 ? 'auto' : 'none'}
            style={[
              styles.pageWrap,
              { top: centerTop, zIndex: 1000 - adist },
              { transform: [{ perspective: PERSPECTIVE }, { translateY }, { rotateX }, { scale }], opacity },
            ]}
          >
            <Pressable
              onPress={() => {
                if (front) {
                  onOpen(day.dayKey);
                  return;
                }
                // Behind page: bring it forward, then open its report.
                pendingOpen.current = day.dayKey;
                commit(i);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: front }}
              accessibilityLabel={
                front
                  ? `Open daily report for ${day.fullDate}, ${day.total} entries`
                  : `Bring ${day.fullDate} to the front`
              }
              style={styles.pagePress}
            >
              <DiarySheet day={day} patientName={patientName} />
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    overflow: 'hidden',
  },
  pageWrap: {
    position: 'absolute',
    left: SPACE.screenH,
    right: SPACE.screenH,
    height: DIARY_PAGE_HEIGHT,
  },
  pagePress: {
    flex: 1,
  },
});

export default TimelineWheel;
