/**
 * Instrument — scoped kit for the pulse measurement experience.
 *
 * healthgraph skill: dark cards, sentence-case type, pill buttons.
 * Used ONLY inside the pulse instrument screen. Every dynamic element
 * here is driven by real pipeline outputs (BPM, quality, stability,
 * state). Nothing synthesizes data.
 */

import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { FONT } from '@/theme/guava';

/** Instrument palette: dark lab device, phosphor accents. */
export const INST = {
  bezelHi: '#232f35',
  bezel: '#141c20',
  bezelLo: '#0b1114',
  face: '#070b0d',
  well: '#04070a',
  steel: '#c9d5da',
  dim: '#7d8f96',
  engraved: '#4d5d64',
  amber: '#ffb454',
  green: '#3ddc84',
  red: '#ff5d5d',
  cyan: '#59d6e6',
} as const;

export function EngravedLabel({ children, style }: { children: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.engravedWrap, style]}>
      <Text style={styles.engraved}>{children}</Text>
    </View>
  );
}

/** Dark skill card. */
export function Panel({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.panelOuter, style]}>
      <View style={styles.panelInner}>{children}</View>
    </View>
  );
}

/** Recessed well: dark inset area for previews, traces, dials. */
export function Well({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.well, style]}>{children}</View>;
}

interface TactileButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  accessibilityLabel?: string;
}

/** Pill button, one line, sentence case. 56px thumb-zone target. */
export function TactileButton({ title, onPress, disabled, variant = 'primary', accessibilityLabel }: TactileButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.btnOuter,
        variant === 'primary' && styles.btnOuterPrimary,
        variant === 'secondary' && styles.btnOuterSecondary,
        variant === 'danger' && styles.btnOuterDanger,
        disabled && styles.btnOuterDisabled,
        pressed && !disabled && styles.btnOuterPressed,
      ]}
    >
      <View
        style={[
          styles.btnFace,
          variant === 'primary' && styles.btnFacePrimary,
          variant === 'secondary' && styles.btnFaceSecondary,
          variant === 'danger' && styles.btnFaceDanger,
          disabled && styles.btnFaceDisabled,
        ]}
      >
        <Text
          style={[
            styles.btnTitle,
            variant === 'primary' && styles.btnTitlePrimary,
            variant === 'secondary' && styles.btnTitleSecondary,
            variant === 'danger' && styles.btnTitleDanger,
            disabled && styles.btnTitleDisabled,
          ]}
        >
          {title}
        </Text>
      </View>
    </Pressable>
  );
}

/** Analog gauge: needle + tick scale for 0..1 quality. Null parks the needle. */
export function QualityDial({ quality, size = 168 }: { quality: number | null; size?: number }) {
  const w = size;
  const h = size * 0.62;
  const cx = w / 2;
  const cy = h * 0.88;
  const r = size * 0.38;
  const angle = quality === null ? -90 : -90 + Math.max(0, Math.min(1, quality)) * 180;
  const rad = (angle * Math.PI) / 180;
  const nx = cx + r * 0.86 * Math.cos(rad);
  const ny = cy + r * 0.86 * Math.sin(rad);
  const ticks: React.ReactNode[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = ((-90 + i * 18) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(a);
    const y1 = cy + r * Math.sin(a);
    const x2 = cx + (r - (i % 5 === 0 ? 12 : 7)) * Math.cos(a);
    const y2 = cy + (r - (i % 5 === 0 ? 12 : 7)) * Math.sin(a);
    const col = i / 10 < 0.25 ? INST.red : i / 10 < 0.5 ? INST.amber : INST.green;
    ticks.push(<Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth={i % 5 === 0 ? 2.5 : 1.2} />);
  }
  const band = (from: number, to: number, col: string) => {
    const a0 = ((-90 + from * 180) * Math.PI) / 180;
    const a1 = ((-90 + to * 180) * Math.PI) / 180;
    const rr = r + 7;
    const large = to - from > 0.25 ? 1 : 0;
    return (
      <Path
        key={`${from}-${to}`}
        d={`M ${cx + rr * Math.cos(a0)} ${cy + rr * Math.sin(a0)} A ${rr} ${rr} 0 ${large} 1 ${cx + rr * Math.cos(a1)} ${cy + rr * Math.sin(a1)}`}
        stroke={col}
        strokeWidth={3}
        fill="none"
        opacity={0.85}
      />
    );
  };
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={quality === null ? 'Signal quality: no signal' : `Signal quality ${(quality * 100).toFixed(0)} percent`}>
      <Svg width={w} height={h}>
        {band(0, 0.25, INST.red)}
        {band(0.25, 0.5, INST.amber)}
        {band(0.5, 1, INST.green)}
        {ticks}
        <Line x1={cx} y1={cy} x2={nx} y2={ny} stroke={INST.steel} strokeWidth={3} strokeLinecap="round" />
      </Svg>
      <Text style={styles.dialValue}>
        {quality === null ? 'NO SIGNAL' : `${(quality * 100).toFixed(0)}%`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  engravedWrap: { alignItems: 'center', paddingVertical: 4 },
  engraved: {
    fontFamily: FONT.semi,
    fontSize: 13,
    lineHeight: 18,
    color: '#A7B8B2',
    textAlign: 'center',
  },
  panelOuter: {
    backgroundColor: '#2A3049',
    borderRadius: 8,
    padding: 0,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  panelInner: {
    backgroundColor: 'transparent',
    borderRadius: 8,
    padding: 16,
    gap: 12,
  },
  well: {
    backgroundColor: INST.well,
    borderRadius: 14,
    borderTopWidth: 2,
    borderTopColor: '#000000',
    borderLeftWidth: 1,
    borderLeftColor: '#00000066',
    borderRightWidth: 1,
    borderRightColor: '#ffffff10',
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff14',
    overflow: 'hidden',
  },
  btnOuter: {
    backgroundColor: 'transparent',
    borderRadius: 9999,
    padding: 3,
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 56,
    justifyContent: 'center',
  },
  btnOuterPrimary: { backgroundColor: '#2E7A70', borderColor: '#2E7A70' },
  btnOuterSecondary: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.22)' },
  btnOuterDanger: { backgroundColor: 'transparent', borderColor: 'rgba(255,93,93,0.45)' },
  btnOuterDisabled: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.10)', shadowOpacity: 0 },
  btnOuterPressed: { transform: [{ translateY: 2 }], shadowOpacity: 0.15, opacity: 0.88 },
  btnFace: {
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  btnFacePrimary: { backgroundColor: '#4FD1C5' },
  btnFaceSecondary: { backgroundColor: 'rgba(255,255,255,0.05)' },
  btnFaceDanger: { backgroundColor: 'rgba(255,93,93,0.10)' },
  btnFaceDisabled: { backgroundColor: 'transparent' },
  btnTitle: {
    fontFamily: FONT.semi,
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  btnTitlePrimary: { color: '#062A26' },
  btnTitleSecondary: { color: INST.steel },
  btnTitleDanger: { color: '#FF7A7A' },
  btnTitleDisabled: { color: INST.engraved },
  dialValue: {
    fontFamily: FONT.semi,
    fontSize: 16,
    letterSpacing: 2,
    color: INST.steel,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    marginTop: -6,
  },
});
