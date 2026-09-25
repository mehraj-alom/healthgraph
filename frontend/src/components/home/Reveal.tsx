/**
 * Reveal — fade + translateY entrance animation for Home card sections.
 *
 * Respects OS reduced-motion (renders static). Stagger via `delay` prop.
 * Built on Reanimated (Increment 2.1 motion language).
 */

import React, { useEffect, type ReactNode } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { bezier, curves, durations } from '@/theme/motion';

interface RevealProps {
  children: ReactNode;
  /** Delay before animation starts (ms). Default 0. */
  delay?: number;
  /** Additional style applied to the animated wrapper. */
  style?: object;
}

export function Reveal({ children, delay = 0, style }: RevealProps) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(
      delay,
      withTiming(1, {
        duration: durations.slow,
        easing: bezier(curves.standard),
      }),
    );
    // We intentionally only run on mount; delay is static per section.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const animatedStyle = useAnimatedStyle(() => {
    const t = reduced ? 1 : progress.value;
    return {
      opacity: interpolate(t, [0, 1], [0, 1], Extrapolation.CLAMP),
      transform: [{ translateY: interpolate(t, [0, 1], [12, 0], Extrapolation.CLAMP) }],
    };
  });

  return (
    <Animated.View style={[animatedStyle, style]}>
      {children}
    </Animated.View>
  );
}