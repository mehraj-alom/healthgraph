#!/usr/bin/env python3
"""Pakeet sidecar (internal only — Phase 5 voice transport).

Stdlib-only HTTP server on 127.0.0.1:8477. Loads the int8 model ONCE at
startup and keeps it warm; the backend (authenticated) proxies short voice
turns here. No auth of its own: localhost-only binding is the boundary
(UFW denies 8477 externally — verified at deploy). No DB, no Redis, no log
of audio content (durations + sizes only).

  GET  /healthz     -> {"ok": true, "loaded": bool}
  POST /transcribe  -> raw body (wav/m4a/aac/webm, <=5MB) decodes via
                       ffmpeg to 16kHz mono and returns {"text": ...}
"""
import json
import os
import subprocess
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import sherpa_onnx

MODEL_DIR = os.environ.get(
    'MODEL_DIR',
    '/opt/healthgraph/voice-pakeet/models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
)
BIND = os.environ.get('PAKEET_BIND', '127.0.0.1')
PORT = int(os.environ.get('PAKEET_PORT', '8477'))
MAX_BYTES = 5 * 1024 * 1024
MAX_AUDIO_S = 60.0

recognizer: 'sherpa_onnx.OfflineRecognizer | None' = None


def load_model() -> 'sherpa_onnx.OfflineRecognizer':
    global recognizer
    if recognizer is None:
        recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=f'{MODEL_DIR}/encoder.int8.onnx',
            decoder=f'{MODEL_DIR}/decoder.int8.onnx',
            joiner=f'{MODEL_DIR}/joiner.int8.onnx',
            tokens=f'{MODEL_DIR}/tokens.txt',
            num_threads=2,
            sample_rate=16000,
            feature_dim=80,
            model_type='nemo_transducer',
        )
    return recognizer


def decode_to_wav(raw: bytes) -> tuple[str, float]:
    """ffmpeg -> 16kHz mono s16 wav temp file. Returns (path, seconds)."""
    tmp_in = tempfile.NamedTemporaryFile(suffix='.in', delete=False)
    tmp_in.write(raw)
    tmp_in.close()
    tmp_out = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    tmp_out.close()
    try:
        subprocess.run(
            ['ffmpeg', '-y', '-v', 'error', '-i', tmp_in.name,
             '-ar', '16000', '-ac', '1', '-f', 'wav', tmp_out.name],
            timeout=30, check=True,
        )
    finally:
        try:
            import os
            os.unlink(tmp_in.name)
        except OSError:
            pass
    import wave
    with wave.open(tmp_out.name, 'rb') as w:
        seconds = w.getnframes() / w.getframerate()
    return tmp_out.name, seconds


class Handler(BaseHTTPRequestHandler):
    server_version = 'PakeetSidecar/1'

    def log_message(self, *args):  # quiet: journald gets startup/errors only
        pass

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/healthz':
            self._json(200, {'ok': True, 'loaded': recognizer is not None})
        else:
            self._json(404, {'error': 'not found'})

    def do_POST(self):
        if self.path != '/transcribe':
            self._json(404, {'error': 'not found'})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BYTES:
            self._json(413, {'error': 'audio too large (5MB max)'})
            return
        raw = self.rfile.read(length)
        t0 = time.perf_counter()
        try:
            wav_path, seconds = decode_to_wav(raw)
        except Exception:
            self._json(400, {'error': 'undecodable audio'})
            return
        if seconds > MAX_AUDIO_S:
            self._json(413, {'error': 'audio too long (60s max)'})
            return
        try:
            import wave
            import numpy as np
            with wave.open(wav_path, 'rb') as w:
                frames = w.readframes(w.getnframes())
            audio = np.frombuffer(frames, dtype=np.int16).astype('float32') / 32768.0
            stream = recognizer.create_stream()  # type: ignore[union-attr]
            stream.accept_waveform(16000, audio)
            recognizer.decode_stream(stream)  # type: ignore[union-attr]
            text = stream.result.text.strip()
        except Exception:
            self._json(500, {'error': 'inference failed'})
            return
        finally:
            try:
                import os
                os.unlink(wav_path)
            except OSError:
                pass
        self._json(200, {'text': text, 'infer_s': round(time.perf_counter() - t0, 2)})


if __name__ == '__main__':
    load_model()
    print(f'pakeet sidecar warm on {BIND}:{PORT}', flush=True)
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()
