/**
 * SegmentedSwitch — 6.4 pill toggle with an animated thumb.
 *
 * Used on the dashboard insight panel to flip between "At a glance" (radar)
 * and "3D graph". Two options, animated white thumb slide (fast + standard
 * motion curves). Text colors switch instantly; the thumb carries the motion
 * so the toggle reads as snappy rather than sluggish.
 */

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { mv, mvType } from '@/theme/movements';
import { durations, curves, Easing } from '@/theme/motion';

interface SegmentedSwitchProps {
  options: string[];
  value: number;
  onChange: (index: number) => void;
  style?: StyleProp<ViewStyle>;
  /** 'dark' (default, for dark cards) or 'light' (white card: grey track, red thumb). */
  tone?: 'dark' | 'light';
}

export default function SegmentedSwitch({ options, value, onChange, style, tone = 'dark' }: SegmentedSwitchProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const thumbX = useSharedValue(0);

  const innerWidth = Math.max(trackWidth - 6, 0);
  const slotWidth = innerWidth / Math.max(options.length, 1);

  React.useEffect(() => {
    thumbX.value = withTiming(value * slotWidth, {
      duration: durations.fast,
      easing: Easing.bezier(...curves.snappy),
    });
  }, [value, slotWidth, thumbX]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value }],
  }));

  const trackStyle =
    tone === 'light'
      ? { backgroundColor: '#E2D8C3' }
      : undefined;
  const light = tone === 'light';

  return (
    <View
      style={[styles.track, trackStyle, style]}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
    >
      {options.map((option, i) => {
        const active = value === i;
        return (
          <Pressable
            key={option}
            style={styles.option}
            onPress={() => onChange(i)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text
              style={[
                styles.optionText,
                {
                  color: active
                    ? '#FFFFFF'
                    : light
                      ? '#797166'
                      : 'rgba(255,255,255,0.60)',
                },
              ]}
            >
              {option}
            </Text>
          </Pressable>
        );
      })}

      <Animated.View pointerEvents="none" style={[styles.thumb, { width: slotWidth }, thumbStyle]}>
        <View style={[styles.thumbInner, light && styles.thumbInnerLight]} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: mv.radiusPill,
    padding: 3,
  },
  option: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  optionText: {
    ...mvType.pill,
  },
  thumb: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 3,
    alignItems: 'center',
    borderRadius: mv.radiusPill,
  },
  thumbInner: {
    flex: 1,
    alignSelf: 'stretch',
    marginHorizontal: 4,
    borderRadius: mv.radiusPill,
    backgroundColor: mv.surfaceWhite,
  },
  thumbInnerLight: {
    backgroundColor: '#1D1B17',
  },
});