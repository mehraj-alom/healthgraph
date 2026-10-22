import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { TICK, shake } from "./timing";
import { displayFont } from "./fonts";
import { neon, theme } from "./theme";

/**
 * The hook reads as six beats on the tick grid. Each chunk owns the word it
 * lands on, so the type and the clock click are the same event.
 */
const CHUNKS: { at: number; text: string; color: string }[] = [
  { at: 0, text: "„Warum", color: theme.text },
  { at: 2 * TICK, text: "fühlt sich", color: theme.text },
  { at: 4 * TICK, text: "Gesundheit", color: theme.cyan },
  { at: 6 * TICK, text: "in Deutschland", color: theme.text },
  { at: 8 * TICK, text: "eigentlich an wie", color: theme.textDim },
  { at: 10 * TICK, text: "ein Teilzeitjob beim Amt?“", color: theme.red },
];

/** Impulse envelope: every tick kicks the container, each kick decays in ~7f. */
const shakeEnv = (frame: number) => {
  let env = 0;
  for (let f = 0; f <= frame; f += TICK) {
    const age = frame - f;
    env += (1 - age / 7) ** 2;
  }
  return Math.min(env, 1.15);
};

/** Band-limited wobble so the shake reads as a spring, not a jitter. */
const springNudge = (frame: number, channel: number) =>
  Math.sin(frame * 2.7 + channel) * 0.5 +
  Math.sin(frame * 6.1 + channel * 2.3) * 0.3 +
  Math.sin(frame * 13.3 + channel * 4.1) * 0.2;

const GRID_ROWS = 9;

export const KineticHook: React.FC = () => {
  const frame = useCurrentFrame();
  const env = shakeEnv(frame);

  const joltX = springNudge(frame, 0) * env * 13 + shake(frame, 0) * 1.9;
  const joltY = springNudge(frame, 1.7) * env * 10 + shake(frame, 1) * 1.9;
  const tilt = springNudge(frame, 3.4) * env * 1.5 + shake(frame, 2) * 0.35;

  return (
    <AbsoluteFill
      name="Scene background"
      style={{ backgroundColor: theme.bg, overflow: "hidden" }}
    >
      {/* Drifting grid — establishes the layout space before the type lands. */}
      <AbsoluteFill
        name="Drifting grid"
        style={{
          opacity: interpolate(frame, [0, 12], [0, 0.5], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: `0px ${interpolate(frame, [0, 180], [0, -36], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}px`,
        }}
      >
        {Array.from({ length: GRID_ROWS }).map((_, i) => {
          const y = 120 + i * 120;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: y,
                height: 1,
                backgroundColor: i % 3 === 0 ? theme.line : "#1b1b1f",
              }}
            />
          );
        })}
      </AbsoluteFill>

      {/* The agitated container. Not interactive: the noise is per-frame hash. */}
      <AbsoluteFill
        name="Shake container"
        style={{
          display: "flex",
          // Anchored to the top, not centred: the block grows downward as each
          // chunk lands, and centring would make the whole block jump.
          flexDirection: "column",
          justifyContent: "flex-start",
          padding: "190px 110px 130px",
          translate: `${joltX}px ${joltY}px`,
          rotate: `${tilt}deg`,
        }}
      >
        <div
          style={{
            fontFamily: displayFont,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "0.24em",
            textTransform: "uppercase",
            color: theme.textFaint,
            marginBottom: 34,
          }}
        >
          Gesundheit in Deutschland
        </div>

        <div
          style={{
            fontFamily: displayFont,
            fontWeight: 900,
            fontSize: 104,
            lineHeight: 0.99,
            letterSpacing: "-0.025em",
          }}
        >
          {CHUNKS.map((chunk) => {
            const local = frame - chunk.at;
            // interpolate() cannot blend box-shadow strings, so blend the
            // blur radius and build the shadow from it.
            const glow = interpolate(local, [0, 3, 12], [34, 46, 12], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <div
                key={chunk.at}
                style={{
                  color: chunk.color,
                  opacity: interpolate(local, [0, 4], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: Easing.bezier(0.16, 1, 0.3, 1),
                  }),
                  translate: `0px ${interpolate(local, [0, 10], [34, 0], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: Easing.spring({ damping: 14, mass: 0.6 }),
                  })}px`,
                  // Entry overshoot: the word lands hot, then settles.
                  textShadow: `0 0 ${glow}px ${chunk.color}`,
                }}
              >
                {chunk.text}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>

      {/* Tick ruler: proof the whole sequence is clocked. */}
      <div
        style={{
          position: "absolute",
          left: 110,
          right: 110,
          bottom: 104,
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
        }}
      >
        {Array.from({ length: 12 }).map((_, i) => {
          const at = i * TICK;
          const local = frame - at;
          const hit = local >= 0 ? 1 : 0;
          const accent = i % 4 === 0;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: interpolate(
                  local,
                  [0, 3, 10, 60],
                  [4, accent ? 26 : 18, accent ? 10 : 7, 4],
                  {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: Easing.bezier(0.16, 1, 0.3, 1),
                  },
                ),
                backgroundColor: hit
                  ? accent
                    ? theme.red
                    : theme.textDim
                  : theme.line,
                boxShadow:
                  local >= 0 && local < 6
                    ? neon(accent ? theme.red : theme.text, 10)
                    : "none",
              }}
            />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
