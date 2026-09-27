package com.healthgraph.satts

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * HealthGraphSattsModule — on-device sanoTTS speech (Android).
 *
 * Speech never leaves the device: phoneme IDs in, PCM out, written to a
 * caller-owned WAV file in the app cache. Text→IDs (grapheme-to-phoneme)
 * is intentionally NOT here — the JS layer supplies precomputed IDs
 * (SanoTTSProvider), so no espeak/GPL layer ships on device.
 *
 * synthesize() is async (Expo runs it off the main thread) and blocks only
 * for milliseconds of audio; the JS provider serializes calls anyway.
 */
class HealthGraphSattsModule : Module() {
  private var handle: Long = 0L
  private var lastErrorText: String? = null

  override fun definition() = ModuleDefinition {
    Name("HealthGraphSatts")

    Function("isAvailable") {
      try {
        System.loadLibrary("satts")
        true
      } catch (e: UnsatisfiedLinkError) {
        false
      }
    }

    Function("loadVoices") { frontPath: String, modelPath: String ->
      try {
        System.loadLibrary("satts")
        closeHandle()
        val h = nativeOpen(frontPath, modelPath)
        if (h == 0L) {
          lastErrorText = "native open failed"
          false
        } else {
          handle = h
          true
        }
      } catch (e: Exception) {
        lastErrorText = e.message
        false
      }
    }

    Function("getSampleRate") {
      if (handle == 0L) {
        0
      } else {
        try {
          nativeSampleRate(handle)
        } catch (e: Exception) {
          0
        }
      }
    }

    Function("getLastError") {
      if (handle != 0L) {
        try {
          val native = nativeLastError(handle)
          if (native.isNotEmpty()) return@Function native
        } catch (e: Exception) {
          // Fall through to the cached message.
        }
      }
      lastErrorText ?: "unknown native error"
    }

    // Synthesize phoneme IDs to a 16-bit mono WAV file in the app cache.
    // Returns the file:// URI, or null on failure (see getLastError).
    AsyncFunction("synthesize") { ids: IntArray ->
      if (handle == 0L) {
        lastErrorText = "voices not loaded"
        return@AsyncFunction null
      }
      try {
        val pcm = nativeSpeak(handle, ids) ?: run {
          lastErrorText = nativeLastError(handle)
          return@AsyncFunction null
        }
        val out = File(
          (appContext.reactContext?.cacheDir ?: appContext.cacheDirectory),
          "satts/tts-${System.currentTimeMillis()}.wav",
        )
        out.parentFile?.mkdirs()
        writeWav(out, pcm, nativeSampleRate(handle))
        out.toURI().toString()
      } catch (e: Exception) {
        lastErrorText = e.message
        null
      }
    }

    Function("close") {
      closeHandle()
    }

    OnDestroy {
      closeHandle()
    }
  }

  private fun closeHandle() {
    if (handle != 0L) {
      try {
        nativeClose(handle)
      } catch (e: Exception) {
        // Best-effort native teardown.
      }
      handle = 0L
    }
  }

  private fun writeWav(out: File, pcm: FloatArray, sampleRate: Int) {
    val data = ByteArray(pcm.size * 2)
    val buf = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
    for (v in pcm) {
      val s = (v.coerceIn(-1f, 1f) * 32767f).toInt()
      buf.putShort(s.toShort())
    }
    FileOutputStream(out).use { fs ->
      val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
      header.put("RIFF".toByteArray())
      header.putInt(36 + data.size)
      header.put("WAVE".toByteArray())
      header.put("fmt ".toByteArray())
      header.putInt(16)
      header.putShort(1)
      header.putShort(1)
      header.putInt(sampleRate)
      header.putInt(sampleRate * 2)
      header.putShort(2)
      header.putShort(16)
      header.put("data".toByteArray())
      header.putInt(data.size)
      fs.write(header.array())
      fs.write(data)
    }
  }

  private external fun nativeOpen(front: String, dec: String): Long
  private external fun nativeClose(h: Long)
  private external fun nativeLastError(h: Long): String
  private external fun nativeSampleRate(h: Long): Int
  private external fun nativeSpeak(h: Long, ids: IntArray): FloatArray?
}
