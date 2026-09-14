package com.healthgraph.ppg

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * On-device PPG signal pipeline. Pure logic, no Android dependencies, so it
 * is unit-testable on JVM and mirrors modules/healthgraph-ppg/src/ppgSignal.ts.
 *
 * Acquisition (PPGbetter approach): per-frame green-channel mean forms the
 * 1D time series. Frames are discarded immediately after extracting that
 * single scalar — the full-resolution frame is never retained.
 *
 * Ring-buffer discipline is enforced by the caller (HealthGraphPPGModule):
 * only [samples, timestampsMs] compact arrays are kept, capped at the current
 * measurement window (e.g. 300s @ 30fps -> <= 9000 scalars).
 */
object PpgSignalProcessor {
  const val ALGORITHM_VERSION = "ppg-1.0.0"
  const val MIN_RELIABLE_QUALITY = 0.5f
  const val MIN_HR_BPM = 25.0
  const val MAX_HR_BPM = 250.0

  data class Output(
    val heartRateBpm: Double?,
    val rrIntervalsMs: List<Double>,
    val rmssdMs: Double?,
    val sdnnMs: Double?,
    val signalQuality: Float,
  )

  /** Exponential moving-average low-pass (alpha ~0.25). */
  fun lowPass(signal: List<Float>, alpha: Float = 0.25f): List<Float> {
    if (signal.isEmpty()) return emptyList()
    val out = ArrayList<Float>(signal.size)
    var prev = signal[0]
    out.add(prev)
    for (i in 1 until signal.size) {
      prev = alpha * signal[i] + (1f - alpha) * prev
      out.add(prev)
    }
    return out
  }

  /** Local-maxima peak detection with adaptive threshold + refractory period. */
  fun detectPeaks(filtered: List<Float>, sampleRateHz: Float): List<Int> {
    if (filtered.size < 3 || sampleRateHz <= 0f) return emptyList()
    val mean = filtered.sum() / filtered.size
    var v = 0.0
    for (x in filtered) v += (x - mean) * (x - mean)
    val std = sqrt(v / filtered.size)
    val threshold = mean + 0.35f * std
    val minGap = maxOf(1, (sampleRateHz * 0.27f).toInt())
    val peaks = ArrayList<Int>()
    for (i in 1 until filtered.size - 1) {
      if (filtered[i] > filtered[i - 1] && filtered[i] >= filtered[i + 1] && filtered[i] > threshold) {
        if (peaks.isEmpty() || i - peaks.last() >= minGap) peaks.add(i)
      }
    }
    return peaks
  }

  /** Keep RR intervals within 300–2000ms and ±30% of median. */
  fun cleanRR(rrMs: List<Double>): List<Double> {
    val plausible = rrMs.filter { it in 300.0..2000.0 }
    if (plausible.size < 2) return plausible
    val sorted = plausible.sorted()
    val median = sorted[sorted.size / 2]
    return plausible.filter { abs(it - median) / median <= 0.3 }
  }

  fun rmssd(rrMs: List<Double>): Double? {
    if (rrMs.size < 2) return null
    var sum = 0.0
    for (i in 1 until rrMs.size) sum += (rrMs[i] - rrMs[i - 1]) * (rrMs[i] - rrMs[i - 1])
    return sqrt(sum / (rrMs.size - 1))
  }

  fun sdnn(rrMs: List<Double>): Double? {
    if (rrMs.size < 2) return null
    val m = rrMs.sum() / rrMs.size
    return sqrt(rrMs.sumOf { (it - m) * (it - m) } / rrMs.size)
  }

  fun signalQuality(raw: List<Float>, peakCount: Int, durationSeconds: Int): Float {
    if (raw.size < 8 || durationSeconds <= 0) return 0f
    val m = raw.sum() / raw.size
    var v = 0.0
    for (x in raw) v += (x - m) * (x - m)
    val std = sqrt(v / raw.size)
    val cv = if (m != 0f) std / abs(m) else 0.0
    val amplitude = ((cv - 0.002) / 0.05).toFloat().coerceIn(0f, 1f)
    val expected = maxOf(1, (durationSeconds * 0.9).toInt())
    val coverage = (peakCount.toFloat() / expected).coerceIn(0f, 1f)
    val stability = (peakCount.toFloat() / 5f).coerceIn(0f, 1f)
    return (0.45f * amplitude + 0.35f * coverage + 0.2f * stability).coerceIn(0f, 1f)
  }

  fun process(
    samples: List<Float>,
    timestampsMs: List<Long>,
    durationSeconds: Int,
  ): Output {
    if (samples.size != timestampsMs.size || samples.size < 8) {
      return Output(null, emptyList(), null, null, 0f)
    }
    // Numerical safety: drop non-finite pairs instead of letting one NaN or
    // infinity poison the mean/std/quality math. Never invent replacements.
    val finiteSamples = ArrayList<Float>(samples.size)
    val finiteTs = ArrayList<Long>(timestampsMs.size)
    for (i in samples.indices) {
      val s = samples[i]
      val t = timestampsMs[i]
      if (s.isFinite()) {
        finiteSamples.add(s)
        finiteTs.add(t)
      }
    }
    if (finiteSamples.size < 8) {
      return Output(null, emptyList(), null, null, 0f)
    }
    val samples = finiteSamples
    val timestampsMs = finiteTs
    val spanMs = (timestampsMs.last() - timestampsMs.first()).toDouble()
    val sampleRateHz = if (spanMs > 0) (samples.size - 1) / (spanMs / 1000.0) else samples.size / durationSeconds.toDouble()
    val filtered = lowPass(samples)
    val peaks = detectPeaks(filtered, sampleRateHz.toFloat())
    val rawRR = ArrayList<Double>()
    for (i in 1 until peaks.size) rawRR.add((timestampsMs[peaks[i]] - timestampsMs[peaks[i - 1]]).toDouble())
    val rr = cleanRR(rawRR)
    var hr: Double? = null
    if (rr.size >= 2) {
      val candidate = 60000.0 / (rr.sum() / rr.size)
      if (candidate in MIN_HR_BPM..MAX_HR_BPM) hr = candidate
    }
    val hrvOk = durationSeconds >= 30 && rr.size >= 5
    val q = signalQuality(samples, peaks.size, durationSeconds)
    val reliable = q >= MIN_RELIABLE_QUALITY
    return Output(
      heartRateBpm = if (reliable) hr else null,
      rrIntervalsMs = rr,
      rmssdMs = if (hrvOk && reliable) rmssd(rr) else null,
      sdnnMs = if (hrvOk && reliable) sdnn(rr) else null,
      signalQuality = q,
    )
  }

  /**
   * Extract the PPG scalar from a YUV_420_888 frame WITHOUT retaining it.
   * Uses the Y (luma) plane center crop as a green-channel proxy: with the
   * flash-illuminated fingertip covering the lens, luma tracks blood-volume
   * absorption the same way the PPGbetter green-channel mean does, while
   * avoiding the expensive YUV->RGB conversion on every frame.
   * Returns null when the frame is unsuitable (too dark/bright).
   */
  fun scalarFromLumaPlane(
    yPlane: java.nio.ByteBuffer,
    rowStride: Int,
    pixelStride: Int,
    width: Int,
    height: Int,
  ): Float? {
    // Defensive: an out-of-spec frame must be skipped (null), never throw —
    // a throw here would kill the single analyzer thread and end all frames.
    if (rowStride <= 0 || pixelStride <= 0 || width <= 0 || height <= 0) return null
    // Center crop (middle 50%) avoids lens edges; stride sampling (every 8th
    // pixel) bounds CPU on high-resolution sensors.
    val x0 = width / 4; val x1 = width * 3 / 4
    val y0 = height / 4; val y1 = height * 3 / 4
    var sum = 0L; var count = 0L
    try {
      val row = ByteArray(rowStride)
      val dup = yPlane.duplicate()
      for (y in y0 until y1 step 4) {
        val pos = y * rowStride
        if (pos < 0 || pos + rowStride > dup.capacity()) return null
        dup.position(pos)
        dup.get(row, 0, minOf(rowStride, dup.remaining()))
        var x = x0
        while (x < x1) {
          val idx = x * pixelStride
          if (idx < 0 || idx >= row.size) return null
          val v = row[idx].toInt() and 0xFF
          sum += v; count++
          x += 8
        }
      }
    } catch (_: Exception) {
      return null
    }
    if (count == 0L) return null
    val mean = sum.toFloat() / count
    // Exposure gate: finger missing (dark) or saturated (no contact).
    if (mean < 15f || mean > 245f) return null
    return mean
  }
}
