/**
 * Guava-flat design system — the ONE contract for the whole app.
 *
 * Method ("flat cards on stage"):
 * - STAGE is the only background. Never paint gradients, auras, dot grids,
 *   washes, or glows anywhere. If it isn't a flat fill, it doesn't ship.
 * - Every content block is a white CARD (radius 20, padding 20, NO shadow,
 *   NO border). Separation comes from the dark stage behind, not chrome.
 * - One typeface: Poppins. Two weights in practice (Regular / SemiBold),
 *   four sizes. Numbers that must align use tabular-nums.
 * - One CTA green. Functional hues (blue pill, pink heart…) live ONLY as
 *   small flat icons inside white cards — never as text, fills, or rails.
 * - Motion is functional only: press scale, streaming caret, heartbeat,
 *   typing dots. No entrance cascades, no perpetual decoration.
 */

export const FONT = {
  regular: 'Poppins-Regular',
  medium: 'Poppins-Medium',
  semi: 'Poppins-SemiBold',
  bold: 'Poppins-Bold',
} as const;

// ─── Color ───────────────────────────────────────────────────────────────────

export const GV = {
  /** The stage. Deep teal-green everywhere — the brand owns the background. */
  stage: '#0B4A3F',
  /** Cards, sheets, dock. Always pure white. */
  card: '#FFFFFF',
  /** Warm paper for cards on light stages — definition without heaviness. */
  paper: '#FFF9F1',
  /** Headings on white. */
  ink: '#14201D',
  /** Body copy on white. */
  body: '#3E4F4A',
  /** Secondary text on white. */
  muted: '#7A8B85',
  /** Hairlines and dividers on white. */
  line: '#E4EBE8',
  /** Soft fill for icon tiles / selected rows on white. */
  wash: '#EFF5F2',

  /** Primary CTA green — white text on it is 5.9:1. */
  cta: '#0B7A55',
  /** CTA pressed state. */
  ctaPressed: '#095F43',
  /** Bright teal — accents on the DARK stage only (never body text). */
  teal: '#4FD1C5',
  /** Muted text on the dark stage. */
  fog: '#A7B8B2',
  /** Hairlines on the dark stage. */
  stageline: '#223029',

  /** AI / assistant moments only (purple spark, like the reference). */
  violet: '#7C5CD6',
  /** Errors only. */
  danger: '#D64545',
  /** Pulse measure button only — the heart is red, everything else stays green. */
  pulse: '#D7263D',
  pulsePressed: '#A8162B',

  /** Functional icon hues — icons inside white cards ONLY. */
  fx: {
    blue: '#2B7DE9',
    pink: '#E5487B',
    green: '#1E9E6A',
    purple: '#9B6BC4',
    brown: '#A0714F',
    sky: '#3AA7E0',
    amber: '#E8862E',
  },
} as const;

// ─── Type (4 sizes, Poppins) ─────────────────────────────────────────────────

export const TYPE = {
  /** Screen titles, centered like the reference (24, SemiBold). */
  display: { fontFamily: FONT.semi, fontSize: 24, lineHeight: 30 },
  /** Card headings (18, SemiBold). */
  title: { fontFamily: FONT.semi, fontSize: 18, lineHeight: 24 },
  /** Body copy (15, Regular). */
  body: { fontFamily: FONT.regular, fontSize: 15, lineHeight: 22 },
  /** Hints, timestamps, meta (13, Regular). */
  caption: { fontFamily: FONT.regular, fontSize: 13, lineHeight: 18 },
  /** Buttons, chips, CTA labels (15–16, SemiBold). */
  button: { fontFamily: FONT.semi, fontSize: 16, lineHeight: 22 },
  chip: { fontFamily: FONT.semi, fontSize: 13, lineHeight: 18 },
} as const;

// ─── Spacing (8pt) ───────────────────────────────────────────────────────────

// Home margin law: every page follows the glass edge — 26px sides.
export const SPACE = {
  screenH: 26,
  cardPad: 20,
  cardGap: 12,
  sectionGap: 24,
  rCard: 20,
  rPill: 9999,
} as const;
