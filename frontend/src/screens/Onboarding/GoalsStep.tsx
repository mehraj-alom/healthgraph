/**
 * GoalsStep — onboarding personalization step 1 (multi-select, optional).
 *
 * Tappable selections (never manual input) per the design skill; skipping is
 * always allowed. Copy uses neutral wellness language — preferences, never
 * diagnoses.
 */

import { StyleSheet, Text, View } from 'react-native';
import { Chip } from '@/components';
import { Reveal } from '@/components/home/Reveal';
import { FONT, GV, TYPE } from '@/theme/guava';
import { HEALTH_GOALS } from './options';

export function GoalsStep({
  selected,
  onToggle,
}: {
  selected: readonly string[];
  onToggle: (id: string) => void;
}) {
  return (
    <View style={styles.wrap}>
      <Reveal>
        <Text style={styles.overline}>Step 1 of 3 · Goals</Text>
      </Reveal>
      <Reveal>
        <Text style={styles.headline}>Select your goals.</Text>
      </Reveal>
      <Reveal>
        <Text style={styles.sub}>
          Pick goals. You can change them anytime.
        </Text>
      </Reveal>
      <View style={styles.chips} accessibilityRole="list">
        {HEALTH_GOALS.map((goal) => {
          const active = selected.includes(goal.id);
          return (
            <Chip
              key={goal.id}
              label={goal.label}
              selected={active}
              onPress={() => onToggle(goal.id)}
              size="large"
              color={GV.cta}
              accessibilityLabel={`${goal.label}. ${goal.hint}`}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    gap: 12,
    paddingTop: 8,
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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
});
