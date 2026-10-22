/**
 * BarcodeScanner — retail barcode capture (EAN-8/13, UPC-A/E) + manual entry.
 *
 * Camera stays live and smooth: the scan line is a native-driver loop,
 * frames are never captured (decode happens on-device in expo-camera),
 * and the first valid code locks instantly with haptic confirmation.
 * Lookup itself lives in services/barcode (Open Food Facts, free).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Button } from '@/components';
import { GlassSurface } from '@/components/home/GlassSurface';
import { LG } from '@/theme/liquidGlass';
import { lookupBarcode, normalizeBarcode, type BarcodeProduct } from '@/services/barcode';

const SECONDARY = 'rgba(233,240,255,0.66)';

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;
const SWEEP_MS = 2200;

export default function BarcodeScanner({
  onProduct,
  onCancel,
}: {
  onProduct: (product: BarcodeProduct, barcode: string) => void;
  onCancel: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const reducedMotion = useReducedMotion();
  const [manual, setManual] = useState(false);
  const [digits, setDigits] = useState('');
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const sweep = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion || manual) {
      cancelAnimation(sweep);
      return;
    }
    sweep.value = withRepeat(withTiming(1, { duration: SWEEP_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(sweep);
  }, [reducedMotion, manual, sweep]);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reducedMotion ? 60 : sweep.value * 116 }],
  }));

  const resolve = useCallback(
    async (raw: string) => {
      if (locked.current) return;
      locked.current = true;
      setResolving(true);
      setError(null);
      try {
        const product = await lookupBarcode(raw);
        const code = normalizeBarcode(raw);
        try {
          Vibration.vibrate(20);
        } catch {
          // Haptics are ambience, never a blocker.
        }
        onProduct(product, code ?? raw.replace(/[^0-9]/g, ''));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Barcode lookup failed. Please try again.');
        locked.current = false;
      } finally {
        setResolving(false);
      }
    },
    [onProduct],
  );

  const onScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (locked.current || resolving || typeof result?.data !== 'string') return;
      void resolve(result.data);
    },
    [resolve, resolving],
  );

  const resolvingPerm = permission == null;
  const granted = permission?.granted === true;
  const canAskAgain = permission?.canAskAgain !== false;

  if (resolvingPerm) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Text style={styles.hint}>Preparing camera…</Text>
      </View>
    );
  }

  if (!granted) {
    return (
      <View style={styles.center}>
        <GlassSurface strong style={styles.card}>
          <Text style={styles.cardTitle}>Camera is off</Text>
          <Text style={styles.cardBody}>
            HealthGraph needs camera access to scan barcodes. Codes are looked
            up by digits only — no images leave this device.
          </Text>
          {canAskAgain ? (
            <Button
              title="Enable camera"
              variant="secondary"
              onPress={() => void requestPermission()}
              fullWidth
              size="large"
              accessibilityLabel="Enable camera"
            />
          ) : null}
          <Button
            title="Open Settings"
            variant="ghost"
            onPress={() => void Linking.openSettings()}
            fullWidth
            textStyle={styles.ghostText}
            accessibilityLabel="Open system settings to enable camera access"
          />
        </GlassSurface>
      </View>
    );
  }

  return (
    <View style={styles.finder}>
      {!manual ? (
        <View style={styles.frame}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
            onBarcodeScanned={onScanned}
          />
          <View style={styles.corners} pointerEvents="none">
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />
            {!reducedMotion ? (
              <Animated.View style={[styles.scanLine, sweepStyle]} />
            ) : null}
          </View>
          {resolving ? (
            <View style={styles.resolving} pointerEvents="none">
              <ActivityIndicator size="large" color="#FFFFFF" />
              <Text style={styles.resolvingText}>Looking up product…</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {error && !manual ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        {!manual ? (
          <Button
            title="Enter digits manually"
            variant="ghost"
            onPress={() => setManual(true)}
            fullWidth
            textStyle={styles.ghostText}
            accessibilityLabel="Enter barcode digits manually"
          />
        ) : (
          <View style={styles.manualBox}>
            <Text style={styles.manualLabel}>Barcode digits</Text>
            <TextInput
              value={digits}
              onChangeText={(t) => {
                setDigits(t.replace(/[^0-9]/g, '').slice(0, 14));
                setError(null);
              }}
              keyboardType="number-pad"
              placeholder="e.g. 3017620422003"
              placeholderTextColor={SECONDARY}
              maxLength={14}
              style={styles.input}
              accessibilityLabel="Barcode digits"
              returnKeyType="search"
              onSubmitEditing={() => void resolve(digits)}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.manualRow}>
              <View style={styles.manualBtn}>
                <Button
                  title="Camera"
                  variant="ghost"
                  onPress={() => {
                    setManual(false);
                    setDigits('');
                    setError(null);
                  }}
                  fullWidth
                  textStyle={styles.ghostText}
                  accessibilityLabel="Back to camera scanner"
                />
              </View>
              <View style={styles.manualBtn}>
                <Button
                  title={resolving ? 'Looking up…' : 'Look up'}
                  variant="secondary"
                  onPress={() => void resolve(digits)}
                  disabled={resolving || digits.length < 8}
                  fullWidth
                  accessibilityLabel="Look up barcode"
                />
              </View>
            </View>
          </View>
        )}
        <Button
          title="Back"
          variant="ghost"
          onPress={onCancel}
          fullWidth
          textStyle={styles.ghostText}
          accessibilityLabel="Back to scan options"
        />
      </View>
    </View>
  );
}

const FRAME_H = 180;

const styles = StyleSheet.create({
  finder: { flex: 1, gap: 12 },
  frame: {
    flex: 1,
    minHeight: FRAME_H + 48,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  camera: { flex: 1 },
  corners: { ...StyleSheet.absoluteFill, padding: 24 },
  corner: { position: 'absolute', width: 30, height: 30, borderColor: '#FFFFFF', borderRadius: 2 },
  tl: { top: 24, left: 24, borderTopWidth: 3, borderLeftWidth: 3 },
  tr: { top: 24, right: 24, borderTopWidth: 3, borderRightWidth: 3 },
  bl: { bottom: 24, left: 24, borderBottomWidth: 3, borderLeftWidth: 3 },
  br: { bottom: 24, right: 24, borderBottomWidth: 3, borderRightWidth: 3 },
  scanLine: {
    position: 'absolute',
    left: 30,
    right: 30,
    top: 24,
    height: 3,
    borderRadius: 2,
    backgroundColor: LG.card.mint,
    shadowColor: LG.card.mint,
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  resolving: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(3,5,10,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  resolvingText: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 22,
    color: '#FFFFFF',
  },
  error: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 22,
    color: LG.card.danger,
    textAlign: 'center',
  },
  actions: { gap: 8, paddingBottom: 8 },
  manualBox: { gap: 8 },
  manualLabel: {
    fontWeight: '600',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: SECONDARY,
  },
  input: {
    fontSize: 16,
    color: '#14151D',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 52,
    fontVariant: ['tabular-nums'],
  },
  manualRow: { flexDirection: 'row', gap: 8 },
  manualBtn: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  card: {
    padding: 16,
    gap: 12,
    width: '100%',
  },
  cardTitle: {
    fontWeight: '600',
    fontSize: 18,
    lineHeight: 24,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  cardBody: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
  },
  hint: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 22,
    color: SECONDARY,
  },
  ghostText: { color: '#FFFFFF' },
});
