/**
 * MovementsCard — the base surface for the theme: flat color-blocking,
 * ultra-rounded (30px), NO shadows. Variants: white / dark / teal / lime.
 */

import React, { type ReactNode } from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { mv } from '@/theme/movements';

export type MovementsCardKind = 'white' | 'dark' | 'teal' | 'lime';

const BG: Record<MovementsCardKind, string> = {
  white: mv.surfaceWhite,
  dark: mv.surfaceDarkCard,
  teal: mv.surfaceTealDeep,
  lime: mv.accentLime,
};

interface MovementsCardProps {
  kind?: MovementsCardKind;
  children: ReactNode;
  radius?: number;
  style?: ViewStyle;
}

export function MovementsCard({
  kind = 'white',
  children,
  radius = mv.radiusCard,
  style,
}: MovementsCardProps) {
  return (
    <View style={[{ backgroundColor: BG[kind], borderRadius: radius }, styles.base, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    padding: mv.spaceCard,
    gap: 10,
  },
});