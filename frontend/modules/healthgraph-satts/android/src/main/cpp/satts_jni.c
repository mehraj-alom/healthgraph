/* HealthGraph sanoTTS JNI shim (original work, MIT).
 *
 * Thin bridge between HealthGraphSattsModule.kt and the vendored sanoTTS
 * runtime (Ampixa/sanoTTS mobile/, MIT — see THIRD_PARTY_NOTICES.md).
 * Speech stays on-device: PCM is synthesized in native memory and
 * returned to Kotlin, which writes the caller-owned WAV file.
 */
#include <jni.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "sanotts.h"

#define JNI_CAT(a, b) a##b
#define JNI_PASTE(a, b) JNI_CAT(a, b)
#define NS(name) \
    JNI_PASTE(Java_com_healthgraph_satts_HealthGraphSattsModule_, name)

JNIEXPORT jlong JNICALL NS(nativeOpen)(JNIEnv *env, jobject self,
                                       jstring front, jstring dec) {
    (void)self;
    const char *f = (*env)->GetStringUTFChars(env, front, NULL);
    const char *d = (*env)->GetStringUTFChars(env, dec, NULL);
    sanotts *t = sanotts_open(f, d);
    (*env)->ReleaseStringUTFChars(env, front, f);
    (*env)->ReleaseStringUTFChars(env, dec, d);
    return (jlong)(intptr_t)t;
}

JNIEXPORT void JNICALL NS(nativeClose)(JNIEnv *env, jobject self, jlong h) {
    (void)env;
    (void)self;
    sanotts_close((sanotts *)(intptr_t)h);
}

JNIEXPORT jstring JNICALL NS(nativeLastError)(JNIEnv *env, jobject self, jlong h) {
    (void)self;
    const char *msg = sanotts_last_error((sanotts *)(intptr_t)h);
    return (*env)->NewStringUTF(env, msg ? msg : "unknown native error");
}

JNIEXPORT jint JNICALL NS(nativeSampleRate)(JNIEnv *env, jobject self, jlong h) {
    (void)env;
    (void)self;
    return (jint)sanotts_sample_rate((sanotts *)(intptr_t)h);
}

/* Returns null on failure; Kotlin reads nativeLastError for the reason. */
JNIEXPORT jfloatArray JNICALL NS(nativeSpeak)(JNIEnv *env, jobject self,
                                              jlong h, jintArray ids) {
    (void)self;
    sanotts *t = (sanotts *)(intptr_t)h;
    const jsize n = (*env)->GetArrayLength(env, ids);
    jint *raw = (*env)->GetIntArrayElements(env, ids, NULL);

    float *pcm = NULL;
    int n_out = 0;
    /* jint is int32_t on every Android ABI. */
    const int rc = sanotts_speak(t, (const int32_t *)raw, (int)n, &pcm, &n_out);
    (*env)->ReleaseIntArrayElements(env, ids, raw, JNI_ABORT);
    if (rc != 0 || !pcm || n_out <= 0) {
        if (pcm) sanotts_free_pcm(pcm);
        return NULL;
    }

    jfloatArray out = (*env)->NewFloatArray(env, n_out);
    if (out) (*env)->SetFloatArrayRegion(env, out, 0, n_out, pcm);
    sanotts_free_pcm(pcm);
    return out;
}
