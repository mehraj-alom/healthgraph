package com.healthgraph.ppg

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.TorchState
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

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
  companion object {
    private const val TAG = "HealthGraphPPG"
    /** Max wait for TorchState.ON after requesting torch. Fail fast after. */
    private const val TORCH_CONFIRM_TIMEOUT_MS = 8000L
  }

  private val cameraExecutor = Executors.newSingleThreadExecutor()
  private val isMeasuring = AtomicBoolean(false)
  private var cameraProvider: ProcessCameraProvider? = null
  @Volatile private var boundCamera: Camera? = null
  @Volatile private var torchObserver: Observer<Int>? = null
  @Volatile private var torchTimeout: Runnable? = null
  private val mainHandler = Handler(Looper.getMainLooper())
  private var cancelRequested = AtomicBoolean(false)
  /**
   * Monotonic run id. Every measure()/cancel() invalidates older runs so a
   * late watchdog, analyzer callback, or camera callback from a previous run
   * can never settle promises, emit events, or release the camera of the
   * current run (cancel → immediate re-measure race on physical devices).
   */
  private val runId = AtomicLong(0)

  /** DEBUG-only logging. Stripped of per-frame spam by the call sites. */
  private fun dlog(msg: String) {
    if (BuildConfig.DEBUG) Log.d(TAG, msg)
  }

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
        val msg = "App context unavailable (NO_CONTEXT)"
        dlog("measure failed: $msg")
        sendEvent("HealthGraphPPGState", mapOf("state" to "FAILED", "message" to msg))
        promise.reject("NO_CONTEXT", "React context unavailable", null)
      } else {
        settleStale()
      }
      return
    }
    // The foreground Activity is the correct LifecycleOwner. Prefer it over
    // the React context (which is never a LifecycleOwner) so a mis-resolved
    // owner can never silently prevent the camera from binding.
    val activity = appContext.currentActivity
    val lifecycleOwner = (activity as? LifecycleOwner)
      ?: (context as? LifecycleOwner) ?: run {
        if (myRun == runId.get()) {
          isMeasuring.set(false)
          val msg = "No camera lifecycle owner (NO_LIFECYCLE): activity unavailable"
          dlog("measure failed: $msg")
          sendEvent("HealthGraphPPGState", mapOf("state" to "FAILED", "message" to msg))
          promise.reject("NO_LIFECYCLE", "No lifecycle owner for camera", null)
        } else {
          settleStale()
        }
        return
      }
    // Never bind against a dead or backgrounded lifecycle: CameraX would
    // either throw or leave the camera running outside the visible window.
    val activityDead = (activity as? Activity)?.let { it.isDestroyed || it.isFinishing } ?: false
    val lifecycleReady = lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
    if (activityDead || !lifecycleReady) {
      if (myRun == runId.get()) {
        isMeasuring.set(false)
        val msg = "Activity not ready for camera (NO_LIFECYCLE): finishing/destroyed or below STARTED"
        dlog("measure failed: $msg")
        sendEvent("HealthGraphPPGState", mapOf("state" to "FAILED", "message" to msg))
        promise.reject("NO_LIFECYCLE", "The app screen is not ready for camera measurement", null)
      } else {
        settleStale()
      }
      return
    }
    // Backstop: never begin a CameraX bind without a runtime grant (e.g.
    // permission revoked after the JS-side request). The JS layer requests
    // first; this keeps a stale grant from ever reaching the camera.
    if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      if (myRun == runId.get()) {
        isMeasuring.set(false)
        val msg = "Camera permission missing at bind time (CAMERA_PERMISSION)"
        dlog("measure failed: $msg")
        sendEvent("HealthGraphPPGState", mapOf("state" to "FAILED", "message" to msg))
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
    // Measurement clock starts when the torch is CONFIRMED on, so the window
    // covers lit frames only — never a dark pre-torch prefix.
    val startMs = AtomicLong(0L)
    // Frames are accepted only after torch confirmation (set post-bind).
    val torchConfirmed = AtomicBoolean(false)
    // Raw counters only (no images retained): let one instrumented run reveal
    // whether frames arrive and whether the exposure gate accepts them.
    val framesReceived = AtomicInteger(0)
    val samplesAccepted = AtomicInteger(0)
    val framesRejected = AtomicInteger(0)
    val fingerAbsentFrames = AtomicInteger(0)
    // ---- Continuous-session state (single measurement session).
    // WAITING_FOR_FINGER (initial) -> ACQUIRING (finger seen) -> MEASURING
    // (stable live BPM) / SIGNAL_WEAK (finger, no confident BPM) ->
    // FINGER_REMOVED (loss; auto-reacquire on return) -> COMPLETE / FAILED.
    // Guarded by sessionLock: analyzer thread mutates, watchdog reads.
    val sessionLock = Any()
    val sessionState = AtomicReference("WAITING_FOR_FINGER")
    var presentStreak = 0
    var absentStreak = 0
    var fingerEverSeen = false
    var fingerLost = false
    val recentLiveHr = ArrayList<Double>(32)
    var lastLiveTickCount = 0
    // Finger-removal boundaries as buffer indexes. An RR interval spanning a
    // boundary bridges two separate placements and is excluded at finish, so
    // stale pre-loss beats can never contaminate the new acquisition.
    val segmentBreaks = ArrayList<Int>(8)

    /**
     * Emit a session state event (live BPM only when confidently estimated).
     * No-op for superseded runs. Caller decides change-vs-tick cadence.
     */
    fun emitSession(state: String, quality: Double? = null, liveBpm: Double? = null) {
      if (myRun != runId.get()) return
      val payload = mutableMapOf<String, Any?>("state" to state)
      if (quality != null) payload["signalQuality"] = quality
      if (liveBpm != null) payload["liveBpm"] = liveBpm
      sessionState.set(state)
      sendEvent("HealthGraphPPGState", payload)
    }

    val analysis = ImageAnalysis.Builder()
      .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
      .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
      .build()

    /**
     * One rolling-window live estimate (~1Hz). Uses the standard pipeline +
     * quality gate on the trailing window, then the stability vote. Emits
     * MEASURING only with a confident BPM, else SIGNAL_WEAK. Never emits a
     * stale number: no confident estimate means no liveBpm key at all.
     */
    fun liveTick() {
      if (myRun != runId.get() || cancelRequested.get()) return
      val snapSamples: List<Float>
      val snapTs: List<Long>
      synchronized(samples) {
        snapSamples = samples.toList()
        snapTs = timestamps.toList()
      }
      if (snapSamples.size < 8) return
      val endMs = snapTs.last()
      val cutMs = endMs - PpgSignalProcessor.LIVE_WINDOW_SECONDS * 1000L
      var from = 0
      while (from < snapTs.size && snapTs[from] < cutMs) from++
      val wSamples = snapSamples.subList(from, snapSamples.size)
      val wTs = snapTs.subList(from, snapTs.size)
      if (wSamples.size < 8) return
      val spanSec = ((wTs.last() - wTs.first()) / 1000).toInt()
      if (spanSec < PpgSignalProcessor.LIVE_MIN_SECONDS) return
      // Window-relative segment breaks (same exclusion as the final pass).
      val windowBreaks: List<Int>
      synchronized(sessionLock) {
        windowBreaks = segmentBreaks.mapNotNull { b ->
          val wb = b - from
          if (wb > 0 && wb < wSamples.size) wb else null
        }
      }
      val out = PpgSignalProcessor.process(wSamples, wTs, spanSec.coerceAtLeast(1), windowBreaks)
      val candidate = out.heartRateBpm
      val stable: Boolean
      val liveBpm: Double?
      synchronized(sessionLock) {
        if (candidate != null) {
          recentLiveHr.add(candidate)
          while (recentLiveHr.size > 32) recentLiveHr.removeAt(0)
        }
        stable = PpgSignalProcessor.isStableHrSeries(recentLiveHr)
        liveBpm = if (stable) recentLiveHr.last() else null
      }
      if (liveBpm != null) {
        emitSession("MEASURING", out.signalQuality.toDouble(), liveBpm)
      } else {
        emitSession("SIGNAL_WEAK", out.signalQuality.toDouble(), null)
      }
    }

    analysis.setAnalyzer(cameraExecutor) { image: ImageProxy ->
      try {
        // Frames are always released by the finally block below; never
        // close here so a frame can never be closed twice.
        // Drop work from a superseded run (cancel → re-measure race).
        if (myRun != runId.get()) { return@setAnalyzer }
        if (cancelRequested.get()) { return@setAnalyzer }
        // Pre-torch frames are dark by construction: drop them (still closed
        // below) instead of polluting the buffer and the counters.
        if (!torchConfirmed.get()) { return@setAnalyzer }
        val t0 = startMs.get()
        if (t0 == 0L) { return@setAnalyzer }
        val elapsed = System.currentTimeMillis() - t0
        if (elapsed >= durationSeconds * 1000L) { return@setAnalyzer }
        // framesReceived counts every post-torch frame the camera delivers
        // (finger or not), so "camera dead" stays distinguishable from
        // "no finger" in diagnostics.
        framesReceived.incrementAndGet()
        // Finger presence vote over full-frame stats (Y + chroma). A null
        // (malformed frame) counts as absent — conservative, never throws.
        val planes = image.planes
        val stats = PpgSignalProcessor.frameStatsFromYuv(
          planes[0].buffer,
          planes[0].rowStride,
          planes[0].pixelStride,
          planes.getOrNull(1)?.buffer,
          planes.getOrNull(1)?.rowStride ?: -1,
          planes.getOrNull(1)?.pixelStride ?: -1,
          planes.getOrNull(2)?.buffer,
          planes.getOrNull(2)?.rowStride ?: -1,
          planes.getOrNull(2)?.pixelStride ?: -1,
          image.width, image.height,
        )
        val fingerNow = stats != null && PpgSignalProcessor.isFingerPresent(stats)
        // Presence transitions (temporal consistency both ways). Emissions
        // happen outside sessionLock below.
        var emitNow: Triple<String, Double?, Double?>? = null
        synchronized(sessionLock) {
          if (fingerNow) { presentStreak++; absentStreak = 0 } else { absentStreak++; presentStreak = 0 }
          if (!fingerEverSeen) {
            if (presentStreak >= PpgSignalProcessor.FINGER_PRESENT_FRAMES) {
              fingerEverSeen = true
              emitNow = Triple("ACQUIRING", null, null)
            }
          } else if (!fingerLost) {
            if (absentStreak >= PpgSignalProcessor.FINGER_ABSENT_FRAMES) {
              // Finger lost: invalidate live BPM immediately, drop the
              // unstable history so reacquisition starts clean, and mark a
              // segment boundary so the bridging RR interval is excluded
              // at finish. Nothing is saved from a finger-removed session.
              fingerLost = true
              recentLiveHr.clear()
              segmentBreaks.add(samples.size)
              emitNow = Triple("FINGER_REMOVED", null, null)
            }
          } else {
            if (presentStreak >= PpgSignalProcessor.FINGER_PRESENT_FRAMES) {
              fingerLost = false
              emitNow = Triple("ACQUIRING", null, null)
            }
          }
        }
        if (emitNow != null && sessionState.get() != emitNow!!.first) {
          emitSession(emitNow!!.first, emitNow!!.second, emitNow!!.third)
        }
        val accepting = fingerNow && synchronized(sessionLock) { fingerEverSeen && !fingerLost }
        if (!accepting) {
          fingerAbsentFrames.incrementAndGet()
          return@setAnalyzer
        }
        // stats.yMean reuses the exposure gate bounds via isFingerPresent;
        // the explicit gate below stays as a second backstop.
        val s = stats!!.yMean
        if (s in PpgSignalProcessor.Y_MEAN_MIN..PpgSignalProcessor.Y_MEAN_MAX && samples.size < cap) {
          synchronized(samples) {
            samples.add(s)
            timestamps.add(System.currentTimeMillis())
          }
          samplesAccepted.incrementAndGet()
        } else {
          // Gate-null (too dark/bright) or buffer full: counted, never logged.
          framesRejected.incrementAndGet()
        }
        // Periodic live quality hint (~1Hz) without bridge spam.
        // Skip stale runs so a previous run never emits into a new one.
        // DEBUG-only frame/sample tally (~every 5s) for real-device diagnosis.
        val n = samples.size
        if (myRun == runId.get() && n > 30 && n % 150 == 0) {
          dlog("run=$myRun frames=${framesReceived.get()} accepted=${samplesAccepted.get()} rejected=${framesRejected.get()} state=${sessionState.get()}")
        }
        if (myRun == runId.get() && samplesAccepted.get() - lastLiveTickCount >= 30) {
          synchronized(sessionLock) { lastLiveTickCount = samplesAccepted.get() }
          liveTick()
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
        // Single current-run failure path: cleanup + named event + reject.
        fun failRun(code: String, userMessage: String, logMessage: String) {
          if (myRun != runId.get()) {
            settleStale()
            return
          }
          isMeasuring.set(false)
          stopCamera()
          dlog("run=$myRun $logMessage")
          sendEvent("HealthGraphPPGState", mapOf("state" to "FAILED", "message" to logMessage))
          try {
            promise.reject(code, userMessage, null)
          } catch (_: Exception) { }
        }
        try {
          val provider = providerFuture.get()
          cameraProvider = provider
          val selector = CameraSelector.DEFAULT_BACK_CAMERA
          // No silent fallback: without a back camera there is no PPG path.
          if (!provider.hasCamera(selector)) {
            failRun(
              "NO_CAMERA",
              "This device has no back camera for heart-rate measurement.",
              "No back camera (NO_CAMERA)",
            )
            return@addListener
          }
          provider.unbindAll()
          val camera = provider.bindToLifecycle(lifecycleOwner, selector, analysis)
          boundCamera = camera
          // Flash is mandatory for fingertip PPG: without it a 60-second
          // dark run is meaningless, so fail fast instead of measuring blind.
          val hasFlash = try {
            camera.cameraInfo.hasFlashUnit()
          } catch (_: Exception) { false }
          if (!hasFlash) {
            failRun(
              "NO_FLASH",
              "Flash is unavailable on this device's camera, so a pulse reading cannot be taken.",
              "No flash unit on bound camera (NO_FLASH)",
            )
            return@addListener
          }
          // Deterministic torch sequence: observe TorchState, request ON,
          // and start the measurement clock ONLY on confirmation.
          val litStarted = AtomicBoolean(false)
          fun beginLitMeasurement() {
            if (!litStarted.compareAndSet(false, true)) return
            if (myRun != runId.get()) {
              settleStale()
              return
            }
            torchTimeout?.let { mainHandler.removeCallbacks(it) }
            torchTimeout = null
            startMs.set(System.currentTimeMillis())
            dlog("run=$myRun torch confirmed ON, measurement clock started")
            // Session starts waiting for the finger: no acquisition, no BPM
            // until fingertip presence is confirmed by frame statistics.
            emitSession("WAITING_FOR_FINGER")
            // Completion watchdog on a plain thread (no frame retention).
            Thread {
              try {
                Thread.sleep(durationSeconds * 1000L)
              } catch (_: InterruptedException) { }
              val stableHistory: List<Double>
              val breaksSnapshot: List<Int>
              synchronized(sessionLock) {
                stableHistory = recentLiveHr.toList()
                breaksSnapshot = segmentBreaks.toList()
              }
              finishMeasurement(samples, timestamps, durationSeconds, exportRaw, promise, myRun, framesReceived, samplesAccepted, framesRejected, fingerAbsentFrames, stableHistory, breaksSnapshot)
            }.start()
          }
          val observer = Observer<Int> { state ->
            if (state == TorchState.ON && torchConfirmed.compareAndSet(false, true)) {
              beginLitMeasurement()
            }
          }
          torchObserver = observer
          try {
            camera.cameraInfo.torchState.observe(lifecycleOwner, observer)
          } catch (e: Exception) {
            failRun(
              "TORCH_UNAVAILABLE",
              "The flash could not be enabled on this device.",
              "TorchState observe failed (TORCH_UNAVAILABLE): ${e.message ?: "unknown"}",
            )
            return@addListener
          }
          try {
            val torchFuture = camera.cameraControl.enableTorch(true)
            torchFuture.addListener({
              try {
                torchFuture.get()
                dlog("run=$myRun torch enable future resolved")
              } catch (e: Exception) {
                dlog("run=$myRun torch enable future failed: ${e.message ?: "unknown"}")
              }
            }, ContextCompat.getMainExecutor(context))
          } catch (e: Exception) {
            failRun(
              "TORCH_UNAVAILABLE",
              "The flash could not be enabled on this device.",
              "enableTorch threw (TORCH_UNAVAILABLE): ${e.message ?: "unknown"}",
            )
            return@addListener
          }
          dlog("run=$myRun camera bound, torch ON requested; awaiting TorchState.ON")
          val timeout = Runnable {
            if (myRun != runId.get()) return@Runnable
            if (torchConfirmed.get()) {
              beginLitMeasurement()
            } else {
              failRun(
                "TORCH_UNAVAILABLE",
                "The flash could not be enabled on this device.",
                "Torch never reached ON within ${TORCH_CONFIRM_TIMEOUT_MS}ms (TORCH_UNAVAILABLE)",
              )
            }
          }
          torchTimeout = timeout
          // Fast path: observer delivers the current value immediately, so an
          // already-ON torch starts without waiting out the timeout.
          if (torchConfirmed.get()) {
            beginLitMeasurement()
          } else {
            mainHandler.postDelayed(timeout, TORCH_CONFIRM_TIMEOUT_MS)
          }
        } catch (e: Exception) {
          if (myRun == runId.get()) {
            isMeasuring.set(false)
            stopCamera()
            val msg = "Camera start failed (CAMERA_START): ${e.message ?: "unknown"}"
            dlog("run=$myRun $msg")
            sendEvent("HealthGraphPPGState", mapOf("state" to "FAILED", "message" to msg))
            promise.reject("CAMERA_START", e.message ?: "Camera start failed", e)
          } else {
            settleStale()
          }
        }
      }, ContextCompat.getMainExecutor(context))
    } catch (e: Exception) {
      if (myRun == runId.get()) {
        isMeasuring.set(false)
        stopCamera()
        val msg = "Camera provider unavailable (CAMERA_START): ${e.message ?: "unknown"}"
        dlog("run=$myRun $msg")
        sendEvent("HealthGraphPPGState", mapOf("state" to "FAILED", "message" to msg))
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
    framesReceived: AtomicInteger,
    samplesAccepted: AtomicInteger,
    framesRejected: AtomicInteger,
    fingerAbsentFrames: AtomicInteger,
    liveHistory: List<Double>,
    segmentBreaks: List<Int>,
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
      val out = PpgSignalProcessor.process(snapSamples, snapTs, durationSeconds, segmentBreaks)
      // Read back the actual torch state: a dark run must be distinguishable
      // from a weak-signal run instead of ending in the same generic failure.
      val torchOn = try {
        boundCamera?.cameraInfo?.torchState?.value == TorchState.ON
      } catch (_: Exception) { false }
      // A final result is accepted only from a sufficiently stable session:
      // adequate finger-present span, standard quality/beats gates, AND a
      // stable run of recent live estimates. A wild sequence (e.g.
      // 119,83,61,108,57) fails the stability vote and is nulled as
      // UNSTABLE — never smoothed into a believable number, never saved.
      val validSpanMs = if (snapTs.size >= 2) snapTs.last() - snapTs.first() else 0L
      val stableSession = validSpanMs >= PpgSignalProcessor.MIN_VALID_SPAN_MS &&
        PpgSignalProcessor.isStableHrSeries(liveHistory)
      // Machine-readable failure reason for the JS layer. Thresholds are
      // unchanged: this only names the gate that nulled the result.
      val failureReason: String? = when {
        snapSamples.size < 8 -> "NO_SAMPLES"
        out.heartRateBpm == null && out.signalQuality < PpgSignalProcessor.MIN_RELIABLE_QUALITY -> "LOW_QUALITY"
        out.heartRateBpm == null -> "NO_BEATS"
        !stableSession -> "UNSTABLE"
        else -> null
      }
      val finalHr = if (failureReason == null) out.heartRateBpm else null
      dlog(
        "run=$myRun finish torch=$torchOn frames=${framesReceived.get()} " +
          "accepted=${samplesAccepted.get()} rejected=${framesRejected.get()} " +
          "absent=${fingerAbsentFrames.get()} samples=${snapSamples.size} " +
          "quality=${out.signalQuality} hr=${out.heartRateBpm} " +
          "stable=$stableSession spanMs=$validSpanMs reason=$failureReason " +
          "effectiveFps=" + effectiveFps(snapTs),
      )
      val result = mutableMapOf<String, Any?>(
        "heartRateBpm" to finalHr,
        "signalQuality" to out.signalQuality.toDouble(),
        "durationSeconds" to durationSeconds,
        "algorithmVersion" to PpgSignalProcessor.ALGORITHM_VERSION,
        "torchEnabled" to torchOn,
        "framesReceived" to framesReceived.get().toDouble(),
        "samplesCollected" to snapSamples.size.toDouble(),
      )
      if (failureReason != null) result["failureReason"] = failureReason
      if (out.rrIntervalsMs.isNotEmpty()) result["rrIntervalsMs"] = out.rrIntervalsMs
      out.rmssdMs?.let { result["rmssdMs"] = it }
      out.sdnnMs?.let { result["sdnnMs"] = it }
      // Raw export ONLY on explicit opt-in; otherwise discard.
      if (exportRaw) result["rawSignal"] = snapSamples.map { it.toDouble() }
      sendEvent("HealthGraphPPGState", mapOf("state" to "COMPLETE", "signalQuality" to out.signalQuality.toDouble()))
      promise.resolve(result)
    } catch (e: Exception) {
      val msg = "Signal processing failed (PROCESSING): ${e.message ?: "unknown"}"
      dlog("run=$myRun $msg")
      sendEvent("HealthGraphPPGState", mapOf("state" to "FAILED", "message" to msg))
      promise.reject("PROCESSING", e.message ?: "Signal processing failed", e)
    } finally {
      stopCamera()
      isMeasuring.set(false)
    }
  }

  /** Effective sample rate from accepted-sample timestamps (DEBUG only). */
  private fun effectiveFps(timestamps: List<Long>): String {
    if (timestamps.size < 2) return "n/a"
    val spanMs = timestamps.last() - timestamps.first()
    if (spanMs <= 0) return "n/a"
    return "%.1f".format((timestamps.size - 1) / (spanMs / 1000.0))
  }

  private fun stopCamera() {
    // Same cleanup for completion, failure, and cancel: drop the torch
    // timeout, detach the TorchState observer, switch the torch off, then
    // unbind. Order matters — never touch camera state after unbind.
    try {
      torchTimeout?.let { mainHandler.removeCallbacks(it) }
    } catch (_: Exception) { }
    torchTimeout = null
    try {
      val observer = torchObserver
      torchObserver = null
      if (observer != null) {
        try {
          boundCamera?.cameraInfo?.torchState?.removeObserver(observer)
        } catch (_: Exception) { }
      }
    } catch (_: Exception) { }
    try {
      try {
        boundCamera?.cameraControl?.enableTorch(false)
      } catch (_: Exception) { }
      cameraProvider?.unbindAll()
    } catch (_: Exception) { }
    boundCamera = null
    cameraProvider = null
  }
}
