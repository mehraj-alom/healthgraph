import { StyleSheet, View, Text, Pressable, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { spacing, radius } from '@/theme/tokens';

interface ErrorStateProps {
  title?: string;
  /** Human-readable message. NEVER pass raw SQL / tracebacks / API details. */
  message?: string;
  /** Retry action; omitted hides the button. */
  onRetry?: () => void;
  retryLabel?: string;
  /** When true, renders without a card container (inline use). */
  inline?: boolean;
  style?: ViewStyle;
}

/**
 * HealthGraph error state — calm, human-readable, never leaks internals.
 * Use this instead of raw Alert.alert for screen-level failures.
 */
export function ErrorState({
  title = 'Something went wrong',
  message = 'Please try again.',
  onRetry,
  retryLabel = 'Try again',
  inline = false,
  style,
}: ErrorStateProps) {
  const { colors, typography } = useTheme();

  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`${title}. ${message}`}
      style={[
        styles.wrapper,
        !inline && {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.xxl,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.1,
          shadowRadius: 8,
          elevation: 3,
        },
        style,
      ]}
    >
      <View style={[styles.iconRing, { backgroundColor: colors.errorSurface }]}>
        <Text style={[styles.icon, { color: colors.error }]}>!</Text>
      </View>
      <Text style={[styles.title, typography.sectionHeading, { color: colors.textPrimary }]}>
        {title}
      </Text>
      {message ? (
        <Text style={[styles.message, typography.bodySecondary, { color: colors.textSecondary }]}>
          {message}
        </Text>
      ) : null}
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          style={({ pressed }) => [
            styles.retry,
            {
              backgroundColor: colors.accentBlueSoft,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.sm,
            },
            pressed && { transform: [{ scale: 0.97 }], opacity: 0.85 },
          ]}
        >
          <Text style={[styles.retryText, { color: colors.accentBlue }]}>
            {retryLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
    borderWidth: 1,
  },
  iconRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  icon: {
    fontSize: 22,
    fontWeight: '700',
  },
  title: {
    textAlign: 'center',
  },
  message: {
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  retry: {
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
  },
});