/**
 * CorrelationGraphCard — the dashboard "correlations feed" chart card.
 *
 * Two visual types:
 *  - timeSeries: flat smooth line, grid + y ticks, average guide,
 *    last-value dot, tap-to-inspect crosshair with value bubble.
 *  - correlation: gridded scatter + dashed least-squares fit, color-coded
 *    r badge, axis extrema labels.
 *
 * Pure `react-native-svg`. Card chrome (eyebrow, hero stat, delta chip,
 * legend, footer) is internal so the feed mounts the same card shape
 * everywhere. Guava-flat: white card on the dark stage, Poppins throughout,
 * CTA-green actions. Curve / fit colors are DATA ENCODING (kept):
 * green when the observed link matches a clinically-favorable direction,
 * red when it contradicts one, muted + "Normal" when weak or directionless.
 *
 * Interaction is discrete taps (tap-to-inspect), never per-frame setState —
 * one state update per tap keeps scrubbing off the JS-thread hot path.
 */

import React, { memo, useMemo, useState } from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import Svg, {
  Path,
  Line,
  Circle,
  Rect,
  Text as SvgText,
  G,
} from 'react-native-svg';

import { GV, TYPE, SPACE, FONT } from '@/theme/guava';

export interface TimeSeriesPoint {
  date: string;
  value: number;
}

export interface ScatterDatum {
  x: number;
  y: number;
}

export type CorrelationGraphData =
  | { kind: 'timeSeries'; points: TimeSeriesPoint[]; unit?: string }
  | {
      kind: 'correlation';
      points: ScatterDatum[];
      r: number | null;
      verdict: HealthVerdict;
      xLabel?: string;
      yLabel?: string;
      strength?: string;
    };

/** Health verdict for a correlation curve (computed in correlations.ts). */
export type HealthVerdict = 'good' | 'bad' | 'neutral';

// Dark-glass tokens for the card chrome. Curve / fit / dot hues stay
// untouched — they are data encoding, not decoration.
const D_GRID = '#2C3547';
const D_FOG = '#A7B8B2';
const D_PANEL = '#10141F';
const D_RIM = 'rgba(255,255,255,0.10)';
const D_WELL = '#04060B';

/** Curve color per verdict — data encoding, GV tokens only. */
export const VERDICT_CURVE: Record<HealthVerdict, string> = {
  good: GV.fx.green,
  bad: GV.danger,
  neutral: GV.muted,
};

export function verdictLabel(v: HealthVerdict): string {
  return v === 'good' ? 'Healthy pattern' : v === 'bad' ? 'Needs attention' : 'Normal';
}

interface CorrelationGraphCardProps {
  title: string;
  subtitle?: string;
  data: CorrelationGraphData;
  chartHeight?: number;
  lineColor?: string;
  style?: StyleProp<ViewStyle>;
}

/** Pearson correlation coefficient. */
export function correlationCoefficient(points: ScatterDatum[]): number | null {
  const n = points.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (const p of points) {
    sx += p.x; sy += p.y; sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y;
  }
  const denom = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (!Number.isFinite(denom) || denom === 0) return null;
  return (n * sxy - sx * sy) / denom;
}

function linreg(points: ScatterDatum[]): { m: number; b: number } | null {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of points) {
    sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const m = (n * sxy - sx * sy) / denom;
  const b = (sy - m * sx) / n;
  return { m, b };
}

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

function compactNum(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000) return `${(v / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  if (Number.isInteger(v)) return `${v}`;
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1).replace(/\.0$/, '');
  return v.toFixed(1).replace(/\.0$/, '');
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (isNaN(d.getTime())) return iso.slice(5);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function withAlpha(hex: string, alpha: number): string {
  // Supports #RGB and #RRGGBB only; falls back to the raw value otherwise.
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Lift a tone toward white so the line glows over its own wash. */
function lighten(hex: string, amt: number): string {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;
  const mix = (c: number) => Math.round(c + (255 - c) * amt);
  const r = mix(parseInt(full.slice(0, 2), 16));
  const g = mix(parseInt(full.slice(2, 4), 16));
  const b = mix(parseInt(full.slice(4, 6), 16));
  return `rgb(${r},${g},${b})`;
}

// ─── Geometry constants ─────────────────────────────────────────────────────

const H_PAD = 34; // left room for y-tick labels
const R_PAD = 10;
const T_PAD = 16;
const B_PAD = 22; // bottom room for x labels
const GRID_ROWS = 3;

function niceTicks(min: number, max: number, rows: number): number[] {
  if (rows <= 0) return [min, max];
  const out: number[] = [];
  for (let i = 0; i <= rows; i++) out.push(min + ((max - min) * i) / rows);
  return out;
}

// ─── Time-series plot ───────────────────────────────────────────────────────

function TimeSeriesPlot({
  points,
  unit,
  width,
  height,
  color,
  selected,
  onSelect,
}: {
  points: TimeSeriesPoint[];
  unit?: string;
  width: number;
  height: number;
  color: string;
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const g = useMemo(() => {
    if (points.length === 0 || width <= 0) return null;
    const vals = points.map((p) => p.value);
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.12 || 1;
    min -= pad;
    max += pad;
    const span = max - min;
    const top = T_PAD;
    const bottom = height - B_PAD;
    const innerH = bottom - top;
    const left = H_PAD;
    const right = width - R_PAD;
    const innerW = Math.max(right - left, 1);
    const xs = points.map((_, i) =>
      points.length === 1 ? left + innerW / 2 : left + (i / (points.length - 1)) * innerW,
    );
    const ys = points.map((v) => top + innerH - ((v.value - min) / span) * innerH);
    const yFor = (v: number) => top + innerH - ((v - min) / span) * innerH;
    const path = points.length === 1 ? '' : smoothPath(xs.map((x, i) => ({ x, y: ys[i] })));
    const area = path ? `${path} L ${right.toFixed(2)} ${bottom.toFixed(2)} L ${left.toFixed(2)} ${bottom.toFixed(2)} Z` : '';
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const ticks = niceTicks(min + pad * 0.4, max - pad * 0.4, GRID_ROWS);
    return { path, area, xs, ys, yFor, min, max, avg, ticks, top, bottom, left, right };
  }, [points, width, height]);

  if (!g) return null;
  const sel = selected != null && points[selected] ? selected : null;
  const lastX = g.xs[g.xs.length - 1];
  const lastY = g.ys[g.ys.length - 1];
  // Two-tone: the wash carries the feature tone, the line its lifted glow.
  const lineGlow = lighten(color, 0.45);
  const wash = withAlpha(color, 0.16);
  // Signature moment: the latest value lives ON the latest dot in a white
  // pill, so the number is read where it happened — not in a corner.
  const lastVal = points[points.length - 1].value;
  const pillLabel = `${compactNum(lastVal)}${unit ? ` ${unit}` : ''}`;
  const pillW = Math.max(pillLabel.length * 6.8 + 18, 44);
  const pillH = 24;
  const pillXRaw = lastX + 12;
  const pillX = Math.min(pillXRaw, g.right - pillW);
  const pillY = Math.min(Math.max(lastY - pillH / 2, g.top), g.bottom - pillH);

  return (
    <Svg
      width={width}
      height={height}
      onTouchEnd={(e) => {
        // Discrete tap → nearest index. One setState per tap, no scrub loop.
        const x = (e.nativeEvent as unknown as { locationX?: number }).locationX ?? 0;
        let best = 0;
        let bestD = Infinity;
        g.xs.forEach((px, i) => {
          const d = Math.abs(px - x);
          if (d < bestD) { bestD = d; best = i; }
        });
        onSelect(best);
      }}
    >
      {/* gridlines + y ticks */}
      {g.ticks.map((t, i) => {
        const y = g.yFor(t);
        return (
          <G key={i}>
            <Line x1={g.left} y1={y} x2={g.right} y2={y} stroke={D_GRID} strokeWidth={1} />
            <SvgText x={g.left - 6} y={y + 3.5} fontSize={10} fontFamily={FONT.regular} fill={D_FOG} textAnchor="end">
              {compactNum(t)}
            </SvgText>
          </G>
        );
      })}

      {/* average guide removed by design: the curve and the hero
          value carry the story; a dashed mean added noise, not signal. */}

      {/* tone wash under the curve */}
      {g.area ? <Path d={g.area} fill={wash} stroke="none" /> : null}

      {/* luminous line (no area stroke — the wash carries the tone).
          A single point has no line; the signature dot + pill below
          carries it. */}
      {g.path ? (
        <Path d={g.path} fill="none" stroke={lineGlow} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      ) : null}

      {/* last-value dot: larger than the trail dots, white ring, and the
          latest value riding beside it in a white pill */}
      <Circle cx={lastX} cy={lastY} r={4.5} fill={lineGlow} stroke="#FFFFFF" strokeWidth={2} />
      <G>
        <Rect
          x={pillX}
          y={pillY}
          width={pillW}
          height={pillH}
          rx={pillH / 2}
          fill="#FFFFFF"
        />
        <SvgText
          x={pillX + pillW / 2}
          y={pillY + pillH / 2 + 4}
          fontSize={11}
          fontFamily={FONT.semi}
          fill="#10141F"
          textAnchor="middle"
        >
          {pillLabel}
        </SvgText>
      </G>

      {/* data points on the curve: quiet trail dots, the last dot leads */}
      {g.path && points.length > 1
        ? g.xs.slice(0, -1).map((x, i) => (
            <Circle key={i} cx={x} cy={g.ys[i]} r={2.5} fill={lineGlow} stroke="#FFFFFF" strokeWidth={1} />
          ))
        : null}

      {/* tap-to-inspect crosshair */}
      {sel != null && (
        <G>
          <Line x1={g.xs[sel]} y1={g.top} x2={g.xs[sel]} y2={g.bottom} stroke={lineGlow} strokeWidth={1.25} strokeDasharray="3 4" opacity={0.8} />
          <Circle cx={g.xs[sel]} cy={g.ys[sel]} r={4.5} fill={lineGlow} stroke="#FFFFFF" strokeWidth={2} />
        </G>
      )}

      {/* x labels: first / mid / last */}
      {points.length > 1 && (
        <G>
          <SvgText x={g.left} y={height - 6} fontSize={10} fontFamily={FONT.regular} fill={D_FOG} textAnchor="start">
            {shortDate(points[0].date)}
          </SvgText>
          {points.length > 4 && (
            <SvgText x={(g.left + g.right) / 2} y={height - 6} fontSize={10} fontFamily={FONT.regular} fill={D_FOG} textAnchor="middle">
              {shortDate(points[Math.floor(points.length / 2)].date)}
            </SvgText>
          )}
          <SvgText x={g.right} y={height - 6} fontSize={10} fontFamily={FONT.regular} fill={D_FOG} textAnchor="end">
            {shortDate(points[points.length - 1].date)}
          </SvgText>
        </G>
      )}
    </Svg>
  );
}

// ─── Correlation (scatter) plot ─────────────────────────────────────────────

function CorrelationPlot({ points, width, height, verdict }: {
  points: ScatterDatum[];
  width: number;
  height: number;
  verdict: HealthVerdict;
}) {
  const g = useMemo(() => {
    if (points.length === 0 || width <= 0) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    let minX = Math.min(...xs);
    let maxX = Math.max(...xs);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);
    if (minX === maxX) { minX -= 1; maxX += 1; }
    if (minY === maxY) { minY -= 1; maxY += 1; }
    const px = (maxX - minX) * 0.08 || 1;
    const py = (maxY - minY) * 0.08 || 1;
    minX -= px; maxX += px; minY -= py; maxY += py;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const left = H_PAD;
    const right = width - R_PAD;
    const top = T_PAD;
    const bottom = height - B_PAD;
    const innerW = Math.max(right - left, 1);
    const innerH = Math.max(bottom - top, 1);
    const dots = points.map((p) => ({
      x: left + ((p.x - minX) / rangeX) * innerW,
      y: bottom - ((p.y - minY) / rangeY) * innerH,
    }));
    const line = linreg(dots.map((d) => ({ x: d.x, y: d.y })));
    const linePath = line
      ? { x1: left, y1: line.m * left + line.b, x2: right, y2: line.m * right + line.b }
      : null;
    const xTicks = niceTicks(minX + px * 0.4, maxX - px * 0.4, 3);
    const yTicks = niceTicks(minY + py * 0.4, maxY - py * 0.4, GRID_ROWS);
    const xFor = (v: number) => left + ((v - minX) / rangeX) * innerW;
    const yFor = (v: number) => bottom - ((v - minY) / rangeY) * innerH;
    return { dots, linePath, xTicks, yTicks, xFor, yFor, left, right, top, bottom, minX, maxX, minY, maxY };
  }, [points, width, height]);

  if (!g) return null;
  const curve = VERDICT_CURVE[verdict];
  const dotFill = verdict === 'neutral' ? GV.muted : curve;

  return (
    <Svg width={width} height={height}>
      {/* grid */}
      {g.yTicks.map((t, i) => (
        <G key={`y${i}`}>
          <Line x1={g.left} y1={g.yFor(t)} x2={g.right} y2={g.yFor(t)} stroke={D_GRID} strokeWidth={1} />
          <SvgText x={g.left - 6} y={g.yFor(t) + 3.5} fontSize={10} fontFamily={FONT.regular} fill={D_FOG} textAnchor="end">
            {compactNum(t)}
          </SvgText>
        </G>
      ))}
      {g.xTicks.map((t, i) => (
        <G key={`x${i}`}>
          <Line x1={g.xFor(t)} y1={g.top} x2={g.xFor(t)} y2={g.bottom} stroke={D_GRID} strokeWidth={1} />
          <SvgText x={g.xFor(t)} y={height - 6} fontSize={10} fontFamily={FONT.regular} fill={D_FOG} textAnchor="middle">
            {compactNum(t)}
          </SvgText>
        </G>
      ))}

      {/* fit line: verdict color (data encoding); neutral draws over a light casing */}
      {g.linePath ? (
        <>
          {verdict === 'neutral' ? (
            <Line
              x1={g.linePath.x1} y1={g.linePath.y1} x2={g.linePath.x2} y2={g.linePath.y2}
              stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round"
            />
          ) : (
            <Line
              x1={g.linePath.x1} y1={g.linePath.y1} x2={g.linePath.x2} y2={g.linePath.y2}
              stroke={curve} strokeWidth={6} strokeOpacity={0.16} strokeLinecap="round"
            />
          )}
          <Line
            x1={g.linePath.x1} y1={g.linePath.y1} x2={g.linePath.x2} y2={g.linePath.y2}
            stroke={curve} strokeWidth={verdict === 'neutral' ? 2.5 : 2.25} strokeDasharray="5 6" strokeOpacity={0.9} strokeLinecap="round"
          />
        </>
      ) : null}

      {/* points: verdict halo + white ring keeps dense clusters legible */}
      {g.dots.map((d, i) => (
        <G key={i}>
          <Circle cx={d.x} cy={d.y} r={5} fill={dotFill} fillOpacity={0.25} />
          <Circle cx={d.x} cy={d.y} r={3.5} fill={dotFill} fillOpacity={0.9} stroke="#FFFFFF" strokeWidth={1.25} />
        </G>
      ))}
    </Svg>
  );
}

// ─── verdict pill ───────────────────────────────────────────────────────────

function verdictStyle(v: HealthVerdict): { bg: string; fg: string } {
  if (v === 'good') return { bg: GV.fx.green, fg: '#FFFFFF' };
  if (v === 'bad') return { bg: GV.danger, fg: '#FFFFFF' };
  return { bg: 'rgba(255,255,255,0.10)', fg: D_FOG };
}

// ─── Card ───────────────────────────────────────────────────────────────────

function CorrelationGraphCard({
  title,
  subtitle,
  data,
  chartHeight = 168,
  lineColor = '#E8ECF1',
  style,
}: CorrelationGraphCardProps) {
  const [plotWidth, setPlotWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  const r = data.kind === 'correlation' ? data.r : null;
  const verdict: HealthVerdict = data.kind === 'correlation' ? data.verdict : 'neutral';
  const vs = verdictStyle(verdict);
  // Title wears its own curve color: the name and the line are one voice.
  // Neutral correlations fall back to white so the title never goes dull.
  const streamColor = data.kind === 'timeSeries' ? lineColor : VERDICT_CURVE[verdict];
  const titleColor =
    data.kind === 'correlation' && verdict === 'neutral' ? '#FFFFFF' : lighten(streamColor, 0.45);

  const stats = useMemo(() => {
    if (data.kind !== 'timeSeries' || data.points.length === 0) return null;
    const vals = data.points.map((p) => p.value);
    const last = vals[vals.length - 1];
    const first = vals[0];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const prev = vals.length > 1 ? vals[vals.length - 2] : first;
    const delta = last - prev;
    const deltaPct = prev !== 0 ? (delta / Math.abs(prev)) * 100 : null;
    const up = delta > 0;
    const flat = delta === 0;
    return { last, first, min, max, delta, deltaPct, up, flat, count: vals.length };
  }, [data]);

  const selectedPoint = data.kind === 'timeSeries' && selected != null ? data.points[selected] : null;
  const unit = data.kind === 'timeSeries' ? data.unit ?? '' : '';
  // The window lives in the eyebrow as a date span ("Mar 3 – Mar 9") —
  // never a "7 days" chip, never a min–max range readout.
  const windowLabel =
    data.kind === 'timeSeries' && data.points.length > 0
      ? `${shortDate(data.points[0].date)} – ${shortDate(data.points[data.points.length - 1].date)}`.toUpperCase()
      : null;

  const accessibilityLabel =
    data.kind === 'timeSeries'
      ? `${title}. ${stats ? `Latest ${compactNum(stats.last)}${data.unit ?? ''}, range ${compactNum(stats.min)} to ${compactNum(stats.max)} over ${stats.count} days.` : 'No data.'}`
      : `${title}. ${r != null ? `Correlation ${r.toFixed(2)}, ${verdictLabel(verdict)}.` : 'Not enough data.'} ${data.points.length} paired points.`;

  return (
    <View
      style={[styles.glassWrap, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      {/* dark orbs behind the frosted surface (reference: smoked orbs) */}
      <View style={styles.orbA} pointerEvents="none" />
      <View style={styles.orbB} pointerEvents="none" />
      <View style={styles.orbC} pointerEvents="none" />
      <BlurView tint="dark" intensity={55} style={styles.glassFill} />
      <View style={styles.glassContent}>
      {/* header: colorful title left, window date right and small */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: titleColor }]} numberOfLines={2}>
              {title}
            </Text>
            {data.kind === 'timeSeries' && windowLabel ? (
              <Text style={styles.windowDate} numberOfLines={1}>
                {windowLabel}
              </Text>
            ) : null}
          </View>
        </View>
        {r != null && Number.isFinite(r) && data.kind === 'correlation' ? (
          <View style={styles.pillCol}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>r = {r.toFixed(2)}</Text>
            </View>
            <View style={[styles.verdict, { backgroundColor: vs.bg }]}>
              <Text style={[styles.verdictText, { color: vs.fg }]}>{verdictLabel(verdict)}</Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* hero stat row for time series: value + delta only, the unit
          rides with the value pill on the latest dot */}
      {stats && data.kind === 'timeSeries' ? (
        <View style={styles.heroRow}>
          <Text style={styles.heroValue} selectable>
            {compactNum(selectedPoint ? selectedPoint.value : stats.last)}
          </Text>
          <View style={styles.deltaChip}>
            <Text style={[styles.deltaText, stats.flat ? styles.deltaTextFlat : stats.up ? styles.deltaTextUp : styles.deltaTextDown]}>
              {stats.flat ? '● steady' : `${stats.up ? '▲' : '▼'} ${stats.deltaPct != null ? `${Math.abs(stats.deltaPct) >= 0.05 ? Math.abs(stats.deltaPct).toFixed(1) : '<0.1'}%` : compactNum(Math.abs(stats.delta))}`}
            </Text>
          </View>
        </View>
      ) : null}

      {/* plot */}
      <View
        style={[styles.plot, { height: chartHeight }]}
        onLayout={(e) => setPlotWidth(e.nativeEvent.layout.width)}
      >
        {plotWidth > 0 && data.kind === 'timeSeries' && data.points.length > 0 ? (
          <TimeSeriesPlot
            points={data.points}
            unit={data.unit}
            width={plotWidth}
            height={chartHeight}
            color={lineColor}
            selected={selected}
            onSelect={(i) => setSelected((prev) => (prev === i ? null : i))}
          />
        ) : null}
        {plotWidth > 0 && data.kind === 'correlation' && data.points.length > 0 ? (
          <CorrelationPlot points={data.points} width={plotWidth} height={chartHeight} verdict={data.verdict} />
        ) : null}
        {data.points.length === 0 ? (
          <View style={styles.empty}>
            <Svg width={28} height={28} viewBox="0 0 24 24">
              <Path d="M2 12.4h4l2.5-6 4 11 2.5-5.2H22" fill="none" stroke={D_FOG} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            <Text style={styles.emptyTitle}>No data yet</Text>
            <Text style={styles.emptyText}>Log a few more days to unlock this graph</Text>
          </View>
        ) : null}
      </View>

      {/* legend removed by design: the trail dots, the white-pill latest
          value, and the r badge explain the encoding without a key. */}

      {/* inspector / footer */}
      {data.kind === 'timeSeries' && selectedPoint ? (
        <View style={styles.inspector}>
          <Text style={styles.inspectorDate}>{shortDate(selectedPoint.date)}</Text>
          <Text style={styles.inspectorValue} selectable>
            {compactNum(selectedPoint.value)}{unit}
          </Text>
        </View>
      ) : data.kind === 'correlation' ? (
        <View style={styles.footer}>
          <Text style={styles.footerText} numberOfLines={2}>
            {`${data.points.length} paired days · ${verdictLabel(verdict)}${data.xLabel && data.yLabel ? ` · X ${data.xLabel} → Y ${data.yLabel}` : ''}`}
          </Text>
        </View>
      ) : null}
      </View>
    </View>
  );
}

// Memoized: feed re-renders (dial/trend ticks) must not re-render every
// SVG card — fixes the VirtualizedList "large list slow to update" jank.
export default memo(CorrelationGraphCard);

const styles = StyleSheet.create({
  // Real frosted glass (reference: smoked orbs on black): dark orbs behind,
  // a dark blur surface above them, content floating on top. Hairline rim
  // catches the light. Curve / fit / dot hues stay data-encoded.
  glassWrap: {
    borderRadius: SPACE.rCard,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: '#0B0D12',
  },
  orbA: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    left: -70,
    top: -60,
    backgroundColor: '#232833',
  },
  orbB: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    right: -50,
    top: 40,
    backgroundColor: '#1B2029',
  },
  orbC: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    left: '30%',
    bottom: -90,
    backgroundColor: '#20262F',
  },
  glassFill: {
    ...StyleSheet.absoluteFill,
  },
  glassContent: {
    padding: SPACE.cardPad,
    gap: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACE.cardGap,
  },
  headerText: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  windowDate: {
    ...TYPE.caption,
    fontSize: 11,
    lineHeight: 14,
    color: D_FOG,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  title: { ...TYPE.title, fontSize: 20, lineHeight: 26, letterSpacing: -0.4, flex: 1 },
  pillCol: { gap: 6, alignItems: 'flex-end', marginTop: 2 },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: SPACE.rPill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minWidth: 76,
    alignItems: 'center',
  },
  badgeText: { ...TYPE.chip, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  verdict: {
    borderRadius: SPACE.rPill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: 'center',
  },
  verdictText: { ...TYPE.chip },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: SPACE.cardGap,
  },
  heroValue: {
    ...TYPE.display,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  heroUnit: { ...TYPE.body, color: D_FOG },
  deltaChip: {
    borderRadius: SPACE.rPill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  deltaText: { ...TYPE.chip, fontVariant: ['tabular-nums'] },
  deltaTextUp: { color: GV.fx.green },
  deltaTextDown: { color: GV.danger },
  deltaTextFlat: { color: D_FOG },
  plot: {
    marginTop: 8,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(4,6,11,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  inspector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    backgroundColor: '#0B0F18',
    borderWidth: 1,
    borderColor: D_RIM,
    borderRadius: SPACE.rPill,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  inspectorDate: { ...TYPE.chip, color: 'rgba(255,255,255,0.75)' },
  inspectorValue: { ...TYPE.chip, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  footer: { marginTop: 8 },
  footerText: { ...TYPE.caption, color: D_FOG },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: D_WELL,
    borderRadius: 16,
    gap: 4,
    paddingVertical: 20,
  },
  emptyTitle: { ...TYPE.title, fontSize: 14, lineHeight: 20, color: '#FFFFFF', marginTop: 8 },
  emptyText: { ...TYPE.caption, color: D_FOG },
});
