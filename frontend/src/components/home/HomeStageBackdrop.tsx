/**
 * HomeStageBackdrop — the aurora stage under the redesigned Home.
 *
 * Liquid Glass needs visually rich content beneath it to have something
 * to blur and pick up (HIG: "extend visually rich content beneath" the
 * functional layer). This paints a deep, calm aurora — vertical base wash
 * plus four soft color orbs and a bottom vignette — pinned behind the
 * scrolling content. It is the content layer's background, not glass.
 *
 * Static by design: no loops, nothing animates. The "liquid" feel comes
 * from frosted cards sampling different orb hues as they scroll past.
 */

import React, { useId } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Circle, RadialGradient } from 'react-native-svg';

import { LG } from '@/theme/liquidGlass';

export function HomeStageBackdrop() {
  const { width: w, height: h } = useWindowDimensions();
  // Unique gradient ids per mount — the fullscreen map modal can coexist.
  const uid = useId().replace(/:/g, '');
  const baseId = `stage${uid}b`;
  const vigId = `stage${uid}v`;
  const g = (key: string) => `stage${uid}${key}`;

  // Orb layout scales with the device so no hue ever dominates a card row.
  const orbs: { key: string; cx: number; cy: number; r: number; color: string; opacity: number }[] = [
    { key: 'teal', cx: w * 0.06, cy: h * 0.1, r: Math.max(w * 0.62, 240), color: LG.stage.orbTeal, opacity: 0.5 },
    { key: 'indigo', cx: w * 1.0, cy: h * 0.2, r: Math.max(w * 0.7, 280), color: LG.stage.orbIndigo, opacity: 0.42 },
    { key: 'sky', cx: w * 0.86, cy: h * 0.72, r: Math.max(w * 0.58, 240), color: LG.stage.orbSky, opacity: 0.4 },
    { key: 'plum', cx: w * 0.04, cy: h * 0.88, r: Math.max(w * 0.55, 230), color: LG.stage.orbPlum, opacity: 0.34 },
  ];

  return (
    <Svg style={StyleSheet.absoluteFill} width={w} height={h} pointerEvents="none">
      <Defs>
        <LinearGradient id={baseId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={LG.stage.top} />
          <Stop offset="1" stopColor={LG.stage.bottom} />
        </LinearGradient>
        <LinearGradient id={vigId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0.55" stopColor={LG.stage.vignette} stopOpacity={0} />
          <Stop offset="1" stopColor={LG.stage.vignette} />
        </LinearGradient>
        {orbs.map((o) => (
          <RadialGradient key={o.key} id={g(o.key)} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={o.color} stopOpacity={o.opacity} />
            <Stop offset="1" stopColor={o.color} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      <Rect x={0} y={0} width={w} height={h} fill={`url(#${baseId})`} />
      {orbs.map((o) => (
        <Circle key={o.key} cx={o.cx} cy={o.cy} r={o.r} fill={`url(#${g(o.key)})`} />
      ))}
      <Rect x={0} y={0} width={w} height={h} fill={`url(#${vigId})`} />
    </Svg>
  );
}
