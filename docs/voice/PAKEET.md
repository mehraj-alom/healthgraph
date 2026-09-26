# Pakeet (Parakeet) STT — pinned selection (Phase 1, verified 2026-09-26)

Server-side speech-to-text for short conversational voice turns.
Integration into production is explicitly OUT OF SCOPE (Phase 2 prepares
an isolated environment only; no voice session, no API changes).

## Verified selection

- **Model:** `nvidia/parakeet-tdt-0.6b-v2` — 600M params, FastConformer-TDT,
  English with punctuation/capitalization/word timestamps. Avg WER 6.05
  across 8 HF Open-ASR benchmarks. Source:
  https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2
- **Runtime:** `sherpa-onnx` **1.13.8** (pip, Apache-2.0, bundles ONNX
  Runtime CPU; no torch, no CUDA). Python requirement: `>=3.7` — we use
  **3.11** to match the backend. Source: https://pypi.org/pypi/sherpa-onnx/
- **Weights (CPU int8 build):** official sherpa-onnx release package
  `sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8` (`model-type nemo_transducer`):
  encoder.int8 + decoder.int8 + joiner.int8 + tokens.txt, ~640 MB total.
  Source: https://github.com/k2-fsa/sherpa-onnx/releases (tag `asr-models`)
  Docs: https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo/parakeet-tdt-0.6b-v2.html
- **Model size:** ~640 MB on disk (measured value recorded in Phase 2).
- **Python requirement:** 3.11 (venv, isolated from the backend).
- **System requirements:** Linux x86_64 with glibc, pip, ~2 GB free disk
  for download + unpack. No GPU, no CUDA, no torch, no compiler.
- **RAM requirement:** ~600 MB to load (maintainer-measured) + working set
  during inference; budget **1.5 GB** for the warm process.
  Reference: https://github.com/k2-fsa/sherpa-onnx/issues/2626
- **CPU/GPU requirement:** CPU-only. 2 vCPU is sufficient for short
  (<30 s) conversational turns; GPU explicitly not required.
- **License:** weights **CC-BY-4.0** (commercial use allowed, attribution
  to NVIDIA required); sherpa-onnx runtime **Apache-2.0**. No redistribution
  of the upstream `.nemo` bundle — we ship only the sherpa int8 conversion,
  which inherits CC-BY-4.0.
- **Download source:** `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2`
- **Hash/checksum (measured 2026-09-26):**
  tarball (482,468,385 bytes): `157c157bc51155e03e37d2466522a3a737dd9c72bb25f36eb18912964161e1ad`
  unpacked `models/` (631 MB): encoder.int8.onnx 652,184,296 B, decoder.int8.onnx 7,257,753 B,
  joiner.int8.onnx 1,739,080 B, tokens.txt 9,384 B, test_wavs/0.wav (7.43 s, 16 kHz).

## Rejected alternative

NeMo toolkit (`nemo_toolkit[asr]`, full 2.47 GB `.nemo`, torch + CUDA
stack, GPU-oriented): wrong shape for a CPU-only VPS sidecar. The int8
ONNX build is the smallest practical package with benchmark-grade
English transcription. (v3 multilingual rejected: larger scope than our
English-first voice turns need.)

## VPS fit (pre-test estimate)

2 vCPU / 7.8 GB RAM with ~5.9 GB available: the warm sidecar (~1.5 GB
budget) fits alongside api/workers/beat/db/redis. Short-turn CPU latency
is measured in Phase 2; architecture unchanged regardless of outcome.

## Phase 2 measurements (2026-09-26, isolated `/opt/healthgraph/voice-pakeet/`)

venv (host Python **3.10** — 3.11 exists only inside the backend
containers; the isolated env has no dependency on backend Python) +
`sherpa-onnx==1.13.8` + numpy. Test input: the package's own
`test_wavs/0.wav` (7.43 s English, non-sensitive by design). No backend,
Postgres, Redis, or API file touched; production containers stayed
healthy throughout.

- Model download size: 460 MB tarball → 631 MB unpacked
- Model load time: 14.2 s (warm process; load once, transcribe many)
- RAM after load: 934 MB; peak during inference 1,064 MB (max RSS)
- CPU usage: 108% of one core during inference (2 threads configured)
- Test audio duration: 7.43 s
- Transcription latency: 1.93 s cold / 1.10 s warm (RTF 0.26 / 0.15)
- Transcription result (deterministic across runs):
  "Well, I don't wish to see it any more, observed Phebe, turning away
  her eyes. It is certainly very like the old portrait."
- Internal readiness (`scripts/readiness.sh`, manual over SSH, no endpoint):
  Pakeet process OK, Model loaded OK, Transcription OK.

Verdict: the current VPS (2 vCPU / 7.8 GB, ~4–5.5 GB free alongside the
stack) runs Pakeet reliably for short voice turns — ~1 GB steady-state,
faster-than-real-time CPU inference, zero impact on the existing
api/workers/beat/db/redis observed during testing.
