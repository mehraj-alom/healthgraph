import { StyleSheet, View, Text, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { spacing } from '@/theme/tokens';

interface EmptyStateProps {
  icon?: string;
  title: string;
  message?: string;
  /** Primary action (button) shown under the message. */
  children?: React.ReactNode;
  style?: ViewStyle;
}

/** HealthGraph empty state — calm, centered, communicates the next step. */
export const EmptyState = ({
  icon,
  title,
  message,
  children,
  style,
}: EmptyStateProps) => {
  const { colors, typography } = useTheme();
  return (
    <View style={[styles.container, style]}>
      {icon ? (
        <View style={[styles.iconRing, { backgroundColor: colors.surfaceSunken, borderColor: colors.border }]}>
          <Text style={styles.icon}>{icon}</Text>
        </View>
      ) : null}
      <Text style={[styles.title, typography.bodyStrong, { color: colors.textPrimary }]}>{title}</Text>
      {message ? (
        <Text style={[styles.message, typography.bodySecondary, { color: colors.textMuted }]}>{message}</Text>
      ) : null}
      {children ? <View style={styles.action}>{children}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  iconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  icon: {
    fontSize: 28,
  },
  title: {
    textAlign: 'center',
    fontSize: 16,
  },
  message: {
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 300,
  },
  action: {
    marginTop: spacing.sm,
  },
});