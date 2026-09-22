/**
 * DoneStep — onboarding completion summary (peak-end moment).
 *
 * Reflects the user's own selections back with calm copy, then hands off to
 * the dashboard. No scores, no grades, no medical claims.
 */

import { StyleSheet, Text, View } from 'react-native';
import { Reveal } from '@/components/home/Reveal';
import { FONT, GV, TYPE } from '@/theme/guava';
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
  return (
    <View style={styles.wrap}>
      <Reveal>
        <Text style={styles.overline}>Done</Text>
      </Reveal>
      <Reveal>
        <Text style={styles.headline}>Setup complete.</Text>
      </Reveal>
      <Reveal>
        <Text style={styles.sub}>
          {picked.length > 0
            ? `Selected: ${picked.slice(0, 4).join(' · ')}${picked.length > 4 ? ' · …' : ''}`
            : 'You can set goals anytime.'}
        </Text>
      </Reveal>
      <Reveal>
        <Text style={styles.note}>
          Your dashboard, measurements, and timeline are ready.
        </Text>
      </Reveal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    gap: 12,
    paddingTop: 8,
    justifyContent: 'center',
  },
  overline: {
    fontFamily: FONT.semi,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 3,
    color: GV.teal,
    textAlign: 'center',
  },
  headline: {
    fontFamily: FONT.semi,
    fontSize: 32,
    lineHeight: 38,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  sub: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
    maxWidth: 330,
    alignSelf: 'center',
  },
  note: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    alignSelf: 'center',
  },
});
