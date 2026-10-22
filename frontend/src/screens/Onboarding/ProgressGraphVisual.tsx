/**
 * ProgressGraphVisual — illustrative 7-day momentum artwork for onboarding
 * screen 2 ("See the bigger picture").
 *
 * Pure illustration, NOT patient data: fixed abstract points, day labels
 * only (Day 1…7), no units, no metric. The line draws left to right in
 * seven staggered steps (same timer pattern as SystemVisual), with a soft
 * green → teal gradient stroke and area wash from the official svg API.
 * Reduced motion shows the complete graph statically; the end-dot glow
 * breathes gently otherwise. A caption states it is an illustration.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { FONT, GV, TYPE } from '@/theme/guava';
import { bezier, curves, durations } from '@/theme/motion';
import { useReducedMotion } from '@/theme/useReducedMotion';
import {
  PROGRESS_VALUES,
  layoutProgressPoints,
  progressAreaPath,
  progressPath,
  revealedPoints,
} from './progressGraph';

const STEP_MS = 260;
const VIEW_W = 320;
const VIEW_H = 190;
const PAD_TOP = 18;
const PAD_BOTTOM = 30;

export function ProgressGraphVisual({
  size,
  active,
}: {
  size: number;
  active: boolean;
}) {
  const reduced = useReducedMotion();
  const total = PROGRESS_VALUES.length;
  const [count, setCount] = useState(reduced || !active ? total : 0);
  const glow = useSharedValue(1);

  // Staggered left-to-right draw; static full graph under reduced motion.
  useEffect(() => {
    if (reduced || !active) {
      setCount(total);
      return;
    }
    setCount(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= total; i++) {
      timers.push(setTimeout(() => setCount(i), 250 + i * STEP_MS));
    }
    return () => timers.forEach(clearTimeout);
  }, [active, reduced, total]);

  // Gentle end-dot glow once the draw completes.
  const settled = count >= total;
  useEffect(() => {
    if (reduced || !active || !settled) {
      glow.value = 1;
      return;
    }
    glow.value = withRepeat(
      withTiming(1.25, { duration: 2200, easing: bezier(curves.standard) }),
      -1,
      true,
    );
    return () => {
      glow.value = 1;
    };
  }, [active, reduced, settled, glow]);

  const fade = useAnimatedStyle(() => ({
    opacity: count > 0 ? 1 : 0,
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + (glow.value - 1) * 1.6,
    transform: [{ scale: glow.value }],
  }));
  const lineStyle = useAnimatedStyle(() => ({
    opacity: withTiming(count > 0 ? 1 : 0, { duration: durations.standard }),
  }));

  const scale = size / VIEW_W;
  const innerH = VIEW_H - PAD_TOP - PAD_BOTTOM;
  const points = layoutProgressPoints(PROGRESS_VALUES, VIEW_W, innerH).map((p) => ({
    ...p,
    y: p.y + PAD_TOP,
  }));
  const visible = revealedPoints(points, count);
  const line = progressPath(visible);
  const area = progressAreaPath(visible, VIEW_H - PAD_BOTTOM);
  const tip = visible[visible.length - 1] ?? null;

  return (
    <View
      style={[styles.wrap, { width: size, height: size * (VIEW_H / VIEW_W) }]}
      accessibilityRole="image"
      accessibilityLabel="Illustration of health progress over seven days"
    >
      <Animated.View style={[StyleSheet.absoluteFill, fade]}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
          <Defs>
            <LinearGradient id="hg-progress-line" x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor="#0B7A55" stopOpacity={1} />
              <Stop offset="0.55" stopColor="#4FD1C5" stopOpacity={1} />
              <Stop offset="1" stopColor="#7CF5D3" stopOpacity={1} />
            </LinearGradient>
            <LinearGradient id="hg-progress-wash" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#4FD1C5" stopOpacity={0.28} />
              <Stop offset="1" stopColor="#4FD1C5" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {area ? <Path d={area} fill="url(#hg-progress-wash)" /> : null}
          {line ? (
            <Path
              d={line}
              fill="none"
              stroke="url(#hg-progress-line)"
              strokeWidth={3 * scale}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          {visible.map((p, i) => (
            <Circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={i === visible.length - 1 ? 5 : 3}
              fill={i === visible.length - 1 ? '#7CF5D3' : '#0B4A3F'}
              stroke={i === visible.length - 1 ? '#FFFFFF' : '#4FD1C5'}
              strokeWidth={1.5}
            />
          ))}
        </Svg>
      </Animated.View>

      {/* Day labels (layout row under the svg, not svg text). */}
      <View style={styles.days} pointerEvents="none">
        {points.map((p, i) => (
          <Text
            key={p.label}
            style={[styles.day, i < count ? styles.dayOn : styles.dayOff]}
          >
            {p.label.replace('Day ', 'D')}
          </Text>
        ))}
      </View>

      {/* End-dot glow once settled (viewBox → pixel: k = size / VIEW_W). */}
      {tip && settled ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.tipGlow,
            {
              left: (tip.x / VIEW_W) * size - 14,
              top: (tip.y / VIEW_W) * size - 14,
            },
            glowStyle,
          ]}
        />
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'center',
  },
  days: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  day: {
    fontFamily: FONT.semi,
    fontSize: 11,
    lineHeight: 14,
    fontVariant: ['tabular-nums'],
  },
  dayOn: {
    color: '#FFFFFF',
  },
  dayOff: {
    color: 'rgba(255, 255, 255, 0.3)',
  },
  tipGlow: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(124, 245, 211, 0.25)',
  },
});
