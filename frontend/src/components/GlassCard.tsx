import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { LG } from '@/theme/guava';

interface GlassCardProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  intensity?: number;
  radius?: number;
  accessibilityLabel?: string;
}

/**
 * GlassCard — liquid-glass card matching the web `.lg-card` system
 * (healthgraph_web/src/index.css): black-tinted blurred surface,
 * hairline edge stroke, white top specular, teal bottom refraction,
 * radius 28, deep black shadow.
 *
 * Opt-in: existing white `Card` usages are untouched. Use for hero /
 * feature surfaces on dark (LG.stage) bases with light text.
 * Reduced transparency falls back to a solid fill; no animation, so
 * reduced motion is safe by construction.
 */
export function GlassCard({
  children,
  style,
  onPress,
  intensity = 28,
  radius = LG.rGlass,
  accessibilityLabel,
}: GlassCardProps) {
  const glassOff = useReducedMotion();

  const Container = onPress ? Pressable : View;
  const pressStyle = onPress
    ? ({ pressed }: { pressed: boolean }) => [
        pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
      ]
    : undefined;

  return (
    <Container
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? accessibilityLabel : undefined}
      style={[
        styles.card,
        { borderRadius: radius },
        glassOff && styles.cardSolid,
        pressStyle as never,
        style,
      ]}
    >
      {glassOff ? null : (
        <BlurView tint="dark" intensity={intensity} style={StyleSheet.absoluteFill} />
      )}
      {/* Top specular sweep (white) + teal bottom refraction. */}
      <View pointerEvents="none" style={[styles.specular, { borderRadius: radius }]} />
      <View pointerEvents="none" style={styles.topEdge} />
      <View pointerEvents="none" style={styles.refraction} />
      {children}
    </Container>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: LG.glassFill,
    borderWidth: 1,
    borderColor: LG.glassStroke,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 40,
    elevation: 12,
  },
  cardSolid: {
    backgroundColor: LG.stageDeep,
  },
  specular: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  topEdge: {
    position: 'absolute',
    top: 0,
    left: 18,
    right: 18,
    height: 1,
    borderRadius: 1,
    backgroundColor: LG.glassHighlight,
    opacity: 0.55,
  },
  refraction: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 56,
    backgroundColor: LG.glassRefraction,
    opacity: 0.35,
  },
});

export default GlassCard;
