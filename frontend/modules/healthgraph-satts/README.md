# healthgraph-satts

On-device sanoTTS speech for HealthGraph (Android Expo native module).

- Phoneme IDs in → PCM WAV file out. No text phonemization on device.
- Runtime vendored from Ampixa/sanoTTS @ `18e26b2b` (MIT files only —
  see THIRD_PARTY_NOTICES.md). Voice weights: heartnano (~345 KB).
- Playback reuses `expo-audio` (already an app dependency).
- Disconnected from production flows: used only by SanoTTSProvider and
  the isolated voice test screen until the voice-session phase.
