/**
 * DocumentDetailScreen — Shows extracted medical data from a processed document.
 *
 * Displays: document type, extracted sections/results, alerts, raw markdown,
 * and source evidence. This is the "review" screen after processing completes.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Sharing from 'expo-sharing';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';
import { Button } from '@/components';
import { HealthFact } from '@/components/HealthFact';
import { useDocuments, type DocumentsContextValue } from '@/context/DocumentsContext';
import {
  getDocument,
  isDocumentProcessing,
  statusLabel,
  documentTypeLabel,
  cachedFileExists,
  downloadDocumentFile,
} from '@/services/documents';
import { setDocumentLocalUri, getDocumentVerification, setDocumentVerification } from '@/db/queries/documents';
import { getCachedPatientId } from '@/services/patientIdentity';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { StageGradient } from '@/components/StageGradient';
import type {
  DocumentListItem,
  DocumentExtraction,
  RootStackParamList,
} from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RouteParams = RouteProp<RootStackParamList, 'DocumentDetail'>;

/**
 * Where a resolved file should open. Android WebView cannot render PDFs
 * (blank page, no error), so PDFs and unknown types go to the OS viewer
 * via the share sheet; images render inline. Pure for testability.
 */
export function viewerForUri(uri: string): 'webview' | 'share' {
  const lower = uri.toLowerCase();
  return (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.gif')
  )
    ? 'webview'
    : 'share';
}

interface LabSection {
  section_title?: string;
  results?: Array<{
    test_name?: string;
    result?: string | number;
    unit?: string;
    reference_range?: string;
    flag?: string;
    source_text?: string;
  }>;
  diagnosis?: string;
  comments?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DocumentDetailScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation();
  const { fetchExtraction, documents, refetchDocuments } = useDocuments();
  const documentId = route.params?.documentId;

  const [document, setDocument] = useState<DocumentListItem | null>(null);
  const [extraction, setExtraction] = useState<DocumentExtraction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Original-file viewer (offline-first) ----
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // ---- Reading verification (user confirms before it counts as reviewed)
  const [verified, setVerified] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState('');
  const [verifying, setVerifying] = useState(false);

  // Decrypted temp files (sealed cache opened for viewing/sharing).
  // Wiped on close — decrypted bytes must never linger on disk.
  const tempUris = useRef<Set<string>>(new Set());
  const wipeTemps = useCallback(async () => {
    const { wipeFile } = await import('@/services/fileVault');
    await Promise.all([...tempUris.current].map((u) => wipeFile(u)));
    tempUris.current.clear();
  }, []);
  useEffect(() => () => {
    void wipeTemps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeViewer = useCallback(() => {
    setViewerUri(null);
    void wipeTemps();
  }, [wipeTemps]);

  const openOriginal = useCallback(async () => {
    if (!document) return;
    setFileError(null);
    let sharedTemp: string | null = null;
    try {
      // 1. Use the on-device copy when it exists (works offline).
      let uri: string | null = null;
      if (await cachedFileExists(document.local_uri)) {
        uri = document.local_uri as string;
      } else {
        // 2. Otherwise download once, remember the path, then open.
        setFileLoading(true);
        const patientId = getCachedPatientId();
        const downloaded = await downloadDocumentFile(document.document_id, document.file_hash);
        if (patientId) {
          await setDocumentLocalUri(patientId, document.document_id, downloaded).catch(() => {});
          setDocument((prev) => (prev ? { ...prev, local_uri: downloaded } : prev));
        }
        uri = downloaded;
      }
      // 3. Sealed cache opens to a short-lived temp file (wiped on close).
      const { isSealedUri, openSealedFile } = await import('@/services/fileVault');
      const patientId = getCachedPatientId();
      if (uri && isSealedUri(uri) && patientId) {
        uri = await openSealedFile(patientId, uri);
        tempUris.current.add(uri);
        sharedTemp = uri;
      }
      // 4. PDFs (and unknown types) go to the OS viewer — Android WebView
      // renders a blank page for PDFs with no error. Images stay inline.
      // The file is on-device and private in both paths.
      if (viewerForUri(uri) === 'share') {
        setFileLoading(true);
        if (!(await Sharing.isAvailableAsync())) {
          setFileError('No app on this device can open this file type.');
          return;
        }
        try {
          await Sharing.shareAsync(uri, { dialogTitle: 'Open original document' });
        } finally {
          // The decrypted temp must not survive the share sheet.
          if (sharedTemp) {
            const { wipeFile } = await import('@/services/fileVault');
            await wipeFile(sharedTemp);
            tempUris.current.delete(sharedTemp);
          }
        }
        return;
      }
      setViewerUri(uri);
    } catch {
      setFileError('Could not load the file. Connect to the internet and try again.');
      if (sharedTemp) {
        const { wipeFile } = await import('@/services/fileVault');
        await wipeFile(sharedTemp);
        tempUris.current.delete(sharedTemp);
      }
    } finally {
      setFileLoading(false);
    }
  }, [document]);

  // -----------------------------------------------------------------------
  // Load document + extraction data
  // -----------------------------------------------------------------------
  const loadData = useCallback(async () => {
    if (!documentId) return;

    try {
      setLoading(true);
      setError(null);

      // Try to find document in context first
      const fromContext = documents.find((d) => d.document_id === documentId);
      if (fromContext) {
        setDocument(fromContext);
      } else {
        const doc = await getDocument(documentId);
        setDocument(doc);
      }

      // Fetch extraction data
      const ext = await fetchExtraction(documentId);
      setExtraction(ext);

      // Fetch local verify state
      const patientId = getCachedPatientId();
      if (patientId) {
        const v = await getDocumentVerification(patientId, documentId).catch(() => null);
        if (v) {
          setVerified(v.verified);
          setSavedNote(v.note);
          setNote(v.note ?? '');
          setChecked(v.verified);
        }
      }
    } catch (err) {
      console.error('[DocumentDetail] Load error:', err);
      setError('Failed to load document details.');
    } finally {
      setLoading(false);
    }
  }, [documentId, documents, fetchExtraction]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // -----------------------------------------------------------------------
  // Refresh when coming back (e.g., after processing completes)
  // -----------------------------------------------------------------------
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (documentId) loadData();
    });
    return unsubscribe;
  }, [navigation, documentId, loadData]);

  const markVerified = useCallback(async () => {
    if (!documentId || !checked) return;
    const patientId = getCachedPatientId();
    if (!patientId) return;
    setVerifying(true);
    try {
      const clean = note.trim() ? note.trim() : null;
      await setDocumentVerification(patientId, documentId, true, clean);
      setVerified(true);
      setSavedNote(clean);
    } catch {
      // Local-only write; a failure leaves the unverified state in place.
    } finally {
      setVerifying(false);
    }
  }, [documentId, checked, note]);

  const reopenReview = useCallback(async () => {
    if (!documentId) return;
    const patientId = getCachedPatientId();
    if (!patientId) return;
    setVerifying(true);
    try {
      await setDocumentVerification(patientId, documentId, false);
      setVerified(false);
      setChecked(false);
    } catch {
      // Best-effort; the verified state stays.
    } finally {
      setVerifying(false);
    }
  }, [documentId]);

  // -----------------------------------------------------------------------
  // Render — Loading
  // -----------------------------------------------------------------------
  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={GV.cta} />
          <Text style={styles.centerText}>Loading document...</Text>
          <HealthFact style={styles.factText} />
        </View>
      </SafeAreaView>
    );
  }

  // -----------------------------------------------------------------------
  // Render — Error
  // -----------------------------------------------------------------------
  if (error || !document) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.centerText}>{error || 'Document not found.'}</Text>
          <Button title="Go back" onPress={() => navigation.goBack()} />
        </View>
      </SafeAreaView>
    );
  }

  // -----------------------------------------------------------------------
  // Extract structured data
  // -----------------------------------------------------------------------
  const docData = extraction?.extraction?.document;
  const sections: LabSection[] = docData?.sections ?? [];
  const alerts = docData?.alerts ?? [];
  const patient = docData?.patient;
  const title = docData?.title || docData?.document_type || 'Medical Document';
  const docType = extraction?.gateway_json?.document_type;
  // Canonical status interpretation: EXTRACTED means the raw extraction
  // committed but de-identification, vector indexing, timeline mapping and
  // anatomical recording may still be running — genuinely non-terminal, so
  // the spinner stays until the backend reports COMPLETED or FAILED.
  const isProcessing = isDocumentProcessing(document.status);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StageGradient />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.headerInfo}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>
                {docType ? documentTypeLabel(docType) : 'Medical Document'}
              </Text>
            </View>
            <View
                style={[
                  styles.statusBadge,
                  {
                    backgroundColor: 'rgba(255, 255, 255, 0.06)',
                  },
                ]}
            >
              <Text
                style={[
                  styles.statusText,
                  {
                    color:
                      document.status === 'COMPLETED'
                        ? GV.teal
                        : document.status === 'FAILED'
                          ? GV.danger
                          : '#FFFFFF',
                  },
                ]}
              >
                {statusLabel(document.status)}
              </Text>
            </View>
          </View>
          <Text style={styles.date}>
            Uploaded {new Date(document.created_at).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </Text>
          <View style={styles.fileRow}>
            <Button
              title={fileLoading ? 'Loading file...' : 'View original'}
              variant="outline"
              onPress={openOriginal}
              disabled={fileLoading}
            />
          </View>
          {fileError ? <Text style={styles.fileError}>{fileError}</Text> : null}
        </View>

        {/* Reading verification — confirms before the reading counts */}
        {extraction && !isProcessing ? (
          <View style={[styles.tile, styles.verifyCard]}>
            {verified ? (
              <View style={styles.verifyDoneRow}>
                <Text style={styles.verifyDone}>Verified ✓</Text>
                <Pressable
                  onPress={() => void reopenReview()}
                  disabled={verifying}
                  accessibilityRole="button"
                  accessibilityLabel="Reopen review"
                  hitSlop={8}
                  style={styles.reopenBtn}
                >
                  <Text style={styles.reopenText}>Reopen</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={styles.verifyBanner}>
                  Check every detail against the original. Wrong readings are your responsibility.
                </Text>
                <Pressable
                  onPress={() => setChecked((v) => !v)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  accessibilityLabel="I checked this reading against the original"
                  style={styles.verifyCheck}
                >
                  <View style={[styles.verifyBox, checked && styles.verifyBoxOn]}>
                    {checked ? <Text style={styles.verifyGlyph}>✓</Text> : null}
                  </View>
                  <Text style={styles.verifyLabel}>
                    I checked this reading against the original.
                  </Text>
                </Pressable>
              </>
            )}
            {verified && savedNote ? (
              <Text style={styles.verifyNote}>{savedNote}</Text>
            ) : null}
            {!verified ? (
              <>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="Correction note (optional)"
                  placeholderTextColor={GV.fog}
                  multiline
                  numberOfLines={2}
                  style={styles.verifyInput}
                />
                <Button
                  title={verifying ? 'Saving…' : 'Mark verified'}
                  onPress={() => void markVerified()}
                  disabled={!checked || verifying}
                  fullWidth
                />
              </>
            ) : null}
          </View>
        ) : null}

        {/* Processing spinner */}
        {isProcessing && (
          <View style={styles.tile}>
            <View style={styles.processingRow}>
              <ActivityIndicator size="small" color={GV.cta} />
              <Text style={styles.processingText}>
                Still processing. Check back shortly.
              </Text>
            </View>
          </View>
        )}

        {/* Alerts */}
        {alerts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Clinical Alerts</Text>
            {alerts.map((alert, i) => (
              <View key={i} style={[styles.tile, styles.alertCard]}>
                <Text style={styles.alertSeverity}>
                  {alert.severity ?? 'Alert'}
                </Text>
                <Text style={styles.alertMessage}>{alert.message}</Text>
                {alert.page_number != null && (
                  <Text style={styles.alertPage}>Page {alert.page_number}</Text>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Patient info */}
        {patient && (patient.name || patient.age || patient.sex) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Patient Information</Text>
            <View style={styles.tile}>
              {patient.name && (
                <InfoRow label="Name" value={patient.name} />
              )}
              {patient.age && (
                <InfoRow label="Age" value={patient.age} />
              )}
              {patient.sex && (
                <InfoRow label="Sex" value={patient.sex} />
              )}
              {patient.date_of_birth && (
                <InfoRow label="DOB" value={patient.date_of_birth} />
              )}
            </View>
          </View>
        )}

        {/* Clinical information */}
        {docData?.clinical_information && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Clinical Information</Text>
            <View style={styles.tile}>
              <Text style={styles.bodyText}>{docData.clinical_information}</Text>
            </View>
          </View>
        )}

        {/* Lab sections */}
        {sections.map((section, i) => (
          <View key={i} style={styles.section}>
            <Text style={styles.sectionTitle}>
              {section.section_title || `Section ${i + 1}`}
            </Text>
            <View style={styles.tile}>
              {section.results && section.results.length > 0 ? (
                section.results.map((result, j) => (
                  <View key={j} style={styles.resultRow}>
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultName}>{result.test_name}</Text>
                      {result.reference_range && (
                        <Text style={styles.resultRange}>
                          Ref: {result.reference_range}
                        </Text>
                      )}
                    </View>
                    <View style={styles.resultValue}>
                      <Text
                        style={[
                          styles.resultValueText,
                          result.flag &&
                            (result.flag.toUpperCase().includes('H') ||
                              result.flag.toUpperCase().includes('L') ||
                              result.flag.toUpperCase().includes('CRITICAL'))
                              ? styles.resultAbnormal
                              : null,
                        ]}
                      >
                        {result.result} {result.unit ?? ''}
                      </Text>
                      {result.flag && (
                        <Text
                          style={[
                            styles.resultFlag,
                            result.flag.toUpperCase().includes('CRITICAL')
                              ? styles.resultFlagCritical
                              : null,
                          ]}
                        >
                          {result.flag}
                        </Text>
                      )}
                    </View>
                  </View>
                ))
              ) : null}

              {section.diagnosis && (
                <View style={styles.findingBlock}>
                  <Text style={styles.findingLabel}>Diagnosis</Text>
                  <Text style={styles.findingText}>{section.diagnosis}</Text>
                </View>
              )}

              {section.comments && (
                <View style={styles.findingBlock}>
                  <Text style={styles.findingLabel}>Comments</Text>
                  <Text style={styles.findingText}>{section.comments}</Text>
                </View>
              )}
            </View>
          </View>
        ))}

        {/* Markdown preview (collapsed) */}
        {extraction?.markdown_text && (
          <MarkdownPreview markdown={extraction.markdown_text} />
        )}

        {/* Gateway classification info */}
        {extraction?.gateway_json && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Classification</Text>
            <View style={styles.tile}>
              <InfoRow
                label="Medical"
                value={extraction.gateway_json.is_medical ? 'Yes' : 'No'}
              />
              <InfoRow
                label="Type"
                value={
                  extraction.gateway_json.document_type
                    ? documentTypeLabel(extraction.gateway_json.document_type)
                    : 'Unknown'
                }
              />
              {extraction.gateway_json.type_text && (
                <InfoRow
                  label="Detected text"
                  value={extraction.gateway_json.type_text}
                />
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Original-file viewer (PDF / image, works offline from cache) */}
      <Modal
        visible={viewerUri !== null}
        animationType="slide"
        onRequestClose={closeViewer}
      >
        <SafeAreaView style={styles.viewerContainer} edges={['top', 'bottom']}>
          <View style={styles.viewerHeader}>
            <Pressable onPress={closeViewer} hitSlop={12}>
              <Text style={styles.viewerClose}>‹ Back</Text>
            </Pressable>
            <Text style={styles.viewerTitle} numberOfLines={1}>
              Original document
            </Text>
            <View style={styles.viewerSpacer} />
          </View>
          {viewerUri ? (
            <WebView
              source={{ uri: viewerUri }}
              style={styles.viewer}
              originWhitelist={['*']}
              allowFileAccess
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={infoStyles.row}>
      <Text style={infoStyles.label}>{label}</Text>
      <Text style={infoStyles.value}>{value}</Text>
    </View>
  );
}

const infoStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.12)',
  },
  label: {
    ...TYPE.caption,
    color: GV.fog,
  },
  value: {
    ...TYPE.body,
    fontFamily: FONT.semi,
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'right',
    marginLeft: 16,
  },
});

function MarkdownPreview({ markdown }: { markdown: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = markdown.slice(0, 500);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Extracted Text</Text>
      <View style={styles.tile}>
        <Text style={styles.markdownText} numberOfLines={expanded ? undefined : 8}>
          {expanded ? markdown : preview}
          {!expanded && markdown.length > 500 ? '...' : ''}
        </Text>
        {markdown.length > 500 && (
          <Pressable onPress={() => setExpanded(!expanded)}>
            <Text style={styles.expandToggle}>
              {expanded ? 'Show less' : 'Show full text'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080A11',
  },
  content: {
    paddingHorizontal: SPACE.screenH,
    paddingBottom: 32,
    gap: SPACE.cardGap,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACE.cardPad,
    gap: SPACE.cardGap,
  },
  centerText: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
  },
  factText: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    maxWidth: 300,
  },
  header: {
    paddingVertical: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
  },
  headerInfo: {
    flex: 1,
  },
  title: {
    ...TYPE.display,
    color: '#FFFFFF',
  },
  subtitle: {
    ...TYPE.body,
    color: GV.fog,
    marginTop: 8,
  },
  date: {
    ...TYPE.caption,
    color: GV.fog,
    marginTop: 8,
  },
  fileRow: {
    marginTop: 12,
  },
  fileError: {
    ...TYPE.caption,
    color: GV.danger,
    marginTop: 8,
  },
  tile: {
    backgroundColor: '#2A3049',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 8,
    padding: 16,
    gap: 10,
  },
  verifyCard: {
    gap: 10,
  },
  verifyBanner: {
    ...TYPE.body,
    fontSize: 14,
    fontFamily: FONT.semi,
    color: GV.danger,
    backgroundColor: 'rgba(214,69,69,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(214,69,69,0.35)',
    borderRadius: 12,
    padding: 12,
    overflow: 'hidden',
  },
  verifyCheck: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
  },
  verifyBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: GV.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifyBoxOn: {
    backgroundColor: GV.teal,
  },
  verifyGlyph: {
    color: '#062A26',
    fontSize: 13,
    fontWeight: '700',
  },
  verifyLabel: {
    ...TYPE.body,
    fontSize: 14,
    color: '#FFFFFF',
    flex: 1,
  },
  verifyInput: {
    ...TYPE.body,
    color: '#FFFFFF',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  verifyDoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  verifyDone: {
    ...TYPE.title,
    fontSize: 16,
    color: GV.teal,
  },
  reopenBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  reopenText: {
    ...TYPE.chip,
    color: GV.teal,
  },
  verifyNote: {
    ...TYPE.body,
    color: '#FFFFFF',
  },
  viewerContainer: {
    flex: 1,
    backgroundColor: '#10141F',
  },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  viewerClose: {
    ...TYPE.body,
    fontFamily: FONT.semi,
    color: GV.teal,
  },
  viewerTitle: {
    ...TYPE.body,
    fontFamily: FONT.semi,
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
  },
  viewerSpacer: {
    width: 48,
  },
  viewer: {
    flex: 1,
    backgroundColor: '#10141F',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: SPACE.rPill,
  },
  statusText: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    ...TYPE.title,
    color: '#FFFFFF',
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  processingText: {
    ...TYPE.body,
    color: '#FFFFFF',
  },
  alertCard: {},
  alertSeverity: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    color: '#FFFFFF',
    marginBottom: 8,
  },
  alertMessage: {
    ...TYPE.body,
    color: '#FFFFFF',
  },
  alertPage: {
    ...TYPE.caption,
    color: GV.fog,
    marginTop: 8,
  },
  bodyText: {
    ...TYPE.body,
    color: '#FFFFFF',
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.12)',
    gap: 8,
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    ...TYPE.body,
    fontFamily: FONT.semi,
    color: '#FFFFFF',
  },
  resultRange: {
    ...TYPE.caption,
    color: GV.fog,
    marginTop: 2,
  },
  resultValue: {
    alignItems: 'flex-end',
  },
  resultValueText: {
    ...TYPE.body,
    fontFamily: FONT.semi,
    color: '#FFFFFF',
  },
  resultAbnormal: {
    color: GV.danger,
  },
  resultFlag: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    color: '#FFFFFF',
    fontSize: 10,
    marginTop: 2,
  },
  resultFlagCritical: {
    color: GV.danger,
  },
  findingBlock: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
  },
  findingLabel: {
    ...TYPE.caption,
    color: GV.fog,
    marginBottom: 8,
  },
  findingText: {
    ...TYPE.body,
    color: '#FFFFFF',
  },
  markdownText: {
    ...TYPE.caption,
    color: '#FFFFFF',
  },
  expandToggle: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    color: GV.teal,
    marginTop: 8,
  },
});
