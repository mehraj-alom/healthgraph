#!/bin/bash
# Fetch + verify the heartnano sanoTTS voice pack (explicit preparation
# mechanism — rerun to refresh; committed bins stay byte-identical).
# Usage: bash frontend/tools/fetch-satts-voice.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../assets/voices/heartnano"
BASE="https://huggingface.co/ampixa/sanoTTS/resolve/main/heartnano"
mkdir -p "$OUT"
curl -sL -o "$OUT/meta.json" "$BASE/meta.json"
FRONT_SHA=$(python3 -c "import json; print(json.load(open('$OUT/meta.json'))['front_sha256'])")
DEC_SHA=$(python3 -c "import json; print(json.load(open('$OUT/meta.json'))['dec_sha256'])")
curl -sL -o "$OUT/front_q8.bin" "$BASE/front_q8.bin"
curl -sL -o "$OUT/model_q8.bin" "$BASE/model_q8.bin"
echo "$FRONT_SHA  $OUT/front_q8.bin" | sha256sum -c -
echo "$DEC_SHA  $OUT/model_q8.bin" | sha256sum -c -
ls -la "$OUT"
