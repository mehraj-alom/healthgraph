import { useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { FONT } from '@/theme/guava';

export interface EnginePoint {
  /** ISO day (YYYY-MM-DD); dots never invent missing days. */
  date: string;
  value: number;
}

interface EngineGraphProps {
  points: EnginePoint[];
  /** Muted feature tone (tile family). Wash + lifted line derive from it. */
  tone: string;
  decimals?: number;
  height?: number;
  /** Fixed y domain (e.g. 1–5 ratings, 0–1 activity). Defaults to data range. */
  domain?: [number, number];
  /** Explicit y ticks (e.g. [0, 1] for binary series). */
  ticks?: number[];
}

function withAlpha(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function lighten(hex: string, amt: number): string {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;
  const mix = (c: number) => Math.round(c + (255 - c) * amt);
  return `rgb(${mix(parseInt(full.slice(0, 2), 16))},${mix(parseInt(full.slice(2, 4), 16))},${mix(parseInt(full.slice(4, 6), 16))})`;
}

function shortDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(5);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * EngineGraph — one shared real-data graph for every priority engine.
 *
 * Dark recessed well, slate grid, two-tone series (tone wash + lifted
 * line), average guide, first/mid/last day labels. Dots mark only logged
 * days — gaps stay gaps, a single point renders as one honest dot.
 */
export function EngineGraph({ points, tone, decimals = 1, height = 180, domain, ticks }: EngineGraphProps) {
  const [w, setW] = useState(0);
  const g = useMemo(() => {
    if (points.length === 0 || w <= 0) return null;
    const vals = points.map((p) => p.value);
    let min = domain ? domain[0] : Math.min(...vals);
    let max = domain ? domain[1] : Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    if (!domain) {
      const pad = (max - min) * 0.15 || 1;
      min -= pad;
      max += pad;
    }
    const span = max - min || 1;
    const LP = 36;
    const RP = 10;
    const TP = 14;
    const BP = 22;
    const top = TP;
    const bottom = height - BP;
    const innerH = bottom - top;
    const left = LP;
    const right = w - RP;
    const innerW = Math.max(right - left, 1);
    const xs = points.map((_, i) =>
      points.length === 1 ? left + innerW / 2 : left + (i / (points.length - 1)) * innerW,
    );
    const ys = vals.map((v) => top + innerH - ((v - min) / span) * innerH);
    const yFor = (v: number) => top + innerH - ((v - min) / span) * innerH;
    let path = '';
    if (points.length > 1) {
      path = `M ${xs[0].toFixed(1)} ${ys[0].toFixed(1)}`;
      for (let i = 1; i < xs.length; i++) path += ` L ${xs[i].toFixed(1)} ${ys[i].toFixed(1)}`;
    }
    const area = path ? `${path} L ${right.toFixed(1)} ${bottom.toFixed(1)} L ${left.toFixed(1)} ${bottom.toFixed(1)} Z` : '';
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const tickVals = ticks ?? [min + span * 0.25, min + span * 0.5, min + span * 0.75];
    return { path, area, xs, ys, yFor, tickVals, top, bottom, left, right, avg };
  }, [points, w, height, domain, ticks]);
  const line = lighten(tone, 0.45);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && g ? (
        <Svg width={w} height={height}>
          {g.tickVals.map((t, i) => (
            <G key={i}>
              <Line x1={g.left} y1={g.yFor(t)} x2={g.right} y2={g.yFor(t)} stroke="#2C3547" strokeWidth={1} />
              <SvgText x={g.left - 6} y={g.yFor(t) + 3.5} fontSize={10} fontFamily={FONT.regular} fill="#A7B8B2" textAnchor="end">
                {t.toFixed(decimals)}
              </SvgText>
            </G>
          ))}
          <Line x1={g.left} y1={g.yFor(g.avg)} x2={g.right} y2={g.yFor(g.avg)} stroke={withAlpha(tone, 0.5)} strokeWidth={1.25} strokeDasharray="4 5" />
          {g.area ? <Path d={g.area} fill={withAlpha(tone, 0.16)} stroke="none" /> : null}
          {g.path ? (
            <Path d={g.path} fill="none" stroke={line} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          ) : (
            <Circle cx={g.xs[0]} cy={g.ys[0]} r={4.5} fill={line} stroke="#FFFFFF" strokeWidth={2} />
          )}
          {g.path
            ? g.xs.map((x, i) => (
                <Circle key={`${points[i].date}-${i}`} cx={x} cy={g.ys[i]} r={3.5} fill={line} stroke="#FFFFFF" strokeWidth={1.5} />
              ))
            : null}
          <SvgText x={g.left} y={height - 6} fontSize={10} fontFamily={FONT.regular} fill="#A7B8B2" textAnchor="start">
            {shortDay(points[0].date)}
          </SvgText>
          {points.length > 4 ? (
            <SvgText x={(g.left + g.right) / 2} y={height - 6} fontSize={10} fontFamily={FONT.regular} fill="#A7B8B2" textAnchor="middle">
              {shortDay(points[Math.floor(points.length / 2)].date)}
            </SvgText>
          ) : null}
          {points.length > 1 ? (
            <SvgText x={g.right} y={height - 6} fontSize={10} fontFamily={FONT.regular} fill="#A7B8B2" textAnchor="end">
              {shortDay(points[points.length - 1].date)}
            </SvgText>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}
