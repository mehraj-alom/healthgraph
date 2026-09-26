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
- **Hash/checksum:** recorded in Phase 2 (sha256sum of tarball + files).

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
