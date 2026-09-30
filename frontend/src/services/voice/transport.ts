/**
 * Pakeet HTTP transport (Phase 5 voice integration).
 *
 * Implements SttTransport over the existing authenticated API client:
 * multipart audio upload → POST /api/v1/voice/transcribe → {text}.
 * Auth headers, patient scoping, and rate limits are the backend's existing
 * machinery — this file adds no auth, no storage, no session state.
 */

import { api } from '@/services/api';
import { File } from 'expo-file-system';
import type { SttTransport } from './stt';
import { VoiceError } from './errors';

/**Backend voice caps (mirrored client-side for fast, honest failures). */
export const VOICE_TURN_MAX_BYTES = 5 * 1024 * 1024;

export function createPakeetTransport(options?: { timeoutMs?: number }): SttTransport {
  return async (req) => {
    // Pre-flight: a turn read while still recording (or after release) is a
    // 0-byte/stale handle — the POST then fails in ~100ms as ERR_NETWORK
    // NO_RESPONSE. Fail honestly here instead.
    try {
      const info = await new File(req.audioUri).info();
      if (!info.exists || (info.size !== undefined && info.size === 0)) {
        throw new VoiceError('INVALID_AUDIO', 'No recording was captured.');
      }
      if (info.size !== undefined && info.size > VOICE_TURN_MAX_BYTES) {
        throw new VoiceError('INVALID_AUDIO', 'Voice turn too large (5 MB max). Record a shorter turn.');
      }
    } catch (e) {
      if (e instanceof VoiceError) throw e;
      // info() itself failed (released handle, missing file) — same cause.
      throw new VoiceError('INVALID_AUDIO', 'No recording was captured.');
    }
    const formData = new FormData();
    formData.append('file', {
      uri: req.audioUri,
      name: 'turn.m4a',
      type: 'audio/mp4',
    } as unknown as Blob);
    let response;
    try {
      // Do NOT set Content-Type manually — Axios generates the multipart
      // boundary (same contract as document upload).
      response = await api.getClient().post<{ text?: unknown }>(
        '/api/v1/voice/transcribe',
        formData,
        { timeout: options?.timeoutMs ?? req.timeoutMs ?? 90_000 },
      );
    } catch (e: unknown) {
      if (e instanceof VoiceError) throw e;
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 400) {
        throw new VoiceError('INVALID_AUDIO', 'That recording could not be read. Try again.');
      }
      if (status === 413) {
        throw new VoiceError('INVALID_AUDIO', 'Voice turn too large (5 MB max). Record a shorter turn.');
      }
      if (status === 502) {
        throw new VoiceError('TRANSCRIPTION_FAILED', 'Voice transcription failed for this turn. Try again.');
      }
      if (status === 503) {
        throw new VoiceError('MODEL_UNAVAILABLE', 'Voice transcription is unavailable right now. Try again later.');
      }
      if (status === 401 || status === 403) {
        throw new VoiceError('TRANSCRIPTION_FAILED', 'Your session expired. Sign in again and retry.');
      }
      throw new VoiceError(
        'TRANSCRIPTION_FAILED',
        e instanceof Error ? e.message : 'Voice upload failed.',
      );
    }
    const text = (response.data as { text?: unknown })?.text;
    if (typeof text !== 'string') {
      throw new VoiceError('TRANSCRIPTION_FAILED', 'The recognizer returned no text.');
    }
    return { text };
  };
}
