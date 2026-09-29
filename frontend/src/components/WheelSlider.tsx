import { useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  Vibration,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';

interface WheelSliderProps {
  /** Controlled value (clamped to [min, max], snapped to step). */
  value: number;
  onValueChange: (next: number) => void;
  /** Fires continuously while rolling; parent commits on release. */
  onLiveChange?: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** Accent for the fill + wheel ring. */
  color?: string;
  /**
   * Sunken (cast-in-resin) feel: softer glow, fainter sheens — the wheel
   * reads embedded in the cuboid instead of floating on top of it.
   */
  sunken?: boolean;
  /** Full height of the wheel (usually matched to the dial beside it). */
  height: number;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

const WHEEL_W = 30;
const WHEEL_H = 22;
const EDGE = WHEEL_H / 2;

/**
 * WheelSlider — a mouse-scroll-wheel-style vertical scrubber.
 *
 * A recessed glass groove with a glowing fill and a ribbed wheel thumb.
 * Drag vertically (or tap) to roll through values; the thumb detents to
 * `step` with a light vibration tick per notch, like a real wheel.
 * Top of the groove is `min`, bottom is `max`.
 */
export function WheelSlider({
  value,
  onValueChange,
  onLiveChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  color = '#4FD1C5',
  sunken = false,
  height,
  style,
  accessibilityLabel,
}: WheelSliderProps) {
  const [grooveH, setGrooveH] = useState(0);
  // Same lag contract as the dials: finger drives local state at 60fps,
  // the parent commits once on release.
  const [live, setLive] = useState<number | null>(null);
  const touchingRef = useRef(false);
  const pendingRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const stateRef = useRef({ min, max, step, disabled, onValueChange, onLiveChange, grooveH, value });
  stateRef.current = { min, max, step, disabled, onValueChange, onLiveChange, grooveH, value };

  const onGrooveLayout = (e: LayoutChangeEvent) => {
    // Well height minus the wheel overtravel at both ends = groove travel.
    setGrooveH(Math.max(0, e.nativeEvent.layout.height - EDGE * 2));
  };

  const valueFromY = (y: number): number | null => {
    const { min: lo, max: hi, step: st, grooveH: h } = stateRef.current;
    if (h <= 0) return null;
    const frac = Math.min(1, Math.max(0, y / h));
    const raw = lo + frac * (hi - lo);
    return lo + Math.round((raw - lo) / st) * st;
  };

  const track = (v: number) => {
    const { min: lo, max: hi, onLiveChange: live } = stateRef.current;
    const clamped = Math.min(hi, Math.max(lo, v));
    pendingRef.current = clamped;
    setLive(clamped);
    live?.(clamped);
    if (clamped !== lastTickRef.current) {
      lastTickRef.current = clamped;
      try {
        Vibration.vibrate(4);
      } catch {
        // Haptics are best-effort.
      }
    }
  };

  const release = () => {
    touchingRef.current = false;
    const pending = pendingRef.current;
    pendingRef.current = null;
    setLive(null);
    if (pending != null) stateRef.current.onValueChange(pending);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !stateRef.current.disabled,
        // Claim only clearly-vertical gestures so taps always work and
        // horizontal swipes stay with the parent.
        onMoveShouldSetPanResponder: (_, g) =>
          !stateRef.current.disabled && Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => {
          touchingRef.current = true;
          const v = valueFromY(evt.nativeEvent.locationY);
          if (v != null) track(v);
        },
        onPanResponderMove: (evt) => {
          if (!touchingRef.current) return;
          const v = valueFromY(evt.nativeEvent.locationY);
          if (v != null) track(v);
        },
        onPanResponderRelease: () => release(),
        onPanResponderTerminate: () => release(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const span = Math.max(max - min, step);
  const shownValue = live ?? value;
  const frac = Math.min(1, Math.max(0, (shownValue - min) / span));
  const fillH = Math.max(0, frac * grooveH);
  const thumbTop = Math.max(0, Math.min(grooveH - WHEEL_H, frac * grooveH - WHEEL_H / 2));

  return (
    <View
      style={[styles.wrap, { height }, style]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel ?? 'Scroll wheel'}
      accessibilityValue={{ min, max, now: shownValue }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (disabled) return;
        if (event.nativeEvent.actionName === 'increment') {
          onValueChange(Math.min(max, value + step));
        } else if (event.nativeEvent.actionName === 'decrement') {
          onValueChange(Math.max(min, value - step));
        }
      }}
    >
      <View
        style={[styles.well, disabled && styles.disabled]}
        onLayout={onGrooveLayout}
        {...(disabled ? {} : panResponder.panHandlers)}
      >
        {/* Recessed groove */}
        <View pointerEvents="none" style={styles.groove} />
        {/* Detent ticks */}
        {[0.2, 0.4, 0.6, 0.8].map((f) => (
          <View key={f} pointerEvents="none" style={[styles.tick, { top: `${f * 100}%` }]} />
        ))}
        {/* Glowing fill from the top */}
        <View
          pointerEvents="none"
          style={[
            styles.fill,
            {
              height: fillH,
              backgroundColor: disabled ? '#5C5546' : color,
              shadowColor: disabled ? '#000000' : color,
              shadowOpacity: disabled ? 0.3 : sunken ? 0.25 : 0.55,
              shadowRadius: sunken ? 4 : 8,
            },
          ]}
        >
          <View pointerEvents="none" style={[styles.fillSheen, sunken && styles.fillSheenSunken]} />
        </View>
        {/* The wheel: ribbed thumb with a specular dot */}
        <View
          pointerEvents="none"
          style={[
            styles.wheel,
            {
              top: EDGE + thumbTop,
              borderColor: disabled ? '#5C5546' : color,
              backgroundColor: disabled ? '#1A1713' : '#0B0F18',
            },
          ]}
        >
          <View style={[styles.rib, sunken && styles.ribSunken]} />
          <View style={[styles.rib, sunken && styles.ribSunken]} />
          <View style={[styles.rib, sunken && styles.ribSunken]} />
          <View pointerEvents="none" style={[styles.spec, sunken && styles.specSunken]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  well: {
    position: 'relative',
    flex: 1,
    alignSelf: 'stretch',
    // No capsule of its own: the wheel lives bare inside the glass cuboid.
    backgroundColor: 'transparent',
    overflow: 'visible',
  },
  disabled: {
    opacity: 0.5,
  },
  groove: {
    position: 'absolute',
    top: EDGE,
    bottom: EDGE,
    alignSelf: 'center',
    width: 10,
    borderRadius: 5,
    backgroundColor: '#0B1220',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  tick: {
    position: 'absolute',
    alignSelf: 'center',
    width: 16,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  fill: {
    position: 'absolute',
    top: EDGE,
    alignSelf: 'center',
    width: 10,
    borderRadius: 5,
    opacity: 1,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 8,
    elevation: 4,
    overflow: 'hidden',
  },
  fillSheen: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 1.5,
    width: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  fillSheenSunken: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  wheel: {
    position: 'absolute',
    alignSelf: 'center',
    width: WHEEL_W,
    height: WHEEL_H,
    borderRadius: WHEEL_H / 2,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2.5,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 5,
  },
  rib: {
    width: 15,
    height: 1.6,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  ribSunken: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  spec: {
    position: 'absolute',
    top: 2.5,
    left: 3.5,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  specSunken: {
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
});
