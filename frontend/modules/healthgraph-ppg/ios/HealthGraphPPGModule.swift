import AVFoundation
import ExpoModulesCore

/**
 * HealthGraphPPG native module (iOS).
 *
 * Mirrors the Android pipeline: rear camera + torch, per-frame luma scalar
 * extraction with immediate frame discard, compact ring buffer, on-device
 * filtering/peak/HR/HRV/quality. Only state events + the derived result
 * cross the bridge.
 */
public class HealthGraphPPGModule: Module {
  private var session: AVCaptureSession?
  private var isMeasuring = false
  private var cancelRequested = false
  private let queue = DispatchQueue(label: "com.healthgraph.ppg")

  public func definition() -> ModuleDefinition {
    Name("HealthGraphPPG")
    Events("HealthGraphPPGState")

    // Genuine live rear-camera preview surface. Rendered by the same
    // AVCaptureSession that feeds frame analysis — never a second camera,
    // never frames over the bridge.
    View(PpgCameraPreviewView.self) {
    }

    AsyncFunction("measure") { (options: [String: Any]?, promise: Promise) in
      let duration = ((options?["durationSeconds"] as? NSNumber)?.intValue ?? 60)
      let durationSeconds = max(10, min(300, duration))
      let exportRaw = (options?["exportRawSignal"] as? Bool) ?? false
      guard !self.isMeasuring else {
        promise.reject("IN_PROGRESS", "A PPG measurement is already running")
        return
      }
      self.isMeasuring = true
      self.cancelRequested = false
      self.sendEvent("HealthGraphPPGState", ["state": "STARTING"])
      self.start(durationSeconds: durationSeconds, exportRaw: exportRaw, promise: promise)
    }

    AsyncFunction("cancel") { (promise: Promise) in
      self.cancelRequested = true
      self.stop()
      self.isMeasuring = false
      self.sendEvent("HealthGraphPPGState", ["state": "CANCELLED"])
      promise.resolve(nil)
    }
  }

  private func start(durationSeconds: Int, exportRaw: Bool, promise: Promise) {
    queue.async {
      guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
        self.finishFail(promise, "No rear camera available")
        return
      }
      do {
        let input = try AVCaptureDeviceInput(device: device)
        let session = AVCaptureSession()
        session.sessionPreset = .low // minimal resolution: we keep one scalar/frame
        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.alwaysDiscardsLateVideoFrames = true
        let cap = durationSeconds * 40 + 64
        var samples = [Float]()
        var timestamps = [Double]()
        samples.reserveCapacity(cap)
        timestamps.reserveCapacity(cap)
        let startMs = Date().timeIntervalSince1970 * 1000
        let delegate = PpgFrameDelegate { mean, nowMs in
          if mean == nil { return }
          if samples.count < cap {
            samples.append(mean!)
            timestamps.append(nowMs)
          }
        }
        // Retain delegate for the session lifetime.
        objc_setAssociatedObject(session, &PpgSessionKeys.frameDelegate, delegate, .OBJC_ASSOCIATION_RETAIN)
        output.setSampleBufferDelegate(delegate, queue: self.queue)
        guard session.canAddInput(input), session.canAddOutput(output) else {
          self.finishFail(promise, "Cannot configure camera session")
          return
        }
        session.addInput(input)
        session.addOutput(output)
        try device.lockForConfiguration()
        if device.hasTorch { try? device.setTorchModeOn(level: 1.0) }
        // Fixed exposure keeps brightness comparable across frames.
        if device.isExposureModeSupported(.locked) { device.exposureMode = .locked }
        device.unlockForConfiguration()
        self.session = session
        session.startRunning()
        // Publish the live session to any mounted preview view.
        PpgPreviewHost.shared.publish(session)
        self.sendEvent("HealthGraphPPGState", ["state": "MEASURING"])

        let deadline = DispatchTime.now() + .seconds(durationSeconds)
        self.queue.asyncAfter(deadline: deadline) {
          if self.cancelRequested {
            promise.reject("CANCELLED", "Measurement cancelled")
            self.stop(); self.isMeasuring = false
            return
          }
          self.sendEvent("HealthGraphPPGState", ["state": "COMPLETING"])
          let out = PpgProcessor.process(samples: samples, timestampsMs: timestamps, durationSeconds: durationSeconds)
          var result: [String: Any] = [
            "signalQuality": out.quality,
            "durationSeconds": durationSeconds,
            "algorithmVersion": PpgProcessor.algorithmVersion,
          ]
          result["heartRateBpm"] = out.heartRateBpm as Any
          if !out.rr.isEmpty { result["rrIntervalsMs"] = out.rr }
          if let r = out.rmssd { result["rmssdMs"] = r }
          if let s = out.sdnn { result["sdnnMs"] = s }
          if exportRaw { result["rawSignal"] = samples.map { Double($0) } }
          self.sendEvent("HealthGraphPPGState", ["state": "COMPLETE", "signalQuality": out.quality])
          self.stop(); self.isMeasuring = false
          promise.resolve(result)
          _ = startMs
        }
      } catch {
        self.finishFail(promise, error.localizedDescription)
      }
    }
  }

  private func finishFail(_ promise: Promise, _ message: String) {
    stop(); isMeasuring = false
    sendEvent("HealthGraphPPGState", ["state": "FAILED"])
    promise.reject("CAMERA_START", message)
  }

  private func stop() {
    PpgPreviewHost.shared.publish(nil)
    if let s = session, s.isRunning { s.stopRunning() }
    session = nil
  }
}

/**
 * Registry bridging the live AVCaptureSession and mounted preview views.
 * Display-only: the preview layer renders on the GPU; no pixels are
 * readable by JS or retained anywhere.
 */
private final class PpgPreviewHost {
  static let shared = PpgPreviewHost()
  private let lock = NSLock()
  private var views = NSHashTable<PpgCameraPreviewView>.weakObjects()
  private var session: AVCaptureSession?

  func register(_ view: PpgCameraPreviewView) {
    lock.lock()
    views.add(view)
    let current = session
    lock.unlock()
    view.attachSession(current)
  }

  func unregister(_ view: PpgCameraPreviewView) {
    lock.lock()
    views.remove(view)
    lock.unlock()
  }

  func publish(_ newSession: AVCaptureSession?) {
    lock.lock()
    session = newSession
    let all = views.allObjects
    lock.unlock()
    for view in all { view.attachSession(newSession) }
  }
}

/** Genuine live rear-camera preview surface (display-only endpoint). */
public class PpgCameraPreviewView: ExpoView {
  private let previewLayer = AVCaptureVideoPreviewLayer()

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)
    clipsToBounds = true
    PpgPreviewHost.shared.register(self)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
  }

  func attachSession(_ session: AVCaptureSession?) {
    DispatchQueue.main.async { self.previewLayer.session = session }
  }

  deinit {
    PpgPreviewHost.shared.unregister(self)
  }
}

private enum PpgSessionKeys {
  static var frameDelegate: UInt8 = 0
}

private class PpgFrameDelegate: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  let onScalar: (Float?, Double) -> Void
  init(_ onScalar: @escaping (Float?, Double) -> Void) { self.onScalar = onScalar }
  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let px = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    CVPixelBufferLockBaseAddress(px, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(px, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(px) else { return }
    let w = CVPixelBufferGetWidth(px), h = CVPixelBufferGetHeight(px)
    let stride = CVPixelBufferGetBytesPerRow(px)
    // Center-crop, stride-sampled green channel mean; frame discarded after.
    let x0 = w/4, x1 = w*3/4, y0 = h/4, y1 = h*3/4
    var sum: Int = 0, count: Int = 0
    for y in stride(from: y0, to: y1, by: 4) {
      let row = base.advanced(by: y * stride).assumingMemoryBound(to: UInt8.self)
      var x = x0
      while x < x1 {
        sum += Int(row[x * 4 + 1]) // G of BGRA
        count += 1
        x += 8
      }
    }
    guard count > 0 else { return }
    let mean = Float(sum) / Float(count)
    let nowMs = Date().timeIntervalSince1970 * 1000
    if mean < 15 || mean > 245 { onScalar(nil, nowMs); return } // exposure gate
    onScalar(mean, nowMs)
  }
}

private struct PpgProcessor {
  static let algorithmVersion = "ppg-1.1.0"
  struct Out { let heartRateBpm: Double?; let rr: [Double]; let rmssd: Double?; let sdnn: Double?; let quality: Double; let peakCount: Int }

  static func detrend(_ signal: [Float], sampleRateHz: Double, trendSeconds: Double = 2.0) -> [Float] {
    guard !signal.isEmpty, sampleRateHz > 0 else { return signal }
    let window = max(3, min(signal.count, Int((sampleRateHz * trendSeconds).rounded())))
    var out = [Float](repeating: 0, count: signal.count)
    let s0 = signal[0]
    var run = s0 * Float(window)
    for i in 0..<signal.count {
      run += signal[i] - (i < window ? s0 : signal[i - window])
      out[i] = signal[i] - run / Float(window)
    }
    return out
  }

  static func refinePeak(_ filtered: [Float], _ i: Int) -> Double {
    guard i > 0, i < filtered.count - 1 else { return Double(i) }
    let y0 = Double(filtered[i - 1]), y1 = Double(filtered[i]), y2 = Double(filtered[i + 1])
    let denom = y0 - 2 * y1 + y2
    guard denom < 0 else { return Double(i) }
    let offset = (y0 - y2) / (2 * denom)
    guard offset.isFinite else { return Double(i) }
    return Double(i) + max(-0.5, min(0.5, offset))
  }

  static func sampleTimeAt(_ timestampsMs: [Double], _ pos: Double) -> Double {
    guard !timestampsMs.isEmpty else { return Double.nan }
    let lo = max(0, min(timestampsMs.count - 1, Int(pos.rounded(.down))))
    let hi = min(timestampsMs.count - 1, lo + 1)
    let frac = max(0, min(1, pos - Double(lo)))
    return timestampsMs[lo] + frac * (timestampsMs[hi] - timestampsMs[lo])
  }

  static func process(samples: [Float], timestampsMs: [Double], durationSeconds: Int) -> Out {
    guard samples.count == timestampsMs.count, samples.count >= 8 else {
      return Out(heartRateBpm: nil, rr: [], rmssd: nil, sdnn: nil, quality: 0, peakCount: 0)
    }
    let span = timestampsMs.last! - timestampsMs.first!
    let fs: Double = span > 0 ? Double(samples.count - 1) / (span / 1000.0) : Double(samples.count) / Double(durationSeconds)
    // Detrend BEFORE smoothing (auto-exposure / pressure drift removal).
    let detrended = detrend(samples, sampleRateHz: max(1, fs))
    // Low-pass the residual.
    var filt = [Float](repeating: 0, count: detrended.count)
    filt[0] = detrended[0]
    for i in 1..<detrended.count { filt[i] = 0.25 * detrended[i] + 0.75 * filt[i-1] }
    // Adaptive threshold peaks (0.5σ on detrended series, 0.30s refractory).
    let m = filt.reduce(0, +) / Float(filt.count)
    let variance = filt.reduce(0) { $0 + ($1 - m) * ($1 - m) } / Float(filt.count)
    let thr = m + 0.5 * sqrt(variance)
    let minGap = max(1, Int(fs * 0.30))
    var peaks = [Int]()
    for i in 1..<(filt.count - 1) {
      if filt[i] > filt[i-1] && filt[i] >= filt[i+1] && filt[i] > thr {
        if peaks.isEmpty || i - peaks.last! >= minGap { peaks.append(i) }
      }
    }
    // Sub-sample RR intervals on the real timestamp track.
    var rawRR = [Double]()
    for i in 1..<peaks.count {
      rawRR.append(sampleTimeAt(timestampsMs, refinePeak(filt, peaks[i])) - sampleTimeAt(timestampsMs, refinePeak(filt, peaks[i-1])))
    }
    var plausible = rawRR.filter { $0 >= 300 && $0 <= 2000 }
    if plausible.count >= 2 {
      let s = plausible.sorted(); let med = s[s.count / 2]
      plausible = plausible.filter { abs($0 - med) / med <= 0.3 }
    }
    var hr: Double? = nil
    if plausible.count >= 2 {
      // Median, not mean: robust to a single mistimed peak.
      let sorted = plausible.sorted()
      let c = 60000.0 / sorted[sorted.count / 2]
      if c >= 25 && c <= 250 { hr = c }
    }
    let hrvOk = durationSeconds >= 30 && plausible.count >= 5
    // Quality on the detrended AC series with a drift discount.
    let meanRaw = samples.reduce(0, +) / Float(samples.count)
    var acVar: Double = 0
    for x in detrended { acVar += Double(x) * Double(x) }
    let acStd = sqrt(acVar / Double(detrended.count))
    let cv = meanRaw != 0 ? acStd / Double(abs(meanRaw)) : 0
    let amp = min(1.0, max(0.0, (cv - 0.002) / 0.05))
    // Baseline trend = raw minus detrended; its relative energy is drift.
    var detMean: Double = 0
    for x in detrended { detMean += Double(x) }
    detMean /= Double(detrended.count)
    let trendMean = Double(meanRaw) - detMean
    var driftVar: Double = 0
    for i in 0..<samples.count {
      let trend = Double(samples[i]) - Double(detrended[i])
      driftVar += (trend - trendMean) * (trend - trendMean)
    }
    let driftStd = sqrt(driftVar / Double(samples.count))
    let driftCv = meanRaw != 0 ? driftStd / Double(abs(meanRaw)) : 0
    let driftFactor = max(0.3, min(1.0, 1.0 - driftCv / 0.15))
    let expected = max(1.0, Double(durationSeconds) * 0.9)
    let cov = min(1.0, max(0.0, Double(peaks.count) / expected))
    let stab = min(1.0, Double(peaks.count) / 5.0)
    let q = (0.45 * amp + 0.35 * cov + 0.2 * stab) * driftFactor
    let reliable = q >= 0.5
    func rmssd(_ rr: [Double]) -> Double? {
      guard rr.count >= 2 else { return nil }
      var s = 0.0
      for i in 1..<rr.count { s += (rr[i] - rr[i-1]) * (rr[i] - rr[i-1]) }
      return sqrt(s / Double(rr.count - 1))
    }
    func sdnn(_ rr: [Double]) -> Double? {
      guard rr.count >= 2 else { return nil }
      let mm = rr.reduce(0, +) / Double(rr.count)
      return sqrt(rr.reduce(0) { $0 + ($1 - mm) * ($1 - mm) } / Double(rr.count))
    }
    return Out(
      heartRateBpm: reliable ? hr : nil,
      rr: plausible,
      rmssd: (hrvOk && reliable) ? rmssd(plausible) : nil,
      sdnn: (hrvOk && reliable) ? sdnn(plausible) : nil,
      quality: min(1.0, max(0.0, q)),
      peakCount: peaks.count
    )
  }
}
