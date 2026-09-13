import { StyleSheet, View, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/theme';
import { spacing } from '@/theme/tokens';

export interface ProgressSegment {
  /** 0–100 proportion of the bar. */
  value: number;
  color: string;
  /** Label used for accessibility, not visually rendered. */
  label: string;
}

interface ProgressBarProps {
  /** Single value 0–100 (simple bar) or segments (stacked bar). */
  segments: ProgressSegment[] | number;
  /** 0–100 value used only when `segments` is a number. */
  value?: number;
  showBackground?: boolean;
  height?: 'sm' | 'md';
  /** Animate width from 0 on mount (default true). */
  animate?: boolean;
  label?: string;
  style?: ViewStyle;
  children?: ReactNode;
}

function useAnimateWidth(animate: boolean, targetValue: number) {
  const progress = useSharedValue(animate ? 0 : targetValue / 100);
  useEffect(() => {
    if (!animate) return;
    progress.value = withTiming(targetValue / 100, { duration: 800 });
  }, [animate, targetValue, progress]);
  const width = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));
  return width;
}

/**
 * HealthGraph progress bar — rounded track, optional single fill or stacked
 * segments (sleep stages, hydration split, medication adherence).
 */
export function ProgressBar({
  segments,
  value,
  showBackground = true,
  height = 'md',
  animate = true,
  label,
  style,
}: ProgressBarProps) {
  const { colors, radius } = useTheme();

  const normalized: ProgressSegment[] =
    typeof segments === 'number'
      ? [{ value: Math.min(100, Math.max(0, segments)), color: colors.accentBlue, label: label ?? 'Progress' }]
      : segments;

  const total = normalized.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const filled = Math.min(100, total);

  const trackH = height === 'sm' ? 6 : 10;
  const barRadius = trackH;

  // When segmented, animate each segment's width; simple bar animates fill.
  const fillWidth = useAnimateWidth(animate, filled);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(filled), text: normalized.map((s) => `${s.label} ${Math.round(s.value)}%`).join(', ') }}
      style={style}
    >
      <View
        style={[
          styles.track,
          {
            height: trackH,
            borderRadius: barRadius,
            backgroundColor: showBackground ? colors.surfaceSunken : 'transparent',
          },
        ]}
      >
        {typeof segments === 'number' ? (
          <Animated.View
            style={[
              styles.fill,
              {
                height: '100%',
                borderRadius: barRadius,
                backgroundColor: normalized[0].color,
              },
              fillWidth,
            ]}
          />
        ) : (
          <View style={styles.segments}>
            {normalized.map((seg, i) => {
              if (seg.value <= 0) return null;
              const width = Math.max(0, (seg.value / 100) * 100);
              return (
                <View
                  key={`${seg.label}-${i}`}
                  style={[
                    styles.segment,
                    {
                      width: `${width}%`,
                      backgroundColor: seg.color,
                      borderRadius: i === 0 ? barRadius : 0,
                    },
                  ]}
                />
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
  },
  fill: {
    overflow: 'hidden',
  },
  segments: {
    flex: 1,
    flexDirection: 'row',
    height: '100%',
  },
  segment: {
    height: '100%',
  },
});