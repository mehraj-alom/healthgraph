import React from "react";
import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { displayFont, monoFont } from "./fonts";
import { neon, theme } from "./theme";

/** Calm geometry: nothing shakes, nothing snaps, everything eases out. */
const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

const CARD = { left: 110, top: 200, width: 1700, height: 600 };
const RING_R = 150;
const RING_C = 2 * Math.PI * RING_R;

const RESOLVED = [
  "Alle Befunde an einem Ort",
  "Termine, die sich gemerkt werden",
  "Dokumente ohne Amtsweg",
];

/**
 * Four-colour Play mark, drawn as raw paths so it stays crisp at any scale.
 * viewBox is 18 x 24; the badge scales it by height.
 */
const PlayGlyph: React.FC<{ height: number }> = ({ height }) => (
  <svg
    width={(18 / 24) * height}
    height={height}
    viewBox="0 0 18 24"
    aria-label="Google Play"
  >
    <path
      d="M1.5 1.4v21.2c0 .4.2.8.5 1L13 12 2 1.4c-.3.2-.5.6-.5 1z"
      fill="#00A0FF"
    />
    <path d="M14.6 8.7 5.2 3.6a1 1 0 0 0-1 0L13 12l1.6-3.3z" fill="#00E676" />
    <path d="M14.6 15.3 5.2 20.4a1 1 0 0 1-1 0L13 12l1.6 3.3z" fill="#FFCE00" />
    <path
      d="M16.4 9.6 14.5 8.3 13 12l1.5 3.7 1.9-1.3c.8-.5.8-1.6 0-2.1l0-2.7z"
      fill="#FF3A44"
    />
  </svg>
);

const PlayBadge: React.FC<{ enterAt: number }> = ({ enterAt }) => {
  const frame = useCurrentFrame();
  const local = frame - enterAt;

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: 866,
        translate: "-50% 0px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 22,
          padding: "16px 34px 16px 28px",
          backgroundColor: "#000000",
          border: "1px solid #5f6368",
          borderRadius: 10,
          opacity: interpolate(local, [0, 8], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: EASE_OUT,
          }),
          // Dampening bounce: overshoots once, then settles.
          translate: `0px ${interpolate(local, [0, 30], [420, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 13, mass: 0.9, stiffness: 85 }),
          })}px`,
        }}
      >
        <PlayGlyph height={62} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div
            style={{
              fontFamily: displayFont,
              fontWeight: 500,
              fontSize: 18,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#ffffff",
            }}
          >
            Get it on
          </div>
          <div
            style={{
              fontFamily: displayFont,
              fontWeight: 700,
              fontSize: 34,
              letterSpacing: "-0.015em",
              lineHeight: 1.06,
              color: "#ffffff",
            }}
          >
            Google Play
          </div>
        </div>
      </div>
    </div>
  );
};

const RadialChart: React.FC<{ enterAt: number }> = ({ enterAt }) => {
  const frame = useCurrentFrame();
  const local = frame - enterAt;

  const fill = interpolate(local, [0, 74], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });

  return (
    <div
      style={{ position: "relative", width: RING_R * 2, height: RING_R * 2 }}
    >
      <Interactive.Svg
        name="Structure ring"
        width={RING_R * 2}
        height={RING_R * 2}
        viewBox={`0 0 ${RING_R * 2} ${RING_R * 2}`}
        style={{ rotate: "-90deg" }}
      >
        <circle
          cx={RING_R}
          cy={RING_R}
          r={RING_R}
          fill="none"
          stroke={theme.line}
          strokeWidth={16}
        />
        <Interactive.Circle
          name="Structure fill"
          cx={RING_R}
          cy={RING_R}
          r={RING_R}
          fill="none"
          stroke={theme.emerald}
          strokeWidth={16}
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - fill)}
        />
      </Interactive.Svg>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
        }}
      >
        <div
          style={{
            fontFamily: displayFont,
            fontWeight: 900,
            // Sized so the tabular digits stay clear of the ring at 100%.
            fontSize: 78,
            lineHeight: 1,
            letterSpacing: "-0.03em",
            fontVariantNumeric: "tabular-nums",
            color: theme.text,
          }}
        >
          {`${Math.round(fill * 100)}%`}
        </div>
        <div
          style={{
            fontFamily: monoFont,
            fontWeight: 500,
            fontSize: 19,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: theme.emerald,
          }}
        >
          Struktur
        </div>
      </div>
    </div>
  );
};

export const CalmDashboard: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill name="Scene background" style={{ backgroundColor: theme.bg }}>
      {/* The wipe. Full-frame at the cut, gone by frame 9. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1920,
          height: 1080,
          backgroundColor: theme.emerald,
          boxShadow: "0 0 120px #10b981cc",
          translate: `${interpolate(frame, [0, 9], [0, 2400], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.linear,
          })}px 0px`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 10,
          height: 1080,
          backgroundColor: "#ecfdf5",
          boxShadow: "0 0 90px #ffffffdd",
          translate: `${interpolate(frame, [0, 9], [1910, 4310], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.linear,
          })}px 0px`,
        }}
      />

      {/* Soft emerald wash replaces the neon of the chaos act. */}
      <AbsoluteFill
        name="Calm wash"
        style={{
          backgroundImage:
            "radial-gradient(90% 70% at 78% 42%, #10b9811f 0%, #10b98100 62%)",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 110,
          top: 100,
          display: "flex",
          alignItems: "center",
          gap: 14,
          opacity: interpolate(frame, [4, 16], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: EASE_OUT,
          }),
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: theme.emerald,
            boxShadow: neon(theme.emerald, 12),
          }}
        />
        <div
          style={{
            fontFamily: monoFont,
            fontWeight: 500,
            fontSize: 22,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: theme.textDim,
          }}
        >
          HealthGraph
        </div>
      </div>

      {/* Dashboard card */}
      <div
        style={{
          position: "absolute",
          left: CARD.left,
          top: CARD.top,
          width: CARD.width,
          height: CARD.height,
          padding: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: theme.bgCard,
          border: `1px solid ${theme.line}`,
          borderRadius: 18,
          boxShadow: "0 30px 90px #00000066",
          opacity: interpolate(frame, [4, 22], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: EASE_OUT,
          }),
          scale: interpolate(frame, [4, 30], [0.965, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: EASE_OUT,
            output: "perceptual-scale",
          }),
        }}
      >
        <div style={{ flex: 1, paddingRight: 60 }}>
          <div
            style={{
              fontFamily: displayFont,
              fontWeight: 900,
              fontSize: 122,
              lineHeight: 1,
              letterSpacing: "-0.035em",
              color: theme.text,
              opacity: interpolate(frame, [10, 34], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: EASE_OUT,
              }),
              translate: `0px ${interpolate(frame, [10, 40], [26, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: EASE_OUT,
              })}px`,
            }}
          >
            HealthGraph.
          </div>

          <div
            style={{
              fontFamily: displayFont,
              fontWeight: 700,
              fontSize: 64,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              color: theme.emerald,
              marginTop: 12,
              opacity: interpolate(frame, [18, 42], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: EASE_OUT,
              }),
            }}
          >
            Beende das Chaos.
          </div>

          <div
            style={{
              marginTop: 46,
              display: "flex",
              flexDirection: "column",
              gap: 22,
              opacity: interpolate(frame, [30, 58], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: EASE_OUT,
              }),
            }}
          >
            {RESOLVED.map((row) => (
              <div
                key={row}
                style={{ display: "flex", alignItems: "center", gap: 18 }}
              >
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "#10b98122",
                    border: `1px solid ${theme.emerald}`,
                    color: theme.emerald,
                    fontSize: 17,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  ✓
                </div>
                <div
                  style={{
                    fontFamily: displayFont,
                    fontWeight: 500,
                    fontSize: 44,
                    letterSpacing: "-0.01em",
                    color: theme.textDim,
                  }}
                >
                  {row}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ flexShrink: 0 }}>
          <RadialChart enterAt={22} />
        </div>
      </div>

      <PlayBadge enterAt={64} />

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 990,
          textAlign: "center",
          fontFamily: monoFont,
          fontWeight: 500,
          fontSize: 20,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: theme.textFaint,
          opacity: interpolate(frame, [80, 104], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: EASE_OUT,
          }),
        }}
      >
        Kostenlos · DSGVO-konform · Ohne Werbung
      </div>
    </AbsoluteFill>
  );
};
