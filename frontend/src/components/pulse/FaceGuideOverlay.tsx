/**
 * FaceGuideOverlay — SIMULATED visual positioning mask (SVG).
 *
 * This is a visual aid only: it performs no automated face analysis, and
 * its shape never claims to. The real rPPG algorithm runs on its own
 * guide-ROI presence/stability gating; this overlay simply communicates
 * "the camera is reading the facial region" and reflects the pipeline's
 * measurement state.
 */

import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { INST } from './Instrument';

export type FaceGuideVisual =
  | 'idle'
  | 'searching'
  | 'acquiring'
  | 'locked'
  | 'measuring'
  | 'poor'
  | 'complete'
  | 'failed';

const STATE_COLOR: Record<FaceGuideVisual, string> = {
  idle: INST.engraved,
  searching: INST.amber,
  acquiring: INST.amber,
  locked: INST.cyan,
  measuring: INST.green,
  poor: INST.red,
  complete: INST.green,
  failed: INST.red,
};

interface Props {
  visual: FaceGuideVisual;
  /** 0..1 capture progress → scan-line height. Null hides the scan line. */
  progress?: number | null;
  width?: number;
  height?: number;
}

/**
 * High-pointed instrument mask: angular crown chevrons, temple blades, chin
 * point, dashed positioning oval, corner lock brackets (measuring/locked),
 * and a progress scan line. Pure decoration driven by pipeline state.
 */
export default function FaceGuideOverlay({ visual, progress = null, width = 300, height = 380 }: Props) {
  const col = STATE_COLOR[visual];
  const cx = 150;
  const showLocks = visual === 'locked' || visual === 'measuring' || visual === 'complete';
  const scanY = progress === null ? null : 60 + Math.max(0, Math.min(1, progress)) * 260;
  const bracket = (x: number, y: number, sx: number, sy: number, key: string) => (
    <Path
      key={key}
      d={`M ${x + 26 * sx} ${y} L ${x} ${y} L ${x} ${y + 26 * sy}`}
      stroke={col}
      strokeWidth={4}
      fill="none"
      strokeLinecap="square"
    />
  );
  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Positioning guide overlay. Not face detection."
    >
      <Svg width={width} height={height} viewBox="0 0 300 380">
        {/* Crown: three high-pointed chevrons (pure ornament). */}
        <Path d="M 96 44 L 150 10 L 204 44" stroke={col} strokeWidth={3} fill="none" opacity={0.9} />
        <Path d="M 108 62 L 150 30 L 192 62" stroke={col} strokeWidth={2} fill="none" opacity={0.6} />
        <Path d="M 120 80 L 150 56 L 180 80" stroke={col} strokeWidth={1.5} fill="none" opacity={0.4} />
        {/* Temple blades. */}
        <Line x1={52} y1={120} x2={52} y2={260} stroke={col} strokeWidth={2.5} opacity={0.75} />
        <Line x1={248} y1={120} x2={248} y2={260} stroke={col} strokeWidth={2.5} opacity={0.75} />
        <Line x1={52} y1={120} x2={76} y2={120} stroke={col} strokeWidth={2.5} opacity={0.75} />
        <Line x1={248} y1={120} x2={224} y2={120} stroke={col} strokeWidth={2.5} opacity={0.75} />
        {/* Positioning oval (dashed = guide, never a detection box). */}
        <Rect
          x={70}
          y={96}
          width={160}
          height={210}
          rx={80}
          stroke={col}
          strokeWidth={2}
          strokeDasharray="10 7"
          fill="none"
          opacity={visual === 'idle' ? 0.45 : 0.95}
        />
        {/* Chin point. */}
        <Path d="M 132 330 L 150 348 L 168 330" stroke={col} strokeWidth={3} fill="none" opacity={0.9} />
        {/* Inner orbit ring: ornament echoing the sensor aperture. */}
        <Circle cx={cx} cy={200} r={56} stroke={col} strokeWidth={1} fill="none" opacity={0.35} />
        <Circle cx={cx} cy={200} r={40} stroke={col} strokeWidth={1} fill="none" opacity={0.25} />
        {/* Lock brackets once the pipeline holds a signal. */}
        {showLocks && (
          <>
            {bracket(58, 84, 1, 1, 'tl')}
            {bracket(242, 84, -1, 1, 'tr')}
            {bracket(58, 318, 1, -1, 'bl')}
            {bracket(242, 318, -1, -1, 'br')}
          </>
        )}
        {/* Progress scan line: height = REAL frames-collected fraction. */}
        {scanY !== null && visual !== 'idle' && (
          <Line x1={70} y1={scanY} x2={230} y2={scanY} stroke={col} strokeWidth={2} opacity={0.8} />
        )}
        {/* Failed cross. */}
        {visual === 'failed' && (
          <>
            <Line x1={120} y1={170} x2={180} y2={230} stroke={col} strokeWidth={4} strokeLinecap="round" />
            <Line x1={180} y1={170} x2={120} y2={230} stroke={col} strokeWidth={4} strokeLinecap="round" />
          </>
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
