/* SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Ampixa
 *
 * The sanoTTS inference runtime is MIT; see LICENSE.MIT for the exact file
 * list and why the split is sound. The repository as a whole is GPL-3.0,
 * because the grapheme-to-phoneme layer embeds espeak-ng. This file does not.
 */
/* sanotts.c -- implementation of the binding-friendly API. See sanotts.h. */
#include "sanotts.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "snt_nano.h"

#define SANOTTS_VERSION_STRING "1.0.0"

/* Start well above the ~98 KB a 3 s utterance needs, so the common case never
 * reallocates, and grow from there. The arena is a fixed block plus roughly
 * 196 B per frame; 512 KB covers about 20 s. A phone has the memory, and the
 * alternative -- failing halfway through a long sentence -- is worse. */
#define SANOTTS_ARENA_INITIAL (512u * 1024u)
#define SANOTTS_ARENA_MAX     (16u * 1024u * 1024u)
#define SANOTTS_ERR_LEN 256

struct sanotts {
    void *front;              /* owned only when own_blobs                  */
    void *dec;
    int own_blobs;
    unsigned char *arena;
    size_t arena_size;
    uint64_t seed;
    char err[SANOTTS_ERR_LEN];
};

/* Collects the streaming callback into one growable buffer. The runtime emits
 * per frame and never tells us the total up front, because on a
 * microcontroller nobody would want it buffered at all. */
typedef struct {
    float *pcm;
    int n, cap;
    int oom;
} Collector;

static void set_err(sanotts *t, const char *fmt, ...) {
    if (!t) return;
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(t->err, sizeof t->err, fmt, ap);
    va_end(ap);
}

static int collect_cb(const float *pcm, int n, void *user) {
    Collector *c = (Collector *)user;
    if (c->n + n > c->cap) {
        int cap = c->cap ? c->cap * 2 : 32768;
        while (cap < c->n + n) cap *= 2;
        float *grown = (float *)realloc(c->pcm, (size_t)cap * sizeof(float));
        if (!grown) { c->oom = 1; return 1; }   /* non-zero aborts synthesis */
        c->pcm = grown;
        c->cap = cap;
    }
    memcpy(c->pcm + c->n, pcm, (size_t)n * sizeof(float));
    c->n += n;
    return 0;
}

static void *read_file(const char *path, size_t *len) {
    FILE *fh = fopen(path, "rb");
    if (!fh) return NULL;
    if (fseek(fh, 0, SEEK_END) != 0) { fclose(fh); return NULL; }
    long sz = ftell(fh);
    if (sz <= 0) { fclose(fh); return NULL; }
    rewind(fh);
    /* The kernels require 16-byte-aligned weights; malloc's guarantee is
     * weaker than that on some 32-bit targets, so ask explicitly. */
    void *buf = NULL;
    size_t padded = ((size_t)sz + 15u) & ~(size_t)15u;
    if (posix_memalign(&buf, 16, padded ? padded : 16) != 0) { fclose(fh); return NULL; }
    if (fread(buf, 1, (size_t)sz, fh) != (size_t)sz) { free(buf); fclose(fh); return NULL; }
    fclose(fh);
    if (len) *len = (size_t)sz;
    return buf;
}

static sanotts *alloc_handle(void) {
    sanotts *t = (sanotts *)calloc(1, sizeof(sanotts));
    if (!t) return NULL;
    snprintf(t->err, sizeof t->err, "ok");
    t->seed = 2236265385529901705ULL;   /* the shipped fixture's seed */
    t->arena_size = SANOTTS_ARENA_INITIAL;
    if (posix_memalign((void **)&t->arena, 16, t->arena_size) != 0) {
        t->arena = NULL;
        t->arena_size = 0;
        set_err(t, "could not allocate %u byte arena", SANOTTS_ARENA_INITIAL);
    }
    return t;
}

sanotts *sanotts_open(const char *front_path, const char *dec_path) {
    sanotts *t = alloc_handle();
    if (!t) return NULL;
    if (!front_path || !dec_path) { set_err(t, "null path"); return t; }
    t->front = read_file(front_path, NULL);
    if (!t->front) { set_err(t, "cannot read front blob: %s", front_path); return t; }
    t->dec = read_file(dec_path, NULL);
    if (!t->dec) { set_err(t, "cannot read decoder blob: %s", dec_path); return t; }
    t->own_blobs = 1;
    return t;
}

sanotts *sanotts_open_memory(const void *front, size_t front_len,
                             const void *dec, size_t dec_len) {
    sanotts *t = alloc_handle();
    if (!t) return NULL;
    if (!front || !dec || !front_len || !dec_len) {
        set_err(t, "null or empty weight blob");
        return t;
    }
    /* Borrowed, not copied: an mmap'd bundle resource is already in memory
     * and copying it would double the footprint for nothing. Alignment is
     * the caller's problem here, and it matters -- see read_file. */
    if ((((uintptr_t)front | (uintptr_t)dec) & 15u) != 0) {
        set_err(t, "weight blobs must be 16-byte aligned");
        return t;
    }
    t->front = (void *)front;
    t->dec = (void *)dec;
    t->own_blobs = 0;
    return t;
}

static int speak_impl(sanotts *t, const int32_t *ids, int n_ids,
                      const int32_t *durs, float **pcm, int *n_samples) {
    if (pcm) *pcm = NULL;
    if (n_samples) *n_samples = 0;
    if (!t) return -1;
    if (!t->front || !t->dec) { set_err(t, "voice not loaded"); return -1; }
    if (!t->arena) { set_err(t, "no arena"); return -1; }
    if (!ids || n_ids <= 0) { set_err(t, "no phoneme ids"); return -1; }
    if (!pcm || !n_samples) { set_err(t, "null output pointer"); return -1; }

    for (;;) {
        Collector c;
        memset(&c, 0, sizeof c);
        snt_nano_config cfg;
        memset(&cfg, 0, sizeof cfg);
        cfg.front_blob = t->front;
        cfg.dec_blob = t->dec;
        cfg.arena = t->arena;
        cfg.arena_size = t->arena_size;
        cfg.dur_override = durs;
        cfg.noise_seed = t->seed;

        snt_nano_stats st;
        memset(&st, 0, sizeof st);
        int rc = snt_nano_synthesize(&cfg, ids, n_ids, collect_cb, &c, &st);

        if (rc == 0 && !c.oom) {
            *pcm = c.pcm;
            *n_samples = c.n;
            snprintf(t->err, sizeof t->err, "ok");
            return 0;
        }
        free(c.pcm);
        if (c.oom) { set_err(t, "out of memory buffering %d samples", c.n); return -1; }

        /* A long utterance can outgrow the arena. Rather than make the caller
         * guess a size, double and retry -- the runtime is deterministic, so
         * the retry produces the same audio it would have produced. */
        if (t->arena_size >= SANOTTS_ARENA_MAX) {
            set_err(t, "synthesis failed (rc=%d) at the %zu byte arena limit",
                    rc, t->arena_size);
            return -1;
        }
        size_t grown = t->arena_size * 2;
        if (grown > SANOTTS_ARENA_MAX) grown = SANOTTS_ARENA_MAX;
        unsigned char *bigger = NULL;
        if (posix_memalign((void **)&bigger, 16, grown) != 0) {
            set_err(t, "synthesis failed (rc=%d) and the arena could not grow "
                       "past %zu bytes", rc, t->arena_size);
            return -1;
        }
        free(t->arena);
        t->arena = bigger;
        t->arena_size = grown;
    }
}

int sanotts_speak(sanotts *t, const int32_t *ids, int n_ids,
                  float **pcm, int *n_samples) {
    return speak_impl(t, ids, n_ids, NULL, pcm, n_samples);
}

int sanotts_speak_with_durations(sanotts *t, const int32_t *ids, int n_ids,
                                 const int32_t *durs, float **pcm, int *n) {
    return speak_impl(t, ids, n_ids, durs, pcm, n);
}

void sanotts_free_pcm(float *pcm) { free(pcm); }

void sanotts_close(sanotts *t) {
    if (!t) return;
    if (t->own_blobs) { free(t->front); free(t->dec); }
    free(t->arena);
    free(t);
}

const char *sanotts_last_error(const sanotts *t) {
    return t ? t->err : "null handle";
}

int sanotts_sample_rate(const sanotts *t) { (void)t; return 24000; }

void sanotts_set_seed(sanotts *t, uint64_t seed) { if (t) t->seed = seed; }

size_t sanotts_arena_bytes(const sanotts *t) { return t ? t->arena_size : 0; }

const char *sanotts_version(void) { return SANOTTS_VERSION_STRING; }
