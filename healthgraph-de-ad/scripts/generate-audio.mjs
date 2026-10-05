/**
 * Procedurally generates public/audio/score.wav.
 *
 * No stock audio is used: every sample is synthesised here. The script reads
 * the same TICK grid as src/timing.ts so the typography pop-ins land exactly on
 * the clicks, and it places the sub-bass drop on DROP_FRAME.
 *
 *   node scripts/generate-audio.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FPS = 30;
const DURATION_IN_FRAMES = 900;
const TICK = 15;
const DROP_FRAME = 750;

const SR = 48000;
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../public/audio/score.wav",
);

const frameToSec = (f) => f / FPS;
const TAU = Math.PI * 2;

/** Seeded LCG so every run produces an identical file. */
let seed = 0x2f6e2b1;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};

/** One-pole lowpass, used to keep the noise transients from sounding harsh. */
const makeLowpass = (cutoffHz) => {
  const dt = 1 / SR;
  const rc = 1 / (TAU * cutoffHz);
  const a = dt / (rc + dt);
  let prev = 0;
  return (x) => (prev = prev + a * (x - prev));
};

const lpTick = makeLowpass(5200);
const lpSwell = makeLowpass(1800);

const totalSamples = Math.ceil((DURATION_IN_FRAMES / FPS) * SR);
const buf = new Float64Array(totalSamples);

const add = (i, v) => {
  if (i >= 0 && i < totalSamples) buf[i] += v;
};

/**
 * A single clock tick: a band-limited noise transient plus a short tonal body.
 * `accent` makes it louder and brighter so the downbeats land harder.
 */
const tick = (startSec, amp, accent) => {
  const start = Math.floor(startSec * SR);
  const len = Math.floor(0.05 * SR);
  const f1 = accent ? 1750 : 1350;
  const f2 = accent ? 3100 : 2400;
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    const env = Math.exp(-t * (accent ? 78 : 96));
    const noise = lpTick(rand() * 2 - 1) * Math.exp(-t * 150) * 0.75;
    const body = Math.sin(TAU * f1 * t) * 0.5 + Math.sin(TAU * f2 * t) * 0.28;
    add(start + n, (noise + body * env) * amp);
  }
};

/** Low sustained bed that keeps the tick grid feeling driven, not floating. */
const subBed = () => {
  for (let n = 0; n < totalSamples; n++) {
    const t = n / SR;
    const secs = frameToSec(0) + t;
    if (secs > frameToSec(DROP_FRAME)) break;
    // Tension rises scene by scene, so the bed thickens as the ad escalates.
    const ramp = Math.min(1, secs / 24) * 0.6 + 0.4;
    const lfo = 0.72 + 0.28 * Math.sin(TAU * 0.5 * t);
    const v =
      Math.sin(TAU * 55 * t) * 0.1 +
      Math.sin(TAU * 82.5 * t) * 0.055 +
      Math.sin(TAU * 110 * t) * 0.03;
    add(n, v * ramp * lfo);
  }
};

/** Reverse-swell into the drop, then the drop itself. */
const drop = () => {
  const t0 = frameToSec(DROP_FRAME);

  // 24.55s -> 25.0s : rising filtered noise
  const swellStart = Math.floor((t0 - 0.45) * SR);
  const swellLen = Math.floor(0.45 * SR);
  for (let n = 0; n < swellLen; n++) {
    const k = n / swellLen;
    const env = Math.pow(k, 2.4);
    add(swellStart + n, lpSwell(rand() * 2 - 1) * env * 0.26);
  }

  // 25.0s onward : pitch-swept sub boom. 110Hz collapsing to 28Hz.
  const boomStart = Math.floor(t0 * SR);
  const boomLen = Math.floor(2.6 * SR);
  for (let n = 0; n < boomLen; n++) {
    const t = n / SR;
    const f = 28 + 82 * Math.exp(-t * 3.4);
    const env = Math.exp(-t * 1.5) * (1 - Math.exp(-t * 220));
    add(boomStart + n, Math.sin(TAU * f * t) * env * 0.85);
    add(boomStart + n, Math.sin(TAU * f * 2 * t) * env * 0.16);
  }

  // Onset transient so the drop has a leading edge, not just a swell.
  const hitLen = Math.floor(0.12 * SR);
  for (let n = 0; n < hitLen; n++) {
    const t = n / SR;
    const env = Math.exp(-t * 70);
    add(boomStart + n, lpTick(rand() * 2 - 1) * env * 0.3);
  }
};

/** Calm major pad for the dashboard, fading out before the last frame. */
const pad = () => {
  const t0 = frameToSec(DROP_FRAME);
  const start = Math.floor(t0 * SR);
  // G major, low register: G2 / D3 / G3 / B3
  const voices = [98, 146.83, 196, 246.94];
  voices.forEach((f, idx) => {
    const len = Math.floor((30 - t0) * SR);
    for (let n = 0; n < len; n++) {
      const t = n / SR;
      const secs = t0 + t;
      const fadeIn = Math.min(1, t / 0.55);
      const fadeOut = Math.min(1, Math.max(0, (30 - secs) / 0.8));
      const trem = 0.9 + 0.1 * Math.sin(TAU * (0.22 + idx * 0.07) * t);
      const amp = (0.075 - idx * 0.012) * fadeIn * fadeOut * trem;
      add(start + n, Math.sin(TAU * f * t) * amp);
    }
  });
};

// --- Compose the score -----------------------------------------------------
subBed();

for (let f = 0; f < DROP_FRAME; f += TICK) {
  const accent = (f / TICK) % 4 === 0;
  let amp = 0.5;
  if (f >= 180) amp = 0.62;
  if (f >= 450) amp = 0.74;
  if (f >= 620) amp = 0.86;
  tick(frameToSec(f), amp * (accent ? 1.15 : 0.82), accent);
}

drop();
pad();

// --- Soft-clip and normalise ----------------------------------------------
let peak = 0;
for (let n = 0; n < totalSamples; n++) {
  const v = Math.tanh(buf[n] * 1.1);
  buf[n] = v;
  const a = Math.abs(v);
  if (a > peak) peak = a;
}
const gain = peak > 0 ? 0.89 / peak : 1;

// --- Write 16-bit mono WAV -------------------------------------------------
const dataBytes = totalSamples * 2;
const out = Buffer.alloc(44 + dataBytes);
out.write("RIFF", 0, "ascii");
out.writeUInt32LE(36 + dataBytes, 4);
out.write("WAVE", 8, "ascii");
out.write("fmt ", 12, "ascii");
out.writeUInt32LE(16, 16); // PCM chunk size
out.writeUInt16LE(1, 20); // format = PCM
out.writeUInt16LE(1, 22); // channels = mono
out.writeUInt32LE(SR, 24);
out.writeUInt32LE(SR * 2, 28); // byte rate
out.writeUInt16LE(2, 32); // block align
out.writeUInt16LE(16, 34); // bits per sample
out.write("data", 36, "ascii");
out.writeUInt32LE(dataBytes, 40);
for (let n = 0; n < totalSamples; n++) {
  out.writeInt16LE(
    Math.max(-32768, Math.min(32767, Math.round(buf[n] * gain * 32767))),
    44 + n * 2,
  );
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);

console.log(
  `wrote ${OUT} — ${(out.length / 1024 / 1024).toFixed(2)} MB, ` +
    `${DURATION_IN_FRAMES / FPS}s, ${DROP_FRAME / TICK} ticks, drop @ ${DROP_FRAME}`,
);
