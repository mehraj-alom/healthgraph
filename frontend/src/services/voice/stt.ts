/**
 * STT provider boundary (Phase 4 — interfaces only).
 *
 * STTProvider
 *   └── PakeetProvider (server Pakeet, verified in Phase 2)
 *
 * The provider owns `audio → transcription` and NOTHING else: no inference
 * logic lives here (the VPS sidecar is the source of truth), no transport
 * is built here (the voice-session API lands in the next phase). The
 * transport is injected so behavior is deterministic and testable; a
 * missing transport fails explicitly as MODEL_UNAVAILABLE, never silently.
 */

import { VoiceError } from './errors';

export interface SttRequest {
  /** Local audio file URI (WAV captured on device). */
  audioUri: string;
  /** Transport budget in ms (default 30_000). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SttResult {
  text: string;
}

/** Server transport (implemented by the voice-session phase). */
export type SttTransport = (req: SttRequest) => Promise<SttResult>;

export interface STTProvider {
  readonly kind: 'pakeet';
  readonly isAvailable: boolean;
  transcribe(req: SttRequest): Promise<SttResult>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function createPakeetProvider(options?: {
  transport?: SttTransport | null;
  timeoutMs?: number;
}): STTProvider {
  const transport = options?.transport ?? null;
  const defaultTimeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    kind: 'pakeet',
    isAvailable: transport !== null,
    async transcribe(req: SttRequest): Promise<SttResult> {
      if (!req || typeof req.audioUri !== 'string' || req.audioUri.trim() === '') {
        throw new VoiceError('INVALID_AUDIO', 'No audio provided for transcription.');
      }
      if (req.signal?.aborted === true) {
        throw new VoiceError('INTERRUPTED', 'Transcription was cancelled before it started.');
      }
      if (!transport) {
        throw new VoiceError(
          'MODEL_UNAVAILABLE',
          'Pakeet transport is not configured yet (voice-session phase). No transcription was attempted.',
        );
      }
      const timeoutMs = req.timeoutMs ?? defaultTimeout;
      const run = (async (): Promise<SttResult> => {
        try {
          const out = await transport(req);
          if (!out || typeof out.text !== 'string') {
            throw new VoiceError('TRANSCRIPTION_FAILED', 'The recognizer returned no text.');
          }
          return { text: out.text };
        } catch (e) {
          if (e instanceof VoiceError) throw e;
          if (req.signal?.aborted === true) {
            throw new VoiceError('INTERRUPTED', 'Transcription was cancelled.');
          }
          throw new VoiceError(
            'TRANSCRIPTION_FAILED',
            e instanceof Error ? e.message : 'Transcription failed.',
          );
        }
      })();
      if (!(timeoutMs > 0)) return run;
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        return await Promise.race([
          run,
          new Promise<SttResult>((_, reject) => {
            timer = setTimeout(
              () => reject(new VoiceError('TIMEOUT', `Transcription timed out after ${timeoutMs} ms.`)),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    },
  };
}
