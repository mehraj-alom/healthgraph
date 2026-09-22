package com.healthgraph.rppg

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.Size
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.ArrayDeque
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.abs
import kotlin.math.min

/**
 * HealthGraphRPPG native module (Android).
 *
 * Front-camera guide-ROI capture for face rPPG. Each frame is reduced to
 * ROI statistics (brightness, skin-ratio, motion) computed directly from
 * the YUV planes; qualified frames are cropped/resized to 128x128 BGR and
 * held in a bounded 160-frame ring. On seal, the ring is written to a
 * cache file (RPPG window v1) and only the file URI + scalar summary cross
 * the JS bridge. No frames, video, or pixels leave the device.
 *
 * No torch/flash (front camera), no ML frameworks, no network.
 */
class HealthGraphRPPGModule : Module() {
  companion object {
    private const val TAG = "HealthGraphRPPG"
    private const val WINDOW_FRAMES = 160
    private const val ROI_SIZE = 128
    /** Centered square guide: fraction of the smaller frame dimension. */
    private const val GUIDE_FRAC = 0.6f
    /** Presence gates on ROI statistics. */
    private const val BRIGHT_MIN = 40.0
    private const val BRIGHT_MAX = 225.0
    private const val SKIN_MIN = 0.22
    /** Frame-to-frame ROI change below this counts as stable. */
    private const val MOTION_STABLE_THR = 6.0
    /** Consecutive stable frames before the ring starts filling. */
    private const val STABLE_WARMUP = 6
    /** Consecutive absent frames before the ring resets (~1s at 30fps). */
    private const val ABSENT_RESET = 30
    /** Telemetry heartbeat interval while capturing. */
    private const val TELEMETRY_MS = 500L
  }

  private val cameraExecutor = Executors.newSingleThreadExecutor()
  private val isCapturing = AtomicBoolean(false)
  private var cameraProvider: ProcessCameraProvider? = null
  @Volatile private var boundCamera: Camera? = null
  private val mainHandler = Handler(Looper.getMainLooper())
  private val cancelRequested = AtomicBoolean(false)
  private val runId = AtomicLong(0)
  /**
   * The in-flight startCapture promise. cancelCapture must settle it
   * (CANCELLED) — otherwise the JS await hangs forever holding its closure.
   * Nulled on every terminal path (seal/fail/cancel) so a later cancel never
   * touches an already-settled promise.
   */
  @Volatile private var pendingPromise: Promise? = null

  private fun dlog(msg: String) {
    if (BuildConfig.DEBUG) Log.d(TAG, msg)
  }

  override fun definition() = ModuleDefinition {
    Name("HealthGraphRPPG")

    Events("HealthGraphRPPGState")

    /**
     * Genuine live front-camera preview surface. Rendered by the CameraX
     * Preview use case bound alongside ImageAnalysis to the SAME front
     * camera — never a second camera, never frames over the bridge.
     */
    View(RppgCameraPreviewView::class) {
    }

    AsyncFunction("startCapture") { options: Map<String, Any?>, promise: Promise ->
      val timeoutSeconds = ((options["timeoutSeconds"] as? Number)?.toInt() ?: 30).coerceIn(10, 60)
      if (!isCapturing.compareAndSet(false, true)) {
        promise.reject("IN_PROGRESS", "An rPPG capture is already running", null)
        return@AsyncFunction
      }
      val myRun = runId.incrementAndGet()
      cancelRequested.set(false)
      Log.w(TAG, "rppg stage: startCapture invoked run=$myRun timeout=${timeoutSeconds}s")
      sendEvent("HealthGraphRPPGState", mapOf("state" to "STARTING"))
      startCaptureRun(timeoutSeconds, promise, myRun)
    }

    AsyncFunction("cancelCapture") { promise: Promise ->
      runId.incrementAndGet()
      cancelRequested.set(true)
      stopCamera()
      isCapturing.set(false)
      // Settle the in-flight start (its JS await would otherwise hang).
      try {
        pendingPromise?.reject("CANCELLED", "Capture cancelled", null)
      } catch (_: Exception) { }
      pendingPromise = null
      sendEvent("HealthGraphRPPGState", mapOf("state" to "CANCELLED"))
      promise.resolve(null)
    }
  }

  private data class QualifiedFrame(val bgr: ByteArray, val timestampMs: Double, val stable: Boolean)

  @SuppressLint("UnsafeOptInUsageError")
  private fun startCaptureRun(timeoutSeconds: Int, promise: Promise, myRun: Long) {
    pendingPromise = promise
    fun settleStale() {
      try {
        promise.reject("CANCELLED", "Capture superseded by a newer run", null)
      } catch (_: Exception) { }
    }
    val context: Context = appContext.reactContext ?: run {
      if (myRun == runId.get()) {
        isCapturing.set(false)
        sendEvent("HealthGraphRPPGState", mapOf("state" to "FAILED", "reason" to "CAMERA_START"))
        promise.reject("NO_CONTEXT", "React context unavailable", null)
      } else settleStale()
      return
    }
    val activity = appContext.currentActivity
    val lifecycleOwner = (activity as? LifecycleOwner)
      ?: (context as? LifecycleOwner) ?: run {
        if (myRun == runId.get()) {
          isCapturing.set(false)
          sendEvent("HealthGraphRPPGState", mapOf("state" to "FAILED", "reason" to "CAMERA_START"))
          promise.reject("NO_LIFECYCLE", "No lifecycle owner for camera", null)
        } else settleStale()
        return
      }
    val activityDead = (activity as? Activity)?.let { it.isDestroyed || it.isFinishing } ?: false
    val lifecycleReady = lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
    if (activityDead || !lifecycleReady) {
      Log.e(TAG, "rppg stage: RPPG_CAMERA_INIT_FAILURE activityDead=$activityDead lifecycle=${lifecycleOwner.lifecycle.currentState}")
      if (myRun == runId.get()) {
        isCapturing.set(false)
        sendEvent("HealthGraphRPPGState", mapOf("state" to "FAILED", "reason" to "CAMERA_START"))
        promise.reject("CAMERA_START", "Camera unavailable in background", null)
      } else settleStale()
      return
    }
    // Camera permission must already be granted (JS requests it first).
    // Re-checked here (same backstop as the validated fingertip PPG module)
    // so a revoked/stale grant becomes a structured FAILED event instead of
    // a SecurityException thrown out of the CameraX bind path.
    if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      Log.e(TAG, "rppg stage: RPPG_CAMERA_INIT_FAILURE RPPG_PERMISSION_DENIED at bind time")
      if (myRun == runId.get()) {
        isCapturing.set(false)
        sendEvent("HealthGraphRPPGState", mapOf("state" to "FAILED", "reason" to "CAMERA_START"))
        promise.reject("CAMERA_PERMISSION", "Camera permission is required for a face scan.", null)
      } else settleStale()
      return
    }
    val pm = context.packageManager
    val hasCamera = pm.hasSystemFeature("android.hardware.camera.front") ||
      pm.hasSystemFeature("android.hardware.camera")
    if (!hasCamera) {
      if (myRun == runId.get()) {
        isCapturing.set(false)
        sendEvent("HealthGraphRPPGState", mapOf("state" to "FAILED", "reason" to "CAMERA_START"))
        promise.reject("NO_CAMERA", "No front camera available", null)
      } else settleStale()
      return
    }
    Log.w(TAG, "rppg stage: RPPG_CAMERA_INIT_START run=$myRun")

    val ring = ArrayDeque<QualifiedFrame>(WINDOW_FRAMES + 1)
    var droppedFrames = 0
    var stableFrames = 0
    var stableStreak = 0
    var absentStreak = 0
    var hadFaceLost = false
    var prevBright = Double.NaN
    var prevSkin = Double.NaN
    var lastState = ""
    var lastTelemetryMs = 0L
    var sealed = false

    fun emitState(state: String, extra: Map<String, Any?> = emptyMap()) {
      if (myRun != runId.get() || cancelRequested.get()) return
      if (state == lastState && state != "ACQUIRING") return
      lastState = state
      val payload = HashMap<String, Any?>(extra)
      payload["state"] = state
      payload["framesCollected"] = ring.size
      try {
        sendEvent("HealthGraphRPPGState", payload)
      } catch (_: Exception) { }
    }

    fun failRun(code: String, reason: String, message: String) {
      if (myRun != runId.get()) return
      stopCamera()
      isCapturing.set(false)
      // Invalidate the generation: a late camera-provider callback for this
      // run must observe a stale myRun and bind nothing (otherwise the camera
      // stays bound with no JS owner after a timeout failure).
      runId.incrementAndGet()
      pendingPromise = null
      try {
        sendEvent("HealthGraphRPPGState", mapOf("state" to "FAILED", "reason" to reason, "message" to message))
      } catch (_: Exception) { }
      try {
        promise.reject(code, message, null)
      } catch (_: Exception) { }
    }

    val timeoutRunnable = Runnable {
      if (myRun != runId.get() || sealed || cancelRequested.get()) return@Runnable
      val reason = if (ring.isEmpty()) "NO_FACE" else if (hadFaceLost) "FACE_LOST" else "INSUFFICIENT_FRAMES"
      failRun("INSUFFICIENT_FRAMES", reason, "Could not collect 160 face frames in time")
    }
    mainHandler.postDelayed(timeoutRunnable, timeoutSeconds * 1000L)

    fun sealAndResolve() {
      if (sealed) return
      sealed = true
      mainHandler.removeCallbacks(timeoutRunnable)
      if (myRun != runId.get() || cancelRequested.get()) return
      try {
        sendEvent("HealthGraphRPPGState", mapOf("state" to "COMPLETING", "framesCollected" to ring.size))
      } catch (_: Exception) { }
      val frames = ring.toList()
      val firstTs = frames.first().timestampMs
      val lastTs = frames.last().timestampMs
      val spanMs = lastTs - firstTs
      val fps = if (spanMs > 0) (frames.size - 1) * 1000.0 / spanMs else 0.0
      // Remove any stale window file before writing (bounded storage).
      try {
        context.cacheDir.listFiles { f -> f.name.startsWith("rppg_window_") }?.forEach { it.delete() }
      } catch (_: Exception) { }
      val outFile = File(context.cacheDir, "rppg_window_${System.currentTimeMillis()}.bin")
      try {
        FileOutputStream(outFile).use { fos ->
          val header = ByteBuffer.allocate(14).order(ByteOrder.LITTLE_ENDIAN)
          header.put("RPPG".toByteArray(Charsets.US_ASCII))
          header.putShort(1) // version
          header.putShort(frames.size.toShort())
          header.putShort(ROI_SIZE.toShort())
          header.putFloat(fps.toFloat())
          fos.write(header.array())
          val tsBuf = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN)
          for (f in frames) {
            tsBuf.clear()
            tsBuf.putDouble(f.timestampMs)
            fos.write(tsBuf.array())
            fos.write(f.bgr)
          }
        }
      } catch (e: Exception) {
        dlog("window write failed: ${e.message}")
        failRun("WINDOW_WRITE_FAILED", "WINDOW_WRITE_FAILED", "Could not store the capture window")
        return
      }
      stopCamera()
      isCapturing.set(false)
      val summary = mapOf(
        "state" to "COMPLETE",
        "windowUri" to outFile.absolutePath,
        "frameCount" to frames.size,
        "fpsMeasured" to fps,
        "durationMs" to spanMs,
        "faceStableFrac" to (stableFrames.toDouble() / frames.size.toDouble()),
        "droppedFrames" to droppedFrames,
      )
      try {
        sendEvent("HealthGraphRPPGState", mapOf("state" to "COMPLETE", "framesCollected" to frames.size))
      } catch (_: Exception) { }
      try {
        promise.resolve(summary)
      } catch (_: Exception) { }
      pendingPromise = null
    }

    val analysis = ImageAnalysis.Builder()
      .setTargetResolution(Size(640, 480))
      .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
      .build()
    analysis.setAnalyzer(cameraExecutor) { image: ImageProxy ->
      try {
        if (myRun != runId.get() || cancelRequested.get() || sealed) {
          image.close()
          return@setAnalyzer
        }
        val tsMs = image.imageInfo.timestamp / 1_000_000.0
        val stats = roiStats(image)
        image.close()
        if (stats == null) {
          droppedFrames++
          return@setAnalyzer
        }
        val present = stats.bright in BRIGHT_MIN..BRIGHT_MAX && stats.skin >= SKIN_MIN
        val motion = if (prevBright.isNaN()) 0.0
          else abs(stats.bright - prevBright) + 100.0 * abs(stats.skin - prevSkin)
        prevBright = stats.bright
        prevSkin = stats.skin
        val stable = present && motion < MOTION_STABLE_THR
        if (!present) {
          absentStreak++
          stableStreak = 0
          droppedFrames++
          if (absentStreak >= ABSENT_RESET && ring.isNotEmpty()) {
            ring.clear()
            stableFrames = 0
            hadFaceLost = true
            emitState("FACE_LOST")
          } else if (ring.isEmpty()) {
            emitState("FIND_FACE")
          } else {
            emitState("FACE_LOST")
            hadFaceLost = true
          }
          return@setAnalyzer
        }
        absentStreak = 0
        if (stable) {
          stableStreak++
        } else {
          stableStreak = 0
          droppedFrames++
        }
        if (ring.isEmpty() && stableStreak < STABLE_WARMUP) {
          emitState("POSITION_FACE", mapOf("stability" to (stableStreak.toDouble() / STABLE_WARMUP)))
          return@setAnalyzer
        }
        // Qualified frame: roiStats already cropped/resized the ROI to
        // 128x128 BGR before the image was closed above.
        val bgr = stats.bgr128
        if (bgr == null) {
          droppedFrames++
          emitState(if (ring.isEmpty()) "POSITION_FACE" else "ACQUIRING")
          return@setAnalyzer
        }
        if (ring.size < WINDOW_FRAMES) {
          ring.addLast(QualifiedFrame(bgr, tsMs, stable))
          if (stable) stableFrames++
        }
        val nowMs = System.currentTimeMillis()
        if (ring.size >= WINDOW_FRAMES) {
          sealAndResolve()
        } else {
          if (lastState != "ACQUIRING") emitState("ACQUIRING", mapOf("stability" to 1.0))
          else if (nowMs - lastTelemetryMs > TELEMETRY_MS) {
            lastTelemetryMs = nowMs
            lastState = "" // force heartbeat emit below
            emitState("ACQUIRING", mapOf("stability" to 1.0))
            lastState = "ACQUIRING"
          }
        }
      } catch (e: Exception) {
        try {
          image.close()
        } catch (_: Exception) { }
        dlog("analyzer error: ${e.message}")
      }
    }

    // CameraX binds use cases on the main thread only: bindToLifecycle calls
    // Threads.checkMainThread() as its first instruction and otherwise throws
    // IllegalStateException("Not in application's main thread"). Expo runs
    // AsyncFunctions on a background "AsyncFunctionQueue", so the provider
    // future must be resolved and the use cases bound on the main executor —
    // the same pattern as the validated fingertip PPG module.
    try {
      Log.w(TAG, "rppg stage: requesting camera provider")
      val providerFuture = ProcessCameraProvider.getInstance(context)
      providerFuture.addListener({
        if (myRun != runId.get()) {
          settleStale()
          return@addListener
        }
        try {
          val provider = providerFuture.get()
          cameraProvider = provider
          val selector = CameraSelector.DEFAULT_FRONT_CAMERA
          if (!provider.hasCamera(selector)) {
            mainHandler.removeCallbacks(timeoutRunnable)
            Log.e(TAG, "rppg stage: no front camera")
            failRun("NO_CAMERA", "CAMERA_START", "No front camera is available for a face scan.")
            return@addListener
          }
          provider.unbindAll()
          val preview = Preview.Builder().build()
          boundCamera = provider.bindToLifecycle(lifecycleOwner, selector, preview, analysis)
          RppgPreviewHost.publish(preview)
          Log.w(TAG, "rppg stage: RPPG_CAMERA_INIT_SUCCESS run=$myRun preview published, analyzer live")
          emitState("FIND_FACE")
        } catch (e: SecurityException) {
          mainHandler.removeCallbacks(timeoutRunnable)
          Log.e(TAG, "rppg stage: camera permission denied", e)
          failRun("CAMERA_PERMISSION", "CAMERA_START", "Camera permission denied")
        } catch (e: Exception) {
          mainHandler.removeCallbacks(timeoutRunnable)
          Log.e(TAG, "rppg stage: camera start failed: ${e.message}", e)
          failRun("CAMERA_START", "CAMERA_START", "Camera could not be started")
        }
      }, ContextCompat.getMainExecutor(context))
    } catch (e: Exception) {
      mainHandler.removeCallbacks(timeoutRunnable)
      Log.e(TAG, "rppg stage: camera provider init failed: ${e.message}", e)
      failRun("CAMERA_START", "CAMERA_START", "Camera could not be started")
    }
  }

  private data class RoiStats(val bright: Double, val skin: Double, val bgr128: ByteArray?)

  /**
   * ROI statistics + 128x128 BGR conversion from YUV_420_888 planes.
   * Centered square guide (GUIDE_FRac of the smaller dimension). Skin rule
   * in YCrCb-ish space; bilinear downscale to ROI_SIZE.
   */
  private fun roiStats(image: ImageProxy): RoiStats? {
    val w = image.width
    val h = image.height
    if (w < 64 || h < 64) return null
    val side = (min(w, h) * GUIDE_FRAC).toInt().coerceAtLeast(64)
    val x0 = (w - side) / 2
    val y0 = (h - side) / 2
    // Plane access is null-safe (same guard as the validated fingertip PPG
    // module): a malformed frame degrades to a dropped frame, never to an
    // IndexOutOfBoundsException escaping the analyzer.
    val yPlane = image.planes.getOrNull(0) ?: return null
    val uPlane = image.planes.getOrNull(1) ?: return null
    val vPlane = image.planes.getOrNull(2) ?: return null
    val yBuf = yPlane.buffer
    val uBuf = uPlane.buffer
    val vBuf = vPlane.buffer
    val yRow = yPlane.rowStride
    val uvRow = uPlane.rowStride
    val uvPix = uPlane.pixelStride
    // Stride-sampled stats pass over the ROI.
    var brightSum = 0L
    var brightN = 0
    var skinN = 0
    var sampleN = 0
    var yy = y0
    while (yy < y0 + side) {
      var xx = x0
      while (xx < x0 + side) {
        val yIdx = yy * yRow + xx
        if (yIdx >= yBuf.limit()) break
        val y = yBuf.get(yIdx).toInt() and 0xFF
        brightSum += y
        brightN++
        val uvx = xx / 2
        val uvy = yy / 2
        val uvIdx = uvy * uvRow + uvx * uvPix
        if (uvIdx < uBuf.limit() && uvIdx < vBuf.limit()) {
          val u = uBuf.get(uvIdx).toInt() and 0xFF
          val v = vBuf.get(uvIdx).toInt() and 0xFF
          if (y in 50..230 && u in 70..130 && v in 130..180) skinN++
          sampleN++
        }
        xx += 4
      }
      yy += 4
    }
    if (brightN == 0 || sampleN == 0) return null
    val bright = brightSum.toDouble() / brightN
    val skin = skinN.toDouble() / sampleN
    // Full ROI decode to 128x128 BGR (only for frames the caller keeps).
    val bgr = roiToBgr128(image, x0, y0, side) ?: return RoiStats(bright, skin, null)
    return RoiStats(bright, skin, bgr)
  }

  /** Crop ROI from NV21 bytes and bilinear-scale to 128x128 BGR. */
  private fun roiToBgr128(image: ImageProxy, x0: Int, y0: Int, side: Int): ByteArray? {
    try {
      val w = image.width
      val h = image.height
      val nv21 = yuv420ToNv21(image) ?: return null
      // ROI RGB at native resolution.
      val rgb = IntArray(side * side)
      var i = 0
      var y = 0
      while (y < side) {
        var x = 0
        while (x < side) {
          val sx = (x0 + x).coerceIn(0, w - 1)
          val sy = (y0 + y).coerceIn(0, h - 1)
          val yIdx = sy * w + sx
          val uvIdx = w * h + (sy / 2) * w + (sx / 2) * 2
          val Y = nv21[yIdx].toInt() and 0xFF
          val V = nv21[uvIdx].toInt() and 0xFF
          val U = nv21[uvIdx + 1].toInt() and 0xFF
          val c = Y - 16
          val d = U - 128
          val e = V - 128
          var r = (298 * c + 409 * e + 128) shr 8
          var g = (298 * c - 100 * d - 208 * e + 128) shr 8
          var b = (298 * c + 516 * d + 128) shr 8
          r = r.coerceIn(0, 255)
          g = g.coerceIn(0, 255)
          b = b.coerceIn(0, 255)
          rgb[i++] = (r shl 16) or (g shl 8) or b
          x++
        }
        y++
      }
      // Bilinear downscale to ROI_SIZE.
      val out = ByteArray(ROI_SIZE * ROI_SIZE * 3)
      val scale = side.toFloat() / ROI_SIZE
      var o = 0
      for (dy in 0 until ROI_SIZE) {
        val syF = (dy + 0.5f) * scale - 0.5f
        val yA = syF.toInt().coerceIn(0, side - 1)
        val yB = (yA + 1).coerceIn(0, side - 1)
        val fy = (syF - yA).coerceIn(0f, 1f)
        for (dx in 0 until ROI_SIZE) {
          val sxF = (dx + 0.5f) * scale - 0.5f
          val xA = sxF.toInt().coerceIn(0, side - 1)
          val xB = (xA + 1).coerceIn(0, side - 1)
          val fx = (sxF - xA).coerceIn(0f, 1f)
          val c00 = rgb[yA * side + xA]
          val c10 = rgb[yA * side + xB]
          val c01 = rgb[yB * side + xA]
          val c11 = rgb[yB * side + xB]
          val r = bilerp(c00 shr 16 and 0xFF, c10 shr 16 and 0xFF, c01 shr 16 and 0xFF, c11 shr 16 and 0xFF, fx, fy)
          val g = bilerp(c00 shr 8 and 0xFF, c10 shr 8 and 0xFF, c01 shr 8 and 0xFF, c11 shr 8 and 0xFF, fx, fy)
          val b = bilerp(c00 and 0xFF, c10 and 0xFF, c01 and 0xFF, c11 and 0xFF, fx, fy)
          out[o++] = b.toByte()
          out[o++] = g.toByte()
          out[o++] = r.toByte()
        }
      }
      return out
    } catch (_: Exception) {
      return null
    }
  }

  private fun bilerp(c00: Int, c10: Int, c01: Int, c11: Int, fx: Float, fy: Float): Int {
    val top = c00 + (c10 - c00) * fx
    val bot = c01 + (c11 - c01) * fx
    return (top + (bot - top) * fy).toInt().coerceIn(0, 255)
  }

  /** YUV_420_888 planes to NV21 (Y + interleaved VU), honoring strides. */
  private fun yuv420ToNv21(image: ImageProxy): ByteArray? {
    try {
      val w = image.width
      val h = image.height
      val yPlane = image.planes.getOrNull(0) ?: return null
      val uPlane = image.planes.getOrNull(1) ?: return null
      val vPlane = image.planes.getOrNull(2) ?: return null
      val out = ByteArray(w * h + w * h / 2)
      val yBuf = yPlane.buffer
      val yRow = yPlane.rowStride
      val yPix = yPlane.pixelStride
      var o = 0
      for (row in 0 until h) {
        var col = 0
        while (col < w) {
          out[o++] = yBuf.get(row * yRow + col * yPix)
          col++
        }
      }
      val uvRow = uPlane.rowStride
      val uvPix = uPlane.pixelStride
      val uBuf = uPlane.buffer
      val vBuf = vPlane.buffer
      for (row in 0 until h / 2) {
        var col = 0
        while (col < w / 2) {
          val uIdx = row * uvRow + col * uvPix
          val vIdx = row * vPlane.rowStride + col * vPlane.pixelStride
          out[o++] = vBuf.get(vIdx) // V first (NV21 = VU)
          out[o++] = uBuf.get(uIdx)
          col++
        }
      }
      return out
    } catch (_: Exception) {
      return null
    }
  }

  private fun stopCamera() {
    Log.w(TAG, "rppg stage: RPPG_STOP/RPPG_CLEANUP (unbinding preview + use cases)")
    try {
      RppgPreviewHost.publish(null)
    } catch (_: Exception) { }
    try {
      cameraProvider?.unbindAll()
    } catch (_: Exception) { }
    cameraProvider = null
    boundCamera = null
  }
}
