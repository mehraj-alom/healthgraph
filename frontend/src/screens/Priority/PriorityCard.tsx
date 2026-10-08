/**
 * PriorityCard — the user-facing Priority (post-Batch-6 layer).
 *
 * Renders the derived Priority entries (never hardcoded): selected
 * engine titles under a "YOUR PRIORITY" overline, or the honest empty
 * state when nothing is selected. Names only — engine metrics stay
 * inside their engines (composition, never duplication). 44pt+ press target.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GlassSurface } from '@/components/home/GlassSurface';
import { LG } from '@/theme/liquidGlass';
import type { PriorityEntry } from '@/screens/Priority/priorityLayer';

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

export function PriorityCard({
  entries,
  onPress,
  accessibilityLabel,
}: {
  entries: readonly PriorityEntry[];
  onPress: () => void;
  accessibilityLabel?: string;
}): React.JSX.Element {
  return (
    <GlassSurface
      noBlur
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? 'Open your priorities'}
      style={styles.card}
    >
      <View style={styles.row}>
        <View style={styles.main}>
          <Text style={styles.overline}>Your priority</Text>
          {entries.length === 0 ? (
            <>
              <Text style={styles.emptyTitle}>No priorities selected</Text>
              <Text style={styles.emptyBody}>
                Choose the health areas you&apos;d like to focus on.
              </Text>
              <Text style={styles.cta}>Set priorities ›</Text>
            </>
          ) : (
            <>
              {entries.map((entry) => (
                <Text key={entry.id} style={styles.name}>
                  {entry.title}
                </Text>
              ))}
            </>
          )}
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  main: { flex: 1, gap: 4 },
  overline: {
    fontWeight: '600',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: LG.card.mint,
  },
  name: { fontWeight: '600', fontSize: 16, lineHeight: 22, color: '#FFFFFF' },
  emptyTitle: { fontWeight: '600', fontSize: 16, lineHeight: 22, color: '#FFFFFF' },
  emptyBody: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY },
  cta: { fontWeight: '600', fontSize: 13, lineHeight: 18, color: LG.card.mint, marginTop: 4 },
  chevron: { fontSize: 24, color: TERTIARY },
});

export default PriorityCard;
