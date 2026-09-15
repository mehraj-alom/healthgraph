/**
 * Camera permission gate for the face rPPG capture module.
 *
 * Android only (uses React Native core PermissionsAndroid — no new
 * dependencies). The native module declares CAMERA in its manifest but the
 * OS only grants it at runtime, so the app must request it before the first
 * front-camera bind. iOS passes through: a denial there surfaces as a
 * normal capture failure through the existing FAILED path.
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
  if (Platform.OS !== 'android') return 'granted';
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
