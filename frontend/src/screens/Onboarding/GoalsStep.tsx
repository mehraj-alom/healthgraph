/**
 * GoalsStep — onboarding personalization step 1 (multi-select, optional).
 *
 * Tappable selections (never manual input) per the design skill; skipping is
 * always allowed. Copy uses neutral wellness language — preferences, never
 * diagnoses.
 */

import { StyleSheet, Text, View } from 'react-native';
import { Reveal } from '@/components/home/Reveal';
import { FONT, GV, TYPE } from '@/theme/guava';
import { HEALTH_GOALS } from './options';
import { FocusTile } from './FocusStep';

export function GoalsStep({
  selected,
  onToggle,
}: {
  selected: readonly string[];
  onToggle: (id: string) => void;
}) {
  const rows: typeof HEALTH_GOALS[] = [];
  for (let i = 0; i < HEALTH_GOALS.length; i += 2) {
    rows.push(HEALTH_GOALS.slice(i, i + 2));
  }
  return (
    <View style={styles.wrap}>
      <Reveal>
        <Text style={styles.headline}>What matters most?</Text>
      </Reveal>
      <Reveal>
        <Text style={styles.sub}>
          Pick as many as you like.
        </Text>
      </Reveal>
      <View style={styles.grid} accessibilityRole="list">
        {rows.map((row, r) => (
          <View key={r} style={styles.row}>
            {row.map(goal => (
              <FocusTile
                key={goal.id}
                id={goal.id}
                label={goal.label}
                hint={goal.hint}
                active={selected.includes(goal.id)}
                onToggle={() => onToggle(goal.id)}
                fullWidth={row.length === 1}
              />
            ))}
          </View>
        ))}
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
    alignSelf: 'center',
  },
  grid: {
    gap: 12,
    marginTop: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
});
