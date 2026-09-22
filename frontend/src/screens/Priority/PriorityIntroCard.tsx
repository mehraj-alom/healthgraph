/**
 * PriorityIntroCard — three-lifetime-exposure Priority introduction
 * (post-Batch-6 layer).
 *
 * A modal card shown at most once per calendar day for the first three
 * eligible days (Day 1/2/3 copy progression). The CTA teaches where
 * priorities live: on press the card compresses/slides downward and
 * fades — toward the profile destination — then navigates to Settings
 * ("My Priorities"). There is no Profile tab in the tab bar, so a
 * literal morph into tab chrome is inappropriate; the downward exit
 * toward the settings surface is the closest reliable transition.
 *
 * Reanimated only (no timers, no listeners — nothing leaks); reduced
 * motion collapses the slide to a fade. The exposure itself is recorded
 * by usePriorityIntro on present, so dismissing (X/scrim) never
 * double-counts and never re-shows.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Modal as RNModal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { Button, Card } from '@/components';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { usePriority } from '@/hooks/usePriority';
import { formatPriorityNames, introCopy } from '@/screens/Priority/priorityLayer';

const ENTER_MS = 240;
const EXIT_MS = 220;
const EXIT_DROP = 120;

export function PriorityIntroCard({
  visible,
  day,
  onDone,
  onDismiss,
}: {
  visible: boolean;
  day: 1 | 2 | 3;
  /** CTA path: after the exit animation, navigate to Settings. */
  onDone: () => void;
  /** Dismiss path (X/scrim): hide without navigating. */
  onDismiss: () => void;
}): React.JSX.Element | null {
  const reducedMotion = useReducedMotion();
  const { entries } = usePriority();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(reducedMotion ? 0 : 24);
  const leaving = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Entry on present.
  useEffect(() => {
    if (!visible) return;
    leaving.current = false;
    opacity.value = 0;
    translateY.value = reducedMotion ? 0 : 24;
    opacity.value = withTiming(1, { duration: reducedMotion ? 0 : ENTER_MS });
    translateY.value = withTiming(0, { duration: reducedMotion ? 0 : ENTER_MS });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const finish = useCallback(() => {
    if (mounted.current) onDone();
  }, [onDone]);

  const handleCta = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    if (reducedMotion) {
      finish();
      return;
    }
    opacity.value = withTiming(0, { duration: EXIT_MS }, (done) => {
      if (done) runOnJS(finish)();
    });
    translateY.value = withTiming(EXIT_DROP, { duration: EXIT_MS });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion, finish]);

  if (!visible) return null;
  const copy = introCopy(day);
  const names = formatPriorityNames(entries);

  return (
    <RNModal visible transparent animationType="none" statusBarTranslucent onRequestClose={onDismiss}>
      <View style={styles.scrim}>
        <Pressable
          style={styles.scrimPress}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss priorities introduction"
        />
        <Animated.View style={[styles.cardWrap, cardStyle]}>
          <Card>
            <View style={styles.head}>
              <Text style={styles.overline}>Priority</Text>
              <Pressable
                onPress={onDismiss}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={styles.closeHit}
              >
                <Text style={styles.closeText}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.headline}>{copy.headline}</Text>
            {entries.length > 0 ? (
              <Text style={styles.names}>{names}</Text>
            ) : (
              <Text style={styles.names}>No priorities selected yet</Text>
            )}
            <Text style={styles.body}>{copy.body}</Text>
            <Button title={`${copy.cta} →`} onPress={handleCta} fullWidth />
          </Card>
        </Animated.View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: SPACE.screenH,
  },
  scrimPress: { ...StyleSheet.absoluteFill },
  cardWrap: { width: '100%' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  overline: {
    fontFamily: FONT.semi,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 3,
    color: GV.teal,
  },
  closeHit: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'flex-end' },
  closeText: { fontSize: 18, color: GV.fog },
  headline: { ...TYPE.display, fontSize: 24, color: GV.card, marginTop: 8 },
  names: { ...TYPE.button, fontSize: 16, color: GV.ink, marginTop: 8 },
  body: { ...TYPE.body, color: GV.fog, marginTop: 8, marginBottom: 12 },
});

export default PriorityIntroCard;
