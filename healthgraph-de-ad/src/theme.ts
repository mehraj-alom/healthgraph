export const theme = {
  bg: "#0b0b0c",
  bgLift: "#121214",
  bgCard: "#17171a",
  line: "#26262b",
  text: "#f4f4f5",
  textDim: "#8b8b93",
  textFaint: "#4a4a52",

  emerald: "#10b981",
  emeraldDim: "#0a6b4d",

  red: "#ff2d55",
  orange: "#ff7a00",
  yellow: "#ffd60a",
  cyan: "#00d2ff",
} as const;

export const font = {
  /** Heavy grotesque for the kinetic hook and headlines. */
  display: "Archivo",
  mono: "Roboto Mono",
} as const;

/** Raw neon that gets used with `mixBlendMode: screen` so overlaps bloom. */
export const neon = (color: string, blur: number) =>
  `0 0 ${blur}px ${color}, 0 0 ${blur * 2.4}px ${color}55`;

/**
 * interpolate() will not blend hex colors on its own, so ramps are done here.
 * `t` is expected to be clamped to 0..1.
 */
export const lerpColor = (from: string, to: string, t: number) => {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  const k = Math.max(0, Math.min(1, t));
  const parts = [1, 3, 5].map((i) => {
    const v = channel(from, i) + (channel(to, i) - channel(from, i)) * k;
    return Math.round(v).toString(16).padStart(2, "0");
  });
  return `#${parts.join("")}`;
};
