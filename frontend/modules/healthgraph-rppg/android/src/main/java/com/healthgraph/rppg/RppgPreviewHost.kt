package com.healthgraph.rppg

import android.os.Handler
import android.os.Looper
import androidx.camera.core.Preview
import java.lang.ref.WeakReference

/**
 * Registry bridging the CameraX [Preview] use case (owned by
 * HealthGraphRPPGModule during a capture) and any mounted
 * [RppgCameraPreviewView] instances.
 *
 * No frames, bitmaps, or pixels ever pass through here — only the
 * CameraX Preview use case handle, which renders directly into the
 * view's SurfaceView via the GPU/display pipeline.
 */
internal object RppgPreviewHost {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val lock = Any()
  private val views = mutableSetOf<RppgCameraPreviewView>()

  @Volatile
  private var activePreview: Preview? = null

  fun register(view: RppgCameraPreviewView) {
    val current: Preview?
    synchronized(lock) {
      views.add(view)
      current = activePreview
    }
    attachOnMain(view, current)
  }

  fun unregister(view: RppgCameraPreviewView) {
    synchronized(lock) {
      views.remove(view)
    }
  }

  fun publish(preview: Preview?) {
    val snapshot: List<RppgCameraPreviewView>
    synchronized(lock) {
      activePreview = preview
      snapshot = views.toList()
    }
    for (view in snapshot) attachOnMain(view, preview)
  }

  private fun attachOnMain(view: RppgCameraPreviewView, preview: Preview?) {
    val ref = WeakReference(view)
    mainHandler.post { ref.get()?.attachPreview(preview) }
  }
}
