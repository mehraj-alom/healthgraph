/**
 * PrescriptionScannerScreen — Guided multipage prescription capture.
 *
 * Premium feature: a document-style capture flow for prescriptions.
 *   - Full-screen viewfinder with an A4-ish frame guide + corner brackets.
 *   - Rotating capture tips including lighting guidance ("move to brighter
 *     light", torch toggle) — honest guidance, no fake light metering.
 *   - Capture → thumbnail strip → retake/remove → add pages → Done.
 *   - Done uploads each page through the existing document pipeline
 *     (filename-tagged `rx-scan-…` so extraction picks them up when the
 *     worker runs) and records a local scan session for review.
 *
 * Offline-first: pages stay on device; upload needs connectivity. Without
 * the processing worker, pages sit as UPLOADED with the standard paused
 * messaging and the review entry appears once extraction lands.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  CameraView,
  useCameraPermissions,
  type CameraView as CameraViewType,
} from 'expo-camera';
import { BlurView } from 'expo-blur';
import { Button } from '@/components';
import { GlassSurface, useReduceTransparency } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { LG } from '@/theme/liquidGlass';
import { useSteadyShutter } from '@/hooks/useSteadyShutter';
import { getCachedPatientId } from '@/services/patientIdentity';
import { uploadDocument } from '@/services/documents';
import {
  upsertDocument as dbUpsertDocument,
  setDocumentLocalUri,
} from '@/db/queries/documents';
import { cacheLocalCopy } from '@/services/documents';
import {
  createScanSession,
  addScanDocument,
  setScanStatus,
} from '@/db/queries/scanSessions';

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

const GUIDE_TIPS = [
  'Fill the frame with the prescription page',
  'Move to brighter light. Avoid shadows and glare',
  'Hold steady for a sharp photo',
  'Lay the page flat and keep edges inside the frame',
];

interface ScannedPage {
  uri: string;
}

export default function PrescriptionScannerScreen() {
  const navigation = useNavigation();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<InstanceType<typeof CameraViewType> | null>(null);
  // Functional-layer glass needs its solid fallback under transparency reduction.
  const glassOff = useReduceTransparency();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [torchOn, setTorchOn] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  // Boundary-style auto-capture: off by default — the user fires the
  // shutter. Can be enabled per session (see useSteadyShutter).
  const [autoCapture, setAutoCapture] = useState(false);
  const [uploadState, setUploadState] = useState<{
    phase: 'idle' | 'uploading' | 'done' | 'error';
    done: number;
    total: number;
    error?: string;
  }>({ phase: 'idle', done: 0, total: 0 });

  // Rotate guidance tips while capturing.
  useEffect(() => {
    if (pages.length > 0 || uploadState.phase !== 'idle') return;
    const timer = setInterval(() => {
      setTipIndex((i) => (i + 1) % GUIDE_TIPS.length);
    }, 3200);
    return () => clearInterval(timer);
  }, [pages.length, uploadState.phase]);

  // Open a local scan session once (needs the patient, available post-auth).
  useEffect(() => {
    const patientId = getCachedPatientId();
    if (!patientId) return;
    createScanSession(patientId, 'prescription')
      .then(setSessionId)
      .catch(() => {});
  }, []);

  const goBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  const capturePage = useCallback(async () => {
    const camera = cameraRef.current;
    if (!camera || capturing) return;
    setCapturing(true);
    try {
      const picture = await camera.takePictureAsync({
        quality: 0.8,
        exif: false,
      });
      if (!picture?.uri) {
        throw new Error('The camera did not return a photo. Please try again.');
      }
      setPages((prev) => [...prev, { uri: picture.uri }]);
    } catch (err) {
      Alert.alert(
        'Capture failed',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setCapturing(false);
    }
  }, [capturing]);

  const removePage = useCallback((uri: string) => {
    setPages((prev) => prev.filter((p) => p.uri !== uri));
  }, []);

  // Auto-shutter: only while idle on the viewfinder with the camera live.
  // Manual capture stays available at all times.
  const { steady } = useSteadyShutter(
    autoCapture && cameraReady && !capturing && uploadState.phase === 'idle',
    () => {
      void capturePage();
    },
  );

  const uploadPages = useCallback(async () => {
    const patientId = getCachedPatientId();
    if (!patientId || pages.length === 0 || !sessionId) return;
    setUploadState({ phase: 'uploading', done: 0, total: pages.length });
    try {
      await setScanStatus(sessionId, 'uploading');
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const name = `rx-scan-${sessionId}-p${i + 1}.jpg`;
        const doc = await uploadDocument({
          uri: page.uri,
          name,
          type: 'image/jpeg',
        });
        await dbUpsertDocument(patientId, {
          document_id: doc.document_id,
          file_hash: doc.file_hash,
          storage_url: doc.storage_url,
          status: doc.status,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        try {
          const localUri = await cacheLocalCopy(doc.document_id, page.uri, name);
          await setDocumentLocalUri(patientId, doc.document_id, localUri);
        } catch {
          // Cache is convenience only.
        }
        await addScanDocument(sessionId, doc.document_id);
        setUploadState({ phase: 'uploading', done: i + 1, total: pages.length });
      }
      await setScanStatus(sessionId, 'awaiting_extraction');
      setUploadState({ phase: 'done', done: pages.length, total: pages.length });
    } catch (err) {
      await setScanStatus(sessionId, 'uploading').catch(() => {});
      const httpStatus = (err as { response?: { status?: number } })?.response?.status;
      setUploadState({
        phase: 'error',
        done: 0,
        total: pages.length,
        error:
          httpStatus === 503
            ? 'Saved on your account. Processing is paused and will start automatically. Uploaded pages are safe.'
            : err instanceof Error
              ? err.message
              : 'Upload failed. Check your connection and try again.',
      });
    }
  }, [pages, sessionId]);

  // ---- Permission gate ----
  if (!permission?.granted) {
    return (
      <View style={styles.root}>
        <HomeStageBackdrop />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.center}>
            <GlassSurface strong style={styles.stateCard}>
              <Text style={styles.title}>Scan prescription</Text>
              <Text style={styles.body}>
                Camera access is needed to photograph prescription pages.
              </Text>
              <Button title="Allow camera" variant="secondary" onPress={() => void requestPermission()} fullWidth />
              <Button title="Go back" variant="ghost" onPress={goBack} fullWidth textStyle={styles.ghostText} />
            </GlassSurface>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ---- Upload progress / done ----
  if (uploadState.phase !== 'idle') {
    return (
      <View style={styles.root}>
        <HomeStageBackdrop />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.center}>
            <GlassSurface strong style={styles.stateCard}>
              {uploadState.phase === 'uploading' && (
                <>
                  <ActivityIndicator size="large" color={LG.card.mint} />
                  <Text style={styles.title}>
                    Uploading page {Math.min(uploadState.done + 1, uploadState.total)} of {uploadState.total}…
                  </Text>
                  <Text style={styles.body}>Keep the app open until done.</Text>
                </>
              )}
              {uploadState.phase === 'done' && (
                <>
                  <Text style={styles.check}>✓</Text>
                  <Text style={styles.title}>
                    {uploadState.total === 1
                      ? 'Prescription uploaded'
                      : `${uploadState.total} pages uploaded`}
                  </Text>
                  <Text style={styles.body}>
                    Review under Medications · Scanned. Confirm each medicine to add it.
                  </Text>
                  <Button title="Done" variant="secondary" onPress={goBack} fullWidth />
                </>
              )}
              {uploadState.phase === 'error' && (
                <>
                  <Text style={styles.title}>Upload did not finish</Text>
                  <Text style={styles.body}>{uploadState.error}</Text>
                  <Button
                    title="Try again"
                    variant="secondary"
                    onPress={() => setUploadState({ phase: 'idle', done: 0, total: 0 })}
                    fullWidth
                  />
                  <Button title="Go back" variant="ghost" onPress={goBack} fullWidth textStyle={styles.ghostText} />
                </>
              )}
            </GlassSurface>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ---- Viewfinder ----
  // The preview stays full-bleed; chrome around it is the functional glass
  // layer (live blur + translucent fill), never flat black.
  return (
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={[styles.header, glassOff && styles.headerSolid]}>
          {glassOff ? null : (
            <BlurView tint="dark" intensity={LG.blurIntensity} style={StyleSheet.absoluteFill} />
          )}
          <Pressable onPress={goBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close scanner">
            <Text style={styles.backBtn}>‹ Close</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Scan prescription</Text>
          <Pressable
            onPress={() => setTorchOn((v) => !v)}
            hitSlop={12}
            accessibilityRole="switch"
            accessibilityState={{ checked: torchOn }}
            accessibilityLabel="Toggle flashlight"
          >
            <Text style={[styles.torch, torchOn && styles.torchOn]}>
              {torchOn ? 'Flash on' : 'Flash off'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.finder}>
          <View style={styles.frame}>
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing="back"
              enableTorch={torchOn}
              onCameraReady={() => setCameraReady(true)}
            />
            <CornerBrackets />
          </View>

          <Text style={styles.hint}>{GUIDE_TIPS[tipIndex]}</Text>
          <Pressable
            onPress={() => setAutoCapture((v) => !v)}
            accessibilityRole="switch"
            accessibilityState={{ checked: autoCapture }}
            accessibilityLabel="Toggle automatic capture when steady"
            hitSlop={8}
            style={styles.autoRow}
          >
            <View style={[styles.autoCheck, autoCapture && styles.autoCheckOn]}>
              {autoCapture ? <Text style={styles.autoGlyph}>✓</Text> : null}
            </View>
            <Text style={styles.autoLabel}>
              {autoCapture
                ? steady
                  ? 'Steady. Capturing…'
                  : 'Auto-capture on. Hold steady inside the frame'
                : 'Auto-capture off. Use the shutter button'}
            </Text>
          </Pressable>
          <Text style={styles.pageCount}>
            {pages.length === 0
              ? 'Page 1'
              : `${pages.length} page${pages.length > 1 ? 's' : ''}`}
          </Text>

          {pages.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
              {pages.map((p, i) => (
                <View key={p.uri} style={styles.thumbWrap}>
                  <Image source={{ uri: p.uri }} style={styles.thumb} />
                  <Text style={styles.thumbLabel}>p{i + 1}</Text>
                  <Pressable
                    onPress={() => removePage(p.uri)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove page ${i + 1}`}
                    style={styles.thumbRemove}
                  >
                    <Text style={styles.thumbRemoveText}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}

          <View style={styles.captureRow}>
            <Pressable
              onPress={() => void capturePage()}
              disabled={!cameraReady || capturing}
              accessibilityRole="button"
              accessibilityLabel="Capture prescription page"
              hitSlop={8}
              style={({ pressed }) => [
                styles.captureBtn,
                pressed && cameraReady && !capturing && { transform: [{ scale: 0.94 }] },
                (!cameraReady || capturing) && { opacity: 0.55 },
              ]}
            >
              <View style={styles.captureInner} />
            </Pressable>
          </View>

          {pages.length > 0 && (
            <GlassSurface strong style={styles.doneCard}>
              <Button
                title={`Done. Upload ${pages.length} page${pages.length > 1 ? 's' : ''}`}
                variant="secondary"
                onPress={() => void uploadPages()}
                fullWidth
              />
            </GlassSurface>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

function CornerBrackets() {
  return (
    <View style={bracketStyles.frame} pointerEvents="none">
      <View style={[bracketStyles.corner, bracketStyles.tl]} />
      <View style={[bracketStyles.corner, bracketStyles.tr]} />
      <View style={[bracketStyles.corner, bracketStyles.bl]} />
      <View style={[bracketStyles.corner, bracketStyles.br]} />
    </View>
  );
}

const bracketStyles = StyleSheet.create({
  frame: {
    ...StyleSheet.absoluteFill,
  },
  corner: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderColor: '#FFFFFF',
    borderRadius: 6,
  },
  tl: { top: 14, left: 14, borderTopWidth: 4, borderLeftWidth: 4 },
  tr: { top: 14, right: 14, borderTopWidth: 4, borderRightWidth: 4 },
  bl: { bottom: 14, left: 14, borderBottomWidth: 4, borderLeftWidth: 4 },
  br: { bottom: 14, right: 14, borderBottomWidth: 4, borderRightWidth: 4 },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070F' },
  safe: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  stateCard: { padding: 20, gap: 12, alignItems: 'stretch', width: '100%' },
  title: {
    fontWeight: '600',
    fontSize: 34,
    lineHeight: 41,
    letterSpacing: -0.8,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  body: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
  },
  check: { fontSize: 44, lineHeight: 48, color: LG.card.mint, textAlign: 'center' },
  // Functional glass bar over the preview: blur + fill + hairline.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    overflow: 'hidden',
    backgroundColor: LG.fill,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: LG.border,
  },
  headerSolid: {
    backgroundColor: LG.fillOpaque,
  },
  backBtn: {
    fontWeight: '600',
    fontSize: 16,
    lineHeight: 22,
    color: SECONDARY,
    minHeight: 44,
    textAlignVertical: 'center',
  },
  headerTitle: {
    fontWeight: '600',
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.2,
    color: '#FFFFFF',
  },
  torch: {
    fontWeight: '600',
    fontSize: 14,
    lineHeight: 20,
    color: SECONDARY,
    minHeight: 44,
    textAlignVertical: 'center',
  },
  torchOn: { color: LG.card.mint },
  ghostText: { color: '#FFFFFF' },
  finder: {
    flex: 1,
    paddingHorizontal: 16,
    gap: 10,
    paddingBottom: 16,
  },
  frame: {
    height: 380,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#000000',
    marginTop: 8,
  },
  camera: { flex: 1 },
  hint: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
    minHeight: 24,
  },
  pageCount: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: TERTIARY,
    textAlign: 'center',
  },
  autoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 2,
    minHeight: 44,
  },
  autoCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoCheckOn: { backgroundColor: LG.card.mint, borderColor: LG.card.mint },
  autoGlyph: { color: '#0B0F1A', fontSize: 12, fontWeight: '700' },
  autoLabel: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
  },
  strip: { gap: 8, paddingVertical: 4 },
  thumbWrap: {
    width: 72,
    height: 96,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  thumb: { width: 72, height: 96 },
  thumbLabel: {
    position: 'absolute',
    left: 6,
    bottom: 4,
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  thumbRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  captureRow: { alignItems: 'center', paddingVertical: 4 },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: LG.card.mint,
  },
  doneCard: { padding: 16 },
});
