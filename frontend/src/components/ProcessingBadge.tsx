/**
 * ProcessingBadge — Shows active document processing status.
 * Reads from DocumentsContext internally — no props needed for data.
 * Re-renders only when processingVersion changes (add/terminal/remove),
 * NOT on every 3-second status poll.
 */

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { COLORS, BORDER_RADIUS, SPACING, TYPOGRAPHY } from '@/constants';
import {
  useDocuments,
  type ActiveProcessing,
} from '@/context/DocumentsContext';

interface ProcessingBadgeProps {
  onPress?: () => void;
}

export function ProcessingBadge({ onPress }: ProcessingBadgeProps) {
  const { getActiveProcessing, processingVersion } = useDocuments();
  const [activeCount, setActiveCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [latestName, setLatestName] = useState('');
  const [pausedNote, setPausedNote] = useState<string | null>(null);

  // Re-read from the ref whenever the processing list changes structurally
  useEffect(() => {
    const items = getActiveProcessing();
    const active = items.filter(
      (e) => !isTerminal(e.stage),
    );
    const completed = items.filter((e) => e.stage === 'completed');
    setActiveCount(active.length);
    setCompletedCount(completed.length);
    const current = active.find(
      (e) => e.stage === 'processing' || e.stage === 'uploading',
    );
    // A friendly paused/queued note (set when the worker is unavailable)
    // takes precedence over the generic spinner copy.
    const noted = active.find((e) => e.note);
    setLatestName(noted?.note ?? current?.fileName ?? '');
    setPausedNote(noted?.note ?? null);
  }, [processingVersion, getActiveProcessing]);

  if (activeCount === 0 && completedCount === 0) return null;

  return (
    <Pressable
      style={styles.container}
      onPress={onPress}
      disabled={!onPress}
    >
      {activeCount > 0 && (
        <>
          {pausedNote ? (
            <Text style={styles.pausedIcon}>⏸</Text>
          ) : (
            <ActivityIndicator size="small" color={COLORS.primary} />
          )}
          <Text style={styles.activeText} numberOfLines={2}>
            {pausedNote ??
              (activeCount === 1
                ? `Processing ${latestName || 'document'}...`
                : `Processing ${activeCount} documents...`)}
          </Text>
        </>
      )}
      {activeCount === 0 && completedCount > 0 && (
        <>
          <Text style={styles.completeIcon}>✓</Text>
          <Text style={styles.completeText}>
            {completedCount === 1
              ? 'Document processed'
              : `${completedCount} documents processed`}
          </Text>
        </>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTerminal(stage: string): boolean {
  return (
    stage === 'completed' || stage === 'failed' || stage === 'failed_triage'
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.primaryBg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  activeText: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.primary,
    flex: 1,
  },
  completeIcon: {
    color: COLORS.success,
    fontSize: 14,
    fontWeight: '700',
  },
  pausedIcon: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '700',
  },  completeText: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.success,
    flex: 1,
  },
});
