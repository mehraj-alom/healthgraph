import { StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';

import { FONT, GV, TYPE } from '@/theme/guava';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { Reveal } from '@/components/home/Reveal';

const ROWS = [
  'Meds + reminders',
  'Pulse (finger + face)',
  'Food scan + nutrition',
  'Voice journal + check-in',
  'Documents + timeline',
  '3D body + graph',
  'Sleep, weight, fitness',
  'Insights + doctor PDF',
];

/**
 * ValueStackVisual — "10 apps in one" glass card for onboarding page 3.
 * Same liquid-glass material as auth/pricing: blur + brand tint + hairline.
 * Price comparison is an illustration, never a competitor quote.
 */
export function ValueStackVisual({ active }: { active: boolean }) {
  const glassOff = useReducedMotion();
  return (
    <View key={active ? 'value-on' : 'value-off'} style={styles.wrap}>
      <View style={styles.card}>
        {glassOff ? (
          <View style={styles.solid} />
        ) : (
          <BlurView tint="dark" intensity={84} style={styles.fill} />
        )}
        <View style={styles.tint} />
        <View style={styles.content}>
          <Reveal delay={120}>
            <Text style={styles.overline}>10 TOOLS · ONE APP</Text>
          </Reveal>
          <Reveal delay={220}>
            <Text style={styles.title}>
              {'10 apps in one.\n'}
              <Text style={styles.accent}>One price.</Text>
            </Text>
          </Reveal>
          <View style={styles.grid}>
            {ROWS.map((row, i) => (
              <Reveal key={row} delay={300 + i * 60}>
                <View style={styles.row}>
                  <View style={styles.check}>
                    <Text style={styles.tick}>✓</Text>
                  </View>
                  <Text style={styles.rowText}>{row}</Text>
                </View>
              </Reveal>
            ))}
          </View>
          <Reveal delay={820}>
            <View style={styles.priceRow}>
              <Text style={styles.oldPrice}>~€120/mo separate</Text>
              <Text style={styles.newPrice}>€11/mo all-in</Text>
            </View>
          </Reveal>
          <Text style={styles.note}>
            Illustration of separate-app costs. Plans renew monthly, cancel anytime.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  card: {
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  fill: { ...StyleSheet.absoluteFill },
  solid: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(255,255,255,0.08)' },
  tint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(11, 74, 63, 0.62)',
  },
  content: { padding: 20, gap: 12 },
  overline: {
    fontFamily: FONT.semi,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 3,
    color: GV.teal,
    textAlign: 'center',
  },
  title: {
    fontFamily: FONT.semi,
    fontSize: 30,
    lineHeight: 36,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  accent: { fontStyle: 'italic' },
  grid: { gap: 8, marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GV.teal,
  },
  tick: { color: '#0B4A3F', fontSize: 13, fontWeight: '700' },
  rowText: { ...TYPE.body, fontSize: 13.5, color: '#FFFFFF', flex: 1 },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 10,
    marginTop: 4,
  },
  oldPrice: {
    fontFamily: FONT.semi,
    fontSize: 13,
    color: GV.fog,
    textDecorationLine: 'line-through',
  },
  newPrice: { fontFamily: FONT.bold, fontSize: 22, color: '#FFFFFF' },
  note: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
});
