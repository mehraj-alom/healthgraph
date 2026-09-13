/**
 * Entrance — fade + slide-up stagger primitive for the correlations feed.
 *
 * Mirrors the existing Reveal component but uses the fast/standard motion
 * tokens (durations.standard) so a ~40ms-per-card stagger over a long feed
 * converges quickly. Delays are capped so items that mount off-screen (FlatList
 * virtualization) still animate in snappily when scrolled into view.
 *
 * Fully respects the OS reduced-motion setting (enters instantly).
 */

import React, { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
} from 'react-native-reanimated';

import { durations, curves, Easing } from '@/theme/motion';
import { useReducedMotion } from '@/theme';

interface EntranceProps {
  children: React.ReactNode;
  /** Position in the staggering sequence (0-based). */
  index?: number;
  /** Stagger between siblings in ms (default 40). */
  staggerMs?: number;
  /** Hard cap on the delay so late-mounted rows feel responsive. */
  maxDelayMs?: number;
  style?: StyleProp<ViewStyle>;
}

export default function Entrance({
  children,
  index = 0,
  staggerMs = 40,
  maxDelayMs = 400,
  style,
}: EntranceProps) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(reduced ? 1 : 0);
  const translateY = useSharedValue(reduced ? 0 : 16);

  useEffect(() => {
    if (reduced) return;
    const delay = Math.min(index * staggerMs, maxDelayMs);
    opacity.value = withDelay(
      delay,
      withTiming(1, { duration: durations.standard, easing: Easing.bezier(...curves.snappy) }),
    );
    translateY.value = withDelay(
      delay,
      withTiming(0, { duration: durations.standard, easing: Easing.bezier(...curves.snappy) }),
    );
  }, [index, staggerMs, maxDelayMs, reduced, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}