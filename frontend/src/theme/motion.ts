/**
 * HealthGraph Motion Language
 *
 * Reusable animation presets built on react-native-reanimated (already a
 * project dependency — this file is the first consumer of it).
 *
 * Principles:
 *  - Fast, subtle, intentional. No decoration-for-decoration's sake.
 *  - Presets cover tap feedback, appearance, transitions.
 */

import { Easing, withSpring, withTiming, withDelay, type WithSpringConfig } from 'react-native-reanimated';

export type EasingTuple = [number, number, number, number];

/** Standard duration scale (ms). */
export const durations = {
  fast: 150,
  standard: 250,
  emphasized: 350,
  slow: 500,
} as const;

/** Cubic-bezier curves. */
export const curves = {
  /** Smooth, standard motion */
  standard: [0.25, 1, 0.5, 1] as EasingTuple,
  /** Fast interactive response (pills, taps) */
  snappy: [0.16, 1, 0.3, 1] as EasingTuple,
  /** Exit / dismiss */
  exit: [0.7, 0, 0.84, 0] as EasingTuple,
} as const;

/** Restrained springs — never bouncy-by-default. */
export const spring = { damping: 24, stiffness: 260, mass: 1 } satisfies WithSpringConfig;
export const springGentle = { damping: 20, stiffness: 140, mass: 1 } satisfies WithSpringConfig;
export const springSnappy = { damping: 18, stiffness: 320, mass: 1 } satisfies WithSpringConfig;

/** Press feedback scale. */
export const pressScale = 0.96;

export interface TimingPreset {
  duration: number;
  easing: EasingTuple;
}

export const timings: Record<'standard' | 'snappy' | 'exit', TimingPreset> = {
  standard: { duration: durations.standard, easing: curves.standard },
  snappy: { duration: durations.fast, easing: curves.snappy },
  exit: { duration: durations.emphasized, easing: curves.exit },
};

/**
 * Reanimated easing curve for `withTiming`. The spec curves are cubic-bezier
 * curves; Reanimated accepts them via Easing.bezier().
 */
export function bezier(easing: EasingTuple) {
  return Easing.bezier(...easing);
}

/** Timing config for withTiming() using the standard motion curve. */
export function timingConfig(duration = durations.standard, curve: EasingTuple = curves.snappy) {
  return { duration, easing: bezier(curve) };
}

export { withSpring, withTiming, withDelay, Easing };