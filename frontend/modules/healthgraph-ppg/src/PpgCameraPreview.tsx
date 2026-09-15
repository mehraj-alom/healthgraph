import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeView } from 'expo';
import { isPpgAvailable } from './HealthGraphPPGNative';

/**
 * PpgCameraPreview — the genuine live rear-camera preview surface.
 *
 * Rendered natively (CameraX Preview on Android, AVCaptureVideoPreviewLayer
 * on iOS) from the SAME camera that feeds PPG analysis during a measurement.
 * No frames cross the JS bridge; JS only sizes and positions this view.
 *
 * Outside a native measurement (Expo Go / web / idle) it renders a dark
 * placeholder so layout stays stable and no fake imagery is ever shown.
 */

type NativePreviewProps = {
  style?: StyleProp<ViewStyle>;
};

let NativePreview: React.ComponentType<NativePreviewProps> | null = null;
try {
  // Single-view module: resolves the DEFAULT view (PpgCameraPreviewView).
  // Throws in Expo Go / web where the native module does not exist.
  NativePreview = requireNativeView('HealthGraphPPG');
} catch {
  NativePreview = null;
}

export function isPreviewAvailable(): boolean {
  return Platform.OS === 'android' && isPpgAvailable && NativePreview != null;
}

export default function PpgCameraPreview({ style }: { style?: StyleProp<ViewStyle> }) {
  if (NativePreview) {
    return <NativePreview style={[styles.preview, style]} />;
  }
  return (
    <View style={[styles.preview, styles.placeholder, style]} accessible accessibilityLabel="Camera preview unavailable">
      <Text style={styles.placeholderText}>Camera preview</Text>
    </View>
  );
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
