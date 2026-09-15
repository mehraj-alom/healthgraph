/**
 * FaceTracker — guide-ROI presence/stability tracking in pure TypeScript.
 *
 * Consumes per-frame ROI telemetry (brightness, skin-ratio, motion or raw
 * native state events) and owns the composite capture states the UI shows.
 * The native layer gates frame-by-frame; this tracker is the state
 * authority for guidance (FIND_FACE / POSITION_FACE / ACQUIRING /
 * FACE_LOST) and the stability statistics consumed by quality gating.
 *
 * A DNN face detector can replace the heuristic presence input later behind
 * the same RppgTelemetrySample boundary without touching the pipeline, UI,
 * persistence, or sync layers.
 */

export interface RppgTelemetrySample {
  /** 0..255 ROI brightness mean. */
  brightness: number;
  /** 0..1 skin-pixel ratio inside the guide ROI. */
  skinRatio: number;
  /** Frame-to-frame ROI change (same units as the native motion gate). */
  motion: number;
  /** Monotonic timestamp in ms. */
  timestampMs: number;
}

export type FaceTrackState =
  | 'FIND_FACE'
  | 'POSITION_FACE'
  | 'ACQUIRING'
  | 'FACE_LOST';

/** Screen-level capture states (superset shown by the measurement UI). */
export type RppgScreenState =
  | 'IDLE'
  | 'PREPARING'
  | 'FIND_FACE'
  | 'POSITION_FACE'
  | 'ACQUIRING'
  | 'MEASURING'
  | 'SIGNAL_WEAK'
  | 'FACE_LOST'
  | 'COMPLETING'
  | 'COMPLETE'
  | 'FAILED';

export interface FaceTrackSnapshot {
  state: FaceTrackState;
  /** 0..1 composite stability (presence x stillness), for guidance + quality. */
  stability: number;
  /** Consecutive present frames. */
  presentStreak: number;
  /** Consecutive absent frames. */
  absentStreak: number;
  /** Fraction of samples with a present face since (re)start. */
  presentFrac: number;
  /** Fraction of samples that were stable since (re)start. */
  stableFrac: number;
  samples: number;
}

export interface FaceTrackerOptions {
  brightMin?: number;
  brightMax?: number;
  skinMin?: number;
  motionStableMax?: number;
  /** Consecutive absent samples before FACE_LOST (default 30 ≈ 1s @30fps). */
  absentReset?: number;
  /** Consecutive stable samples before ACQUIRING (default 6). */
  stableWarmup?: number;
}

const DEFAULTS = {
  brightMin: 40,
  brightMax: 225,
  skinMin: 0.22,
  motionStableMax: 6.0,
  absentReset: 30,
  stableWarmup: 6,
} as const;

export class FaceTracker {
  private readonly opts: Required<FaceTrackerOptions>;
  private presentStreak = 0;
  private absentStreak = 0;
  private stableStreak = 0;
  private presentSamples = 0;
  private stableSamples = 0;
  private totalSamples = 0;
  private lost = false;

  constructor(options: FaceTrackerOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  reset(): void {
    this.presentStreak = 0;
    this.absentStreak = 0;
    this.stableStreak = 0;
    this.presentSamples = 0;
    this.stableSamples = 0;
    this.totalSamples = 0;
    this.lost = false;
  }

  observe(sample: RppgTelemetrySample): FaceTrackSnapshot {
    const o = this.opts;
    const finite =
      Number.isFinite(sample.brightness) &&
      Number.isFinite(sample.skinRatio) &&
      Number.isFinite(sample.motion);
    const present =
      finite &&
      sample.brightness >= o.brightMin &&
      sample.brightness <= o.brightMax &&
      sample.skinRatio >= o.skinMin;
    const stable = present && sample.motion < o.motionStableMax;
    this.totalSamples += 1;
    if (present) {
      this.presentStreak += 1;
      this.absentStreak = 0;
      this.presentSamples += 1;
      this.stableStreak = stable ? this.stableStreak + 1 : 0;
      if (stable) this.stableSamples += 1;
    } else {
      this.absentStreak += 1;
      this.presentStreak = 0;
      this.stableStreak = 0;
    }
    let state: FaceTrackState;
    if (!present && this.absentStreak >= o.absentReset) {
      state = 'FACE_LOST';
      this.lost = true;
    } else if (this.lost && !present) {
      state = 'FACE_LOST';
    } else if (!present) {
      // Brief absence (blink): keep previous guidance, not yet lost.
      state = this.presentSamples > 0 ? 'POSITION_FACE' : 'FIND_FACE';
    } else if (this.stableStreak >= o.stableWarmup) {
      state = 'ACQUIRING';
      this.lost = false;
    } else if (this.presentStreak > o.stableWarmup) {
      // Present but not yet steady: guide positioning, not acquisition.
      state = 'POSITION_FACE';
    } else {
      state = 'FIND_FACE';
    }
    const presenceScore = present ? 1 : 0;
    const stillness = stable ? 1 : Math.max(0, 1 - sample.motion / (o.motionStableMax * 3));
    return {
      state,
      stability: finite ? presenceScore * stillness : 0,
      presentStreak: this.presentStreak,
      absentStreak: this.absentStreak,
      presentFrac: this.totalSamples > 0 ? this.presentSamples / this.totalSamples : 0,
      stableFrac: this.totalSamples > 0 ? this.stableSamples / this.totalSamples : 0,
      samples: this.totalSamples,
    };
  }
}

/** Map a native capture event to the screen state (pure, node-testable). */
export function mapNativeCaptureState(
  native:
    | 'STARTING'
    | 'FIND_FACE'
    | 'POSITION_FACE'
    | 'ACQUIRING'
    | 'FACE_LOST'
    | 'COMPLETING'
    | 'COMPLETE'
    | 'FAILED'
    | 'CANCELLED',
  stability: number | null,
): RppgScreenState {
  switch (native) {
    case 'STARTING':
      return 'PREPARING';
    case 'FIND_FACE':
      return 'FIND_FACE';
    case 'POSITION_FACE':
      return 'POSITION_FACE';
    case 'ACQUIRING':
      // Weak live stability surfaces guidance without aborting capture.
      return stability !== null && stability < 0.4 ? 'SIGNAL_WEAK' : 'ACQUIRING';
    case 'FACE_LOST':
      return 'FACE_LOST';
    case 'COMPLETING':
      return 'COMPLETING';
    case 'COMPLETE':
      return 'COMPLETING';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'IDLE';
  }
}

/** Build a deterministic telemetry fixture for tests (not face data). */
export function buildTelemetryFixture(
  count: number,
  kind: 'stable' | 'absent' | 'shaky' | 'dark',
  fps = 30,
): RppgTelemetrySample[] {
  const out: RppgTelemetrySample[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i * 1000) / fps;
    switch (kind) {
      case 'stable':
        out.push({ brightness: 140, skinRatio: 0.55, motion: 1.2, timestampMs: t });
        break;
      case 'absent':
        out.push({ brightness: 25, skinRatio: 0.02, motion: 0.5, timestampMs: t });
        break;
      case 'shaky':
        out.push({
          brightness: 140,
          skinRatio: 0.5,
          motion: i % 2 === 0 ? 2.0 : 14.0,
          timestampMs: t,
        });
        break;
      case 'dark':
        out.push({ brightness: 18, skinRatio: 0.4, motion: 1.0, timestampMs: t });
        break;
    }
  }
  return out;
}
