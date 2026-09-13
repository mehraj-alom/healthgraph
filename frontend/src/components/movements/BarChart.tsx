/**
 * BarChart — 6.6 native touch: dark card (surface.darkCard), accent.cream
 * bars with rounded tops, one accent.lime highlighted bar, 3 numeric value
 * markers on the left, and only the two endpoint labels. Flat, no shadows.
 */

import React from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { mv, mvType } from '@/theme/movements';

interface BarChartProps {
  title: string;
  /** 0..1 heights. */
  values: number[];
  /** Highlight this bar index in accent.lime (e.g. today). */
  highlightIndex: number;
  /** Optional right-aligned caption on the header row. */
  caption?: string;
  startLabel?: string;
  endLabel?: string;
  height?: number;
  style?: ViewStyle;
}

const MARKERS = ['100', '50', '0'];

export function BarChart({
  title,
  values,
  highlightIndex,
  caption,
  startLabel,
  endLabel,
  height = 132,
  style,
}: BarChartProps) {
  const data = values.length > 0 ? values : [0, 0, 0, 0, 0, 0, 0];
  return (
    <View style={[styles.card, style]} accessible>
      <View style={styles.header}>
        <Text style={[mvType.labelCard, { color: mv.textOnDarkPrimary }]}>
          {title}
        </Text>
        {caption ? (
          <Text style={[mvType.caption, styles.headerCaption]}>{caption}</Text>
        ) : null}
      </View>

      <View style={styles.plot}>
        {/* Numeric markers column */}
        <View style={styles.markers} accessibilityElementsHidden>
          {MARKERS.map((m) => (
            <Text key={m} style={[mvType.pill, styles.markerText]}>
              {m}
            </Text>
          ))}
        </View>

        {/* Bars */}
        <View style={styles.barsArea}>
          {data.map((v, i) => {
            const h = Math.max(6, Math.min(1, v)) * height;
            const isHighlight = i === highlightIndex;
            return (
              <View key={i} style={styles.barGroup}>
                <View style={styles.barSlot}>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: h,
                        backgroundColor: isHighlight ? mv.accentLime : mv.accentCream,
                      },
                    ]}
                  />
                </View>
                {i === 0 && startLabel ? (
                  <Text style={[mvType.pill, styles.axisLabel]}>{startLabel}</Text>
                ) : null}
                {i === data.length - 1 && endLabel ? (
                  <Text style={[mvType.pill, styles.axisLabel]}>{endLabel}</Text>
                ) : (
                  <View style={styles.axisSpacer} />
                )}
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: mv.surfaceDarkCard,
    borderRadius: mv.radiusCard,
    padding: mv.spaceCard,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  headerCaption: {
    color: mv.textOnDarkSecondary,
  },
  plot: {
    flexDirection: 'row',
  },
  markers: {
    width: 30,
    justifyContent: 'space-between',
    paddingBottom: 20,
    marginRight: 8,
  },
  markerText: {
    color: mv.textOnDarkSecondary,
    fontSize: 11,
  },
  barsArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
  },
  barGroup: {
    flex: 1,
    alignItems: 'center',
  },
  barSlot: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: {
    width: '72%',
    minWidth: 8,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  axisLabel: {
    color: mv.textOnDarkSecondary,
    fontSize: 11,
    marginTop: 6,
  },
  axisSpacer: {
    height: 22,
  },
});