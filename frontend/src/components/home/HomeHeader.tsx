/**
 * HomeHeader — greeting line + date for the top of the Home screen.
 *
 * Calm, restrained typography. Uses design-system tokens exclusively.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { spacing } from '@/theme/tokens';
import { formatTodayDate } from '@/screens/Dashboard/homeData';

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

interface HomeHeaderProps {
  name?: string | null;
}

export function HomeHeader({ name }: HomeHeaderProps) {
  const { colors, typography } = useTheme();
  const greeting = getGreeting();
  const displayName = name?.trim() || null;
  const dateLabel = formatTodayDate();

  return (
    <View style={styles.container}>
      <Text
        style={[typography.largeHeading, { color: colors.textPrimary }]}
        numberOfLines={2}
      >
        {greeting}
        {displayName ? `, ${displayName}` : ''}
      </Text>
      <Text
        style={[typography.bodySecondary, { color: colors.textSecondary, marginTop: spacing.xs }]}
      >
        {dateLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
});