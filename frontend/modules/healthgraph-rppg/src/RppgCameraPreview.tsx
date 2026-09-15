import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeView } from 'expo';
import { isRppgAvailable } from './HealthGraphRPPGNative';

/**
 * RppgCameraPreview — the genuine live front-camera preview surface.
 *
 * Rendered natively (CameraX Preview on Android, AVCaptureVideoPreviewLayer
 * on iOS) from the SAME camera that feeds rPPG window capture during a
 * measurement. No frames cross the JS bridge; JS only sizes and positions
 * this view. A face-positioning guide is drawn by the measurement screen
 * as a JS overlay on top of this surface.
 *
 * Outside a native capture (Expo Go / web / idle) it renders a dark
 * placeholder so layout stays stable and no fake imagery is ever shown.
 */

type NativePreviewProps = {
  style?: StyleProp<ViewStyle>;
};

let NativePreview: React.ComponentType<NativePreviewProps> | null = null;
try {
  // Single-view module: resolves the DEFAULT view (RppgCameraPreviewView).
  //
  // NOTE: requireNativeView does NOT throw when the native module is absent
  // (Expo Go / web) — it returns a stub whose view config resolves lazily on
  // first render with a console warning. The try/catch below is therefore
  // NOT the fallback mechanism; isPreviewAvailable() is. Never render
  // NativePreview unless isPreviewAvailable() is true.
  NativePreview = requireNativeView('HealthGraphRPPG');
} catch {
  NativePreview = null;
}

export function isPreviewAvailable(): boolean {
  return (
    (Platform.OS === 'android' || Platform.OS === 'ios') &&
    isRppgAvailable &&
    NativePreview != null
  );
}

export default function RppgCameraPreview({ style }: { style?: StyleProp<ViewStyle> }) {
  if (!isPreviewAvailable() || !NativePreview) {
    return (
      <View style={[styles.preview, styles.placeholder, style]} accessible accessibilityLabel="Camera preview unavailable">
        <Text style={styles.placeholderText}>Camera preview</Text>
      </View>
    );
  }
  return <NativePreview style={[styles.preview, style]} />;
}

const styles = StyleSheet.create({
  preview: {
    width: '100%',
    minHeight: 240,
    backgroundColor: '#000',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: '#888',
    fontSize: 13,
  },
});
