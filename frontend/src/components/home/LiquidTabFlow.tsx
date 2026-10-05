/**
 * LiquidTabFlow — the "flowing water" transition between the three main
 * tabs (Home · Pulse · Chat).
 *
 * When a tab gains focus, its screen drifts in from the direction of the
 * tab you tapped (left tab → drifts in from the left, right → from the
 * right), settles with a soft damped spring, and cross-fades over the
 * navigator's fade. The motion reads as liquid settling into place — no
 * bounce, no hard cut.
 *
 * Reduced motion: screens render static, no drift or fade.
 */

import React, { useCallback } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { useFocusEffect } from '@react-navigation/native';

import { useReducedMotion } from '@/theme';
import { springGentle, timingConfig } from '@/theme/motion';

/** Tab order matches the navigator — drift direction is derived from it. */
const TAB_ORDER = ['Dashboard', 'PpgMeasure', 'Chat'];

/** Last focused tab, module-level so every wrapper sees the same trail. */
let lastTabName: string | null = null;

export default function LiquidTabFlow({
  children,
  name,
}: {
  children: React.ReactNode;
  /** The tab route name this wrapper hosts (drives drift direction). */
  name: string;
}) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(reduced ? 1 : 0);
  const drift = useSharedValue(reduced ? 0 : 12);
  const scale = useSharedValue(reduced ? 1 : 0.988);

  useFocusEffect(
    useCallback(() => {
      if (reduced) {
        opacity.value = 1;
        drift.value = 0;
        scale.value = 1;
        lastTabName = name;
        return;
      }
      const prev = lastTabName;
      lastTabName = name;
      const pi = prev == null || prev === name ? -1 : TAB_ORDER.indexOf(prev);
      const ni = TAB_ORDER.indexOf(name);
      const dir = pi === -1 || pi === ni ? 0 : ni > pi ? 1 : -1;

      // Water enters from where the finger came from, then settles.
      opacity.value = 0;
      drift.value = dir === 0 ? 12 : -dir * 20;
      scale.value = 0.988;
      opacity.value = withTiming(1, timingConfig(320));
      drift.value = withSpring(0, springGentle);
      scale.value = withSpring(1, springGentle);
    }, [name, reduced, opacity, drift, scale]),
  );

  const flowStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: drift.value }, { scale: scale.value }],
  }));

  return <Animated.View style={[styles.fill, flowStyle]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
