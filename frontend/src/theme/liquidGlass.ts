/**
 * liquidGlass — Apple Liquid Glass tokens for the Home functional layer.
 *
 * Follows `.agents/skills/apple_design_new/references/hig/liquid-glass.md`:
 * - Glass lives ONLY on the floating functional layer (nav bar, tab dock,
 *   sheets). Content cards stay opaque.
 * - Regular variant (text-heavy / busy backdrop): blur ~20-40px,
 *   ~60-80% opaque dark fill, hairline highlight, scroll-edge fade.
 * - Clear variant is reserved for controls over rich media (+35% black dim
 *   when the media is bright). Not used on Home.
 * - Reduce Transparency / Increase Contrast fall back to opaque fills.
 * - Motion is brief, transform/opacity-only, reduced-motion gated.
 *
 * Expo/React Native approximation via `expo-blur` BlurView + translucent
 * fill + 1px highlight. There is no true refraction outside SwiftUI
 * `glassEffect` — these numbers are practical starting points, not a spec.
 *
 * Home redesign adds the content-material block (`LG.card`): Apple keeps
 * Liquid Glass off content, but its *standard materials* are translucent
 * frosted surfaces — the closest RN approximation for the redesigned Home
 * cards, sitting on a rich aurora stage (`LG.stage`) so every surface has
 * color to pick up as it scrolls.
 */

export const LG = {
  /** Regular-variant blur for dark Home. */
  blurIntensity: 36,
  /** Translucent dark fill over the blur (~70% opaque). */
  fill: 'rgba(20,26,38,0.70)',
  /** Opaque fallback when Reduce Transparency / high contrast is on. */
  fillOpaque: '#141B29',
  /** Hairline highlight (top edge) + subtle border. */
  hairlineTop: 'rgba(255,255,255,0.22)',
  border: 'rgba(255,255,255,0.12)',
  /** Scroll-edge fade band where content meets a bar. */
  edgeFade: 'rgba(8,10,17,0.55)',
  /** Labels on glass stay monochrome for legibility. */
  label: '#FFFFFF',
  labelSecondary: 'rgba(255,255,255,0.72)',
  /** The ONE tinted primary action per view (pulse button). */
  accent: '#D7263D',
  accentPressed: '#A8162B',
  /** 35% black dim behind clear glass over bright media (Apple number). */
  dimBrightMedia: 'rgba(0,0,0,0.35)',
  /** Dock + nav geometry. */
  dockRadius: 28,
  navRadius: 22,
  /** Apple minimums: 44x44 default, 28x28 minimum on mobile. */
  targetDefault: 44,
  targetMinimum: 28,

  // ─── Home redesign: aurora stage + content material ─────────────────────
  stage: {
    /** Vertical base wash beneath the orbs. */
    top: '#0B1122',
    bottom: '#05070F',
    /** Soft color orbs the glass refracts as content scrolls over them. */
    orbTeal: '#135A4E',
    orbIndigo: '#26377A',
    orbPlum: '#3D2354',
    orbSky: '#10395F',
    /** Bottom vignette keeps the floating dock legible. */
    vignette: 'rgba(3,5,10,0.55)',
  },
  card: {
    /** Frosted content material (≈ iOS thin/regular material, dark). */
    blurIntensity: 26,
    fill: 'rgba(23,29,44,0.52)',
    /** Stronger wash for text-dense cards. */
    fillStrong: 'rgba(23,29,44,0.68)',
    /** Fill for small tiles that skip the blur (slightly more opaque). */
    fillStatic: 'rgba(23,29,44,0.64)',
    fillOpaque: '#151B29',
    border: 'rgba(255,255,255,0.13)',
    hairlineTop: 'rgba(255,255,255,0.20)',
    radius: 24,
    /** Icons / numerals on glass — brighter than body for 4.5:1 on any orb. */
    label: '#FFFFFF',
    labelSecondary: 'rgba(233,240,255,0.66)',
    labelTertiary: 'rgba(233,240,255,0.45)',
    /** Status mint on dark glass (≈9:1 — safe at caption sizes). */
    mint: '#5CE8B8',
    danger: '#FF8E8E',
  },
} as const;

/**
 * Apple-aligned type scale for Home (Poppins kept as the brand voice,
 * sizes/weights follow HIG minimums: default 17pt, minimum 11pt).
 * Numbers that must align use tabular-nums at the call site.
 */
export const lgType = {
  /** Nav large title — single job of the screen, one line. */
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' as const, letterSpacing: -0.5 },
  /** Section titles. */
  title: { fontSize: 20, lineHeight: 26, fontWeight: '600' as const, letterSpacing: -0.3 },
  /** Row headlines / button labels. */
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const, letterSpacing: -0.1 },
  /** Body copy — HIG default, never below 13 on Home. */
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' as const },
  bodySmall: { fontSize: 15, lineHeight: 20, fontWeight: '400' as const },
  /** Meta, timestamps. */
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  /** Categorical labels only — uppercase + tracked, never prose. */
  overline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
} as const;
