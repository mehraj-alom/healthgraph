/**
 * HealthGraphSatts public types.
 *
 * On-device sanoTTS speech. The native layer owns synthesis only:
 * phoneme-ID sequence in, PCM WAV file out. Raw weights never cross the
 * bridge; only file URIs and scalars do. Text→IDs (grapheme-to-phoneme)
 * lives OUTSIDE this module (SanoTTSProvider) so no espeak/GPL layer
 * ships on device.
 */

export type SattsVoiceId = 'heartnano';

/** Precomputed phoneme-ID test vector ("Hello, this is HealthGraph."). */
export const SATTS_TEST_PHRASE = 'Hello, this is HealthGraph.';
export const SATTS_TEST_IDS: readonly number[] = [
  1, 22, 42, 26, 54, 15, 8, 3, 37, 46, 30, 3, 46, 35, 3, 22, 55, 43, 26,
  56, 45, 47, 54, 36, 21, 9, 2,
];

export interface SattsSynthResult {
  /** file:// URI of the synthesized 16-bit mono WAV in the app cache. */
  uri: string;
  sampleRateHz: number;
  /** Byte size of the WAV file. */
  bytes: number;
}

/** Native module + lookup name. Must match the Kotlin registration. */
export const SATTS_NATIVE_MODULE_NAME = 'HealthGraphSatts';
