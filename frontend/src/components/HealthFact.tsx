/**
 * HealthFact — a rotating general wellness fact for loading screens.
 *
 * Waiting rooms read better with something to read: every content
 * loader in the app shows one of these under its spinner, rotating
 * every few seconds. Facts are general and descriptive only (sleep,
 * movement, water, daylight) — never advice, never diagnosis, never
 * treatment. Static when reduced motion is requested.
 */

import { useEffect, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useReducedMotion } from '@/theme/useReducedMotion';

export const HEALTH_FACTS: readonly string[] = [
  'Most adults sleep best with 7 to 9 hours a night.',
  'A brisk 10-minute walk still counts as activity.',
  'Resting heart rate is usually lowest in the morning.',
  'Consistency beats intensity for building habits.',
  'Thirst sometimes shows up as tiredness first.',
  'Muscles do most of their recovering while you sleep.',
  'Standing once an hour breaks up a long sit.',
  'Slow, steady breathing settles a busy mind.',
  'Morning daylight helps keep sleep timing steady.',
  'Energy dips in the early afternoon are normal.',
  'Gentle stretching keeps stiff joints comfortable.',
  'Tracking comes first; trends follow with time.',
  'Heart rate rises with movement and settles with rest.',
  'A regular bedtime matters as much as sleep length.',
];

const ROTATE_MS = 6000;

export function HealthFact({ style }: { style?: StyleProp<TextStyle> }) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(
    () => Math.floor(Math.random() * HEALTH_FACTS.length),
  );

  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % HEALTH_FACTS.length);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [reduced]);

  const fact = HEALTH_FACTS[index] ?? HEALTH_FACTS[0];
  return (
    <Text style={style} accessibilityLabel={`Health fact: ${fact}`}>
      {fact}
    </Text>
  );
}
