import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Stop } from 'react-native-svg';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { FONT, GV } from '@/theme/guava';
import { bezier, curves, durations } from '@/theme/motion';
import { useReducedMotion } from '@/theme/useReducedMotion';

/**
 * SystemVisual — "everything connects here" for onboarding screen 2.
 *
 * A calm central HealthGraph hub with six health dimensions (Sleep, Heart,
 * Nutrition, Activity, Wellbeing, Records) that connect progressively:
 * hub first, then one satellite at a time, then the whole system settles
 * into a gentle resting state. Pure code (Views + thin SVG links), no
 * image assets, no new dependencies.
 */

export interface Dimension {
  label: string;
  /** Fraction position inside the container (0..1). */
  fx: number;
  fy: number;
  dot: string;
}

const DIMENSIONS: Dimension[] = [
  { label: 'Sleep', fx: 0.16, fy: 0.1, dot: '#B9A8E8' },
  { label: 'Heart', fx: 0.84, fy: 0.1, dot: '#F08CAE' },
  { label: 'Nutrition', fx: 0.06, fy: 0.5, dot: '#7CF5D3' },
  { label: 'Activity', fx: 0.94, fy: 0.5, dot: '#8FC1E8' },
  { label: 'Wellbeing', fx: 0.16, fy: 0.9, dot: '#F5C99B' },
  { label: 'Medications', fx: 0.5, fy: 0.9, dot: '#34D399' },
  { label: 'Records', fx: 0.84, fy: 0.9, dot: '#A7B8B2' },
];

const STEP_MS = 240;

function useProgressiveCount(active: boolean, reduced: boolean, total: number): number {
  const [count, setCount] = useState(reduced || !active ? total : 0);

  useEffect(() => {
    if (reduced || !active) {
      setCount(total);
      return;
    }
    setCount(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    // Index 0 = hub; satellites follow one by one.
    for (let i = 0; i <= total; i++) {
      timers.push(
        setTimeout(() => setCount(i), 200 + i * STEP_MS),
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [active, reduced, total]);

  return count;
}

function FadeIn({
  visible,
  reduced,
  children,
  style,
}: {
  visible: boolean;
  reduced: boolean;
  children: React.ReactNode;
  style?: object;
}) {
  const t = useSharedValue(reduced || visible ? 1 : 0);

  useEffect(() => {
    if (reduced || visible) {
      t.value = visible
        ? withTiming(1, {
            duration: durations.emphasized,
            easing: bezier(curves.standard),
          })
        : 0;
    } else {
      t.value = 0;
    }
  }, [visible, reduced, t]);

  const animated = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ scale: 0.92 + t.value * 0.08 }],
  }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

export function SystemVisual({
  size,
  active,
}: {
  size: number;
  active: boolean;
}) {
  const reduced = useReducedMotion();
  const count = useProgressiveCount(active, reduced, DIMENSIONS.length);
  const breathe = useSharedValue(1);

  const settled = count >= DIMENSIONS.length;

  useEffect(() => {
    if (reduced || !active || !settled) return;
    breathe.value = withRepeat(
      withTiming(1.04, { duration: 3000 }),
      -1,
      true,
    );
    return () => {
      breathe.value = 1;
    };
  }, [active, reduced, settled, breathe]);

  const hubGlow = useAnimatedStyle(() => ({
    opacity: settled ? 0.9 : 0.55,
    transform: [{ scale: settled ? breathe.value : 1 }],
  }));
  const hubScale = useAnimatedStyle(() => ({
    opacity: count >= 0 ? 1 : 0,
    transform: [{ scale: count >= 0 ? 1 : 0.9 }],
  }));

  const height = size * 0.92;
  const cx = size / 2;
  const cy = height / 2;
  const PILL_W = 124;
  const pillCenter = (d: Dimension): { x: number; y: number } => {
    const left = Math.min(
      Math.max(d.fx * size - PILL_W / 2, 4),
      size - PILL_W - 4,
    );
    return { x: left + PILL_W / 2, y: d.fy * height };
  };

  return (
    <View
      style={[styles.wrap, { width: size, height }]}
      accessibilityRole="image"
      accessibilityLabel="Health dimensions connecting into one HealthGraph"
    >
      {/* Resting aura behind the hub. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            width: size * 0.66,
            height: size * 0.66,
            borderRadius: (size * 0.66) / 2,
            backgroundColor: 'rgba(79, 209, 197, 0.12)',
            left: cx - (size * 0.66) / 2,
            top: cy - (size * 0.66) / 2,
          },
          hubGlow,
        ]}
      />

      {/* Connection links — appear with their satellite. */}
      <Svg
        width={size}
        height={height}
        viewBox={`0 0 ${size} ${height}`}
        style={StyleSheet.absoluteFill}
      >
        {/* Green → teal gradient ring around the hub (official
            react-native-svg LinearGradient-in-Defs pattern, Guava hues). */}
        <Defs>
          <LinearGradient id="hg-hub-grad" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor="#0B7A55" stopOpacity={1} />
            <Stop offset="0.55" stopColor="#4FD1C5" stopOpacity={1} />
            <Stop offset="1" stopColor="#7CF5D3" stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Circle
          cx={cx}
          cy={cy}
          r={62}
          fill="none"
          stroke="url(#hg-hub-grad)"
          strokeWidth={2.5}
        />
        {DIMENSIONS.map((d, i) => {
          if (count <= i) return null;
          const p = pillCenter(d);
          return (
            <Line
              key={d.label}
              x1={cx}
              y1={cy}
              x2={p.x}
              y2={p.y}
              stroke="rgba(79, 209, 197, 0.5)"
              strokeWidth={1}
            />
          );
        })}
      </Svg>

      {/* Satellite pills (horizontally clamped so labels never clip). */}
      {DIMENSIONS.map((d, i) => {
        const left = Math.min(
          Math.max(d.fx * size - PILL_W / 2, 4),
          size - PILL_W - 4,
        );
        return (
        <View
          key={d.label}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left,
            top: d.fy * height - 19,
            width: PILL_W,
            alignItems: 'center',
          }}
        >
          <FadeIn visible={count > i} reduced={reduced}>
            <View style={styles.pill}>
              <View
                style={[styles.pillDot, { backgroundColor: d.dot }]}
              />
              <Text style={styles.pillText}>{d.label}</Text>
              {/* Connection node where the link lands. */}
              <View style={styles.landDot} />
            </View>
          </FadeIn>
        </View>
        );
      })}

      {/* Central hub — always first, always calm. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: cx - 52,
            top: cy - 52,
            width: 104,
            height: 104,
            borderRadius: 52,
            backgroundColor: '#FFFFFF',
            borderWidth: 1,
            borderColor: 'rgba(124, 245, 211, 0.7)',
            alignItems: 'center',
            justifyContent: 'center',
          },
          hubScale,
        ]}
      >
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: GV.cta,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 5,
          }}
        >
          <View
            style={{
              width: 9,
              height: 9,
              borderRadius: 4.5,
              backgroundColor: '#7CF5D3',
            }}
          />
        </View>
        <Text style={styles.hubText}>HealthGraph</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 9999,
    paddingVertical: 9,
    paddingHorizontal: 13,
    gap: 8,
  },
  pillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pillText: {
    fontFamily: FONT.semi,
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
  },
  landDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#7CF5D3',
    opacity: 0.9,
  },
  hubText: {
    fontFamily: FONT.semi,
    fontSize: 12,
    lineHeight: 15,
    color: GV.ink,
    letterSpacing: 0.2,
  },
});
