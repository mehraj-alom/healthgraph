/**
 * dashboardApple — night instrument panel for the dashboard.
 *
 * Hallmark · genre: modern-minimal · feeling: calm confidence.
 * Formula copied from the best in class (Oura / Whoop teardowns), restrained
 * through Apple motion + type discipline:
 * - Deep green-charcoal canvas (never pure black), elevation by surface
 *   VALUE, not shadow. Instruments stay flat and precise.
 * - The number is the headline: giant light-weight scores (w300), small
 *   tracked uppercase labels (w700). Weight contrast, not weight volume.
 * - Color encodes DOMAIN, never emphasis. Each metric family owns one hue
 *   that follows it across dots, rings, and trend lines. Everything else is
 *   monochrome (white + cool greys).
 * - Verdicts speak only two words: teal (good / on-track) and soft coral
 *   (needs attention — never harsh red).
 * - One orchestrated mount entrance; press-down feedback on every control;
 *   all motion transform/opacity-only and reduced-motion gated.
 *
 * Token names are stable so all dashboard consumers keep working.
 */
export const AM = {
  // Canvas + stepped surfaces (elevation = value, not shadow)
  bg: '#0C1210',
  card: '#131A17',
  cardSunken: '#1A221E',
  track: '#232B26',
  // Ink scale (all body text lives here — never tinted hues)
  ink: '#FFFFFF',
  secondary: '#9BA39B',
  muted: '#7E877E',
  hairline: '#26302A',
  hairlineStrong: '#364038',
  // Primary CTA: neutral white pill, near-black text (chrome stays neutral)
  pill: '#FFFFFF',
  pillText: '#0B0B0F',
  // Press + overlay washes (white-on-dark feedback, dark scrim)
  press: 'rgba(255,255,255,0.08)',
  pressSoft: 'rgba(255,255,255,0.04)',
  scrim: 'rgba(0,0,0,0.65)',
  // Title-zone band: Movements+ tealDeep hero surface (exact token value).
  // The top-third viewing zone lives on this colour; everything below stays
  // on bg. One hero surface per screen — never reused for cards.
  zone: '#0B6852',
  // Verdict language (only two words)
  success: '#4FD1C5',
  successBg: 'rgba(79,209,197,0.16)',
  successBorder: 'rgba(79,209,197,0.35)',
  successBand: 'rgba(79,209,197,0.30)',
  successWash: 'rgba(79,209,197,0.08)',
  danger: '#E0746B',
  dangerBg: 'rgba(224,116,107,0.12)',
  dangerWash: 'rgba(224,116,107,0.12)',
  // Quiet white wash for healthy-zone bands on the dial (status reads from
  // position + coral flags, never from rainbow hues).
  bandWash: 'rgba(255,255,255,0.14)',
  radiusCard: 20,
  radiusPill: 999,
} as const;

/**
 * Domain hues — color as information. A metric's hue follows it across the
 * radial map, trend lines, and rings. Verdicts (good/bad) are NEVER new
 * hues: on-track renders in the domain hue, off-track in soft coral.
 */
export const DOMAINS = {
  sleep: '#7C6FF0',
  energy: '#F5A623',
  move: '#4FD1C5',
  fuel: '#6EC1E4',
  heart: '#F27E93',
  mind: '#B8A6E8',
  neutral: '#9A9AA5',
} as const;

/** Map a correlation stream id (or health dimension id) to its domain hue. */
export function domainHueForStream(id: string): string {
  const base = id.includes(':') ? id.slice(0, id.indexOf(':')) : id;
  switch (base) {
    case 'sleepDur':
    case 'sleepQual':
    case 'awakenings':
    case 'sleep':
      return DOMAINS.sleep;
    case 'energy':
      return DOMAINS.energy;
    case 'activity':
    case 'wellbeing':
    case 'doses':
      return DOMAINS.move;
    case 'water':
    case 'meals':
    case 'appetite':
      return DOMAINS.fuel;
    case 'hr':
    case 'heart':
    case 'vital':
      return DOMAINS.heart;
    case 'stress':
    case 'pain':
    case 'symptom':
      return DOMAINS.mind;
    default:
      return DOMAINS.neutral;
  }
}

export const amType = {
  /** Giant light score — the headline. Light weight reads as confidence. */
  score: {
    fontSize: 52,
    fontWeight: '300' as const,
    letterSpacing: -1,
    lineHeight: 56,
    fontVariant: ['tabular-nums'] as Array<'tabular-nums'>,
  },
  /** One UI display title — big, bold, bottom-anchored in the top zone. */
  display: {
    fontSize: 36,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
    lineHeight: 42,
  },
  /** Screen + section titles. */
  hero: {
    fontSize: 26,
    fontWeight: '700' as const,
    letterSpacing: -0.4,
    lineHeight: 32,
  },
  title: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.1, lineHeight: 22 },
  body: { fontSize: 13, fontWeight: '400' as const, lineHeight: 19 },
  bodyStrong: { fontSize: 13, fontWeight: '600' as const, lineHeight: 19 },
  /** Categorical labels — uppercase, tracked, never prose. */
  overline: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.8,
    lineHeight: 14,
    textTransform: 'uppercase' as const,
  },
  metric: {
    fontSize: 22,
    fontWeight: '600' as const,
    letterSpacing: -0.2,
    lineHeight: 26,
    fontVariant: ['tabular-nums'] as Array<'tabular-nums'>,
  },
} as const;

/** Elevation on dark canvas = surface value; only sheets keep a soft shadow. */
export const amShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.4,
  shadowRadius: 24,
  elevation: 6,
} as const;
