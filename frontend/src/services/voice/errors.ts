/**
 * Voice provider error contract (Phase 4).
 *
 * Every voice failure surfaces as a VoiceError with an explicit code —
 * transcription and audio are never fabricated, never silenced.
 */

export type VoiceErrorCode =
  | 'MODEL_UNAVAILABLE'
  | 'MODEL_LOAD_FAILED'
  | 'INVALID_AUDIO'
  | 'INVALID_INPUT'
  | 'TRANSCRIPTION_FAILED'
  | 'SYNTHESIS_FAILED'
  | 'AUDIO_PLAYBACK_FAILED'
  | 'G2P_UNAVAILABLE'
  | 'NO_TRANSPORT'
  | 'TIMEOUT'
  | 'INTERRUPTED';

export class VoiceError extends Error {
  readonly code: VoiceErrorCode;

  constructor(code: VoiceErrorCode, message: string) {
    super(message);
    this.name = 'VoiceError';
    this.code = code;
  }
}
