# sanoTTS — pinned selection (Phase 3.1, verified 2026-09-26)

Mobile-side neural TTS for HealthGraph. Server Pakeet stays server-side;
sanoTTS stays mobile-side. No voice session is implemented here.

## Verified selection (official sources)

- **Project:** `Ampixa/sanoTTS` — "sano" = small (Nepali); ~1.4M-param
  neural TTS family (294k–2.3M params). Source:
  https://github.com/Ampixa/sanoTTS
- **Version/commit:** master `18e26b2b` (merge PR #17, latest at research
  time). Pin this commit for any vendored file.
- **Voice:** `heartnano` (English, Kokoro af_heart lineage, espeak-ng IPA
  frontend, 62-symbol vocab, 24 kHz) — the only voice with a prebuilt
  mobile int8 pack. Files: `front_q8.bin` (109,296 B) + `model_q8.bin`
  (235,936 B) = **~345 KB total**, 294,279 params. manifest sha256:
  front `5553ae5a…4aae0b94`, dec `4a6cdf0d…987bea88c` (full hashes in
  `heartnano/meta.json`). Source: https://huggingface.co/ampixa/sanoTTS
- **Mobile runtime:** `mobile/` C library (`sanotts.c/.h`) + Kotlin JNI
  (`sanotts_jni.c`, `SanoTTS.kt`) → `libsanotts.so` via
  `mobile/CMakeLists.txt` (CMake ≥3.18, C99). API: open(front, model) →
  speak(ids) → 24 kHz mono float PCM → close; arena ~98 KB for 3 s.
  iOS via `build_ios.sh` (52 KB static lib, simulator+device verified by
  upstream; not run on physical device by upstream either).
- **Supported Android runtime:** arm64/x86_64 `.so` through app CMake
  externalNativeBuild; playback via platform `AudioTrack` (upstream
  sample) — HealthGraph reuses `expo-audio` instead (already a dep).
- **React Native compatibility:** none out of the box — a thin Expo
  TurboModule bridge is required (same pattern as healthgraph-ppg/rppg).
  No RN/Expo binding exists upstream.
- **Expo/RN compatibility:** neutral C99 + JNI; no Gradle plugin needed
  beyond the app's own `externalNativeBuild` (or module-local CMake).
  Compatible with Expo SDK 57 / RN 0.86 / NDK 27 (pure C, no STL).
- **Native dependencies:** Android NDK + CMake only. No torch, no ONNX,
  no espeak on device (see phonemization note).
- **Model/voice size:** ~345 KB (both bins) + ~52–200 KB `.so`.
- **CPU/RAM:** upstream-measured RTF ~0.003 phone-class (≈3 ms per audio
  second); working set ~98 KB. Negligible next to the 1 GB Pakeet sidecar.
- **Android requirements:** minSdk 24 satisfied (JNI + AudioTrack-level
  APIs only); arm64 primary, x86_64 emulator slice free via same CMake.
- **Runtime license:** **MIT** — `sanotts.c/.h`, `mcu/src/snt_nano.c`,
  JNI + Kotlin + CMakeLists all carry `SPDX-License-Identifier: MIT`
  (upstream: "The sanoTTS inference runtime is MIT").
- **Weights license:** upstream HF repo tagged **GPL-3.0**; mobile README
  warns GPL/App-Store conflict and says dropping on-device espeak "removes
  half the copyleft — the rest depends on what runtime and weights derive
  from". Play Store distribution of GPL weights is possible with
  corresponding-source compliance, but **settle with legal before release**.
- **Commercial redistribution:** MIT runtime = unrestricted; GPL weights =
  allowed commercially under GPL-3.0 terms (source offer for the conveyed
  work). No per-character billing, no API keys, no network.
- **Critical constraint:** the runtime takes **phoneme IDs, not text**.
  No g2p on device. Options per upstream: (1) build espeak-ng for Android
  (real work, GPL layer), (2) precompute IDs at build time for fixed
  phrases (zero cost — used for the Phase 3 test vector), (3) server-side
  phonemization (defeats on-device purpose — rejected).

## Selected for HealthGraph Phase 3

Voice `heartnano` + MIT mobile runtime + Expo TurboModule bridge +
expo-audio playback + build-time precomputed phoneme IDs for the isolated
test phrase. Arbitrary-text g2p (espeak-ng Android build) is documented
remaining work for the voice-session phase, not this one.
