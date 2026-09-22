/**
 * PriorityCard — the user-facing Priority (post-Batch-6 layer).
 *
 * Renders the derived Priority entries (never hardcoded): selected
 * engine titles under a "YOUR PRIORITY" overline, or the honest empty
 * state when nothing is selected. Names only — engine metrics stay
 * inside their engines (composition, never duplication). Guava tokens,
 * 44pt+ press target.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import type { PriorityEntry } from '@/screens/Priority/priorityLayer';

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
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? 'Open your priorities'}
      hitSlop={8}
    >
      <Card>
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
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  main: { flex: 1, gap: 4 },
  overline: {
    fontFamily: FONT.semi,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 3,
    color: GV.teal,
  },
  name: { ...TYPE.button, fontSize: 16, color: GV.ink },
  emptyTitle: { ...TYPE.button, fontSize: 16, color: GV.ink },
  emptyBody: { ...TYPE.caption, color: GV.body },
  cta: { ...TYPE.chip, color: GV.cta, marginTop: 4 },
  chevron: { fontSize: 24, color: GV.fog },
});

export default PriorityCard;
