/**
 * DemoBanner — persistent sandbox marker with one-tap exit.
 *
 * Rendered above the navigator while a demo session is active. The copy
 * never promises sync or backup: sample data lives on this phone and dies
 * with the session.
 */
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { exitDemoMode } from '@/services/demoSession';

export function DemoBanner() {
  const insets = useSafeAreaInsets();

  const confirmExit = () => {
    Alert.alert(
      'Exit demo mode?',
      'All sample data is wiped from this phone. Nothing was ever synced.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Exit + wipe',
          style: 'destructive',
          onPress: () => {
            void exitDemoMode();
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <Text style={styles.text}>Demo mode · sample data · nothing leaves this phone</Text>
      <Pressable
        onPress={confirmExit}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Exit demo mode and wipe sample data"
        style={styles.exit}
      >
        <Text style={styles.exitText}>Exit</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: '#3A2E12',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(240, 169, 46, 0.4)',
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  text: {
    flex: 1,
    color: '#F0A92E',
    fontSize: 13,
    fontWeight: '600',
  },
  exit: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(240, 169, 46, 0.6)',
  },
  exitText: {
    color: '#F0A92E',
    fontSize: 13,
    fontWeight: '700',
  },
});
