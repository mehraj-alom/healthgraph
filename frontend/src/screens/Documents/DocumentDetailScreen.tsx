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
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { SPACE } from '@/theme/guava';
import { LG } from '@/theme/liquidGlass';
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
import type {
  DocumentListItem,
  DocumentExtraction,
  RootStackParamList,
} from '@/types';

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

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

  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [verified, setVerified] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState('');
  const [verifying, setVerifying] = useState(false);

  const tempUris = useRef<Set<string>>(new Set());
  const wipeTemps = useCallback(async () => {
    const { wipeFile } = await import('@/services/fileVault');
    await Promise.all([...tempUris.current].map((u) => wipeFile(u)));
    tempUris.current.clear();
  }, []);
  useEffect(() => () => {
    void wipeTemps();
  }, [wipeTemps]);

  const closeViewer = useCallback(() => {
    setViewerUri(null);
    void wipeTemps();
  }, [wipeTemps]);

  const openOriginal = useCallback(async () => {
    if (!document) return;
    setFileError(null);
    let sharedTemp: string | null = null;
    try {
      let uri: string | null = null;
      if (await cachedFileExists(document.local_uri)) {
        uri = document.local_uri as string;
      } else {
        setFileLoading(true);
        const patientId = getCachedPatientId();
        const downloaded = await downloadDocumentFile(document.document_id, document.file_hash);
        if (patientId) {
          await setDocumentLocalUri(patientId, document.document_id, downloaded).catch(() => {});
          setDocument((prev) => (prev ? { ...prev, local_uri: downloaded } : prev));
        }
        uri = downloaded;
      }
      const { isSealedUri, openSealedFile } = await import('@/services/fileVault');
      const patientId = getCachedPatientId();
      if (uri && isSealedUri(uri) && patientId) {
        uri = await openSealedFile(patientId, uri);
        tempUris.current.add(uri);
        sharedTemp = uri;
      }
      if (viewerForUri(uri) === 'share') {
        setFileLoading(true);
        if (!(await Sharing.isAvailableAsync())) {
          setFileError('No app on this device can open this file type.');
          return;
        }
        try {
          await Sharing.shareAsync(uri, { dialogTitle: 'Open original document' });
        } finally {
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

  const loadData = useCallback(async () => {
    if (!documentId) return;

    try {
      setLoading(true);
      setError(null);

      const fromContext = documents.find((d) => d.document_id === documentId);
      if (fromContext) {
        setDocument(fromContext);
      } else {
        const doc = await getDocument(documentId);
        setDocument(doc);
      }

      const ext = await fetchExtraction(documentId);
      setExtraction(ext);

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
    } finally {
      setVerifying(false);
    }
  }, [documentId]);

  if (loading) {
    return (
      <View style={styles.root}>
        <HomeStageBackdrop />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.center}>
            <ActivityIndicator size="large" color={LG.card.mint} />
            <Text style={styles.centerText}>Loading document...</Text>
            <HealthFact style={styles.factText} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (error || !document) {
    return (
      <View style={styles.root}>
        <HomeStageBackdrop />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.center}>
            <Text style={styles.centerText}>{error || 'Document not found.'}</Text>
            <Button title="Go back" variant="secondary" onPress={() => navigation.goBack()} style={styles.primaryBtn} textStyle={styles.primaryBtnText} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const docData = extraction?.extraction?.document;
  const sections: LabSection[] = docData?.sections ?? [];
  const alerts = docData?.alerts ?? [];
  const patient = docData?.patient;
  const title = docData?.title || docData?.document_type || 'Medical Document';
  const docType = extraction?.gateway_json?.document_type;
  const isProcessing = isDocumentProcessing(document.status);

  return (
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <View style={styles.headerInfo}>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.subtitle}>
                  {docType ? documentTypeLabel(docType) : 'Medical Document'}
                </Text>
              </View>
              <View style={styles.statusBadge}>
                <Text
                  style={[
                    styles.statusText,
                    {
                      color:
                        document.status === 'COMPLETED'
                          ? LG.card.mint
                          : document.status === 'FAILED'
                            ? LG.card.danger
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
                variant="ghost"
                onPress={openOriginal}
                disabled={fileLoading}
                textStyle={styles.ghostText}
              />
            </View>
            {fileError ? <Text style={styles.fileError}>{fileError}</Text> : null}
          </View>

          {extraction && !isProcessing ? (
            <GlassSurface strong style={styles.tile}>
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
                    placeholderTextColor={TERTIARY}
                    multiline
                    numberOfLines={2}
                    style={styles.verifyInput}
                  />
                  <Button
                    title={verifying ? 'Saving…' : 'Mark verified'}
                    variant="secondary"
                    onPress={() => void markVerified()}
                    disabled={!checked || verifying}
                    fullWidth
                    style={styles.primaryBtn}
                    textStyle={styles.primaryBtnText}
                  />
                </>
              ) : null}
            </GlassSurface>
          ) : null}

          {isProcessing && (
            <GlassSurface strong style={styles.tile}>
              <View style={styles.processingRow}>
                <ActivityIndicator size="small" color={LG.card.mint} />
                <Text style={styles.processingText}>
                  Still processing. Check back shortly.
                </Text>
              </View>
            </GlassSurface>
          )}

          {alerts.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Clinical Alerts</Text>
              {alerts.map((alert, i) => (
                <GlassSurface key={i} strong tint={LG.card.danger} tintOpacity={0.12} style={styles.tile}>
                  <Text style={styles.alertSeverity}>
                    {alert.severity ?? 'Alert'}
                  </Text>
                  <Text style={styles.alertMessage}>{alert.message}</Text>
                  {alert.page_number != null && (
                    <Text style={styles.alertPage}>Page {alert.page_number}</Text>
                  )}
                </GlassSurface>
              ))}
            </View>
          )}

          {patient && (patient.name || patient.age || patient.sex) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Patient Information</Text>
              <GlassSurface strong style={styles.tile}>
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
              </GlassSurface>
            </View>
          )}

          {docData?.clinical_information && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Clinical Information</Text>
              <GlassSurface strong style={styles.tile}>
                <Text style={styles.bodyText}>{docData.clinical_information}</Text>
              </GlassSurface>
            </View>
          )}

          {sections.map((section, i) => (
            <View key={i} style={styles.section}>
              <Text style={styles.sectionTitle}>
                {section.section_title || `Section ${i + 1}`}
              </Text>
              <GlassSurface strong style={styles.tile}>
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
              </GlassSurface>
            </View>
          ))}

          {extraction?.markdown_text && (
            <MarkdownPreview markdown={extraction.markdown_text} />
          )}

          {extraction?.gateway_json && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Classification</Text>
              <GlassSurface strong style={styles.tile}>
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
              </GlassSurface>
            </View>
          )}
        </ScrollView>

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
    </View>
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
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  label: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
  },
  value: {
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 21,
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
      <GlassSurface strong style={styles.tile}>
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
      </GlassSurface>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070F' },
  safe: { flex: 1 },
  content: {
    paddingHorizontal: SPACE.screenH,
    paddingVertical: 12,
    paddingBottom: 32,
    gap: 12,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 12,
  },
  centerText: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
  },
  factText: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    textAlign: 'center',
    maxWidth: 300,
  },
  header: {
    paddingVertical: 8,
    gap: 4,
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
    fontWeight: '600',
    fontSize: 34,
    lineHeight: 41,
    letterSpacing: -0.8,
    color: '#FFFFFF',
  },
  subtitle: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    marginTop: 8,
  },
  date: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: TERTIARY,
    marginTop: 8,
    fontVariant: ['tabular-nums'],
  },
  fileRow: {
    marginTop: 12,
  },
  ghostText: { color: '#FFFFFF' },
  fileError: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: LG.card.danger,
    marginTop: 8,
  },
  tile: {
    padding: 16,
    gap: 10,
  },
  verifyBanner: {
    fontWeight: '600',
    fontSize: 14,
    lineHeight: 20,
    color: LG.card.danger,
    backgroundColor: 'rgba(255,142,142,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,142,142,0.35)',
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
    borderColor: LG.card.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifyBoxOn: {
    backgroundColor: LG.card.mint,
  },
  verifyGlyph: {
    color: '#0B0F1A',
    fontSize: 13,
    fontWeight: '700',
  },
  verifyLabel: {
    fontWeight: '400',
    fontSize: 14,
    lineHeight: 20,
    color: '#FFFFFF',
    flex: 1,
  },
  verifyInput: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: '#FFFFFF',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
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
    fontWeight: '600',
    fontSize: 16,
    lineHeight: 22,
    color: LG.card.mint,
  },
  reopenBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  reopenText: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: LG.card.mint,
  },
  verifyNote: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: '#FFFFFF',
  },
  viewerContainer: {
    flex: 1,
    backgroundColor: '#05070F',
  },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  viewerClose: {
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 21,
    color: LG.card.mint,
  },
  viewerTitle: {
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 21,
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
  },
  viewerSpacer: {
    width: 48,
  },
  viewer: {
    flex: 1,
    backgroundColor: '#05070F',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  statusText: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
  },
  primaryBtn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  primaryBtnText: { color: '#0B0F1A' },
  section: {
    gap: 8,
  },
  sectionTitle: { fontWeight: '600', fontSize: 20, lineHeight: 26, letterSpacing: -0.4, color: '#FFFFFF' },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  processingText: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: '#FFFFFF',
  },
  alertSeverity: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
    marginBottom: 8,
  },
  alertMessage: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: '#FFFFFF',
  },
  alertPage: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    marginTop: 8,
    fontVariant: ['tabular-nums'],
  },
  bodyText: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: '#FFFFFF',
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    gap: 8,
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 21,
    color: '#FFFFFF',
  },
  resultRange: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  resultValue: {
    alignItems: 'flex-end',
  },
  resultValueText: {
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 21,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  resultAbnormal: {
    color: LG.card.danger,
  },
  resultFlag: {
    fontWeight: '600',
    fontSize: 10,
    lineHeight: 14,
    color: '#FFFFFF',
    marginTop: 2,
  },
  resultFlagCritical: {
    color: LG.card.danger,
  },
  findingBlock: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  findingLabel: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    marginBottom: 8,
  },
  findingText: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: '#FFFFFF',
  },
  markdownText: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
  },
  expandToggle: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: LG.card.mint,
    marginTop: 8,
  },
});
