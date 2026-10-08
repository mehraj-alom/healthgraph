/**
 * PrescriptionReviewScreen — confirm-or-tweak review for scanned prescriptions.
 *
 * The backend extracts one form-ready row per medicine
 * (POST /api/v1/documents/:id/prescription-meds). Each card below shows the
 * row with its confidence badge; the user confirms per card (or all at
 * once) instead of retyping. "Edit" opens the full Add Medication form
 * pre-filled with the extracted row for minimal tweaks.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '@/types';
import {
  createMedicationFromExtract,
  fetchPrescriptionMeds,
  medSubtitle,
  type ExtractedMed,
} from '@/services/prescriptionMeds';
import { setScanStatus } from '@/db/queries/scanSessions';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { LG } from '@/theme/liquidGlass';
import { AddMedicationModal, type ExtractInitial } from './MedicationsScreen';

const SECONDARY = 'rgba(233,240,255,0.66)';
const TERTIARY = 'rgba(233,240,255,0.45)';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'PrescriptionReview'>;

type Phase = 'loading' | 'ready' | 'not-ready' | 'error' | 'empty';

export default function PrescriptionReviewScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const docIds = route.params?.docIds ?? [];
  const sessionId = route.params?.sessionId ?? null;

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [meds, setMeds] = useState<ExtractedMed[]>([]);
  const [header, setHeader] = useState<{ prescriber: string | null; prescriptionDate: string | null }>({
    prescriber: null,
    prescriptionDate: null,
  });
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [confirmAllBusy, setConfirmAllBusy] = useState(false);
  // Card being edited in the full form (keyed by index; null = closed).
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (docIds.length === 0) {
      setPhase('empty');
      return;
    }
    setPhase('loading');
    setErrorMsg(null);
    try {
      const settled = await Promise.allSettled(docIds.map((id) => fetchPrescriptionMeds(id)));
      const merged: ExtractedMed[] = [];
      let prescriber: string | null = null;
      let prescriptionDate: string | null = null;
      let notReady = false;
      for (const r of settled) {
        if (r.status !== 'fulfilled') {
          const status = (r.reason as { response?: { status?: number } })?.response?.status;
          if (status === 422) notReady = true;
          continue;
        }
        prescriber = prescriber ?? r.value.prescriber;
        prescriptionDate = prescriptionDate ?? r.value.prescription_date;
        merged.push(...r.value.medications);
      }
      if (merged.length === 0) {
        if (notReady) {
          setPhase('not-ready');
        } else {
          setPhase('empty');
        }
        return;
      }
      setMeds(merged);
      setHeader({ prescriber, prescriptionDate });
      setPhase('ready');
    } catch {
      setErrorMsg('Could not read the extracted medicines. Check your connection and try again.');
      setPhase('error');
    }
  }, [docIds]);

  useEffect(() => {
    void load();
  }, [load]);

  const markReviewed = useCallback(async () => {
    if (sessionId) {
      await setScanStatus(sessionId, 'reviewed').catch(() => {});
    }
  }, [sessionId]);

  const confirmOne = useCallback(async (index: number) => {
    const med = meds[index];
    if (!med || !med.name.trim()) {
      Alert.alert('Cannot add', 'This row has no medicine name — edit it first.');
      return;
    }
    setConfirming(true);
    try {
      await createMedicationFromExtract(med, { prescriber: header.prescriber });
      setDoneIds((prev) => new Set(prev).add(`${index}`));
    } catch {
      Alert.alert('Could not save', `Failed to save ${med.name || 'this medicine'}. Try again.`);
    } finally {
      setConfirming(false);
    }
  }, [meds, header.prescriber]);

  const confirmAll = useCallback(async () => {
    const pending = meds
      .map((m, i) => ({ m, i }))
      .filter(({ m, i }) => !doneIds.has(`${i}`) && m.name.trim());
    if (pending.length === 0) return;
    setConfirmAllBusy(true);
    let failures = 0;
    const done = new Set(doneIds);
    for (const { m, i } of pending) {
      try {
        await createMedicationFromExtract(m, { prescriber: header.prescriber });
        done.add(`${i}`);
      } catch {
        failures += 1;
      }
    }
    setDoneIds(new Set(done));
    setConfirmAllBusy(false);
    if (failures === 0) {
      await markReviewed();
      Alert.alert('All added', `${done.size} of ${meds.length} medicines saved to your list.`, [
        { text: 'Done', onPress: () => navigation.goBack() },
      ]);
    } else {
      Alert.alert('Partially saved', `${failures} medicine(s) failed — review the remaining rows.`);
    }
  }, [meds, doneIds, header.prescriber, markReviewed, navigation]);

  const editingMed = editingIndex != null ? meds[editingIndex] : null;

  return (
    <View style={styles.root}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Review prescription</Text>
          {(header.prescriber || header.prescriptionDate) && (
            <Text style={styles.sub}>
              {[header.prescriber, header.prescriptionDate].filter(Boolean).join(' · ')}
            </Text>
          )}

          {phase === 'loading' && (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={LG.card.mint} />
              <Text style={styles.body}>Reading medicines from your scan…</Text>
            </View>
          )}

          {phase === 'not-ready' && (
            <GlassSurface strong style={styles.stateCard}>
              <Text style={styles.title2}>Still reading your scan</Text>
              <Text style={styles.body}>The extraction is not finished yet. Wait a moment and retry.</Text>
              <Pressable
                style={styles.primaryBtn}
                onPress={() => void load()}
                accessibilityRole="button"
                accessibilityLabel="Retry reading the scan"
              >
                <Text style={styles.primaryTxt}>Retry</Text>
              </Pressable>
            </GlassSurface>
          )}

          {phase === 'error' && (
            <GlassSurface strong style={styles.stateCard}>
              <Text style={styles.title2}>Something went wrong</Text>
              <Text style={styles.body}>{errorMsg}</Text>
              <Pressable
                style={styles.primaryBtn}
                onPress={() => void load()}
                accessibilityRole="button"
                accessibilityLabel="Retry reading the scan"
              >
                <Text style={styles.primaryTxt}>Retry</Text>
              </Pressable>
            </GlassSurface>
          )}

          {phase === 'empty' && (
            <GlassSurface strong style={styles.stateCard}>
              <Text style={styles.title2}>No medicines found</Text>
              <Text style={styles.body}>The scan did not contain readable medicines. Try a clearer photo.</Text>
            </GlassSurface>
          )}

          {phase === 'ready' && (
            <>
              <Text style={styles.countLine}>
                {doneIds.size} of {meds.length} added
              </Text>
              {meds.map((med, i) => {
                const done = doneIds.has(`${i}`);
                return (
                  <GlassSurface
                    strong
                    noSheen
                    key={`${med.source_document_id}-${i}`}
                    style={[styles.card, done && styles.cardDone]}
                  >
                    <View style={styles.cardHead}>
                      <Text style={styles.medName}>{med.name || '(unnamed medicine)'}</Text>
                      {done ? (
                        <Text style={styles.doneBadge}>Added ✓</Text>
                      ) : med.needs_review ? (
                        <Text style={styles.reviewBadge}>Check</Text>
                      ) : (
                        <Text style={styles.confBadge}>{Math.round(med.confidence * 100)}%</Text>
                      )}
                    </View>
                    {!!medSubtitle(med) && <Text style={styles.medSub}>{medSubtitle(med)}</Text>}
                    {med.needs_review && med.review_reasons.length > 0 && (
                      <Text style={styles.reviewReasons}>{med.review_reasons.join(' · ')}</Text>
                    )}
                    {med.warnings.length > 0 && (
                      <Text style={styles.warnings}>⚠ {med.warnings.join('; ')}</Text>
                    )}
                    {!done && (
                      <View style={styles.cardActions}>
                        <Pressable
                          style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.7 }]}
                          onPress={() => setEditingIndex(i)}
                          accessibilityRole="button"
                          accessibilityLabel={`Edit ${med.name}`}
                        >
                          <Text style={styles.editTxt}>Edit</Text>
                        </Pressable>
                        <Pressable
                          style={({ pressed }) => [
                            styles.confirmBtn,
                            confirming && styles.btnDisabled,
                            pressed && !confirming && { opacity: 0.9 },
                          ]}
                          disabled={confirming}
                          onPress={() => void confirmOne(i)}
                          accessibilityRole="button"
                          accessibilityLabel={`Confirm ${med.name}`}
                        >
                          <Text style={styles.confirmTxt}>Confirm</Text>
                        </Pressable>
                      </View>
                    )}
                  </GlassSurface>
                );
              })}
              {doneIds.size < meds.length && (
                <Pressable
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    confirmAllBusy && styles.btnDisabled,
                    pressed && !confirmAllBusy && { opacity: 0.9 },
                  ]}
                  disabled={confirmAllBusy}
                  onPress={() => void confirmAll()}
                  accessibilityRole="button"
                  accessibilityLabel={`Confirm all, ${meds.length - doneIds.size} left`}
                >
                  <Text style={styles.primaryTxt}>
                    {confirmAllBusy ? 'Adding…' : `Confirm all (${meds.length - doneIds.size} left)`}
                  </Text>
                </Pressable>
              )}
            </>
          )}
        </ScrollView>

        {editingMed && (
          <AddMedicationModal
            key={`rx-edit-${editingIndex}`}
            visible
            medication={null}
            sourceDocumentIds={editingMed.source_document_id ? [editingMed.source_document_id] : docIds.slice(0, 1)}
            initialExtract={toFormShape(editingMed, header.prescriber)}
            onClose={() => setEditingIndex(null)}
            onSave={() => {
              if (editingIndex != null) setDoneIds((prev) => new Set(prev).add(`${editingIndex}`));
              setEditingIndex(null);
            }}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

/** Shape the Add form already understands (mirrors the Medication row). */
function toFormShape(med: ExtractedMed, prescriber: string | null): ExtractInitial {
  return {
    name: med.name,
    generic_name: med.generic_name,
    brand_name: med.brand_name,
    strength: med.strength,
    strength_unit: med.strength_unit,
    dose_amount: med.dose_amount,
    dose_unit: med.dose_unit,
    route: med.route,
    frequency: med.frequency,
    scheduled_times: med.scheduled_times,
    start_date: med.start_date,
    end_date: med.end_date,
    purpose: med.purpose,
    instructions: med.instructions,
    prescriber,
    prn: med.frequency === 'AS_NEEDED',
    reminder_enabled: med.scheduled_times.length > 0 && med.frequency !== 'AS_NEEDED',
    notes: med.warnings.length > 0 ? `Warnings on prescription: ${med.warnings.join('; ')}` : null,
    supply_quantity: med.supply_quantity,
    refills_left: med.refills_left,
  };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070F' },
  safe: { flex: 1 },
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  center: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  stateCard: { padding: 20, gap: 12, alignItems: 'stretch' },
  title: {
    fontWeight: '600',
    fontSize: 34,
    lineHeight: 41,
    letterSpacing: -0.8,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  title2: {
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.4,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  sub: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
  },
  body: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
  },
  countLine: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: LG.card.mint,
    fontVariant: ['tabular-nums'],
  },
  card: { padding: 16, gap: 6 },
  cardDone: { opacity: 0.55 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  medName: {
    fontWeight: '600',
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.2,
    color: '#FFFFFF',
    flex: 1,
  },
  medSub: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: SECONDARY, marginTop: 4 },
  reviewReasons: { fontWeight: '400', fontSize: 12, lineHeight: 16, color: '#F5B453', marginTop: 6 },
  warnings: { fontWeight: '400', fontSize: 12, lineHeight: 16, color: LG.card.danger, marginTop: 6 },
  confBadge: {
    fontWeight: '700',
    fontSize: 13,
    lineHeight: 18,
    color: LG.card.mint,
    fontVariant: ['tabular-nums'],
  },
  reviewBadge: {
    color: '#0B0F1A',
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: '#F5B453',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    overflow: 'hidden',
  },
  doneBadge: { fontWeight: '700', fontSize: 13, lineHeight: 18, color: LG.card.mint },
  cardActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  editBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 9999,
    paddingVertical: 10,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  editTxt: { fontWeight: '600', fontSize: 14, lineHeight: 20, color: SECONDARY },
  // Confirm is the prominent action: white pill, never flat teal.
  confirmBtn: {
    flex: 2,
    backgroundColor: '#FFFFFF',
    borderRadius: 9999,
    paddingVertical: 10,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  confirmTxt: { fontWeight: '600', fontSize: 14, lineHeight: 20, color: '#0B0F1A' },
  primaryBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 9999,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryTxt: { fontWeight: '600', fontSize: 15, lineHeight: 20, color: '#0B0F1A' },
  btnDisabled: { opacity: 0.5 },
});
