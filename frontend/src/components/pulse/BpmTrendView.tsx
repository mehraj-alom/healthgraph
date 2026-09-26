/**
 * BpmTrendView — live BPM trend plotted ONLY from accepted live values.
 *
 * Each point is a real `liveBpm` emission (~1Hz, pipeline-gated). Gaps
 * (nulls, finger removed, weak signal) break the line — the UI shows the
 * absence instead of interpolating across it. No points → engraved
 * "AWAITING SIGNAL" well.
 */

import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { INST } from './Instrument';
import { FONT } from '@/theme/guava';

export interface BpmPoint {
  /** ms since run start. */
  t: number;
  bpm: number;
}

interface Props {
  points: BpmPoint[];
  /** Y domain (BPM). Defaults to the pipeline gate 25..250 tightened. */
  min?: number;
  max?: number;
  width?: number;
  height?: number;
}

/** Split into segments on time gaps > 3s so absence reads as absence. */
export function trendSegments(points: BpmPoint[], gapMs = 3000): BpmPoint[][] {
  const segs: BpmPoint[][] = [];
  let cur: BpmPoint[] = [];
  for (const p of points) {
    if (cur.length > 0 && p.t - cur[cur.length - 1].t > gapMs) {
      if (cur.length > 0) segs.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length > 0) segs.push(cur);
  return segs.filter((s) => s.length > 0);
}

export default function BpmTrendView({ points, min = 40, max = 160, width = 320, height = 120 }: Props) {
  const finite = points.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.bpm));
  if (finite.length === 0) {
    return (
      <View
        style={[styles.empty, { width, height }]}
        accessible
        accessibilityRole="image"
        accessibilityLabel="Live pulse trend: awaiting signal"
      >
        <Text style={styles.emptyText}>AWAITING SIGNAL</Text>
      </View>
    );
  }
  const t0 = finite[0].t;
  const t1 = Math.max(finite[finite.length - 1].t, t0 + 1000);
  const span = t1 - t0;
  const X = (t: number) => 28 + ((t - t0) / span) * (width - 36);
  const Y = (bpm: number) => {
    const c = Math.max(min, Math.min(max, bpm));
    return 8 + (1 - (c - min) / (max - min)) * (height - 30);
  };
  const segs = trendSegments(finite);
  const last = finite[finite.length - 1];
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`Live pulse trend: ${finite.length} accepted readings, latest ${Math.round(last.bpm)} BPM`}>
      <Svg width={width} height={height}>
        {[min, (min + max) / 2, max].map((v) => (
          <Line key={v} x1={28} y1={Y(v)} x2={width - 8} y2={Y(v)} stroke="#ffffff" strokeOpacity={0.08} strokeWidth={1} />
        ))}
        {segs.map((s, i) => (
          <Polyline
            key={i}
            points={s.map((p) => `${X(p.t).toFixed(1)},${Y(p.bpm).toFixed(1)}`).join(' ')}
            fill="none"
            stroke={INST.amber}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        <Circle cx={X(last.t)} cy={Y(last.bpm)} r={4} fill={INST.amber} />
      </Svg>
      <View style={styles.captionRow}>
        <Text style={styles.caption}>LIVE PULSE · ACCEPTED READINGS ONLY</Text>
        <Text style={styles.caption}>
          {Math.round(last.bpm)} BPM
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
