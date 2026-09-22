/**
 * DocumentDetailScreen — Shows extracted medical data from a processed document.
 *
 * Displays: document type, extracted sections/results, alerts, raw markdown,
 * and source evidence. This is the "review" screen after processing completes.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';
import { Button, Card } from '@/components';
import { HealthFact } from '@/components/HealthFact';
import { useDocuments, type DocumentsContextValue } from '@/context/DocumentsContext';
import {
  getDocument,
  statusLabel,
  documentTypeLabel,
  cachedFileExists,
  downloadDocumentFile,
} from '@/services/documents';
import { setDocumentLocalUri } from '@/db/queries/documents';
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

  const openOriginal = useCallback(async () => {
    if (!document) return;
    setFileError(null);
    try {
      // 1. Use the on-device copy when it exists (works offline).
      if (await cachedFileExists(document.local_uri)) {
        setViewerUri(document.local_uri as string);
        return;
      }
      // 2. Otherwise download once, remember the path, then open.
      setFileLoading(true);
      const patientId = getCachedPatientId();
      const uri = await downloadDocumentFile(document.document_id, document.file_hash);
      if (patientId) {
        await setDocumentLocalUri(patientId, document.document_id, uri).catch(() => {});
        setDocument((prev) => (prev ? { ...prev, local_uri: uri } : prev));
      }
      setViewerUri(uri);
    } catch {
      setFileError('Could not load the file. Connect to the internet and try again.');
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
  const isProcessing =
    document.status === 'UPLOADED' ||
    document.status === 'PROCESSING';

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
                  backgroundColor: GV.wash,
                },
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  {
                    color:
                      document.status === 'COMPLETED'
                        ? GV.cta
                        : document.status === 'FAILED'
                          ? GV.danger
                          : GV.body,
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

        {/* Processing spinner */}
        {isProcessing && (
          <Card padding="md">
            <View style={styles.processingRow}>
              <ActivityIndicator size="small" color={GV.cta} />
              <Text style={styles.processingText}>
                Still processing. Check back shortly.
              </Text>
            </View>
          </Card>
        )}

        {/* Alerts */}
        {alerts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Clinical Alerts</Text>
            {alerts.map((alert, i) => (
              <Card key={i} padding="md" style={styles.alertCard}>
                <Text style={styles.alertSeverity}>
                  {alert.severity ?? 'Alert'}
                </Text>
                <Text style={styles.alertMessage}>{alert.message}</Text>
                {alert.page_number != null && (
                  <Text style={styles.alertPage}>Page {alert.page_number}</Text>
                )}
              </Card>
            ))}
          </View>
        )}

        {/* Patient info */}
        {patient && (patient.name || patient.age || patient.sex) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Patient Information</Text>
            <Card padding="md">
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
            </Card>
          </View>
        )}

        {/* Clinical information */}
        {docData?.clinical_information && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Clinical Information</Text>
            <Card padding="md">
              <Text style={styles.bodyText}>{docData.clinical_information}</Text>
            </Card>
          </View>
        )}

        {/* Lab sections */}
        {sections.map((section, i) => (
          <View key={i} style={styles.section}>
            <Text style={styles.sectionTitle}>
              {section.section_title || `Section ${i + 1}`}
            </Text>
            <Card padding="md">
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
            </Card>
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
            <Card padding="md">
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
            </Card>
          </View>
        )}
      </ScrollView>

      {/* Original-file viewer (PDF / image, works offline from cache) */}
      <Modal
        visible={viewerUri !== null}
        animationType="slide"
        onRequestClose={() => setViewerUri(null)}
      >
        <SafeAreaView style={styles.viewerContainer} edges={['top', 'bottom']}>
          <View style={styles.viewerHeader}>
            <Pressable onPress={() => setViewerUri(null)} hitSlop={12}>
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
    borderBottomColor: GV.line,
  },
  label: {
    ...TYPE.caption,
    color: GV.muted,
  },
  value: {
    ...TYPE.body,
    fontFamily: FONT.semi,
    color: GV.ink,
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
      <Card padding="md">
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
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GV.stage,
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
  viewerContainer: {
    flex: 1,
    backgroundColor: GV.stage,
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
    color: GV.cta,
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
    backgroundColor: '#FFFFFF',
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
    color: GV.body,
  },
  alertCard: {},
  alertSeverity: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    color: GV.ink,
    marginBottom: 8,
  },
  alertMessage: {
    ...TYPE.body,
    color: GV.ink,
  },
  alertPage: {
    ...TYPE.caption,
    color: GV.muted,
    marginTop: 8,
  },
  bodyText: {
    ...TYPE.body,
    color: GV.ink,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: GV.line,
    gap: 8,
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    ...TYPE.body,
    fontFamily: FONT.semi,
    color: GV.ink,
  },
  resultRange: {
    ...TYPE.caption,
    color: GV.muted,
    marginTop: 2,
  },
  resultValue: {
    alignItems: 'flex-end',
  },
  resultValueText: {
    ...TYPE.body,
    fontFamily: FONT.semi,
    color: GV.ink,
  },
  resultAbnormal: {
    color: GV.danger,
  },
  resultFlag: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    color: GV.body,
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
    borderTopColor: GV.line,
  },
  findingLabel: {
    ...TYPE.caption,
    color: GV.muted,
    marginBottom: 8,
  },
  findingText: {
    ...TYPE.body,
    color: GV.ink,
  },
  markdownText: {
    ...TYPE.caption,
    color: GV.body,
  },
  expandToggle: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    color: GV.cta,
    marginTop: 8,
  },
});
