/**
 * FocusStep — onboarding personalization step 2 (multi-select, optional).
 *
 * Areas to improve or monitor, framed in neutral wellness language ("areas
 * of attention", never conditions or diagnoses). Skipping is allowed.
 */

import { StyleSheet, Text, View } from 'react-native';
import { Chip } from '@/components';
import { Reveal } from '@/components/home/Reveal';
import { FONT, GV, TYPE } from '@/theme/guava';
import { FOCUS_AREAS } from './options';

export function FocusStep({
  selected,
  onToggle,
}: {
  selected: readonly string[];
  onToggle: (id: string) => void;
}) {
  return (
    <View style={styles.wrap}>
      <Reveal>
        <Text style={styles.overline}>Step 2 of 3 · Focus</Text>
      </Reveal>
      <Reveal>
        <Text style={styles.headline}>What would you like to focus on?</Text>
      </Reveal>
      <Reveal>
        <Text style={styles.sub}>
          Choose one or more areas. Each one activates its engine.
        </Text>
      </Reveal>
      <View style={styles.chips} accessibilityRole="list">
        {FOCUS_AREAS.map((area) => {
          const active = selected.includes(area.id);
          return (
            <Chip
              key={area.id}
              label={area.label}
              selected={active}
              onPress={() => onToggle(area.id)}
              size="large"
              color={GV.cta}
              accessibilityLabel={`${area.label}. ${area.hint}`}
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
