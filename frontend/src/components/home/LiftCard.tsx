/**
 * LiftCard — pressable card with depth micro-interaction.
 *
 * On press: scales up ~2%, lifts 3px, applies a subtle perspective tilt and
 * raises shadow elevation ("3D-like depth"). Ships with a perspective transform
 * baked into the animated style. Respects reduced-motion (no transform/shadow
 * animation — only press feedback via the native highlight color).
 *
 * Used for the dashboard two-up action row as a lift *surface*; the visual
 * card styling (colors, radius, padding) stays on the wrapping View so this
 * primitive stays generic.
 */

import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  interpolate,
} from 'react-native-reanimated';

import { durations, curves, Easing } from '@/theme/motion';
import { useReducedMotion } from '@/theme';

interface LiftCardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  pressedBg?: string;
}

export default function LiftCard({
  children,
  onPress,
  style,
  contentContainerStyle,
  accessibilityLabel,
  pressedBg = 'rgba(0,0,0,0.04)',
}: LiftCardProps) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const lift = useSharedValue(reduced ? 0 : 0);
  const tilt = useSharedValue(reduced ? 0 : 0);
  const shadow = useSharedValue(reduced ? 0.06 : 0.06);

  const pressIn = useCallback(() => {
    if (reduced) return;
    // Physical press: quick 0.97 squash on press-in (skill: 100–150ms),
    // springy release so the card settles instead of snapping.
    scale.value = withTiming(0.97, { duration: 120, easing: Easing.bezier(...curves.snappy) });
    lift.value = withTiming(1, { duration: 120, easing: Easing.bezier(...curves.snappy) });
    tilt.value = withTiming(1, { duration: 120, easing: Easing.bezier(...curves.snappy) });
    shadow.value = withTiming(0.22, { duration: 120, easing: Easing.bezier(...curves.snappy) });
  }, [reduced, scale, lift, tilt, shadow]);

  const pressOut = useCallback(() => {
    if (reduced) return;
    scale.value = withSpring(1, { duration: 400, dampingRatio: 0.8 });
    lift.value = withSpring(0, { duration: 400, dampingRatio: 0.8 });
    tilt.value = withSpring(0, { duration: 400, dampingRatio: 0.8 });
    shadow.value = withTiming(0.06, { duration: durations.emphasized, easing: Easing.bezier(...curves.standard) });
  }, [reduced, scale, lift, tilt, shadow]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 900 },
      { scale: scale.value },
      { translateY: interpolate(lift.value, [0, 1], [0, -1]) },
      { rotateX: `${interpolate(tilt.value, [0, 1], [0, 2])}deg` },
    ],
    shadowOpacity: shadow.value,
  }));

  return (
    <Animated.View style={[styles.shadow, style, animatedStyle]}>
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.content, pressed && { backgroundColor: pressedBg }]}
      >
        {contentContainerStyle ? (
          <View style={contentContainerStyle}>{children}</View>
        ) : (
          children
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 22,
    elevation: 4,
  },
  content: {
    flex: 1,
  },
});