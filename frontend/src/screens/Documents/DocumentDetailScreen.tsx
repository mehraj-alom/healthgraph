/**
 * DocumentDetailScreen — Shows extracted medical data from a processed document.
 *
 * Displays: document type, extracted sections/results, alerts, raw markdown,
 * and source evidence. This is the "review" screen after processing completes.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';
import { Button, Card } from '@/components';
import { useDocuments, type DocumentsContextValue } from '@/context/DocumentsContext';
import { getDocument, statusLabel, documentTypeLabel } from '@/services/documents';
import { COLORS, BORDER_RADIUS, SPACING, TYPOGRAPHY, SHADOWS } from '@/constants';
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
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.centerText}>Loading document...</Text>
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
                  backgroundColor:
                    document.status === 'COMPLETED'
                      ? COLORS.accentBg
                      : document.status === 'FAILED'
                        ? COLORS.errorBg
                        : COLORS.surfaceElevated,
                  borderWidth: 1,
                  borderColor: document.status === 'FAILED' ? 'rgba(232,93,104,0.25)' : COLORS.borderFaint,
                },
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  {
                    color:
                      document.status === 'COMPLETED'
                        ? COLORS.accent
                        : document.status === 'FAILED'
                          ? COLORS.error
                          : COLORS.textSecondary,
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
        </View>

        {/* Processing spinner */}
        {isProcessing && (
          <Card padding="md">
            <View style={styles.processingRow}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.processingText}>
                Still processing — check back shortly.
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
    paddingVertical: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  label: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },
  value: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
    flex: 1,
    textAlign: 'right',
    marginLeft: SPACING.md,
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
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
    gap: SPACING.md,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
    gap: SPACING.md,
  },
  centerText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  header: {
    paddingVertical: SPACING.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: SPACING.md,
  },
  headerInfo: {
    flex: 1,
  },
  title: {
    ...TYPOGRAPHY.h1,
    color: COLORS.textPrimary,
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  date: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
  },
  statusBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
  },
  statusText: {
    ...TYPOGRAPHY.label,
    fontSize: 11,
  },
  section: {
    gap: SPACING.sm,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  processingText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
  },
  alertCard: {
    borderLeftWidth: 4,
    borderLeftColor: COLORS.warning,
  },
  alertSeverity: {
    ...TYPOGRAPHY.label,
    color: COLORS.warning,
    marginBottom: SPACING.xs,
  },
  alertMessage: {
    ...TYPOGRAPHY.body,
    color: COLORS.textPrimary,
  },
  alertPage: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
  },
  bodyText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    lineHeight: 22,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: SPACING.sm,
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
  },
  resultRange: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  resultValue: {
    alignItems: 'flex-end',
  },
  resultValueText: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
  },
  resultAbnormal: {
    color: COLORS.warning,
  },
  resultFlag: {
    ...TYPOGRAPHY.label,
    color: COLORS.warning,
    fontSize: 10,
    marginTop: 2,
  },
  resultFlagCritical: {
    color: COLORS.error,
  },
  findingBlock: {
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  findingLabel: {
    ...TYPOGRAPHY.label,
    color: COLORS.textMuted,
    marginBottom: SPACING.xs,
  },
  findingText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    lineHeight: 22,
  },
  markdownText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  expandToggle: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.primary,
    marginTop: SPACING.sm,
  },
});
