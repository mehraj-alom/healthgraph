/**
 * healthgraph-ppg — on-device fingertip camera-PPG (Expo native module).
 *
 * Acquisition/signal-processing approach adapted from PPGbetter (MIT) by
 * Jan Kosma Bancerewicz et al., Gdańsk University of Technology:
 * https://github.com/JanBancerewicz/PPGbetter
 * Full attribution: THIRD_PARTY_NOTICES.md. Research/engineering foundation
 * only — not a validated or certified medical-device algorithm.
 */
export * from './HealthGraphPPG.types';
export * from './HealthGraphPPGNative';
export * from './ppgSignal';
export { default as PpgCameraPreview, isPreviewAvailable } from './PpgCameraPreview';
