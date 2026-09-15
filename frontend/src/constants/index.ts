export const COLORS = {
  // ── Warm clinical cream (Dribbble reference) ──
  background: '#EAE4D6',
  surface: '#FFFBF3',
  surfaceSecondary: '#F4EDDF',
  surfaceElevated: '#FFFFFF',

  // ── Typography (warm ink) ──
  textPrimary: '#1D1B17',
  textSecondary: '#797166',
  textMuted: '#A8A094',

  // ── Border (sandy hairlines) ──
  border: '#E6DBC6',
  borderLight: '#EFE6D3',

  // ── Brand / Primary — ink pill + peach tint ──
  primary: '#1D1B17',
  primaryLight: '#3A372F',
  primaryDark: '#111009',
  primaryBg: 'rgba(232, 134, 46, 0.12)',
  primaryMuted: '#FBEEDC',

  // ── Apricot accent (was Medical Teal) ──
  teal: '#E8862E',
  tealLight: '#F0A35E',
  tealDark: '#C96A1E',
  tealBg: '#FBE3C8',

  // ── Accent colors (category-specific) ──
  accent: '#4A90C2',
  accentLight: '#8FC1E8',
  accentBg: '#D9EAF7',

  purple: '#8A7BC8',
  purpleLight: '#B9A8E8',
  purpleBg: 'rgba(138, 123, 200, 0.12)',

  pink: '#E8A07C',
  pinkLight: '#F0BC9E',
  pinkBg: 'rgba(232, 160, 124, 0.14)',

  green: '#4E9B5F',
  greenLight: '#7FC48D',
  greenBg: '#DDF0DF',

  orange: '#E8862E',
  orangeLight: '#F0A35E',
  orangeBg: '#FBE3C8',

  coral: '#C2503E',
  coralBg: 'rgba(194, 80, 62, 0.10)',

  // ── Semantic ──
  success: '#4E9B5F',
  successBg: '#DDF0DF',
  warning: '#C9761E',
  warningBg: '#FBE3C8',
  error: '#C2503E',
  errorBg: 'rgba(194, 80, 62, 0.10)',
  info: '#4A90C2',
  infoBg: '#D9EAF7',

  // ── Visual Status Colors ──
  statusNormal: '#4E9B5F',
  statusWarning: '#C9761E',
  statusCritical: '#C2503E',
  statusAttention: '#E8862E',

  // ── Graph / Category colors ──
  graphPatient: '#E8862E',
  graphBody: '#4A90C2',
  graphSymptom: '#C2503E',
  graphCondition: '#C2503E',
  graphVital: '#4A90C2',
  graphMedication: '#8A7BC8',
  graphRecord: '#8A7BC8',
  graphLifestyle: '#4E9B5F',
  graphEvent: '#E8862E',

  // ── Legacy aliases for backward compatibility ──
  surfaceBorder: '#E6DBC6',
  accentBgLegacy: '#D9EAF7',

  // ── Gradients ──
  gradientPrimary: ['#1D1B17', '#3A372F'] as const,
  gradientSurface: ['#FFFBF3', '#EAE4D6'] as const,

  // ── Legacy aliases ──
  primaryLightCompat: '#3A372F',
  primaryBgLegacy: 'rgba(232, 134, 46, 0.12)',
  accentBgFallback: '#D9EAF7',

  // ───────────────────────────────────────────────────────────────────────────
  // Warm clinical system — cream cards / sandy hairlines
  // ───────────────────────────────────────────────────────────────────────────

  // Layered surfaces (warm cream)
  surfacePressed: '#E9E0CE',
  surfaceDisabled: 'rgba(29, 27, 23, 0.06)',
  surfaceSunken: '#E2D8C3', // recessed wells (inputs, search, code)

  // Sandy hairline borders
  borderStrong: '#D3C3A6',
  borderFaint: 'rgba(29, 27, 23, 0.06)',

  // Cream overlays
  glass: 'rgba(255, 251, 243, 0.92)',
  glassStrong: 'rgba(255, 251, 243, 1)',
  glassBorder: 'rgba(29, 27, 23, 0.08)',
  glassHighlight: 'rgba(255, 255, 255, 0.6)',

  // Ink / sky / peach accent triad
  accentBlue: '#4A90C2',
  accentBlueSoft: '#D9EAF7',
  accentPurple: '#8A7BC8',
  accentPurpleSoft: 'rgba(138, 123, 200, 0.12)',
  accentGold: '#E8862E',
  accentGoldSoft: '#FBE3C8',

  // Focus / active glow (warm, never neon)
  glowBlue: 'rgba(74, 144, 194, 0.20)',
  glowGold: 'rgba(232, 134, 46, 0.22)',
  glowPurple: 'rgba(138, 123, 200, 0.20)',

  textDisabled: '#C6BDA9',
  textOnAccent: '#FFFFFF', // white text on ink fills
  textOnPrimaryDark: '#FFFFFF',

  overlayScrim: 'rgba(29, 27, 23, 0.38)',

  // Per-category accents — kept in sync with the Health Graph visualization
  // (see EVENT_TYPE_COLORS in HealthGraphScreen).
  catSleep: '#8A7BC8',
  catVitals: '#C2503E',
  catNutrition: '#4E9B5F',
  catActivity: '#4A90C2',
  catPain: '#C2503E',
  catMedication: '#8A7BC8',
  catWellbeing: '#E8862E',
  catSymptom: '#E8862E',
  catMood: '#E8A07C',
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
} as const;

export const BORDER_RADIUS = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 22,
  full: 9999,
  // Design-system alias
  pill: 9999,
  small: 10,
  medium: 14,
  large: 20,
} as const;

export const SHADOWS = {
  sm: {
    shadowColor: '#7C5A2E',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#7C5A2E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  lg: {
    shadowColor: '#7C5A2E',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 8,
  },
  xl: {
    shadowColor: '#7C5A2E',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 12,
  },
} as const;

export const TYPOGRAPHY = {
  display: {
    fontSize: 40,
    fontWeight: '700' as const,
    lineHeight: 48,
    letterSpacing: -0.5,
  },
  h1: {
    fontSize: 28,
    fontWeight: '700' as const,
    lineHeight: 36,
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 22,
    fontWeight: '600' as const,
    lineHeight: 30,
    letterSpacing: -0.25,
  },
  h3: {
    fontSize: 18,
    fontWeight: '600' as const,
    lineHeight: 26,
  },
  body: {
    fontSize: 15,
    fontWeight: '400' as const,
    lineHeight: 22,
  },
  bodyStrong: {
    fontSize: 15,
    fontWeight: '600' as const,
    lineHeight: 22,
  },
  caption: {
    fontSize: 13,
    fontWeight: '400' as const,
    lineHeight: 18,
  },
  captionStrong: {
    fontSize: 13,
    fontWeight: '600' as const,
    lineHeight: 18,
  },
  label: {
    fontSize: 11,
    fontWeight: '600' as const,
    lineHeight: 16,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  metric: {
    fontSize: 32,
    fontWeight: '700' as const,
    lineHeight: 38,
  },
  metricSmall: {
    fontSize: 24,
    fontWeight: '700' as const,
    lineHeight: 30,
  },
  // Design-system aliases
  title: {
    fontSize: 20,
    fontWeight: '700' as const,
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
  bodyMedium: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
  button: {
    fontSize: 15,
    fontWeight: '700' as const,
    lineHeight: 20,
    letterSpacing: 0.2,
  },
  overline: {
    fontSize: 10,
    fontWeight: '700' as const,
    lineHeight: 14,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },
} as const;

export const ANIMATION = {
  fast: 150,
  normal: 250,
  slow: 350,
} as const;

// Design-system spacing aliases (1:1 with SPACING)
export const SPACE = SPACING;

// ── Control heights ────────────────────────────────────────────────────────────
export const CONTROL_HEIGHTS = {
  small: 40,
  medium: 48,
  large: 56,
} as const;

export type ControlSize = keyof typeof CONTROL_HEIGHTS;

// ── Elevation presets (soft / medium / deep) ──────────────────────────────────
export const ELEVATION = {
  soft: SHADOWS.sm,
  medium: SHADOWS.md,
  deep: SHADOWS.lg,
} as const;


export const MEDICAL_DISCLAIMER = `healthgraph is for general wellness, fitness tracking, and record organization. It is not a medical device. healthgraph does not provide medical advice, diagnosis, or treatment. Always consult a physician.`;

export const STRUCTURE_CATEGORIES = {
  BODY_REGION: 'BODY_REGION',
  ORGAN: 'ORGAN',
} as const;

export const VISUAL_STATUS = {
  NORMAL: 'normal',
  MILD_ATTENTION: 'mild_attention',
  WARNING: 'warning',
  CRITICAL: 'critical',
} as const;

export type VisualStatus = typeof VISUAL_STATUS[keyof typeof VISUAL_STATUS];

// ── Category color mapping for consistent accent usage ──
export const CATEGORY_COLORS = {
  activity: '#4A90C2',
  sleep: '#8A7BC8',
  vitals: '#C2503E',
  hydration: '#4A90C2',
  nutrition: '#4E9B5F',
  medication: '#8A7BC8',
  wellbeing: '#E8862E',
  symptoms: '#C2503E',
  records: '#4A90C2',
  mental: '#8A7BC8',
} as const;
