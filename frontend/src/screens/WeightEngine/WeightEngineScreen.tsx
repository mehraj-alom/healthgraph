/**
 * WeightEngineScreen — the Weight goal engine (Batch 6C).
 *
 * A shell around the only real weight source: the profile weight. Shows
 * the recorded value with honest provenance, or an honest empty state.
 * No trend (one value has no baseline), no change line, no history, no
 * period switcher — those appear only when weight logging exists. Copy is
 * descriptive ("See your weight as recorded") — never causal, never
 * medical, never a target or prediction.
 */

import { useCallback } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, Card, EmptyState, SectionHeader } from '@/components';
import { HealthFact } from '@/components/HealthFact';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { StageGradient } from '@/components/StageGradient';
import { useWeightEngine } from '@/hooks/useWeightEngine';
import { formatWeightKg } from '@/screens/WeightEngine/weightEngine';

export default function WeightEngineScreen() {
  const navigation = useNavigation();
  const { model, isLoading } = useWeightEngine();

  const goSettings = useCallback(() => {
    const nav = navigation as unknown as {
      navigate: (route: string) => void;
    };
    nav.navigate('Settings');
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StageGradient />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={() => navigation.canGoBack() && navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
          style={styles.backHit}
        >
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.overline}>Weight engine · From your profile</Text>
        <Text style={styles.title}>Weight</Text>
        <Text style={styles.sub}>
          See your weight as recorded in your profile.
        </Text>

        {isLoading ? (
          <>
            <Text style={styles.loading}>Loading…</Text>
            <HealthFact style={styles.fact} />
          </>
        ) : model.weightKg === null ? (
          <EmptyState
            icon="⚖️"
            title="No weight recorded yet"
            message="Weight tracking isn't connected yet. You can record your weight in your profile. Trends and history will appear here once weight logging exists."
          />
        ) : (
          <>
            <SectionHeader title="Current" />
            <Card>
              <Text style={styles.value}>{formatWeightKg(model.weightKg)}</Text>
              <Text style={styles.provenance}>{model.provenance}</Text>
            </Card>

            <SectionHeader title="Tracking" />
            <Card>
              <Text style={styles.trackingBody}>
                Weight tracking isn't connected yet. Trends and history will appear here once weight logging exists. Only from real entries.
              </Text>
            </Card>
          </>
        )}

        <Button title="Open profile in Settings" onPress={goSettings} fullWidth />
        <Text style={styles.disclaimer}>
          From your profile on this device. Tracking only — not medical advice, diagnosis, or treatment.
        </Text>

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: GV.stage },
  content: { paddingHorizontal: SPACE.screenH, paddingVertical: SPACE.sectionGap, paddingBottom: 32, gap: 12 },
  backHit: { minHeight: 44, justifyContent: 'center' },
  backText: { ...TYPE.button, fontSize: 16, color: GV.fog },
  overline: { fontFamily: FONT.semi, fontSize: 12, lineHeight: 16, letterSpacing: 3, color: GV.teal, textAlign: 'center' },
  title: { ...TYPE.display, color: GV.card, textAlign: 'center' },
  sub: { ...TYPE.body, color: GV.fog, textAlign: 'center' },
  loading: { ...TYPE.body, color: GV.fog, textAlign: 'center', marginTop: 16 },
  fact: { ...TYPE.caption, color: GV.fog, textAlign: 'center', marginTop: 8 },
  value: { ...TYPE.display, fontSize: 40, color: GV.ink, textAlign: 'center', fontVariant: ['tabular-nums'] },
  provenance: { ...TYPE.caption, color: GV.muted, textAlign: 'center', marginTop: 4 },
  trackingBody: { ...TYPE.body, color: GV.body, textAlign: 'center' },
  disclaimer: { ...TYPE.caption, color: GV.fog, textAlign: 'center' },
  bottomPad: { height: 8 },
});
