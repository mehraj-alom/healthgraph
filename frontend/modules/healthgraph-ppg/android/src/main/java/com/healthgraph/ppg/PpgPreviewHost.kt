package com.healthgraph.ppg

import android.os.Handler
import android.os.Looper
import androidx.camera.core.Preview
import java.lang.ref.WeakReference

/**
 * Registry bridging the CameraX [Preview] use case (owned by
 * HealthGraphPPGModule during a measurement) and any mounted
 * [PpgCameraPreviewView] instances.
 *
 * - The module publishes the active Preview on bind and null on unbind.
 * - Views register on attach and unregister on detach; the current Preview
 *   is pushed to them on the main thread.
 * - No frames, bitmaps, or pixels ever pass through here — only the
 *   CameraX Preview use case handle, which renders directly into the
 *   view's SurfaceView via the GPU/display pipeline.
 */
internal object PpgPreviewHost {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val lock = Any()
  private val views = mutableSetOf<PpgCameraPreviewView>()

  @Volatile
  private var activePreview: Preview? = null

  fun register(view: PpgCameraPreviewView) {
    val current: Preview?
    synchronized(lock) {
      views.add(view)
      current = activePreview
    }
    attachOnMain(view, current)
  }

  fun unregister(view: PpgCameraPreviewView) {
    synchronized(lock) {
      views.remove(view)
    }
  }

  fun publish(preview: Preview?) {
    val snapshot: List<PpgCameraPreviewView>
    synchronized(lock) {
      activePreview = preview
      snapshot = views.toList()
    }
    for (view in snapshot) attachOnMain(view, preview)
  }

  private fun attachOnMain(view: PpgCameraPreviewView, preview: Preview?) {
    val ref = WeakReference(view)
    mainHandler.post { ref.get()?.attachPreview(preview) }
  }
}
