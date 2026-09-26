/**
 * TTS provider boundary (Phase 4 — interfaces only).
 *
 * TTSProvider
 *   └── SanoTTSProvider (mobile sanoTTS, verified in Phase 3)
 *
 * Conceptually `text → audio`, with one honest split: the on-device
 * runtime consumes PHONEME IDs (no g2p ships on device), so
 * `synthesizeIds` is the real path and `synthesizeText` requires an
 * injected phonemizer (absent by default → explicit G2P_UNAVAILABLE).
 * sanoTTS-specific details (native bridge shape, voice files) stay behind
 * this boundary. Playback stays with the caller (expo-audio).
 */

import { VoiceError } from './errors';

export interface TtsResult {
  /** file:// URI of the synthesized 16-bit mono WAV in the app cache. */
  uri: string;
  sampleRateHz: number;
  /** WAV byte size, or -1 when the stat backend is unavailable. */
  bytes: number;
}

/** Native bridge surface (mirrors HealthGraphSattsModule). */
export interface SattsBridge {
  isAvailable(): boolean;
  loadVoices(frontPath: string, modelPath: string): boolean;
  getSampleRate(): number;
  getLastError(): string;
  synthesize(ids: number[]): Promise<string | null>;
  close(): void;
}

export interface TTSProvider {
  readonly kind: 'sanotts';
  readonly isAvailable: boolean;
  synthesizeIds(ids: readonly number[], options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<TtsResult>;
  synthesizeText(text: string, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<TtsResult>;
}

export interface SanoTTSProviderOptions {
  bridge: SattsBridge | null;
  voice: { frontUri: string; modelUri: string };
  /** Text→IDs mapper. Absent on device until the voice-session phase. */
  phonemize?: ((text: string) => readonly number[]) | null;
  stat?: ((uri: string) => Promise<{ size: number }>) | null;
  timeoutMs?: number;
}

const DEFAULT_TTS_TIMEOUT_MS = 30_000;
/** heartnano 62-symbol id space (0..61); BOS=1 EOS=2 framing. */
const MAX_PHONEME_ID = 61;

function isValidIds(ids: readonly number[]): boolean {
  return (
    ids.length > 0 &&
    ids.length <= 512 &&
    ids.every((id) => Number.isInteger(id) && id >= 0 && id <= MAX_PHONEME_ID)
  );
}

export function createSanoTTSProvider(options: SanoTTSProviderOptions): TTSProvider {
  const { bridge, voice, phonemize = null, stat = null } = options;
  const defaultTimeout = options.timeoutMs ?? DEFAULT_TTS_TIMEOUT_MS;
  let loaded = false;
  let inFlight = false;

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    if (!bridge || bridge.isAvailable() !== true) {
      throw new VoiceError('MODEL_UNAVAILABLE', 'sanoTTS native module is not available in this build.');
    }
    let ok = false;
    try {
      ok = bridge.loadVoices(voice.frontUri, voice.modelUri) === true;
    } catch (e) {
      throw new VoiceError('MODEL_LOAD_FAILED', e instanceof Error ? e.message : 'Voice load failed.');
    }
    if (!ok) {
      let detail = '';
      try {
        detail = bridge.getLastError();
      } catch {
        // Error text is best-effort.
      }
      throw new VoiceError('MODEL_LOAD_FAILED', `Voice files could not be loaded.${detail ? ` (${detail})` : ''}`);
    }
    loaded = true;
  }

  async function run<T>(signal: AbortSignal | undefined, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
    if (signal?.aborted === true) throw new VoiceError('INTERRUPTED', 'Synthesis was cancelled.');
    if (inFlight) throw new VoiceError('INTERRUPTED', 'A synthesis is already running.');
    inFlight = true;
    try {
      if (!(timeoutMs > 0)) return await fn();
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        return await Promise.race([
          fn(),
          new Promise<T>((_, reject) => {
            timer = setTimeout(
              () => reject(new VoiceError('TIMEOUT', `Synthesis timed out after ${timeoutMs} ms.`)),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    } finally {
      inFlight = false;
    }
  }

  return {
    kind: 'sanotts',
    isAvailable: bridge !== null,
    async synthesizeIds(ids, opts): Promise<TtsResult> {
      if (!isValidIds(ids)) {
        throw new VoiceError('INVALID_INPUT', 'Provide 1–512 integer phoneme IDs in 0..61.');
      }
      await ensureLoaded();
      if (!bridge) throw new VoiceError('MODEL_UNAVAILABLE', 'sanoTTS native module is not available.');
      const uri = await run(opts?.signal, opts?.timeoutMs ?? defaultTimeout, async () => {
        let out: string | null;
        try {
          out = await bridge.synthesize([...ids]);
        } catch (e) {
          throw new VoiceError('SYNTHESIS_FAILED', e instanceof Error ? e.message : 'Synthesis failed.');
        }
        if (!out) {
          let detail = '';
          try {
            detail = bridge.getLastError();
          } catch {
            // Best-effort.
          }
          throw new VoiceError('SYNTHESIS_FAILED', `The synthesizer produced no audio.${detail ? ` (${detail})` : ''}`);
        }
        return out;
      });
      let bytes = -1;
      if (stat) {
        try {
          bytes = (await stat(uri)).size;
        } catch {
          bytes = -1;
        }
      }
      let sampleRateHz = 0;
      try {
        sampleRateHz = bridge.getSampleRate();
      } catch {
        sampleRateHz = 0;
      }
      return { uri, sampleRateHz, bytes };
    },
    async synthesizeText(text, opts): Promise<TtsResult> {
      if (!phonemize) {
        throw new VoiceError(
          'G2P_UNAVAILABLE',
          'On-device text phonemization ships in the voice-session phase; supply phoneme IDs via synthesizeIds.',
        );
      }
      if (typeof text !== 'string' || text.trim() === '') {
        throw new VoiceError('INVALID_INPUT', 'Provide non-empty text to speak.');
      }
      return this.synthesizeIds(phonemize(text), opts);
    },
  };
}
