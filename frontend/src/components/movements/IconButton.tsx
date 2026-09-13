/**
 * IconButton — 6.9 icon buttons: perfect circle, ~36px, line-style glyph.
 * The signature 45° ↗ outward-arrow is the default "expand / view detail"
 * affordance and must not be swapped for a chevron or ellipsis.
 */

import React from 'react';
import { Pressable, Text, StyleSheet, type ViewStyle } from 'react-native';
import { mv } from '@/theme/movements';

type IconButtonKind =
  | 'solid'      // solid near-black, white glyph (white cards)
  | 'dark'       // translucent dark over colored cards
  | 'darkCard'   // solid dark card
  | 'white'      // solid white, dark glyph (over dark background)
  | 'softWhite'; // translucent white over colored/dark cards

interface IconButtonProps {
  onPress: () => void;
  glyph?: string;
  kind?: IconButtonKind;
  accessibilityLabel: string;
  size?: number;
  style?: ViewStyle;
}

const BG: Record<IconButtonKind, string> = {
  solid: mv.textOnLightPrimary,
  dark: 'rgba(0,0,0,0.20)',
  darkCard: mv.surfaceDarkCard,
  white: mv.surfaceWhite,
  softWhite: 'rgba(255,255,255,0.22)',
};

const GLYPH_COLOR: Record<IconButtonKind, string> = {
  solid: mv.surfaceWhite,
  dark: mv.surfaceWhite,
  darkCard: mv.surfaceWhite,
  white: mv.textOnLightPrimary,
  softWhite: mv.surfaceWhite,
};

export function IconButton({
  onPress,
  glyph = '↗',
  kind = 'solid',
  accessibilityLabel,
  size = 36,
  style,
}: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: BG[kind],
          alignItems: 'center',
          justifyContent: 'center',
        },
        pressed && { opacity: 0.75, transform: [{ scale: 0.94 }] },
        style,
      ]}
    >
      <Text
        style={[
          styles.glyph,
          { color: GLYPH_COLOR[kind], fontSize: size * 0.5 },
        ]}
      >
        {glyph}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  glyph: {
    fontWeight: '700',
    lineHeight: undefined,
  },
});