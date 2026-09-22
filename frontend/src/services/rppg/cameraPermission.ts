/**
 * Camera permission gate for the face rPPG capture module.
 *
 * Android uses React Native core PermissionsAndroid (no new dependencies).
 * iOS pre-requests via expo-camera BEFORE the native capture starts so the
 * OS prompt never fires mid-session under the native timeout clock (which
 * would otherwise surface as INSUFFICIENT_FRAMES/NO_FACE instead of a
 * permission outcome). The native module declares CAMERA in its manifest
 * (Android) / relies on NSCameraUsageDescription (iOS, set by the
 * healthgraph-rppg Expo config plugin) but the OS only grants it at
 * runtime, so the app must request it before the first front-camera bind.
 *
 * Separate from the fingertip PPG permission helper by design: the two
 * modalities never share implementation, only the OS permission itself.
 */

import { PermissionsAndroid, Platform } from 'react-native';

export type RppgCameraPermissionStatus = 'granted' | 'denied' | 'blocked';

/**
 * Ensure the camera permission is granted, requesting it when needed.
 * Never throws — every outcome maps to an explicit status the UI handles.
 */
export async function ensureRppgCameraPermission(): Promise<RppgCameraPermissionStatus> {
  if (Platform.OS === 'android') {
    try {
      const already = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.CAMERA,
      );
      if (already) return 'granted';

      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera access for face heart-rate measurement',
          message:
            'HealthGraph uses your front camera to measure your pulse from your face, entirely on this device. Your camera images never leave your phone.',
          buttonPositive: 'Allow',
          buttonNegative: 'Not now',
        },
      );
      if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
      if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
      return 'denied';
    } catch {
      // A bridge/settings failure must fail safe: treat as denied (retryable),
      // never as granted — capture must not start blind.
      return 'denied';
    }
  }
  if (Platform.OS === 'ios') {
    // Pre-flight BEFORE native startCapture so the OS prompt lands here,
    // not mid-session under the native timeout. Lazy require keeps node
    // unit-test imports of this module free of expo-camera. Any failure
    // falls back to the previous behavior (granted → native path reports
    // the true outcome through FAILED).
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const camera = require('expo-camera') as {
        requestCameraPermissionsAsync?: () => Promise<{
          granted?: boolean;
          canAskAgain?: boolean;
        }>;
      };
      if (typeof camera.requestCameraPermissionsAsync !== 'function') {
        return 'granted';
      }
      const res = await camera.requestCameraPermissionsAsync();
      if (res?.granted) return 'granted';
      if (res?.canAskAgain === false) return 'blocked';
      return 'denied';
    } catch {
      return 'granted';
    }
  }
  return 'granted';
}
