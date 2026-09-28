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
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { Button, Card } from '@/components';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import {
  useDocuments,
  type ProcessingStage,
} from '@/context/DocumentsContext';
import { formatFileSize } from '@/services/documents';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const ACCEPTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg'];
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

function stageInfo(stage: string): { label: string; color: string } {
  switch (stage) {
    case 'uploading':
      return { label: 'Uploading', color: GV.fx.sky };
    case 'uploaded':
      return { label: 'Uploaded', color: GV.fx.green };
    case 'processing':
      return {
        label: 'Processing',
        color: GV.fx.amber,
      };
    case 'extracted':
      return { label: 'Extracted', color: GV.fx.green };
    case 'completed':
      return { label: 'Complete', color: GV.cta };
    case 'failed':
    case 'failed_triage':
      return { label: 'Failed', color: GV.danger };
    default:
      return { label: stage, color: GV.muted };
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
          'Unsupported file type. Please upload a PDF, PNG, JPG, or JPEG file.',
        );
        return;
      }
      if (asset.size && asset.size > MAX_FILE_SIZE) {
        setValidationError(
          `File is too large (${formatFileSize(asset.size)}). Maximum size is ${formatFileSize(MAX_FILE_SIZE)}.`,
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
      setValidationError('Failed to select file. Please try again.');
    }
  }, []);

  // ---- Upload (single active upload: the button stays disabled while
  // any document is mid-pipeline, and the context guard below rejects a
  // second start with a friendly message instead of a duplicate entry) ----
  const handleUpload = useCallback(() => {
    if (!selectedFile || anotherUploadRunning) return;
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
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {terminal ? 'Status' : 'Processing'}
            </Text>
            <Text style={styles.subtitle}>{selectedFile?.name ?? ''}</Text>
          </View>

          <Card padding="lg" style={styles.processingCard}>
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
                          ? sInfo.color
                          : GV.line,
                      },
                      isCurrent && styles.stageDotActive,
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
                        color={GV.cta}
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
                            ? GV.cta
                            : GV.line,
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
                    'Processing failed. Your original document is still safe.'}
                </Text>
              </View>
            )}

            {currentStage === 'failed_triage' && (
              <View style={styles.errorBox}>
                <Text style={styles.errorIcon}>i</Text>
                <Text style={styles.errorInfo}>
                  This document was not recognized as a medical record.
                </Text>
              </View>
            )}

            {pausedNote && !terminal && (
              <View style={styles.errorBox}>
                <Text style={styles.errorIcon}>⏸</Text>
                <Text style={styles.errorInfo}>{pausedNote}</Text>
              </View>
            )}
          </Card>

          {terminal ? (
            <View style={styles.actions}>
              <Button title="Done" onPress={handleDone} fullWidth />
              {currentStage === 'completed' && (
                <Button
                  title="View in Timeline"
                  variant="outline"
                  onPress={handleDone}
                  fullWidth
                  style={styles.outlineBtn}
                  textStyle={styles.outlineBtnText}
                />
              )}
            </View>
          ) : (
            <Text style={styles.hint}>
              You can navigate away. Processing continues automatically.
            </Text>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // =====================================================================
  // RENDER — File selection / preview
  // =====================================================================
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Records</Text>
        </View>

        {!selectedFile ? (
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
            <Text style={styles.choiceHint}>
              PDF, PNG, JPG · max {formatFileSize(MAX_FILE_SIZE)}
            </Text>
          </View>
        ) : (
          <Card padding="md" style={styles.previewCard}>
            <View style={styles.previewRow}>
              <View style={styles.previewIcon}>
                <Text style={styles.previewIconText}>
                  {selectedFile.type.includes('pdf') ? 'PDF' : 'IMG'}
                </Text>
              </View>
              <View style={styles.previewInfo}>
                <Text style={styles.previewName} numberOfLines={1}>
                  {selectedFile.name}
                </Text>
                <Text style={styles.previewMeta}>
                  {selectedFile.type.includes('pdf') ? 'PDF' : 'Image'} ·{' '}
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
          </Card>
        )}

        {validationError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorIcon}>!</Text>
            <Text style={styles.errorText}>{validationError}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            title="Upload"
            onPress={handleUpload}
            disabled={!selectedFile || anotherUploadRunning}
            fullWidth
          />
        </View>
        {anotherUploadRunning ? (
          <Text style={styles.hint}>
            An upload is already in progress. It will finish automatically.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const NAVY = '#080A11';
const TILE_BG = '#2A3049';
const HAIRLINE_ON_NAVY = 'rgba(255, 255, 255, 0.12)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: NAVY },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 32,
    gap: 12,
  },
  header: { paddingVertical: 16, alignItems: 'center' },
  title: {
    fontFamily: FONT.semi,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.3,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  subtitle: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
    marginTop: 8,
  },
  outlineBtn: {
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  outlineBtnText: {
    color: '#FFFFFF',
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
    ...TYPE.button,
    fontSize: 16,
    color: NAVY,
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
    ...TYPE.button,
    fontSize: 16,
    color: '#FFFFFF',
  },
  choiceHint: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },

  // Preview
  previewCard: {
    marginTop: 8,
    backgroundColor: TILE_BG,
    borderColor: HAIRLINE_ON_NAVY,
    borderWidth: 1,
    borderRadius: 8,
  },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  previewIcon: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewIconText: { ...TYPE.caption, fontFamily: FONT.semi, color: GV.teal },
  previewInfo: { flex: 1, gap: 2 },
  previewName: { ...TYPE.body, fontFamily: FONT.semi, color: '#FFFFFF' },
  previewMeta: { ...TYPE.caption, color: GV.fog, fontVariant: ['tabular-nums'] },
  changeFile: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE_ON_NAVY,
    alignItems: 'center',
  },
  changeFileText: { ...TYPE.caption, fontFamily: FONT.semi, color: GV.teal },

  // Errors — dark well
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    padding: 12,
    borderRadius: 8,
  },
  errorIcon: { ...TYPE.title, color: GV.danger },
  errorText: { ...TYPE.caption, color: GV.danger, flex: 1 },
  errorInfo: { ...TYPE.caption, color: GV.fog, flex: 1 },

  // Actions
  actions: { gap: 8, marginTop: 8 },

  // Processing
  processingCard: {
    gap: 16,
    backgroundColor: TILE_BG,
    borderColor: HAIRLINE_ON_NAVY,
    borderWidth: 1,
    borderRadius: 8,
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
  stageDotActive: {},
  stageCheck: { color: '#FFFFFF', fontSize: 14, fontFamily: FONT.semi },
  stageContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stageLabel: { ...TYPE.body },
  stageLabelActive: { color: '#FFFFFF', fontFamily: FONT.semi },
  stageLabelInactive: { color: GV.fog },
  stageSpinner: { marginLeft: 8 },
  stageLine: {
    position: 'absolute',
    left: 13,
    top: 30,
    width: 2,
    height: 20,
  },

  hint: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    marginTop: 8,
  },
});
