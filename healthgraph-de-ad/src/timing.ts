export const FPS = 30;
export const DURATION_IN_FRAMES = 900;

/**
 * The tick grid. Every kinetic pop-in in the chaos act lands on one of these
 * frames, and the audio generator reads the same numbers, so the score and the
 * typography can never drift apart.
 */
export const TICK = 15;

/** Frame at which the sub-bass drop lands and the chaos act ends. */
export const DROP_FRAME = 750;

export const SCENES = {
  hook: { from: 0, durationInFrames: 180 },
  streams: { from: 180, durationInFrames: 270 },
  countdown: { from: 450, durationInFrames: 300 },
  dashboard: { from: 750, durationInFrames: 150 },
} as const;

/** All tick frames from 0 up to (not including) the drop. */
export const TICK_FRAMES: number[] = Array.from(
  { length: DROP_FRAME / TICK },
  (_, i) => i * TICK,
);

/**
 * Deterministic per-frame pseudo-random in [-1, 1].
 * Used for shake jitter so every render of frame N is byte-identical.
 * `Math.random()` must never appear in a Remotion component.
 */
export const hash = (seed: number): number => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

/** Two decorrelated channels of shake from one frame number. */
export const shake = (frame: number, channel = 0): number =>
  hash(frame * 2.3 + channel * 101.7);
