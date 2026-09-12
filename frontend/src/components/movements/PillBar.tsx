/**
 * PillBar — pill-shaped progress track/fill (6.2). Track translucent,
 * fill solid inverse color. No shadow, flat block layering.
 */

import React from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { mv } from '@/theme/movements';

interface PillBarProps {
  /** 0..1 */
  progress: number;
  track: string;
  fill: string;
  height?: number;
  style?: ViewStyle;
}

export function PillBar({ progress, track, fill, height = 10, style }: PillBarProps) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View
      style={[
        styles.track,
        { height, backgroundColor: track, borderRadius: height / 2 },
        style,
      ]}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <View
        style={{
          height: '100%',
          width: `${clamped * 100}%`,
          backgroundColor: fill,
          borderRadius: height / 2,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
  },
});

export { mv };