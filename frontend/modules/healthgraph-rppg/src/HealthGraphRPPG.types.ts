/**
 * HealthGraphRPPG public types.
 *
 * On-device face rPPG CAPTURE. The native layer owns the front-camera loop:
 * guide-ROI presence/stability gating, 160-frame 128x128 BGR window assembly,
 * and a sealed window file on device storage. JS receives telemetry events +
 * the final capture summary (window URI + scalars). Raw frames / video NEVER
 * cross the bridge; inference happens later through services/rppg.
 */

export type RppgNativeState =
  | 'STARTING'
  | 'FIND_FACE'
  | 'POSITION_FACE'
  | 'ACQUIRING'
  | 'FACE_LOST'
  | 'COMPLETING'
  | 'COMPLETE'
  | 'FAILED'
  | 'CANCELLED';

export interface RppgCaptureOptions {
  /** Wall-clock budget for filling the 160-frame window. Default 30s. */
  timeoutSeconds?: number;
}

export interface RppgCaptureResult {
  /** Local file URI of the sealed RPPG window (BGR 128x128 x N + timestamps). */
  windowUri: string;
  /** Qualified frames sealed into the window (160 on success). */
  frameCount: number;
  /** Effective capture rate measured from frame timestamps. */
  fpsMeasured: number;
  /** Wall-clock span of the sealed window in ms. */
  durationMs: number;
  /** Fraction of window frames with a stable, positioned face (0..1). */
  faceStableFrac: number;
  /** Frames skipped (no face / motion / late) during capture. */
  droppedFrames: number;
}

/** Telemetry emitted during capture (throttled, scalars only). */
export interface RppgNativeEvent {
  state: RppgNativeState;
  /** Qualified frames collected so far. */
  framesCollected?: number;
  /** 0..1 face presence/stability estimate for guidance UI. */
  stability?: number;
  /** Machine-readable failure reason on FAILED. */
  reason?: string;
  message?: string;
}

/** Window-file contract shared by the native writers and the JS reader. */
export const RPPG_WINDOW_MAGIC = 'RPPG';
export const RPPG_WINDOW_VERSION = 1;
export const RPPG_WINDOW_FRAMES = 160;
export const RPPG_WINDOW_ROI = 128;
/** Accepted effective capture rate (Hz). Outside this, JS must refuse inference. */
export const RPPG_FPS_MIN = 27;
export const RPPG_FPS_MAX = 33;

/** Native module + event names. Must match the Kotlin/Swift registration. */
export const RPPG_NATIVE_MODULE_NAME = 'HealthGraphRPPG';
export const RPPG_STATE_EVENT_NAME = 'HealthGraphRPPGState';

/**
 * Reject-path codes (promise.reject). Must match native implementations.
 * INSUFFICIENT_FRAMES: timeout with <160 qualified frames (face lost,
 * motion, or interruptions) — never a partial window.
 */
export const RPPG_STARTUP_REJECT_CODES = [
  'NO_CONTEXT',
  'NO_LIFECYCLE',
  'CAMERA_PERMISSION',
  'NO_CAMERA',
  'CAMERA_START',
  'IN_PROGRESS',
  'INSUFFICIENT_FRAMES',
  'WINDOW_WRITE_FAILED',
  'CANCELLED',
] as const;

/** Failure reasons delivered on FAILED events. */
export const RPPG_FAILURE_REASONS = [
  'NO_FACE',
  'FACE_LOST',
  'INSUFFICIENT_FRAMES',
  'UNSUPPORTED_FPS',
  'WINDOW_WRITE_FAILED',
  'CAMERA_START',
] as const;
export type RppgFailureReason = (typeof RPPG_FAILURE_REASONS)[number];

/** Wellness-only copy. Never add diagnostic / disease / treatment claims. */
export const RPPG_COPY: Record<RppgNativeState, string> = {
  STARTING: 'Starting the camera…',
  FIND_FACE: 'Show your face in the frame.',
  POSITION_FACE: 'Hold still, face centered in the guide.',
  ACQUIRING: 'Capturing… keep still.',
  FACE_LOST: 'Face lost. Center your face in the guide.',
  COMPLETING: 'Analyzing…',
  COMPLETE: 'Capture complete.',
  FAILED: 'Capture could not be completed. Try again.',
  CANCELLED: 'Capture cancelled.',
};
