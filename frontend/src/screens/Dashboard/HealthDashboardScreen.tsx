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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
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
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  withTiming,
  withSpring,
  withRepeat,
  withDelay,
  interpolate,
  Extrapolation,
  Easing,
} from 'react-native-reanimated';
import Svg, { Path, Rect, Circle, Defs, Pattern } from 'react-native-svg';

import { mv, mvType } from '@/theme/movements';
import { timingConfig, springSnappy, durations, curves } from '@/theme/motion';
import { useReducedMotion } from '@/theme';
import { useAuth } from '@/context/AuthContext';
import { IconButton } from '@/components/movements/IconButton';
import Entrance from '@/components/home/Entrance';
import HGraphMap, { type HMetric } from '@/components/home/HGraphMap';
import SegmentedSwitch from '@/components/home/SegmentedSwitch';
import CorrelationGraphCard from '@/components/home/CorrelationGraphCard';
import LiveSignals, { type GlanceSignal } from '@/components/home/LiveSignals';
import LiftCard from '@/components/home/LiftCard';
import PpgHeartRateCard from '@/screens/PpgMeasure/PpgHeartRateCard';
import { BrandLogo } from '@/components/BrandLogo';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { useMedications } from '@/hooks/useMedications';
import { useTrends } from '@/hooks/useTrends';
import { buildHealthDimensions, detectHeartRate, formatSleepMinutes, formatWaterMl, formatDurationMinutes, localDateString } from '@/screens/Dashboard/homeData';
import { useHomeStory } from '@/screens/Dashboard/useHomeStory';
import { useCorrelationFeed, trendStreams, localStreams, vitalLabelMap, assessMetric, assessSeries, type CorrelationFeedItem } from '@/screens/Dashboard/correlations';
import HealthGraphScreen from '@/screens/Body/HealthGraphScreen';
import type { MainTabParamList, RootStackParamList } from '@/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Dashboard'>,
  NativeStackNavigationProp<RootStackParamList>
>;

const MODES = ['At a glance', '3D graph'] as const;
const GLANCE = 0;
const THREED = 1;

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
  hasActivity,
  onBellPress,
}: {
  greeting: string;
  name: string;
  initial: string;
  hasActivity: boolean;
  onBellPress: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
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

// ─── Two-up action row ─────────────────────────────────────────────────────────
// Colourful editorial pair: deep-teal "Daily logs" vs lime "Meds".
// Distinct voices — tracked overlines, serif-italic display numerals on the
// teal card, tight grotesk on lime — and three UI-thread-only life signals:
// breathing glow (opacity loop), spring dose bar (childless width anim) and
// a spring pop on the logged check. All gated on reduced-motion.

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

/** Midnight-garden backdrop for the Insights panel + modal.
 * Near-black green base (style), lime aurora with a slow breath, one emerald
 * wash, one warm coral kiss, and a faint dot-grid for texture. Pure views +
 * one static Svg — no new dependencies, clipped by the card's overflow. */
function PanelBackdrop() {
  return (
    <>
      <BreathingGlow style={styles.auraLime} />
      <View style={styles.auraEmerald} pointerEvents="none" />
      <View style={styles.auraCoral} pointerEvents="none" />
      <Svg width="100%" height="100%" style={styles.panelTexture}>
        <Defs>
          <Pattern id="panelDots" width={18} height={18} patternUnits="userSpaceOnUse">
            <Circle cx={1.5} cy={1.5} r={1.2} fill="rgba(255,255,255,0.06)" />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#panelDots)" />
      </Svg>
      <View style={styles.panelTopLight} pointerEvents="none" />
    </>
  );
}

/** One-shot light sweep across a card on mount (transform-only, UI thread). */
function Sheen({ color, delay }: { color: string; delay: number }) {
  const reduced = useReducedMotion();
  const x = useSharedValue(-130);
  useEffect(() => {
    if (reduced) return;
    x.value = withDelay(
      delay,
      withTiming(360, { duration: 950, easing: Easing.bezier(...curves.standard) }),
    );
  }, [reduced, delay, x]);
  const sheenStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { rotate: '14deg' }],
  }));
  if (reduced) return null;
  return <Animated.View pointerEvents="none" style={[styles.sheen, { backgroundColor: color }, sheenStyle]} />;
}

/** Spring-pop wrapper: replays a 0.5 → 1 settle whenever `popKey` changes. */
function PopBadge({ popKey, children }: { popKey: string | boolean; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const s = useSharedValue(reduced ? 1 : 0.5);
  useEffect(() => {
    if (reduced) {
      s.value = 1;
      return;
    }
    s.value = withSpring(1, { duration: 500, dampingRatio: 0.55 });
  }, [popKey, reduced, s]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return <Animated.View style={popStyle}>{children}</Animated.View>;
}

function ActionRowBlock({
  loggedToday,
  waterMl,
  medNames,
  medCount,
  medTaken,
  medExpected,
  medActive,
  onDailyLog,
  onMedications,
}: {
  loggedToday: boolean;
  waterMl: number | null;
  medNames: string[];
  medCount: number;
  medTaken: number;
  medExpected: number;
  medActive: boolean;
  onDailyLog: () => void;
  onMedications: () => void;
}) {
  const dosePct = medExpected > 0 ? Math.max(0, Math.min(1, medTaken / medExpected)) : 0;
  const dosesRemain = medActive && medExpected > medTaken;
  const waterHero = waterMl != null ? `${(Math.round(waterMl / 100) * 100).toLocaleString('en-US')}ml` : null;

  return (
    <View style={styles.section}>
      <View style={styles.actionRow}>
        <Entrance index={0} staggerMs={70} style={styles.actionHalf}>
          <LiftCard style={styles.logCard} contentContainerStyle={styles.logCardContent} accessibilityLabel={loggedToday ? "View or edit today's daily log" : "Enter today's daily logs"} onPress={onDailyLog} pressedBg="rgba(255,255,255,0.12)">
            <View style={styles.logBevelTop} pointerEvents="none" />
            <View style={styles.logEdgeBottom} pointerEvents="none" />
            <BreathingGlow style={styles.logGlow} />
            <View style={styles.logGlowDeep} pointerEvents="none" />
            <View style={styles.actionCardTop}>
              <Text style={styles.logEyebrow}>{loggedToday ? '●  LOGGED TODAY' : '○  TODAY'}</Text>
              {loggedToday ? (
                <PopBadge popKey={loggedToday}>
                  <View style={styles.logCheck}><CheckGlyph size={13} color="#0B3D31" /></View>
                </PopBadge>
              ) : (
                <View style={styles.logPulse} />
              )}
            </View>
            <Text style={styles.logTitle}>Daily logs</Text>
            {loggedToday ? (
              <View style={styles.actionCardBottom}>
                <Text style={styles.logHero} numberOfLines={1}>{waterHero ?? 'Done'}</Text>
                <Text style={styles.logCaption} numberOfLines={1}>
                  {waterHero ? 'water logged · nicely done' : 'all caught up for today'}
                </Text>
                <View style={styles.logCta}><Text style={styles.logCtaText}>View / Edit  →</Text></View>
              </View>
            ) : (
              <View style={styles.actionCardBottom}>
                <Text style={styles.logCaption}>sleep · water · wellbeing</Text>
                <View style={styles.logCta}><Text style={styles.logCtaText}>Log today  →</Text></View>
              </View>
            )}
            <Sheen color="rgba(255,255,255,0.20)" delay={450} />
          </LiftCard>
        </Entrance>

        <Entrance index={1} staggerMs={70} style={styles.actionHalf}>
          <LiftCard style={styles.medCard} contentContainerStyle={styles.medCardContent} accessibilityLabel="View active medications" onPress={onMedications} pressedBg="rgba(20,20,20,0.06)">
            <View style={styles.medBevelTop} pointerEvents="none" />
            <View style={styles.medEdgeBottom} pointerEvents="none" />
            <View style={styles.medBlob} pointerEvents="none" />
            <View style={styles.actionCardTop}>
              <View style={styles.medEyebrowRow}>
                <Text style={styles.medEyebrow}>✚  MEDICATION</Text>
                {dosesRemain ? <BreathingGlow style={styles.medPulse} /> : null}
              </View>
              <IconButton glyph="+" kind="solid" accessibilityLabel="Add medication" onPress={onMedications} size={30} />
            </View>
            {medActive ? (
              <View style={styles.actionCardBottom}>
                <Text style={styles.medName} numberOfLines={1}>{medNames[0]}</Text>
                <Text style={styles.medSub} numberOfLines={1}>
                  {medExpected > 0 ? `${medTaken} of ${medExpected} doses · ${medCount} active` : `${medCount} active`}
                </Text>
                {medExpected > 0 ? <DoseBar pct={dosePct} /> : null}
              </View>
            ) : (
              <View style={styles.actionCardBottom}>
                <Text style={styles.medNameMuted}>Nothing scheduled</Text>
                <Text style={styles.medSub}>Add one to start tracking</Text>
                <View style={styles.medCta}><Text style={styles.medCtaText}>＋  Add med</Text></View>
              </View>
            )}
            <Sheen color="rgba(255,255,255,0.45)" delay={580} />
          </LiftCard>
        </Entrance>
      </View>
    </View>
  );
}

// ─── Insights panel (At a glance map ⇄ embedded 3D graph) ─────────────────────

// Node colors mirror the 3D scene (NODE_COLORS in HealthGraphScreen) so the
// legend reads true: blue = observation, etc.
const GRAPH_LEGEND: Array<{ type: string; color: string; label: string; meaning: string }> = [
  { type: 'patient', color: '#F4C51B', label: 'You', meaning: 'your hub — everything connects here' },
  { type: 'body_structure', color: '#31B7A5', label: 'Body', meaning: 'anatomy areas your logs touch' },
  { type: 'observation', color: '#4D8DFF', label: 'Observation', meaning: 'measurements, vitals & findings' },
  { type: 'document', color: '#9B6CFF', label: 'Record', meaning: 'uploaded medical documents' },
  { type: 'timeline_event', color: '#F4B740', label: 'Event', meaning: 'moments from your timeline' },
  { type: 'medication', color: '#7C3AED', label: 'Medication', meaning: 'your active medications' },
  { type: 'medication_taken_event', color: '#A78BFA', label: 'Dose taken', meaning: 'doses you logged' },
];

function InsightPanelBlock({
  hMetrics,
  mapHint,
  signals,
  onOpenFullGraph,
  onGraphTouch,
}: {
  hMetrics: HMetric[];
  mapHint: string;
  signals: GlanceSignal[];
  onOpenFullGraph: () => void;
  /** Called on touch start/end inside the 3D canvas so the parent list can
   * yield the gesture — dragging the graph must not scroll the page. */
  onGraphTouch: (active: boolean) => void;
}) {
  const reduced = useReducedMotion();
  const [viewMode, setViewMode] = useState<number>(GLANCE);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapWidth, setMapWidth] = useState(0);
  const [legendOpen, setLegendOpen] = useState(false);

  const glanceOpacity = useSharedValue(1);
  const threeDOpacity = useSharedValue(0);

  const setMode = useCallback((i: number) => {
    setViewMode(i);
    glanceOpacity.value = withTiming(i === GLANCE ? 1 : 0, timingConfig(250));
    threeDOpacity.value = withTiming(i === GLANCE ? 0 : 1, timingConfig(250));
  }, [glanceOpacity, threeDOpacity]);

  const glanceStyle = useAnimatedStyle(() => ({ opacity: glanceOpacity.value }));
  const threeDStyle = useAnimatedStyle(() => ({ opacity: threeDOpacity.value }));

  const expand = useCallback(() => {
    if (viewMode === THREED) onOpenFullGraph();
    else setMapOpen(true);
  }, [viewMode, onOpenFullGraph]);

  return (
    <Entrance index={1} style={styles.section}>
      <View style={styles.panel}>
        <PanelBackdrop />
        <View style={styles.panelHeader}>
          <Text style={styles.eyebrowOnDark}>Insights</Text>
          <SegmentedSwitch options={[...MODES]} value={viewMode} onChange={setMode} style={styles.panelSwitch} />
        </View>

        <View style={styles.panelBody}>
          <Animated.View
            pointerEvents={viewMode === GLANCE ? 'auto' : 'none'}
            style={[styles.panelSubview, glanceStyle]}
          >
            <Pressable
              style={styles.panelMap}
              onLayout={(e) => setMapWidth(e.nativeEvent.layout.width)}
              onPress={() => setMapOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Expand health overview map"
            >
              {mapWidth > 0 ? (
                <>
                  <Text style={styles.glanceHead}>
                    Always know your <Text style={styles.glanceHeadAccent}>health</Text> over time.
                  </Text>
                  <HGraphMap metrics={hMetrics} width={mapWidth} />
                </>
              ) : null}
              {mapWidth <= 0 ? null : (
                <Text style={styles.panelHint} numberOfLines={1}>{mapHint}</Text>
              )}
            </Pressable>
          </Animated.View>

          <Animated.View
            pointerEvents={viewMode === THREED ? 'auto' : 'none'}
            style={[styles.panelSubview, threeDStyle]}
          >
            <View style={styles.threeDCol}>
              <Text style={styles.graphHead}>
                Your wellbeing is a constellation of connections.
              </Text>
              <View
                style={styles.canvasTouch}
                onTouchStart={() => onGraphTouch(true)}
                onTouchEnd={() => onGraphTouch(false)}
                onTouchCancel={() => onGraphTouch(false)}
              >
                <HealthGraphScreen embedded focusSource="graph" />
              </View>
              <View style={styles.g3Legend}>
                <Pressable
                  style={styles.g3LegendHead}
                  onPress={() => setLegendOpen((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: legendOpen }}
                  accessibilityLabel={legendOpen ? 'Hide graph legend' : 'Show graph legend'}
                >
                  <View style={styles.g3LegendDots}>
                    <View style={[styles.g3LegendPreview, { backgroundColor: '#4D8DFF' }]} />
                    <View style={[styles.g3LegendPreview, { backgroundColor: '#31B7A5' }]} />
                    <View style={[styles.g3LegendPreview, { backgroundColor: '#F4C51B' }]} />
                  </View>
                  <Text style={styles.g3LegendTitle}>Legend</Text>
                  <Text style={styles.g3LegendChevron}>{legendOpen ? '▾' : '▸'}</Text>
                </Pressable>
                {legendOpen ? (
                  <ScrollView style={styles.g3LegendList} showsVerticalScrollIndicator={false}>
                    {GRAPH_LEGEND.map((row) => (
                      <View key={row.type} style={styles.g3LegendRow}>
                        <View style={[styles.g3LegendDot, { backgroundColor: row.color }]} />
                        <Text style={styles.g3LegendLabel}>{row.label}</Text>
                        <Text style={styles.g3LegendMeaning} numberOfLines={1}>{row.meaning}</Text>
                      </View>
                    ))}
                  </ScrollView>
                ) : null}
              </View>
              <Text style={styles.panelHintBottom}>Drag to explore · tap a node for detail</Text>
            </View>
          </Animated.View>

          <IconButton
            kind="softWhite"
            glyph="↗"
            size={34}
            accessibilityLabel={viewMode === THREED ? 'Open full 3D graph' : 'Expand health overview'}
            style={styles.panelExpand}
            onPress={expand}
          />
        </View>
      </View>

      <MapFullscreen visible={mapOpen} hMetrics={hMetrics} hint={mapHint} signals={signals} onClose={() => setMapOpen(false)} />
    </Entrance>
  );
}

// ─── Full-screen insights map modal ───────────────────────────────────────────

function MapFullscreen({
  visible,
  hMetrics,
  hint,
  signals,
  onClose,
}: {
  visible: boolean;
  hMetrics: HMetric[];
  hint: string;
  signals: GlanceSignal[];
  onClose: () => void;
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

  // Keep the square hGraph small enough to leave room for hint + signals.
  const mapSizeW = Math.min(windowWidth - mv.spaceScreen * 2 - mv.spaceCard * 2, Math.floor(height * 0.36));

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.modalScrim, scrimStyle]}>
        <Animated.View style={[styles.modalCard, cardStyle]}>
          <PanelBackdrop />
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleBlock}>
              <Text style={styles.eyebrowOnDark}>Insights</Text>
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
            <Text style={styles.modalHint} numberOfLines={2}>{hint}</Text>
            {signals.length > 0 ? (
              <View style={styles.modalSignals}>
                <LiveSignals signals={signals} />
              </View>
            ) : null}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ─── Correlations heading ──────────────────────────────────────────────────────

function CorrelationHeading({ count }: { count: number }) {
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
    </Entrance>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────────

export default function HealthDashboardScreen() {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();

  const metrics = useDailyMetrics();
  const medications = useMedications();
  const trends = useTrends();
  const story = useHomeStory();

  const [refreshing, setRefreshing] = useState(false);
  // Yield page scroll while a finger is on the 3D canvas (drag explores the
  // graph instead of scrolling the feed).
  const [listScroll, setListScroll] = useState(true);
  const onGraphTouch = useCallback((active: boolean) => setListScroll(!active), []);

  const feedQuery = useCorrelationFeed(trends.data, metrics.data);
  const feed = feedQuery.items;

  useFocusEffect(
    useCallback(() => {
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

  // ── Live signals: every other real value Home already holds. Missing =
  // hidden (never a zero tile). Each carries its hGraph band position + tone.
  const signals = useMemo<GlanceSignal[]>(() => {
    const out: GlanceSignal[] = [];
    const m = metrics.data;
    const detail = story.todayDetail;
    const scaleTone = (v: number) => (v >= 4 ? 'good' : v === 3 ? 'neutral' : 'warn');

    const energy = m?.today_wellbeing?.energy_level;
    if (energy != null) {
      out.push({ id: 'energy', label: 'ENERGY', value: `${energy}/5`, sub: 'today', pct: energy / 5, tone: scaleTone(energy) });
    }
    const wb = m?.today_wellbeing?.overall_wellbeing;
    if (wb != null) {
      out.push({ id: 'wellbeing', label: 'WELLBEING', value: `${wb}/5`, sub: 'overall today', pct: wb / 5, tone: scaleTone(wb) });
    }
    const sq = m?.latest_sleep?.sleep_quality;
    if (sq != null) {
      const aw = m?.latest_sleep?.awakenings;
      out.push({
        id: 'sleep-quality', label: 'SLEEP QUALITY', value: `${sq}/5`,
        sub: aw != null ? `${aw} wake-up${aw === 1 ? '' : 's'}` : 'last night',
        pct: sq / 5, tone: scaleTone(sq),
      });
    }
    const meals = detail?.meals_count;
    if (meals != null && meals > 0) {
      const app = detail?.appetite_level;
      out.push({
        id: 'meals', label: 'MEALS', value: `${meals} meal${meals === 1 ? '' : 's'}`,
        sub: app != null ? `appetite ${app}/5` : 'today',
        pct: Math.min(meals / 3, 1), tone: meals >= 3 ? 'good' : meals === 2 ? 'neutral' : 'warn',
      });
    }
    const kcal = m?.today_activity?.calories_burned;
    if (kcal != null && kcal > 0) {
      out.push({
        id: 'calories', label: 'BURNED', value: `${Math.round(kcal)} kcal`,
        sub: `${m?.today_activity?.activity_count ?? 1} session${(m?.today_activity?.activity_count ?? 1) === 1 ? '' : 's'} today`,
        pct: Math.min(kcal / 500, 1), tone: 'neutral',
      });
    }
    const hr = detectHeartRate(m ?? null);
    if (hr) {
      const inBand = hr.value >= 60 && hr.value <= 100;
      out.push({
        id: 'heart', label: 'HEART RATE', value: `${hr.value} bpm`,
        sub: inBand ? 'resting band' : 'outside resting band',
        pct: Math.max(0, Math.min(1, (hr.value - 40) / 80)), tone: inBand ? 'good' : 'warn',
      });
    }
    const pain = m?.latest_pain;
    if (pain) {
      out.push({
        id: 'pain', label: 'PAIN', value: `${pain.severity}/10`,
        sub: pain.pain_type ?? 'latest',
        pct: pain.severity / 10, tone: pain.severity >= 7 ? 'bad' : pain.severity >= 4 ? 'warn' : 'neutral',
      });
    }
    const med = story.medSummary;
    if (med?.hasSchedule) {
      const done = med.dosesTaken >= med.dosesExpected;
      out.push({
        id: 'meds', label: 'DOSES', value: `${med.dosesTaken}/${med.dosesExpected}`,
        sub: done ? 'all taken' : 'taken today',
        pct: med.dosesExpected > 0 ? med.dosesTaken / med.dosesExpected : 0,
        tone: done ? 'good' : 'neutral',
      });
    }
    return out.slice(0, 8);
  }, [metrics.data, story.todayDetail, story.medSummary]);

  // Primitive projections keep the memoized header stable across focus refetches
  // (so the staggered entrance only plays on first mount, not on every refetch).
  // loggedToday trusts local SQLite AND server state: a log that exists on the
  // server but hasn't hydrated locally (fresh install, cleared storage, another
  // device) must still flip the card to View / Edit.
  const todayKey = localDateString();
  const loggedToday =
    (story.water ?? 0) > 0 ||
    story.todayDetail != null ||
    metrics.data?.today_wellbeing != null ||
    (metrics.data?.recent_daily_logs ?? []).some((l) => l.log_date === todayKey) ||
    story.story.some((s) => s.dayKey === todayKey);
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

  const goToDailyLog = useCallback(() => navigation.navigate('DailyLog'), [navigation]);
  const goToMedications = useCallback(() => navigation.navigate('Medications'), [navigation]);
  const goToTimeline = useCallback(() => navigation.navigate('Timeline'), [navigation]);
  const goToFullGraph = useCallback(
    () => navigation.navigate('HealthGraph', { source: 'graph' }),
    [navigation],
  );

  // ── Parallax deco — the background drifts slower than the cards ──
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const decoStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -scrollY.value * 0.32 }],
  }));

  const firstName = (user?.displayName ?? 'there').trim().split(' ')[0] || 'there';
  const greeting = greetingForHour(new Date().getHours());

  const listHeader = useMemo(() => (
    <View>
      <ActionRowBlock
        loggedToday={loggedToday}
        waterMl={waterMl}
        medNames={medNames}
        medCount={activeMeds.length}
        medTaken={medTaken}
        medExpected={medExpected}
        medActive={medActive}
        onDailyLog={goToDailyLog}
        onMedications={goToMedications}
      />
      <InsightPanelBlock hMetrics={hMetrics} mapHint={mapHint} signals={signals} onOpenFullGraph={goToFullGraph} onGraphTouch={onGraphTouch} />
      <PpgHeartRateCard />
      {signals.length > 0 ? (
        <Entrance index={2} style={styles.section}>
          <LiveSignals signals={signals} />
        </Entrance>
      ) : null}
      <CorrelationHeading count={feed.length} />
    </View>
  ), [
    loggedToday, waterMl, medNames, activeMeds.length, medTaken, medExpected, medActive,
    hMetrics, mapHint, signals, feed.length, goToDailyLog, goToMedications, goToFullGraph, onGraphTouch,
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
        hasActivity={story.story.length > 0}
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
        scrollEnabled={listScroll}
        onScroll={onScroll}
        scrollEventThrottle={16}
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
  },
  avatarText: { ...mvType.navTitle, color: mv.textOnDarkPrimary, fontSize: 15 },
  headerGreeting: { marginLeft: mv.spaceSideBySide, flexShrink: 1 },
  greetingSmall: { ...mvType.caption, color: mv.textOnLightSecondary },
  greetingName: { ...mvType.navTitle, color: mv.textOnLightPrimary, marginTop: 1 },
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
    paddingBottom: 36,
    paddingTop: mv.spaceStack - 4,
    zIndex: 1,
  },
  section: { marginBottom: mv.spaceStack, zIndex: 1 },

  // Action row — colourful editorial pair
  actionRow: { flexDirection: 'row', gap: mv.spaceSideBySide },
  actionHalf: { flex: 1 },
  actionCardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  actionCardBottom: { flex: 1, justifyContent: 'flex-end' },

  // 3D bevel: top light-catch + bottom weight edge. Sheen: one-shot diagonal
  // light sweep on mount (transform-only, clipped by the card's overflow).
  sheen: {
    position: 'absolute',
    top: -30,
    bottom: -30,
    left: 0,
    width: 56,
    borderRadius: 28,
  },
  logBevelTop: {
    position: 'absolute',
    top: 10,
    left: 14,
    right: 14,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  logEdgeBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 6,
    borderBottomLeftRadius: mv.radiusCard,
    borderBottomRightRadius: mv.radiusCard,
    backgroundColor: 'rgba(0,0,0,0.20)',
  },
  medBevelTop: {
    position: 'absolute',
    top: 10,
    left: 14,
    right: 14,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  medEdgeBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 6,
    borderBottomLeftRadius: mv.radiusCard,
    borderBottomRightRadius: mv.radiusCard,
    backgroundColor: 'rgba(20,20,20,0.10)',
  },

  // — Daily-logs card: deep teal, lime glow, serif-italic display type —
  logCard: {
    flex: 1,
    backgroundColor: mv.surfaceTealDeep,
    borderRadius: mv.radiusCard,
    borderCurve: 'continuous',
    minHeight: 178,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08), 0 12px 28px rgba(11,104,82,0.35)',
  },
  logCardContent: { flex: 1, padding: mv.spaceCard, gap: 6 },
  logGlow: {
    position: 'absolute',
    top: -56,
    right: -56,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: mv.accentLime,
  },
  logGlowDeep: {
    position: 'absolute',
    bottom: -70,
    left: -50,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  logEyebrow: {
    ...mvType.pill,
    color: mv.accentLime,
    letterSpacing: 1.6,
    fontSize: 11,
    fontWeight: '800',
  },
  logPulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: mv.accentLime,
    marginTop: 3,
    marginRight: 4,
  },
  logCheck: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: mv.accentLime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 24,
  },
  logHero: {
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontWeight: '700',
    fontSize: 30,
    letterSpacing: -0.5,
    lineHeight: 34,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  logCaption: { ...mvType.caption, fontStyle: 'italic', color: 'rgba(255,255,255,0.72)', marginTop: 2 },
  logCta: {
    alignSelf: 'flex-start',
    backgroundColor: mv.accentLime,
    borderRadius: mv.radiusPill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 10,
  },
  logCtaText: { ...mvType.pill, color: '#0B3D31', fontWeight: '800' },

  // — Meds card: lime, dark grotesk type, spring dose bar —
  medCard: {
    flex: 1,
    backgroundColor: mv.accentLime,
    borderRadius: mv.radiusCard,
    borderCurve: 'continuous',
    minHeight: 178,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(20,20,20,0.08)',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.06), 0 12px 28px rgba(190,220,90,0.45)',
  },
  medCardContent: { flex: 1, padding: mv.spaceCard, gap: 6 },
  medBlob: {
    position: 'absolute',
    bottom: -64,
    right: -44,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  medEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 2 },
  medPulse: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#C2503E' },
  medEyebrow: {
    ...mvType.pill,
    color: 'rgba(20,20,20,0.55)',
    letterSpacing: 1.6,
    fontSize: 11,
    fontWeight: '800',
  },
  medName: {
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontWeight: '700',
    fontSize: 20,
    letterSpacing: -0.2,
    lineHeight: 24,
    color: mv.textOnLightPrimary,
  },
  medNameMuted: {
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontSize: 17,
    lineHeight: 22,
    color: 'rgba(20,20,20,0.55)',
  },
  medSub: { ...mvType.caption, color: 'rgba(20,20,20,0.62)', marginTop: 4, fontVariant: ['tabular-nums'] },
  medCta: {
    alignSelf: 'flex-start',
    backgroundColor: mv.textOnLightPrimary,
    borderRadius: mv.radiusPill,
    paddingHorizontal: 16,
    paddingVertical: 9,
    marginTop: 10,
  },
  medCtaText: { ...mvType.pill, color: mv.accentLime, fontWeight: '800' },
  doseTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(20,20,20,0.14)',
    marginTop: 10,
    overflow: 'hidden',
  },
  doseFill: {
    height: 7,
    borderRadius: 4,
    backgroundColor: mv.surfaceTealDeep,
  },

  // Insights panel — midnight garden: near-black green ink, lime aurora,
  // coral kiss, dot-grid texture, glass border. (Ink is a one-off: the
  // Movements+ tokens carry no near-black green.)
  panel: {
    backgroundColor: '#07231C',
    borderRadius: mv.radiusCard,
    borderCurve: 'continuous',
    padding: mv.spaceCard,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.30), 0 20px 48px rgba(4,32,25,0.55)',
  },
  auraLime: {
    position: 'absolute',
    top: -90,
    right: -70,
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: mv.accentLime,
  },
  auraEmerald: {
    position: 'absolute',
    top: 120,
    left: -90,
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: 'rgba(30,158,122,0.35)',
  },
  auraCoral: {
    position: 'absolute',
    bottom: -80,
    right: 40,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: 'rgba(240,169,138,0.16)',
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
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: mv.spaceSideBySide,
  },
  panelSwitch: { width: 224 },
  // One height for both modes — toggling glance ⇄ 3D never jumps.
  panelBody: { height: 430, marginTop: mv.spaceStack, position: 'relative' },
  panelSubview: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  panelMap: { flex: 1, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  glanceHead: {
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontWeight: '700',
    fontSize: 21,
    lineHeight: 26,
    letterSpacing: -0.2,
    color: '#FFF7ED',
    textAlign: 'center',
    marginBottom: 6,
    paddingHorizontal: 8,
  },
  glanceHeadAccent: { color: mv.accentLime },
  threeDCol: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'flex-start',
    gap: 8,
  },
  graphHead: {
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontSize: 14.5,
    lineHeight: 19,
    color: 'rgba(255,247,237,0.92)',
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  canvasTouch: {
    flex: 1,
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: '#FAFAF8',
  },
  g3Legend: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  g3LegendHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  g3LegendDots: { flexDirection: 'row', gap: 4 },
  g3LegendPreview: { width: 9, height: 9, borderRadius: 4.5 },
  g3LegendTitle: { ...mvType.pill, color: 'rgba(255,255,255,0.85)', flex: 1 },
  g3LegendChevron: { color: mv.accentLime, fontSize: 13, fontWeight: '800' },
  g3LegendList: { maxHeight: 128, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.10)' },
  g3LegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  g3LegendDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)' },
  g3LegendLabel: { ...mvType.pill, color: '#FFFFFF', minWidth: 78 },
  g3LegendMeaning: { ...mvType.caption, color: 'rgba(255,255,255,0.62)', fontSize: 12, flex: 1 },
  panelHint: {
    ...mvType.caption,
    color: 'rgba(255,255,255,0.78)',
    textAlign: 'center',
    marginTop: mv.spaceStack,
    paddingHorizontal: mv.spaceScreen,
  },
  panelHintBottom: {
    ...mvType.pill,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
  },
  panelExpand: { position: 'absolute', right: 6, bottom: 6, zIndex: 6 },

  eyebrowOnDark: {
    ...mvType.pill,
    color: mv.accentLime,
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
    backgroundColor: '#FFF8F0',
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
    backgroundColor: '#FFF8F0',
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
  modalSignals: { alignSelf: 'stretch', marginTop: mv.spaceStack },
  modalHint: {
    ...mvType.caption,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginTop: mv.spaceStack,
  },
});