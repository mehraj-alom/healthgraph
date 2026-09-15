import AVFoundation
import CoreGraphics
import ExpoModulesCore

/**
 * HealthGraphRPPG native module (iOS).
 *
 * Front-camera guide-ROI capture for face rPPG. Per-frame ROI statistics
 * (brightness, skin-ratio, motion) are computed directly from the BGRA
 * pixel buffer; qualified frames are cropped/resized to 128x128 BGR and
 * held in a bounded 160-frame ring. On seal, the ring is written to a
 * cache file (RPPG window v1) and only the file URI + scalar summary cross
 * the bridge. No frames, video, or pixels leave the device.
 *
 * No torch/flash (front camera), no ML frameworks, no network.
 */
public class HealthGraphRPPGModule: Module {
  private static let windowFrames = 160
  private static let roiSize = 128
  private static let guideFrac = 0.6
  private static let brightMin = 40.0
  private static let brightMax = 225.0
  private static let skinMin = 0.22
  private static let motionStableThr = 6.0
  private static let stableWarmup = 6
  private static let absentReset = 30

  private var session: AVCaptureSession?
  private var isCapturing = false
  private var cancelRequested = false
  private var runId = 0
  private let queue = DispatchQueue(label: "com.healthgraph.rppg")
  private var timeoutWork: DispatchWorkItem?

  public func definition() -> ModuleDefinition {
    Name("HealthGraphRPPG")
    Events("HealthGraphRPPGState")

    // Genuine live front-camera preview surface. Rendered by the same
    // AVCaptureSession that feeds window capture — never a second camera,
    // never frames over the bridge.
    View(RppgCameraPreviewView.self) {
    }

    AsyncFunction("startCapture") { (options: [String: Any]?, promise: Promise) in
      let timeout = ((options?["timeoutSeconds"] as? NSNumber)?.intValue ?? 30)
      let timeoutSeconds = max(10, min(60, timeout))
      guard !self.isCapturing else {
        promise.reject("IN_PROGRESS", "An rPPG capture is already running")
        return
      }
      self.isCapturing = true
      self.cancelRequested = false
      self.runId += 1
      let myRun = self.runId
      self.sendEvent("HealthGraphRPPGState", ["state": "STARTING"])
      self.start(timeoutSeconds: timeoutSeconds, promise: promise, myRun: myRun)
    }

    AsyncFunction("cancelCapture") { (promise: Promise) in
      self.runId += 1
      self.cancelRequested = true
      self.timeoutWork?.cancel()
      self.stop()
      self.isCapturing = false
      self.sendEvent("HealthGraphRPPGState", ["state": "CANCELLED"])
      promise.resolve(nil)
    }
  }

  private struct KeptFrame {
    let bgr: Data
    let timestampMs: Double
    let stable: Bool
  }

  private func start(timeoutSeconds: Int, promise: Promise, myRun: Int) {
    queue.async {
      guard myRun == self.runId, !self.cancelRequested else { return }
      guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) else {
        self.finishFail(promise, myRun: myRun, code: "NO_CAMERA", reason: "CAMERA_START", message: "No front camera available")
        return
      }
      do {
        let input = try AVCaptureDeviceInput(device: device)
        let session = AVCaptureSession()
        session.sessionPreset = .vga640x480
        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.alwaysDiscardsLateVideoFrames = true

        var ring = [KeptFrame]()
        ring.reserveCapacity(Self.windowFrames)
        var droppedFrames = 0
        var stableFrames = 0
        var stableStreak = 0
        var absentStreak = 0
        var hadFaceLost = false
        var prevBright = Double.nan
        var prevSkin = Double.nan
        var lastState = ""
        var lastTelemetry = Date.distantPast
        var sealed = false

        func emitState(_ state: String, _ extra: [String: Any] = [:]) {
          guard myRun == self.runId, !self.cancelRequested else { return }
          if state == lastState, state != "ACQUIRING" { return }
          lastState = state
          var payload = extra
          payload["state"] = state
          payload["framesCollected"] = ring.count
          self.sendEvent("HealthGraphRPPGState", payload)
        }

        func failRun(code: String, reason: String, message: String) {
          guard myRun == self.runId else { return }
          self.stop(); self.isCapturing = false
          self.sendEvent("HealthGraphRPPGState", ["state": "FAILED", "reason": reason, "message": message])
          promise.reject(code, message)
        }

        let timeoutItem = DispatchWorkItem {
          guard myRun == self.runId, !sealed, !self.cancelRequested else { return }
          let reason = ring.isEmpty ? "NO_FACE" : (hadFaceLost ? "FACE_LOST" : "INSUFFICIENT_FRAMES")
          failRun(code: "INSUFFICIENT_FRAMES", reason: reason, message: "Could not collect 160 face frames in time")
        }
        self.timeoutWork = timeoutItem
        self.queue.asyncAfter(deadline: .now() + .seconds(timeoutSeconds), execute: timeoutItem)

        func sealAndResolve() {
          guard !sealed else { return }
          sealed = true
          timeoutItem.cancel()
          guard myRun == self.runId, !self.cancelRequested else { return }
          self.sendEvent("HealthGraphRPPGState", ["state": "COMPLETING", "framesCollected": ring.count])
          let firstTs = ring.first!.timestampMs
          let lastTs = ring.last!.timestampMs
          let spanMs = lastTs - firstTs
          let fps = spanMs > 0 ? Double(ring.count - 1) * 1000.0 / spanMs : 0
          let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
          do {
            // Remove stale window files (bounded storage).
            for url in (try? FileManager.default.contentsOfDirectory(at: caches, includingPropertiesForKeys: nil)) ?? [] where url.lastPathComponent.hasPrefix("rppg_window_") {
              try? FileManager.default.removeItem(at: url)
            }
          }
          let outUrl = caches.appendingPathComponent("rppg_window_\(Int(Date().timeIntervalSince1970 * 1000)).bin")
          var data = Data()
          data.reserveCapacity(14 + ring.count * (8 + Self.roiSize * Self.roiSize * 3))
          data.append(contentsOf: [0x52, 0x50, 0x50, 0x47]) // "RPPG"
          appendU16(&data, 1)
          appendU16(&data, UInt16(ring.count))
          appendU16(&data, UInt16(Self.roiSize))
          appendF32(&data, Float(fps))
          for f in ring {
            appendF64(&data, f.timestampMs)
            data.append(f.bgr)
          }
          do {
            try data.write(to: outUrl, options: .atomic)
          } catch {
            failRun(code: "WINDOW_WRITE_FAILED", reason: "WINDOW_WRITE_FAILED", message: "Could not store the capture window")
            return
          }
          self.stop(); self.isCapturing = false
          self.sendEvent("HealthGraphRPPGState", ["state": "COMPLETE", "framesCollected": ring.count])
          promise.resolve([
            "windowUri": outUrl.path,
            "frameCount": ring.count,
            "fpsMeasured": fps,
            "durationMs": spanMs,
            "faceStableFrac": Double(stableFrames) / Double(ring.count),
            "droppedFrames": droppedFrames,
          ])
        }

        let delegate = RppgFrameDelegate { stats in
          guard myRun == self.runId, !self.cancelRequested, !sealed else { return }
          guard let stats = stats else {
            droppedFrames += 1
            return
          }
          let present = stats.bright >= Self.brightMin && stats.bright <= Self.brightMax && stats.skin >= Self.skinMin
          let motion: Double = prevBright.isNaN ? 0 : abs(stats.bright - prevBright) + 100.0 * abs(stats.skin - prevSkin)
          prevBright = stats.bright
          prevSkin = stats.skin
          let stable = present && motion < Self.motionStableThr
          if !present {
            absentStreak += 1
            stableStreak = 0
            droppedFrames += 1
            if absentStreak >= Self.absentReset, !ring.isEmpty {
              ring.removeAll(keepingCapacity: true)
              stableFrames = 0
              hadFaceLost = true
              emitState("FACE_LOST")
            } else if ring.isEmpty {
              emitState("FIND_FACE")
            } else {
              hadFaceLost = true
              emitState("FACE_LOST")
            }
            return
          }
          absentStreak = 0
          if stable {
            stableStreak += 1
          } else {
            stableStreak = 0
            droppedFrames += 1
          }
          if ring.isEmpty, stableStreak < Self.stableWarmup {
            emitState("POSITION_FACE", ["stability": Double(stableStreak) / Double(Self.stableWarmup)])
            return
          }
          guard let bgr = stats.bgr128 else {
            droppedFrames += 1
            emitState(ring.isEmpty ? "POSITION_FACE" : "ACQUIRING")
            return
          }
          if ring.count < Self.windowFrames {
            ring.append(KeptFrame(bgr: bgr, timestampMs: stats.timestampMs, stable: stable))
            if stable { stableFrames += 1 }
          }
          if ring.count >= Self.windowFrames {
            sealAndResolve()
          } else if lastState != "ACQUIRING" {
            emitState("ACQUIRING", ["stability": 1.0])
          } else if Date().timeIntervalSince(lastTelemetry) > 0.5 {
            lastTelemetry = Date()
            lastState = ""
            emitState("ACQUIRING", ["stability": 1.0])
            lastState = "ACQUIRING"
          }
        }
        objc_setAssociatedObject(session, &RppgSessionKeys.frameDelegate, delegate, .OBJC_ASSOCIATION_RETAIN)
        output.setSampleBufferDelegate(delegate, queue: self.queue)
        guard session.canAddInput(input), session.canAddOutput(output) else {
          self.finishFail(promise, myRun: myRun, code: "CAMERA_START", reason: "CAMERA_START", message: "Cannot configure camera session")
          return
        }
        session.addInput(input)
        session.addOutput(output)
        self.session = session
        session.startRunning()
        RppgPreviewHost.shared.publish(session)
        emitState("FIND_FACE")
      } catch {
        self.finishFail(promise, myRun: self.runId, code: "CAMERA_START", reason: "CAMERA_START", message: error.localizedDescription)
      }
    }
  }

  private func finishFail(_ promise: Promise, myRun: Int, code: String, reason: String, message: String) {
    guard myRun == self.runId else { return }
    stop(); isCapturing = false
    sendEvent("HealthGraphRPPGState", ["state": "FAILED", "reason": reason])
    promise.reject(code, message)
  }

  private func stop() {
    RppgPreviewHost.shared.publish(nil)
    timeoutWork?.cancel()
    timeoutWork = nil
    if let s = session, s.isRunning { s.stopRunning() }
    session = nil
  }
}

// MARK: - Window file writers (little-endian)

private func appendU16(_ data: inout Data, _ v: UInt16) {
  var le = v.littleEndian
  withUnsafeBytes(of: &le) { data.append(contentsOf: $0) }
}

private func appendF32(_ data: inout Data, _ v: Float) {
  var bits = v.bitPattern.littleEndian
  withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) }
}

private func appendF64(_ data: inout Data, _ v: Double) {
  var bits = v.bitPattern.littleEndian
  withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) }
}

/** Registry bridging the live AVCaptureSession and mounted preview views. Display-only. */
private final class RppgPreviewHost {
  static let shared = RppgPreviewHost()
  private let lock = NSLock()
  private var views = NSHashTable<RppgCameraPreviewView>.weakObjects()
  private var session: AVCaptureSession?

  func register(_ view: RppgCameraPreviewView) {
    lock.lock()
    views.add(view)
    let current = session
    lock.unlock()
    view.attachSession(current)
  }

  func unregister(_ view: RppgCameraPreviewView) {
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

/** Genuine live front-camera preview surface (display-only endpoint). */
public class RppgCameraPreviewView: ExpoView {
  private let previewLayer = AVCaptureVideoPreviewLayer()

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)
    clipsToBounds = true
    RppgPreviewHost.shared.register(self)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
  }

  func attachSession(_ session: AVCaptureSession?) {
    DispatchQueue.main.async { self.previewLayer.session = session }
  }

  deinit {
    RppgPreviewHost.shared.unregister(self)
  }
}

private enum RppgSessionKeys {
  static var frameDelegate: UInt8 = 0
}

private struct RppgRoiStats {
  let bright: Double
  let skin: Double
  let timestampMs: Double
  let bgr128: Data?
}

private class RppgFrameDelegate: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  let onStats: (RppgRoiStats?) -> Void
  init(_ onStats: @escaping (RppgRoiStats?) -> Void) { self.onStats = onStats }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let px = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    CVPixelBufferLockBaseAddress(px, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(px, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(px) else { return }
    let w = CVPixelBufferGetWidth(px), h = CVPixelBufferGetHeight(px)
    let stride = CVPixelBufferGetBytesPerRow(px)
    guard w >= 64, h >= 64 else { return }
    // Centered square guide.
    let side = max(64, Int(Double(min(w, h)) * 0.6))
    let x0 = (w - side) / 2, y0 = (h - side) / 2
    let row = base.assumingMemoryBound(to: UInt8.self)
    // Stride-sampled ROI stats (BGRA bytes).
    var brightSum = 0, brightN = 0, skinN = 0, sampleN = 0
    var y = y0
    while y < y0 + side {
      var x = x0
      while x < x0 + side {
        let o = y * stride + x * 4
        let b = Int(row[o]), g = Int(row[o + 1]), r = Int(row[o + 2])
        brightSum += (r + g + b) / 3
        brightN += 1
        // Classic RGB skin rule.
        if r > 95, g > 40, b > 20, r > g, r > b, (r - g) > 15 { skinN += 1 }
        sampleN += 1
        x += 4
      }
      y += 4
    }
    guard brightN > 0, sampleN > 0 else { return }
    let bright = Double(brightSum) / Double(brightN)
    let skin = Double(skinN) / Double(sampleN)
    let nowMs = Date().timeIntervalSince1970 * 1000
    // Crop + bilinear scale the ROI to 128x128 BGR.
    var bgr: Data? = nil
    if let cropped = cropAndScaleBGRA(base: base, w: w, h: h, stride: stride, x0: x0, y0: y0, side: side) {
      bgr = cropped
    }
    onStats(RppgRoiStats(bright: bright, skin: skin, timestampMs: nowMs, bgr128: bgr))
  }
}

/** Crop the ROI and bilinear-scale to 128x128 BGR bytes. Nil on failure. */
private func cropAndScaleBGRA(base: UnsafeMutablePointer<UInt8>, w: Int, h: Int, stride: Int, x0: Int, y0: Int, side: Int) -> Data? {
  let dst = 128
  var out = [UInt8](repeating: 0, count: dst * dst * 3)
  let scale = Float(side) / Float(dst)
  func px(_ x: Int, _ y: Int, _ c: Int) -> Float {
    let cx = min(w - 1, max(0, x0 + x))
    let cy = min(h - 1, max(0, y0 + y))
    return Float(base[cy * stride + cx * 4 + c])
  }
  var o = 0
  for dy in 0..<dst {
    let syF = (Float(dy) + 0.5) * scale - 0.5
    let yA = min(side - 1, max(0, Int(syF)))
    let yB = min(side - 1, yA + 1)
    let fy = min(1, max(0, syF - Float(yA)))
    for dx in 0..<dst {
      let sxF = (Float(dx) + 0.5) * scale - 0.5
      let xA = min(side - 1, max(0, Int(sxF)))
      let xB = min(side - 1, xA + 1)
      let fx = min(1, max(0, sxF - Float(xA)))
      // BGRA byte order: B=0, G=1, R=2.
      for c in 0..<3 {
        let t = px(xA, yA, c) + (px(xB, yA, c) - px(xA, yA, c)) * fx
        let b = px(xA, yB, c) + (px(xB, yB, c) - px(xA, yB, c)) * fx
        out[o] = UInt8(min(255, max(0, Int(t + (b - t) * fy))))
        o += 1
      }
    }
  }
  return Data(out)
}
