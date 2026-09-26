/**
 * PulseTraceView — renders ONLY real measured samples (SVG).
 *
 * Contract (tested):
 * - samples === null/empty → engraved NO-SIGNAL well, never a placeholder wave.
 * - samples present → detrended, time-calibrated trace of exactly those
 *   samples (decimated for draw performance only — no resynthesis).
 * - No sine generator, no animation loop, no fake data path exists here.
 */

import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';
import { INST } from './Instrument';
import { FONT } from '@/theme/guava';

interface Props {
  /** Measured samples in sensor/model units. Null/empty = no signal. */
  samples: number[] | null;
  /** True sample rate in Hz for the time axis. Must be > 0 when samples exist. */
  sampleRateHz: number;
  /** Unit caption, e.g. "SENSOR TRACE" or "MODEL PULSE OUTPUT". */
  label: string;
  /**
   * Optional explicit x-axis when samples are not time-uniform (e.g.
   * beat-to-beat intervals plotted in beat order). Grid + caption use it
   * instead of deriving seconds from sampleRateHz.
   */
  xAxis?: { unit: string; total: number } | null;
  width?: number;
  height?: number;
  traceColor?: string;
}

const MAX_DRAW_POINTS = 320;

function decimate(samples: number[]): number[] {
  if (samples.length <= MAX_DRAW_POINTS) return samples;
  const step = samples.length / MAX_DRAW_POINTS;
  const out: number[] = [];
  for (let i = 0; i < MAX_DRAW_POINTS; i++) out.push(samples[Math.floor(i * step)]);
  return out;
}

export function detrendForDisplay(samples: number[]): number[] {
  let mean = 0;
  for (const v of samples) mean += v;
  mean /= samples.length;
  return samples.map((v) => v - mean);
}

export default function PulseTraceView({
  samples,
  sampleRateHz,
  label,
  xAxis = null,
  width = 320,
  height = 148,
  traceColor = INST.green,
}: Props) {
  const has = samples !== null && samples.length > 1 && sampleRateHz > 0;
  if (!has) {
    return (
      <View
        style={[styles.empty, { width, height }]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${label}: no signal recorded`}
      >
        <Text style={styles.emptyText}>NO SIGNAL</Text>
      </View>
    );
  }
  const data = (samples as number[]).filter((v) => Number.isFinite(v));
  if (data.length < 2) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={styles.emptyText}>NO SIGNAL</Text>
      </View>
    );
  }
  const detrended = detrendForDisplay(decimate(data));
  let peak = 0;
  for (const v of detrended) peak = Math.max(peak, Math.abs(v));
  const scale = peak > 0 ? (height * 0.36) / peak : 0;
  const midY = height / 2;
  const pts = detrended
    .map((v, i) => `${((i / (detrended.length - 1)) * (width - 8) + 4).toFixed(1)},${(midY - v * scale).toFixed(1)}`)
    .join(' ');
  const durationS = data.length / (sampleRateHz as number);
  const xTotal = xAxis ? xAxis.total : durationS;
  const xUnit = xAxis ? xAxis.unit : 'S';
  // Axis grid: one vertical per whole unit (cap 8 lines).
  const units = Math.min(8, Math.max(1, Math.floor(xTotal)));
  const grid: React.ReactNode[] = [];
  for (let s = 0; s <= units; s++) {
    const x = 4 + ((width - 8) * s) / units;
    grid.push(<Line key={s} x1={x} y1={6} x2={x} y2={height - 6} stroke="#ffffff" strokeOpacity={0.08} strokeWidth={1} />);
  }
  grid.push(
    <Line key="mid" x1={4} y1={midY} x2={width - 4} y2={midY} stroke="#ffffff" strokeOpacity={0.12} strokeWidth={1} />,
  );
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`${label}: ${data.length} measured samples over ${xTotal.toFixed(1)} ${xUnit}`}>
      <Svg width={width} height={height}>
        {grid}
        <Polyline points={pts} fill="none" stroke={traceColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
      <View style={styles.captionRow}>
        <Text style={styles.caption}>{label}</Text>
        <Text style={styles.caption}>
          {data.length} PTS · {xTotal.toFixed(1)}{xUnit}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#020405',
    borderRadius: 8,
  },
  emptyText: {
    fontFamily: FONT.semi,
    fontSize: 12,
    letterSpacing: 4,
    color: INST.engraved,
  },
  captionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  caption: {
    fontFamily: FONT.semi,
    fontSize: 10,
    letterSpacing: 1.5,
    color: INST.dim,
    fontVariant: ['tabular-nums'],
  },
});
