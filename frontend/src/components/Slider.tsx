import {
  StyleSheet,
  View,
  Text,
  PanResponder,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';
import { useMemo, useRef, useState } from 'react';
import { useTheme } from '@/theme';
import { spacing, radius } from '@/theme/tokens';

interface SliderProps {
  /** Controlled value (number, clamped to [min, max] snapped to step). */
  value: number;
  onValueChange: (next: number) => void;
  /** Fires continuously while dragging (same snapped value); use for live
      scrub previews. The parent still commits via onValueChange on release. */
  onLiveChange?: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** Label above the track, e.g. "Pain severity" */
  label?: string;
  /** Optional live readout (defaults to the numeric value). */
  displayValue?: string;
  unit?: string;
  /** Accent color for fill/thumb (defaults to accentBlue). */
  color?: string;
  /** Show the numeric value above the thumb. */
  showValue?: boolean;
  /**
   * Glass instrument variant: recessed groove, glowing fill, orb thumb —
   * the same language as the cuboid glass dials. Slimmer (20px thumb).
   */
  glass?: boolean;
  style?: ViewStyle;
}

const THUMB_SIZE = 24;

/**
 * MedGraph slider — track + fill + draggable thumb implemented with a plain
 * PanResponder so dragging genuinely works on Android (no native dependency).
 *
 * Contract:
 *  - controlled `value` + `onValueChange`
 *  - taps and drags on the track update the value, snapped to `step`
 *  - disabled state renders muted and does not capture touches
 */
export const Slider = ({
  value,
  onValueChange,
  onLiveChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  label,
  displayValue,
  unit,
  color = '#4D8DFF',
  showValue = false,
  glass = false,
  style,
}: SliderProps) => {
  const { colors } = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  // Same lag contract as DialInput: while dragging, only this component
  // re-renders (local `live` value); the parent commits once on release.
  const [live, setLive] = useState<number | null>(null);
  const touchingRef = useRef(false);
  const pendingRef = useRef<number | null>(null);
  // Glass thumbs run slimmer (20px) than the standard 24px thumb.
  const thumbSize = glass ? 20 : THUMB_SIZE;
  const stateRef = useRef({ min, max, step, disabled, onValueChange, onLiveChange, trackWidth, value, thumbSize });
  stateRef.current = { min, max, step, disabled, onValueChange, onLiveChange, trackWidth, value, thumbSize };

  const computeFromX = (x: number) => {
    const { min: lo, max: hi, step: st, trackWidth: w, thumbSize: ts } = stateRef.current;
    if (w <= 0) return stateRef.current.value;
    const inner = Math.max(1, w - ts);
    const frac = Math.min(1, Math.max(0, (x - ts / 2) / inner));
    const raw = lo + frac * (hi - lo);
    const stepped = lo + Math.round((raw - lo) / st) * st;
    return Math.min(hi, Math.max(lo, stepped));
  };

  const apply = (x: number) => {
    const next = computeFromX(x);
    pendingRef.current = next;
    setLive(next);
    stateRef.current.onLiveChange?.(next);
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
        // Capture moves ONLY when the gesture is clearly horizontal — inside
        // a vertical ScrollView, claiming vertical drags makes the thumb
        // fight the scroll and stutter. Taps (grant) still always work.
        onMoveShouldSetPanResponder: (_, g) =>
          !stateRef.current.disabled &&
          Math.abs(g.dx) > 4 &&
          Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => {
          touchingRef.current = true;
          apply(evt.nativeEvent.locationX);
        },
        onPanResponderMove: (evt) => {
          if (touchingRef.current) apply(evt.nativeEvent.locationX);
        },
        onPanResponderRelease: () => release(),
        onPanResponderTerminate: () => release(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onTrackLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  const span = Math.max(max - min, step);
  const shownValue = live ?? value;
  const frac = Math.min(1, Math.max(0, (shownValue - min) / span));
  const fillWidth = trackWidth > 0 ? Math.max(0, frac * trackWidth) : 0;
  const thumbLeft = trackWidth > 0 ? Math.max(0, frac * (trackWidth - thumbSize)) : 0;

  const readout =
    displayValue != null
      ? displayValue
      : unit
        ? `${value}${unit}`
        : String(value);

  return (
    <View style={[styles.container, style]}>
{(label || showValue) && (
          <View style={styles.labelRow}>
            {label ? (
              <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
            ) : (
              <View />
            )}
            {showValue ? (
              <Text style={[styles.value, { color }]}>{readout}</Text>
            ) : null}
          </View>
        )}

      <View
        style={[
          styles.touchArea,
          { marginHorizontal: thumbSize / 2 - 2 },
          disabled && styles.touchAreaDisabled,
        ]}
        onLayout={onTrackLayout}
        {...(disabled ? {} : panResponder.panHandlers)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label ?? 'Slider'}
        accessibilityValue={{ min, max, now: shownValue, text: readout }}
        accessibilityActions={[
          { name: 'increment' },
          { name: 'decrement' },
        ]}
        onAccessibilityAction={(event) => {
          if (disabled) return;
          if (event.nativeEvent.actionName === 'increment') {
            onValueChange(Math.min(max, value + step));
          } else if (event.nativeEvent.actionName === 'decrement') {
            onValueChange(Math.max(min, value - step));
          }
        }}
      >
        {/* Track: glass renders a recessed groove on the dark instrument. */}
        <View style={[styles.trackOuter, glass && styles.trackOuterGlass, { height: glass ? 10 : 6 }]}>
          <View
            style={[
              styles.track,
              glass
                ? {
                    backgroundColor: '#0B1220',
                    borderColor: 'rgba(255,255,255,0.08)',
                    top: 2,
                    left: 2,
                    right: 2,
                    bottom: 2,
                  }
                : { backgroundColor: colors.surfaceSunken, borderColor: colors.border },
            ]}
          />
          <View
            style={[
              styles.trackFill,
              {
                width: glass ? Math.max(0, fillWidth - 2) : fillWidth,
                backgroundColor: disabled ? colors.textDisabled : color,
              },
              glass && {
                top: 2,
                bottom: 2,
                left: 2,
                opacity: 1,
                shadowColor: color,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.55,
                shadowRadius: 8,
                elevation: 4,
              },
            ]}
          >
            {glass && !disabled ? <View pointerEvents="none" style={styles.fillSheen} /> : null}
          </View>
        </View>

        {/* Thumb: glass renders a dark orb with a specular dot. */}
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              left: thumbLeft,
              top: (40 - thumbSize) / 2,
              width: thumbSize,
              height: thumbSize,
              borderRadius: thumbSize / 2,
              borderColor: disabled ? colors.textDisabled : color,
              backgroundColor: disabled
                ? colors.surfaceDisabled
                : glass
                  ? '#0B0F18'
                  : '#FFFFFF',
              ...(glass && !disabled
                ? {
                    shadowColor: color,
                    shadowOpacity: 0.6,
                    shadowRadius: 8,
                    elevation: 5,
                  }
                : null),
            },
            disabled && styles.thumbDisabled,
          ]}
        >
          {glass && !disabled ? <View pointerEvents="none" style={styles.thumbSpec} /> : null}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  value: {
    fontSize: 14,
    fontWeight: '700',
  },
  touchArea: {
    height: 40,
    justifyContent: 'center',
  },
  touchAreaDisabled: {
    opacity: 0.5,
  },
  trackOuter: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  trackOuterGlass: {
    backgroundColor: '#02040A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  track: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius.pill,
    opacity: 0.9,
  },
  fillSheen: {
    position: 'absolute',
    top: 1,
    left: 6,
    right: 6,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  thumbSpec: {
    position: 'absolute',
    top: 3,
    left: 3,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  thumb: {
    position: 'absolute',
    top: (40 - THUMB_SIZE) / 2,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 2.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  thumbDisabled: {
    shadowOpacity: 0,
    elevation: 0,
  },
});
