/**
 * DocumentsScreen — past uploads list.
 *
 * Glass content on the aurora stage. Rows open DocumentDetail.
 * Only real rows ever render; empty shows the honest empty state.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { SPACE } from '@/theme/guava';
import { LG } from '@/theme/liquidGlass';
import { useDocuments } from '@/context/DocumentsContext';
import { listUnverifiedExtractedDocIds } from '@/db/queries/documents';
import { getCachedPatientId } from '@/services/patientIdentity';
import type { DocumentStatus, RootStackParamList } from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

const STATUS_DOT: Record<DocumentStatus, string> = {
  UPLOADED: SECONDARY,
  PROCESSING: '#C9A24B',
  EXTRACTED: LG.card.mint,
  COMPLETED: LG.card.mint,
  FAILED: LG.card.danger,
  FAILED_TRIAGE: TERTIARY,
};

function statusLabel(status: DocumentStatus): string {
  switch (status) {
    case 'UPLOADED':
      return 'Uploaded';
    case 'PROCESSING':
      return 'Processing';
    case 'EXTRACTED':
      return 'Extracted';
    case 'COMPLETED':
      return 'Complete';
    case 'FAILED':
      return 'Failed';
    case 'FAILED_TRIAGE':
      return 'Not a record';
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function DocumentsScreen() {
  const navigation = useNavigation<Nav>();
  const { documents, refetchDocuments } = useDocuments();
  const [refreshing, setRefreshing] = useState(false);
  const [unverified, setUnverified] = useState<Set<string>>(new Set());

  const loadUnverified = useCallback(async () => {
    const patientId = getCachedPatientId();
    if (!patientId) {
      setUnverified(new Set());
      return;
    }
    try {
      setUnverified(new Set(await listUnverifiedExtractedDocIds(patientId)));
    } catch {
      // Badge is convenience only — the list still renders.
    }
  }, []);

  useEffect(() => {
    void loadUnverified();
    const unsubscribe = navigation.addListener('focus', () => {
      void loadUnverified();
    });
    return unsubscribe;
  }, [navigation, loadUnverified]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refetchDocuments()
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [refetchDocuments]);

  return (
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFFFFF" />
          }
        >
          <Text style={styles.title}>Past uploads</Text>
          <Text style={styles.sub}>
            {documents.length === 0
              ? 'Nothing here yet.'
              : `${documents.length} document${documents.length === 1 ? '' : 's'}`}
          </Text>

          {documents.length === 0 ? (
            <GlassSurface strong style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>No uploads yet</Text>
              <Text style={styles.emptyText}>
                Upload a record and it will show up here.
              </Text>
            </GlassSurface>
          ) : (
            <GlassSurface strong style={styles.card}>
              {documents.map((doc, idx) => (
                <Pressable
                  key={doc.document_id}
                  onPress={() => navigation.navigate('DocumentDetail', { documentId: doc.document_id })}
                  accessibilityRole="button"
                  accessibilityLabel={`Open record from ${formatDate(doc.created_at)}, ${statusLabel(doc.status)}`}
                  hitSlop={4}
                  style={({ pressed }) => [
                    styles.row,
                    idx > 0 && styles.rowDivider,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName} numberOfLines={1}>Medical record</Text>
                    <Text style={styles.rowDate}>{formatDate(doc.created_at)}</Text>
                    {doc.status === 'EXTRACTED' && unverified.has(doc.document_id) ? (
                      <Text style={styles.reviewPill}>Needs review</Text>
                    ) : null}
                  </View>
                  <View style={styles.rowStatus}>
                    <View style={[styles.statusDot, { backgroundColor: STATUS_DOT[doc.status] }]} />
                    <Text style={styles.rowStatusText}>{statusLabel(doc.status)}</Text>
                    <Text style={styles.chev}>›</Text>
                  </View>
                </Pressable>
              ))}
            </GlassSurface>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070F' },
  safe: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: SPACE.screenH,
    paddingTop: 12,
    paddingBottom: 40,
    gap: 12,
  },
  title: {
    fontWeight: '600',
    fontSize: 34,
    lineHeight: 41,
    letterSpacing: -0.8,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  sub: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  emptyWrap: {
    alignItems: 'center',
    gap: 8,
    padding: 20,
  },
  emptyTitle: {
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.4,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  emptyText: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
    maxWidth: 300,
  },
  card: {
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    minHeight: 56,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  rowDate: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    fontVariant: ['tabular-nums'],
  },
  reviewPill: {
    fontWeight: '600',
    fontSize: 11,
    lineHeight: 14,
    color: LG.card.danger,
    marginTop: 2,
  },
  rowStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowStatusText: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  chev: {
    fontWeight: '600',
    fontSize: 18,
    lineHeight: 22,
    color: SECONDARY,
  },
});
