/**
 * FingertipGuideOverlay — SIMULATED visual sensing-area mask (SVG).
 *
 * Visual only: it marks where the fingertip must cover (camera + flash)
 * and mirrors the native fingertip state machine. Presence truth lives in
 * the native module.
 */

import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { INST } from './Instrument';

export type FingertipGuideVisual =
  | 'idle'
  | 'waiting'
  | 'acquiring'
  | 'measuring'
  | 'poor'
  | 'complete'
  | 'failed';

const STATE_COLOR: Record<FingertipGuideVisual, string> = {
  idle: INST.engraved,
  waiting: INST.amber,
  acquiring: INST.amber,
  measuring: INST.green,
  poor: INST.red,
  complete: INST.green,
  failed: INST.red,
};

interface Props {
  visual: FingertipGuideVisual;
  /** 0..1 session progress → fill arc sweep. Null hides the sweep. */
  progress?: number | null;
  width?: number;
  height?: number;
}

/** Lens chamber: target square, crosshair, aperture rings, progress sweep. */
export default function FingertipGuideOverlay({ visual, progress = null, width = 280, height = 280 }: Props) {
  const col = STATE_COLOR[visual];
  const cx = 140;
  const cy = 140;
  const sweep = progress === null ? null : Math.max(0, Math.min(1, progress));
  const arc =
    sweep === null
      ? null
      : (() => {
          const r = 104;
          const a = -Math.PI / 2 + sweep * Math.PI * 2;
          const large = sweep > 0.5 ? 1 : 0;
          return `M ${cx} ${cy - r} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
        })();
  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Fingertip placement guide. Cover the camera and flash."
    >
      <Svg width={width} height={height} viewBox="0 0 280 280">
        {/* Chamber rings. */}
        <Circle cx={cx} cy={cy} r={118} stroke={col} strokeWidth={1.5} fill="none" opacity={0.35} />
        <Circle cx={cx} cy={cy} r={104} stroke={col} strokeWidth={2} fill="none" opacity={0.6} strokeDasharray="6 5" />
        {/* Real progress sweep (session elapsed fraction). */}
        {arc && <Path d={arc} stroke={col} strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.95} />}
        {/* Target square: "place your fingertip here". */}
        <Rect
          x={cx - 52}
          y={cy - 52}
          width={104}
          height={104}
          rx={22}
          stroke={col}
          strokeWidth={3}
          fill="none"
          opacity={0.95}
        />
        {/* Crosshair. */}
        <Line x1={cx - 70} y1={cy} x2={cx - 58} y2={cy} stroke={col} strokeWidth={2} />
        <Line x1={cx + 58} y1={cy} x2={cx + 70} y2={cy} stroke={col} strokeWidth={2} />
        <Line x1={cx} y1={cy - 70} x2={cx} y2={cy - 58} stroke={col} strokeWidth={2} />
        <Line x1={cx} y1={cy + 58} x2={cx} y2={cy + 70} stroke={col} strokeWidth={2} />
        {/* Aperture dot = the sensing eye. */}
        <Circle cx={cx} cy={cy} r={10} stroke={col} strokeWidth={2} fill="none" opacity={0.9} />
        <Circle cx={cx} cy={cy} r={4} fill={col} opacity={visual === 'idle' ? 0.3 : 0.95} />
        {visual === 'failed' && (
          <>
            <Line x1={cx - 24} y1={cy - 24} x2={cx + 24} y2={cy + 24} stroke={col} strokeWidth={4} strokeLinecap="round" />
            <Line x1={cx + 24} y1={cy - 24} x2={cx - 24} y2={cy + 24} stroke={col} strokeWidth={4} strokeLinecap="round" />
          </>
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
