/**
 * ExploreGlyphs — one SF-Symbol-like line language for the Explore grid.
 *
 * 24×24 viewBox, 1.7 stroke, round caps/joins, monochrome stroke-only —
 * every glyph matches the weight of the 11pt label beside it (HIG: icons
 * share one visual language and the weight of adjacent text).
 */

import React from 'react';
import Svg, { Path, Circle, Line, Rect, G } from 'react-native-svg';

export type GlyphName =
  | 'journal' | 'clock' | 'pill' | 'camera' | 'target' | 'body' | 'pin'
  | 'ecg' | 'moon' | 'bolt' | 'leaf' | 'heart' | 'face' | 'scale' | 'medal'
  | 'doc' | 'scan' | 'cycle' | 'droplet' | 'mic';

const S = {
  fill: 'none' as const,
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const GLYPHS: Record<GlyphName, (color: string) => React.ReactElement> = {
  journal: (c) => (
    <G>
      <Rect x={6} y={3.5} width={12} height={17} rx={2.5} stroke={c} {...S} />
      <Line x1={9} y1={8.5} x2={15} y2={8.5} stroke={c} {...S} />
      <Line x1={9} y1={12} x2={15} y2={12} stroke={c} {...S} />
      <Line x1={9} y1={15.5} x2={12.5} y2={15.5} stroke={c} {...S} />
    </G>
  ),
  clock: (c) => (
    <G>
      <Circle cx={12} cy={12} r={8} stroke={c} {...S} />
      <Path d="M12 7.5V12l3 2" stroke={c} {...S} />
    </G>
  ),
  pill: (c) => (
    <G transform="rotate(-45 12 12)">
      <Rect x={5} y={9} width={14} height={6} rx={3} stroke={c} {...S} />
      <Line x1={12} y1={9} x2={12} y2={15} stroke={c} {...S} />
    </G>
  ),
  camera: (c) => (
    <G>
      <Path
        d="M4 8.5a2 2 0 0 1 2-2h2l1.5-2h5L16 6.5h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"
        stroke={c} {...S}
      />
      <Circle cx={12} cy={13} r={3} stroke={c} {...S} />
    </G>
  ),
  target: (c) => (
    <G>
      <Circle cx={12} cy={12} r={7.5} stroke={c} {...S} />
      <Circle cx={12} cy={12} r={3.8} stroke={c} {...S} />
      <Circle cx={12} cy={12} r={1.2} fill={c} />
    </G>
  ),
  body: (c) => (
    <G>
      <Circle cx={12} cy={5} r={2.4} stroke={c} {...S} />
      <Path d="M12 8.5v5m0 0-3.2 6.5m3.2-6.5 3.2 6.5M7.5 10.5 12 9l4.5 1.5" stroke={c} {...S} />
    </G>
  ),
  pin: (c) => (
    <G>
      <Path d="M12 21s-6.5-5.2-6.5-10a6.5 6.5 0 0 1 13 0c0 4.8-6.5 10-6.5 10Z" stroke={c} {...S} />
      <Circle cx={12} cy={10.8} r={2.4} stroke={c} {...S} />
    </G>
  ),
  ecg: (c) => <Path d="M3 12.5h3.5L9 7l3.5 10 2.5-4.5H21" stroke={c} {...S} />,
  moon: (c) => <Path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" stroke={c} {...S} />,
  bolt: (c) => <Path d="M13 3 5.5 13.5H11L10 21l7.5-10.5H12L13 3Z" stroke={c} {...S} />,
  leaf: (c) => (
    <G>
      <Path d="M20 4C10 4 4.5 9.5 4.5 19.5 14.5 19.5 20 14 20 4Z" stroke={c} {...S} />
      <Path d="M4.5 19.5C8 14 12 10 17 6.5" stroke={c} {...S} />
    </G>
  ),
  heart: (c) => (
    <Path
      d="M12 20.5S4 15 4 9.5a4.3 4.3 0 0 1 8-2.2 4.3 4.3 0 0 1 8 2.2c0 5.5-8 11-8 11Z"
      stroke={c} {...S}
    />
  ),
  face: (c) => (
    <G>
      <Circle cx={12} cy={12} r={8} stroke={c} {...S} />
      <Circle cx={9.2} cy={10} r={1} fill={c} />
      <Circle cx={14.8} cy={10} r={1} fill={c} />
      <Path d="M8.5 14a4.5 4.5 0 0 0 7 0" stroke={c} {...S} />
    </G>
  ),
  scale: (c) => (
    <G>
      <Path d="M4.5 9.5a7.5 7.5 0 0 1 15 0" stroke={c} {...S} />
      <Line x1={4} y1={9.5} x2={20} y2={9.5} stroke={c} {...S} />
      <Path d="M12 9.5l2.6-3.2" stroke={c} {...S} />
      <Path d="M6.5 9.5v7a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-7" stroke={c} {...S} />
    </G>
  ),
  medal: (c) => (
    <G>
      <Circle cx={12} cy={9.5} r={5} stroke={c} {...S} />
      <Path d="M9.5 14 8 21l4-2 4 2-1.5-7" stroke={c} {...S} />
    </G>
  ),
  doc: (c) => (
    <G>
      <Path d="M6.5 3.5h8l4 4v13h-12z" stroke={c} {...S} />
      <Path d="M14.5 3.5v4h4" stroke={c} {...S} />
    </G>
  ),
  scan: (c) => (
    <G>
      <Path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" stroke={c} {...S} />
      <Line x1={7.5} y1={12} x2={16.5} y2={12} stroke={c} {...S} />
    </G>
  ),
  cycle: (c) => (
    <G>
      <Path d="M19.8 9A8 8 0 1 0 20 13.5" stroke={c} {...S} />
      <Path d="M20 4.5V9h-4.5" stroke={c} {...S} />
    </G>
  ),
  droplet: (c) => (
    <Path d="M12 3.5S6 10 6 14a6 6 0 0 0 12 0c0-4-6-10.5-6-10.5Z" stroke={c} {...S} />
  ),
  mic: (c) => (
    <G>
      <Path d="M9 4.5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z" stroke={c} {...S} />
      <Path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" stroke={c} {...S} />
    </G>
  ),
};

export function ExploreGlyph({
  name,
  size = 22,
  color = '#FFFFFF',
}: {
  name: GlyphName;
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {GLYPHS[name](color)}
    </Svg>
  );
}
