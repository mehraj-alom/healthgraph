/**
 * HealthDashboardScreen — the "Health Dashboard" home tab.
 *
 * Redesigned for Apple Liquid Glass (iOS 26 feel):
 * - Two layers, Apple's model: a floating glass functional layer (nav
 *   capsule, tab dock, sheets) and a content layer of frosted material
 *   cards on a rich aurora stage, so every glass surface has color to
 *   pick up as it scrolls (glass approximated with expo-blur + fills —
 *   there is no true refraction outside SwiftUI glassEffect).
 * - Glass used with restraint: nav, dock, the two vitals instruments,
 *   the dial sheet and the modal. Dense grids / rows use the translucent
 *   material without blur for performance.
 * - Monochrome labels on glass; one tinted primary action per view (the
 *   red pulse button on the dock). Mint is status only, never prose.
 * - Motion is brief, transform/opacity only, reduced-motion gated: one
 *   gentle entrance stagger on first paint, springy segmented thumb,
 *   press feedback everywhere.
 * - Reduce Transparency falls back to opaque fills everywhere.
 *
 * Pure UI build: reuses existing hooks (useDailyMetrics, useMedications,
 * useTrends, useHomeStory). No backend changes.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useFocusEffect,
  useNavigation,
  type CompositeNavigationProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import Animated, {
  runOnJS,
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  withTiming,
  withSpring,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import Svg, { Path, Rect, Circle, G, Line } from 'react-native-svg';

import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { LG, lgType } from '@/theme/liquidGlass';
import { toneForCategory, graphToneForStream } from '@/theme/tones';

import { useTrendRange, TREND_RANGE_ORDER, TREND_RANGES } from '@/context/TrendRangeContext';
import { timingConfig, springSnappy } from '@/theme/motion';
import { useReducedMotion } from '@/theme';
import { IconButton } from '@/components/movements/IconButton';
import { Button } from '@/components/Button';
import { SectionHeader } from '@/components/SectionHeader';
import DayOneSection from '@/screens/Dashboard/DayOneSection';
import { GlassCuboid } from '@/components/GlassCuboid';
import HGraphMap, { type HMetric, HMAP_ASPECT } from '@/components/home/HGraphMap';
import { WheelSlider } from '@/components/WheelSlider';
import CorrelationGraphCard from '@/components/home/CorrelationGraphCard';
import { GlassSurface, useReduceTransparency } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import Entrance from '@/components/home/Entrance';
import { ExploreGlyph, type GlyphName } from '@/components/home/ExploreGlyphs';

import { BrandLogo } from '@/components/BrandLogo';
import { ProcessingBanner } from '@/components/ProcessingBanner';
import { consumeDataRefreshRequest } from '@/services/dataRefresh';
import { useLocalHeartRate } from '@/hooks/useLocalHeartRate';
import { useDialMetrics } from '@/hooks/useDialMetrics';
import { usePriorityIntro } from '@/hooks/usePriorityIntro';
import { PriorityIntroCard } from '@/screens/Priority/PriorityIntroCard';
import { reportTabScroll } from '@/components/tabBarVisibility';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { useProfilePhoto } from '@/hooks/useProfilePhoto';
import { recordMedicationTaken, useMedications } from '@/hooks/useMedications';
import { getCachedPatientId } from '@/services/patientIdentity';
import { listUnverifiedExtractedDocIds } from '@/db/queries/documents';
import { useTrends } from '@/hooks/useTrends';
import { localDateString } from '@/screens/Dashboard/homeData';
import { useHomeStory } from '@/screens/Dashboard/useHomeStory';
import { useCorrelationFeed, pairToFeedItem, correlationPairKey, getPair, type CorrelationFeedItem, type CorrelationPair, type StreamSeries } from '@/screens/Dashboard/correlations';
import { useCuratedFeed } from '@/screens/Dashboard/useCuratedFeed';
import { BottomSheet } from '@/components/BottomSheet';
import { ProfileSheet } from '@/components/ProfileSheet';
import type { MainTabParamList, RootStackParamList } from '@/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Dashboard'>,
  NativeStackNavigationProp<RootStackParamList>
>;

// ─── Line-glyph icons (inline svg, one stroke language — no icon lib) ────────

function PriorityGlyph({ size = 18, color = GV.ink }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={7.5} fill="none" stroke={color} strokeWidth={1.8} />
      <Circle cx={12} cy={12} r={3.8} fill="none" stroke={color} strokeWidth={1.8} />
      <Circle cx={12} cy={12} r={1.3} fill={color} />
    </Svg>
  );
}

function JournalGlyph({ size = 18, color = GV.ink }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={6} y={3.5} width={12} height={17} rx={2.5} fill="none" stroke={color} strokeWidth={1.8} />
      <Line x1={9} y1={8.5} x2={15} y2={8.5} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1={9} y1={12} x2={15} y2={12} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1={9} y1={15.5} x2={12.5} y2={15.5} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function BodyGlyph({ size = 18, color = GV.ink }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={5} r={2.4} fill="none" stroke={color} strokeWidth={1.8} />
      <Path
        d="M12 8.5v5m0 0-3.2 6.5m3.2-6.5 3.2 6.5M7.5 10.5 12 9l4.5 1.5"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function PillGlyph({ size = 20, color = GV.ink }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G transform="rotate(-45 12 12)">
        <Rect x={5} y={9} width={14} height={6} rx={3} fill="none" stroke={color} strokeWidth={1.8} />
        <Line x1={12} y1={9} x2={12} y2={15} stroke={color} strokeWidth={1.8} />
      </G>
    </Svg>
  );
}

// ─── Fixed header: Liquid Glass nav bar (functional layer) ─────────────────
// Floating regular-variant glass over scrolling content: BlurView + dark
// fill + hairline highlight, opaque fallback under Reduce Transparency.
// Monochrome white glyphs on the bar (the ONE tinted action on the view
// lives on the dock — the pulse button). 44pt targets with hitSlop.

function HeaderBlock({
  photoUri,
  hasActivity,
  onAvatarPress,
  onBellPress,
  onBodyPress,
  onPriorityPress,
  scrolled,
}: {
  photoUri: string | null;
  hasActivity: boolean;
  onAvatarPress: () => void;
  onBellPress: () => void;
  onBodyPress: () => void;
  onPriorityPress: () => void;
  /** Past the scroll-edge threshold — strengthens fill + edge fade. */
  scrolled?: boolean;
}) {
  const reduceTransparency = useReduceTransparency();
  return (
    <View style={styles.headerFloat}>
      <View style={[styles.headerGlass, scrolled && styles.headerGlassScrolled]}>
        {reduceTransparency ? null : (
          <BlurView tint="dark" intensity={LG.blurIntensity} style={StyleSheet.absoluteFill} />
        )}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.headerFill,
            reduceTransparency && styles.headerFillOpaque,
          ]}
        />
        <View pointerEvents="none" style={styles.headerTopEdge} />
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Pressable
              style={({ pressed }) => [styles.avatarHit, pressed && styles.pressed]}
              onPress={onAvatarPress}
              accessibilityRole="button"
              accessibilityLabel="Open profile and settings"
              hitSlop={8}
            >
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.avatarPhoto} />
              ) : (
                <View style={styles.avatarEmpty} />
              )}
            </Pressable>
            <View style={styles.headerWordmark}>
              <BrandLogo height={23} tint="#FFFFFF" />
            </View>
          </View>

          <View style={styles.headerRight}>
            <Pressable
              style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
              onPress={onPriorityPress}
              accessibilityRole="button"
              accessibilityLabel="Open my priorities"
              hitSlop={8}
            >
              <PriorityGlyph color="#FFFFFF" />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
              onPress={onBodyPress}
              accessibilityRole="button"
              accessibilityLabel="Open 3D body"
              hitSlop={8}
            >
              <BodyGlyph color="#FFFFFF" />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
              onPress={onBellPress}
              accessibilityRole="button"
              accessibilityLabel="Open timeline"
              hitSlop={8}
            >
              <JournalGlyph color="#FFFFFF" />
              {hasActivity ? <View style={styles.bellDot} /> : null}
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

// ─── Vitals duo ───────────────────────────────────────────────────────────────
// Two frosted instruments side by side: an honest check-in completion ring
// and a medication dose meter. One tap target per card; honest fractions
// only (no invented states).

/** Dose progress fill: static honest fraction — no arrival motion. */
function DoseBar({ pct }: { pct: number }) {
  const w = `${Math.max(0, Math.min(1, pct)) * 100}` as `${number}`;
  return (
    <View style={styles.doseTrack}>
      <View style={[styles.doseFill, { width: `${w}%` as `${number}%` }]} />
    </View>
  );
}

/** Today-readiness ring: mint stroke on glass, honest fraction inside. */
function ProgressRing({ pct, size = 44 }: { pct: number; size?: number }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));

  return (
    <View style={{ width: size, height: size }} accessible accessibilityLabel={`${Math.round(clamped * 100)} percent of today's routine complete`}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={stroke} />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={LG.card.mint}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c}`}
          strokeDashoffset={c * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.ringCenter} pointerEvents="none">
        <Text style={styles.ringText}>{`${Math.round(clamped * 100)}%`}</Text>
      </View>
    </View>
  );
}

function ActionRowBlock({
  loggedToday,
  moodLogged,
  waterMl,
  medNames,
  medCount,
  medTaken,
  medExpected,
  medActive,
  upNextMedId,
  upNextTaken,
  onDailyLog,
  onMedications,
  onToggleUpNextTaken,
}: {
  loggedToday: boolean;
  moodLogged: boolean;
  waterMl: number | null;
  medNames: string[];
  medCount: number;
  medTaken: number;
  medExpected: number;
  medActive: boolean;
  /** Up-next prescription id for the inline taken toggle (null when none). */
  upNextMedId: string | null;
  /** Whether the up-next dose is already taken today. */
  upNextTaken: boolean;
  onDailyLog: () => void;
  onMedications: () => void;
  onToggleUpNextTaken: () => void;
}) {
  // Honest "today" signals only — mood check-in, any water, doses done.
  const waterDone = (waterMl ?? 0) > 0;
  const dosesDone = medExpected > 0 ? medTaken >= medExpected : null;
  const signals = [moodLogged, waterDone, dosesDone].filter((s) => s !== null) as boolean[];
  const doneCount = signals.filter(Boolean).length;
  const completion = signals.length > 0 ? doneCount / signals.length : 0;
  const dosePct = medExpected > 0 ? Math.max(0, Math.min(1, medTaken / medExpected)) : 0;

  // "Caught up" means 100% — every today-signal done — not merely that a
  // log row exists. A partial day keeps the working state (CTA visible).
  const fullyDone = signals.length > 0 && doneCount >= signals.length;
  const medPreview =
    medActive && medNames.length > 0
      ? medNames.slice(0, 2).join(', ') + (medNames.length > 2 ? ` +${medNames.length - 2}` : '')
      : null;

  return (
    <View style={styles.duoRow}>
      <GlassSurface
        style={styles.vitalCard}
        onPress={onDailyLog}
        accessibilityLabel={loggedToday ? "View or edit today's daily log" : "Enter today's daily log"}
      >
        <View style={styles.vitalHead}>
          <Text style={styles.vitalOverline} numberOfLines={1}>Today</Text>
          <ProgressRing pct={completion} />
        </View>
        <Text style={styles.vitalTitle} numberOfLines={1}>
          {fullyDone ? 'All done' : doneCount > 0 ? `${doneCount} of ${signals.length} done` : 'Not started'}
        </Text>
        <Text style={styles.vitalSub} numberOfLines={1}>
          {loggedToday ? 'Saved — tap to edit' : 'Mood, water & meds'}
        </Text>
        {!fullyDone ? (
          <View style={styles.vitalCta}>
            <Text style={styles.vitalCtaText}>Check in</Text>
          </View>
        ) : null}
      </GlassSurface>

      <GlassSurface
        style={styles.vitalCard}
        onPress={onMedications}
        accessibilityLabel={medActive ? `Medications, ${medTaken} of ${medExpected} doses taken` : 'No medications scheduled. Add one.'}
      >
        <View style={styles.vitalHead}>
          <Text style={styles.vitalOverline} numberOfLines={1}>Medication</Text>
          <View style={styles.glyphDiscSm}>
            <PillGlyph size={18} color={LG.card.mint} />
          </View>
        </View>
        <Text style={styles.vitalTitle} numberOfLines={1}>
          {medActive ? `${medTaken} of ${medExpected} doses` : 'None yet'}
        </Text>
        <Text style={styles.vitalSub} numberOfLines={1}>
          {medPreview ?? 'Add one to start tracking'}
        </Text>
        {medActive ? <DoseBar pct={dosePct} /> : null}
      </GlassSurface>
    </View>
  );
}

// ─── Insights panel (health overview map + actions) ─────────────────────────
// Wheel lane beside the dial: 44px wheel + 4px breathing room.
const WHEEL_LANE = 48;
// Left rail for the vertical day readout.
const RAIL_W = 24;
// Submerged resin tone: the wheel + day readout read cast inside the
// cuboid rather than floating on it.
const SUNKEN_TEAL = '#3EC6B0';

function ImproveKeepDuo({
  onImprove,
}: {
  /** Improve / Keep duo → parent navigates to the actions window. */
  onImprove: (focus: 'improve' | 'keep') => void;
}) {
  return (
    <View style={styles.actionDuo}>
      <Button
        title="Improve"
        onPress={() => {
          try { Vibration.vibrate(12); } catch { /* best-effort */ }
          onImprove('improve');
        }}
        accessibilityLabel="Improve: actions based on your dial"
        style={styles.duoBtn}
      />
      <Button
        title="Keep"
        variant="secondary"
        onPress={() => {
          try { Vibration.vibrate(12); } catch { /* best-effort */ }
          onImprove('keep');
        }}
        accessibilityLabel="Keep: what is holding steady"
        style={styles.duoBtn}
      />
    </View>
  );
}

function InsightPanelBlock({
  hMetrics,
  day,
  onOpenFullGraph,
  onImprove,
}: {
  hMetrics: HMetric[];
  /** Day scrubber state from the parent — the dial shows this day. */
  day: { off: number; max: number; label: string; range: number; onChange: (n: number) => void; onRange: (n: number) => void };
  onOpenFullGraph: () => void;
  /** Improve / Keep duo → parent navigates to the actions window. */
  onImprove: (focus: 'improve' | 'keep') => void;
}) {
  const [mapOpen, setMapOpen] = useState(false);
  const [mapWidth, setMapWidth] = useState(0);
  // Scrubber rail only exists when there is history to scrub; the dial
  // keeps full size otherwise.
  const hasScrub = day.max > 0;
  const dialW = Math.round(mapWidth - (hasScrub ? RAIL_W + WHEEL_LANE : 0));
  return (
    <View style={styles.panelBlock}>
      <View style={styles.insightHead}>
        <Text style={styles.insightEyebrow}>Overview</Text>
        <View style={styles.expandHint} pointerEvents="none">
          <Text style={styles.expandHintText}>Expand</Text>
          <Text style={styles.expandChevron}>›</Text>
        </View>
      </View>

      {/* The hero instrument: the dial sits directly on one clear frosted
          panel — nothing layered OVER it (no cover sheet, no tint wash).
          It reads as the highlight through a teal-tinted rim + outer glow,
          never through anything painted between the dial and you. */}
      <GlassSurface
        strong
        noSheen
        radius={26}
        intensity={LG.card.blurIntensity + 6}
        style={styles.overviewCard}
      >
        <View
          style={styles.panelMap}
          onLayout={(e) => setMapWidth(e.nativeEvent.layout.width)}
        >
          {mapWidth > 0 ? (
            <View style={styles.dialRow}>
              {hasScrub ? (
                <View style={styles.dayWell}>
                  <Text style={styles.dayLabel} numberOfLines={1}>
                    {day.label}
                  </Text>
                </View>
              ) : null}
              <Pressable
                style={[styles.dialCol, { width: dialW }]}
                onPress={() => setMapOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Expand health overview map"
              >
                <HGraphMap metrics={hMetrics} width={dialW} />
              </Pressable>
              {day.max > 0 ? (
                <WheelSlider
                  value={day.off}
                  onValueChange={(v) => day.onChange(v)}
                  onLiveChange={(v) => day.onChange(v)}
                  min={0}
                  max={day.max}
                  step={0.1}
                  color={SUNKEN_TEAL}
                  sunken
                  height={Math.round(dialW * HMAP_ASPECT)}
                  accessibilityLabel="Scrub days"
                />
              ) : null}
            </View>
          ) : null}
        </View>
      </GlassSurface>

      <MapFullscreen visible={mapOpen} hMetrics={hMetrics} onClose={() => setMapOpen(false)} onImprove={(focus) => { setMapOpen(false); onImprove(focus); }} />
    </View>
  );
}

// ─── Full-screen insights map modal ───────────────────────────────────────────

function MapFullscreen({
  visible,
  hMetrics,
  onClose,
  onImprove,
}: {
  visible: boolean;
  hMetrics: HMetric[];
  onClose: () => void;
  /** Improve / Keep duo → parent closes the modal and opens the window. */
  onImprove: (focus: 'improve' | 'keep') => void;
}) {
  const reduced = useReducedMotion();
  const { width: windowWidth, height } = useWindowDimensions();
  const scrim = useSharedValue(reduced ? 1 : 0);
  const card = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      scrim.value = 1;
      card.value = 1;
      return;
    }
    if (visible) {
      scrim.value = withTiming(1, timingConfig(250));
      card.value = withSpring(1, springSnappy);
    } else {
      scrim.value = withTiming(0, timingConfig(250));
      card.value = withTiming(0, timingConfig(250));
    }
  }, [visible, scrim, card, reduced]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: card.value,
    transform: [
      { scale: interpolate(card.value, [0, 1], [0.96, 1], Extrapolation.CLAMP) },
      { translateY: interpolate(card.value, [0, 1], [24, 0], Extrapolation.CLAMP) },
    ],
  }));

  // Keep the square hGraph small enough to leave room for the hint.
  const mapSizeW = Math.min(windowWidth - SPACE.screenH * 2 - SPACE.cardPad * 2, Math.floor(height * 0.36));

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.modalScrim, scrimStyle]}>
        <Animated.View style={cardStyle}>
          <GlassSurface strong style={styles.modalCard} radius={28}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleBlock}>
                <Text style={styles.modalTitle}>Your health overview</Text>
              </View>
              <IconButton kind="solid" glyph="✕" accessibilityLabel="Close insights" onPress={onClose} />
            </View>
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalChartWrap}
              showsVerticalScrollIndicator={false}
            >
              <GlassCuboid pad={12} radius={24} auraColor={GV.teal} auraOpacity={0.1}>
                <HGraphMap metrics={hMetrics} width={mapSizeW} />
              </GlassCuboid>
              <ImproveKeepDuo onImprove={onImprove} />
            </ScrollView>
          </GlassSurface>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ─── iOS segmented control (glass capsule + sliding white thumb) ─────────────

function GlassSegmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: number;
  onChange: (index: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const thumbX = useSharedValue(0);
  const slot = Math.max((trackWidth - 6) / Math.max(options.length, 1), 1);

  useEffect(() => {
    thumbX.value = withSpring(value * slot, springSnappy);
  }, [value, slot, thumbX]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value }],
  }));

  return (
    <View
      style={styles.segTrack}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      accessibilityRole="tablist"
    >
      {options.map((o, i) => {
        const selected = value === i;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(i)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`Show ${o.label} range`}
            style={styles.segOpt}
          >
            <Text style={[styles.segText, selected && styles.segTextOn]} maxFontSizeMultiplier={1.2}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
      <Animated.View pointerEvents="none" style={[styles.segThumb, { width: slot }, thumbStyle]} />
    </View>
  );
}

// ─── Correlations heading ──────────────────────────────────────────────────────

function CorrelationHeading({ count }: { count: number }) {
  const { range, setRange } = useTrendRange();
  const options = useMemo(
    () => TREND_RANGE_ORDER.map((key) => ({ key, label: TREND_RANGES[key].label })),
    [],
  );
  const value = Math.max(
    0,
    options.findIndex((o) => o.key === range),
  );
  return (
    <View style={styles.patternsBlock}>
      <SectionHeader
        dark
        marked={false}
        title="Your patterns"
        titleStyle={styles.patternsTitle}
      />
      <GlassSegmented
        options={options}
        value={value}
        onChange={(i) => setRange(options[i].key as typeof range)}
      />
    </View>
  );
}

// ─── Explore: every feature in the app, one glass tile grid ──────────────────

function ExploreSection() {
  const navigation = useNavigation<Nav>();
  const items: { label: string; glyph: GlyphName; go: () => void }[] = [
    { label: 'Log day', glyph: 'journal', go: () => navigation.navigate('DailyLog') },
    { label: 'Timeline', glyph: 'clock', go: () => navigation.navigate('Timeline') },
    { label: 'Meds', glyph: 'pill', go: () => navigation.navigate('Medications') },
    { label: 'Food scan', glyph: 'camera', go: () => navigation.navigate('FoodScan') },
    { label: 'Priority', glyph: 'target', go: () => navigation.navigate('Priority') },
    { label: 'Body map', glyph: 'body', go: () => navigation.navigate('Body') },
    { label: 'Symptoms', glyph: 'pin', go: () => navigation.navigate('SymptomMap') },
    { label: 'Pulse', glyph: 'ecg', go: () => navigation.navigate('Main', { screen: 'PpgMeasure' }) },
    { label: 'Sleep', glyph: 'moon', go: () => navigation.navigate('SleepEngine') },
    { label: 'Activity', glyph: 'bolt', go: () => navigation.navigate('FitnessEngine') },
    { label: 'Nutrition', glyph: 'leaf', go: () => navigation.navigate('NutritionEngine') },
    { label: 'Heart', glyph: 'heart', go: () => navigation.navigate('HeartEngine') },
    { label: 'Wellbeing', glyph: 'face', go: () => navigation.navigate('WellbeingEngine') },
    { label: 'Weight', glyph: 'scale', go: () => navigation.navigate('WeightEngine') },
    { label: 'Discipline', glyph: 'medal', go: () => navigation.navigate('DisciplineEngine') },
    { label: 'Documents', glyph: 'doc', go: () => navigation.navigate('Documents') },
    { label: 'Scan Rx', glyph: 'scan', go: () => navigation.navigate('PrescriptionScanner') },
    { label: 'Cycle', glyph: 'cycle', go: () => navigation.navigate('Cycle') },
    { label: 'Substance', glyph: 'droplet', go: () => navigation.navigate('Substance') },
    { label: 'Voice', glyph: 'mic', go: () => navigation.navigate('VoiceCheckin', { mode: 'setup' }) },
  ];
  return (
    <View>
      <View style={styles.exploreRule} />
      <SectionHeader dark marked={false} title="Explore" titleStyle={styles.patternsTitle} style={styles.exploreHead} />
      <View style={styles.exploreGrid}>
        {items.map((item) => (
          <GlassSurface
            key={item.label}
            noBlur
            radius={20}
            style={styles.exploreTile}
            onPress={item.go}
            accessibilityLabel={item.label}
          >
            <ExploreGlyph name={item.glyph} size={24} color="rgba(255,255,255,0.92)" />
            <Text style={styles.exploreLabel} numberOfLines={2} maxFontSizeMultiplier={1.2}>
              {item.label}
            </Text>
          </GlassSurface>
        ))}
      </View>
    </View>
  );
}
// Curation lives in useCuratedFeed (shared with the Insights feed).

// ─── Build-your-own correlation sheet ────────────────────────────────────────
// Two metric pickers (A + B) backed by live streams. A pair only becomes
// addable when it has ≥3 shared dates — otherwise an honest note explains
// what to log next. Saved picks persist via the parent hook.
function FeedCustomSheet({
  visible,
  onClose,
  streams,
  pairs,
  poolItems,
  addedSeries,
  addedPairs,
  onToggleSeries,
  onTogglePair,
}: {
  visible: boolean;
  onClose: () => void;
  streams: StreamSeries[];
  pairs: CorrelationPair[];
  poolItems: CorrelationFeedItem[];
  addedSeries: string[];
  addedPairs: string[];
  onToggleSeries: (streamId: string) => void;
  onTogglePair: (pairKey: string) => void;
}) {
  const pickable = useMemo(
    () =>
      streams.filter(
        (s) =>
          s.def.id !== 'records' &&
          s.def.id !== 'calories' &&
          !/^Vital(\s|\(|$)/i.test(s.def.label),
      ),
    [streams],
  );
  const [pickA, setPickA] = useState<string | null>(null);
  const [pickB, setPickB] = useState<string | null>(null);

  const activeA = pickA != null && pickable.some((s) => s.def.id === pickA) ? pickA : null;
  const activeB = pickB != null && pickable.some((s) => s.def.id === pickB) ? pickB : null;
  const preview = activeA != null && activeB != null && activeA !== activeB
    ? getPair(pairs, activeA, activeB)
    : null;
  const previewKey = preview ? correlationPairKey(preview.aId, preview.bId) : null;
  const previewAdded = previewKey != null && addedPairs.includes(previewKey);

  const labelOf = (id: string) => pickable.find((s) => s.def.id === id)?.def.label ?? id;

  // Scatter items resolve to canonical pair keys via the live pairs (robust
  // against dashes inside stream ids — never parsed from strings).
  const scatterKeyById = useMemo(() => {
    const m = new Map<string, string>();
    for (const q of pairs) m.set(pairToFeedItem(q).id, correlationPairKey(q.aId, q.bId));
    return m;
  }, [pairs]);
  const scatterKey = (itemId: string) => scatterKeyById.get(itemId) ?? itemId;

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Build your correlation">
      <View style={feedSheet.body}>
        <Text style={feedSheet.sectionTitle}>Pick two metrics</Text>
        <Text style={feedSheet.sectionSub}>A, first metric</Text>
        <View style={feedSheet.chips}>
          {pickable.map((s) => {
            const on = activeA === s.def.id;
            const tone = toneForCategory(s.def.id)[0];
            return (
              <Pressable
                key={`a-${s.def.id}`}
                onPress={() => setPickA(on ? null : s.def.id)}
                style={({ pressed }) => [
                  feedSheet.chip,
                  on && [feedSheet.chipOn, { backgroundColor: tone, borderColor: tone }],
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Use ${s.def.label} as first metric`}
              >
                <Text style={[feedSheet.chipText, on && feedSheet.chipTextOn]}>{s.def.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={feedSheet.sectionSub}>B, second metric</Text>
        <View style={feedSheet.chips}>
          {pickable.map((s) => {
            const on = activeB === s.def.id;
            const tone = toneForCategory(s.def.id)[0];
            return (
              <Pressable
                key={`b-${s.def.id}`}
                onPress={() => setPickB(on ? null : s.def.id)}
                style={({ pressed }) => [
                  feedSheet.chip,
                  on && [feedSheet.chipOn, { backgroundColor: tone, borderColor: tone }],
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Use ${s.def.label} as second metric`}
              >
                <Text style={[feedSheet.chipText, on && feedSheet.chipTextOn]}>{s.def.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {activeA != null && activeB != null ? (
          preview ? (
            <View style={feedSheet.preview}>
              <Text style={feedSheet.previewTitle}>
                {labelOf(preview.aId)} vs {labelOf(preview.bId)}
              </Text>
              <Text style={feedSheet.previewSub}>
                {preview.paired} paired days
                {preview.r != null ? ` · r = ${preview.r >= 0 ? '+' : ''}${preview.r.toFixed(2)}` : ''}
              </Text>
              <Pressable
                onPress={() => previewKey != null && onTogglePair(previewKey)}
                style={({ pressed }) => [
                  feedSheet.previewBtn,
                  previewAdded && feedSheet.previewBtnAdded,
                  pressed && { opacity: 0.75 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={previewAdded ? 'Remove this correlation' : 'Add this correlation to your feed'}
              >
                <Text style={[feedSheet.previewBtnText, previewAdded && feedSheet.previewBtnTextAdded]}>
                  {previewAdded ? 'Added ✓. Tap to remove' : 'Add to my feed'}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text style={feedSheet.hint}>
              {activeA === activeB
                ? 'Pick two different metrics to compare them.'
                : 'Not enough shared days yet. Log both metrics together and this unlocks at 3 paired days.'}
            </Text>
          )
        ) : pickable.length === 0 ? (
          <Text style={feedSheet.hint}>Log a few days first. Metrics you track show up here as pickable options.</Text>
        ) : null}

        {poolItems.length > 0 ? (
          <>
            <Text style={feedSheet.sectionTitle}>Or add one of these</Text>
            {poolItems.map((item) => {
              const isSeries = item.data.kind === 'timeSeries';
              const seriesKey = item.id.replace(/^series-/, '');
              const pairKey = !isSeries ? scatterKey(item.id) : '';
              const added = isSeries ? addedSeries.includes(seriesKey) : addedPairs.includes(pairKey);
              return (
                <View key={item.id} style={feedSheet.row}>
                  <View style={feedSheet.rowText}>
                    <Text style={feedSheet.rowTitle} numberOfLines={1}>{item.title}</Text>
                    {item.subtitle ? (
                      <Text style={feedSheet.rowSub} numberOfLines={1}>{item.subtitle}</Text>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => (isSeries ? onToggleSeries(seriesKey) : onTogglePair(pairKey))}
                    style={({ pressed }) => [
                      feedSheet.rowBtn,
                      added && feedSheet.rowBtnAdded,
                      pressed && { opacity: 0.75 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={added ? `Remove ${item.title}` : `Add ${item.title} to your feed`}
                  >
                    <Text style={[feedSheet.rowBtnText, added && feedSheet.rowBtnTextAdded]}>
                      {added ? 'Added ✓' : 'Add'}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const feedSheet = StyleSheet.create({
  // Dark block inside the sheet (sheet chrome already follows the theme).
  body: { gap: 12, paddingBottom: 16, backgroundColor: '#141A28', borderRadius: SPACE.rCard, padding: SPACE.cardPad },
  sectionTitle: { ...TYPE.title, color: '#FFFFFF', marginTop: 8 },
  sectionSub: { ...TYPE.caption, color: 'rgba(233,240,255,0.6)', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: SPACE.rPill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  chipOn: { backgroundColor: GV.cta, borderColor: GV.cta },
  chipText: { ...TYPE.chip, color: '#FFFFFF' },
  chipTextOn: { color: '#FFFFFF' },
  preview: {
    backgroundColor: '#0B0F1A',
    borderRadius: 16,
    padding: 16,
    gap: 4,
  },
  previewTitle: { ...TYPE.title, color: '#FFFFFF' },
  previewSub: { ...TYPE.body, color: 'rgba(233,240,255,0.6)', fontVariant: ['tabular-nums'] },
  previewBtn: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: SPACE.rPill,
    backgroundColor: GV.cta,
    alignItems: 'center',
  },
  previewBtnAdded: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  previewBtnText: { ...TYPE.button, color: '#FFFFFF' },
  previewBtnTextAdded: { color: '#FFFFFF' },
  hint: { ...TYPE.body, color: 'rgba(233,240,255,0.6)', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { ...TYPE.button, color: '#FFFFFF' },
  rowSub: { ...TYPE.caption, color: 'rgba(233,240,255,0.6)' },
  rowBtn: {
    minWidth: 88,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: SPACE.rPill,
    backgroundColor: GV.cta,
    alignItems: 'center',
  },
  rowBtnAdded: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  rowBtnText: { ...TYPE.chip, color: '#FFFFFF' },
  rowBtnTextAdded: { color: '#FFFFFF' },
});

// ─── Screen ──────────────────────────────────────────────────────────────────────

export default function HealthDashboardScreen() {
  const navigation = useNavigation<Nav>();

  const metrics = useDailyMetrics();
  const medications = useMedications();
  // Global correlation range (Week / Month / Year chips below) — drives the
  // trends window AND the local feed window so switching range visibly
  // retunes every graph.
  const { days: trendDays } = useTrendRange();
  const trends = useTrends(trendDays);
  const story = useHomeStory();

  const [refreshing, setRefreshing] = useState(false);
  const [feedSheetOpen, setFeedSheetOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // Unverified readings nudge — persistent on every open until reviewed.
  const [unverifiedCount, setUnverifiedCount] = useState(0);

  const loadUnverified = useCallback(async () => {
    const patientId = getCachedPatientId();
    if (!patientId) {
      setUnverifiedCount(0);
      return;
    }
    try {
      setUnverifiedCount((await listUnverifiedExtractedDocIds(patientId)).length);
    } catch {
      // Nudge is convenience only — the feed still renders.
    }
  }, []);

  useEffect(() => {
    void loadUnverified();
    const unsubscribe = navigation.addListener('focus', () => {
      void loadUnverified();
    });
    return unsubscribe;
  }, [navigation, loadUnverified]);

  const feedQuery = useCorrelationFeed(trends.data, metrics.data, Math.min(trendDays, 60));

  // Local-first camera heart rate (PPG fingertip + RPPG face, SQLite-direct).
  // Lets a fresh measurement move the dial without any server round trip.
  const localHr = useLocalHeartRate();

  // Priority layer (post-Batch-6): intro exposures only — the Priority
  // itself lives behind the header P button, not in the feed.
  const priorityIntro = usePriorityIntro();
  const goToPrioritySettings = useCallback(() => {
    priorityIntro.dismiss();
    navigation.navigate('Settings');
  }, [navigation, priorityIntro]);

  // ── Correlations curation: unusual system streams are dropped, the feed
  // shows 6–8 core cards by default, and the user can build custom
  // correlations + add more (persisted in AsyncStorage).
  const {
    visibleFeed,
    poolItems,
    addedSeries,
    addedPairs,
    toggleSeries,
    togglePair,
  } = useCuratedFeed(feedQuery.items, feedQuery.streams, feedQuery.pairs);
  const feed = visibleFeed;

  // Focus refetch is time-gated: tab-hopping must not refetch 4 sources
  // every time (refetch storms = scroll jank + spinner blink). A pending
  // save elsewhere (daily log) bypasses the gate so fresh saves never read
  // stale — e.g. an unticked medicine must stop showing as taken at once.
  const lastFocusRefetch = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const forced = consumeDataRefreshRequest();
      const now = Date.now();
      if (!forced && now - lastFocusRefetch.current < 30_000) return;
      lastFocusRefetch.current = now;
      void story.refetch();
      void metrics.refetch();
      void medications.refetch();
      void localHr.refetch();
      feedQuery.refetchLocal();
    }, [story.refetch, metrics.refetch, medications.refetch, localHr.refetch, feedQuery.refetchLocal]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([
      metrics.refetch(),
      medications.refetch(),
      trends.refetch(),
      story.refetch(),
      localHr.refetch(),
      feedQuery.refetchLocal(),
    ]);
    setRefreshing(false);
  }, [metrics.refetch, medications.refetch, trends.refetch, story.refetch, localHr.refetch, feedQuery.refetchLocal]);

  // ── Derived data ──

  // Shared dial pipeline (also drives the Priority world): same inputs,
  // same memo, same output — this screen renders exactly what it did.
  const { dialDay, hMetrics, setDayOffset, setDayRange } = useDialMetrics({
    trendsData: trends.data,
    metricsData: metrics.data,
    localDetails: feedQuery.localDetails,
    takenEvents: feedQuery.takenEvents,
    medSummary: story.medSummary,
    hrPoints: localHr.points,
  });

  // Primitive projections keep the memoized header stable across focus refetches.
  // loggedToday trusts local SQLite AND server state: a log that exists on the
  // server but hasn't hydrated locally (fresh install, cleared storage, another
  // device) must still flip the card to View / Edit.
  const loggedToday = useMemo(() => {
    const todayKey = localDateString();
    return (
      (story.water ?? 0) > 0 ||
      story.todayDetail != null ||
      metrics.data?.today_wellbeing != null ||
      (metrics.data?.recent_daily_logs ?? []).some((l) => l.log_date === todayKey) ||
      story.story.some((s) => s.dayKey === todayKey)
    );
  }, [story.water, story.todayDetail, metrics.data, story.story]);
  const waterMl = story.water;
  const medTaken = story.medSummary?.dosesTaken ?? 0;
  const medExpected = story.medSummary?.dosesExpected ?? 0;

  // Real medications (server + SQLite hydration), active ones only.
  const activeMeds = useMemo(
    () => (medications.data ?? []).filter((m) => m.status === 'ACTIVE'),
    [medications.data],
  );
  const medNames = useMemo(() => activeMeds.map((m) => m.name), [activeMeds]);
  const medActive = activeMeds.length > 0;

  // Up-next dose toggle: green tick = taken today (status only — taken
  // events are permanent), outlined cross = tap to record it now.
  const upNextMed = medActive ? activeMeds[0] : null;
  const upNextTaken = upNextMed
    ? story.takenToday.some((e) => e.medication_id === upNextMed.medication_id)
    : false;
  const toggleUpNextTaken = useCallback(async () => {
    if (!upNextMed) return;
    if (story.takenToday.some((e) => e.medication_id === upNextMed.medication_id)) return;
    const patientId = getCachedPatientId();
    if (!patientId) return;
    try {
      const now = new Date();
      const fallbackTime = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
      await recordMedicationTaken(
        patientId,
        upNextMed.medication_id,
        upNextMed.dose_amount,
        upNextMed.dose_unit,
        upNextMed.scheduled_times?.[0] ?? fallbackTime,
      );
      await Promise.all([medications.refetch(), story.refetch()]);
    } catch {
      // Silent fail — the cross stays and the user can retry.
    }
  }, [upNextMed, story, medications]);

  const goToDailyLog = useCallback(() => navigation.navigate('DailyLog'), [navigation]);
  const goToInsights = useCallback(() => navigation.navigate('Insights'), [navigation]);
  const goToMedications = useCallback(() => navigation.navigate('Medications'), [navigation]);
  const goToTimeline = useCallback(() => navigation.navigate('Timeline'), [navigation]);
  const goToBody = useCallback(() => navigation.navigate('Body'), [navigation]);
  // Priority shortcut: Health Areas pins the user's selected engines at
  // the top, so it IS the Priority view — one tap guides them there.
  const goToPriority = useCallback(() => navigation.navigate('HealthAreas'), [navigation]);
  const goToFullGraph = useCallback(
    () => navigation.navigate('HealthGraph', { source: 'graph' }),
    [navigation],
  );
  const { photoUri } = useProfilePhoto();

  // Scroll reporting drives the side-tab auto-hide (JS side, on flips only).
  // The same crossing flips the nav's scroll-edge state (stronger fill).
  const [scrolled, setScrolled] = useState(false);
  const scrolledRef = useRef(false);
  const updateScrolled = useCallback((y: number) => {
    const s = y > 24;
    if (s !== scrolledRef.current) {
      scrolledRef.current = s;
      setScrolled(s);
    }
  }, []);
  const onScroll = useAnimatedScrollHandler((e) => {
    runOnJS(reportTabScroll)(e.contentOffset.y);
    runOnJS(updateScrolled)(e.contentOffset.y);
  });

  const listHeader = useMemo(() => (
    <View>
      {unverifiedCount > 0 ? (
        <GlassSurface
          strong
          noBlur
          radius={18}
          tint="#D64545"
          tintOpacity={0.1}
          style={styles.reviewBanner}
          onPress={() => navigation.navigate('Documents')}
          accessibilityLabel={`${unverifiedCount} readings need review`}
        >
          <Text style={styles.reviewBannerText}>
            {unverifiedCount === 1
              ? '1 reading needs review'
              : `${unverifiedCount} readings need review`}
          </Text>
          <Text style={styles.reviewBannerChev}>›</Text>
        </GlassSurface>
      ) : null}
      <Entrance index={1}>
        <InsightPanelBlock hMetrics={hMetrics} day={{ off: dialDay.off, max: dialDay.max, label: dialDay.label, range: dialDay.range, onChange: setDayOffset, onRange: setDayRange }} onOpenFullGraph={goToFullGraph} onImprove={(focus) => navigation.navigate('Improve', { focus, metrics: hMetrics })} />
      </Entrance>
      <Entrance index={2}>
        <ActionRowBlock
          loggedToday={loggedToday}
          moodLogged={metrics.data?.today_wellbeing != null}
          waterMl={waterMl}
          medNames={medNames}
          medCount={activeMeds.length}
          medTaken={medTaken}
          medExpected={medExpected}
          medActive={medActive}
          upNextMedId={upNextMed?.medication_id ?? null}
          upNextTaken={upNextTaken}
          onDailyLog={goToDailyLog}
          onMedications={goToMedications}
          onToggleUpNextTaken={() => void toggleUpNextTaken()}
        />
      </Entrance>
      <DayOneSection loggedToday={loggedToday} medications={medications.data ?? []} />
      <CorrelationHeading count={feedQuery.items.length} />
    </View>
  ), [
    loggedToday, metrics.data?.today_wellbeing, waterMl, medNames, activeMeds.length, medTaken, medExpected, medActive,
    upNextMed, upNextTaken, toggleUpNextTaken,
    hMetrics, dialDay, feed.length, goToDailyLog, goToMedications, goToFullGraph,
    navigation, unverifiedCount,
  ]);

  const renderItem = useCallback(({ item, index }: { item: CorrelationFeedItem; index: number }) => (
    <Entrance index={index} style={styles.section}>
      <CorrelationGraphCard
        title={item.title}
        subtitle={item.subtitle}
        data={item.data}
        lineColor={
          item.data.kind === 'timeSeries'
            ? graphToneForStream(item.id)
            : undefined
        }
      />
    </Entrance>
  ), []);

  // Four states for the feed (data-fetching rules): skeleton on first load,
  // designed empty once resolved, stale content kept across refetches.
  // A stalled load (trends never resolves — e.g. no backend reach) must not
  // pin the skeleton forever: after 8s the designed empty state shows.
  const feedLoadingRaw = feed.length === 0 && (feedQuery.isLocalLoading || trends.data == null);
  const [loadStalled, setLoadStalled] = useState(false);
  useEffect(() => {
    if (!feedLoadingRaw) {
      setLoadStalled(false);
      return;
    }
    const t = setTimeout(() => setLoadStalled(true), 8000);
    return () => clearTimeout(t);
  }, [feedLoadingRaw]);
  const feedLoading = feedLoadingRaw && !loadStalled;
  const feedFooter = feedLoading ? null : (
    <View style={styles.section}>
      {feed.length > 3 ? (
        <GlassSurface
          noBlur
          radius={20}
          style={styles.addRow}
          onPress={goToInsights}
          accessibilityLabel={`See all ${feed.length} insights`}
        >
          <View style={styles.addDisc}>
            <Text style={styles.addGlyph}>→</Text>
          </View>
          <View style={styles.addText}>
            <Text style={styles.addTitle}>See all {feed.length} insights</Text>
            <Text style={styles.addSub}>Your cross-engine connections, full screen</Text>
          </View>
          <Text style={styles.addArrow}>›</Text>
        </GlassSurface>
      ) : null}
      <GlassSurface
        noBlur
        radius={20}
        style={styles.addRow}
        onPress={() => setFeedSheetOpen(true)}
        accessibilityLabel="Build your own correlation or add more graphs"
      >
        <View style={styles.addDisc}>
          <Text style={styles.addGlyph}>+</Text>
        </View>
        <View style={styles.addText}>
          <Text style={styles.addTitle}>Build your own correlation</Text>
          <Text style={styles.addSub}>
            {poolItems.length > 0
              ? `Pick two metrics, or add from ${poolItems.length} more`
              : 'Pick any two metrics you track'}
          </Text>
        </View>
        <Text style={styles.addArrow}>›</Text>
      </GlassSurface>
      <ExploreSection />
      <FeedCustomSheet
        visible={feedSheetOpen}
        onClose={() => setFeedSheetOpen(false)}
        streams={feedQuery.streams}
        pairs={feedQuery.pairs}
        poolItems={poolItems}
        addedSeries={addedSeries}
        addedPairs={addedPairs}
        onToggleSeries={toggleSeries}
        onTogglePair={togglePair}
      />
    </View>
  );
  const listEmpty = (
    <View style={styles.section}>
      {feedLoading ? (
        <GlassSurface noBlur radius={LG.card.radius} style={styles.feedSkeleton} accessibilityLabel="Loading health graphs">
          <View style={styles.feedSkeletonBar} />
          <View style={styles.feedSkeletonPlot} />
        </GlassSurface>
      ) : (
        <GlassSurface noBlur radius={LG.card.radius} style={styles.feedEmpty} accessibilityLabel="No health graphs yet">
          <Text style={styles.feedEmptyTitle}>Not enough history yet</Text>
          <Text style={styles.feedEmptyText}>
            Log a few more days. Daily curves unlock with 1 day, comparisons with 3 paired days.
          </Text>
        </GlassSurface>
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      {/* The aurora stage: rich color pinned behind everything so the glass
          surfaces pick up hue as content scrolls over it. */}
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <HeaderBlock
          photoUri={photoUri}
          hasActivity={story.story.length > 0}
          onAvatarPress={() => setProfileOpen(true)}
          onBellPress={goToTimeline}
          onBodyPress={goToBody}
          onPriorityPress={goToPriority}
          scrolled={scrolled}
        />

        <Animated.FlatList
          data={feed.slice(0, 3)}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={
            <>
              <Entrance index={0}>
                <View style={styles.heroBlock}>
                  <Text style={styles.heroTitle} maxFontSizeMultiplier={1.4}>
                    Today
                  </Text>
                  <Text style={styles.heroSub} maxFontSizeMultiplier={1.4}>
                    {dialDay.label}
                  </Text>
                </View>
              </Entrance>
              <ProcessingBanner />
              {listHeader}
            </>
          }
          ListEmptyComponent={listEmpty}
          ListFooterComponent={feedFooter}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          windowSize={7}
          maxToRenderPerBatch={5}
          initialNumToRender={6}
          removeClippedSubviews
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#FFFFFF"
              colors={[GV.cta]}
              progressBackgroundColor={LG.card.fillOpaque}
            />
          }
        />
      </SafeAreaView>
      {/* Avatar opens the profile drawer: features, records, premium, legal. */}
      <ProfileSheet
        visible={profileOpen}
        onClose={() => setProfileOpen(false)}
        photoUri={photoUri}
        onOpen={(route, params) => (navigation.navigate as (r: string, p?: object) => void)(route, params)}
      />
      {/* Priority intro: at most once per day for the first three eligible days. */}
      <PriorityIntroCard
        visible={priorityIntro.visible}
        day={priorityIntro.day}
        onDone={goToPrioritySettings}
        onDismiss={priorityIntro.dismiss}
      />
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────
// Liquid Glass home: aurora stage (painted by HomeStageBackdrop), a floating
// glass nav capsule, and frosted material cards via GlassSurface. Text on
// glass is white / 66% white (≥4.5:1 over every card fill); mint is status
// only. 8pt grid, Poppins via FONT, lgType scale for hero + chrome.

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: LG.stage.bottom,
  },
  safe: {
    flex: 1,
  },

  // Liquid Glass nav bar — floating functional layer on the stage.
  // Follows the home margin law (26px); content scrolls beneath it.
  headerFloat: {
    paddingHorizontal: 26,
    paddingTop: 8,
    paddingBottom: 4,
    zIndex: 5,
  },
  headerGlass: {
    position: 'relative',
    borderRadius: LG.navRadius,
    borderWidth: 1,
    borderColor: LG.border,
    overflow: 'hidden',
  },
  headerGlassScrolled: {
    borderColor: 'rgba(255,255,255,0.18)',
  },
  headerFill: {
    backgroundColor: 'rgba(20,26,38,0.60)',
    borderRadius: LG.navRadius,
  },
  headerFillOpaque: {
    backgroundColor: LG.fillOpaque,
  },
  headerTopEdge: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    height: 1,
    backgroundColor: LG.hairlineTop,
    borderRadius: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  avatarHit: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  avatarPhoto: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  // No photo, no emoji, no invented initial — a quiet glass disc.
  avatarEmpty: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  headerWordmark: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Monochrome glass buttons — quiet circles on the bar's material (no
  // heavy borders); the dock's pulse button is the view's one tinted action.
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.09)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bellDot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FF6B6B',
    borderWidth: 1,
    borderColor: 'rgba(20,26,38,0.9)',
  },
  pressed: { opacity: 0.72, transform: [{ scale: 0.94 }] },

  listContent: {
    // The home margin law: content sits 26px in — the same line the glass
    // cuboid edges follow (16px screen + 10px glass inset).
    paddingHorizontal: 26,
    paddingBottom: 148,
    paddingTop: 20,
    zIndex: 1,
  },
  // Apple large-title hero (content layer, opaque — never glass): one
  // job per screen, Dynamic Type friendly, tabular-nums where dated.
  heroBlock: {
    paddingTop: 16,
    paddingBottom: 16,
    gap: 3,
  },
  heroTitle: {
    // Apple typography: system face (SF Pro on iOS), no custom family.
    fontWeight: '600',
    fontSize: 34,
    lineHeight: 41,
    letterSpacing: -0.8,
    color: '#FFFFFF',
  },
  heroSub: {
    fontWeight: '400',
    fontSize: 17,
    lineHeight: 22,
    color: 'rgba(233,240,255,0.66)',
    fontVariant: ['tabular-nums'],
  },
  section: { marginBottom: SPACE.sectionGap, zIndex: 1 },

  // ── Vitals duo: two frosted instruments, separated from the sections
  // above and below by the shared 28pt rhythm.
  duoRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 28,
  },
  vitalCard: {
    flex: 1,
    minHeight: 142,
    padding: 16,
    gap: 6,
  },
  // Overline + instrument share the top row; the title gets full width.
  vitalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  vitalOverline: {
    ...lgType.overline,
    letterSpacing: 0.5,
    color: 'rgba(233,240,255,0.55)',
    flexShrink: 1,
  },
  vitalTitle: {
    fontWeight: '600',
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.2,
    color: '#FFFFFF',
  },
  vitalSub: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233,240,255,0.66)',
    fontVariant: ['tabular-nums'],
  },
  glyphDiscSm: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  ringCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  ringText: { fontWeight: '600', fontSize: 13, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  vitalCta: {
    alignSelf: 'flex-start',
    borderRadius: SPACE.rPill,
    borderWidth: 1.5,
    borderColor: LG.card.mint,
    paddingHorizontal: 14,
    paddingVertical: 7,
    minHeight: 34,
    justifyContent: 'center',
  },
  vitalCtaText: { ...TYPE.chip, color: LG.card.mint },

  doseTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  doseFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: LG.card.mint,
  },

  // Patterns block: clear the setup card above, air below for the feed.
  patternsBlock: {
    marginTop: 4,
    marginBottom: 16,
  },
  // ── Shared correlation range (iOS segmented control, global state) ──
  // Section heading outranks the 17px card titles below it: larger,
  // tighter, slight negative tracking (display-role treatment).
  patternsTitle: {
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.3,
  },
  segTrack: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 9999,
    padding: 3,
    marginTop: 16,
  },
  segOpt: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    minHeight: 46,
    borderRadius: 9999,
    zIndex: 1,
  },
  segThumb: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  segText: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.2,
    color: 'rgba(255,255,255,0.72)',
  },
  segTextOn: {
    color: '#0B0F1A',
    fontWeight: '700',
  },

  // ── Improve / Keep duo (CTA green + white secondary) ──
  actionDuo: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  duoBtn: {
    flex: 1,
  },

  // ── Unverified-readings nudge: persistent until reviewed. ──
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  reviewBannerText: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: LG.card.danger,
  },
  reviewBannerChev: {
    fontSize: 18,
    color: LG.card.danger,
  },
  // Insights section header — eyebrow + a quiet expand affordance on the
  // right (the whole dial opens the fullscreen map on tap).
  insightHead: {
    marginBottom: 14,
    paddingHorizontal: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  expandHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: SPACE.rPill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  expandHintText: {
    ...TYPE.chip,
    fontSize: 12,
    color: 'rgba(233,240,255,0.75)',
  },
  expandChevron: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(233,240,255,0.55)',
    marginTop: -1,
  },
  // Dial block clears the vitals duo below by the shared 28pt rhythm.
  panelBlock: {
    marginBottom: 28,
  },
  insightEyebrow: {
    // Apple typography: system-weight semibold, white, tracked.
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: 0.3,
    color: '#FFFFFF',
  },
  // The hero instrument panel — teal-tinted rim + outer glow make it the
  // highlight; nothing is painted over the dial itself.
  overviewCard: {
    padding: 10,
    borderColor: 'rgba(94,234,212,0.22)',
    shadowColor: '#2DD4BF',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 10,
  },
  panelMap: { alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', gap: 0 },
  // Day scrubber: label + range chips + week slider, full card width.
  dialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    gap: 2,
  },
  dialCol: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Vertical side rail: the day readout runs down the left cheek of the
  // dial like an etched marking. The text lays out wide then rotates, so
  // it never truncates inside the narrow rail.
  dayWell: {
    width: RAIL_W,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    marginLeft: 4,
  },
  dayLabel: {
    ...TYPE.chip,
    color: SUNKEN_TEAL,
    textAlign: 'center',
    width: 120,
    transform: [{ rotate: '-90deg' }],
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  // Feed states (frosted surfaces)
  feedSkeleton: {
    padding: SPACE.cardPad,
    gap: 12,
  },
  feedSkeletonBar: {
    width: '55%',
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  feedSkeletonPlot: {
    height: 168,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  feedEmpty: {
    padding: SPACE.cardPad,
    gap: 8,
    alignItems: 'center',
  },
  feedEmptyTitle: { fontWeight: '600', fontSize: 18, lineHeight: 24, letterSpacing: -0.3, color: '#FFFFFF', textAlign: 'center' },
  feedEmptyText: { fontWeight: '400', fontSize: 15, lineHeight: 21, color: 'rgba(233,240,255,0.66)', textAlign: 'center' },

  // Action rows at the end of the feed.
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 18,
    minHeight: 60,
    marginBottom: 12,
  },
  addDisc: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(92,232,184,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(92,232,184,0.35)',
  },
  addGlyph: { fontSize: 18, fontWeight: '600', color: LG.card.mint, lineHeight: 22 },
  addText: { flex: 1, gap: 4 },
  addTitle: { fontWeight: '600', fontSize: 16, lineHeight: 22, letterSpacing: -0.2, color: '#FFFFFF' },
  addSub: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: 'rgba(233,240,255,0.66)' },
  addArrow: { fontSize: 16, fontWeight: '600', color: 'rgba(233,240,255,0.5)' },

  // Explore grid: hairline rule, then glass tiles (3 cols). One stroke
  // language via ExploreGlyphs; labels are 11pt, two lines max.
  exploreRule: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginTop: 16,
  },
  exploreHead: {
    marginTop: 16,
  },
  exploreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 16,
  },
  exploreTile: {
    flexBasis: '23%',
    flexGrow: 1,
    minHeight: 88,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 6,
    gap: 8,
  },
  exploreLabel: {
    fontWeight: '500',
    fontSize: 11,
    lineHeight: 14,
    color: 'rgba(255,255,255,0.88)',
    textAlign: 'center',
  },

  // Insights fullscreen modal (glass card on a stage scrim)
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(4,7,14,0.66)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    padding: SPACE.cardPad,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  modalTitleBlock: { flex: 1, gap: 4 },
  modalTitle: { ...TYPE.title, color: '#FFFFFF' },
  modalChartWrap: { alignItems: 'center', marginTop: 16 },
  modalScroll: { maxHeight: 520 },
});
