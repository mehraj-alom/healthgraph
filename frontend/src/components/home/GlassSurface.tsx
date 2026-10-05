/**
 * GlassSurface — the frosted content material for the redesigned Home.
 *
 * Apple keeps Liquid Glass on the floating functional layer; content gets
 * the *standard materials*, which are themselves translucent frosted
 * surfaces. This is the React Native approximation of a dark-mode regular
 * material: expo-blur backdrop blur + a translucent dark wash + hairline
 * specular top edge + soft rim, over the aurora stage.
 *
 * - Reduce Transparency / high contrast → opaque fill, no blur.
 * - Optional press feedback (scale + dim) when `onPress` is provided.
 * - A diagonal sheen band catches the light like a glass sheet; it is a
 *   static fill, not a loop.
 */

import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';

import { LG } from '@/theme/liquidGlass';

/** Opaque-glass fallback shared across Home (header, cards, dock already has its own). */
export function useReduceTransparency(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    const api = AccessibilityInfo as unknown as {
      isReduceTransparencyEnabled?: () => Promise<boolean>;
    };
    if (typeof api.isReduceTransparencyEnabled === 'function') {
      api.isReduceTransparencyEnabled().then((v) => {
        if (mounted) setReduced(v);
      }).catch(() => undefined);
    }
    return () => {
      mounted = false;
    };
  }, []);
  return reduced;
}

interface GlassSurfaceProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Corner radius (default LG.card.radius). */
  radius?: number;
  /** Stronger wash for text-dense cards (fillStrong). */
  strong?: boolean;
  /** Extra translucent tint laid over the glass (status, category hue). */
  tint?: string;
  tintOpacity?: number;
  intensity?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'summary' | 'image';
  /** Press feedback strength — default follows onPress. */
  pressScale?: number;
  /** Hide the diagonal sheen (busy layouts). */
  noSheen?: boolean;
  /**
   * Skip the live blur: translucent fill + rim only. For small repeated
   * tiles over the static aurora stage — materially identical look, far
   * cheaper than twenty BlurViews.
   */
  noBlur?: boolean;
}

export function GlassSurface({
  children,
  style,
  radius = LG.card.radius,
  strong = false,
  tint,
  tintOpacity = 0.12,
  intensity = LG.card.blurIntensity,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityRole,
  pressScale = 0.972,
  noSheen = false,
  noBlur = false,
}: GlassSurfaceProps) {
  const reduceTransparency = useReduceTransparency();
  const isPressable = Boolean(onPress || onLongPress);
  const Container = isPressable ? Pressable : View;
  // Resolve the surface style up front: plain Views cannot take a function
  // style (React Native drops it silently), so only Pressables get the
  // pressed-state wrapper.
  const baseStyle = [
    styles.surface,
    {
      borderRadius: radius,
      backgroundColor: reduceTransparency
        ? LG.card.fillOpaque
        : strong
          ? LG.card.fillStrong
          : noBlur
            ? LG.card.fillStatic
            : LG.card.fill,
    },
    style,
  ];
  return (
    <Container
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole={onPress ? (accessibilityRole ?? 'button') : accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      style={
        isPressable
          ? ({ pressed }: { pressed: boolean }) => [
              ...baseStyle,
              { transform: [{ scale: pressed ? pressScale : 1 }], opacity: pressed ? 0.92 : 1 },
            ]
          : baseStyle
      }
    >
      {reduceTransparency || noBlur ? null : (
        <BlurView tint="dark" intensity={intensity} style={StyleSheet.absoluteFill} />
      )}
      {/* Static fill sits above the blur so the wash stays even; the border
          and hairline read as the sheet's rim catching light. */}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.rim, { borderRadius: radius }]}
      />
      <View
        pointerEvents="none"
        style={[styles.hairline, { borderRadius: radius }]}
      />
      {!noSheen ? <View pointerEvents="none" style={[styles.sheen, { borderRadius: radius }]} /> : null}
      {tint ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: tint, opacity: tintOpacity, borderRadius: radius }]}
        />
      ) : null}
      {children}
    </Container>
  );
}

const styles = StyleSheet.create({
  surface: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: LG.card.border,
    // Same-hue depth: the sheet lifts off the stage without a hard edge.
    shadowColor: '#02040A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 8,
  },
  rim: {
    borderWidth: 1,
    borderTopColor: LG.card.hairlineTop,
    borderLeftColor: 'rgba(255,255,255,0.08)',
    borderRightColor: 'rgba(0,0,0,0.35)',
    borderBottomColor: 'rgba(0,0,0,0.45)',
  },
  hairline: {
    position: 'absolute',
    top: 0,
    left: 18,
    right: 18,
    height: 1,
    backgroundColor: LG.card.hairlineTop,
    borderRadius: 1,
  },
  sheen: {
    position: 'absolute',
    top: -40,
    bottom: -40,
    left: -50,
    width: 100,
    backgroundColor: 'rgba(255,255,255,0.045)',
    transform: [{ rotate: '18deg' }],
  },
});
