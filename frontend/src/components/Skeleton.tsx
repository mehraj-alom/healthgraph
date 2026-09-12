import { useEffect } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolateColor,
} from 'react-native-reanimated';
import { useTheme } from '@/theme';
import { durations } from '@/theme/motion';
import { useReducedMotion } from '@/theme/useReducedMotion';

/**
 * Skeleton primitive — pulsing placeholder surface used in loading states.
 * Theme-aware: dark surfaces get a softer pulse, light mode keeps contrast.
 */

export interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  /** Pill-shaped ends. */
  circle?: boolean;
  /** Slightly brighter surface for hero skeletons. */
  accent?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Screen-reader label for the pending state. */
  accessibilityLabel?: string;
}

export function Skeleton({
  width = '100%',
  height = 14,
  circle = false,
  accent = false,
  style,
  accessibilityLabel,
}: SkeletonProps) {
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(
      withTiming(1, {
        duration: durations.slow,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true,
    );
  }, [pulse, reduced]);

  const animatedStyle = useAnimatedStyle(() => {
    const base = accent
      ? isDark
        ? ['#172235', '#1F2E45']
        : ['#E4E8EC', '#EDF1F4']
      : isDark
        ? ['#141F30', '#1B293D']
        : ['#E8EBEF', '#F1F4F7'];
    return {
      backgroundColor: interpolateColor(pulse.value, [0, 1], base),
    };
  });

  const shape = circle ? styles.circle : styles.rect;

  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? 'Loading'}
      style={[
        { width, height },
        shape,
        animatedStyle,
        style,
      ]}
    />
  );
}

/** A vertical stack of skeleton rows (the classic "loading list"). */
export function SkeletonList({
  rows = 3,
  style,
}: {
  rows?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ gap: 16 }, style]}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={{ gap: 8 }}>
          <Skeleton width="40%" height={12} />
          <Skeleton width="100%" height={16} />
        </View>
      ))}
    </View>
  );
}

/** A skeleton shaped like a health metric card. */
export function SkeletonCard({
  style,
  accent,
}: {
  style?: StyleProp<ViewStyle>;
  accent?: boolean;
}) {
  const { radius, spacing } = useTheme();
  return (
    <View
      style={[
        {
          padding: spacing.lg,
          gap: spacing.md,
          borderRadius: radius.xxl,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.06)',
        },
        style,
      ]}
    >
      <Skeleton width="35%" height={12} />
      <Skeleton width="60%" height={36} accent={accent} />
      <Skeleton width="80%" height={14} />
    </View>
  );
}

const styles = StyleSheet.create({
  rect: {
    borderRadius: 12,
  },
  circle: {
    borderRadius: 9999,
  },
});