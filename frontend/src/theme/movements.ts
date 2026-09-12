/**
 * movements.ts — exact "Movements+" design tokens extracted from the reference
 * screens (see skill: .opencode/skills/ui-skill/SKILL.md).
 *
 * These are the reference hex values verbatim. Do not substitute similar-looking
 * values. If a value is missing, derive from the closest token in this file.
 */

export const mv = {
  // ── Base surfaces ──
  surfaceWhite: '#FFFFFF',
  surfaceOffwhite: '#FAFAF8',
  surfaceDark: '#141B1C',
  surfaceDarkCard: '#1B2425',
  surfaceTealDeep: '#0B6852',

  // ── Accents ──
  accentLime: '#D9FF6E',
  accentLimeSoft: '#EAFFAA',
  accentCoral: '#F0A98A',
  accentCream: '#F5F5F0',

  // ── Text ──
  textOnLightPrimary: '#141414',
  textOnLightSecondary: '#8A8A8A',
  textOnDarkPrimary: '#FFFFFF',
  textOnDarkSecondary: 'rgba(255,255,255,0.6)',

  // ── Radii ──
  radiusCard: 30,
  radiusPill: 999,

  // ── Spacing ──
  spaceScreen: 20,
  spaceCard: 18,
  spaceStack: 13,
  spaceSideBySide: 12,
  spaceIconLabel: 7,
} as const;

/** Type scale — sizes/weights/tracking per the skill (tabular numerals for stats). */
export const mvType = {
  hero: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.32, lineHeight: 38 },
  statGiant: { fontSize: 36, fontWeight: '800' as const, letterSpacing: -1, lineHeight: 42 },
  statGiantSm: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.7, lineHeight: 34 },
  labelCard: { fontSize: 15, fontWeight: '600' as const, lineHeight: 20 },
  caption: { fontSize: 13, fontWeight: '500' as const, lineHeight: 18 },
  pill: { fontSize: 12, fontWeight: '600' as const, lineHeight: 16 },
  navTitle: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.2, lineHeight: 22 },
} as const;