import { StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants';

interface LoadingStateProps {
  label?: string;
  fullScreen?: boolean;
}

/** MedGraph loading state — calm spinner + optional label. */
export const LoadingState = ({ label, fullScreen = false }: LoadingStateProps) => {
  return (
    <View style={[styles.container, fullScreen && styles.fullScreen]}>
      <ActivityIndicator size="small" color={COLORS.accentBlue} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
    gap: SPACING.md,
  },
  fullScreen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  label: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
  },
});
