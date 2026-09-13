import { StyleSheet, View, Text, Pressable, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { useTheme } from '@/theme';
import { spacing, radius } from '@/theme/tokens';
import { MetricValue } from './MetricValue';
import { TrendIndicator, type TrendDirection } from './TrendIndicator';

interface MetricCardProps {
  category: string;
  label: string;
  value: string | number;
  unit?: string;
  /** Detail/trailing text under the value. */
  detail?: string;
  trend?: TrendDirection;
  trendTone?: 'positive' | 'attention' | 'neutral' | 'auto';
  trendText?: string;
  tone?: 'positive' | 'neutral' | 'attention';
  /** Icon override (defaults to the category glyph). */
  icon?: string;
  /** Optional trailing action (e.g. chevron nav). */
  right?: ReactNode;
  onPress?: () => void;
  /** Compact variant for dense rows. */
  compact?: boolean;
  /** Colored top edge accent (health category). */
  accentColor?: string;
  style?: ViewStyle;
}

/**
 * MetricCard — the reusable health metric card for Home & dashboards.
 * Composes label + big number + unit + trend + optional press feedback.
 * Never makes medical claims; cards are neutral surfaces with accents.
 */
export function MetricCard({
  category,
  label,
  value,
  unit,
  detail,
  trend,
  trendTone,
  trendText,
  tone,
  icon,
  right,
  onPress,
  compact = false,
  accentColor,
  style,
}: MetricCardProps) {
  const { colors, typography, elevation } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `${label}, ${value}${unit ?? ''}` : undefined}
      disabled={!onPress}
      style={({ pressed }: { pressed?: boolean }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.xxl,
          padding: compact ? spacing.md : spacing.lg,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.08,
          shadowRadius: 10,
          elevation: elevation.soft.elevation,
          borderTopColor: accentColor ?? colors.border,
          borderTopWidth: accentColor ? 3 : 1,
        },
        onPress && pressed && styles.pressed,
        style,
      ]}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={[styles.icon, { opacity: 0.9 }]}>{icon ?? glyphFor(category)}</Text>
          <Text
            style={[typography.captionStrong, { color: colors.textSecondary, fontSize: 13 }]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
        {right ?? null}
      </View>

      <MetricValue
        value={value}
        unit={unit}
        tone={tone}
        size={compact ? 'md' : 'lg'}
      />

      {(detail || trend) && (
        <View style={styles.footer}>
          {trend ? (
            <TrendIndicator direction={trend} tone={trendTone} text={trendText} />
          ) : null}
          {detail && !trend ? (
            <Text style={[typography.caption, { color: colors.textMuted }]} numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

function glyphFor(category: string): string {
  // Local glyph map mirrors theme/icons; kept local to avoid an import cycle.
  const map: Record<string, string> = {
    sleep: '🌙',
    water: '💧',
    hydration: '💧',
    stress: '🧘',
    energy: '⚡',
    activity: '👟',
    heart: '❤️',
    heartRate: '❤️',
    medication: '💊',
    vitals: '📈',
    nutrition: '🥗',
    wellbeing: '🌱',
  };
  return map[category] ?? '●';
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    gap: 10,
  },
  pressed: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    transform: [{ scale: 0.985 }],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  icon: {
    fontSize: 15,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
});