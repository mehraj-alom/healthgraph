/**
 * ProcessingBanner — always-visible upload/processing progress.
 *
 * Sits above dashboard content so every pipeline stage (uploading →
 * processing → de-identifying → complete) is visible even after leaving
 * the upload screen. Subscribes to live stage updates for each active
 * document; terminal entries collapse to a dismissible status row.
 */

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { GV, TYPE, FONT } from '@/theme/guava';
import {
  useDocuments,
  type ActiveProcessing,
  type ProcessingStage,
} from '@/context/DocumentsContext';

function isTerminalStage(stage: ProcessingStage): boolean {
  return stage === 'completed' || stage === 'failed' || stage === 'failed_triage';
}

/** Ordered pipeline steps shown as progress dots. */
export const BANNER_STEPS: ProcessingStage[] = [
  'uploading',
  'uploaded',
  'processing',
  'extracted',
  'completed',
];

/** User-facing copy per stage. `extracted` means extraction finished and
 *  de-identification is running — the pipeline order in the backend. */
export function bannerCopy(
  stage: ProcessingStage,
  fileName: string,
  progress?: number,
): string {
  switch (stage) {
    case 'uploading':
      return progress !== undefined && progress !== null
        ? `Uploading ${fileName}… ${progress}%`
        : `Uploading ${fileName}…`;
    case 'uploaded':
      return 'Upload complete — starting analysis…';
    case 'processing':
      return 'Processing document…';
    case 'extracted':
      return 'De-identifying health data…';
    case 'completed':
      return `${fileName} — complete`;
    case 'failed':
      return 'Processing failed. Your original file is safe.';
    case 'failed_triage':
      return 'Not recognized as a medical record.';
    default:
      return 'Working…';
  }
}

export function ProcessingBanner() {
  const {
    getActiveProcessing,
    processingVersion,
    subscribeStage,
    dismissProcessing,
  } = useDocuments();
  const [, setTick] = useState(0);

  const entries = getActiveProcessing();
  const active = entries.filter((e) => !isTerminalStage(e.stage));
  const terminal = entries.filter((e) => isTerminalStage(e.stage));
  const activeIds = active
    .map((e) => e.documentId)
    .sort()
    .join(',');

  // Live updates: re-subscribe whenever the active set changes; each
  // stage notify forces one cheap re-render of this banner only.
  useEffect(() => {
    if (!activeIds) return;
    const unsubs = activeIds
      .split(',')
      .map((id) => subscribeStage(id, () => setTick((t) => t + 1)));
    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [activeIds, subscribeStage]);

  if (active.length === 0 && terminal.length === 0) return null;

  const current: ActiveProcessing | undefined = active[0];
  const failed =
    current !== undefined &&
    (current.stage === 'failed' || current.stage === 'failed_triage');

  return (
    <View style={styles.card}>
      {current !== undefined ? (
        <>
          <View style={styles.row}>
            {failed ? (
              <Text style={styles.failGlyph}>!</Text>
            ) : (
              <ActivityIndicator size="small" color={GV.cta} />
            )}
            <View style={styles.textCol}>
              <Text style={styles.title} numberOfLines={2}>
                {bannerCopy(current.stage, current.fileName, current.progress)}
              </Text>
              {active.length > 1 ? (
                <Text style={styles.count}>
                  {active.length} documents in progress
                </Text>
              ) : null}
              {current.note ? (
                <Text style={styles.note} numberOfLines={2}>
                  {current.note}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={() => dismissProcessing(current.documentId)}
              accessibilityRole="button"
              accessibilityLabel="Dismiss processing status"
              hitSlop={12}
              style={styles.dismissHit}
            >
              <Text style={styles.dismissGlyph}>✕</Text>
            </Pressable>
          </View>
          {!failed ? (
            <View style={styles.dots} accessibilityRole="progressbar">
              {BANNER_STEPS.map((s) => {
                const reached =
                  BANNER_STEPS.indexOf(current.stage as ProcessingStage) >=
                  BANNER_STEPS.indexOf(s);
                return (
                  <View
                    key={s}
                    style={[styles.dot, reached && styles.dotOn]}
                  />
                );
              })}
            </View>
          ) : null}
        </>
      ) : (
        <View style={styles.row}>
          <Text style={styles.doneGlyph}>✓</Text>
          <Text style={styles.title} numberOfLines={2}>
            {terminal.length === 1
              ? bannerCopy(terminal[0].stage, terminal[0].fileName)
              : `${terminal.length} documents processed`}
          </Text>
          <Pressable
            onPress={() => terminal.forEach((e) => dismissProcessing(e.documentId))}
            accessibilityRole="button"
            accessibilityLabel="Dismiss completed uploads"
            hitSlop={12}
            style={styles.dismissHit}
          >
            <Text style={styles.dismissGlyph}>✕</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: GV.card,
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...TYPE.body,
    fontFamily: FONT.semi,
    color: GV.ink,
  },
  count: {
    ...TYPE.caption,
    color: GV.muted,
  },
  note: {
    ...TYPE.caption,
    color: GV.body,
  },
  failGlyph: {
    fontSize: 18,
    fontFamily: FONT.bold,
    color: GV.danger,
  },
  doneGlyph: {
    fontSize: 18,
    fontFamily: FONT.bold,
    color: GV.cta,
  },
  dismissHit: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissGlyph: {
    fontSize: 14,
    color: GV.muted,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
    paddingLeft: 2,
  },
  dot: {
    width: 22,
    height: 5,
    borderRadius: 3,
    backgroundColor: GV.line,
  },
  dotOn: {
    backgroundColor: GV.cta,
  },
});
