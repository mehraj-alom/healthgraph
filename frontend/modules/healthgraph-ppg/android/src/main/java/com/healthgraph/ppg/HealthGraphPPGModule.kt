package com.healthgraph.ppg

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * HealthGraphPPG native module (Android).
 *
 * Privacy: camera frames are processed one-by-one on-device. Each frame is
 * reduced to a single green-channel/luma scalar and then discarded; only the
 * compact [scalar, timestamp] ring buffer (capped at the measurement window)
 * is retained. No frames, video, or raw streams leave the device or cross
 * the JS bridge — only state events + the final derived result.
 *
 * Resource discipline: center-crop + stride sampling bounds per-frame CPU;
 * ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST drops backlog instead of queuing;
 * torch is released and the camera unbound on completion/cancel.
 */
class HealthGraphPPGModule : Module() {
  private val cameraExecutor = Executors.newSingleThreadExecutor()
  private val isMeasuring = AtomicBoolean(false)
  private var cameraProvider: ProcessCameraProvider? = null
  private var cancelRequested = AtomicBoolean(false)
  /**
   * Monotonic run id. Every measure()/cancel() invalidates older runs so a
   * late watchdog, analyzer callback, or camera callback from a previous run
   * can never settle promises, emit events, or release the camera of the
   * current run (cancel → immediate re-measure race on physical devices).
   */
  private val runId = AtomicLong(0)

  override fun definition() = ModuleDefinition {
    Name("HealthGraphPPG")

    Events("HealthGraphPPGState")

    AsyncFunction("measure") { options: Map<String, Any?>, promise: Promise ->
      val durationSeconds = ((options["durationSeconds"] as? Number)?.toInt() ?: 60).coerceIn(10, 300)
      val exportRaw = options["exportRawSignal"] as? Boolean ?: false
      if (!isMeasuring.compareAndSet(false, true)) {
        promise.reject("IN_PROGRESS", "A PPG measurement is already running", null)
        return@AsyncFunction
      }
      val myRun = runId.incrementAndGet()
      cancelRequested.set(false)
      sendEvent("HealthGraphPPGState", mapOf("state" to "STARTING"))
      startMeasurement(durationSeconds, exportRaw, promise, myRun)
    }

    AsyncFunction("cancel") { promise: Promise ->
      runId.incrementAndGet() // Invalidate any in-flight run first.
      cancelRequested.set(true)
      stopCamera()
      isMeasuring.set(false)
      sendEvent("HealthGraphPPGState", mapOf("state" to "CANCELLED"))
      promise.resolve(null)
    }
  }

  @SuppressLint("UnsafeOptInUsageError")
  private fun startMeasurement(durationSeconds: Int, exportRaw: Boolean, promise: Promise, myRun: Long) {
    // Settles this run's promise without touching shared camera state.
    // Used when this run was superseded before it ever started measuring.
    fun settleStale() {
      try {
        promise.reject("CANCELLED", "Measurement superseded by a newer run", null)
      } catch (_: Exception) { }
    }
    val context: Context = appContext.reactContext ?: run {
      if (myRun == runId.get()) {
        isMeasuring.set(false)
        promise.reject("NO_CONTEXT", "React context unavailable", null)
      } else {
        settleStale()
      }
      return
    }
    val lifecycleOwner = context as? LifecycleOwner ?: run {
      // Fallback: current activity is a LifecycleOwner in Expo apps.
      (appContext.currentActivity as? LifecycleOwner) ?: run {
        if (myRun == runId.get()) {
          isMeasuring.set(false)
          promise.reject("NO_LIFECYCLE", "No lifecycle owner for camera", null)
        } else {
          settleStale()
        }
        return
      }
    }
    // Backstop: never begin a CameraX bind without a runtime grant (e.g.
    // permission revoked after the JS-side request). The JS layer requests
    // first; this keeps a stale grant from ever reaching the camera.
    if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      if (myRun == runId.get()) {
        isMeasuring.set(false)
        sendEvent("HealthGraphPPGState", mapOf("state" to "FAILED"))
        promise.reject("CAMERA_PERMISSION", "Camera permission is required for heart-rate measurement.", null)
      } else {
        settleStale()
      }
      return
    }
    // Compact ring buffer only: cap = window * max 40fps + margin.
    val cap = durationSeconds * 40 + 64
    val samples = ArrayList<Float>(cap)
    val timestamps = ArrayList<Long>(cap)
    val startMs = System.currentTimeMillis()

    fun emitQualityWarning(q: Float) {
      sendEvent("HealthGraphPPGState", mapOf("state" to "QUALITY_WARNING", "signalQuality" to q.toDouble()))
    }

    val analysis = ImageAnalysis.Builder()
      .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
      .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
      .build()

    analysis.setAnalyzer(cameraExecutor) { image: ImageProxy ->
      try {
        // Frames are always released by the finally block below; never
        // close here so a frame can never be closed twice.
        // Drop work from a superseded run (cancel → re-measure race).
        if (myRun != runId.get()) { return@setAnalyzer }
        if (cancelRequested.get()) { return@setAnalyzer }
        val elapsed = System.currentTimeMillis() - startMs
        if (elapsed >= durationSeconds * 1000L) { return@setAnalyzer }
        val yPlane = image.planes.getOrNull(0)?.buffer
        if (yPlane != null) {
          val s = PpgSignalProcessor.scalarFromLumaPlane(
            yPlane,
            image.planes[0].rowStride,
            image.planes[0].pixelStride,
            image.width, image.height,
          )
          if (s != null && samples.size < cap) {
            synchronized(samples) {
              samples.add(s)
              timestamps.add(System.currentTimeMillis())
            }
          }
        }
        // Periodic live quality hint (~1Hz) without bridge spam.
        // Skip stale runs so a previous run never emits into a new one.
        val n = samples.size
        if (myRun == runId.get() && n > 30 && n % 30 == 0) {
          val q: Float
          synchronized(samples) {
            q = PpgSignalProcessor.signalQuality(samples.toList(), n / 30, (elapsed / 1000).toInt().coerceAtLeast(1))
          }
          sendEvent("HealthGraphPPGState", mapOf("state" to "MEASURING", "signalQuality" to q.toDouble()))
          if (q < 0.25f) emitQualityWarning(q)
        }
      } finally {
        image.close() // Discard frame immediately after scalar extraction.
      }
    }

    try {
      val providerFuture = ProcessCameraProvider.getInstance(context)
      providerFuture.addListener({
        if (myRun != runId.get()) {
          settleStale()
          return@addListener
        }
        try {
          val provider = providerFuture.get()
          cameraProvider = provider
          val selector = CameraSelector.DEFAULT_BACK_CAMERA
          provider.unbindAll()
          val camera = provider.bindToLifecycle(lifecycleOwner, selector, analysis)
          // LED flash on where supported.
          try {
            if (camera.cameraInfo.hasFlashUnit()) camera.cameraControl.enableTorch(true)
          } catch (_: Exception) { }
          sendEvent("HealthGraphPPGState", mapOf("state" to "MEASURING"))

          // Completion watchdog on a plain thread (no frame retention).
          Thread {
            try {
              Thread.sleep(durationSeconds * 1000L)
            } catch (_: InterruptedException) { }
            finishMeasurement(samples, timestamps, durationSeconds, exportRaw, promise, myRun)
          }.start()
        } catch (e: Exception) {
          if (myRun == runId.get()) {
            isMeasuring.set(false)
            stopCamera()
            sendEvent("HealthGraphPPGState", mapOf("state" to "FAILED"))
            promise.reject("CAMERA_START", e.message ?: "Camera start failed", e)
          } else {
            settleStale()
          }
        }
      }, ContextCompat.getMainExecutor(context))
    } catch (e: Exception) {
      if (myRun == runId.get()) {
        isMeasuring.set(false)
        sendEvent("HealthGraphPPGState", mapOf("state" to "FAILED"))
        promise.reject("CAMERA_START", e.message ?: "Camera start failed", e)
      } else {
        settleStale()
      }
    }
  }

  private fun finishMeasurement(
    samples: ArrayList<Float>,
    timestamps: ArrayList<Long>,
    durationSeconds: Int,
    exportRaw: Boolean,
    promise: Promise,
    myRun: Long,
  ) {
    // A superseded run must not touch the current run's camera, flag, or
    // events — but its still-pending promise is settled as cancelled so no
    // JS await hangs and no partial data is ever persisted.
    if (myRun != runId.get()) {
      try {
        promise.reject("CANCELLED", "Measurement superseded by a newer run", null)
      } catch (_: Exception) { }
      return
    }
    try {
      if (cancelRequested.get()) {
        promise.reject("CANCELLED", "Measurement cancelled", null)
        return
      }
      sendEvent("HealthGraphPPGState", mapOf("state" to "COMPLETING"))
      val snapSamples: List<Float>
      val snapTs: List<Long>
      synchronized(samples) {
        snapSamples = samples.toList()
        snapTs = timestamps.toList()
      }
      val out = PpgSignalProcessor.process(snapSamples, snapTs, durationSeconds)
      val result = mutableMapOf<String, Any?>(
        "heartRateBpm" to out.heartRateBpm,
        "signalQuality" to out.signalQuality.toDouble(),
        "durationSeconds" to durationSeconds,
        "algorithmVersion" to PpgSignalProcessor.ALGORITHM_VERSION,
      )
      if (out.rrIntervalsMs.isNotEmpty()) result["rrIntervalsMs"] = out.rrIntervalsMs
      out.rmssdMs?.let { result["rmssdMs"] = it }
      out.sdnnMs?.let { result["sdnnMs"] = it }
      // Raw export ONLY on explicit opt-in; otherwise discard.
      if (exportRaw) result["rawSignal"] = snapSamples.map { it.toDouble() }
      sendEvent("HealthGraphPPGState", mapOf("state" to "COMPLETE", "signalQuality" to out.signalQuality.toDouble()))
      promise.resolve(result)
    } catch (e: Exception) {
      sendEvent("HealthGraphPPGState", mapOf("state" to "FAILED"))
      promise.reject("PROCESSING", e.message ?: "Signal processing failed", e)
    } finally {
      stopCamera()
      isMeasuring.set(false)
    }
  }

  private fun stopCamera() {
    try {
      cameraProvider?.unbindAll()
    } catch (_: Exception) { }
    cameraProvider = null
  }
}
