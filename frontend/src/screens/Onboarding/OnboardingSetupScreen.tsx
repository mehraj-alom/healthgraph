/**
 * OnboardingSetupScreen — post-auth personalization (goals → focus →
 * momentum → done). Shown once per patient via the App-level setup gate;
 * established users with existing data are grandfathered past it and never
 * interrupted.
 *
 * Pager + progress + CTA reuse the OnboardingScreen conventions (horizontal
 * paging, segments, thumb-zone footer, safe-area aware, responsive). Steps
 * persist per Continue press, so killing the app mid-setup loses nothing
 * already confirmed; Start marks completion and the gate flips to Main.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FONT, SPACE } from '@/theme/guava';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { useOnboardingState } from '@/hooks/useOnboardingState';
import { GoalsStep } from './GoalsStep';
import { FocusStep } from './FocusStep';
import { MomentumStep } from './MomentumStep';
import { CheckinStep } from './CheckinStep';
import { DoneStep } from './DoneStep';

const PAGES = [0, 1, 2, 3, 4] as const;
const PAGE_LIST: number[] = [0, 1, 2, 3, 4];

export default function OnboardingSetupScreen() {
  const { width } = useWindowDimensions();
  const pager = useRef<FlatList<number> | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  void useReducedMotion;
  // Read-first CTA: transparent black arrow, bottom-right, 3.5s after
  // each step lands. Resets per step, clears on unmount.
  const [ctaVisible, setCtaVisible] = useState(false);
  useEffect(() => {
    setCtaVisible(false);
    const timer = setTimeout(() => setCtaVisible(true), 3500);
    return () => clearTimeout(timer);
  }, [step]);
  const { state, save, complete } = useOnboardingState();
  const [goals, setGoals] = useState<string[]>(() => state?.goals ?? []);
  const [focus, setFocus] = useState<string[]>(() => state?.focus ?? []);
  const [seeded, setSeeded] = useState(false);

  // Adopt stored selections once they load (local edits win afterwards).
  if (state && !seeded) {
    setSeeded(true);
    setGoals(state.goals);
    setFocus(state.focus);
  }

  const goTo = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(PAGES.length - 1, index));
      setStep(clamped);
      try {
        pager.current?.scrollToIndex({ index: clamped, animated: true });
      } catch {
        pager.current?.scrollToOffset({ offset: clamped * width, animated: true });
      }
    },
    [width],
  );

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(event.nativeEvent.contentOffset.x / width);
      setStep(Math.max(0, Math.min(PAGES.length - 1, index)));
    },
    [width],
  );

  const toggle = useCallback(
    (list: string[], id: string, apply: (next: string[]) => void) => {
      apply(list.includes(id) ? list.filter((v) => v !== id) : [...list, id]);
    },
    [],
  );

  const handleContinue = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await save(goals, focus);
      goTo(step + 1);
    } finally {
      setBusy(false);
    }
  }, [busy, goals, focus, save, step, goTo]);

  const handleStart = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await save(goals, focus);
      await complete();
      // The App-level gate observes completion and renders Main.
    } finally {
      setBusy(false);
    }
  }, [busy, goals, focus, save, complete]);

  const renderPage = ({ item }: { item: number }): React.ReactElement => (
    <View style={{ width, flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.pageScroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {item === 0 ? (
          <GoalsStep selected={goals} onToggle={(id) => toggle(goals, id, setGoals)} />
        ) : null}
        {item === 1 ? (
          <FocusStep selected={focus} onToggle={(id) => toggle(focus, id, setFocus)} />
        ) : null}
        {item === 2 ? <MomentumStep /> : null}
        {item === 3 ? <CheckinStep /> : null}
        {item === 4 ? <DoneStep goals={goals} focus={focus} /> : null}
      </ScrollView>
    </View>
  );

  const isDone = step === 4;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* One world for the whole flow: the same aurora stage as Home. */}
      <HomeStageBackdrop />
      <View style={styles.topBar}>
        {step > 0 ? (
          <Pressable
            onPress={() => goTo(step - 1)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back to previous step"
            style={styles.backHit}
          >
            <Text style={styles.backText}>‹ Back</Text>
          </Pressable>
        ) : (
          <View style={styles.topSpacer} />
        )}
        <View
          style={styles.segments}
          accessibilityRole="progressbar"
          accessibilityLabel={`Step ${step + 1} of ${PAGES.length}`}
        >
          {PAGE_LIST.map((i) => (
            <View
              key={i}
              style={[styles.segment, i <= step ? styles.segmentOn : styles.segmentOff]}
            />
          ))}
        </View>
        {isDone ? (
          <View style={styles.topSpacer} />
        ) : (
          <Pressable
            onPress={() => void handleContinue()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Skip this step"
            style={styles.skipHit}
          >
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        ref={pager}
        data={PAGE_LIST}
        keyExtractor={(item) => String(item)}
        renderItem={renderPage}
        horizontal
        pagingEnabled
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumEnd}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        initialNumToRender={5}
        windowSize={5}
        style={styles.pager}
      />

      <View style={styles.footer}>
        {ctaVisible ? (
          <Pressable
            onPress={() => void (isDone ? handleStart() : handleContinue())}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={isDone ? 'Start' : 'Continue'}
            hitSlop={12}
            style={({ pressed }) => [
              styles.goCircle,
              pressed && !busy && { opacity: 0.7, transform: [{ scale: 0.94 }] },
              busy && { opacity: 0.6 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.goArrow}>→</Text>
            )}
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05070F',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    minHeight: 48,
    gap: 12,
  },
  backHit: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  backText: {
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 22,
    color: '#FFFFFF',
  },
  topSpacer: {
    width: 56,
  },
  segments: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
  },
  segment: {
    flex: 1,
    maxWidth: 64,
    height: 4,
    borderRadius: 2,
  },
  segmentOn: {
    backgroundColor: '#FFFFFF',
  },
  segmentOff: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  skipHit: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  skipText: {
    fontWeight: '600',
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(233, 240, 255, 0.66)',
  },
  pager: {
    flex: 1,
  },
  pageScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: Math.max(16, SPACE.sectionGap - 8),
    minHeight: 88,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  // Transparent black read-first arrow, bottom-right.
  // Same glass circle as the intro pages' CTA — one voice across the flow.
  goCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  goArrow: {
    color: '#FFFFFF',
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '600',
    marginTop: -2,
  },
});
