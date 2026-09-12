import { Image, type ImageStyle, type StyleProp } from 'react-native';

/**
 * BrandLogo — the healthgraph lockup (cropped 844×216, dark ink on
 * transparent). Two renderings, no new assets:
 *  - raw (default): dark ink as-is — for LIGHT surfaces (dashboard header,
 *    cream tiles).
 *  - tinted: single-color wash via tintColor — for DARK surfaces (chat
 *    header). The artwork is monochrome, so tinting stays crisp.
 */
const LOGO = require('../../assets/logo.png');

export const LOGO_ASPECT = 844 / 216;

interface BrandLogoProps {
  height?: number;
  /** Wash color for dark surfaces; omit for raw ink on light surfaces. */
  tint?: string;
  style?: StyleProp<ImageStyle>;
}

export function BrandLogo({ height = 24, tint, style }: BrandLogoProps) {
  return (
    <Image
      source={LOGO}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel="healthgraph logo"
      style={[{ height, width: height * LOGO_ASPECT, tintColor: tint }, style]}
    />
  );
}
