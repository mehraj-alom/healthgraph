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
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  label,
  displayValue,
  unit,
  color = '#4D8DFF',
  showValue = false,
  style,
}: SliderProps) => {
  const { colors } = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const stateRef = useRef({ min, max, step, disabled, onValueChange, trackWidth, value });
  stateRef.current = { min, max, step, disabled, onValueChange, trackWidth, value };

  const computeFromX = (x: number) => {
    const { min: lo, max: hi, step: st, trackWidth: w } = stateRef.current;
    if (w <= 0) return stateRef.current.value;
    const inner = Math.max(1, w - THUMB_SIZE);
    const frac = Math.min(1, Math.max(0, (x - THUMB_SIZE / 2) / inner));
    const raw = lo + frac * (hi - lo);
    const stepped = lo + Math.round((raw - lo) / st) * st;
    return Math.min(hi, Math.max(lo, stepped));
  };

  const apply = (x: number) => {
    const next = computeFromX(x);
    stateRef.current.onValueChange(next);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !stateRef.current.disabled,
        onMoveShouldSetPanResponder: () => !stateRef.current.disabled,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => apply(evt.nativeEvent.locationX),
        onPanResponderMove: (evt) => apply(evt.nativeEvent.locationX),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onTrackLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  const span = Math.max(max - min, step);
  const frac = Math.min(1, Math.max(0, (value - min) / span));
  const fillWidth = trackWidth > 0 ? Math.max(0, frac * trackWidth) : 0;
  const thumbLeft = trackWidth > 0 ? Math.max(0, frac * (trackWidth - THUMB_SIZE)) : 0;

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
          disabled && styles.touchAreaDisabled,
        ]}
        onLayout={onTrackLayout}
        {...(disabled ? {} : panResponder.panHandlers)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label ?? 'Slider'}
        accessibilityValue={{ min, max, now: value, text: readout }}
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
        {/* Track */}
        <View style={styles.trackOuter}>
          <View style={[styles.track, { backgroundColor: colors.surfaceSunken, borderColor: colors.border }]} />
          <View
            style={[
              styles.trackFill,
              {
                width: fillWidth,
                backgroundColor: disabled ? colors.textDisabled : color,
              },
            ]}
          />
        </View>

        {/* Thumb */}
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              left: thumbLeft,
              borderColor: disabled ? colors.textDisabled : color,
              backgroundColor: disabled ? colors.surfaceDisabled : '#FFFFFF',
            },
            disabled && styles.thumbDisabled,
          ]}
        />
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
    marginHorizontal: THUMB_SIZE / 2 - 2,
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
