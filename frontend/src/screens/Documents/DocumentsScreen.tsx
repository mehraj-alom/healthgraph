/**
 * DocumentsScreen — past uploads list.
 *
 * healthgraph skill: black backdrop, centered title, dark grouped
 * rows with hairline dividers. Rows open DocumentDetail. Only real
 * rows ever render; empty shows the honest empty state.
 */

import { useCallback, useState } from 'react';
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
import { GV, TYPE, FONT } from '@/theme/guava';
import { useDocuments } from '@/context/DocumentsContext';
import type { DocumentStatus, RootStackParamList } from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const NAVY = '#080A11';
const TILE_BG = '#2A3049';
const HAIRLINE_ON_NAVY = 'rgba(255, 255, 255, 0.12)';

const STATUS_DOT: Record<DocumentStatus, string> = {
  UPLOADED: GV.fx.sky,
  PROCESSING: GV.fx.amber,
  EXTRACTED: GV.fx.green,
  COMPLETED: GV.fx.green,
  FAILED: GV.danger,
  FAILED_TRIAGE: GV.muted,
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

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refetchDocuments()
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [refetchDocuments]);

  return (
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
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No uploads yet</Text>
            <Text style={styles.emptyText}>
              Upload a record and it will show up here.
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
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
                </View>
                <View style={styles.rowStatus}>
                  <View style={[styles.statusDot, { backgroundColor: STATUS_DOT[doc.status] }]} />
                  <Text style={styles.rowStatusText}>{statusLabel(doc.status)}</Text>
                  <Text style={styles.chev}>›</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: NAVY,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 40,
    gap: 12,
  },
  title: {
    fontFamily: FONT.semi,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.3,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  sub: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  emptyWrap: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 32,
  },
  emptyTitle: {
    fontFamily: FONT.semi,
    fontSize: 18,
    lineHeight: 24,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  emptyText: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
    maxWidth: 300,
  },
  card: {
    backgroundColor: TILE_BG,
    borderWidth: 1,
    borderColor: HAIRLINE_ON_NAVY,
    borderRadius: 8,
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
    borderTopColor: HAIRLINE_ON_NAVY,
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontFamily: FONT.semi,
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  rowDate: {
    fontFamily: FONT.regular,
    fontSize: 13,
    lineHeight: 18,
    color: GV.fog,
    fontVariant: ['tabular-nums'],
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
    fontFamily: FONT.semi,
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  chev: {
    fontFamily: FONT.semi,
    fontSize: 18,
    lineHeight: 22,
    color: GV.fog,
  },
});
