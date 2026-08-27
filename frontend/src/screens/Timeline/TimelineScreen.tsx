import { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  RefreshControl,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Card, Button } from '@/components';
import { COLORS, SPACING, BORDER_RADIUS, TYPOGRAPHY, SHADOWS } from '@/constants';

interface TimelineEvent {
  event_id: string;
  patient_id: string;
  event_type: string;
  source_type: string;
  event_time: string;
  verification_status: string;
  concept_display_name: string | null;
  lab_result: {
    value: string;
    unit: string;
    reference_range: string;
    abnormal_flag: string | null;
  } | null;
  evidence: {
    document_id: string;
    extracted_text: string;
    bounding_box: Record<string, number> | null;
  } | null;
}

export default function TimelineScreen() {
  const { data: events, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['timeline'],
    queryFn: () => api.get<TimelineEvent[]>('/api/v1/timeline'),
    staleTime: 5 * 60 * 1000,
  });

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const getEventIcon = (eventType: string) => {
    if (eventType === 'LAB_RESULT') return '🔬';
    if (eventType === 'IMAGING_RESULT') return '📷';
    if (eventType === 'DIAGNOSIS') return '📋';
    if (eventType === 'MEDICATION_PRESCRIBED') return '💊';
    return '📝';
  };

  const getSourceColor = (sourceType: string) => {
    switch (sourceType) {
      case 'LAB_REPORT':
        return '#3b82f6';
      case 'IMAGING_REPORT':
        return '#8b5cf6';
      case 'DOCTOR_ENTERED':
        return '#10b981';
      case 'PATIENT_REPORTED':
        return '#f59e0b';
      default:
        return '#64748b';
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#14b8a6" />
          <Text style={styles.loadingText}>Loading timeline...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={events ?? []}
        keyExtractor={(item) => item.event_id}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[COLORS.primary]}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <View>
                <Text style={styles.greeting}>Health Timeline</Text>
                <Text style={styles.subtitle}>Your health journey</Text>
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No Timeline Events</Text>
            <Text style={styles.emptySubtitle}>
              Upload a document or log a vital to start building your health timeline.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Card style={styles.eventCard} padding="md">
            <View style={styles.eventHeader}>
              <View style={styles.eventIcon}>
                <Text style={styles.eventIconText}>
                  {getEventIcon(item.event_type)}
                </Text>
              </View>
              <View style={styles.eventHeaderContent}>
                <View style={styles.eventTitleRow}>
                  <Text style={styles.eventTitle}>
                    {item.concept_display_name || item.event_type.replace('_', ' ')}
                  </Text>
                  <View
                    style={[
                      styles.sourceBadge,
                      { backgroundColor: getSourceColor(item.source_type) + '20' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.sourceBadgeText,
                        { color: getSourceColor(item.source_type) },
                      ]}
                    >
                      {item.source_type.replace('_', ' ')}
                    </Text>
                  </View>
                </View>
                <Text style={styles.eventDate}>
                  {new Date(item.event_time).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
              <View style={styles.eventMeta}>
                <View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor:
                        item.verification_status === 'EXTRACTED' ? '#10b98120' : '#f59e0b20',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      {
                        color:
                          item.verification_status === 'EXTRACTED' ? '#10b981' : '#f59e0b',
                      },
                    ]}
                  >
                    {item.verification_status?.replace('_', ' ') || 'Unverified'}
                  </Text>
                </View>
              </View>
            </View>

            {item.lab_result && (
              <View style={styles.labResult}>
                <Text style={styles.labLabel}>Lab Result</Text>
                <View style={styles.labValueRow}>
                  <Text style={styles.labValue}>
                    {item.lab_result.value} {item.lab_result.unit}
                  </Text>
                  <Text style={styles.labReference}>
                    Ref: {item.lab_result.reference_range}
                  </Text>
                  {item.lab_result.abnormal_flag && (
                    <Text
                      style={[
                        styles.abnormalFlag,
                        {
                          color: item.lab_result.abnormal_flag.startsWith('H')
                            ? '#ef4444'
                            : '#f59e0b',
                        },
                      ]}
                    >
                      {item.lab_result.abnormal_flag}
                    </Text>
                  )}
                </View>
              </View>
            )}

            {item.evidence && (
              <View style={styles.evidenceSection}>
                <Text style={styles.evidenceLabel}>Document Evidence</Text>
                <Text style={styles.evidenceText} numberOfLines={3}>
                  {item.evidence.extracted_text}
                </Text>
                <Button
                  title="View Document"
                  variant="ghost"
                  onPress={() => {}}
                  style={{ marginTop: 8 }}
                />
              </View>
            )}
          </Card>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
    marginTop: SPACING.md,
  },
  scrollContent: {
    paddingBottom: SPACING.xxl,
  },
  header: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greeting: {
    ...TYPOGRAPHY.h2,
    color: COLORS.textPrimary,
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
  },
  eventCard: {
    marginHorizontal: SPACING.xl,
    marginBottom: SPACING.md,
  },
  eventHeader: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  eventIcon: {
    width: 40,
    height: 40,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primaryBg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  eventIconText: {
    fontSize: 20,
  },
  eventHeaderContent: {
    flex: 1,
  },
  eventTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flexWrap: 'wrap',
  },
  eventTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
    flex: 1,
  },
  sourceBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
  },
  sourceBadgeText: {
    ...TYPOGRAPHY.captionStrong,
    fontSize: 11,
  },
  eventDate: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
  },
  eventMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
  },
  statusText: {
    ...TYPOGRAPHY.captionStrong,
    fontSize: 11,
  },
  labResult: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  labLabel: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.textMuted,
    marginBottom: SPACING.xs,
  },
  labValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  labValue: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
  },
  labReference: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },
  abnormalFlag: {
    ...TYPOGRAPHY.captionStrong,
    fontSize: 11,
  },
  evidenceSection: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  evidenceLabel: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.textMuted,
    marginBottom: SPACING.xs,
  },
  evidenceText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    lineHeight: 22,
    marginBottom: SPACING.md,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xxl,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: SPACING.md,
  },
  emptyTitle: {
    ...TYPOGRAPHY.h2,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  emptySubtitle: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 24,
  },
});