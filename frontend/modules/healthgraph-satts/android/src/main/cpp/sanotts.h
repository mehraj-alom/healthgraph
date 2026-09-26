/* SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Ampixa
 *
 * The sanoTTS inference runtime is MIT; see LICENSE.MIT for the exact file
 * list and why the split is sound. The repository as a whole is GPL-3.0,
 * because the grapheme-to-phoneme layer embeds espeak-ng. This file does not.
 */
/* sanotts.h -- a small, binding-friendly C API over the sanoTTS nano runtime.
 *
 * snt_nano.h is an embedded interface: the caller owns an arena, hands over
 * two weight blobs, supplies a noise seed, and receives PCM through a
 * streaming callback. That is exactly right on a microcontroller and exactly
 * wrong to bind from Swift, Kotlin or Dart.
 *
 * This layer keeps the same runtime and adds nothing to the maths. It owns
 * the arena and the weights, buffers the whole waveform, and exposes an
 * opaque handle plus plain scalars -- the shape that Dart FFI, JNI and a
 * Swift module map all consume without glue code.
 *
 *   sanotts *tts = sanotts_open("front_q8.bin", "model_q8.bin");
 *   float *pcm; int n;
 *   sanotts_speak(tts, ids, n_ids, &pcm, &n);
 *   ... play n samples at sanotts_sample_rate(tts) ...
 *   sanotts_free_pcm(pcm);
 *   sanotts_close(tts);
 *
 * Threading: a handle is NOT thread-safe; give each thread its own, or
 * serialise. Opening twice costs another arena but the weight blobs are
 * per-handle too, so prefer one handle reused.
 *
 * Input is phoneme ids, not text. This library does no G2P -- see
 * mobile/README.md for why, and what to do about it.
 */
#ifndef SANOTTS_H
#define SANOTTS_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct sanotts sanotts;

/* Open a voice from two files on disk. Returns NULL only if the handle
 * itself could not be allocated; every other failure is reported by
 * sanotts_last_error() on the returned handle, so an FFI caller always has
 * something to show a user. */
sanotts *sanotts_open(const char *front_path, const char *dec_path);

/* Open from memory the caller owns and outlives the handle -- for weights
 * mmap'd from an app bundle or an Android asset, with no copy. */
sanotts *sanotts_open_memory(const void *front, size_t front_len,
                             const void *dec, size_t dec_len);

/* 0 on success. On success *pcm points to *n_samples floats in [-1, 1] that
 * the caller frees with sanotts_free_pcm. On failure *pcm is NULL and
 * sanotts_last_error() explains why. */
int sanotts_speak(sanotts *tts, const int32_t *phoneme_ids, int n_ids,
                  float **pcm, int *n_samples);

/* As sanotts_speak, but with fixed per-phoneme frame counts instead of the
 * duration model's prediction. Golden tests need this; apps do not. */
int sanotts_speak_with_durations(sanotts *tts, const int32_t *phoneme_ids,
                                 int n_ids, const int32_t *durations,
                                 float **pcm, int *n_samples);

void sanotts_free_pcm(float *pcm);
void sanotts_close(sanotts *tts);

/* Never NULL, and valid until the next call on this handle. */
const char *sanotts_last_error(const sanotts *tts);

int sanotts_sample_rate(const sanotts *tts);

/* The decoder is noise-fed, so the same text with a different seed is a
 * different (equally valid) waveform. Fixed by default, so a given input is
 * reproducible; set your own to vary it, or to match a golden fixture. */
void sanotts_set_seed(sanotts *tts, uint64_t seed);

/* Working memory in bytes. Grows on demand as utterances get longer; this
 * reports the current allocation, which is useful on memory-tight platforms
 * and in bug reports. */
size_t sanotts_arena_bytes(const sanotts *tts);

/* "1.0.0" -- so a binding can assert what it linked against. */
const char *sanotts_version(void);

#ifdef __cplusplus
}
#endif
#endif
