import { useCallback, useRef, useState, type RefObject } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';

import {
  analyzeErrorMessage,
  analyzePhoto,
  type FoodScanResult,
} from '@/services/nutritionService';

export type FoodScanStage = 'idle' | 'capturing' | 'analyzing' | 'done' | 'error';

export interface UseFoodScan {
  /** expo-camera permission response (null while resolving). */
  permission: ReturnType<typeof useCameraPermissions>[0];
  requestPermission: ReturnType<typeof useCameraPermissions>[1];
  /** Ref to attach to the <CameraView>; capture() uses it. */
  cameraRef: RefObject<InstanceType<typeof CameraView> | null>;
  cameraReady: boolean;
  setCameraReady: (ready: boolean) => void;
  stage: FoodScanStage;
  photoUri: string | null;
  result: FoodScanResult | null;
  error: string | null;
  /** Capture a frame via the camera ref, then run the analysis. */
  capture: () => Promise<void>;
  /** Back to the live viewfinder (clears photo + result + error). */
  reset: () => void;
}

/**
 * useFoodScan — camera permission state + capture/analyze state machine.
 *
 * idle → capturing (shutter) → analyzing (upload + estimate) → done | error.
 * The screen owns all presentation (viewfinder, overlays, result sheet);
 * this hook owns only permission, the camera ref, and the machine.
 */
export function useFoodScan(): UseFoodScan {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<InstanceType<typeof CameraView> | null>(null);
  const [cameraReady, setCameraReadyState] = useState(false);
  const [stage, setStage] = useState<FoodScanStage>('idle');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [result, setResult] = useState<FoodScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setCameraReady = useCallback((ready: boolean) => {
    setCameraReadyState(ready);
  }, []);

  const capture = useCallback(async () => {
    const camera = cameraRef.current;
    if (!camera) return;
    setError(null);
    setResult(null);
    setStage('capturing');
    try {
      const picture = await camera.takePictureAsync({
        quality: 0.7,
        base64: false,
        exif: false,
      });
      if (!picture?.uri) {
        throw new Error('The camera did not return a photo. Please try again.');
      }
      setPhotoUri(picture.uri);
      setStage('analyzing');
      const estimate = await analyzePhoto(picture.uri);
      setResult(estimate);
      setStage('done');
    } catch (err) {
      setError(analyzeErrorMessage(err));
      setStage('error');
    }
  }, []);

  const reset = useCallback(() => {
    setStage('idle');
    setPhotoUri(null);
    setResult(null);
    setError(null);
  }, []);

  return {
    permission,
    requestPermission,
    cameraRef,
    cameraReady,
    setCameraReady,
    stage,
    photoUri,
    result,
    error,
    capture,
    reset,
  };
}
