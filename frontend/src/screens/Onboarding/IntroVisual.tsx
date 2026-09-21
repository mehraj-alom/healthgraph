import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { GV } from '@/theme/guava';
import { bezier, curves, durations } from '@/theme/motion';
import { useReducedMotion } from '@/theme/useReducedMotion';

/**
 * IntroVisual — the "alive and connected" HealthGraph mark for onboarding
 * screen 1.
 *
 * Pure code, no image assets: a soft green glow, thin concentric rings,
 * hairline links and satellite nodes that fade/scale in with a stagger,
 * then settle. The glow breathes on a slow loop. Fully static when the OS
 * requests reduced motion.
 *
 * Guava note: onboarding is the one immersive surface allowed a soft
 * green aura around the graph focal point; everything else stays flat.
 */

interface NodeSpec {
  angleDeg: number;
  radiusFrac: number;
  size: number;
}

const NODES: NodeSpec[] = [
  { angleDeg: -90, radiusFrac: 0.46, size: 14 },
  { angleDeg: -30, radiusFrac: 0.4, size: 10 },
  { angleDeg: 18, radiusFrac: 0.47, size: 12 },
  { angleDeg: 78, radiusFrac: 0.38, size: 9 },
  { angleDeg: 140, radiusFrac: 0.45, size: 11 },
  { angleDeg: 205, radiusFrac: 0.36, size: 8 },
];

function polar(
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number,
): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

function Satellite({
  spec,
  cx,
  cy,
  orbitR,
  index,
  active,
  reduced,
}: {
  spec: NodeSpec;
  cx: number;
  cy: number;
  orbitR: number;
  index: number;
  active: boolean;
  reduced: boolean;
}) {
  const t = useSharedValue(reduced || !active ? 1 : 0);
  const { x, y } = polar(cx, cy, orbitR * spec.radiusFrac, spec.angleDeg);

  useEffect(() => {
    if (reduced || !active) {
      t.value = 1;
      return;
    }
    t.value = 0;
    t.value = withDelay(
      250 + index * 160,
      withTiming(1, {
        duration: durations.emphasized,
        easing: bezier(curves.standard),
      }),
    );
  }, [active, reduced, index, t]);

  const style = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ scale: 0.6 + t.value * 0.4 }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: x - spec.size,
          top: y - spec.size,
          width: spec.size * 2,
          height: spec.size * 2,
          borderRadius: spec.size,
          backgroundColor: 'rgba(79, 209, 197, 0.22)',
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <View
        style={{
          width: spec.size,
          height: spec.size,
          borderRadius: spec.size / 2,
          backgroundColor: '#7CF5D3',
          borderWidth: 1.5,
          borderColor: 'rgba(255,255,255,0.85)',
        }}
      />
    </Animated.View>
  );
}

export function IntroVisual({
  size,
  active,
}: {
  size: number;
  active: boolean;
}) {
  const reduced = useReducedMotion();
  const appear = useSharedValue(reduced || !active ? 1 : 0);
  const breathe = useSharedValue(1);

  useEffect(() => {
    if (reduced || !active) {
      appear.value = 1;
      breathe.value = 1;
      return;
    }
    appear.value = 0;
    appear.value = withTiming(1, {
      duration: durations.slow,
      easing: bezier(curves.standard),
    });
    breathe.value = withRepeat(
      withTiming(1.06, { duration: 2800 }),
      -1,
      true,
    );
  }, [active, reduced, appear, breathe]);

  const fade = useAnimatedStyle(() => ({ opacity: appear.value }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.85 + (breathe.value - 1) * 2.2,
    transform: [{ scale: breathe.value }],
  }));
  const hubStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ scale: 0.85 + appear.value * 0.15 }],
  }));

  const vb = 320;
  const c = vb / 2;
  /** Max orbit radius in viewBox units; node fractions scale off it. */
  const MAX_ORBIT = vb * 0.42;
  const MAX_FRAC = 0.46;
  const orbitVb = (frac: number): number => (MAX_ORBIT * frac) / MAX_FRAC;

  return (
    <View
      style={[styles.wrap, { width: size, height: size }]}
      accessibilityRole="image"
      accessibilityLabel="HealthGraph connected health visualization"
    >
      {/* Soft green aura — the focal glow, gently breathing. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            width: size * 0.94,
            height: size * 0.94,
            borderRadius: (size * 0.94) / 2,
            backgroundColor: 'rgba(79, 209, 197, 0.13)',
            alignSelf: 'center',
            top: size * 0.03,
          },
          glowStyle,
        ]}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: size * 0.62,
          height: size * 0.62,
          borderRadius: (size * 0.62) / 2,
          backgroundColor: 'rgba(124, 245, 211, 0.10)',
          alignSelf: 'center',
          top: size * 0.19,
        }}
      />

      {/* Rings + hairline links (square viewBox = uniform scale, so links
          land exactly on the overlaid nodes). */}
      <Animated.View style={[StyleSheet.absoluteFill, fade]}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${vb} ${vb}`}>
          {[0.2, 0.31, 0.42].map(f => (
            <Circle
              key={f}
              cx={c}
              cy={c}
              r={vb * f}
              fill="none"
              stroke="rgba(167, 184, 178, 0.35)"
              strokeWidth={1}
            />
          ))}
          {NODES.map((n, i) => {
            const p = polar(c, c, orbitVb(n.radiusFrac), n.angleDeg);
            return (
              <Line
                key={i}
                x1={c}
                y1={c}
                x2={p.x}
                y2={p.y}
                stroke="rgba(79, 209, 197, 0.5)"
                strokeWidth={1}
              />
            );
          })}
          {/* Orbit arc hint — one quiet dashed ring segment. */}
          <Circle
            cx={c}
            cy={c}
            r={vb * 0.31}
            fill="none"
            stroke="rgba(79, 209, 197, 0.35)"
            strokeWidth={1}
            strokeDasharray="3 7"
          />
        </Svg>
      </Animated.View>

      {/* Satellite nodes (pixel space mirrors the viewBox 1:1). */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {NODES.map((n, i) => (
          <Satellite
            key={i}
            spec={n}
            cx={size / 2}
            cy={size / 2}
            orbitR={(size * 0.42) / MAX_FRAC}
            index={i}
            active={active}
            reduced={reduced}
          />
        ))}
      </View>

      {/* Central hub — calm white core on the dark stage. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            alignSelf: 'center',
            top: size / 2 - 38,
            width: 76,
            height: 76,
            borderRadius: 38,
            backgroundColor: '#FFFFFF',
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: 'rgba(124, 245, 211, 0.65)',
          },
          hubStyle,
        ]}
      >
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: GV.cta,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: '#7CF5D3',
            }}
          />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'center',
  },
});
