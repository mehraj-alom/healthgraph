/**
 * HealthGraphPPG public types.
 *
 * On-device fingertip PPG. The native layer owns the high-frequency
 * camera loop; JS only receives state events + the final compact result.
 * Raw frames / video / raw PPG streams NEVER cross the bridge.
 */

export type PpgState =
  | 'IDLE'
  | 'STARTING'
  | 'MEASURING'
  | 'QUALITY_WARNING'
  | 'COMPLETING'
  | 'COMPLETE'
  | 'FAILED'
  | 'CANCELLED';

export interface PpgMeasureOptions {
  /** Measurement window in seconds. Clamped to 10–300 natively. Default 60. */
  durationSeconds?: number;
  /**
   * Opt-in raw-signal export for research/diagnostics. Default false.
   * When false, raw samples stay on-device and are discarded after scoring.
   */
  exportRawSignal?: boolean;
}

export interface PpgMeasurementResult {
  heartRateBpm: number | null;
  rrIntervalsMs?: number[];
  rmssdMs?: number | null;
  sdnnMs?: number | null;
  signalQuality: number;
  durationSeconds: number;
  algorithmVersion: string;
  /** Present only when exportRawSignal === true and user consented. */
  rawSignal?: number[];
  /**
   * Diagnostics reported by the native layer (Android). Optional so older
   * payloads and the simulation stay valid. Never frames or waveforms.
   */
  /** True when the torch was confirmed ON at completion. */
  torchEnabled?: boolean;
  /** Analyzer frames delivered by CameraX during the window. */
  framesReceived?: number;
  /** Frames accepted into the signal buffer (passed the exposure gate). */
  samplesCollected?: number;
  /**
   * Machine-readable null-HR reason: NO_SAMPLES | LOW_QUALITY | NO_BEATS.
   * Absent when a heart rate was produced. Thresholds are unchanged.
   */
  failureReason?: string;
  /**
   * True for development simulation (Expo Go fallback). Simulated results
   * are NOT real measurements: they must never be persisted, synced, or
   * presented as health data.
   */
  simulated?: boolean;
}

export interface PpgStateEvent {
  state: PpgState;
  /** 0..1 live quality estimate while measuring. */
  signalQuality?: number;
  message?: string;
}

export const PPG_ALGORITHM_VERSION = 'ppg-1.0.0';

/** Native module + event names. Must match the Kotlin/Swift registration. */
export const PPG_NATIVE_MODULE_NAME = 'HealthGraphPPG';
export const PPG_STATE_EVENT_NAME = 'HealthGraphPPGState';

/**
 * Resolve-path null-HR reasons (result.failureReason). Thresholds unchanged:
 * these only NAME the gate. Must match HealthGraphPPGModule.kt.
 */
export const PPG_FAILURE_REASONS = ['NO_SAMPLES', 'LOW_QUALITY', 'NO_BEATS'] as const;
export type PpgFailureReason = (typeof PPG_FAILURE_REASONS)[number];

/**
 * Reject-path codes (promise.reject). Must match HealthGraphPPGModule.kt.
 * Handled explicitly by usePpgMeasurement; never finger-blame for these.
 */
export const PPG_STARTUP_REJECT_CODES = [
  'NO_CONTEXT',
  'NO_LIFECYCLE',
  'CAMERA_PERMISSION',
  'NO_CAMERA',
  'NO_FLASH',
  'TORCH_UNAVAILABLE',
  'CAMERA_START',
  'PROCESSING',
  'IN_PROGRESS',
  'CANCELLED',
] as const;

/** Wellness-only copy. Never add diagnostic / disease / treatment claims. */
export const PPG_COPY: Record<PpgState, string> = {
  IDLE: 'Place your finger over the camera to begin.',
  STARTING: 'Starting the camera…',
  MEASURING: 'Keep your finger still over the camera and flash.',
  QUALITY_WARNING: 'Signal quality is too low. Adjust your finger and hold still.',
  COMPLETING: 'Finishing measurement…',
  COMPLETE: 'Measurement complete.',
  FAILED: 'Measurement could not be completed. Try again.',
  CANCELLED: 'Measurement cancelled.',
};
