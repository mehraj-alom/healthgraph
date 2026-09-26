/**
 * voiceProviders.test.mts — STT/TTS provider boundary contracts.
 *
 * Deterministic, no patient data, no native modules, no network:
 * - PakeetProvider: valid audio → transcription; invalid → INVALID_AUDIO;
 *   no transport → MODEL_UNAVAILABLE; transport throw → TRANSCRIPTION_FAILED;
 *   timeout → TIMEOUT; abort → INTERRUPTED.
 * - SanoTTSProvider: valid IDs → audio (fake bridge); empty/bad IDs →
 *   INVALID_INPUT; null bridge → MODEL_UNAVAILABLE; load fail →
 *   MODEL_LOAD_FAILED; synth null → SYNTHESIS_FAILED; text without
 *   phonemizer → G2P_UNAVAILABLE; text with injected phonemizer → audio.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceError } from '../src/services/voice/errors.ts';
import { createPakeetProvider } from '../src/services/voice/stt.ts';
import { createSanoTTSProvider, type SattsBridge } from '../src/services/voice/tts.ts';

const VOICE = { frontUri: 'file:///front_q8.bin', modelUri: 'file:///model_q8.bin' };

function fakeBridge(over: Partial<SattsBridge> = {}): SattsBridge & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isAvailable: () => true,
    loadVoices: () => {
      calls.push('loadVoices');
      return true;
    },
    getSampleRate: () => 24000,
    getLastError: () => '',
    synthesize: async (ids: number[]) => {
      calls.push(`synthesize:${ids.length}`);
      return 'file:///cache/satts/t.wav';
    },
    close: () => {},
    ...over,
  };
}

describe('PakeetProvider', () => {
  it('valid audio → transcription via injected transport', async () => {
    const p = createPakeetProvider({ transport: async () => ({ text: 'took my pill' }) });
    assert.equal(p.isAvailable, true);
    const out = await p.transcribe({ audioUri: 'file:///rec.wav' });
    assert.equal(out.text, 'took my pill');
  });

  it('empty audio → INVALID_AUDIO without touching transport', async () => {
    let called = false;
    const p = createPakeetProvider({
      transport: async () => {
        called = true;
        return { text: 'x' };
      },
    });
    await assert.rejects(p.transcribe({ audioUri: '  ' }), (e: unknown) => {
      assert.ok(e instanceof VoiceError && e.code === 'INVALID_AUDIO');
      return true;
    });
    assert.equal(called, false);
  });

  it('missing transport → MODEL_UNAVAILABLE (no silent attempt)', async () => {
    const p = createPakeetProvider();
    assert.equal(p.isAvailable, false);
    await assert.rejects(p.transcribe({ audioUri: 'file:///rec.wav' }), (e: unknown) => {
      assert.ok(e instanceof VoiceError && e.code === 'MODEL_UNAVAILABLE');
      return true;
    });
  });

  it('transport throw → TRANSCRIPTION_FAILED; empty text → TRANSCRIPTION_FAILED', async () => {
    const boom = createPakeetProvider({
      transport: async () => {
        throw new Error('socket reset');
      },
    });
    await assert.rejects(boom.transcribe({ audioUri: 'file:///a.wav' }), (e: unknown) => {
      assert.ok(e instanceof VoiceError && e.code === 'TRANSCRIPTION_FAILED');
      return true;
    });
    const empty = createPakeetProvider({ transport: async () => ({ text: 42 as unknown as string }) });
    await assert.rejects(empty.transcribe({ audioUri: 'file:///a.wav' }), (e: unknown) => {
      assert.ok(e instanceof VoiceError && e.code === 'TRANSCRIPTION_FAILED');
      return true;
    });
  });

  it('hung transport → TIMEOUT; pre-aborted → INTERRUPTED', async () => {
    const hung = createPakeetProvider({ transport: () => new Promise(() => {}) });
    await assert.rejects(hung.transcribe({ audioUri: 'file:///a.wav', timeoutMs: 20 }), (e: unknown) => {
      assert.ok(e instanceof VoiceError && e.code === 'TIMEOUT');
      return true;
    });
    const c = new AbortController();
    c.abort();
    const p = createPakeetProvider({ transport: async () => ({ text: 'x' }) });
    await assert.rejects(p.transcribe({ audioUri: 'file:///a.wav', signal: c.signal }), (e: unknown) => {
      assert.ok(e instanceof VoiceError && e.code === 'INTERRUPTED');
      return true;
    });
  });
});

describe('SanoTTSProvider', () => {
  it('valid IDs → audio URI via bridge (lazy load once)', async () => {
    const bridge = fakeBridge();
    const p = createSanoTTSProvider({
      bridge,
      voice: VOICE,
      stat: async () => ({ size: 116780 }),
    });
    assert.equal(p.isAvailable, true);
    const out = await p.synthesizeIds([1, 22, 42, 2]);
    assert.equal(out.uri, 'file:///cache/satts/t.wav');
    assert.equal(out.sampleRateHz, 24000);
    assert.equal(out.bytes, 116780);
    await p.synthesizeIds([1, 2]);
    assert.equal(
      bridge.calls.filter((c) => c === 'loadVoices').length,
      1,
      'voice loads once across syntheses',
    );
  });

  it('empty/out-of-range IDs → INVALID_INPUT before touching native', async () => {
    const bridge = fakeBridge();
    const p = createSanoTTSProvider({ bridge, voice: VOICE });
    for (const bad of [[], [1, -3], [1, 62], [1, 1.5], new Array(513).fill(1)] as number[][]) {
      await assert.rejects(p.synthesizeIds(bad), (e: unknown) => {
        assert.ok(e instanceof VoiceError && e.code === 'INVALID_INPUT');
        return true;
      });
    }
    assert.ok(!bridge.calls.some((c) => c.startsWith('synthesize:')), 'native never called');
  });

  it('null bridge → MODEL_UNAVAILABLE; load false → MODEL_LOAD_FAILED', async () => {
    const p = createSanoTTSProvider({ bridge: null, voice: VOICE });
    assert.equal(p.isAvailable, false);
    await assert.rejects(p.synthesizeIds([1, 2]), (e: unknown) => {
      assert.ok(e instanceof VoiceError && e.code === 'MODEL_UNAVAILABLE');
      return true;
    });
    const badLoad = createSanoTTSProvider({
      bridge: fakeBridge({ loadVoices: () => false, getLastError: () => 'bad magic' }),
      voice: VOICE,
    });
    await assert.rejects(badLoad.synthesizeIds([1, 2]), (e: unknown) => {
      assert.ok(e instanceof VoiceError && e.code === 'MODEL_LOAD_FAILED');
      assert.match((e as Error).message, /bad magic/);
      return true;
    });
  });

  it('null synth output → SYNTHESIS_FAILED with native detail', async () => {
    const p = createSanoTTSProvider({
      bridge: fakeBridge({ synthesize: async () => null, getLastError: () => 'arena oom' }),
      voice: VOICE,
    });
    await assert.rejects(p.synthesizeIds([1, 2]), (e: unknown) => {
      assert.ok(e instanceof VoiceError && e.code === 'SYNTHESIS_FAILED');
      assert.match((e as Error).message, /arena oom/);
      return true;
    });
  });

  it('text without phonemizer → G2P_UNAVAILABLE; with injected phonemizer → audio', async () => {
    const bridge = fakeBridge();
    const p = createSanoTTSProvider({ bridge, voice: VOICE });
    await assert.rejects(p.synthesizeText('hello'), (e: unknown) => {
      assert.ok(e instanceof VoiceError && e.code === 'G2P_UNAVAILABLE');
      return true;
    });
    const q = createSanoTTSProvider({ bridge, voice: VOICE, phonemize: () => [1, 22, 2] });
    const out = await q.synthesizeText('hello');
    assert.equal(out.uri, 'file:///cache/satts/t.wav');
    await assert.rejects(q.synthesizeText('   '), (e: unknown) => {
      assert.ok(e instanceof VoiceError && e.code === 'INVALID_INPUT');
      return true;
    });
  });
});
