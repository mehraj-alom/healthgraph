/**
 * StatCard — 6.1: white card; label + circular ↗ button top-right;
 * one giant number with a single supporting element underneath.
 * Strict anatomy, keep it to one line under the number.
 */

import React, { type ReactNode } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { mv, mvType } from '@/theme/movements';
import { MovementsCard } from './MovementsCard';
import { IconButton } from './IconButton';

interface StatCardProps {
  label: string;
  value: string;
  /** Optional trailing unit rendered smaller than the giant number. */
  unit?: string;
  /** Exactly one supporting element: StatusPill, caption, PillBar, etc. */
  support: ReactNode;
  onPress: () => void;
  /** Accessibility label for the ↗ action, e.g. `Open ${label}`. */
  actionLabel: string;
  style?: ViewStyle;
}

export function StatCard({
  label,
  value,
  unit,
  support,
  onPress,
  actionLabel,
  style,
}: StatCardProps) {
  return (
    <MovementsCard kind="white" style={style}>
      <View style={styles.headerRow}>
        <Text style={[mvType.labelCard, { color: mv.textOnLightPrimary }]}>
          {label}
        </Text>
        <IconButton
          onPress={onPress}
          kind="solid"
          size={32}
          accessibilityLabel={actionLabel}
        />
      </View>
      <View style={styles.valueRow}>
        <Text style={[mvType.statGiant, styles.statNums, { color: mv.textOnLightPrimary }]}>
          {value}
        </Text>
        {unit ? (
          <Text style={[mvType.caption, { color: mv.textOnLightSecondary, marginBottom: 6 }]}>
            {unit}
          </Text>
        ) : null}
      </View>
      {support}
    </MovementsCard>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  statNums: {
    fontVariant: ['tabular-nums'],
  },
});