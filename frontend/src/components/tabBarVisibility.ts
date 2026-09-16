import { useCallback } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/**
 * Scroll-aware tab-bar visibility (in-memory only).
 *
 * Side tabs (Home / Chat) hide while the user scrolls down and return on
 * scroll up; the center pulse button is never hidden. Screens opt in by
 * spreading useHideTabBarOnScroll()'s handler into their scroll view's
 * onScroll — no screen rewiring beyond one line each.
 *
 * Direction is derived from consecutive offsets: past a small top zone the
 * bar always shows; a downward push beyond threshold hides, an upward push
 * shows. Listeners fire only on state flips, so 60fps onScroll traffic
 * never causes React re-renders (the bar animates on the UI thread).
 */

type Listener = (hidden: boolean) => void;

const _listeners = new Set<Listener>();
let _hidden = false;
let _lastY = 0;

const TOP_ZONE = 40;
const DOWN_THRESHOLD = 8;
const UP_THRESHOLD = -8;

function setHidden(next: boolean): void {
  if (next === _hidden) return;
  _hidden = next;
  _listeners.forEach((listener) => {
    try {
      listener(next);
    } catch {
      // A broken subscriber must never break scrolling.
    }
  });
}

/** Current visibility (for initial state). */
export function isTabBarHidden(): boolean {
  return _hidden;
}

/** Subscribe to visibility flips. Returns an unsubscribe function. */
export function subscribeTabBarVisibility(listener: Listener): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/**
 * Feed a scroll offset (contentOffset.y). Call from onScroll handlers.
 * Resets apply on tab switches via resetTabBarScroll().
 */
export function reportTabScroll(y: number): void {
  const dy = y - _lastY;
  _lastY = y;
  if (y <= TOP_ZONE) {
    setHidden(false);
    return;
  }
  if (dy >= DOWN_THRESHOLD) setHidden(true);
  else if (dy <= UP_THRESHOLD) setHidden(false);
}

/** Reset on tab switch / screen change: bar shows, direction restarts. */
export function resetTabBarScroll(): void {
  _lastY = 0;
  setHidden(false);
}

/**
 * Hook for scrollable screens: spread the returned handler into onScroll
 * alongside any existing handler, e.g.
 *   onScroll={(e) => { existing?.(e); onTabScroll(e); }}
 */
export function useHideTabBarOnScroll(): (
  e: NativeSyntheticEvent<NativeScrollEvent>,
) => void {
  return useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    reportTabScroll(e.nativeEvent.contentOffset.y);
  }, []);
}
