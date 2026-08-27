import { StyleSheet, View, Text, Pressable } from 'react-native';
import { COLORS, SPACING, BORDER_RADIUS, TYPOGRAPHY, SHADOWS } from '@/constants';

interface CardProps {
  children: React.ReactNode;
  style?: any;
  onPress?: () => void;
  elevated?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const Card = ({ 
  children, 
  style, 
  onPress, 
  elevated = false,
  padding = 'md'
}: CardProps) => {
  const paddingStyles = {
    none: 0,
    sm: SPACING.sm,
    md: SPACING.md,
    lg: SPACING.lg,
  };

  const Container = onPress ? Pressable : View;

  return (
    <Container
      onPress={onPress}
      style={[
        styles.container,
        elevated && styles.elevated,
        { padding: paddingStyles[padding] },
        style
      ]}
    >
      {children}
    </Container>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  elevated: {
    ...SHADOWS.md,
  },
});