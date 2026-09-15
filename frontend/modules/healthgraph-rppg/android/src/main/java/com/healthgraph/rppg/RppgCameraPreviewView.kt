package com.healthgraph.rppg

import android.content.Context
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.widget.LinearLayout
import androidx.annotation.UiThread
import androidx.camera.core.Preview
import androidx.core.content.ContextCompat
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Genuine live front-camera preview surface for face rPPG.
 *
 * Rendered by the SAME CameraX Preview use case that is bound alongside the
 * ImageAnalysis use case to the SAME front camera in HealthGraphRPPGModule —
 * never a second camera, never screenshots, never frames over the JS bridge.
 *
 * Privacy: no pixel data is readable from here by JS or retained anywhere.
 * The SurfaceView is a display-only endpoint.
 */
class RppgCameraPreviewView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {

  private val surfaceView = SurfaceView(context)

  @Volatile
  private var preview: Preview? = null

  @Volatile
  private var lastBoundPreview: Preview? = null

  @Volatile
  private var surfaceAvailable = false

  private val mainExecutor = ContextCompat.getMainExecutor(context)

  init {
    addView(
      surfaceView,
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.MATCH_PARENT,
      ),
    )
    surfaceView.holder.addCallback(
      object : SurfaceHolder.Callback {
        override fun surfaceCreated(holder: SurfaceHolder) {
          surfaceAvailable = true
          bindIfReady()
        }

        override fun surfaceChanged(
          holder: SurfaceHolder,
          format: Int,
          width: Int,
          height: Int,
        ) {
          // No-op: CameraX adapts to the surface buffer size itself.
        }

        override fun surfaceDestroyed(holder: SurfaceHolder) {
          surfaceAvailable = false
        }
      },
    )
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    RppgPreviewHost.register(this)
  }

  override fun onDetachedFromWindow() {
    RppgPreviewHost.unregister(this)
    clearProvider()
    super.onDetachedFromWindow()
  }

  /**
   * Attach (or detach, when null) the active CameraX Preview. Always invoked
   * on the main thread via [RppgPreviewHost].
   */
  fun attachPreview(next: Preview?) {
    preview = next
    if (next == null) {
      clearProvider()
    } else {
      bindIfReady()
    }
  }

  @UiThread
  private fun bindIfReady() {
    val current = preview ?: return
    if (!surfaceAvailable) return
    val last = lastBoundPreview
    if (last != null && last !== current) {
      try {
        last.setSurfaceProvider(null)
      } catch (_: Exception) {
      }
    }
    lastBoundPreview = current
    current.setSurfaceProvider(mainExecutor) { request ->
      val surface = surfaceView.holder.surface
      if (surface == null || !surface.isValid) {
        request.willNotProvideSurface()
        return@setSurfaceProvider
      }
      request.provideSurface(surface, mainExecutor) { }
    }
  }

  @UiThread
  private fun clearProvider() {
    preview = null
    val last = lastBoundPreview
    lastBoundPreview = null
    if (last != null) {
      try {
        last.setSurfaceProvider(null)
      } catch (_: Exception) {
      }
    }
  }
}
