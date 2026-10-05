/**
 * DoneStep — onboarding completion summary (peak-end moment).
 *
 * Reflects the user's own selections back with calm copy, then hands off to
 * the dashboard. No scores, no grades, no medical claims.
 */

import { StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Reveal } from '@/components/home/Reveal';
import { FONT, GV, TYPE } from '@/theme/guava';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { FOCUS_AREAS, HEALTH_GOALS } from './options';

function labelsFor(ids: readonly string[]): string[] {
  const byId = new Map(
    [...HEALTH_GOALS, ...FOCUS_AREAS].map((o) => [o.id, o.label] as const),
  );
  return ids
    .map((id) => byId.get(id))
    .filter((label): label is string => label !== undefined);
}

export function DoneStep({
  goals,
  focus,
}: {
  goals: readonly string[];
  focus: readonly string[];
}) {
  const picked = labelsFor([...goals, ...focus]);
  const glassOff = useReducedMotion();
  return (
    <View style={styles.wrap}>
      <View style={styles.glass}>
        {glassOff ? (
          <View style={styles.glassSolid} />
        ) : (
          <BlurView tint="dark" intensity={70} style={styles.glassFill} />
        )}
        <View style={styles.glassTint} />
        <View style={styles.glassContent}>
          <Reveal>
            <View style={styles.check}>
              <Text style={styles.checkGlyph}>✓</Text>
            </View>
          </Reveal>
          <Reveal>
            <Text style={styles.headline}>You're all set.</Text>
          </Reveal>
          <Reveal>
            <Text style={styles.sub}>
              {picked.length > 0
                ? `${picked.slice(0, 4).join(' · ')}${picked.length > 4 ? ' · …' : ''}`
                : 'You can set goals anytime.'}
            </Text>
          </Reveal>
          <Reveal>
            <Text style={styles.note}>
              Your dashboard is ready.
            </Text>
          </Reveal>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: 8,
  },
  // Liquid-glass completion panel (sidebar material, centered).
  glass: {
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  glassFill: {
    ...StyleSheet.absoluteFill,
  },
  glassTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(14, 19, 31, 0.5)',
  },
  glassSolid: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  glassContent: {
    padding: 24,
    gap: 10,
    alignItems: 'center',
  },
  check: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#5CE8B8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkGlyph: {
    color: '#07301F',
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 32,
  },
  headline: {
    fontWeight: '600',
    fontSize: 32,
    lineHeight: 38,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.6,
  },
  sub: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: 'rgba(233, 240, 255, 0.66)',
    textAlign: 'center',
    maxWidth: 330,
    alignSelf: 'center',
  },
  note: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233, 240, 255, 0.55)',
    textAlign: 'center',
    alignSelf: 'center',
  },
});
