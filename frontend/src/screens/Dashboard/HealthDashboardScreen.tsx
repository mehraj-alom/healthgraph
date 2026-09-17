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
import { domainHueForStream } from '@/theme/dashboardApple';

import { useTrendRange, TREND_RANGE_ORDER, TREND_RANGES } from '@/context/TrendRangeContext';
import { timingConfig, springSnappy } from '@/theme/motion';
import { useReducedMotion } from '@/theme';
import { IconButton } from '@/components/movements/IconButton';
import { Slider } from '@/components/Slider';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { SectionHeader } from '@/components/SectionHeader';
import HGraphMap, { type HMetric } from '@/components/home/HGraphMap';
import CorrelationGraphCard from '@/components/home/CorrelationGraphCard';

import { BrandLogo } from '@/components/BrandLogo';
import { consumeDataRefreshRequest } from '@/services/dataRefresh';
import { reportTabScroll } from '@/components/tabBarVisibility';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { useProfilePhoto } from '@/hooks/useProfilePhoto';
import { recordMedicationTaken, useMedications } from '@/hooks/useMedications';
import { getCachedPatientId } from '@/services/patientIdentity';
import { useTrends } from '@/hooks/useTrends';
import { detectHeartRate, formatSleepMinutes, formatWaterMl, formatDurationMinutes, localDateString } from '@/screens/Dashboard/homeData';
import { useHomeStory } from '@/screens/Dashboard/useHomeStory';
import { useCorrelationFeed, trendStreams, localStreams, vitalLabelMap, assessMetric, assessSeries, pairToFeedItem, correlationPairKey, getPair, type CorrelationFeedItem, type CorrelationPair, type StreamSeries } from '@/screens/Dashboard/correlations';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BottomSheet } from '@/components/BottomSheet';
import { ProfileSheet } from '@/components/ProfileSheet';
import type { MainTabParamList, RootStackParamList } from '@/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Dashboard'>,
  NativeStackNavigationProp<RootStackParamList>
>;

// ─── Line-glyph icons (inline svg, Guava colors — no icon lib) ────────────────

/** Shift a YYYY-MM-DD day-key by whole days ( noon-anchored, DST-safe ). */
function shiftDay(dateStr: string, delta: number): string {
  return localDateString(new Date(new Date(`${dateStr}T12:00:00`).getTime() + delta * 86400000));
}

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
}: {
  photoUri: string | null;
  hasActivity: boolean;
  onAvatarPress: () => void;
  onBellPress: () => void;
  onBodyPress: () => void;
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
          <BrandLogo height={23} tint={GV.card} />
        </View>
      </View>

      <View style={styles.headerRight}>
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
      {/* ── Daily check-in hero ── */}
      <Card
        style={styles.todayCard}
        accessibilityLabel={loggedToday ? "View or edit today's daily log" : "Enter today's daily log"}
        onPress={onDailyLog}
      >
        <View style={styles.todayRow}>
          <View style={styles.todayText}>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: fullyDone ? GV.cta : GV.muted }]} />
              <Text style={styles.statusText}>
                {loggedToday ? 'TODAY' : "TODAY'S CHECK-IN"}
              </Text>
              <Text style={styles.statusCount}>{`${doneCount}/${signals.length}`}</Text>
            </View>
            <View style={styles.titleRow}>
              <Text style={styles.todayTitle}>
                {fullyDone
                  ? "You're all caught up"
                  : doneCount > 0
                    ? 'Almost there'
                    : "Time to check in"}
              </Text>
              <DupDup done={fullyDone} />
            </View>
            {!fullyDone ? (
              <View style={styles.todayCta}>
                <Text style={styles.todayCtaText}>Check in</Text>
              </View>
            ) : null}
          </View>
          <ProgressRing pct={completion} />
        </View>
      </Card>

      {/* ── Medication up next: a quiet white-card row. The whole row opens
           medications; the toggle records today's dose inline. */}
      <Card
        style={styles.medCard}
        accessibilityLabel={medActive ? `Medications, ${medTaken} of ${medExpected} doses taken` : 'No medications scheduled. Add one.'}
        onPress={onMedications}
      >
        <View style={styles.medIconTile}>
          <PillGlyph size={20} color={GV.fx.blue} />
        </View>
        <View style={styles.medRowText}>
          <Text style={styles.medRowEyebrow}>
            {medActive ? 'MEDICATION · UP NEXT' : 'MEDICATION'}
          </Text>
          <Text style={styles.medRowName} numberOfLines={1}>
            {medActive ? medNames[0] : 'Nothing scheduled'}
          </Text>
          {medActive ? (
            <Text style={styles.medRowSub} numberOfLines={1}>
              {medExpected > 0
                ? `${medTaken} of ${medExpected} doses${medCount > 1 ? ` · +${medCount - 1} more` : ''}`
                : `${medCount} active`}
            </Text>
          ) : (
            <Text style={styles.medRowSub} numberOfLines={1}>Add one to start tracking</Text>
          )}
          {medActive && medExpected > 0 ? <DoseBar pct={dosePct} /> : null}
        </View>
        {medActive && upNextMedId ? (
          <Pressable
            onPress={onToggleUpNextTaken}
            style={({ pressed }) => [
              styles.medTakenToggle,
              upNextTaken ? styles.medTakenToggleOn : styles.medTakenToggleOff,
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: upNextTaken }}
            accessibilityLabel={
              upNextTaken
                ? `${medNames[0]} taken — already recorded`
                : `Mark ${medNames[0]} taken`
            }
            hitSlop={8}
          >
            <Text
              style={[
                styles.medTakenToggleGlyph,
                upNextTaken ? styles.medTakenToggleGlyphOn : styles.medTakenToggleGlyphOff,
              ]}
            >
              {upNextTaken ? '✓' : '✕'}
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.medChevron}>›</Text>
        )}
      </Card>
    </View>
  );
}

// ─── Insights panel (health overview map + actions) ─────────────────────────

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
        accessibilityLabel="Improve — see actions based on your dial"
        style={styles.duoBtn}
      />
      <Button
        title="Keep"
        variant="secondary"
        onPress={() => {
          try { Vibration.vibrate(12); } catch { /* best-effort */ }
          onImprove('keep');
        }}
        accessibilityLabel="Keep — see what is holding steady"
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
  // Honest verdict counts straight from the dial values — no scoring.
  const steadyCount = hMetrics.filter((m) => m.good).length;
  const nudgeCount = hMetrics.length - steadyCount;

  return (
    <View style={styles.section}>
      <View style={styles.insightHead}>
        <Text style={styles.insightEyebrow}>INSIGHT</Text>
      </View>

      {hMetrics.length > 0 ? (
        <Text style={styles.verdictLine}>
          {`${steadyCount} steady${nudgeCount > 0 ? ` · ${nudgeCount} to nudge` : ''}`}
        </Text>
      ) : null}

      <Card style={styles.panel}>
        <Pressable
          style={styles.panelMap}
          onLayout={(e) => setMapWidth(e.nativeEvent.layout.width)}
          onPress={() => setMapOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Expand health overview map"
        >
          {mapWidth > 0 ? (
            <HGraphMap metrics={hMetrics} width={mapWidth} />
          ) : null}
          {/* Day scrubber: pick 7 / 14 / 30 days back, slide through them,
              the dial follows. The static average-chips line it replaces
              is gone for good. */}
          {mapWidth > 0 ? (
            <View style={styles.dayScrub}>
              <View style={styles.dayTopRow}>
                <Text style={styles.dayLabel}>{day.label}</Text>
                <View style={styles.rangeChips}>
                  {[7, 14, 30].map((n) => (
                    <Chip
                      key={n}
                      label={`${n}D`}
                      selected={day.range === n}
                      onPress={() => day.onRange(n)}
                      accessibilityLabel={`Show past ${n} days`}
                    />
                  ))}
                </View>
              </View>
              {day.max > 0 ? (
                <Slider
                  value={day.off}
                  onValueChange={(v) => day.onChange(v)}
                  onLiveChange={(v) => day.onChange(v)}
                  min={0}
                  max={day.max}
                  step={0.1}
                  color={GV.cta}
                  showValue={false}
                />
              ) : null}
            </View>
          ) : null}
        </Pressable>

        {/* Improve / Keep duo lives inside the card, below the dial. */}
        <ImproveKeepDuo onImprove={onImprove} />

        <Pressable
          style={({ pressed }) => [styles.graphLink, pressed && { opacity: 0.6 }]}
          onPress={onOpenFullGraph}
          accessibilityRole="button"
          accessibilityLabel="Explore your health in 3D"
        >
          <Text style={styles.graphLinkText}>Explore in 3D</Text>
          <Text style={styles.graphLinkArrow}>›</Text>
        </Pressable>
      </Card>

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
              <Text style={styles.modalTitle}>Your health at a glance</Text>
            </View>
            <IconButton kind="solid" glyph="✕" accessibilityLabel="Close insights" onPress={onClose} />
          </View>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalChartWrap}
            showsVerticalScrollIndicator={false}
          >
            <HGraphMap metrics={hMetrics} width={mapSizeW} />
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
      <SectionHeader title="How your health connects" subtitle={`${count} graphs`} />
      <View style={styles.rangeRow}>
        {TREND_RANGE_ORDER.map((key) => (
          <Chip
            key={key}
            label={TREND_RANGES[key].label}
            selected={range === key}
            onPress={() => setRange(key)}
            accessibilityLabel={`Show ${TREND_RANGES[key].label} range`}
            style={styles.rangeChipFlex}
          />
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
        <Text style={feedSheet.sectionSub}>A · first metric</Text>
        <View style={feedSheet.chips}>
          {pickable.map((s) => {
            const on = activeA === s.def.id;
            return (
              <Pressable
                key={`a-${s.def.id}`}
                onPress={() => setPickA(on ? null : s.def.id)}
                style={({ pressed }) => [
                  feedSheet.chip,
                  on && feedSheet.chipOn,
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
        <Text style={feedSheet.sectionSub}>B · second metric</Text>
        <View style={feedSheet.chips}>
          {pickable.map((s) => {
            const on = activeB === s.def.id;
            return (
              <Pressable
                key={`b-${s.def.id}`}
                onPress={() => setPickB(on ? null : s.def.id)}
                style={({ pressed }) => [
                  feedSheet.chip,
                  on && feedSheet.chipOn,
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
                  {previewAdded ? 'Added ✓ — tap to remove' : 'Add to my feed'}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text style={feedSheet.hint}>
              {activeA === activeB
                ? 'Pick two different metrics to compare them.'
                : 'Not enough shared days yet — log both metrics together and this unlocks at 3 paired days.'}
            </Text>
          )
        ) : pickable.length === 0 ? (
          <Text style={feedSheet.hint}>Log a few days first — metrics you track show up here as pickable options.</Text>
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
  // Flat white block inside the sheet.
  body: { gap: 12, paddingBottom: 16, backgroundColor: GV.card, borderRadius: SPACE.rCard, padding: SPACE.cardPad },
  sectionTitle: { ...TYPE.title, color: GV.ink, marginTop: 8 },
  sectionSub: { ...TYPE.caption, color: GV.muted, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: SPACE.rPill,
    borderWidth: 1,
    borderColor: GV.line,
    backgroundColor: GV.card,
  },
  chipOn: { backgroundColor: GV.cta, borderColor: GV.cta },
  chipText: { ...TYPE.chip, color: GV.body },
  chipTextOn: { color: '#FFFFFF' },
  preview: {
    backgroundColor: GV.wash,
    borderRadius: 16,
    padding: 16,
    gap: 4,
  },
  previewTitle: { ...TYPE.title, color: GV.ink },
  previewSub: { ...TYPE.body, color: GV.body, fontVariant: ['tabular-nums'] },
  previewBtn: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: SPACE.rPill,
    backgroundColor: GV.cta,
    alignItems: 'center',
  },
  previewBtnAdded: { backgroundColor: GV.card, borderWidth: 1, borderColor: GV.line },
  previewBtnText: { ...TYPE.button, color: '#FFFFFF' },
  previewBtnTextAdded: { color: GV.ink },
  hint: { ...TYPE.body, color: GV.body, backgroundColor: GV.wash, borderRadius: 12, padding: 12, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: GV.line,
  },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { ...TYPE.button, color: GV.ink },
  rowSub: { ...TYPE.caption, color: GV.muted },
  rowBtn: {
    minWidth: 88,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: SPACE.rPill,
    backgroundColor: GV.cta,
    alignItems: 'center',
  },
  rowBtnAdded: { backgroundColor: GV.card, borderWidth: 1, borderColor: GV.line },
  rowBtnText: { ...TYPE.chip, color: '#FFFFFF' },
  rowBtnTextAdded: { color: GV.ink },
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

  const feedQuery = useCorrelationFeed(trends.data, metrics.data, Math.min(trendDays, 60));

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
      feedQuery.refetchLocal();
    }, [story.refetch, metrics.refetch, medications.refetch, feedQuery.refetchLocal]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([
      metrics.refetch(),
      medications.refetch(),
      trends.refetch(),
      story.refetch(),
      feedQuery.refetchLocal(),
    ]);
    setRefreshing(false);
  }, [metrics.refetch, medications.refetch, trends.refetch, story.refetch, feedQuery.refetchLocal]);

  // ── Derived data ──

  // Day scrubber: the dial shows ONE day at a time. dayOffset 0 = latest
  // day with data, up to 6 back. Spoke values are that day's log
  // (carried forward when a day was skipped); verdicts use the window
  // ENDING on that day, so the past reads exactly as it did. No static
  // multi-day averages anywhere on this screen.
  const [dayOffset, setDayOffset] = useState(0);
  /** How many days back the scrubber reaches — user picks 7 / 14 / 30. */
  const [dayRange, setDayRange] = useState(7);

  const dialDay = useMemo(() => {
    const byId = new Map<string, { date: string; value: number }[]>();
    for (const s of [...trendStreams(trends.data), ...localStreams(feedQuery.localDetails, vitalLabelMap(metrics.data))]) {
      // Day-keys only: an ISO datetime would poison string comparison.
      byId.set(
        s.def.id,
        [...s.points]
          .map((p) => ({ date: p.date.slice(0, 10), value: p.value }))
          .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
      );
    }
    let latest = '';
    let earliest = '';
    for (const pts of byId.values()) {
      for (const p of pts) {
        if (!latest || p.date > latest) latest = p.date;
        if (!earliest || p.date < earliest) earliest = p.date;
      }
    }
    const span = latest && earliest
      ? Math.max(0, Math.round((new Date(`${latest}T12:00:00`).getTime() - new Date(`${earliest}T12:00:00`).getTime()) / 86400000))
      : 0;
    const max = Math.min(Math.max(dayRange - 1, 0), span);
    // Fractional scrub position: lo/hi are the bracketing whole days, f the
    // blend between them. Spoke VALUES interpolate (the dial glides); the
    // good/bad verdict rides the nearest whole day (verdicts don't blend).
    const pos = Math.min(Math.max(dayOffset, 0), max);
    const lo = Math.min(Math.floor(pos + 1e-6), max);
    const hi = Math.min(lo + 1, max);
    const f = Math.min(1, Math.max(0, pos - lo));
    const dateLo = latest ? shiftDay(latest, -lo) : '';
    const dateHi = latest ? shiftDay(latest, -hi) : '';
    const dateNear = f < 0.5 ? dateLo : dateHi;
    const out: HMetric[] = [];
    const uptoNear = (id: string) => (byId.get(id) ?? []).filter((p) => p.date <= dateNear).map((p) => p.value);
    const atDate = (id: string, dateStr: string) => {
      const pts = (byId.get(id) ?? []).filter((p) => p.date <= dateStr);
      return pts.length > 0 ? pts[pts.length - 1].value : null;
    };
    const dayVal = (id: string) => {
      const a = atDate(id, dateLo);
      if (f === 0 || dateHi === dateLo) return a;
      const b = atDate(id, dateHi);
      if (a == null) return b;
      if (b == null) return a;
      return a + (b - a) * f;
    };
    const round1 = (v: number) => Math.round(v * 10) / 10;

    const push = (
      id: string,
      label: string,
      min: number,
      max: number,
      bandLo: number,
      bandHi: number,
      higherBetter: boolean,
      eps: number,
      fmt: (avg: number) => string,
    ) => {
      const day = dayVal(id);
      if (day == null) return;
      const a = assessMetric(uptoNear(id), higherBetter, eps, bandLo, bandHi);
      out.push({
        id, label,
        valueText: fmt(day),
        value: Math.max(min, Math.min(max, day)),
        min, max, bandLo, bandHi,
        good: !a.bad, trend: a.trend, avgDays: a.days,
      });
    };

    push('sleepDur', 'Sleep', 0, 600, 420, 540, true, 8, (a) => formatSleepMinutes(Math.round(a)));
    push('energy', 'Energy', 1, 5, 4, 5, true, 0.08, (a) => `${round1(a)}/5`);
    push('water', 'Water', 0, 3000, 2000, 2500, true, 60, (a) => formatWaterMl(Math.round(a)));
    push('stress', 'Stress', 1, 5, 1, 2, false, 0.08, (a) => `Lv ${Math.round(a)}`);
    push('activity', 'Move', 0, 90, 30, 60, true, 3, (a) => formatDurationMinutes(Math.round(a)));
    push('wellbeing', 'Wellbeing', 1, 5, 4, 5, true, 0.08, (a) => `${round1(a)}/5`);
    push('pain', 'Pain', 0, 10, 0, 2, false, 0.15, (a) => `${round1(a)}/10`);
    push('meals', 'Meals', 0, 4, 2, 3, true, 0.08, (a) => `${round1(a)}`);

    // Heart: red when the average leaves the resting band or the trend walks
    // away from it (distance from 80bpm growing).
    const hrPts = uptoNear('hr');
    if (hrPts.length > 0) {
      const day = dayVal('hr') ?? hrPts[hrPts.length - 1];
      const a = assessSeries(hrPts, 1);
      const inBand = day >= 60 && day <= 100;
      const walkingAway = a.enough && Math.abs(hrPts[hrPts.length - 1] - 80) > Math.abs(hrPts[0] - 80) + 2;
      out.push({
        id: 'heart', label: 'Heart', valueText: `${Math.round(day)} bpm`,
        value: Math.max(40, Math.min(120, day)), min: 40, max: 120, bandLo: 60, bandHi: 100,
        good: inBand && !walkingAway, trend: a.trend, avgDays: a.days,
      });
    } else if (dateNear === latest) {
      const hr = detectHeartRate(metrics.data ?? null);
      if (hr) {
        out.push({
          id: 'heart', label: 'Heart', valueText: `${hr.value} bpm`, value: hr.value,
          min: 40, max: 120, bandLo: 60, bandHi: 100,
          good: hr.value >= 60 && hr.value <= 100, trend: 'flat', avgDays: 1,
        });
      }
    }

    // Doses: 7-day adherence — taken (TAKEN) per local day vs the expected
    // schedule; today blends local counts with the server-aware summary.
    const med = story.medSummary;
    if (med?.hasSchedule && med.dosesExpected > 0 && dateNear) {
      // Adherence windows end on the scrubbed days; the shown pct blends
      // between the bracketing days so scrubbing never steps.
      const pctsFor = (endDate: string) => {
        const dayKeys: string[] = [];
        for (let i = 6; i >= 0; i--) dayKeys.push(shiftDay(endDate, -i));
        return dayKeys.map((d) => Math.min(100, ((takenByDay.get(d) ?? 0) / med.dosesExpected) * 100));
      };
      const todayK = localDateString();
      const takenByDay = new Map<string, number>();
      for (const e of feedQuery.takenEvents) {
        if (e.status !== 'TAKEN') continue;
        const k = localDateString(new Date(e.taken_at));
        takenByDay.set(k, (takenByDay.get(k) ?? 0) + 1);
      }
      if (dateNear === todayK) takenByDay.set(todayK, Math.max(takenByDay.get(todayK) ?? 0, med.dosesTaken));
      const pctsLo = pctsFor(dateLo);
      const pctsHi = dateHi === dateLo ? pctsLo : pctsFor(dateHi);
      const pctsNear = f < 0.5 ? pctsLo : pctsHi;
      const a = assessMetric(pctsNear, true, 2, 80, 100);
      const dayPct = pctsLo[pctsLo.length - 1] + (pctsHi[pctsHi.length - 1] - pctsLo[pctsLo.length - 1]) * f;
      out.push({
        id: 'doses', label: 'Doses', valueText: `${Math.round(dayPct)}%`,
        value: Math.max(0, Math.min(100, dayPct)), min: 0, max: 100, bandLo: 80, bandHi: 100,
        good: !a.bad, trend: a.trend, avgDays: a.days,
      });
    }
    const todayK = localDateString();
    const label = !dateNear
      ? 'Log your first day'
      : dateNear === todayK
        ? 'Today'
        : shiftDay(todayK, -1) === dateNear
          ? 'Yesterday'
          : new Date(`${dateNear}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return { metrics: out.slice(0, 10), off: pos, max, label, range: dayRange };
  }, [trends.data, metrics.data, feedQuery.localDetails, feedQuery.takenEvents, story.medSummary, dayOffset, dayRange]);

  const hMetrics = dialDay.metrics;

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
  const { photoUri } = useProfilePhoto();
  const goToFullGraph = useCallback(
    () => navigation.navigate('HealthGraph', { source: 'graph' }),
    [navigation],
  );

  // Scroll reporting drives the side-tab auto-hide (JS side, on flips only).
  const onScroll = useAnimatedScrollHandler((e) => {
    runOnJS(reportTabScroll)(e.contentOffset.y);
  });

  // ── Centered Guava screen title on the stage — static, no parallax.
  const todayLine = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
    [],
  );

  const listHeader = useMemo(() => (
    <View>
      <View style={styles.titleBlock}>
        <Text style={styles.titleEyebrow}>{todayLine}</Text>
        <Text style={styles.titleDisplay}>Health</Text>
      </View>
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
      <InsightPanelBlock hMetrics={hMetrics} day={{ off: dialDay.off, max: dialDay.max, label: dialDay.label, range: dialDay.range, onChange: setDayOffset, onRange: setDayRange }} onOpenFullGraph={goToFullGraph} onImprove={(focus) => navigation.navigate('Improve', { focus, metrics: hMetrics })} />
      <CorrelationHeading count={feed.length} />
    </View>
  ), [
    loggedToday, metrics.data?.today_wellbeing, waterMl, medNames, activeMeds.length, medTaken, medExpected, medActive,
    upNextMed, upNextTaken, toggleUpNextTaken,
    hMetrics, dialDay, feed.length, goToDailyLog, goToMedications, goToFullGraph,
    todayLine, navigation,
  ]);

  const renderItem = useCallback(({ item }: { item: CorrelationFeedItem }) => (
    <View style={styles.section}>
      <CorrelationGraphCard
        title={item.title}
        subtitle={item.subtitle}
        data={item.data}
        lineColor={
          item.data.kind === 'timeSeries'
            ? domainHueForStream(item.id.replace(/^series-/, ''))
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
              ? `Pick two metrics — or add from ${poolItems.length} more`
              : 'Pick any two metrics you track'}
          </Text>
        </View>
        <Text style={styles.addArrow}>›</Text>
      </Card>
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
            Log a few more days — daily curves unlock with 1 day, comparisons with 3 paired days.
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
      />

      <Animated.FlatList
        data={feed}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
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
    </SafeAreaView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────
// Guava-flat: stage background only; every content block a white card
// (radius 20, padding 20, no border, no shadow); Poppins via TYPE; 8pt grid.

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: GV.stage,
  },

  // Header — transparent on the stage, white circular buttons, dark glyphs.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACE.screenH,
    paddingTop: 8,
    paddingBottom: 8,
    zIndex: 5,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: GV.wash,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: GV.stageline,
    overflow: 'hidden',
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
  },
  headerRight: {
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
    color: GV.fog,
    textAlign: 'center',
    marginBottom: 4,
  },
  titleDisplay: {
    ...TYPE.display,
    color: GV.card,
    textAlign: 'center',
  },

  listContent: {
    paddingHorizontal: SPACE.screenH,
    paddingBottom: 112,
    paddingTop: 24,
    zIndex: 1,
  },
  section: { marginBottom: SPACE.sectionGap, zIndex: 1 },
  // Hero sits directly under the title — tighter follow than the gaps
  // between data sections below.
  sectionHero: { marginBottom: 16, gap: SPACE.cardGap },

  // ── Shared correlation range (Week / Month / Year, global state) ──
  rangeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  rangeChipFlex: {
    flex: 1,
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
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { ...TYPE.caption, color: GV.body },
  statusCount: { ...TYPE.caption, color: GV.muted, marginLeft: 2, fontVariant: ['tabular-nums'] },
  // Hug-the-text: grow 0 + shrink 1 (NOT flex:1) so the status badge sits
  // immediately after the words instead of docking at the row's far edge.
  // Long titles still wrap instead of overflowing.
  todayTitle: { ...TYPE.display, color: GV.ink, flexGrow: 0, flexShrink: 1 },
  ringCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  ringText: { ...TYPE.display, color: GV.ink, fontVariant: ['tabular-nums'] },
  todayCta: {
    alignSelf: 'flex-start',
    borderRadius: SPACE.rPill,
    backgroundColor: GV.cta,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 8,
  },
  todayCtaText: { ...TYPE.button, color: '#FFFFFF' },

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
  medRowSub: { ...TYPE.body, color: GV.body, fontVariant: ['tabular-nums'] },
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
  medTakenToggleGlyph: { fontSize: 17, fontFamily: FONT.semi, lineHeight: 22 },
  medTakenToggleGlyphOn: { color: '#FFFFFF' },
  medTakenToggleGlyphOff: { color: GV.cta },
  medChevron: { fontSize: 22, fontFamily: FONT.semi, color: GV.muted, paddingRight: 2 },

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

  // Insights panel — flat white card: map, verdicts, actions, 3D link.
  panel: {
    padding: SPACE.cardPad,
    gap: 12,
  },
  // Insights section header — single quiet eyebrow on the stage (the dial
  // below opens fullscreen on tap, so no expand affordance needed here).
  insightHead: {
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  insightEyebrow: {
    ...TYPE.caption,
    color: GV.fog,
  },
  // One quiet status line straight from the dial values — nothing invented.
  verdictLine: {
    ...TYPE.body,
    color: GV.fog,
    fontVariant: ['tabular-nums'],
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  panelMap: { alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', gap: 8 },
  // Day scrubber: label + range chips + week slider, full card width.
  dayScrub: {
    alignSelf: 'stretch',
    gap: 4,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  dayTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rangeChips: {
    flexDirection: 'row',
    gap: 6,
  },
  dayLabel: {
    ...TYPE.chip,
    color: GV.cta,
    textAlign: 'center',
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
  },
  feedSkeletonBar: {
    width: '55%',
    height: 16,
    borderRadius: 8,
    backgroundColor: GV.wash,
  },
  feedSkeletonPlot: {
    height: 168,
    borderRadius: 16,
    backgroundColor: GV.wash,
  },
  feedEmpty: {
    padding: SPACE.cardPad,
    gap: 8,
    alignItems: 'center',
  },
  feedEmptyTitle: { ...TYPE.title, color: GV.ink, textAlign: 'center' },
  feedEmptyText: { ...TYPE.body, color: GV.body, textAlign: 'center' },

  // Build-your-own entry card at the end of the feed.
  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: SPACE.cardPad,
    minHeight: 56,
  },
  addGlyph: { fontSize: 20, fontFamily: FONT.semi, color: GV.cta, width: 28, textAlign: 'center' },
  addText: { flex: 1, gap: 4 },
  addTitle: { ...TYPE.title, color: GV.ink },
  addSub: { ...TYPE.body, color: GV.body },
  addArrow: { fontSize: 16, fontFamily: FONT.semi, color: GV.muted },

  // Insights fullscreen modal (flat white sheet card on a stage scrim)
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(10, 15, 14, 0.6)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  modalTitleBlock: { flex: 1, gap: 4 },
  modalTitle: { ...TYPE.title, color: GV.ink },
  modalChartWrap: { alignItems: 'center', marginTop: 16 },
  modalScroll: { maxHeight: 520 },
});
