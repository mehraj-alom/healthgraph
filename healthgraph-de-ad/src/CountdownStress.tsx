import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { TICK, hash } from "./timing";
import { displayFont, monoFont } from "./fonts";
import { lerpColor, neon, theme } from "./theme";

/** One card every two ticks: ten rejections piling up over the ten seconds. */
const CARD_EVERY = 2 * TICK;
const CARDS = [
  "Antrag abgelehnt",
  "Formular 27b fehlt",
  "Termin verpasst",
  "Vollmacht erforderlich",
  "Bearbeitungszeit: 6 Wochen",
  "Erneut vorlegen",
  "Zuständigkeit ungeklärt",
  "Unterlagen unvollständig",
  "Bitte schriftlich warten",
  "Noch nicht freigegeben",
];

const CLOCK_START_MIN = 19;

/** Mechanical clock hands that never sit still while the wait runs down. */
const handNudge = (frame: number) =>
  Math.sin(frame * 5.1) * 0.6 + Math.sin(frame * 11.3) * 0.4;

const CountdownClock: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const minutes = Math.max(0, CLOCK_START_MIN - Math.floor(frame / TICK));
  const isZero = minutes === 0;
  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Orange while there is time left, red as it runs out.
  const color = isZero
    ? theme.red
    : progress < 0.55
      ? lerpColor(theme.yellow, theme.orange, progress / 0.55)
      : lerpColor(theme.orange, theme.red, (progress - 0.55) / 0.45);

  const pulse = isZero
    ? 0.55 + 0.45 * Math.abs(Math.sin(frame * 0.9))
    : 0.7 + 0.3 * Math.abs(Math.sin(frame * 0.22));

  return (
    <div
      style={{
        position: "absolute",
        right: 110,
        top: 100,
        width: 336,
        padding: "20px 24px 22px",
        backgroundColor: theme.bgCard,
        border: `1px solid ${color}`,
        borderRadius: 8,
        boxShadow: neon(color, 18 * pulse),
        opacity: interpolate(frame, [0, 5], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        // The whole panel trembles harder as the wait gets worse.
        translate: `${handNudge(frame) * (1 + progress * 2.4)}px ${
          handNudge(frame + 13) * (1 + progress * 2.4)
        }px`,
      }}
    >
      <div
        style={{
          fontFamily: monoFont,
          fontWeight: 500,
          fontSize: 18,
          letterSpacing: "0.26em",
          textTransform: "uppercase",
          color: theme.textDim,
          marginBottom: 8,
        }}
      >
        Wartezeit
      </div>

      <div
        style={{
          fontFamily: monoFont,
          fontWeight: 700,
          fontSize: 84,
          lineHeight: 1,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          color,
          textShadow: neon(color, 20 * pulse),
        }}
      >
        {`${minutes}`.padStart(2, "0")}:00
      </div>

      {/* Depleting rule: a second read of the same countdown. */}
      <div
        style={{
          marginTop: 14,
          height: 4,
          backgroundColor: theme.line,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            backgroundColor: color,
            scale: `${1 - progress} 1`,
            transformOrigin: "left center",
            boxShadow: neon(color, 8),
          }}
        />
      </div>
    </div>
  );
};

const StatusCard: React.FC<{ index: number }> = ({ index }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const at = index * CARD_EVERY;
  const local = frame - at;
  const heat = interpolate(frame, [0, durationInFrames - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Flash rate climbs with the heat, so the pile gets visibly more frantic.
  const flash =
    0.5 + 0.5 * Math.sin(frame * (0.55 + heat * 0.85) + index * 1.7);
  const flashAmp = (0.18 + heat * 0.5) * flash;
  const lit = flashAmp > 0.34;

  // Two columns of five. A single deep cascade would bury every card but the
  // last one, which defeats the point of readable rejection notices.
  const col = index % 2;
  const row = Math.floor(index / 2);
  const cx = 200 + col * 680 + row * 26;
  const cy = 396 + row * 64 + col * 46;
  const tilt = hash(index * 3.7) * 1.6;

  return (
    <div
      style={{
        position: "absolute",
        left: cx,
        top: cy,
        width: 560,
        height: 96,
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        border: `1px solid ${theme.line}`,
        borderLeft: `6px solid ${theme.red}`,
        borderRadius: 4,
        opacity: interpolate(local, [0, 4], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        translate: `${
          interpolate(local, [0, 7], [420, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.2, 1.3, 0.3, 1),
          }) +
          hash(frame + index) * (1.5 + heat * 3)
        }px 0px`,
        rotate: `${tilt + hash(frame + index * 2) * (0.3 + heat)}deg`,
        backgroundColor: lit ? "#2a0f16" : theme.bgCard,
        boxShadow: lit ? "0 0 26px #ff2d5544" : "none",
      }}
    >
      <div
        style={{
          fontFamily: monoFont,
          fontWeight: 700,
          fontSize: 20,
          color: theme.red,
          opacity: 0.55 + flashAmp * 0.45,
        }}
      >
        {`${index + 1}`.padStart(2, "0")}
      </div>
      <div
        style={{
          fontFamily: displayFont,
          fontWeight: 700,
          fontSize: 34,
          letterSpacing: "-0.015em",
          color: theme.text,
        }}
      >
        {CARDS[index]}
      </div>
    </div>
  );
};

/** The stamp lands at local frame 150 and never comes off. */
const RejectedStamp: React.FC = () => {
  const frame = useCurrentFrame();
  const at = 150;
  const local = frame - at;

  if (local < 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: 812,
        top: 596,
        padding: "14px 30px",
        border: `6px solid ${theme.red}`,
        borderRadius: 8,
        color: theme.red,
        fontFamily: displayFont,
        fontWeight: 900,
        fontSize: 68,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        rotate: "-12deg",
        opacity: interpolate(local, [0, 3], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        // Slams down from way out and recoils, then holds.
        scale: interpolate(local, [0, 4, 8], [3.4, 0.94, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.3, 1.6, 0.4, 1),
          output: "perceptual-scale",
        }),
        textShadow: neon(theme.red, 10),
        boxShadow: neon(theme.red, 12),
      }}
    >
      Abgelehnt
    </div>
  );
};

export const CountdownStress: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const heat = interpolate(frame, [0, durationInFrames - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      name="Scene background"
      style={{
        backgroundColor: theme.bg,
        overflow: "hidden",
        // The room itself gets redder as the pile grows.
        backgroundImage: `radial-gradient(120% 80% at 20% 30%, #ff2d5500 40%, #ff2d55${Math.round(
          4 + heat * 16,
        )
          .toString(16)
          .padStart(2, "0")} 100%)`,
      }}
    >
      <CountdownClock />

      <div
        style={{
          position: "absolute",
          left: 110,
          top: 100,
          opacity: interpolate(frame, [0, 5], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div
          style={{
            fontFamily: monoFont,
            fontWeight: 500,
            fontSize: 20,
            letterSpacing: "0.26em",
            textTransform: "uppercase",
            color: theme.red,
          }}
        >
          Antrag · Nr. 4–117/B
        </div>
        <div
          style={{
            fontFamily: displayFont,
            fontWeight: 900,
            fontSize: 88,
            lineHeight: 1.02,
            letterSpacing: "-0.03em",
            color: theme.text,
            marginTop: 10,
          }}
        >
          Bearbeitungsstatus
        </div>
      </div>

      {CARDS.map((_, index) => (
        <StatusCard key={index} index={index} />
      ))}

      <RejectedStamp />

      <div
        style={{
          position: "absolute",
          left: 110,
          right: 110,
          bottom: 92,
          fontFamily: displayFont,
          fontWeight: 700,
          fontSize: 46,
          letterSpacing: "-0.01em",
          color: theme.textDim,
          opacity: interpolate(frame, [2 * TICK, 3 * TICK], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Und das war erst der erste Antrag.
      </div>
    </AbsoluteFill>
  );
};
