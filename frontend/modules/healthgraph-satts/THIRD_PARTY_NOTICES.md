# Third-party notices — healthgraph-satts

## Inference runtime (MIT)

Vendored from Ampixa/sanoTTS @ 18e26b2b
(https://github.com/Ampixa/sanoTTS), files carrying
`SPDX-License-Identifier: MIT` and listed in upstream LICENSE.MIT:

- mobile/sanotts.c, mobile/sanotts.h
- mcu/src/snt_nano.c, mcu/src/snt_kernels_ref.c
- mcu/ports/host/snt_port_host.c
- mcu/include/snt_nano.h, mcu/include/snt_port.h
- mcu/models/en_us_e13b/nano_q8_meta.h (heartnano offsets header,
  same lineage)

Copyright (c) 2026 Ampixa. MIT License — see upstream LICENSE.MIT.

## Voice weights (heartnano)

`front_q8.bin` + `model_q8.bin` from https://huggingface.co/ampixa/sanoTTS
(heartnano package, sha256-verified at fetch time — see
frontend/tools/fetch-satts-voice.sh). Upstream repository tagged
GPL-3.0; settle redistribution terms with legal before Play release.
