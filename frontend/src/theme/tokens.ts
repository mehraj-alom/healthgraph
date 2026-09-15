/**
 * HealthGraph Design Tokens
 *
 * Semantic token system supporting light and dark modes.
 * All values are consumed via useTheme() or themeForMode().
 * The original COLORS/SPACING/etc. from constants are re-exported for
 * backward compatibility but new code should use tokens from here.
 */

// ─── Color Modes ─────────────────────────────────────────────────────────────

export interface ColorTokens {
  // Backgrounds
  background: string;
  surface: string;
  surfaceSecondary: string;
  surfaceElevated: string;
  surfaceSunken: string;
  surfacePressed: string;
  surfaceDisabled: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDisabled: string;
  textOnAccent: string;

  // Borders
  border: string;
  borderStrong: string;
  borderFaint: string;

  // Brand / Primary (accent gold)
  brand: string;
  brandLight: string;
  brandDark: string;
  brandSurface: string;
  brandSurfaceMuted: string;
  textOnBrand: string;

  // Teal
  teal: string;
  tealLight: string;
  tealDark: string;
  tealSurface: string;

  // Accent Blue
  accentBlue: string;
  accentBlueSoft: string;
  accentPurple: string;
  accentPurpleSoft: string;

  // Glass / Overlay
  glass: string;
  glassStrong: string;
  glassBorder: string;
  glassHighlight: string;
  overlayScrim: string;

  // Glow (focus states)
  glowBlue: string;
  glowGold: string;

  // Semantic
  success: string;
  successSurface: string;
  warning: string;
  warningSurface: string;
  error: string;
  errorSurface: string;
  info: string;
  infoSurface: string;

  // Health status
  healthPositive: string;
  healthPositiveSurface: string;
  healthNeutral: string;
  healthNeutralSurface: string;
  healthAttention: string;
  healthAttentionSurface: string;
}

export const darkColors: ColorTokens = {
  // Backgrounds — warm charcoal (same family as the light cream)
  background: '#1D1B17',
  surface: '#26231E',
  surfaceSecondary: '#2E2A23',
  surfaceElevated: '#35312A',
  surfaceSunken: '#171512',
  surfacePressed: '#1A1713',
  surfaceDisabled: 'rgba(46, 42, 35, 0.45)',

  // Text
  textPrimary: '#FBF6EC',
  textSecondary: '#B8AF9E',
  textMuted: '#877E6D',
  textDisabled: '#5C5546',
  textOnAccent: '#1D1B17',

  // Borders
  border: '#3A352C',
  borderStrong: '#4C4638',
  borderFaint: 'rgba(251, 246, 236, 0.07)',

  // Brand — warm ink w/ peach glow (mirrors light mode)
  brand: '#F5C99B',
  brandLight: '#F9DDBE',
  brandDark: '#E8862E',
  brandSurface: 'rgba(232, 134, 46, 0.16)',
  brandSurfaceMuted: 'rgba(232, 134, 46, 0.08)',
  textOnBrand: '#1D1B17',

  // Apricot (was teal)
  teal: '#E8862E',
  tealLight: '#F0A35E',
  tealDark: '#C96A1E',
  tealSurface: 'rgba(232, 134, 46, 0.14)',

  // Accent — soft sky / muted lavender
  accentBlue: '#8FC1E8',
  accentBlueSoft: 'rgba(143, 193, 232, 0.16)',
  accentPurple: '#B9A8E8',
  accentPurpleSoft: 'rgba(185, 168, 232, 0.16)',

  // Glass
  glass: 'rgba(38, 35, 30, 0.78)',
  glassStrong: 'rgba(29, 27, 23, 0.92)',
  glassBorder: 'rgba(251, 246, 236, 0.09)',
  glassHighlight: 'rgba(251, 246, 236, 0.06)',
  overlayScrim: 'rgba(12, 10, 8, 0.72)',

  // Glow
  glowBlue: 'rgba(143, 193, 232, 0.28)',
  glowGold: 'rgba(232, 134, 46, 0.24)',

  // Semantic
  success: '#7FC48D',
  successSurface: 'rgba(127, 196, 141, 0.14)',
  warning: '#F0A92E',
  warningSurface: 'rgba(240, 169, 46, 0.14)',
  error: '#E07864',
  errorSurface: 'rgba(224, 120, 100, 0.14)',
  info: '#8FC1E8',
  infoSurface: 'rgba(143, 193, 232, 0.14)',

  // Health status
  healthPositive: '#7FC48D',
  healthPositiveSurface: 'rgba(127, 196, 141, 0.14)',
  healthNeutral: '#8FC1E8',
  healthNeutralSurface: 'rgba(143, 193, 232, 0.14)',
  healthAttention: '#F0A92E',
  healthAttentionSurface: 'rgba(240, 169, 46, 0.14)',
};

export const lightColors: ColorTokens = {
  // Backgrounds — warm clinical cream (Dribbble reference)
  background: '#EAE4D6',
  surface: '#FFFBF3',
  surfaceSecondary: '#F4EDDF',
  surfaceElevated: '#FFFFFF',
  surfaceSunken: '#E2D8C3',
  surfacePressed: '#E9E0CE',
  surfaceDisabled: 'rgba(29, 27, 23, 0.06)',

  // Text — warm ink
  textPrimary: '#1D1B17',
  textSecondary: '#797166',
  textMuted: '#A8A094',
  textDisabled: '#C6BDA9',
  textOnAccent: '#FFFFFF',

  // Borders — sandy hairlines
  border: '#E6DBC6',
  borderStrong: '#D3C3A6',
  borderFaint: 'rgba(29, 27, 23, 0.06)',

  // Brand — ink pill (like "All Doctors"), peach tint surfaces
  brand: '#1D1B17',
  brandLight: '#3A372F',
  brandDark: '#111009',
  brandSurface: 'rgba(232, 134, 46, 0.12)',
  brandSurfaceMuted: '#FBEEDC',
  textOnBrand: '#FFFFFF',

  // Apricot (was teal) — "Smart Doctor Match" + stars
  teal: '#E8862E',
  tealLight: '#F0A35E',
  tealDark: '#C96A1E',
  tealSurface: '#FBE3C8',

  // Accent — sky pill blue ("45 min") + soft lavender
  accentBlue: '#4A90C2',
  accentBlueSoft: '#D9EAF7',
  accentPurple: '#8A7BC8',
  accentPurpleSoft: 'rgba(138, 123, 200, 0.12)',

  // Glass — warm translucent cream
  glass: 'rgba(255, 251, 243, 0.92)',
  glassStrong: 'rgba(255, 251, 243, 1)',
  glassBorder: 'rgba(29, 27, 23, 0.08)',
  glassHighlight: 'rgba(255, 255, 255, 0.6)',
  overlayScrim: 'rgba(29, 27, 23, 0.38)',

  // Glow — warm, never neon
  glowBlue: 'rgba(74, 144, 194, 0.20)',
  glowGold: 'rgba(232, 134, 46, 0.22)',

  // Semantic — sage / apricot / terracotta / sky
  success: '#4E9B5F',
  successSurface: '#DDF0DF',
  warning: '#C9761E',
  warningSurface: '#FBE3C8',
  error: '#C2503E',
  errorSurface: 'rgba(194, 80, 62, 0.10)',
  info: '#4A90C2',
  infoSurface: '#D9EAF7',

  // Health status
  healthPositive: '#4E9B5F',
  healthPositiveSurface: '#DDF0DF',
  healthNeutral: '#4A90C2',
  healthNeutralSurface: '#D9EAF7',
  healthAttention: '#C9761E',
  healthAttentionSurface: '#FBE3C8',
};

// ─── Health Category Colors ──────────────────────────────────────────────────

export interface HealthCategoryTokens {
  sleep: string;
  sleepSurface: string;
  vitals: string;
  vitalsSurface: string;
  nutrition: string;
  nutritionSurface: string;
  activity: string;
  activitySurface: string;
  pain: string;
  painSurface: string;
  medication: string;
  medicationSurface: string;
  wellbeing: string;
  wellbeingSurface: string;
  mood: string;
  moodSurface: string;
  hydration: string;
  hydrationSurface: string;
}

export const healthCategories: HealthCategoryTokens = {
  sleep: '#8A7BC8',
  sleepSurface: 'rgba(138, 123, 200, 0.14)',
  vitals: '#C2503E',
  vitalsSurface: 'rgba(194, 80, 62, 0.12)',
  nutrition: '#4E9B5F',
  nutritionSurface: '#DDF0DF',
  activity: '#4A90C2',
  activitySurface: '#D9EAF7',
  pain: '#C2503E',
  painSurface: 'rgba(194, 80, 62, 0.12)',
  medication: '#8A7BC8',
  medicationSurface: 'rgba(138, 123, 200, 0.14)',
  wellbeing: '#E8862E',
  wellbeingSurface: '#FBE3C8',
  mood: '#E8A07C',
  moodSurface: 'rgba(232, 160, 124, 0.16)',
  hydration: '#4A90C2',
  hydrationSurface: '#D9EAF7',
};

// ─── Typography ──────────────────────────────────────────────────────────────

import { Platform, type TextStyle } from 'react-native';

const fontFamily =
  Platform.OS === 'ios'
    ? '-apple-system, SF Pro Display, SF Pro Text, system-ui, sans-serif'
    : 'Roboto, system-ui, sans-serif';

export interface TypographyTokens {
  display: TextStyle;
  largeHeading: TextStyle;
  heading: TextStyle;
  sectionHeading: TextStyle;
  body: TextStyle;
  bodySecondary: TextStyle;
  bodyStrong: TextStyle;
  caption: TextStyle;
  captionStrong: TextStyle;
  label: TextStyle;
  metricValue: TextStyle;
  metricUnit: TextStyle;
  metricSmall: TextStyle;
  button: TextStyle;
  overline: TextStyle;
}

export const typography: TypographyTokens = {
  display: {
    fontFamily,
    fontSize: 34,
    fontWeight: '300',
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  largeHeading: {
    fontFamily,
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  heading: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 28,
    letterSpacing: -0.25,
  },
  sectionHeading: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  body: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22,
  },
  bodySecondary: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },
  bodyStrong: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
  },
  caption: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  },
  captionStrong: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  label: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metricValue: {
    fontFamily,
    fontSize: 36,
    fontWeight: '700',
    lineHeight: 40,
    letterSpacing: -1,
  },
  metricUnit: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 20,
    letterSpacing: 0,
  },
  metricSmall: {
    fontFamily,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
    letterSpacing: -0.5,
  },
  button: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
    letterSpacing: 0.2,
  },
  overline: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
};

// ─── Spacing ─────────────────────────────────────────────────────────────────

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  section: 48,
} as const;

// ─── Border Radius ───────────────────────────────────────────────────────────

export const radius = {
  none: 0,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 22,
  xxl: 28,
  pill: 9999,
} as const;

// ─── Elevation / Shadow ──────────────────────────────────────────────────────

export interface ShadowTokens {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export interface ElevationTokens {
  none: ShadowTokens;
  soft: ShadowTokens;
  medium: ShadowTokens;
  deep: ShadowTokens;
  floating: ShadowTokens;
}

export const darkElevation: ElevationTokens = {
  none: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  soft: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },
  medium: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  deep: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 8,
  },
  floating: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    elevation: 12,
  },
};

export const lightElevation: ElevationTokens = {
  none: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  soft: {
    shadowColor: '#7C5A2E',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  medium: {
    shadowColor: '#7C5A2E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  deep: {
    shadowColor: '#7C5A2E',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 6,
  },
  floating: {
    shadowColor: '#7C5A2E',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 10,
  },
};

// ─── Animation ───────────────────────────────────────────────────────────────

export interface AnimationTokens {
  /** Fast micro-interaction (tap, press feedback) */
  fast: number;
  /** Standard transition (panel open, nav) */
  standard: number;
  /** Emphasized transition (page entrance) */
  emphasized: number;
  /** Slow transition (complex choreography) */
  slow: number;

  // Easing curves (Reanimated timing config objects)
  easeStandard: { duration: number; easing: (v: number) => number };
  easeDecelerate: { duration: number; easing: (v: number) => number };
  easeAccelerate: { duration: number; easing: (v: number) => number };

  // Spring configs (Reanimated spring config objects)
  springGentle: { damping: number; stiffness: number; mass: number };
  springSnappy: { damping: number; stiffness: number; mass: number };
  springBouncy: { damping: number; stiffness: number; mass: number };
}

// Easing functions matching the spec curves
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number) => t * t * t;

export const animation: AnimationTokens = {
  fast: 150,
  standard: 250,
  emphasized: 350,
  slow: 500,

  easeStandard: { duration: 250, easing: easeOutQuart },
  easeDecelerate: { duration: 300, easing: easeOutCubic },
  easeAccelerate: { duration: 200, easing: easeInCubic },

  springGentle: { damping: 20, stiffness: 120, mass: 1 },
  springSnappy: { damping: 24, stiffness: 260, mass: 1 },
  springBouncy: { damping: 12, stiffness: 200, mass: 1 },
};

// ─── Layout Constants ────────────────────────────────────────────────────────

export const layout = {
  screenPadding: spacing.lg,
  cardGap: spacing.md,
  sectionGap: spacing.xl,
  headerHeight: 56,
  tabBarHeight: 64,
  minTouchTarget: 44,
} as const;

// ─── Control Heights ─────────────────────────────────────────────────────────

export const controlHeights = {
  small: 36,
  medium: 44,
  large: 52,
} as const;

export type ControlSize = keyof typeof controlHeights;

// ─── Full Theme Type ─────────────────────────────────────────────────────────

export interface ThemeTokens {
  colors: ColorTokens;
  health: HealthCategoryTokens;
  typography: TypographyTokens;
  spacing: typeof spacing;
  radius: typeof radius;
  elevation: ElevationTokens;
  animation: AnimationTokens;
  layout: typeof layout;
  controlHeights: typeof controlHeights;
  visualization: VisualizationTokens;
  isDark: boolean;
}

// ─── Radial / Organic visualization (future Overall Health) ─────────────────
//
// Foundational primitives for the signature radial/organic visualization.
// Nothing here is rendered yet; these tokens give the future component the
// surfaces, labels, selection states and motion timings it needs to feel
// alive without looking like a technical radar chart.

export interface VisualizationTokens {
  /** Circular surface behind the radial forms (recessed, calm). */
  radialSurface: string;
  /** Thin ring strokes. */
  ring: string;
  ringStrong: string;
  /** Center hub where the overall state label sits. */
  hubSurface: string;
  hubBorder: string;
  hubText: string;
  hubTextSecondary: string;
  /** Selection states — independent of hue, always with a label. */
  selectedSurface: string;
  selectedRing: string;
  unselectedDim: string;
  /** Organic shape fill tint (over surface). */
  shapeFill: string;
  /** Dimension label readout. */
  dimensionLabel: string;
  dimensionValue: string;
  /** Suggested motion (ms) for the future component. */
  animateRing: number;
  animateShape: number;
  animateTransition: number;
  /** Accessibility: center summary sentence template slot. */
  summarySlot: string;
}

export function visualizationForMode(isDark: boolean): VisualizationTokens {
  return {
    radialSurface: isDark ? 'rgba(38, 35, 30, 0.6)' : 'rgba(255, 251, 243, 0.7)',
    ring: isDark ? 'rgba(184, 175, 158, 0.16)' : 'rgba(29, 27, 23, 0.08)',
    ringStrong: isDark ? 'rgba(184, 175, 158, 0.28)' : 'rgba(29, 27, 23, 0.14)',
    hubSurface: isDark ? '#35312A' : '#FFFBF3',
    hubBorder: isDark ? 'rgba(251,246,236,0.08)' : '#E6DBC6',
    hubText: isDark ? '#FBF6EC' : '#1D1B17',
    hubTextSecondary: isDark ? '#B8AF9E' : '#797166',
    selectedSurface: isDark ? 'rgba(232, 134, 46, 0.16)' : '#FBE3C8',
    selectedRing: isDark ? '#E8862E' : '#E8862E',
    unselectedDim: isDark ? 'rgba(251,246,236,0.14)' : 'rgba(29,27,23,0.10)',
    shapeFill: isDark ? 'rgba(232, 134, 46, 0.14)' : 'rgba(232, 134, 46, 0.12)',
    dimensionLabel: isDark ? '#B8AF9E' : '#797166',
    dimensionValue: isDark ? '#FBF6EC' : '#1D1B17',
    animateRing: 600,
    animateShape: 900,
    animateTransition: 350,
    summarySlot: 'Your overall picture',
  };
}
