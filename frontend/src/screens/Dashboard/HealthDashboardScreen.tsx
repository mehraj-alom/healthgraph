/**
 * HealthDashboardScreen — the "Health Dashboard" home tab.
 *
 * Layout (per the wireframe): fixed header (greeting + centered wordmark +
 * alerts bell) with the rest of the page scrolling underneath. Below the header
 * sit a two-up action row ("Enter Daily Logs", "Active medication"), the dark
 * insights panel (radar ⇄ embedded 3D graph via an animated segmented toggle),
 * and the "correlations feed" of chart cards with a staggered entrance.
 *
 * Pure UI build: reuses the movements theme tokens + IconButton, existing hooks
 * (useDailyMetrics, useMedications, useTrends, useHomeStory) and the existing
 * 3D HealthGraphScreen mounted in an additive `embedded` mode. No backend
 * changes. All colors/radii/spacing come from the movements tokens.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Platform,
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
  withRepeat,
  withSequence,
  withDelay,
  interpolate,
  Extrapolation,
  Easing,
} from 'react-native-reanimated';
import Svg, { Path, Rect, Circle, Defs, Pattern } from 'react-native-svg';

import { mv, mvType } from '@/theme/movements';
import { COLORS, SPACING, BORDER_RADIUS, TYPOGRAPHY } from '@/constants';
import { useTrendRange, TREND_RANGE_ORDER, TREND_RANGES } from '@/context/TrendRangeContext';
import { timingConfig, springSnappy, durations, curves } from '@/theme/motion';
import { useReducedMotion } from '@/theme';
import { IconButton } from '@/components/movements/IconButton';
import { PressScale } from '@/components/PressScale';
import Entrance from '@/components/home/Entrance';
import HGraphMap, { type HMetric } from '@/components/home/HGraphMap';
import CorrelationGraphCard from '@/components/home/CorrelationGraphCard';

import LiftCard from '@/components/home/LiftCard';
import { BrandLogo } from '@/components/BrandLogo';
import { consumeDataRefreshRequest } from '@/services/dataRefresh';
import { reportTabScroll } from '@/components/tabBarVisibility';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { formatFirstName } from '@/utils/name';
import { useAuth } from '@/context/AuthContext';
import { useProfilePhoto } from '@/hooks/useProfilePhoto';
import { recordMedicationTaken, useMedications } from '@/hooks/useMedications';
import { getCachedPatientId } from '@/services/patientIdentity';
import { useTrends } from '@/hooks/useTrends';
import { buildHealthDimensions, detectHeartRate, formatSleepMinutes, formatWaterMl, formatDurationMinutes, localDateString } from '@/screens/Dashboard/homeData';
import { useHomeStory } from '@/screens/Dashboard/useHomeStory';
import { useCorrelationFeed, trendStreams, localStreams, vitalLabelMap, assessMetric, assessSeries, type CorrelationFeedItem } from '@/screens/Dashboard/correlations';
import type { MainTabParamList, RootStackParamList } from '@/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Dashboard'>,
  NativeStackNavigationProp<RootStackParamList>
>;

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// ─── Line-glyph icons (inline svg, theme colors — no icon lib) ────────────────

function BellGlyph({ size = 18, color = mv.textOnLightPrimary }) {
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

function CheckGlyph({ size = 14, color = mv.textOnLightPrimary }: { size?: number; color?: string }) {
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

// ─── Fixed header ──────────────────────────────────────────────────────────────

function HeaderBlock({
  greeting,
  name,
  initial,
  photoUri,
  hasActivity,
  onAvatarPress,
  onBellPress,
}: {
  greeting: string;
  name: string;
  initial: string;
  photoUri: string | null;
  hasActivity: boolean;
  onAvatarPress: () => void;
  onBellPress: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <Pressable
          style={styles.avatar}
          onPress={onAvatarPress}
          accessibilityRole="button"
          accessibilityLabel="Open profile and settings"
        >
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.avatarPhoto} />
          ) : (
            <Text style={styles.avatarText}>{initial}</Text>
          )}
        </Pressable>
        <View style={styles.headerGreeting}>
          <Text style={styles.greetingSmall}>{greeting},</Text>
          <Text style={styles.greetingName} numberOfLines={1}>{name}</Text>
        </View>
      </View>

      <View style={styles.headerWordmark}>
        <BrandLogo height={23} />
      </View>

      <Pressable
        style={styles.headerBell}
        onPress={onBellPress}
        accessibilityRole="button"
        accessibilityLabel="Open timeline"
      >
        <BellGlyph />
        {hasActivity ? <View style={styles.bellDot} /> : null}
      </Pressable>
    </View>
  );
}

// ─── Today stack ───────────────────────────────────────────────────────────────
// One calm vertical stack instead of a cramped two-up row: a full-width daily
// check-in hero (status → title → one CTA, honest progress ring) above a slim
// medication "up next" row in the reference's Upcoming-schedule language.
// One tap target per card, one type voice (grotesk), no ambient glow/sheen —
// the cards rest until pressed (LiftCard still gives tactile feedback).

const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, serif' });

/** Ambient glow blob: slow opacity breath, static when reduced-motion is on. */
function BreathingGlow({ style }: { style?: object }) {
  const reduced = useReducedMotion();
  const breath = useSharedValue(0.22);
  useEffect(() => {
    if (reduced) {
      breath.value = 0.22;
      return;
    }
    breath.value = withRepeat(
      withTiming(0.34, { duration: 2400, easing: Easing.bezier(...curves.standard) }),
      -1,
      true,
    );
  }, [reduced, breath]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: breath.value }));
  return <Animated.View pointerEvents="none" style={[style, glowStyle]} />;
}

/** Dose progress fill: springs from 0 → pct on mount / change. */
function DoseBar({ pct }: { pct: number }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      p.value = pct;
      return;
    }
    p.value = withDelay(350, withSpring(pct, { duration: 600, dampingRatio: 0.85 }));
  }, [pct, reduced, p]);
  const barStyle = useAnimatedStyle(() => ({ width: `${Math.max(0, Math.min(1, p.value)) * 100}%` as never }));
  return (
    <View style={styles.doseTrack}>
      <Animated.View style={[styles.doseFill, barStyle]} />
    </View>
  );
}

/**
 * DupDup — lub-dub heartbeat badge: two quick pulses, then rest, on loop.
 * Green tick when the day is done, red cross when it isn't. Static under
 * reduced motion.
 */
function DupDup({
  done,
  size = 26,
}: {
  done: boolean;
  size?: number;
}) {
  const reduced = useReducedMotion();
  const beat = useSharedValue(1);
  const color = done ? '#4E9B5F' : '#C2503E';
  useEffect(() => {
    if (reduced) return;
    beat.value = withRepeat(
      withSequence(
        withTiming(1.22, { duration: 170 }),
        withTiming(1, { duration: 150 }),
        withTiming(1.22, { duration: 170 }),
        withTiming(1, { duration: 150 }),
        withTiming(1, { duration: 1300 }),
      ),
      -1,
      false,
    );
  }, [beat, reduced]);
  const beatStyle = useAnimatedStyle(() => ({
    transform: [{ scale: beat.value }],
  }));
  return (
    <Animated.View
      style={[
        styles.dupBadge,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color + '1A', borderColor: color },
        beatStyle,
      ]}
      accessible
      accessibilityLabel={done ? "Today's log complete" : "Today's log not done"}
    >
      {done ? (
        <CheckGlyph size={Math.round(size * 0.55)} color={color} />
      ) : (
        <Text style={[styles.dupCross, { color, fontSize: Math.round(size * 0.55) }]}>✕</Text>
      )}
    </Animated.View>
  );
}

/** Honest today-progress ring: mood + water + doses, nothing invented. */
function ProgressRing({ pct, size = 84 }: { pct: number; size?: number }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  const complete = clamped >= 1;
  return (
    <View style={{ width: size, height: size }} accessible accessibilityLabel={`${Math.round(clamped * 100)} percent of today's routine complete`}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E9E0CE" strokeWidth={stroke} />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={complete ? '#4E9B5F' : '#E8862E'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${clamped * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.ringCenter} pointerEvents="none">
        <Text style={styles.ringText}>{`${Math.round(clamped * 100)}%`}</Text>
      </View>
    </View>
  );
}

/** Clinical-red wash backdrop for the Insights panel.
 * White card base (style), pale red aurora with a slow breath, one slate
 * wash, one rose kiss, and a faint ink dot-grid for texture. Pure views +
 * one static Svg — no new dependencies, clipped by the card's overflow. */
function PanelBackdrop() {
  return (
    <>
      <BreathingGlow style={styles.auraRed} />
      <View style={styles.auraSlate} pointerEvents="none" />
      <View style={styles.auraRose} pointerEvents="none" />
      <Svg width="100%" height="100%" style={styles.panelTexture}>
        <Defs>
          <Pattern id="panelDots" width={18} height={18} patternUnits="userSpaceOnUse">
            <Circle cx={1.5} cy={1.5} r={1.2} fill="rgba(22,33,44,0.05)" />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#panelDots)" />
      </Svg>
      <View style={styles.panelTopLight} pointerEvents="none" />
    </>
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
  const statusColor = loggedToday ? '#4E9B5F' : '#C96A1E';

  return (
    <View style={styles.section}>
      {/* ── Daily check-in hero ── */}
      <Entrance index={0} staggerMs={70}>
        <LiftCard
          style={[styles.todayCard, fullyDone && styles.todayCardLit]}
          contentContainerStyle={styles.todayCardContent}
          accessibilityLabel={loggedToday ? "View or edit today's daily log" : "Enter today's daily log"}
          onPress={onDailyLog}
          pressedBg="rgba(29,27,23,0.04)"
        >
          <View style={styles.todayRow}>
            <View style={styles.todayText}>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[styles.statusText, { color: statusColor }]}>
                  {loggedToday ? 'TODAY' : "TODAY'S CHECK-IN"}
                </Text>
                <Text style={styles.statusCount}>{`${doneCount}/${signals.length}`}</Text>
              </View>
              <View style={styles.titleRow}>
                <Text style={[styles.todayTitle, fullyDone && styles.todayTitleCaughtUp]}>
                  {fullyDone
                    ? "You're all caught up"
                    : doneCount > 0
                      ? 'Almost there'
                      : "Time to check in"}
                </Text>
                <DupDup done={fullyDone} />
              </View>
              {!fullyDone ? (
                <View style={[styles.todayCta, styles.todayCtaPrimary]}>
                  <Text style={styles.todayCtaPrimaryText}>Check in</Text>
                </View>
              ) : null}
            </View>
            <ProgressRing pct={completion} />
          </View>
        </LiftCard>
      </Entrance>

      {/* ── Medication up next ── */}
      <Entrance index={1} staggerMs={70}>
        <LiftCard
          style={styles.medRowCard}
          contentContainerStyle={styles.medRowContent}
          accessibilityLabel={medActive ? `Medications, ${medTaken} of ${medExpected} doses taken` : 'No medications scheduled. Add one.'}
          onPress={onMedications}
          pressedBg="rgba(29,27,23,0.04)"
        >
          <View style={styles.medIconTile}>
            <Text style={styles.medIcon}>💊</Text>
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
              style={[
                styles.medTakenToggle,
                upNextTaken ? styles.medTakenToggleOn : styles.medTakenToggleOff,
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
          ) : null}
          {medActive && medExpected > 0 ? (
            <View style={styles.dosePill}>
              <Text style={styles.dosePillText}>{`${medTaken}/${medExpected}`}</Text>
            </View>
          ) : (
            <Text style={styles.medChevron}>›</Text>
          )}
        </LiftCard>
      </Entrance>
    </View>
  );
}

// ─── Insights panel (health overview map + actions) ─────────────────────────

function InsightPanelBlock({
  hMetrics,
  mapHint,
  onOpenFullGraph,
  onImprove,
}: {
  hMetrics: HMetric[];
  mapHint: string;
  onOpenFullGraph: () => void;
  /** Improve / Keep duo → parent navigates to the actions window. */
  onImprove: (focus: 'improve' | 'keep') => void;
}) {
  const [mapOpen, setMapOpen] = useState(false);
  const [mapWidth, setMapWidth] = useState(0);

  return (
    <Entrance index={1} style={styles.section}>
      <View style={styles.insightHead}>
        <View>
          <Text style={styles.insightEyebrow}>Insights</Text>
          <Text style={styles.insightTitle}>Your health at a glance</Text>
        </View>
        <Pressable
          style={styles.insightExpand}
          onPress={() => setMapOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Expand health overview"
        >
          <Text style={styles.insightExpandText}>Expand</Text>
          <Text style={styles.insightExpandGlyph}>↗</Text>
        </Pressable>
      </View>

      <View style={styles.panel}>
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
          {mapWidth > 0 ? (
            <Text style={styles.panelHint} numberOfLines={2}>{mapHint}</Text>
          ) : null}
        </Pressable>

        {/* Improve / Keep duo lives inside the card, below the dial. */}
        <View style={styles.actionDuo}>
          <PressScale
            onPress={() => {
              try { Vibration.vibrate(12); } catch { /* best-effort */ }
              onImprove('improve');
            }}
            accessibilityLabel="Improve — see actions based on your dial"
            scaleTo={0.95}
            hitSlop={12}
            style={[styles.duoBtn, styles.duoImprove]}
          >
            <Text style={styles.duoImproveText}>Improve</Text>
          </PressScale>
          <PressScale
            onPress={() => {
              try { Vibration.vibrate(12); } catch { /* best-effort */ }
              onImprove('keep');
            }}
            accessibilityLabel="Keep — see what is holding steady"
            scaleTo={0.95}
            hitSlop={12}
            style={[styles.duoBtn, styles.duoKeep]}
          >
            <Text style={styles.duoKeepText}>Keep</Text>
          </PressScale>
        </View>

        <Pressable
          style={styles.graphLink}
          onPress={onOpenFullGraph}
          accessibilityRole="button"
          accessibilityLabel="Explore your health in 3D"
        >
          <Text style={styles.graphLinkText}>Explore in 3D</Text>
          <Text style={styles.graphLinkArrow}>→</Text>
        </Pressable>
      </View>

      <MapFullscreen visible={mapOpen} hMetrics={hMetrics} onClose={() => setMapOpen(false)} onImprove={(focus) => { setMapOpen(false); onImprove(focus); }} />
    </Entrance>
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
  const mapSizeW = Math.min(windowWidth - mv.spaceScreen * 2 - mv.spaceCard * 2, Math.floor(height * 0.36));

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.modalScrim, scrimStyle]}>
        <Animated.View style={[styles.modalCard, cardStyle]}>
          <PanelBackdrop />
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleBlock}>
              <Text style={styles.eyebrowClinical}>Insights</Text>
              <Text style={styles.modalTitle}>Your health at a glance</Text>
            </View>
            <IconButton kind="white" glyph="✕" accessibilityLabel="Close insights" onPress={onClose} />
          </View>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalChartWrap}
            showsVerticalScrollIndicator={false}
          >
            <HGraphMap metrics={hMetrics} width={mapSizeW} />
            <View style={styles.actionDuo}>
              <PressScale
                onPress={() => {
                  try { Vibration.vibrate(12); } catch { /* best-effort */ }
                  onImprove('improve');
                }}
                accessibilityLabel="Improve — see actions based on your dial"
                scaleTo={0.95}
                hitSlop={12}
                style={[styles.duoBtn, styles.duoImprove]}
              >
                <Text style={styles.duoImproveText}>Improve</Text>
              </PressScale>
              <PressScale
                onPress={() => {
                  try { Vibration.vibrate(12); } catch { /* best-effort */ }
                  onImprove('keep');
                }}
                accessibilityLabel="Keep — see what is holding steady"
                scaleTo={0.95}
                hitSlop={12}
                style={[styles.duoBtn, styles.duoKeep]}
              >
                <Text style={styles.duoKeepText}>Keep</Text>
              </PressScale>
            </View>
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
    <Entrance index={2} style={[styles.section, styles.corrHeadingWrap]}>
      <View style={styles.corrHeader}>
        <View>
          <Text style={styles.corrEyebrow}>Correlations</Text>
          <Text style={styles.corrTitle}>How your health connects</Text>
        </View>
        <View style={styles.corrSeeAll}>
          <Text style={styles.corrSeeAllText}>{count} graphs</Text>
          <Text style={styles.corrSeeAllText}>→</Text>
        </View>
      </View>
      <View style={styles.rangeRow}>
        {TREND_RANGE_ORDER.map((key) => {
          const active = range === key;
          return (
            <Pressable
              key={key}
              onPress={() => setRange(key)}
              style={[styles.rangeChip, active && styles.rangeChipSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Show ${TREND_RANGES[key].label} range`}
            >
              <Text style={[styles.rangeChipText, active && styles.rangeChipTextSelected]}>
                {TREND_RANGES[key].label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Entrance>
  );
}

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

  const feedQuery = useCorrelationFeed(trends.data, metrics.data, Math.min(trendDays, 60));
  const feed = feedQuery.items;

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
  const dims = useMemo(
    () => buildHealthDimensions(metrics.data, story.water, story.medSummary),
    [metrics.data, story.water, story.medSummary],
  );

  // hGraph spokes: MULTI-DAY averages with trend verdicts — never a single
  // day. Each spoke averages its last ≤7 real points; red when the metric
  // slid the wrong way for 3+ days or its average left the healthy band.
  // Missing = no spoke (never a zero dot).
  const hMetrics = useMemo<HMetric[]>(() => {
    const out: HMetric[] = [];
    const byId = new Map<string, number[]>();
    for (const s of [...trendStreams(trends.data), ...localStreams(feedQuery.localDetails, vitalLabelMap(metrics.data))]) {
      byId.set(s.def.id, s.points.map((p) => p.value));
    }
    const vals = (id: string) => byId.get(id) ?? [];
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
      const a = assessMetric(vals(id), higherBetter, eps, bandLo, bandHi);
      if (a.days === 0) return;
      out.push({
        id, label,
        valueText: fmt(a.avg),
        value: Math.max(min, Math.min(max, a.avg)),
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
    const hrVals = vals('hr');
    if (hrVals.length > 0) {
      const a = assessSeries(hrVals, 1);
      const inBand = a.avg >= 60 && a.avg <= 100;
      const walkingAway = a.enough && Math.abs(hrVals[hrVals.length - 1] - 80) > Math.abs(hrVals[0] - 80) + 2;
      out.push({
        id: 'heart', label: 'Heart', valueText: `${Math.round(a.avg)} bpm`,
        value: Math.max(40, Math.min(120, a.avg)), min: 40, max: 120, bandLo: 60, bandHi: 100,
        good: inBand && !walkingAway, trend: a.trend, avgDays: a.days,
      });
    } else {
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
    if (med?.hasSchedule && med.dosesExpected > 0) {
      const dayKeys: string[] = [];
      for (let i = 6; i >= 0; i--) dayKeys.push(localDateString(new Date(Date.now() - i * 86400000)));
      const todayK = localDateString();
      const takenByDay = new Map<string, number>();
      for (const e of feedQuery.takenEvents) {
        if (e.status !== 'TAKEN') continue;
        const k = localDateString(new Date(e.taken_at));
        takenByDay.set(k, (takenByDay.get(k) ?? 0) + 1);
      }
      takenByDay.set(todayK, Math.max(takenByDay.get(todayK) ?? 0, med.dosesTaken));
      const pcts = dayKeys.map((d) => Math.min(100, ((takenByDay.get(d) ?? 0) / med.dosesExpected) * 100));
      const a = assessMetric(pcts, true, 2, 80, 100);
      out.push({
        id: 'doses', label: 'Doses', valueText: `${Math.round(a.avg)}%`,
        value: Math.max(0, Math.min(100, a.avg)), min: 0, max: 100, bandLo: 80, bandHi: 100,
        good: !a.bad, trend: a.trend, avgDays: a.days,
      });
    }
    return out.slice(0, 10);
  }, [trends.data, metrics.data, feedQuery.localDetails, feedQuery.takenEvents, story.medSummary]);

  const mapHint = useMemo(() => {
    if (dims.length === 0) return 'No health data yet — log your first day to fill this in.';
    return [...dims]
      .sort((a, b) => b.magnitude - a.magnitude)
      .slice(0, 3)
      .map((d) => `${d.icon} ${d.detail}`)
      .join('   ·   ');
  }, [dims]);

  // Primitive projections keep the memoized header stable across focus refetches
  // (so the staggered entrance only plays on first mount, not on every refetch).
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
  // events are permanent), red cross = tap to record it now.
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
  const goToSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);
  const { photoUri } = useProfilePhoto();
  const goToFullGraph = useCallback(
    () => navigation.navigate('HealthGraph', { source: 'graph' }),
    [navigation],
  );

  // ── Parallax deco — the background drifts slower than the cards ──
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
    // Side-tab auto-hide runs on the JS side (notified only on flips).
    runOnJS(reportTabScroll)(e.contentOffset.y);
  });
  const decoStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -scrollY.value * 0.32 }],
  }));

  const { userProfile } = useAuth();
  const firstName = formatFirstName(userProfile?.displayName) || 'there';
  const greeting = greetingForHour(new Date().getHours());

  const listHeader = useMemo(() => (
    <View>
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
      <InsightPanelBlock hMetrics={hMetrics} mapHint={mapHint} onOpenFullGraph={goToFullGraph} onImprove={(focus) => navigation.navigate('Improve', { focus, metrics: hMetrics })} />
      <CorrelationHeading count={feed.length} />
    </View>
  ), [
    loggedToday, metrics.data?.today_wellbeing, waterMl, medNames, activeMeds.length, medTaken, medExpected, medActive,
    upNextMed, upNextTaken, toggleUpNextTaken,
    hMetrics, mapHint, feed.length, goToDailyLog, goToMedications, goToFullGraph,
  ]);

  const renderItem = useCallback(({ item, index }: { item: CorrelationFeedItem; index: number }) => (
    <Entrance index={3 + index} style={styles.section}>
      <CorrelationGraphCard
        title={item.title}
        subtitle={item.subtitle}
        data={item.data}
      />
    </Entrance>
  ), []);

  // Four states for the feed (data-fetching rules): skeleton on first load,
  // designed empty once resolved, stale content kept across refetches.
  const feedLoading = feed.length === 0 && (feedQuery.isLocalLoading || trends.data == null);
  const listEmpty = (
    <View style={styles.section}>
      {feedLoading ? (
        <View style={styles.feedSkeleton} accessible accessibilityLabel="Loading health graphs">
          <View style={styles.feedSkeletonBar} />
          <View style={styles.feedSkeletonPlot} />
        </View>
      ) : (
        <View style={styles.feedEmpty} accessible accessibilityLabel="No health graphs yet">
          <Text style={styles.feedEmptyTitle}>Not enough history yet</Text>
          <Text style={styles.feedEmptyText}>
            Log a few more days — daily curves unlock with 1 day, comparisons with 3 paired days.
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <HeaderBlock
        greeting={greeting}
        name={firstName}
        initial={firstName.charAt(0).toUpperCase()}
        photoUri={photoUri}
        hasActivity={story.story.length > 0}
        onAvatarPress={goToSettings}
        onBellPress={goToTimeline}
      />

      <Animated.View pointerEvents="none" style={[styles.deco, decoStyle]} />

      <Animated.FlatList
        data={feed}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
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
            tintColor={mv.textOnLightSecondary}
            colors={[mv.textOnLightPrimary]}
            progressBackgroundColor={mv.surfaceWhite}
          />
        }
      />
    </SafeAreaView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: mv.surfaceOffwhite,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: mv.spaceScreen,
    paddingTop: 8,
    paddingBottom: 6,
    zIndex: 5,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 128 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: mv.surfaceDarkCard,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: mv.surfaceWhite,
    overflow: 'hidden',
  },
  avatarPhoto: {
    width: '100%',
    height: '100%',
  },
  avatarText: { ...mvType.navTitle, color: mv.textOnDarkPrimary, fontSize: 15 },
  headerGreeting: { marginLeft: mv.spaceSideBySide, flexShrink: 1, maxWidth: '52%' },
  greetingSmall: { ...mvType.caption, color: mv.textOnLightSecondary, fontSize: 12, lineHeight: 16 },
  greetingName: { ...mvType.navTitle, color: mv.textOnLightPrimary, marginTop: 1, fontSize: 15, lineHeight: 20 },
  headerWordmark: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  headerBell: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: mv.accentCoral,
  },

  deco: {
    position: 'absolute',
    top: -150,
    left: -60,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(11,104,82,0.07)',
    zIndex: 0,
  },

  listContent: {
    paddingHorizontal: mv.spaceScreen,
    paddingBottom: 110,
    paddingTop: mv.spaceStack - 4,
    zIndex: 1,
  },
  section: { marginBottom: mv.spaceStack, zIndex: 1 },

  // ── Shared correlation range (Week / Month / Year, global state) ──
  rangeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  rangeChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E6DBC6',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  rangeChipSelected: { backgroundColor: '#1D1B17', borderColor: '#1D1B17' },
  rangeChipText: { fontSize: 12, fontWeight: '700', color: '#5C6B7A' },
  rangeChipTextSelected: { color: '#FFFFFF' },

  // ── Improve / Keep duo (replaces the signal tiles) ──
  actionDuo: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: 10,
  },
  duoBtn: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  duoImprove: {
    backgroundColor: '#2B8A3E',
    borderColor: '#2B8A3E',
    shadowColor: '#2B8A3E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  duoImproveText: {
    ...TYPOGRAPHY.bodyStrong,
    fontSize: 16,
    color: '#FFFFFF',
  },
  duoKeep: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E6DBC6',
  },
  duoKeepText: {
    ...TYPOGRAPHY.bodyStrong,
    fontSize: 16,
    color: '#16212C',
  },
  // ── Today stack: check-in hero ──
  todayCard: {
    backgroundColor: '#FFFBF3',
    borderRadius: mv.radiusCard,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E6DBC6',
    boxShadow: '0 1px 2px rgba(124,90,46,0.08), 0 10px 28px rgba(124,90,46,0.10)',
  },
  // Same breathing room as the medication card below (medRowContent),
  // with a tighter top so TODAY sits closer to the card edge.
  todayCardContent: { padding: 14, paddingTop: 5, gap: 0.5 },
  // Lit-up state when the day is fully logged: light green wash, green
  // border, soft green glow.
  todayCardLit: {
    backgroundColor: '#EDF6EE',
    borderColor: 'rgba(78,155,95,0.55)',
    boxShadow: '0 1px 2px rgba(78,155,95,0.18), 0 10px 30px rgba(78,155,95,0.22)',
  },
  todayRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  todayText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dupBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  dupCross: { fontWeight: '800', lineHeight: undefined },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { ...mvType.pill, letterSpacing: 1.4, fontSize: 11, fontWeight: '800' },
  statusCount: { ...mvType.pill, color: '#A8A094', fontSize: 11, marginLeft: 2, fontVariant: ['tabular-nums'] },
  // Hug-the-text: grow 0 + shrink 1 (NOT flex:1) so the tick/cross badge
  // sits immediately after the words instead of docking at the row's far
  // edge. Long titles still wrap instead of overflowing.
  todayTitle: { color: '#1D1B17', fontSize: 20, fontWeight: '800', letterSpacing: -0.4, lineHeight: 24, flexGrow: 0, flexShrink: 1 },
  // Caught-up title in a different face: Georgia serif italic, larger,
  // deep green — instantly distinct from every grotesk headline.
  todayTitleCaughtUp: {
    fontFamily: 'Georgia, serif',
    fontStyle: 'italic',
    fontWeight: '700',
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: 0,
    color: '#2F7A3E',
  },
  todayCaption: { ...mvType.caption, color: '#797166' },
  ringCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  ringText: { fontSize: 16, fontWeight: '800', color: '#1D1B17', fontVariant: ['tabular-nums'] },
  todayCta: { alignSelf: 'flex-start', borderRadius: mv.radiusPill, paddingHorizontal: 16, paddingVertical: 9 },
  todayCtaPrimary: { backgroundColor: '#1D1B17' },
  todayCtaQuiet: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#D3C3A6' },
  todayCtaPrimaryText: { ...mvType.pill, color: '#FFFFFF', fontWeight: '800' },
  todayCtaQuietText: { ...mvType.pill, color: '#1D1B17', fontWeight: '800' },

  // ── Today stack: medication up-next row ──
  medRowCard: {
    marginTop: 10,
    backgroundColor: '#FFFBF3',
    borderRadius: mv.radiusCard,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E6DBC6',
    boxShadow: '0 1px 2px rgba(124,90,46,0.08), 0 10px 28px rgba(124,90,46,0.10)',
  },
  medRowContent: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  medIconTile: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#FBE3C8', alignItems: 'center', justifyContent: 'center' },
  medIcon: { fontSize: 22 },
  medRowText: { flex: 1, gap: 2 },
  medRowEyebrow: { ...mvType.pill, color: '#C96A1E', letterSpacing: 1.4, fontSize: 10, fontWeight: '800' },
  medRowName: { color: '#1D1B17', fontSize: 16, fontWeight: '800', letterSpacing: -0.2, lineHeight: 21 },
  medRowSub: { ...mvType.caption, color: '#797166', fontVariant: ['tabular-nums'] },
  dosePill: { backgroundColor: '#D9EAF7', borderRadius: mv.radiusPill, paddingHorizontal: 10, paddingVertical: 5 },
  dosePillText: { fontSize: 12, fontWeight: '800', color: '#2D5F86', fontVariant: ['tabular-nums'] },
  // Up-next taken toggle: green filled tick (taken, status only) vs red
  // outline cross (tap to record the dose now).
  medTakenToggle: {
    width: 36,
    height: 36,
    borderRadius: 9999,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medTakenToggleOn: { backgroundColor: '#2B8A3E', borderColor: '#2B8A3E' },
  medTakenToggleOff: { backgroundColor: 'transparent', borderColor: '#C2503E' },
  medTakenToggleGlyph: { fontSize: 17, fontWeight: '800', lineHeight: 22 },
  medTakenToggleGlyphOn: { color: '#FFFFFF' },
  medTakenToggleGlyphOff: { color: '#C2503E' },
  medChevron: { fontSize: 22, fontWeight: '600', color: '#A8A094', paddingRight: 2 },

  // Retired two-up card styles (replaced by the Today stack above).
  doseTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(232,134,46,0.18)',
    marginTop: 10,
    overflow: 'hidden',
  },
  doseFill: {
    height: 7,
    borderRadius: 4,
    backgroundColor: '#E8862E',
  },

  // Insights panel — one quiet cream card: map, actions, 3D link.
  panel: {
    backgroundColor: '#FFFBF3',
    borderRadius: mv.radiusCard,
    borderCurve: 'continuous',
    padding: mv.spaceCard,
    gap: 12,
    borderWidth: 1,
    borderColor: '#E6DBC6',
    boxShadow: '0 1px 2px rgba(124,90,46,0.08), 0 12px 32px rgba(124,90,46,0.10)',
  },
  auraRed: {
    position: 'absolute',
    top: -90,
    right: -70,
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: 'rgba(232,134,46,0.10)',
  },
  auraSlate: {
    position: 'absolute',
    top: 120,
    left: -90,
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: 'rgba(43,108,176,0.08)',
  },
  auraRose: {
    position: 'absolute',
    bottom: -80,
    right: 40,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: 'rgba(232,134,46,0.06)',
  },
  panelTexture: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  panelTopLight: {
    position: 'absolute',
    top: 0,
    left: 18,
    right: 18,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: 'rgba(232,134,46,0.22)',
  },
  // Insights section header (mirrors the Correlations heading language)
  insightHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  insightEyebrow: {
    ...mvType.pill,
    color: mv.textOnLightSecondary,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  insightTitle: { ...mvType.navTitle, color: mv.textOnLightPrimary, marginTop: 4 },
  insightExpand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingLeft: 12,
  },
  insightExpandText: { ...mvType.pill, color: mv.textOnLightSecondary },
  insightExpandGlyph: { fontSize: 13, fontWeight: '800', color: '#C96A1E' },
  panelMap: { alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', gap: 8 },
  panelHint: {
    ...mvType.caption,
    color: mv.textOnLightSecondary,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  // Quiet footer link to the full 3D graph (replaces the embedded canvas).
  graphLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    marginTop: 2,
    borderTopWidth: 1,
    borderTopColor: 'rgba(29,27,23,0.08)',
  },
  graphLinkText: { ...mvType.pill, color: '#1D1B17' },
  graphLinkArrow: { fontSize: 14, fontWeight: '800', color: '#C96A1E' },

  eyebrowClinical: {
    ...mvType.pill,
    color: '#1D1B17',
    letterSpacing: 1.6,
    fontWeight: '800',
    textTransform: 'uppercase',
  },

  // Correlations heading
  corrHeadingWrap: { marginTop: mv.spaceCard },
  corrHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  corrEyebrow: {
    ...mvType.pill,
    color: mv.textOnLightSecondary,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  corrTitle: { ...mvType.navTitle, color: mv.textOnLightPrimary, marginTop: 4 },
  corrSeeAll: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 2 },
  corrSeeAllText: { ...mvType.pill, color: mv.textOnLightSecondary },

  // Feed states (sunset paper to match the cards)
  feedSkeleton: {
    backgroundColor: '#FFFBF3',
    borderRadius: mv.radiusCard,
    borderCurve: 'continuous',
    padding: mv.spaceCard,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(154,52,18,0.14)',
  },
  feedSkeletonBar: {
    width: '55%',
    height: 18,
    borderRadius: 9,
    backgroundColor: '#F5E3CE',
  },
  feedSkeletonPlot: {
    height: 168,
    borderRadius: 18,
    backgroundColor: '#F9EBD9',
  },
  feedEmpty: {
    backgroundColor: '#FFFBF3',
    borderRadius: mv.radiusCard,
    borderCurve: 'continuous',
    padding: mv.spaceCard,
    gap: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(154,52,18,0.14)',
  },
  feedEmptyTitle: { fontSize: 16, fontWeight: '800', color: '#C1121F' },
  feedEmptyText: { ...mvType.caption, color: '#8A6D5B', textAlign: 'center' },

  // Radar fullscreen modal
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(8,10,10,0.55)',
    justifyContent: 'center',
    padding: mv.spaceScreen,
  },
  modalCard: {
    backgroundColor: '#0A211B',
    borderRadius: mv.radiusCard,
    borderCurve: 'continuous',
    padding: mv.spaceCard,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: mv.spaceSideBySide,
  },
  modalTitleBlock: { flex: 1, gap: 4 },
  modalTitle: { ...mvType.hero, fontSize: 22, lineHeight: 28, color: mv.textOnDarkPrimary },
  modalChartWrap: { alignItems: 'center', marginTop: mv.spaceStack },
  modalScroll: { maxHeight: 520 },
});