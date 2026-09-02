import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useBodyState } from '@/hooks/useBodyState';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { useDocuments } from '@/context/DocumentsContext';
import { Button, Card, ProcessingBadge } from '@/components';
import { COLORS, BORDER_RADIUS, SPACING, TYPOGRAPHY } from '@/constants';
import { statusLabel } from '@/services/documents';
import type { RootStackParamList } from '@/types';
import type { DocumentListItem } from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function DashboardScreen() {
  const navigation = useNavigation<Nav>();
  const body = useBodyState();
  const metrics = useDailyMetrics();
  const docs = useDocuments();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([body.refetch(), metrics.refetch(), docs.refetchDocuments()]);
    setRefreshing(false);
  };
  const bodyItems = body.data ?? [];
  const clinical = metrics.data;
  const wellbeing = clinical?.today_wellbeing;
  const recentDocs = docs.documents.slice(0, 5);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            colors={[COLORS.primary]}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Health overview</Text>
            <Text style={styles.subtitle}>Your current clinical record</Text>
          </View>
          <View style={styles.headerActions}>
            <Text style={styles.date}>
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Settings')}>
              <Text style={styles.accountAction}>Account</Text>
            </Pressable>
          </View>
        </View>

        {/* Active processing indicator */}
        <ProcessingBadge
          onPress={() => navigation.navigate('DocumentUpload')}
        />

        {/* Add Medical Record — primary CTA */}
        <Card padding="md" style={styles.uploadCard}>
          <View style={styles.uploadRow}>
            <View style={styles.uploadIcon}>
              <Text style={styles.uploadIconText}>📋</Text>
            </View>
            <View style={styles.uploadInfo}>
              <Text style={styles.uploadTitle}>Add Medical Record</Text>
              <Text style={styles.uploadSubtitle}>
                Upload a lab report, prescription, or imaging document
              </Text>
            </View>
          </View>
          <Button
            title="Upload Document"
            onPress={() => navigation.navigate('DocumentUpload')}
            fullWidth
            style={styles.uploadButton}
          />
        </Card>

        {/* Recent Medical Records */}
        {recentDocs.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Records</Text>
              <Pressable onPress={() => navigation.navigate('DocumentUpload')}>
                <Text style={styles.sectionAction}>See all</Text>
              </Pressable>
            </View>
            {recentDocs.map((doc) => (
              <DocumentCard
                key={doc.document_id}
                document={doc}
                onPress={() =>
                  navigation.navigate('DocumentDetail', {
                    documentId: doc.document_id,
                  })
                }
              />
            ))}
          </View>
        )}

        {/* Today's health */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Today's health</Text>
          <Text style={styles.sectionSubtitle}>
            Daily logs are separate from anatomical observations.
          </Text>
          <Card padding="md">
            <View style={styles.metricGrid}>
              {wellbeing ? (
                <Metric
                  label="Wellbeing"
                  value={`${wellbeing.overall_wellbeing}/5`}
                />
              ) : null}
              {wellbeing ? (
                <Metric label="Energy" value={`${wellbeing.energy_level}/5`} />
              ) : null}
              {wellbeing ? (
                <Metric label="Stress" value={`${wellbeing.stress_level}/5`} />
              ) : null}
              {clinical?.latest_pain ? (
                <Metric
                  label="Latest pain"
                  value={`${clinical.latest_pain.severity}/10`}
                />
              ) : null}
            </View>
            {!wellbeing && !clinical?.latest_pain ? (
              <Text style={styles.muted}>
                No wellbeing or pain log recorded today.
              </Text>
            ) : null}
          </Card>
        </View>

        {/* Recent vitals */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent vitals</Text>
          <Card padding="md">
            {metrics.isLoading ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : clinical?.latest_vitals.length ? (
              clinical.latest_vitals.map((vital) => (
                <View
                  key={`${vital.concept_id}-${vital.unit}`}
                  style={styles.vitalRow}
                >
                  <View>
                    <Text style={styles.vitalName}>{vital.display_name}</Text>
                    <Text style={styles.muted}>
                      {new Date(vital.event_time).toLocaleDateString()}
                    </Text>
                  </View>
                  <Text style={styles.vitalValue}>
                    {vital.value}{' '}
                    <Text style={styles.vitalUnit}>{vital.unit}</Text>
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.muted}>No daily vitals recorded yet.</Text>
            )}
          </Card>
        </View>

        {/* Latest sleep */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Latest sleep</Text>
          <Card padding="md">
            {clinical?.latest_sleep ? (
              <View style={styles.metricGrid}>
                <Metric
                  label="Duration"
                  value={`${Math.round((clinical.latest_sleep.duration_minutes / 60) * 10) / 10} h`}
                />
                <Metric
                  label="Quality"
                  value={
                    clinical.latest_sleep.sleep_quality
                      ? `${clinical.latest_sleep.sleep_quality}/5`
                      : 'Not recorded'
                  }
                />
                <Metric
                  label="Awakenings"
                  value={
                    clinical.latest_sleep.awakenings == null
                      ? 'Not recorded'
                      : String(clinical.latest_sleep.awakenings)
                  }
                />
              </View>
            ) : (
              <Text style={styles.muted}>No sleep log recorded yet.</Text>
            )}
          </Card>
        </View>

        {/* Body status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Body status</Text>
          <Text style={styles.sectionSubtitle}>Anatomical observations only</Text>
          {body.isLoading ? (
            <Card padding="md">
              <ActivityIndicator color={COLORS.primary} />
            </Card>
          ) : body.isError ? (
            <Card padding="md">
              <Text style={styles.muted}>
                Body-state data is temporarily unavailable.
              </Text>
              <Button
                title="Try again"
                onPress={() => void body.refetch()}
                variant="ghost"
                style={styles.retry}
              />
            </Card>
          ) : bodyItems.length === 0 ? (
            <Card padding="md">
              <Text style={styles.muted}>
                3D Body unavailable — no anatomical observations have been
                recorded.
              </Text>
            </Card>
          ) : (
            bodyItems.map((item) => (
              <Card key={item.structure_id} padding="md" style={styles.bodyCard}>
                <View style={styles.vitalRow}>
                  <View>
                    <Text style={styles.vitalName}>{item.display_name}</Text>
                    <Text style={styles.muted}>
                      {item.latest_summary ?? item.trend}
                    </Text>
                  </View>
                  <Text style={styles.status}>
                    {item.visual_status.replaceAll('_', ' ')}
                  </Text>
                </View>
              </Card>
            ))
          )}
        </View>

        {metrics.isError ? (
          <Text style={styles.error}>
            Daily clinical data is temporarily unavailable. Pull to retry.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function DocumentCard({
  document,
  onPress,
}: {
  document: DocumentListItem;
  onPress: () => void;
}) {
  const date = new Date(document.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const isActive =
    document.status === 'UPLOADED' ||
    document.status === 'PROCESSING' ||
    document.status === 'EXTRACTED';

  return (
    <Card padding="md" onPress={onPress} style={styles.docCard}>
      <View style={styles.docRow}>
        <View style={styles.docIcon}>
          <Text style={styles.docIconText}>📄</Text>
        </View>
        <View style={styles.docInfo}>
          <Text style={styles.docTitle} numberOfLines={1}>
            {document.file_hash.slice(0, 12)}
          </Text>
          <Text style={styles.docDate}>{date}</Text>
        </View>
        <View style={styles.docStatus}>
          {isActive && (
            <ActivityIndicator
              size="small"
              color={COLORS.primary}
              style={styles.docSpinner}
            />
          )}
          <Text
            style={[
              styles.docStatusText,
              document.status === 'COMPLETED'
                ? styles.docStatusComplete
                : document.status === 'FAILED'
                  ? styles.docStatusFailed
                  : styles.docStatusActive,
            ]}
          >
            {statusLabel(document.status)}
          </Text>
        </View>
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl, gap: SPACING.md },
  header: {
    paddingVertical: SPACING.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: { ...TYPOGRAPHY.h1, color: COLORS.textPrimary },
  subtitle: { ...TYPOGRAPHY.body, color: COLORS.textSecondary, marginTop: SPACING.xs },
  date: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, textAlign: 'right', maxWidth: 120 },
  headerActions: { alignItems: 'flex-end', gap: SPACING.sm },
  accountAction: { ...TYPOGRAPHY.captionStrong, color: COLORS.primary },

  // Upload card
  uploadCard: { gap: SPACING.sm },
  uploadRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  uploadIcon: {
    width: 48, height: 48, borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primaryBg, alignItems: 'center', justifyContent: 'center',
  },
  uploadIconText: { fontSize: 24 },
  uploadInfo: { flex: 1 },
  uploadTitle: { ...TYPOGRAPHY.bodyStrong, color: COLORS.textPrimary },
  uploadSubtitle: { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, marginTop: 2 },
  uploadButton: { marginTop: SPACING.xs },

  // Sections
  section: { gap: SPACING.sm },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  sectionTitle: { ...TYPOGRAPHY.h3, color: COLORS.textPrimary },
  sectionSubtitle: { ...TYPOGRAPHY.caption, color: COLORS.textSecondary },
  sectionAction: { ...TYPOGRAPHY.captionStrong, color: COLORS.primary },

  // Document cards
  docCard: { marginBottom: SPACING.xs },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  docIcon: {
    width: 40, height: 40, borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.surfaceElevated, alignItems: 'center', justifyContent: 'center',
  },
  docIconText: { fontSize: 18 },
  docInfo: { flex: 1 },
  docTitle: { ...TYPOGRAPHY.bodyStrong, color: COLORS.textPrimary },
  docDate: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, marginTop: 2 },
  docStatus: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  docSpinner: { marginRight: 2 },
  docStatusText: { ...TYPOGRAPHY.captionStrong },
  docStatusComplete: { color: COLORS.success },
  docStatusFailed: { color: COLORS.error },
  docStatusActive: { color: COLORS.primary },

  // Metrics
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md },
  metric: { minWidth: 76, flexGrow: 1 },
  metricLabel: { ...TYPOGRAPHY.caption, color: COLORS.textMuted },
  metricValue: { ...TYPOGRAPHY.h3, color: COLORS.primary, marginTop: 2 },
  muted: { ...TYPOGRAPHY.caption, color: COLORS.textMuted },
  vitalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    gap: SPACING.md, paddingVertical: SPACING.sm,
  },
  vitalName: { ...TYPOGRAPHY.bodyStrong, color: COLORS.textPrimary },
  vitalValue: { ...TYPOGRAPHY.h3, color: COLORS.textPrimary },
  vitalUnit: { ...TYPOGRAPHY.body, color: COLORS.textSecondary },
  bodyCard: { marginTop: SPACING.xs },
  status: {
    ...TYPOGRAPHY.captionStrong, color: COLORS.primary,
    backgroundColor: COLORS.primaryBg,
    paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
  },
  retry: { alignSelf: 'flex-start', marginTop: SPACING.sm },
  error: { ...TYPOGRAPHY.captionStrong, color: COLORS.error },
});
