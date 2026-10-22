/**
 * DocumentUploadScreen — Full upload flow for medical documents.
 *
 * Steps: Choose file → Preview → Confirm → Upload → Processing → Done
 *
 * This screen is pushed onto the RootStack (not a tab).
 * Processing continues automatically in DocumentsContext when the user
 * navigates away — no "Continue in Background" button is needed.
 *
 * PERFORMANCE: Stage updates during processing use subscribeStage()
 * so only this screen re-renders on status changes, not the entire app.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { Button } from '@/components';
import { LG } from '@/theme/liquidGlass';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import Entrance from '@/components/home/Entrance';
import {
  useDocuments,
  type ProcessingStage,
} from '@/context/DocumentsContext';
import { formatFileSize } from '@/services/documents';
import { PaywallGate } from '@/components/PaywallGate';
import {
  consumeQuota,
  getLocalTier,
  getMonthlyUsage,
  monthlyQuota,
} from '@/services/premium';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'application/json', 'application/fhir+json'];
const ACCEPTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.json'];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAcceptedType(mimeType: string): boolean {
  return ACCEPTED_TYPES.includes(mimeType);
}

const STAGE_ORDER: Record<string, number> = {
  uploading: 0,
  uploaded: 1,
  processing: 2,
  extracted: 3,
  completed: 4,
  failed: 5,
  failed_triage: 5,
};

function stageInfo(stage: string): { label: string } {
  switch (stage) {
    case 'uploading':
      return { label: 'Uploading' };
    case 'uploaded':
      return { label: 'Uploaded' };
    case 'processing':
      return { label: 'Processing' };
    case 'extracted':
      return { label: 'Extracted' };
    case 'completed':
      return { label: 'Complete' };
    case 'failed':
    case 'failed_triage':
      return { label: 'Failed' };
    default:
      return { label: stage };
  }
}

function isTerminalStage(stage: ProcessingStage): boolean {
  return (
    stage === 'completed' || stage === 'failed' || stage === 'failed_triage'
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DocumentUploadScreen() {
  const navigation = useNavigation();
  const {
    uploadAndProcess,
    subscribeStage,
    dismissProcessing,
    getActiveProcessing,
    isProcessing: anotherUploadRunning,
  } = useDocuments();

  // ---- File picker state ----
  const [selectedFile, setSelectedFile] = useState<{
    uri: string;
    name: string;
    type: string;
    size: number;
  } | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // ---- Processing state (local to this screen) ----
  const [uploadedDocId, setUploadedDocId] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<ProcessingStage>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  // General-tier monthly document-scan quota, checked on focus (never
  // blocking render). Free tier is always paywalled; All-in is unlimited.
  const [quotaExhausted, setQuotaExhausted] = useState(false);
  const checkDocQuota = useCallback(() => {
    void (async () => {
      const t = await getLocalTier();
      if (t !== 'general') {
        setQuotaExhausted(false);
        return;
      }
      const quota = monthlyQuota(t, 'documentScan') ?? 4;
      const used = await getMonthlyUsage('documentScan');
      setQuotaExhausted(used >= quota);
    })();
  }, []);
  useFocusEffect(checkDocQuota);

  // ---- Subscribe to stage updates for this document ----
  // The tick forces a re-render on every notify (even same-stage ones that
  // only carry a note), so the paused message below always appears.
  const [, setStageTick] = useState(0);
  useEffect(() => {
    if (!uploadedDocId) return;
    return subscribeStage(uploadedDocId, (s) => {
      setCurrentStage(s);
      setStageTick((v) => v + 1);
    });
  }, [uploadedDocId, subscribeStage]);

  // ---- Derived ----
  const isProcessing = uploadedDocId !== null && !isTerminalStage(currentStage);
  const isTerminal = uploadedDocId !== null && isTerminalStage(currentStage);
  // Friendly paused/queued note set by the upload flow (worker unavailable).
  const pausedNote =
    uploadedDocId != null
      ? (getActiveProcessing().find((e) => e.documentId === uploadedDocId)?.note ?? null)
      : null;

  // ---- File selection ----
  const pickFile = useCallback(async () => {
    setValidationError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ACCEPTED_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const ext = asset.name.split('.').pop()?.toLowerCase() ?? '';
      if (
        !ACCEPTED_EXTENSIONS.includes(`.${ext}`) &&
        !isAcceptedType(asset.mimeType ?? '')
      ) {
        setValidationError(
          'Unsupported file type. Please upload a PDF, PNG, JPG, JPEG, or FHIR JSON file.',
        );
        return;
      }
      if (asset.size && asset.size > MAX_FILE_SIZE) {
        setValidationError(
          `Too large · max ${formatFileSize(MAX_FILE_SIZE)}.`,
        );
        return;
      }
      setSelectedFile({
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? 'application/octet-stream',
        size: asset.size ?? 0,
      });
    } catch (err) {
      console.error('[DocumentUpload] Pick error:', err);
      setValidationError('Could not open that file.');
    }
  }, []);

  // ---- Upload (single active upload: the button stays disabled while
  // any document is mid-pipeline, and the context guard below rejects a
  // second start with a friendly message instead of a duplicate entry) ----
  const handleUpload = useCallback(() => {
    if (!selectedFile || anotherUploadRunning) return;
    void (async () => {
      // General-tier quota is consumed here, at upload time. Free tier
      // never reaches this button (paywalled surface); All-in is unlimited.
      const t = await getLocalTier();
      if (t === 'general') {
        const ok = await consumeQuota(t, 'documentScan');
        if (!ok) {
          setQuotaExhausted(true);
          return;
        }
      }
      setUploadError(null);
      uploadAndProcess(
        selectedFile,
        (docId) => {
          setUploadedDocId(docId);
          setCurrentStage('uploaded');
        },
        (error) => {
          // Upload failed before we got a document ID — stay on file selection
          setUploadError(error);
        },
      );
    });
  }, [selectedFile, anotherUploadRunning, uploadAndProcess]);

  // ---- Dismiss on completion ----
  const handleDone = useCallback(() => {
    if (uploadedDocId) dismissProcessing(uploadedDocId);
    navigation.goBack();
  }, [uploadedDocId, dismissProcessing, navigation]);

  // =====================================================================
  // RENDER — Processing / result view
  // =====================================================================
  if (uploadedDocId) {
    const terminal = isTerminalStage(currentStage);
    const info = stageInfo(currentStage);
    const stages = [
      'uploading',
      'uploaded',
      'processing',
      'extracted',
      'completed',
    ] as const;

    return (
      <View style={styles.screen}>
        <HomeStageBackdrop />
        <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          <Entrance index={0}>
            <View style={styles.header}>
              <Text style={styles.title}>
                {terminal ? 'Status' : 'Processing'}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>{selectedFile?.name ?? ''}</Text>
            </View>
          </Entrance>

          <Entrance index={1}>
          <GlassSurface strong style={styles.processingCard}>
            {stages.map((s, i) => {
              const sInfo = stageInfo(s);
              const pastOrCurrent =
                STAGE_ORDER[currentStage] >= STAGE_ORDER[s];
              const isCurrent =
                STAGE_ORDER[currentStage] === STAGE_ORDER[s];

              return (
                <View key={s} style={styles.stageRow}>
                  <View
                      style={[
                      styles.stageDot,
                      {
                        backgroundColor: pastOrCurrent
                          ? LG.card.mint
                          : 'rgba(255,255,255,0.12)',
                      },
                    ]}
                  >
                    {pastOrCurrent &&
                    currentStage !== 'failed' &&
                    currentStage !== 'failed_triage' ? (
                      <Text style={styles.stageCheck}>✓</Text>
                    ) : null}
                  </View>
                  <View style={styles.stageContent}>
                    <Text
                      style={[
                        styles.stageLabel,
                        pastOrCurrent
                          ? styles.stageLabelActive
                          : styles.stageLabelInactive,
                      ]}
                    >
                      {sInfo.label}
                    </Text>
                    {isCurrent && !terminal && (
                      <ActivityIndicator
                        size="small"
                        color="#FFFFFF"
                        style={styles.stageSpinner}
                      />
                    )}
                  </View>
                  {i < stages.length - 1 && (
                    <View
                      style={[
                        styles.stageLine,
                        {
                          backgroundColor: pastOrCurrent
                            ? LG.card.mint
                            : 'rgba(255,255,255,0.12)',
                        },
                      ]}
                    />
                  )}
                </View>
              );
            })}

            {currentStage === 'failed' && (
              <View style={styles.errorBox}>
                <Text style={styles.errorIcon}>!</Text>
                <Text style={styles.errorText}>
                  {uploadError ||
                    'Failed. Your file is safe.'}
                </Text>
              </View>
            )}

            {currentStage === 'failed_triage' && (
              <View style={styles.errorBox}>
                <Text style={styles.errorIcon}>i</Text>
                <Text style={styles.errorInfo}>
                  Not a medical record.
                </Text>
              </View>
            )}

            {pausedNote && !terminal && (
              <View style={styles.errorBox}>
                <Text style={styles.errorIcon}>…</Text>
                <Text style={styles.errorInfo}>{pausedNote}</Text>
              </View>
            )}
          </GlassSurface>
          </Entrance>

          {terminal ? (
            <Entrance index={2}>
            <View style={styles.actions}>
              <Button title="Done" onPress={handleDone} fullWidth />
              {currentStage === 'completed' && (
                <Button
                  title="View in Timeline"
                  variant="secondary"
                  onPress={handleDone}
                  fullWidth
                />
              )}
            </View>
            </Entrance>
          ) : (
            <Text style={styles.hint}>
              Keeps going in background.
            </Text>
          )}
        </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // =====================================================================
  // RENDER — File selection / preview
  // =====================================================================
  return (
    <View style={styles.screen}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Entrance index={0}>
          <View style={styles.header}>
            <Text style={styles.title}>Records</Text>
            <Text style={styles.subtitle}>PDF, PNG, JPG · max {formatFileSize(MAX_FILE_SIZE)}</Text>
          </View>
        </Entrance>

        {/* Free tier is always paywalled (0 scans); General shows a quota
            card once its 4 monthly scans run out; All-in passes through. */}
        <PaywallGate
          feature="documentScan"
          title="Document scans"
          quotaNote={quotaExhausted ? '4 document scans included in General each month.' : undefined}
        >
        {!selectedFile ? (
          <Entrance index={1}>
          <View style={styles.choiceWrap}>
            <Pressable
              onPress={pickFile}
              accessibilityRole="button"
              accessibilityLabel="Upload a new document"
              style={({ pressed }) => [styles.choicePrimary, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.choicePrimaryText}>Upload new</Text>
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('Documents' as never)}
              accessibilityRole="button"
              accessibilityLabel="View past uploads"
              style={({ pressed }) => [styles.choiceSecondary, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.choiceSecondaryText}>Past uploads</Text>
            </Pressable>
          </View>
          </Entrance>
        ) : (
          <Entrance index={1}>
          <GlassSurface strong style={styles.previewCard}>
            <View style={styles.previewRow}>
              <View style={styles.previewIcon}>
                <Text style={styles.previewIconText}>
                  {selectedFile.type.includes('pdf')
                    ? 'PDF'
                    : selectedFile.type.includes('json') || selectedFile.name.toLowerCase().endsWith('.json')
                      ? 'FHIR'
                      : 'IMG'}
                </Text>
              </View>
              <View style={styles.previewInfo}>
                <Text style={styles.previewName} numberOfLines={1}>
                  {selectedFile.name}
                </Text>
                <Text style={styles.previewMeta}>
                  {selectedFile.type.includes('pdf')
                    ? 'PDF'
                    : selectedFile.type.includes('json') || selectedFile.name.toLowerCase().endsWith('.json')
                      ? 'FHIR Bundle'
                      : 'Image'}{' '}
                  ·{' '}
                  {formatFileSize(selectedFile.size)}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={() => {
                setSelectedFile(null);
                setValidationError(null);
              }}
              style={styles.changeFile}
            >
              <Text style={styles.changeFileText}>Change file</Text>
            </Pressable>
          </GlassSurface>
          </Entrance>
        )}

        {validationError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorIcon}>!</Text>
            <Text style={styles.errorText}>{validationError}</Text>
          </View>
        ) : null}

        <Entrance index={2}>
        <View style={styles.actions}>
          <Button
            title="Upload"
            onPress={handleUpload}
            disabled={!selectedFile || anotherUploadRunning}
            fullWidth
          />
        </View>
        </Entrance>
        {anotherUploadRunning ? (
          <Text style={styles.hint}>
            One upload at a time.
          </Text>
        ) : null}
        </PaywallGate>
      </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: LG.stage.bottom,
  },
  safe: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 26,
    paddingTop: 20,
    paddingBottom: 48,
    gap: 16,
  },
  header: { paddingTop: 16, paddingBottom: 4, gap: 3 },
  title: {
    fontWeight: '600',
    fontSize: 34,
    lineHeight: 41,
    letterSpacing: -0.8,
    color: '#FFFFFF',
    textAlign: 'left',
  },
  subtitle: {
    fontWeight: '400',
    fontSize: 17,
    lineHeight: 22,
    color: 'rgba(233,240,255,0.66)',
    textAlign: 'left',
    marginTop: 0,
    fontVariant: ['tabular-nums'],
  },

  // Two choices, middle of the screen
  choiceWrap: {
    flex: 1,
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 32,
  },
  choicePrimary: {
    minHeight: 56,
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  choicePrimaryText: {
    fontWeight: '600',
    fontSize: 16,
    lineHeight: 22,
    color: '#0B0F1A',
  },
  choiceSecondary: {
    minHeight: 56,
    borderRadius: 9999,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceSecondaryText: {
    fontWeight: '600',
    fontSize: 16,
    lineHeight: 22,
    color: '#FFFFFF',
  },

  // Preview
  previewCard: {
    marginTop: 0,
    padding: 16,
  },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  previewIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewIconText: { fontWeight: '700', fontSize: 13, lineHeight: 18, color: '#FFFFFF' },
  previewInfo: { flex: 1, gap: 2 },
  previewName: { fontWeight: '600', fontSize: 17, lineHeight: 22, letterSpacing: -0.1, color: '#FFFFFF' },
  previewMeta: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: 'rgba(233,240,255,0.66)', fontVariant: ['tabular-nums'] },
  changeFile: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  changeFileText: { fontWeight: '600', fontSize: 13, lineHeight: 18, color: LG.card.mint },

  // Errors — danger-tinted glass
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,142,142,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,142,142,0.35)',
    padding: 14,
    borderRadius: 16,
  },
  errorIcon: { fontWeight: '700', fontSize: 17, lineHeight: 22, color: LG.card.danger },
  errorText: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: LG.card.danger, flex: 1 },
  errorInfo: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: 'rgba(233,240,255,0.66)', flex: 1 },

  // Actions
  actions: { gap: 8, marginTop: 0 },

  // Processing
  processingCard: {
    gap: 16,
    padding: 20,
  },
  stageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    position: 'relative',
  },
  stageDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageCheck: { color: '#0B0F1A', fontSize: 14, fontWeight: '700' },
  stageContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stageLabel: { fontWeight: '400', fontSize: 15, lineHeight: 22 },
  stageLabelActive: { color: '#FFFFFF', fontWeight: '600' },
  stageLabelInactive: { color: 'rgba(233,240,255,0.45)' },
  stageSpinner: { marginLeft: 8 },
  stageLine: {
    position: 'absolute',
    left: 13,
    top: 30,
    width: 2,
    height: 20,
  },

  hint: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233,240,255,0.66)',
    textAlign: 'center',
    marginTop: 0,
  },
});
