# HealthGraph Voice Stack — validated pieces (Phase 3 + 4)

Fixed architecture (unchanged): mobile mic → API → server Pakeet →
LangGraph → response text → mobile sanoTTS → speaker. Pakeet stays
server-side; sanoTTS stays mobile-side.

## Pakeet — server-side — verified

`docs/voice/PAKEET.md`. `nvidia/parakeet-tdt-0.6b-v2` via sherpa-onnx
1.13.8, isolated `/opt/healthgraph/voice-pakeet/` on the VPS: 14.2 s
warm load, 1.93 s / 1.10 s inference on 7.43 s audio (RTF 0.26/0.15),
~1 GB RAM, deterministic punctuated English. Internal readiness script,
no public endpoint. CC-BY-4.0 weights + Apache-2.0 runtime.

## sanoTTS — mobile-side — verified

`docs/voice/SANOTTS.md`. Ampixa/sanoTTS @ `18e26b2b`, voice `heartnano`
(English, 294k params, 24 kHz): `front_q8.bin` (109,296 B, sha256
`5553ae5a…4aae0b94`) + `model_q8.bin` (235,936 B, sha256
`4a6cdf0d…987bea88c`) = ~345 KB, committed under
`frontend/assets/voices/heartnano/` (fetch+verify:
`frontend/tools/fetch-satts-voice.sh`).

- Native module `healthgraph-satts` (Android, MIT runtime vendored:
  sanotts.c, snt_nano.c, kernels, host port, own JNI shim): phoneme IDs
  in → WAV file out. No permissions, no text g2p on device.
- Isolated synthesis proven: `"Hello, this is HealthGraph."` → 27
  heartnano phoneme IDs → 2.43 s @24 kHz via the repo Python runtime on
  the same weights (device runs identical math in C).
- Isolated test path: `SattsTest` route (dev-gated entry, disconnected
  from medication calls): load → synthesize → expo-audio playback, with
  timings. Device validation (audible check, repeated synth, interrupt)
  is pending a physical Android run.
- Licenses: MIT runtime; GPL-3.0-tagged weights — settle redistribution
  with legal before Play release. On-device espeak-ng deliberately
  excluded (precomputed IDs for fixed phrases instead).

## Provider interfaces — prepared

- `STTProvider` / `PakeetProvider` (`src/services/voice/stt.ts`):
  audio → transcription; transport injected (lands next phase); missing
  transport → MODEL_UNAVAILABLE; timeout/abort honored.
- `TTSProvider` / `SanoTTSProvider` (`src/services/voice/tts.ts`):
  IDs → audio via native bridge; text without phonemizer →
  G2P_UNAVAILABLE (explicit, never silent); lazy voice load, single
  in-flight guard, timeout/abort honored.
- Errors (`src/services/voice/errors.ts`): MODEL_UNAVAILABLE,
  MODEL_LOAD_FAILED, INVALID_AUDIO, INVALID_INPUT, TRANSCRIPTION_FAILED,
  SYNTHESIS_FAILED, AUDIO_PLAYBACK_FAILED, G2P_UNAVAILABLE, NO_TRANSPORT,
  TIMEOUT, INTERRUPTED. Nothing fabricated, nothing swallowed.
- Tests: `tests/voiceProviders.test.mts` (deterministic, fakes only).

## Voice conversation — NOT YET IMPLEMENTED

No voice-session API/transport, no mic capture path, no LangGraph voice
wiring, no call-flow connection, no streaming, no ElevenLabs. Next phase
only on explicit instruction.
