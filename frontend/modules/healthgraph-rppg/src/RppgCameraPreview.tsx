import { Component, type ReactNode } from 'react';
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

function PreviewPlaceholder({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.preview, styles.placeholder, style]} accessible accessibilityLabel="Camera preview unavailable">
      <Text style={styles.placeholderText}>Camera preview</Text>
    </View>
  );
}

export default function RppgCameraPreview({ style }: { style?: StyleProp<ViewStyle> }) {
  if (!isPreviewAvailable() || !NativePreview) {
    return <PreviewPlaceholder style={style} />;
  }
  return <NativePreview style={[styles.preview, style]} />;
}

/**
 * RppgCameraPreviewBoundary — process-crash guard for the native preview.
 *
 * Mounting the genuine CameraX surface inflates platform view code
 * (SurfaceView, view manager) that can throw on specific devices or in
 * builds where the native view failed to register. In a release build an
 * uncaught render error kills the app process, which previously presented
 * as "open the rPPG feature → the app immediately closes". Any inflation
 * failure degrades to the same static placeholder the unavailable path
 * already renders — capture itself still reports through the structured
 * FAILED/unavailable states, never through a process exit.
 */
export class RppgCameraPreviewBoundary extends Component<
  { style?: StyleProp<ViewStyle>; children?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(): void {
    // Intentionally silent: the placeholder is the entire UX, and the
    // native capture path already emits structured failure events.
  }

  render(): ReactNode {
    if (this.state.failed) return <PreviewPlaceholder style={this.props.style} />;
    return this.props.children;
  }
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
