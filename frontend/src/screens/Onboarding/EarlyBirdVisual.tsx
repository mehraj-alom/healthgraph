import { StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';

import { FONT, GV, TYPE } from '@/theme/guava';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { Reveal } from '@/components/home/Reveal';

/**
 * EarlyBirdVisual — FOMO + belonging page for onboarding (page 4).
 * No fake countdown, no cure claim: first-100 early price + identity.
 * Same liquid-glass material as the rest of onboarding.
 */
export function EarlyBirdVisual({ active }: { active: boolean }) {
  const glassOff = useReducedMotion();
  return (
    <View key={active ? 'early-on' : 'early-off'} style={styles.wrap}>
      <View style={styles.card}>
        {glassOff ? (
          <View style={styles.solid} />
        ) : (
          <BlurView tint="dark" intensity={84} style={styles.fill} />
        )}
        <View style={styles.tint} />
        <View style={styles.content}>
          <Reveal delay={120}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>FIRST 100 · EARLY ACCESS</Text>
            </View>
          </Reveal>
          <Reveal delay={220}>
            <Text style={styles.title}>
              {'Be early.\n'}
              <Text style={styles.accent}>Be different.</Text>
            </Text>
          </Reveal>
          <Reveal delay={320}>
            <Text style={styles.sub}>
              Health people postpone. Early members lock €9 instead of €11 and
              shape what we build next.
            </Text>
          </Reveal>
          <View style={styles.priceRow}>
            <Reveal delay={420}>
              <View style={styles.priceBox}>
                <Text style={styles.struck}>€11/mo</Text>
                <Text style={styles.price}>€9</Text>
                <Text style={styles.per}>early members</Text>
              </View>
            </Reveal>
          </View>
          <View style={styles.rows}>
            {['Lock the early price', 'All 10 tools from day one', 'Vote on the roadmap'].map(
              (row, i) => (
                <Reveal key={row} delay={500 + i * 80}>
                  <View style={styles.row}>
                    <View style={styles.dot} />
                    <Text style={styles.rowText}>{row}</Text>
                  </View>
                </Reveal>
              ),
            )}
          </View>
          <Text style={styles.note}>
            Early pricing applies at launch. No charge today — subscriptions open soon.
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
  content: { padding: 20, gap: 12, alignItems: 'stretch' },
  badge: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  badgeText: {
    fontFamily: FONT.semi,
    fontSize: 11,
    letterSpacing: 1.5,
    color: '#0B4A3F',
  },
  title: {
    fontFamily: FONT.semi,
    fontSize: 32,
    lineHeight: 38,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  accent: { fontStyle: 'italic' },
  sub: { ...TYPE.body, color: 'rgba(255,255,255,0.78)', textAlign: 'center' },
  priceRow: { alignItems: 'center', marginTop: 2 },
  priceBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    paddingVertical: 12,
    paddingHorizontal: 28,
    gap: 2,
  },
  struck: {
    fontFamily: FONT.semi,
    fontSize: 13,
    color: GV.fog,
    textDecorationLine: 'line-through',
  },
  price: { fontFamily: FONT.bold, fontSize: 40, lineHeight: 44, color: '#FFFFFF' },
  per: { ...TYPE.caption, color: GV.teal },
  rows: { gap: 8, marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GV.teal },
  rowText: { ...TYPE.body, fontSize: 13.5, color: '#FFFFFF', flex: 1 },
  note: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
});
