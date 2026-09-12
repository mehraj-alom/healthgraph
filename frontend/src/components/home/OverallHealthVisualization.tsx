/**
 * OverallHealthVisualization — organic bloom-style radial health chart.
 *
 * Each real health dimension becomes a petal radiating from a central hub.
 * Petals animate in staggered on mount (Reveal-style via Reanimated).
 * Tapping a petal selects it (dims others). Tapping the hub deselects.
 *
 * This is NOT a radar/spider chart. Petals are bezier curves with organic
 * width that varies with the underlying data magnitude. The visual metaphor
 * is "blooming health," not a geometric grid.
 *
 * React-native-svg + Reanimated createAnimatedComponent (Increment 2.1 motion).
 * No new dependencies.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text as RNText, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { Path, Text as SvgText, Circle } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  interpolate,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { bezier, curves, durations } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeContext';
import type { HealthDimension, DimensionId } from '@/screens/Dashboard/homeData';

// ─── SVG canvas constants ────────────────────────────────────────────────────

const VB = 300;           // viewBox side length
const CX = VB / 2;       // center x
const CY = VB / 2;       // center y
const HUB_R = 42;         // center hub radius
const MIN_PETAL = 32;     // minimum petal length (even magnitude-0 dims get a sliver)
const MAX_PETAL = 108;    // maximum petal length at magnitude=1
const MAX_WIDTH = 26;     // maximum petal width at magnitude=1
const LABEL_OFFSET = 14;  // gap between petal tip and label text
const TAP_R = 36;         // invisible tap-circle radius for hit areas
const HUB_TAP_R = 52;     // hub tap area

// Fixed clockwise order starting from 12 o'clock.
const PETAL_ORDER: DimensionId[] = [
  'sleep', 'heart', 'water', 'stress',
  'activity', 'medication', 'energy', 'wellbeing',
];

// ─── Petal path builder ──────────────────────────────────────────────────────

function petalPath(
  cx: number,
  cy: number,
  angle: number,
  length: number,
  width: number,
): string {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const perpCos = Math.cos(angle + Math.PI / 2);
  const perpSin = Math.sin(angle + Math.PI / 2);

  const tipX = cx + length * cos;
  const tipY = cy + length * sin;

  // Two control points form the organic body of the petal.
  const bodyFrac = 0.48;
  const bodyX = cx + length * bodyFrac * cos;
  const bodyY = cy + length * bodyFrac * sin;

  const cp1X = bodyX + width * perpCos;
  const cp1Y = bodyY + width * perpSin;
  const cp2X = bodyX - width * perpCos;
  const cp2Y = bodyY - width * perpSin;

  return `M ${cx} ${cy} Q ${cp1X} ${cp1Y} ${tipX} ${tipY} Q ${cp2X} ${cp2Y} ${cx} ${cy} Z`;
}

// ─── Animated petal (own component for Rules of Hooks) ───────────────────────

interface PetalProps {
  index: number;
  total: number;
  progress: SharedValue<number>;
  d: string;
  fill: string;
  selectedId: DimensionId | null;
  dimId: DimensionId;
  onDimPress: (id: DimensionId) => void;
  /** Midpoint of the petal in SVG coords (for tap area). */
  tapCx: number;
  tapCy: number;
}

const AnimatedPath = Animated.createAnimatedComponent(Path);

function Petal({
  index,
  total,
  progress,
  d,
  fill,
  selectedId,
  dimId,
  onDimPress,
  tapCx,
  tapCy,
}: PetalProps) {
  const animatedProps = useAnimatedProps(() => {
    const entranceThreshold = total > 0 ? index / total : 0;
    const entranceOpacity = interpolate(
      progress.value,
      [entranceThreshold, Math.min(entranceThreshold + 0.28, 1)],
      [0, 1],
      Extrapolation.CLAMP,
    );

    const selectionOpacity =
      selectedId != null ? (dimId === selectedId ? 1 : 0.3) : 0.85;

    return { opacity: entranceOpacity * selectionOpacity };
  });

  const handlePress = useCallback(() => {
    onDimPress(dimId);
  }, [dimId, onDimPress]);

  return (
    <>
      <AnimatedPath d={d} fill={fill} animatedProps={animatedProps} />
      <Circle
        cx={tapCx}
        cy={tapCy}
        r={TAP_R}
        fill="transparent"
        onPress={handlePress}
      />
    </>
  );
}

// ─── Movements/Saffron palette ─────────────────────────────────────────────
// Supply to render in the Movements+ tone: neutral petals, one lime focal,
// text labels instead of emoji icons, and the hub switching to the active
// dimension's value. Omit to keep the original light-theme look.

export interface OverallPalette {
  petal: string;
  petalSelected: string;
  hubFill: string;
  hubStroke: string;
  hubStrokeFocused: string;
  hubText: string;
  hubSub: string;
  label: string;
  labelSelected: string;
  emptyBg: string;
  emptyText: string;
}

// ─── Main component ──────────────────────────────────────────────────────────

interface OverallHealthVisualizationProps {
  dimensions: HealthDimension[];
  selectedDimensionId: DimensionId | null;
  onSelectDimension: (id: DimensionId) => void;
  onSelectHub: () => void;
  containerStyle?: object;
  /** Movements+ tonal override (neutral petals, lime focal, hub shows value). */
  palette?: OverallPalette;
}

export function OverallHealthVisualization({
  dimensions,
  selectedDimensionId,
  onSelectDimension,
  onSelectHub,
  containerStyle,
  palette,
}: OverallHealthVisualizationProps) {
  const { colors, radius: r } = useTheme();
  const reduced = useReducedMotion();
  const [layoutW, setLayoutW] = useState(VB);
  const progress = useSharedValue(reduced ? 1 : 0);

  const themed = palette != null;

  // ── Sort dimensions into PETAL_ORDER ──
  const sorted = useMemo(() => {
    const map = new Map(dimensions.map((d) => [d.id, d]));
    return PETAL_ORDER.filter((id) => map.has(id)).map((id) => map.get(id)!);
  }, [dimensions]);

  const n = sorted.length;

  // ── Petal geometry ──
  const petalGeo = useMemo(() => {
    return sorted.map((dim, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
      const length = MIN_PETAL + (MAX_PETAL - MIN_PETAL) * dim.magnitude;
      const width = MAX_WIDTH * dim.magnitude;
      const d = petalPath(CX, CY, angle, length, width);

      // Tap area midpoint (slightly inward from tip)
      const midFrac = 0.6;
      const tapCx = CX + length * midFrac * Math.cos(angle);
      const tapCy = CY + length * midFrac * Math.sin(angle);

      // Label position (beyond petal tip)
      const labelR = HUB_R + length + LABEL_OFFSET;
      const labelX = CX + labelR * Math.cos(angle);
      const labelY = CY + labelR * Math.sin(angle);
      const anchor: 'start' | 'middle' | 'end' =
        Math.abs(Math.cos(angle)) < 0.3
          ? 'middle'
          : Math.cos(angle) > 0
            ? 'start'
            : 'end';

      return { dim, angle, d, tapCx, tapCy, labelX, labelY, anchor };
    });
  }, [sorted, n]);

  // ── Entrance animation ──
  useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = withTiming(1, {
      duration: durations.slow + 150,
      easing: bezier(curves.standard),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, n]);

  // ── Hub label ──
  const selectedDim = selectedDimensionId
    ? sorted.find((d) => d.id === selectedDimensionId) ?? null
    : null;

  const hubLabel = selectedDim
    ? themed
      ? selectedDim.valueText
      : selectedDim.icon
    : themed
      ? 'Today'
      : '☀️';
  const hubSublabel = selectedDim
    ? selectedDim.label
    : themed
      ? `${n} areas`
      : 'Today';

  const handleHubPress = useCallback(() => {
    onSelectHub();
  }, [onSelectHub]);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    setLayoutW(e.nativeEvent.layout.width);
  }, []);

  if (n === 0) {
    return (
      <View
        style={[
          styles.emptyContainer,
          {
            backgroundColor: palette?.emptyBg ?? colors.surfaceSecondary,
            borderRadius: r.xl,
          },
          containerStyle,
        ]}
      >
        <RNText style={{ fontSize: 32 }}>
          🌱
        </RNText>
        <RNText
          style={{
            fontSize: 13,
            color: palette?.emptyText ?? colors.textSecondary,
            marginTop: 8,
            textAlign: 'center',
          }}
        >
          Log some health data to see your overall health
        </RNText>
      </View>
    );
  }

  const focused = selectedDimensionId == null;

  return (
    <View
      style={[styles.wrapper, containerStyle]}
      onLayout={handleLayout}
    >
      <Svg
        viewBox={`0 0 ${VB} ${VB}`}
        width={layoutW}
        height={layoutW}
        style={styles.svg}
      >
        {/* Hub background circle */}
        <Circle
          cx={CX}
          cy={CY}
          r={HUB_R}
          fill={palette?.hubFill ?? colors.surface}
        />
        <Circle
          cx={CX}
          cy={CY}
          r={HUB_R}
          fill="none"
          stroke={
            themed
              ? focused
                ? palette.hubStrokeFocused
                : palette.hubStroke
              : colors.border
          }
          strokeWidth={themed ? 2 : 1}
        />

        {/* Petals */}
        {petalGeo.map((geo, i) => (
          <Petal
            key={geo.dim.id}
            index={i}
            total={n}
            progress={progress}
            d={geo.d}
            fill={
              themed
                ? geo.dim.id === selectedDimensionId
                  ? palette.petalSelected
                  : palette.petal
                : geo.dim.color
            }
            selectedId={selectedDimensionId}
            dimId={geo.dim.id}
            onDimPress={onSelectDimension}
            tapCx={geo.tapCx}
            tapCy={geo.tapCy}
          />
        ))}

        {/* Dimension labels */}
        {petalGeo.map((geo) => (
          <SvgText
            key={`lbl-${geo.dim.id}`}
            x={geo.labelX}
            y={geo.labelY + 4}
            textAnchor={geo.anchor}
            fontSize={themed ? 9 : 11}
            fontWeight="600"
            fill={
              themed
                ? geo.dim.id === selectedDimensionId
                  ? palette.labelSelected
                  : palette.label
                : selectedDimensionId === geo.dim.id
                  ? geo.dim.color
                  : colors.textSecondary
            }
          >
            {themed ? geo.dim.label : geo.dim.icon}
          </SvgText>
        ))}

        {/* Hub tap area */}
        <Circle
          cx={CX}
          cy={CY}
          r={HUB_TAP_R}
          fill="transparent"
          onPress={handleHubPress}
        />

        {/* Hub center — value in Movements mode, icon+sublabel otherwise */}
        <SvgText
          x={CX}
          y={themed ? CY : CY - 2}
          textAnchor="middle"
          fontWeight="800"
          fontSize={themed ? 20 : 26}
          fill={themed ? palette.hubText : colors.textPrimary}
        >
          {hubLabel}
        </SvgText>
        <SvgText
          x={CX}
          y={themed ? CY + 22 : CY + 18}
          textAnchor="middle"
          fontSize={themed ? 9 : 11}
          fontWeight="600"
          fill={palette?.hubSub ?? colors.textSecondary}
        >
          {hubSublabel}
        </SvgText>
      </Svg>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
  },
  svg: {
    // width/height set dynamically via layout
  },
  emptyContainer: {
    aspectRatio: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
});