import React from "react";
import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { TICK, shake } from "./timing";
import { displayFont, monoFont } from "./fonts";
import { neon, theme } from "./theme";

const BLOCK_W = 520;
const BLOCK_H = 400;
const BLOCK_TOP = 390;
const GAP = 60;

/** Blank form rows. Half-filled bureaucracy, which is the whole joke. */
const FIELDS = [
  ["Patient", "M. Mustermann"],
  ["Datum", "__ . __ . ____"],
  ["Unterschrift", "______________"],
] as const;

/**
 * Each stream owns its own grid geometry on purpose: different line pitch,
 * different phase, different colour and different drift. Nothing lines up,
 * which is the whole point — the data is not connected to anything.
 */
const STREAMS = [
  {
    enterAt: 0,
    x: 110,
    label: "Zettelwirtschaft",
    meta: "PDF · Scan 0042",
    readout: "BEFUND_?? — ???",
    color: theme.orange,
    pitch: 14,
    phase: 0,
    drift: 0.9,
    offset: 26,
  },
  {
    enterAt: 4,
    x: 110 + BLOCK_W + GAP,
    label: "Keine Struktur",
    meta: "Labor · TK 7712",
    readout: "3 Quellen · 0 Verknüpfungen",
    color: theme.red,
    pitch: 21,
    phase: 9,
    drift: -1.6,
    offset: -34,
  },
  {
    enterAt: 8,
    x: 110 + (BLOCK_W + GAP) * 2,
    label: "Fremdakten",
    meta: "Alt-Akte · 2011",
    readout: "Wiedervorlage 27b",
    color: theme.yellow,
    pitch: 27,
    phase: 5,
    drift: 2.3,
    offset: 41,
  },
] as const;

/** The strip above the blocks shouts in short bursts on the tick grid. */
const SHOUTS: { at: number; text: string; color: string }[] = [
  { at: 2 * TICK, text: "Zettelwirtschaft.", color: theme.orange },
  { at: 6 * TICK, text: "Keine Struktur.", color: theme.red },
  { at: 10 * TICK, text: "Nichts ist verbunden.", color: theme.textDim },
  { at: 14 * TICK, text: "Nichts ist verbunden.", color: theme.red },
];

const GRID_LINES = 22;

const DataBlock: React.FC<(typeof STREAMS)[number]> = ({
  enterAt,
  x,
  label,
  meta,
  readout,
  color,
  pitch,
  phase,
  drift,
  offset,
}) => {
  const frame = useCurrentFrame();
  const local = frame - enterAt;

  // The wrap offset loops on the line pitch, so the drift never jumps.
  const loop = (frame * drift + phase) % pitch;
  const jitterY = shake(frame, offset) * 2.4;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: BLOCK_TOP + offset + jitterY,
        width: BLOCK_W,
        height: BLOCK_H,
        backgroundColor: theme.bgCard,
        border: `1px solid ${theme.line}`,
        borderRadius: 6,
        overflow: "hidden",
        opacity: interpolate(local, [0, 3], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        // Slams in from the side, then jitters on every tick forever after.
        translate: `${
          interpolate(local, [0, 6], [offset > 0 ? 260 : -260, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.2, 1.4, 0.3, 1),
          }) +
          shake(frame, offset + 1) * 2.6
        }px 0px`,
      }}
    >
      <div
        style={{
          position: "relative",
          zIndex: 2,
          padding: "22px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            fontFamily: displayFont,
            fontWeight: 900,
            fontSize: 44,
            lineHeight: 1.04,
            letterSpacing: "-0.02em",
            color: theme.text,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontFamily: monoFont,
            fontWeight: 500,
            fontSize: 20,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color,
          }}
        >
          {meta}
        </div>
      </div>

      <div
        style={{
          fontFamily: monoFont,
          fontWeight: 700,
          fontSize: 24,
          color: theme.textFaint,
          textAlign: "center",
          marginTop: 8,
        }}
      >
        {readout}
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 2,
          margin: "24px 24px 0",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {FIELDS.map(([label, value]) => (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              borderBottom: `1px dashed ${theme.line}`,
              paddingBottom: 7,
            }}
          >
            <span
              style={{
                fontFamily: monoFont,
                fontWeight: 500,
                fontSize: 15,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: theme.textFaint,
              }}
            >
              {label}
            </span>
            <span
              style={{
                fontFamily: monoFont,
                fontWeight: 500,
                fontSize: 15,
                color,
              }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Raw SVG grid. Straight horizontal paths, deliberately mis-pitched. */}
      <Interactive.Svg
        name={`${label} grid`}
        width={BLOCK_W}
        height={BLOCK_H}
        viewBox={`0 0 ${BLOCK_W} ${BLOCK_H}`}
        style={{ position: "absolute", inset: 0, zIndex: 1 }}
      >
        <g transform={`translate(0 ${loop})`}>
          {Array.from({ length: GRID_LINES }).map((_, i) => {
            const y = phase + i * pitch - pitch * 4;
            return (
              <Interactive.Path
                key={i}
                name={`Grid line ${i + 1}`}
                d={`M 0 ${y} L ${BLOCK_W} ${y}`}
                stroke={color}
                strokeWidth={i % 4 === 0 ? 1.6 : 0.7}
                strokeDasharray={i % 5 === 0 ? "14 9" : undefined}
                opacity={i % 4 === 0 ? 0.42 : 0.15}
              />
            );
          })}
        </g>
      </Interactive.Svg>

      {/* A connector that stops in mid-air. Disconnected, on purpose. */}
      <div
        style={{
          position: "absolute",
          zIndex: 3,
          left: "50%",
          bottom: -34,
          width: 3,
          height: 34,
          backgroundColor: color,
          boxShadow: neon(color, 8),
        }}
      />
      <div
        style={{
          position: "absolute",
          zIndex: 3,
          left: `calc(50% + 1px)`,
          bottom: -34,
          width: 13,
          height: 3,
          backgroundColor: color,
        }}
      />
    </div>
  );
};

export const DataStreams: React.FC = () => {
  const frame = useCurrentFrame();

  const shout = [...SHOUTS].reverse().find((s) => frame >= s.at) ?? SHOUTS[0];
  const shoutLocal = frame - shout.at;
  const flash = interpolate(shoutLocal, [0, 2, 6], [1, 0.55, 0.28], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      name="Scene background"
      style={{ backgroundColor: theme.bg, overflow: "hidden" }}
    >
      <AbsoluteFill
        name="Header"
        style={{
          position: "absolute",
          left: 110,
          right: 110,
          top: 150,
        }}
      >
        <div
          style={{
            fontFamily: displayFont,
            fontWeight: 900,
            fontSize: 96,
            lineHeight: 1,
            letterSpacing: "-0.03em",
            textAlign: "center",
            color: shout.color,
            opacity: interpolate(shoutLocal, [0, 3], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            scale: interpolate(shoutLocal, [0, 4, 12], [1.08, 1, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              output: "perceptual-scale",
            }),
            textShadow: neon(shout.color, 26 * flash + 6),
          }}
        >
          {shout.text}
        </div>
      </AbsoluteFill>

      {STREAMS.map((stream) => (
        <DataBlock key={stream.label} {...stream} />
      ))}

      {/* Caption strip: the complaint, stated plainly. */}
      <div
        style={{
          position: "absolute",
          left: 110,
          right: 110,
          bottom: 96,
          display: "flex",
          alignItems: "center",
          gap: 18,
          opacity: interpolate(frame, [TICK * 2, TICK * 3], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div style={{ width: 120, height: 3, backgroundColor: theme.red }} />
        <div
          style={{
            fontFamily: displayFont,
            fontWeight: 700,
            fontSize: 46,
            letterSpacing: "-0.01em",
            color: theme.textDim,
          }}
        >
          Drei Akten. Drei Systeme. Null Überblick.
        </div>
      </div>
    </AbsoluteFill>
  );
};
