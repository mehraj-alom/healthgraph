export const COLORS = {
  // Base
  background: '#f7f9f8',
  surface: '#ffffff',
  surfaceElevated: '#f0f5f3',
  border: '#dbe5e1',
  
  // Text
  textPrimary: '#18332d',
  textSecondary: '#59716b',
  textMuted: '#778c87',
  
  // Brand - Teal/Emerald for health
  primary: '#087a69',
  primaryLight: '#159b84',
  primaryDark: '#056657',
  primaryBg: '#e4f4f0',
  
  // Accent - Emerald
  accent: '#23836b',
  accentLight: '#52a98d',
  accentBg: '#e7f4ed',
  
  // Semantic
  success: '#10b981',         // Emerald 500
  warning: '#f59e0b',         // Amber 500
  error: '#ef4444',           // Red 500
  info: '#3b82f6',            // Blue 500
  
  // Visual Status Colors
  statusNormal: '#10b981',    // Emerald
  statusWarning: '#f59e0b',   // Amber
  statusCritical: '#ef4444',  // Red
  statusAttention: '#f97316', // Orange
  
  // Gradients
  gradientPrimary: ['#159b84', '#087a69'] as const,
  gradientSurface: ['#ffffff', '#f7f9f8'] as const,
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
} as const;

export const SHADOWS = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  xl: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.2,
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
    fontSize: 32,
    fontWeight: '700' as const,
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 24,
    fontWeight: '600' as const,
    lineHeight: 32,
    letterSpacing: -0.25,
  },
  h3: {
    fontSize: 20,
    fontWeight: '600' as const,
    lineHeight: 28,
  },
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 24,
  },
  bodyStrong: {
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 24,
  },
  caption: {
    fontSize: 13,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
  captionStrong: {
    fontSize: 13,
    fontWeight: '600' as const,
    lineHeight: 20,
  },
  label: {
    fontSize: 11,
    fontWeight: '600' as const,
    lineHeight: 16,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
} as const;

export const ANIMATION = {
  fast: 150,
  normal: 250,
  slow: 350,
} as const;

export const MEDICAL_DISCLAIMER = `MedGraph is for general wellness, fitness tracking, and record organization. It is not a medical device. MedGraph does not provide medical advice, diagnosis, or treatment. Always consult a physician.`;

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
