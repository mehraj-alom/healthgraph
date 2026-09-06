import { StyleSheet, View, Text, type ViewStyle } from 'react-native';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants';

interface EmptyStateProps {
  icon?: string;
  title: string;
  message?: string;
  children?: React.ReactNode;
  style?: ViewStyle;
}

/** MedGraph empty state — calm, centered, with generous spacing. */
export const EmptyState = ({
  icon,
  title,
  message,
  children,
  style,
}: EmptyStateProps) => {
  return (
    <View style={[styles.container, style]}>
      {icon ? (
        <View style={styles.iconRing}>
          <Text style={styles.icon}>{icon}</Text>
        </View>
      ) : null}
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {children ? <View style={styles.action}>{children}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
    gap: SPACING.sm,
  },
  iconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.xs,
  },
  icon: {
    fontSize: 28,
  },
  title: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
    textAlign: 'center',
    fontSize: 16,
  },
  message: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 300,
  },
  action: {
    marginTop: SPACING.sm,
  },
});
