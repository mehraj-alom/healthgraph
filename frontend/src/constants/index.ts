export const COLORS = {
  // ── Deep dark backgrounds ──
  background: '#07111F',
  surface: '#111C2C',
  surfaceSecondary: '#172235',
  surfaceElevated: '#1B2738',

  // ── Typography ──
  textPrimary: '#F7FAFC',
  textSecondary: '#9AA8B8',
  textMuted: '#6F7D8C',

  // ── Border ──
  border: '#263447',
  borderLight: '#1E2D40',

  // ── Brand / Primary ──
  primary: '#F4C51B',
  primaryLight: '#F9D84E',
  primaryDark: '#D4A714',
  primaryBg: 'rgba(244, 197, 27, 0.12)',
  primaryMuted: 'rgba(244, 197, 27, 0.25)',

  // ── Medical Teal ──
  teal: '#31B7A5',
  tealLight: '#3FD4B8',
  tealDark: '#289A8C',
  tealBg: 'rgba(49, 183, 165, 0.12)',

  // ── Accent colors (category-specific) ──
  accent: '#4D8DFF',
  accentLight: '#6BA1FF',
  accentBg: 'rgba(77, 141, 255, 0.12)',

  purple: '#9B6CFF',
  purpleLight: '#B591FF',
  purpleBg: 'rgba(155, 108, 255, 0.12)',

  pink: '#F05F79',
  pinkLight: '#F4849A',
  pinkBg: 'rgba(240, 95, 121, 0.12)',

  green: '#63C174',
  greenLight: '#7FD88E',
  greenBg: 'rgba(99, 193, 116, 0.12)',

  orange: '#F0A030',
  orangeLight: '#F4B858',
  orangeBg: 'rgba(240, 160, 48, 0.12)',

  coral: '#F05F79',
  coralBg: 'rgba(240, 95, 121, 0.12)',

  // ── Semantic ──
  success: '#63C174',
  successBg: 'rgba(99, 193, 116, 0.12)',
  warning: '#F4B740',
  warningBg: 'rgba(244, 183, 64, 0.12)',
  error: '#E85D68',
  errorBg: 'rgba(232, 93, 104, 0.12)',
  info: '#4D8DFF',
  infoBg: 'rgba(77, 141, 255, 0.12)',

  // ── Visual Status Colors ──
  statusNormal: '#63C174',
  statusWarning: '#F4B740',
  statusCritical: '#E85D68',
  statusAttention: '#F4B740',

  // ── Graph / Category colors ──
  graphPatient: '#F4C51B',
  graphBody: '#31B7A5',
  graphSymptom: '#F05F79',
  graphCondition: '#E85D68',
  graphVital: '#4D8DFF',
  graphMedication: '#F05F79',
  graphRecord: '#9B6CFF',
  graphLifestyle: '#63C174',
  graphEvent: '#F4B740',

  // ── Legacy aliases for backward compatibility ──
  surfaceBorder: '#263447',
  accentBgLegacy: 'rgba(77, 141, 255, 0.12)',

  // ── Gradients ──
  gradientPrimary: ['#F4C51B', '#D4A714'] as const,
  gradientSurface: ['#111C2C', '#07111F'] as const,

  // ── Legacy aliases ──
  primaryLightCompat: '#F9D84E',
  primaryBgLegacy: 'rgba(244, 197, 27, 0.12)',
  accentBgFallback: 'rgba(77, 141, 255, 0.12)',

  // ───────────────────────────────────────────────────────────────────────────
  // MedGraph Design System — dark glass / soft-neumorphic tokens
  // ───────────────────────────────────────────────────────────────────────────

  // Layered surfaces (dark charcoal/navy)
  surfacePressed: '#0B1420',
  surfaceDisabled: 'rgba(23, 34, 53, 0.45)',
  surfaceSunken: '#0A121E', // recessed wells (inputs, search, code)

  // Thin low-contrast borders
  borderStrong: '#33465C',
  borderFaint: 'rgba(255, 255, 255, 0.06)',

  // Glass overlays
  glass: 'rgba(17, 28, 44, 0.78)',
  glassStrong: 'rgba(13, 22, 35, 0.92)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  glassHighlight: 'rgba(255, 255, 255, 0.06)',

  // Restrained blue/purple/gold accent triad
  accentBlue: '#4D8DFF',
  accentBlueSoft: 'rgba(77, 141, 255, 0.14)',
  accentPurple: '#9B6CFF',
  accentPurpleSoft: 'rgba(155, 108, 255, 0.14)',
  accentGold: '#F4C51B',
  accentGoldSoft: 'rgba(244, 197, 27, 0.12)',

  // Focus / active glow (subtle, never neon)
  glowBlue: 'rgba(77, 141, 255, 0.28)',
  glowGold: 'rgba(244, 197, 27, 0.22)',
  glowPurple: 'rgba(155, 108, 255, 0.22)',

  textDisabled: '#4E5B6A',
  textOnAccent: '#07111F', // dark text on gold/light accent fills
  textOnPrimaryDark: '#FFFFFF',

  overlayScrim: 'rgba(3, 7, 13, 0.72)',

  // Per-category accents — kept in sync with the Health Graph visualization
  // (see EVENT_TYPE_COLORS in HealthGraphScreen).
  catSleep: '#6C7AE0',
  catVitals: '#E74C6F',
  catNutrition: '#2FBF71',
  catActivity: '#00B4D8',
  catPain: '#E84393',
  catMedication: '#9B59B6',
  catWellbeing: '#F1C40F',
  catSymptom: '#E67E22',
  catMood: '#FD79A8',
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
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
  // Design-system alias
  pill: 9999,
  small: 8,
  medium: 12,
  large: 16,
} as const;

export const SHADOWS = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  xl: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
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
  activity: '#63C174',
  sleep: '#9B6CFF',
  vitals: '#F05F79',
  hydration: '#4D8DFF',
  nutrition: '#F0A030',
  medication: '#F05F79',
  wellbeing: '#31B7A5',
  symptoms: '#F05F79',
  records: '#4D8DFF',
  mental: '#9B6CFF',
} as const;
