/**
 * healthgraph-rppg — on-device face rPPG capture (Expo native module).
 *
 * Front-camera guide-ROI window capture for HealthGraph face pulse
 * measurement. All implementation is original to HealthGraph: YUV/BGRA
 * ROI statistics, skin-ratio presence gating, motion stability gating,
 * and sealed 160-frame BGR window files. No third-party camera, face, or
 * ML code is bundled — inference runs separately via onnxruntime-react-native
 * through the services/rppg provider boundary.
 */
export * from './HealthGraphRPPG.types';
export * from './HealthGraphRPPGNative';
export {
  default as RppgCameraPreview,
  isPreviewAvailable,
  RppgCameraPreviewBoundary,
} from './RppgCameraPreview';
