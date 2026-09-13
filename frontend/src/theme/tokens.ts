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
  // Backgrounds
  background: '#07111F',
  surface: '#111C2C',
  surfaceSecondary: '#172235',
  surfaceElevated: '#1B2738',
  surfaceSunken: '#0A121E',
  surfacePressed: '#0B1420',
  surfaceDisabled: 'rgba(23, 34, 53, 0.45)',

  // Text
  textPrimary: '#F7FAFC',
  textSecondary: '#9AA8B8',
  textMuted: '#6F7D8C',
  textDisabled: '#4E5B6A',
  textOnAccent: '#07111F',

  // Borders
  border: '#263447',
  borderStrong: '#33465C',
  borderFaint: 'rgba(255, 255, 255, 0.06)',

  // Brand (accent gold)
  brand: '#F4C51B',
  brandLight: '#F9D84E',
  brandDark: '#D4A714',
  brandSurface: 'rgba(244, 197, 27, 0.12)',
  brandSurfaceMuted: 'rgba(244, 197, 27, 0.06)',
  textOnBrand: '#07111F',

  // Teal
  teal: '#31B7A5',
  tealLight: '#3FD4B8',
  tealDark: '#289A8C',
  tealSurface: 'rgba(49, 183, 165, 0.12)',

  // Accent
  accentBlue: '#4D8DFF',
  accentBlueSoft: 'rgba(77, 141, 255, 0.14)',
  accentPurple: '#9B6CFF',
  accentPurpleSoft: 'rgba(155, 108, 255, 0.14)',

  // Glass
  glass: 'rgba(17, 28, 44, 0.78)',
  glassStrong: 'rgba(13, 22, 35, 0.92)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  glassHighlight: 'rgba(255, 255, 255, 0.06)',
  overlayScrim: 'rgba(3, 7, 13, 0.72)',

  // Glow
  glowBlue: 'rgba(77, 141, 255, 0.28)',
  glowGold: 'rgba(244, 197, 27, 0.22)',

  // Semantic
  success: '#63C174',
  successSurface: 'rgba(99, 193, 116, 0.12)',
  warning: '#F4B740',
  warningSurface: 'rgba(244, 183, 64, 0.12)',
  error: '#E85D68',
  errorSurface: 'rgba(232, 93, 104, 0.12)',
  info: '#4D8DFF',
  infoSurface: 'rgba(77, 141, 255, 0.12)',

  // Health status
  healthPositive: '#63C174',
  healthPositiveSurface: 'rgba(99, 193, 116, 0.14)',
  healthNeutral: '#4D8DFF',
  healthNeutralSurface: 'rgba(77, 141, 255, 0.12)',
  healthAttention: '#F4B740',
  healthAttentionSurface: 'rgba(244, 183, 64, 0.12)',
};

export const lightColors: ColorTokens = {
  // Backgrounds
  background: '#F8F9FA',
  surface: '#FFFFFF',
  surfaceSecondary: '#F0F2F5',
  surfaceElevated: '#FFFFFF',
  surfaceSunken: '#E8EAED',
  surfacePressed: '#E2E5E9',
  surfaceDisabled: 'rgba(0, 0, 0, 0.06)',

  // Text
  textPrimary: '#0F1412',
  textSecondary: '#4A5550',
  textMuted: '#7A8580',
  textDisabled: '#B0B8B4',
  textOnAccent: '#0F1412',

  // Borders
  border: '#D6DBD8',
  borderStrong: '#BCC3C0',
  borderFaint: 'rgba(0, 0, 0, 0.06)',

  // Brand (accent gold)
  brand: '#D4A714',
  brandLight: '#E5BD2E',
  brandDark: '#B8920F',
  brandSurface: 'rgba(212, 167, 20, 0.10)',
  brandSurfaceMuted: 'rgba(212, 167, 20, 0.05)',
  textOnBrand: '#FFFFFF',

  // Teal
  teal: '#289A8C',
  tealLight: '#31B7A5',
  tealDark: '#1E7D71',
  tealSurface: 'rgba(40, 154, 140, 0.10)',

  // Accent
  accentBlue: '#3A78E0',
  accentBlueSoft: 'rgba(58, 120, 224, 0.10)',
  accentPurple: '#8256D9',
  accentPurpleSoft: 'rgba(130, 86, 217, 0.10)',

  // Glass (opaque in light mode — no translucent glass in bright UI)
  glass: 'rgba(255, 255, 255, 0.95)',
  glassStrong: 'rgba(255, 255, 255, 1)',
  glassBorder: 'rgba(0, 0, 0, 0.08)',
  glassHighlight: 'rgba(0, 0, 0, 0.04)',
  overlayScrim: 'rgba(0, 0, 0, 0.38)',

  // Glow
  glowBlue: 'rgba(58, 120, 224, 0.22)',
  glowGold: 'rgba(212, 167, 20, 0.20)',

  // Semantic
  success: '#2D8F4E',
  successSurface: 'rgba(45, 143, 78, 0.10)',
  warning: '#C4930A',
  warningSurface: 'rgba(196, 147, 10, 0.10)',
  error: '#D43D48',
  errorSurface: 'rgba(212, 61, 72, 0.10)',
  info: '#3A78E0',
  infoSurface: 'rgba(58, 120, 224, 0.10)',

  // Health status
  healthPositive: '#2D8F4E',
  healthPositiveSurface: 'rgba(45, 143, 78, 0.10)',
  healthNeutral: '#3A78E0',
  healthNeutralSurface: 'rgba(58, 120, 224, 0.08)',
  healthAttention: '#C4930A',
  healthAttentionSurface: 'rgba(196, 147, 10, 0.10)',
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
  sleep: '#6C7AE0',
  sleepSurface: 'rgba(108, 122, 224, 0.12)',
  vitals: '#E74C6F',
  vitalsSurface: 'rgba(231, 76, 111, 0.12)',
  nutrition: '#2FBF71',
  nutritionSurface: 'rgba(47, 191, 113, 0.12)',
  activity: '#00B4D8',
  activitySurface: 'rgba(0, 180, 216, 0.12)',
  pain: '#E84393',
  painSurface: 'rgba(232, 67, 147, 0.12)',
  medication: '#9B59B6',
  medicationSurface: 'rgba(155, 89, 182, 0.12)',
  wellbeing: '#F1C40F',
  wellbeingSurface: 'rgba(241, 196, 15, 0.12)',
  mood: '#FD79A8',
  moodSurface: 'rgba(253, 121, 168, 0.12)',
  hydration: '#3A78E0',
  hydrationSurface: 'rgba(58, 120, 224, 0.12)',
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
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  medium: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  deep: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 6,
  },
  floating: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
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
    radialSurface: isDark ? 'rgba(17, 28, 44, 0.6)' : 'rgba(240, 243, 246, 0.7)',
    ring: isDark ? 'rgba(120, 140, 160, 0.16)' : 'rgba(0, 0, 0, 0.08)',
    ringStrong: isDark ? 'rgba(120, 140, 160, 0.28)' : 'rgba(0, 0, 0, 0.14)',
    hubSurface: isDark ? '#1B2738' : '#FFFFFF',
    hubBorder: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    hubText: isDark ? '#F7FAFC' : '#0F1412',
    hubTextSecondary: isDark ? '#9AA8B8' : '#4A5550',
    selectedSurface: isDark ? 'rgba(77, 141, 255, 0.16)' : 'rgba(58, 120, 224, 0.12)',
    selectedRing: isDark ? '#4D8DFF' : '#3A78E0',
    unselectedDim: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.10)',
    shapeFill: isDark ? 'rgba(49, 183, 165, 0.14)' : 'rgba(40, 154, 140, 0.12)',
    dimensionLabel: isDark ? '#9AA8B8' : '#4A5550',
    dimensionValue: isDark ? '#F7FAFC' : '#0F1412',
    animateRing: 600,
    animateShape: 900,
    animateTransition: 350,
    summarySlot: 'Your overall picture',
  };
}
