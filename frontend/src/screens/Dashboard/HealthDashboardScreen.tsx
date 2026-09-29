/**
 * HealthDashboardScreen — the "Health Dashboard" home tab.
 *
 * Guava-flat: dark stage, white cards (radius 20, padding 20, no border, no
 * shadow), Poppins via TYPE, one CTA green, fx hues as small icons only.
 * Centered screen title, simple rows, one green CTA. Motion is functional
 * only (press feedback, modal transition); no entrance cascades, no loops.
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
import { toneForCategory, TILE_TONES, graphToneForStream } from '@/theme/tones';

import { useTrendRange, TREND_RANGE_ORDER, TREND_RANGES } from '@/context/TrendRangeContext';
import { timingConfig, springSnappy } from '@/theme/motion';
import { useReducedMotion } from '@/theme';
import { IconButton } from '@/components/movements/IconButton';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { GlassCuboid } from '@/components/GlassCuboid';
import { SectionHeader } from '@/components/SectionHeader';
import HGraphMap, { type HMetric, HMAP_ASPECT } from '@/components/home/HGraphMap';
import { WheelSlider } from '@/components/WheelSlider';
import CorrelationGraphCard from '@/components/home/CorrelationGraphCard';

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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BottomSheet } from '@/components/BottomSheet';
import { ProfileSheet } from '@/components/ProfileSheet';
import type { MainTabParamList, RootStackParamList } from '@/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Dashboard'>,
  NativeStackNavigationProp<RootStackParamList>
>;

// ─── Line-glyph icons (inline svg, Guava colors — no icon lib) ────────────────}

function BellGlyph({ size = 18, color = GV.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 3a4 4 0 0 1 4 4v3.3l1.6 2.4a1 1 0 0 1-.8 1.6H7.2a1 1 0 0 1-.8-1.6L8 10.3V7a4 4 0 0 1 4-4Z"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path
        d="M10.3 18.4a2 2 0 0 0 3.4 0"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function CheckGlyph({ size = 14, color = GV.ink }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M4.5 12.5l5 5 10-11"
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function BodyGlyph({ size = 18, color = GV.ink }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle
        cx={12}
        cy={5}
        r={2.4}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
      />
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
        <Rect x="5" y="9" width="14" height="6" rx="3" fill="none" stroke={color} strokeWidth={1.8} />
        <Line x1="12" y1="9" x2="12" y2="15" stroke={color} strokeWidth={1.8} />
      </G>
    </Svg>
  );
}

// ─── Fixed header ──────────────────────────────────────────────────────────────

function HeaderBlock({
  photoUri,
  hasActivity,
  onAvatarPress,
  onBellPress,
  onBodyPress,
  onPriorityPress,
}: {
  photoUri: string | null;
  hasActivity: boolean;
  onAvatarPress: () => void;
  onBellPress: () => void;
  onBodyPress: () => void;
  onPriorityPress: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <Pressable
          style={({ pressed }) => [styles.avatar, pressed && { opacity: 0.7 }]}
          onPress={onAvatarPress}
          accessibilityRole="button"
          accessibilityLabel="Open profile and settings"
        >
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.avatarPhoto} />
          ) : (
            <View style={styles.avatarEmpty} />
          )}
        </Pressable>
        <View style={styles.headerWordmark}>
          <BrandLogo height={23} tint={GV.ink} />
        </View>
      </View>

      <View style={styles.headerRight}>
        <Pressable
          style={({ pressed }) => [styles.headerPriority, pressed && { opacity: 0.7 }]}
          onPress={onPriorityPress}
          accessibilityRole="button"
          accessibilityLabel="Open my priorities"
        >
          <Text style={styles.headerPriorityText}>P</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.headerBell, pressed && { opacity: 0.7 }]}
          onPress={onBodyPress}
          accessibilityRole="button"
          accessibilityLabel="Open 3D body"
        >
          <BodyGlyph />
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.headerBell, pressed && { opacity: 0.7 }]}
          onPress={onBellPress}
          accessibilityRole="button"
          accessibilityLabel="Open timeline"
        >
          <BellGlyph />
          {hasActivity ? <View style={styles.bellDot} /> : null}
        </Pressable>
      </View>
    </View>
  );
}

// ─── Today stack ───────────────────────────────────────────────────────────────
// One calm vertical stack: a full-width daily check-in hero (status → title
// → one CTA, honest progress ring) above a medication "up next" row. One tap
// target per card, one type voice, flat white cards on the stage.

/** Dose progress fill: static honest fraction — no arrival motion. */
function DoseBar({ pct }: { pct: number }) {
  const w = `${Math.max(0, Math.min(1, pct)) * 100}` as `${number}`;
  return (
    <View style={styles.doseTrack}>
      <View style={[styles.doseFill, { width: `${w}%` as `${number}%` }]} />
    </View>
  );
}

/**
 * Day-status badge: CTA-green tick when the day is done, quiet wash cross
 * when it isn't. Static by design — a status badge is read, not watched.
 */
function DupDup({
  done,
  size = 26,
}: {
  done: boolean;
  size?: number;
}) {
  return (
    <View
      style={[
        styles.dupBadge,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: done ? GV.cta : GV.wash,
        },
      ]}
      accessible
      accessibilityLabel={done ? "Today's log complete" : "Today's log not done"}
    >
      {done ? (
        <CheckGlyph size={Math.round(size * 0.55)} color="#FFFFFF" />
      ) : (
        <Text style={[styles.dupCross, { fontSize: Math.round(size * 0.55) }]}>✕</Text>
      )}
    </View>
  );
}

/** Today-readiness ring: the hero instrument. Static honest fraction. */
function ProgressRing({ pct, size = 120 }: { pct: number; size?: number }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));

  return (
    <View style={{ width: size, height: size }} accessible accessibilityLabel={`${Math.round(clamped * 100)} percent of today's routine complete`}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={GV.line} strokeWidth={stroke} />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={GV.cta}
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
  // log row exists. A partial day keeps the working state (cross, CTA).
  const fullyDone = signals.length > 0 && doneCount >= signals.length;

  return (
    <View style={[styles.section, styles.sectionHero]}>
      {/* ── Check-in + medication: two square boxes, one line ── */}
      <View style={styles.duoRow}>
        <Card
          style={styles.checkBox}
          accessibilityLabel={loggedToday ? "View or edit today's daily log" : "Enter today's daily log"}
          onPress={onDailyLog}
        >
          <View style={styles.statusRow}>
            <Text style={styles.statusText}>
              {loggedToday ? 'Today' : "Today's check-in"}
            </Text>
          </View>
          <Text style={styles.todayTitle}>
            {fullyDone
              ? 'Done'
              : doneCount > 0
                ? 'Partial'
                : 'Check in needed'}
          </Text>
          <Text style={styles.todayPct}>{`${Math.round(completion * 100)}%`}</Text>
          {!fullyDone ? (
            <View style={styles.todayCta}>
              <Text style={styles.todayCtaText}>Check in</Text>
            </View>
          ) : null}
        </Card>

        <Card
          style={styles.medBox}
          accessibilityLabel={medActive ? `Medications, ${medTaken} of ${medExpected} doses taken` : 'No medications scheduled. Add one.'}
          onPress={onMedications}
        >
          <Text style={styles.medBoxLabel}>Medication</Text>
          {medActive ? (
            <ScrollView
              style={styles.medList}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
            >
              {medNames.map((name, i) => (
                <Text key={name} style={styles.medListItem} numberOfLines={1}>
                  {`${i + 1}. ${name}`}
                </Text>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.medRowSub} numberOfLines={1}>Add one to start tracking</Text>
          )}
        </Card>
      </View>
    </View>
  );
}

// ─── Insights panel (health overview map + actions) ─────────────────────────
// Wheel lane beside the dial: 44px wheel + 4px breathing room.
const WHEEL_LANE = 48;
// Left rail for the vertical day readout.
const RAIL_W = 24;
// Submerged resin tone: deeper than the bright stage teal so the wheel +
// day readout read cast inside the cuboid rather than floating on it.
const SUNKEN_TEAL = '#2E8B7E';

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
  // Dial keeps full size: only the wheel lane + day rail are reserved.
  const dialW = Math.round(mapWidth - RAIL_W - (day.max > 0 ? WHEEL_LANE : 0));
  return (
    <View style={styles.section}>
      <View style={styles.insightHead}>
        <Text style={styles.insightEyebrow}>Overview</Text>
      </View>

      {/* Resin stack: dial + slider + yesterday laid down first, with the
          glass cuboid poured above them as a clear cover sheet. */}
      <View style={styles.panel}>
        <View
          style={styles.panelMap}
          onLayout={(e) => setMapWidth(e.nativeEvent.layout.width)}
        >
          {mapWidth > 0 ? (
            <View style={styles.dialRow}>
              <View style={styles.dayWell}>
                <Text style={styles.dayLabel} numberOfLines={1}>
                  {day.label}
                </Text>
              </View>
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
        <GlassCuboid overlay auraColor={GV.teal} auraOpacity={0.1} radius={24} />
      </View>

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
        <Animated.View style={[styles.modalCard, cardStyle]}>
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
            <GlassCuboid pad={12} radius={24} auraColor={GV.teal} auraOpacity={0.08}>
              <HGraphMap metrics={hMetrics} width={mapSizeW} />
            </GlassCuboid>
            <ImproveKeepDuo onImprove={onImprove} />
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ─── Correlations heading ──────────────────────────────────────────────────────

function CorrelationHeading({ count }: { count: number }) {
  const { range, setRange } = useTrendRange();
  return (
    <View style={[styles.section, styles.corrHeadingWrap]}>
      <SectionHeader
        dark
        title="Your patterns"
        titleStyle={styles.patternsTitle}
      />
      <View style={styles.rangeTrack}>
        {TREND_RANGE_ORDER.map((key) => {
          const selected = range === key;
          return (
            <Pressable
              key={key}
              onPress={() => setRange(key)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`Show ${TREND_RANGES[key].label} range`}
              style={[styles.rangeSeg, selected && styles.rangeSegOn]}
            >
              <Text style={[styles.rangeSegText, selected && styles.rangeSegTextOn]}>
                {TREND_RANGES[key].label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── Explore: every feature in the app, one tile grid ─────────────────────────

function ExploreSection() {
  const navigation = useNavigation<Nav>();
  const items: { label: string; bg: string; go: () => void }[] = [
    { label: 'Log day', bg: '#5A6078', go: () => navigation.navigate('DailyLog') },
    { label: 'Timeline', bg: '#66666F', go: () => navigation.navigate('Timeline') },
    { label: 'Medications', bg: '#8A4A55', go: () => navigation.navigate('Medications') },
    { label: 'Food scan', bg: '#6E7F4E', go: () => navigation.navigate('FoodScan') },
    { label: 'Priority', bg: '#57507A', go: () => navigation.navigate('Priority') },
    { label: 'Body map', bg: '#8A7A5C', go: () => navigation.navigate('Body') },
    { label: 'Symptom map', bg: '#7C6272', go: () => navigation.navigate('SymptomMap') },
    { label: 'Pulse check', bg: '#56837B', go: () => navigation.navigate('Main', { screen: 'PpgMeasure' }) },
    { label: 'Sleep', bg: '#57507A', go: () => navigation.navigate('SleepEngine') },
    { label: 'Activity', bg: '#96684A', go: () => navigation.navigate('FitnessEngine') },
    { label: 'Nutrition', bg: '#6E7F4E', go: () => navigation.navigate('NutritionEngine') },
    { label: 'Heart', bg: '#56837B', go: () => navigation.navigate('HeartEngine') },
    { label: 'Wellbeing', bg: '#66666F', go: () => navigation.navigate('WellbeingEngine') },
    { label: 'Weight', bg: '#5C6E7C', go: () => navigation.navigate('WeightEngine') },
    { label: 'Discipline', bg: '#7C6272', go: () => navigation.navigate('DisciplineEngine') },
    { label: 'Documents', bg: '#5A6078', go: () => navigation.navigate('Documents') },
    { label: 'Scan prescription', bg: '#527A6E', go: () => navigation.navigate('PrescriptionScanner') },
    { label: 'Cycle', bg: '#8A4A55', go: () => navigation.navigate('Cycle') },
    { label: 'Substance', bg: '#8A7A5C', go: () => navigation.navigate('Substance') },
  ];
  return (
    <View style={styles.section}>
      <View style={styles.exploreRule} />
      <SectionHeader dark title="Explore" titleStyle={styles.patternsTitle} />
      <View style={styles.exploreGrid}>
        {items.map((item, i) => (
          <Pressable
            key={item.label}
            onPress={item.go}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            style={({ pressed }) => [
              styles.exploreTile,
              { backgroundColor: item.bg },
              i === items.length - 1 && items.length % 2 === 1 && styles.exploreTileFull,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.exploreLabel}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
// ─── Correlations curation ───────────────────────────────────────────────────
// Unusual/system streams never reach the feed: records processed, logging
// rhythm, calories (a pure derivative of active minutes), and unlabeled
// generic vitals ("Vital (mg)" with no concept name).
const DROPPED_ITEM_IDS = new Set(['series-records', 'series-rhythm', 'series-calories']);

function isUnusualItem(item: CorrelationFeedItem): boolean {
  if (DROPPED_ITEM_IDS.has(item.id)) return true;
  if (item.id.startsWith('series-vital:') && /^Vital(\s|\(|$)/i.test(item.title)) return true;
  return false;
}

// Core daily signals in display order — the default 6–8 cards.
const CORE_STREAM_ORDER = [
  'sleepDur',
  'wellbeing',
  'energy',
  'stress',
  'water',
  'activity',
  'pain',
  'hr',
];
const MAX_CORE_SERIES = 5;
const MAX_TOP_SCATTERS = 3;

const FEED_PREFS_KEY = 'hg:feed-custom:v1';

interface FeedPrefs {
  series: string[];
  pairs: string[];
}

/**
 * useCuratedFeed — curated correlations: unusual cards dropped, 6–8 core
 * cards by default, user-added series + custom-built pairs persisted.
 * Pure derivation over the live feed; no fetching of its own.
 */
function useCuratedFeed(
  liveItems: CorrelationFeedItem[],
  streams: StreamSeries[],
  pairs: CorrelationPair[],
): {
  visibleFeed: CorrelationFeedItem[];
  poolItems: CorrelationFeedItem[];
  addedSeries: string[];
  addedPairs: string[];
  toggleSeries: (streamId: string) => void;
  togglePair: (pairKey: string) => void;
} {
  const [addedSeries, setAddedSeries] = useState<string[]>([]);
  const [addedPairs, setAddedPairs] = useState<string[]>([]);
  const loadedRef = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(FEED_PREFS_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw) as FeedPrefs;
          if (Array.isArray(parsed.series)) setAddedSeries(parsed.series.filter((s) => typeof s === 'string'));
          if (Array.isArray(parsed.pairs)) setAddedPairs(parsed.pairs.filter((s) => typeof s === 'string'));
        } catch {
          // Corrupt prefs — fall back to defaults.
        }
      })
      .catch(() => {})
      .finally(() => {
        loadedRef.current = true;
      });
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    AsyncStorage.setItem(FEED_PREFS_KEY, JSON.stringify({ series: addedSeries, pairs: addedPairs } satisfies FeedPrefs)).catch(
      () => {},
    );
  }, [addedSeries, addedPairs]);

  const toggleSeries = useCallback((streamId: string) => {
    setAddedSeries((prev) => (prev.includes(streamId) ? prev.filter((s) => s !== streamId) : [...prev, streamId]));
  }, []);

  const togglePair = useCallback((pairKey: string) => {
    setAddedPairs((prev) => (prev.includes(pairKey) ? prev.filter((s) => s !== pairKey) : [...prev, pairKey]));
  }, []);

  const curated = useMemo(() => {
    const live = liveItems.filter((i) => !isUnusualItem(i));
    const series = live.filter((i) => i.data.kind === 'timeSeries');
    const scatters = live.filter((i) => i.data.kind === 'correlation');
    const seriesById = new Map(series.map((s) => [s.id, s]));

    // Default core: first present core streams (≤5) + top verdict scatters (≤3).
    const core: CorrelationFeedItem[] = [];
    for (const sid of CORE_STREAM_ORDER) {
      if (core.length >= MAX_CORE_SERIES) break;
      const it = seriesById.get(`series-${sid}`);
      if (it) core.push(it);
    }
    const top = scatters.slice(0, MAX_TOP_SCATTERS);

    // User additions, resolved against live data (stale ids drop out).
    const added: CorrelationFeedItem[] = [];
    for (const sid of addedSeries) {
      const it = seriesById.get(`series-${sid}`);
      if (it) added.push(it);
    }
    for (const key of addedPairs) {
      const p = pairs.find((q) => correlationPairKey(q.aId, q.bId) === key) ?? null;
      if (p) added.push(pairToFeedItem(p));
    }

    const seen = new Set<string>();
    const visibleFeed: CorrelationFeedItem[] = [];
    for (const it of [...core, ...top, ...added]) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      visibleFeed.push(it);
    }
    const poolItems = live.filter((i) => !seen.has(i.id));
    return { visibleFeed, poolItems };
  }, [liveItems, pairs, addedSeries, addedPairs]);

  return {
    visibleFeed: curated.visibleFeed,
    poolItems: curated.poolItems,
    addedSeries,
    addedPairs,
    toggleSeries,
    togglePair,
  };
}

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
  body: { gap: 12, paddingBottom: 16, backgroundColor: '#10141F', borderRadius: SPACE.rCard, padding: SPACE.cardPad },
  sectionTitle: { ...TYPE.title, color: '#FFFFFF', marginTop: 8 },
  sectionSub: { ...TYPE.caption, color: '#A7B8B2', marginTop: 4 },
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
    backgroundColor: '#04060B',
    borderRadius: 16,
    padding: 16,
    gap: 4,
  },
  previewTitle: { ...TYPE.title, color: '#FFFFFF' },
  previewSub: { ...TYPE.body, color: '#A7B8B2', fontVariant: ['tabular-nums'] },
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
  hint: { ...TYPE.body, color: '#A7B8B2', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, overflow: 'hidden' },
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
  rowSub: { ...TYPE.caption, color: '#A7B8B2' },
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
  const goToMedications = useCallback(() => navigation.navigate('Medications'), [navigation]);
  const goToTimeline = useCallback(() => navigation.navigate('Timeline'), [navigation]);
  const goToBody = useCallback(() => navigation.navigate('Body'), [navigation]);
  const goToSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);
  // Priority shortcut: Health Areas pins the user's selected engines at
  // the top, so it IS the Priority view — one tap guides them there.
  const goToPriority = useCallback(() => navigation.navigate('HealthAreas'), [navigation]);
  const { photoUri } = useProfilePhoto();
  const goToFullGraph = useCallback(
    () => navigation.navigate('HealthGraph', { source: 'graph' }),
    [navigation],
  );

  // Scroll reporting drives the side-tab auto-hide (JS side, on flips only).
  const onScroll = useAnimatedScrollHandler((e) => {
    runOnJS(reportTabScroll)(e.contentOffset.y);
  });

  const listHeader = useMemo(() => (
    <View>
      {unverifiedCount > 0 ? (
        <Pressable
          onPress={() => navigation.navigate('Documents')}
          accessibilityRole="button"
          accessibilityLabel={`${unverifiedCount} readings need review`}
          style={({ pressed }) => [styles.reviewBanner, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.reviewBannerText}>
            {unverifiedCount === 1
              ? '1 reading needs review'
              : `${unverifiedCount} readings need review`}
          </Text>
          <Text style={styles.reviewBannerChev}>›</Text>
        </Pressable>
      ) : null}
      <InsightPanelBlock hMetrics={hMetrics} day={{ off: dialDay.off, max: dialDay.max, label: dialDay.label, range: dialDay.range, onChange: setDayOffset, onRange: setDayRange }} onOpenFullGraph={goToFullGraph} onImprove={(focus) => navigation.navigate('Improve', { focus, metrics: hMetrics })} />
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
      <CorrelationHeading count={feed.length} />
    </View>
  ), [
    loggedToday, metrics.data?.today_wellbeing, waterMl, medNames, activeMeds.length, medTaken, medExpected, medActive,
    upNextMed, upNextTaken, toggleUpNextTaken,
    hMetrics, dialDay, feed.length, goToDailyLog, goToMedications, goToFullGraph, goToSettings,
    navigation, unverifiedCount,
  ]);

  const renderItem = useCallback(({ item }: { item: CorrelationFeedItem }) => (
    <View style={styles.section}>
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
    </View>
  ), []);

  // Four states for the feed (data-fetching rules): skeleton on first load,
  // designed empty once resolved, stale content kept across refetches.
  const feedLoading = feed.length === 0 && (feedQuery.isLocalLoading || trends.data == null);
  const feedFooter = feedLoading ? null : (
    <View style={styles.section}>
      <Card
        onPress={() => setFeedSheetOpen(true)}
        style={styles.addCard}
        accessibilityLabel="Build your own correlation or add more graphs"
      >
        <Text style={styles.addGlyph}>+</Text>
        <View style={styles.addText}>
          <Text style={styles.addTitle}>Build your own correlation</Text>
          <Text style={styles.addSub}>
            {poolItems.length > 0
              ? `Pick two metrics, or add from ${poolItems.length} more`
              : 'Pick any two metrics you track'}
          </Text>
        </View>
        <Text style={styles.addArrow}>›</Text>
      </Card>
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
        <Card style={styles.feedSkeleton} accessibilityLabel="Loading health graphs">
          <View style={styles.feedSkeletonBar} />
          <View style={styles.feedSkeletonPlot} />
        </Card>
      ) : (
        <Card style={styles.feedEmpty} accessibilityLabel="No health graphs yet">
          <Text style={styles.feedEmptyTitle}>Not enough history yet</Text>
          <Text style={styles.feedEmptyText}>
            Log a few more days. Daily curves unlock with 1 day, comparisons with 3 paired days.
          </Text>
        </Card>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <HeaderBlock
        photoUri={photoUri}
        hasActivity={story.story.length > 0}
        onAvatarPress={() => setProfileOpen(true)}
        onBellPress={goToTimeline}
        onBodyPress={goToBody}
        onPriorityPress={goToPriority}
      />

      <Animated.FlatList
        data={feed}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={
          <>
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
            tintColor={GV.fog}
            colors={[GV.cta]}
            progressBackgroundColor={GV.card}
          />
        }
      />
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
    </SafeAreaView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────
// Guava-flat: stage background only; every content block a white card
// (radius 20, padding 20, no border, no shadow); Poppins via TYPE; 8pt grid.

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#080A11',
  },

  // Header — transparent on the stage, white circular buttons, dark glyphs.
  // Follows the home margin law (26px).
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 26,
    paddingTop: 8,
    paddingBottom: 8,
    zIndex: 5,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: GV.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E7E1F5',
    overflow: 'hidden',
    shadowColor: 'rgba(46, 16, 101, 1)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  avatarPhoto: {
    width: '100%',
    height: '100%',
  },
  // No photo, no emoji, no invented initial — a quiet empty disc.
  avatarEmpty: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
    backgroundColor: GV.wash,
  },
  headerWordmark: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerBell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: GV.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E7E1F5',
    shadowColor: 'rgba(46, 16, 101, 1)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  // Priority shortcut — orange disc with a white P, same 40pt chrome as
  // its header neighbours. Leads to Health Areas, where the user's
  // selected (pinned) engines are their Priority.
  headerPriority: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: GV.fx.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerPriorityText: {
    fontFamily: FONT.semi,
    fontSize: 20,
    lineHeight: 24,
    color: '#FFFFFF',
  },  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bellDot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: GV.cta,
  },

  // Centered screen title on the stage.
  titleBlock: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  titleEyebrow: {
    ...TYPE.caption,
    color: GV.violet,
    textAlign: 'center',
    marginBottom: 4,
  },
  titleDisplay: {
    ...TYPE.display,
    color: '#FFFFFF',
    textAlign: 'center',
  },

  listContent: {
    // The home margin law: content sits 26px in — the same line the glass
    // cuboid edges follow (16px screen + 10px glass inset).
    paddingHorizontal: 26,
    paddingBottom: 112,
    paddingTop: 24,
    zIndex: 1,
  },
  section: { marginBottom: SPACE.sectionGap, zIndex: 1 },
  // Hero sits directly under the title — tighter follow than the gaps
  // between data sections below.
  sectionHero: { marginBottom: 16, gap: SPACE.cardGap },

  // ── Check-in + medication: compact dark rectangles for the black stage.
  duoRow: {
    flexDirection: 'row',
    gap: 12,
  },
  checkBox: {
    flex: 1,
    minHeight: 104,
    justifyContent: 'flex-start',
    gap: 5,
    backgroundColor: '#0D1B16',
    borderColor: 'rgba(61,220,132,0.22)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  medBox: {
    flex: 1,
    minHeight: 104,
    justifyContent: 'flex-start',
    gap: 5,
    backgroundColor: '#0E1626',
    borderColor: 'rgba(89,214,230,0.20)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  medBoxLabel: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    color: '#7FD8E8',
    alignSelf: 'stretch',
    textAlign: 'center',
    backgroundColor: 'rgba(89,214,230,0.14)',
    borderRadius: 8,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  medList: {
    flex: 1,
  },
  medListItem: {
    ...TYPE.button,
    fontSize: 14,
    color: '#FFFFFF',
    paddingVertical: 2,
    fontVariant: ['tabular-nums'],
  },

  // ── Shared correlation range (Week / Month / Year, global state) ──
  // Section heading outranks the 17px card titles below it: larger,
  // tighter, slight negative tracking (display-role treatment).
  patternsTitle: {
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.3,
  },
  // Segmented range control: one glass track, solid-white segment on.
  rangeTrack: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 9999,
    padding: 3,
    marginTop: 12,
  },
  rangeSeg: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 9999,
  },
  rangeSegOn: {
    backgroundColor: '#FFFFFF',
  },
  rangeSegText: {
    ...TYPE.chip,
    color: 'rgba(255,255,255,0.75)',
  },
  rangeSegTextOn: {
    color: '#080A11',
    fontFamily: FONT.bold,
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

  // ── Today stack: check-in hero (flat white card) ──
  todayCard: {
    padding: SPACE.cardPad,
  },
  todayRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  todayText: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dupBadge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  dupCross: { fontFamily: FONT.semi, color: GV.muted, lineHeight: undefined },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(61,220,132,0.16)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { ...TYPE.caption, fontFamily: FONT.semi, color: '#3DDC84', textAlign: 'center' },
  statusCount: { ...TYPE.caption, color: GV.muted, marginLeft: 2, fontVariant: ['tabular-nums'] },
  // Hug-the-text: grow 0 + shrink 1 (NOT flex:1) so the status badge sits
  // immediately after the words instead of docking at the row's far edge.
  // Long titles still wrap instead of overflowing.
  todayTitle: { fontFamily: FONT.semi, fontSize: 17, lineHeight: 22, letterSpacing: -0.2, color: '#FFFFFF', flexGrow: 0, flexShrink: 1 },
  todayPct: {
    ...TYPE.title,
    fontSize: 16,
    lineHeight: 22,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  ringCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  ringText: { ...TYPE.display, color: GV.ink, fontVariant: ['tabular-nums'] },
  todayCta: {
    alignSelf: 'flex-start',
    borderRadius: SPACE.rPill,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#3DDC84',
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  todayCtaText: { ...TYPE.chip, color: '#3DDC84' },

  // ── Medication row: a flat white card. ──
  medCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: SPACE.cardPad,
  },
  medIconTile: { width: 40, height: 40, borderRadius: 12, backgroundColor: GV.wash, alignItems: 'center', justifyContent: 'center' },
  medRowText: { flex: 1, gap: 4 },
  medRowEyebrow: { ...TYPE.caption, color: GV.muted },
  medRowName: { ...TYPE.title, color: GV.ink },
  medRowSub: { ...TYPE.body, color: '#A7B8B2', fontVariant: ['tabular-nums'] },
  // Up-next taken toggle: CTA-green filled tick (taken, status only) vs
  // CTA-green outline cross (tap to record the dose now).
  medTakenToggle: {
    width: 36,
    height: 36,
    borderRadius: 9999,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medTakenToggleOn: { backgroundColor: GV.cta, borderColor: GV.cta },
  medTakenToggleOff: { backgroundColor: 'transparent', borderColor: GV.cta },
  medTakenToggleGlyph: { fontSize: 14, fontFamily: FONT.semi, lineHeight: 18 },
  medTakenToggleGlyphOn: { color: '#FFFFFF' },
  medTakenToggleGlyphOff: { color: GV.cta },

  doseTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: GV.line,
    marginTop: 12,
    overflow: 'hidden',
  },
  doseFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: GV.cta,
  },

  // Insights panel — breaks back out to the 16px screen line so the glass
  // cuboid (10px inset) lands exactly on the 26px home margin.
  panel: {
    position: 'relative',
    marginHorizontal: -10,
  },
  // Unverified-readings nudge: persistent until every reading is reviewed.
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(214,69,69,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(214,69,69,0.4)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  reviewBannerText: {
    ...TYPE.chip,
    color: '#F09696',
  },
  reviewBannerChev: {
    fontSize: 18,
    color: '#F09696',
  },
  // Insights section header — single quiet eyebrow on the stage (the dial
  // below opens fullscreen on tap, so no expand affordance needed here).
  insightHead: {
    marginBottom: 12,
    paddingHorizontal: 0,
  },
  insightEyebrow: {
    // Apple typography: system font (SF on iOS), semibold, white —
    // no custom family here on purpose.
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: 0.3,
    color: '#FFFFFF',
  },
  // One quiet status line straight from the dial values — nothing invented.
  verdictLine: {
    ...TYPE.body,
    color: GV.body,
    fontVariant: ['tabular-nums'],
    marginBottom: 12,
    paddingHorizontal: 0,
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
  // Recessed well: the day readout sits engraved inside the glass bar,
  // tight under the dial — one instrument, not two stacked cards.
  // No separate background here: the day readout floats bare inside the
  // glass cuboid, like lettering cast in resin — one continuous piece.
  // Vertical side rail: the day readout runs down the left cheek of the
  // dial like an etched marking. The text lays out wide then rotates, so
  // it never truncates inside the narrow rail.
  dayWell: {
    width: RAIL_W,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    // Nudged a lil inside, toward the dial.
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
  // Quiet footer link to the full 3D graph.
  graphLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    marginTop: 4,
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: GV.line,
  },
  graphLinkText: { ...TYPE.button, color: GV.ink },
  graphLinkArrow: { fontSize: 16, fontFamily: FONT.semi, color: GV.muted },

  // Correlations heading — shared SectionHeader + CTA Chip row.
  corrHeadingWrap: { marginTop: 16 },

  // Feed states (flat white cards)
  feedSkeleton: {
    padding: SPACE.cardPad,
    gap: 12,
    backgroundColor: '#10141F',
    borderColor: 'rgba(255,255,255,0.10)',
  },
  feedSkeletonBar: {
    width: '55%',
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
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
    backgroundColor: '#10141F',
    borderColor: 'rgba(255,255,255,0.10)',
  },
  feedEmptyTitle: { ...TYPE.title, color: '#FFFFFF', textAlign: 'center' },
  feedEmptyText: { ...TYPE.body, color: '#A7B8B2', textAlign: 'center' },

  // Build-your-own entry card at the end of the feed.
  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: SPACE.cardPad,
    minHeight: 56,
    backgroundColor: '#10141F',
    borderColor: 'rgba(255,255,255,0.10)',
  },
  addGlyph: { fontSize: 20, fontFamily: FONT.semi, color: '#4FD1C5', width: 28, textAlign: 'center' },
  addText: { flex: 1, gap: 4 },
  addTitle: { ...TYPE.title, color: '#FFFFFF' },
  addSub: { ...TYPE.body, color: '#A7B8B2' },
  addArrow: { fontSize: 16, fontFamily: FONT.semi, color: '#A7B8B2' },

  // Explore grid: hairline rule, then solid-tone tiles (2 cols, odd last
  // full-width). Tile hues are stable per feature, never by position.
  exploreRule: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginTop: 8,
  },
  exploreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  exploreTile: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 84,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  exploreTileFull: {
    flexBasis: '100%',
  },
  exploreLabel: {
    fontFamily: FONT.medium,
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  // Insights fullscreen modal (dark sheet card on a stage scrim)
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(10, 15, 14, 0.6)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#10141F',
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
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
