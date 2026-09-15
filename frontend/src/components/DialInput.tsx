import { useId, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  Text,
  Vibration,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { useTheme } from '@/theme';

interface DialInputProps {
  /** Controlled value; null = not set yet (thumb hidden, readout shows placeholder). */
  value: number | null;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  label?: string;
  /** Base accent for the progress arc + thumb ring. */
  color?: string;
  /**
   * Dynamic tint over the sweep fraction (0..1). Used for clinical color —
   * e.g. fever blue→red, severity green→red. Overrides `color` wherever the
   * active color is shown.
   */
  tint?: (frac: number) => string;
  size?: number;
  disabled?: boolean;
  /** Readout formatter; defaults to step-aware decimals. */
  formatValue?: (v: number) => string;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

// 270° arc with the gap at the bottom: starts bottom-left, sweeps clockwise.
const START_DEG = 135;
const SWEEP_DEG = 270;

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const a = polar(cx, cy, r, fromDeg);
  const b = polar(cx, cy, r, toDeg);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

function decimalsFor(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = step.toString();
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : Math.min(2, s.length - dot - 1);
}

/** Lighten (amt>0) or darken (amt<0) a 6-digit hex color. */
function shade(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const chan = (i: number) => parseInt(h.slice(i, i + 2), 16);
  const mix = (c: number) => (amt > 0 ? c + (255 - c) * amt : c * (1 + amt));
  const to = (c: number) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0');
  return `#${to(mix(chan(0)))}${to(mix(chan(2)))}${to(mix(chan(4)))}`;
}

/** Fever blue → amber → red across the sweep. */
export function feverTint(frac: number): string {
  if (frac < 0.5) return '#4D8DFF';
  if (frac < 0.75) return '#F4A940';
  return '#E74C6F';
}

/** Calm green → amber → alert red across the sweep. */
export function severityTint(frac: number): string {
  if (frac < 0.4) return '#2FBF71';
  if (frac < 0.7) return '#F4A940';
  return '#E74C6F';
}

/**
 * DialInput — a circular "medical device" slider.
 *
 * Drag around the ring (or tap) to set a value; the thumb snaps to `step`
 * with a light vibration tick on each detent. Touch visuals render from
 * local state on the same frame as the finger (the parent's re-render only
 * reconciles), so dragging feels 1:1 even on heavy screens. The progress
 * arc is a gradient with a soft glow; `tint` shifts its color clinically
 * across the sweep. The center readout uses tabular numerals so digits
 * don't jitter.
 */
export function DialInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  label,
  color = '#4D8DFF',
  tint,
  size = 208,
  disabled = false,
  formatValue,
  style,
  accessibilityLabel,
}: DialInputProps) {
  const { colors } = useTheme();
  const gradientId = useId().replace(/:/g, '');
  // Layout mirror for the gesture handlers (created once — never stale).
  const layoutRef = useRef({ w: 0, h: 0 });
  // Gesture-lag fix: while the finger is down, ONLY this component
  // re-renders (local `live` value). The parent form commits once on
  // release — a heavy screen re-rendering 60×/second was the lag.
  // Local touch value: cleared on release once the parent holds it, so the
  // thumb never waits for a parent re-render and never snaps back mid-drag.
  const [live, setLive] = useState<number | null>(null);
  const touchingRef = useRef(false);
  const pendingRef = useRef<number | null>(null);
  const stateRef = useRef({ min, max, step, disabled, onChange });
  stateRef.current = { min, max, step, disabled, onChange };
  const lastTickRef = useRef<number | null>(null);

  const shownRaw = live ?? value;
  const span = Math.max(max - min, step);
  const shown = shownRaw == null ? min : Math.min(max, Math.max(min, shownRaw));
  const frac = Math.min(1, Math.max(0, (shown - min) / span));
  const activeColor = disabled ? colors.textDisabled : (tint ? tint(frac) : color);
  const glowColor = tint ? tint(Math.min(1, frac + 0.001)) : color;

  const onLayout = (e: LayoutChangeEvent) => {
    layoutRef.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
  };

  const valueFromPoint = (x: number, y: number): number | null => {
    const { w, h } = layoutRef.current;
    if (w <= 0 || h <= 0) return null;
    const cx = w / 2;
    const cy = h / 2;
    let deg = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    // Fold the bottom dead-zone (45°..135°) onto the nearest arc end.
    let clamped = deg;
    if (deg < 90) clamped = deg + 360; // 0..90 → 360..450
    if (clamped < START_DEG) clamped = START_DEG;
    if (clamped > START_DEG + SWEEP_DEG) clamped = START_DEG + SWEEP_DEG;
    const f = (clamped - START_DEG) / SWEEP_DEG;
    const { min: lo, max: hi, step: st } = stateRef.current;
    const raw = lo + f * (hi - lo);
    return lo + Math.round((raw - lo) / st) * st;
  };

  /** Local-only update during a drag (thumb follows the finger at 60fps). */
  const track = (v: number) => {
    const { min: lo, max: hi } = stateRef.current;
    const clamped = Math.min(hi, Math.max(lo, v));
    pendingRef.current = clamped;
    setLive(clamped);
    if (clamped !== lastTickRef.current) {
      lastTickRef.current = clamped;
      try {
        Vibration.vibrate(6);
      } catch {
        // Haptics are best-effort.
      }
    }
  };

  /** Single parent commit when the gesture ends (tap or drag release). */
  const release = () => {
    touchingRef.current = false;
    const pending = pendingRef.current;
    pendingRef.current = null;
    setLive(null);
    if (pending != null) stateRef.current.onChange(pending);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !stateRef.current.disabled,
        onMoveShouldSetPanResponder: () => !stateRef.current.disabled,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => {
          touchingRef.current = true;
          const v = valueFromPoint(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
          if (v != null) track(v);
        },
        onPanResponderMove: (evt) => {
          if (!touchingRef.current) return;
          const v = valueFromPoint(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
          if (v != null) track(v);
        },
        onPanResponderRelease: () => release(),
        onPanResponderTerminate: () => release(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const c = size / 2;
  const trackR = c - 28;
  const endDeg = START_DEG + SWEEP_DEG;
  const thumbDeg = START_DEG + frac * SWEEP_DEG;
  const thumb = polar(c, c, trackR, thumbDeg);
  const decimals = decimalsFor(step);
  const displayValue = live ?? value;
  const readout =
    displayValue == null
      ? '—'
      : formatValue
        ? formatValue(displayValue)
        : displayValue.toFixed(decimals);

  // Tick marks: aim for ~24 ticks regardless of range (static per range).
  const ticks = useMemo(() => {
    const rawTickStep = span / 24;
    const mag = 10 ** Math.floor(Math.log10(Math.max(rawTickStep, 1e-9)));
    const norm = rawTickStep / mag;
    const tickStep = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
    const out: number[] = [];
    for (let t = min; t <= max + 1e-9; t += tickStep) out.push(Math.min(t, max));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max]);

  const hasValue = displayValue != null;

  return (
    <View style={[styles.container, style]}>
      {label ? (
        <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      ) : null}
      <View
        onLayout={onLayout}
        style={[styles.dial, { width: size, height: size }, disabled && styles.dialDisabled]}
        {...(disabled ? {} : panResponder.panHandlers)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel ?? label ?? 'Dial'}
        accessibilityValue={{
          min,
          max,
          now: displayValue ?? min,
          text: displayValue == null ? 'Not set' : `${readout}${unit ? ` ${unit}` : ''}`,
        }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          if (disabled) return;
          const cur = displayValue ?? min;
          if (event.nativeEvent.actionName === 'increment') {
            onChange(Math.min(max, cur + step));
          } else if (event.nativeEvent.actionName === 'decrement') {
            onChange(Math.max(min, cur - step));
          }
        }}
      >
        <Svg width={size} height={size}>
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor={shade(glowColor, -0.15)} stopOpacity={1} />
              <Stop offset="0.55" stopColor={glowColor} stopOpacity={1} />
              <Stop offset="1" stopColor={shade(glowColor, 0.35)} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          {/* Tick ring */}
          <G>
            {ticks.map((t) => {
              const f = (t - min) / span;
              const a = START_DEG + f * SWEEP_DEG;
              const p1 = polar(c, c, trackR - 16, a);
              const p2 = polar(c, c, trackR - 24, a);
              const active = hasValue && t <= shown + 1e-9;
              return (
                <Line
                  key={t}
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke={active ? activeColor : colors.border}
                  strokeWidth={active ? 2.5 : 2}
                  strokeLinecap="round"
                  opacity={active ? 1 : 0.55}
                />
              );
            })}
          </G>
          {/* Track */}
          <Path
            d={arcPath(c, c, trackR, START_DEG, endDeg - 0.5)}
            fill="none"
            stroke={colors.surfaceSunken}
            strokeWidth={15}
            strokeLinecap="round"
          />
          {/* Glow underlay */}
          {hasValue && frac > 0.001 ? (
            <Path
              d={arcPath(c, c, trackR, START_DEG, Math.max(START_DEG + 1, thumbDeg))}
              fill="none"
              stroke={activeColor}
              strokeWidth={24}
              strokeLinecap="round"
              opacity={0.22}
            />
          ) : null}
          {/* Gradient progress */}
          {hasValue && frac > 0.001 ? (
            <Path
              d={arcPath(c, c, trackR, START_DEG, Math.max(START_DEG + 1, thumbDeg))}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth={15}
              strokeLinecap="round"
            />
          ) : null}
          {/* Thumb halo + thumb */}
          {hasValue ? (
            <G>
              <Circle cx={thumb.x} cy={thumb.y} r={19} fill={activeColor} opacity={0.22} />
              <Circle
                cx={thumb.x}
                cy={thumb.y}
                r={13}
                fill="#FFFFFF"
                stroke={activeColor}
                strokeWidth={4}
              />
              <Circle cx={thumb.x} cy={thumb.y} r={4.5} fill={activeColor} />
            </G>
          ) : null}
        </Svg>
        {/* Center readout (overlay so text stays crisp) */}
        <View style={styles.readout} pointerEvents="none">
          <Text style={[styles.readoutValue, { color: colors.textPrimary }]}>{readout}</Text>
          {unit ? <Text style={[styles.readoutUnit, { color: activeColor }]}>{unit}</Text> : null}
          {!hasValue ? (
            <Text style={[styles.readoutHint, { color: colors.textMuted }]}>drag to set</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  dial: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialDisabled: {
    opacity: 0.5,
  },
  readout: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '62%',
  },
  readoutValue: {
    fontSize: 42,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  readoutUnit: {
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
  },
  readoutHint: {
    fontSize: 11,
    marginTop: 2,
  },
});
