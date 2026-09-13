import { StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { useTheme } from '@/theme';
import { spacing } from '@/theme/tokens';

interface LoadingStateProps {
  label?: string;
  fullScreen?: boolean;
}

/** HealthGraph loading state — calm spinner + optional label. */
export const LoadingState = ({ label, fullScreen = false }: LoadingStateProps) => {
  const { colors, typography } = useTheme();
  return (
    <View style={[styles.container, fullScreen && { flex: 1, backgroundColor: colors.background }]}>
      <ActivityIndicator size="small" color={colors.accentBlue} />
      {label ? (
        <Text style={[styles.label, { color: colors.textMuted }, typography.body]}>{label}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  label: {
    fontSize: 14,
  },
});