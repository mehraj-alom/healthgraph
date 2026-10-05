import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '@/context/AuthContext';
import { useAnatomy } from '@/context/AnatomyContext';
import type { Gender } from '@/services/anatomyDownload';
import { useProfilePhoto } from '@/hooks/useProfilePhoto';
import { useHabitTracker } from '@/hooks/useHabitTracker';
import { HabitGrid } from '@/screens/Settings/HabitGrid';
import { HealthConnectSection } from '@/screens/Settings/HealthConnectSection';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Input, NumberInput } from '@/components';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { LG } from '@/theme/liquidGlass';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import Entrance from '@/components/home/Entrance';
import { ExploreGlyph } from '@/components/home/ExploreGlyphs';
import { api } from '@/services/api';
import { getCachedPatientId } from '@/services/patientIdentity';
import { getOnboardingState, saveOnboardingSelections } from '@/db/queries/onboarding';
import { requestDataRefresh } from '@/services/dataRefresh';
import { deleteAccountCompletely, deleteAllHealthData } from '@/services/deletion';
import { deletionFailureMessage, isTimeoutLikeError } from '@/services/deletionContract';
import {
  DeleteConfirmSheet,
  type DeleteMode,
  type DeleteResult,
} from '@/components/DeleteConfirmSheet';
import type { PatientProfile, RootStackParamList } from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// ---------------------------------------------------------------------------
// 3D anatomy storage (device downloads, moved here from the 3D Body
// screen so that screen stays focused on the model).
// ---------------------------------------------------------------------------

function AnatomyStorageSection() {  const { maleStatus, femaleStatus, deleteGender } = useAnatomy();
  const [confirmDelete, setConfirmDelete] = useState<Gender | null>(null);

  const handleDelete = async (g: Gender) => {
    await deleteGender(g);
    setConfirmDelete(null);
  };

  return (
    <>
      <Text style={styles.sectionTitle}>Storage</Text>
      <View style={styles.storageBoxes}>
        {(['male', 'female'] as Gender[]).map((g) => {
          const status = g === 'male' ? maleStatus : femaleStatus;
          const label = g === 'male' ? 'Male' : 'Female';
          const installed = status.state === 'INSTALLED';
          return (
            <View key={g} style={styles.storageBox}>
              <Text style={styles.storageBoxLabel}>{label}</Text>
              <Text style={styles.menuRowSubtitle}>
                {installed ? 'Downloaded' : 'Not downloaded'}
              </Text>
              {installed ? (
                confirmDelete === g ? (
                  <View style={styles.storageBoxActions}>
                    <Pressable
                      style={styles.storageBoxBtn}
                      onPress={() => void handleDelete(g)}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${label} anatomy download`}
                    >
                      <Text style={styles.storageDeleteText}>Delete</Text>
                    </Pressable>
                    <Pressable
                      style={styles.storageBoxBtn}
                      onPress={() => setConfirmDelete(null)}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel deletion"
                    >
                      <Text style={styles.storageCancelText}>Cancel</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    style={styles.storageBoxBtn}
                    onPress={() => setConfirmDelete(g)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${label} anatomy download`}
                  >
                    <Text style={styles.storageDeleteText}>Delete</Text>
                  </Pressable>
                )
              ) : null}
            </View>
          );
        })}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const { user, userProfile, logout, refreshDisplayName } = useAuth();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);

  // --- Profile query (backend is source of truth) ---
  const profileQuery = useQuery<PatientProfile>({
    queryKey: ['profile'],
    queryFn: () => api.get<PatientProfile>('/api/v1/profile'),
    staleTime: 5 * 60 * 1000,
  });

  const profile = profileQuery.data;

  // --- Form state (initialized from backend) ---
  const [displayName, setDisplayName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [initialized, setInitialized] = useState(false);

  // Initialize form from backend profile
  useEffect(() => {
    if (profile && !initialized) {
      setDisplayName(profile.display_name ?? userProfile?.displayName ?? '');
      setPhoneNumber(profile.phone_number ?? '');
      setHeightCm(profile.height_cm != null ? String(profile.height_cm) : '');
      setWeightKg(profile.weight_kg != null ? String(profile.weight_kg) : '');
      setInitialized(true);
    } else if (!profile && userProfile?.displayName && !initialized) {
      setDisplayName(userProfile.displayName);
      setInitialized(true);
    }
  }, [profile, userProfile?.displayName, initialized]);

  // First-sync restore (new device): when the server holds preference
  // mirrors but this device has none stored, adopt them once. Local
  // selections always win afterwards (every save overwrites the mirror).
  const prefsRestored = useRef(false);
  useEffect(() => {
    if (prefsRestored.current || !profile) return;
    const serverGoals = Array.isArray(profile.goals) ? profile.goals : [];
    const serverFocus = Array.isArray(profile.focus) ? profile.focus : [];
    if (serverGoals.length === 0 && serverFocus.length === 0) return;
    prefsRestored.current = true;
    (async () => {
      try {
        const patientId = getCachedPatientId();
        if (!patientId) return;
        const local = await getOnboardingState(patientId).catch(() => null);
        const localEmpty =
          !local || (local.goals.length === 0 && local.focus.length === 0);
        if (!localEmpty) return;
        await saveOnboardingSelections(patientId, serverGoals, serverFocus);
        requestDataRefresh();
      } catch {
        // Restore is best-effort — the user can re-select in setup.
      }
    })();
  }, [profile]);
  // --- Save mutation (profile fields + device-owned preferences mirror) ---
  const saveMutation = useMutation({
    mutationFn: async () => {
      const fieldsSet: string[] = [];
      const payload: Record<string, unknown> = {};
      if (displayName.trim()) { payload.display_name = displayName.trim(); fieldsSet.push('display_name'); }
      if (phoneNumber.trim()) { payload.phone_number = phoneNumber.trim(); fieldsSet.push('phone_number'); }
      else { payload.phone_number = null; fieldsSet.push('phone_number'); }
      if (heightCm.trim()) {
        const val = parseFloat(heightCm);
        if (val > 0 && val < 300) { payload.height_cm = val; fieldsSet.push('height_cm'); }
      } else {
        payload.height_cm = null; fieldsSet.push('height_cm');
      }
      if (weightKg.trim()) {
        const val = parseFloat(weightKg);
        if (val > 0 && val < 500) { payload.weight_kg = val; fieldsSet.push('weight_kg'); }
      } else {
        payload.weight_kg = null; fieldsSet.push('weight_kg');
      }
      // Mirror the device-owned goals/focus so a new device restores them.
      // Last-write-wins from the device; explicit empty arrays clear it.
      try {
        const patientId = getCachedPatientId();
        if (patientId) {
          const local = await getOnboardingState(patientId).catch(() => null);
          payload.goals = local?.goals ?? [];
          payload.focus = local?.focus ?? [];
          fieldsSet.push('goals', 'focus');
        }
      } catch {
        // Preferences mirror is best-effort — profile fields still save.
      }
      console.log(`[Profile] PROFILE_SAVE_START fields=${fieldsSet.join(',')}`);
      const t0 = Date.now();
      return api.put<PatientProfile>('/api/v1/profile', payload).then((result) => {
        console.log(`[Profile] PROFILE_SAVE_RESPONSE ${Date.now() - t0}ms status=ok fields=${fieldsSet.join(',')}`);
        return result;
      });
    },
    onSuccess: (data) => {
      console.log('[Profile] PROFILE_SAVE_SUCCESS');
      queryClient.setQueryData(['profile'], data);
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      if (data.display_name?.trim()) {
        refreshDisplayName(data.display_name);
      }
      // Reset mutation state after brief success feedback
      setTimeout(() => saveMutation.reset(), 2000);
    },
    onError: (error: any) => {
      const status = error?.response?.status ?? 'network';
      console.error(`[Profile] PROFILE_SAVE_ERROR status=${status}`);
      Alert.alert('Error', 'Could not save profile. Please try again.');
    },
  });

  // --- Habit tracker (GitHub-style grid from real tracked rows) ---
  const habit = useHabitTracker();

  // --- Sign out ---
  const confirmSignOut = () => {
    if (signingOut) return;
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
    } catch (error) {
      console.error('[Settings] Sign out failed:', error);
      Alert.alert('Unable to sign out', 'We could not sign you out. Please try again.');
    } finally {
      setSigningOut(false);
    }
  };

  const email = userProfile?.email ?? user?.email ?? '';

  // --- Preferences (onboarding goals/focus, device-local) ---
  // (Health navigation lives in the profile drawer now; Settings keeps
  // profile fields, account actions, and deletion.)

  // --- Local-only photo (frontend preview — never uploaded) ---
  const { photoUri, savePhoto } = useProfilePhoto();
  const [pickingPhoto, setPickingPhoto] = useState(false);

  const pickPhoto = useCallback(async () => {
    if (pickingPhoto) return;
    setPickingPhoto(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: 'image/*',
        copyToCacheDirectory: true,
      });
      const uri = (res as { assets?: { uri: string }[]; uri?: string }).assets?.[0]?.uri
        ?? (res as { uri?: string }).uri;
      if (!res.canceled && uri) {
        await savePhoto(uri);
      }
    } catch {
      Alert.alert('Photo', 'Could not open the photo picker. Please try again.');
    } finally {
      setPickingPhoto(false);
    }
  }, [pickingPhoto, savePhoto]);

  // The photo is the whole control: tap to change, or remove when set.
  const onPhotoTap = useCallback(() => {
    if (pickingPhoto) return;
    if (!photoUri) {
      void pickPhoto();
      return;
    }
    Alert.alert('Profile photo', 'Change or remove your photo.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void savePhoto(null) },
      { text: 'Change photo', onPress: () => void pickPhoto() },
    ]);
  }, [pickingPhoto, photoUri, pickPhoto, savePhoto]);

  // --- Danger zone: real deletion flows (server first, then local wipe).
  // Double-submit is prevented twice: a synchronous ref (same-tick double
  // taps, which state cannot catch) plus the `deleting` state (re-renders).
  // Every failure path leaves existing data untouched. A 404 means the
  // deployed backend predates the erasure routes — reported as such, never
  // as a connection problem.
  // Destructive confirmation runs through DeleteConfirmSheet: exact DELETE
  // match + 20s countdown + explicit final tap. Timeouts reconcile via
  // idempotent retry instead of claiming "nothing was deleted".
  const [deleting, setDeleting] = useState<'data' | 'account' | null>(null);
  const deletingRef = useRef(false);
  const [sheetMode, setSheetMode] = useState<DeleteMode | null>(null);
  const [sheetResult, setSheetResult] = useState<DeleteResult | null>(null);

  const DATA_SCOPE = [
    'Daily logs and check-ins',
    'Medications and dose history',
    'Uploaded documents and extractions',
    'On-device caches and timeline',
  ];
  const ACCOUNT_SCOPE = [
    ...DATA_SCOPE,
    'Your profile and sign-in identity',
  ];

  const runDeleteData = useCallback(async () => {
    if (deleting || deletingRef.current) return;
    if (!getCachedPatientId()) {
      Alert.alert('Session expired', 'Please sign in again.');
      return;
    }
    deletingRef.current = true;
    setDeleting('data');
    try {
      const { report } = await deleteAllHealthData();
      queryClient.clear();
      setSheetResult(
        report.status === 'completed' ? { status: 'completed' } : { status: 'partial' },
      );
    } catch (error) {
      // Timeout-like failures must never claim "nothing was deleted": the
      // server may already have committed. Offer reconcile-and-retry
      // (the backend is idempotent, so retrying is safe).
      setSheetResult(
        isTimeoutLikeError(error)
          ? {
              status: 'failed',
              message:
                'The request timed out before confirming. Your data may ' +
                'already be deleted on the server.',
              retryable: true,
            }
          : {
              status: 'failed',
              message: deletionFailureMessage(error, 'data'),
              retryable: true,
            },
      );
    } finally {
      deletingRef.current = false;
      setDeleting(null);
    }
  }, [deleting, queryClient]);

  const openDeleteDataSheet = useCallback(() => {
    if (deleting) return;
    setSheetResult(null);
    setSheetMode('data');
  }, [deleting]);

  const runDeleteAccount = useCallback(async () => {
    if (deleting || deletingRef.current) return;
    if (!getCachedPatientId()) {
      Alert.alert('Session expired', 'Please sign in again.');
      return;
    }
    deletingRef.current = true;
    setDeleting('account');
    try {
      const { report } = await deleteAccountCompletely();
      await savePhoto(null);
      queryClient.clear();
      setSheetResult(
        report.status === 'completed' ? { status: 'completed' } : { status: 'partial' },
      );
    } catch (error) {
      setSheetResult(
        isTimeoutLikeError(error)
          ? {
              status: 'failed',
              message:
                'The request timed out before confirming. Your account may ' +
                'already be deleted on the server.',
              retryable: true,
            }
          : {
              status: 'failed',
              message: deletionFailureMessage(error, 'account'),
              retryable: true,
            },
      );
    } finally {
      deletingRef.current = false;
      setDeleting(null);
    }
  }, [deleting, queryClient, savePhoto]);

  const openDeleteAccountSheet = useCallback(() => {
    if (deleting) return;
    setSheetResult(null);
    setSheetMode('account');
  }, [deleting]);

  const closeSheet = useCallback(() => {
    // Account completed: leaving the sheet finishes sign-out, mirroring
    // the previous Done-button flow.
    if (
      sheetMode === 'account' &&
      sheetResult !== null &&
      sheetResult.status === 'completed'
    ) {
      setSheetMode(null);
      setSheetResult(null);
      logout().catch(() => {
        Alert.alert('Sign-out needed', 'Please sign out to finish.');
      });
      return;
    }
    setSheetMode(null);
    setSheetResult(null);
  }, [sheetMode, sheetResult, logout]);

  return (
    <View style={styles.screen}>
      <HomeStageBackdrop />
      <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Entrance index={0}>
          <View style={styles.heroBlock}>
            <Text style={styles.heroTitle}>Account</Text>
            <Text style={styles.heroSub} numberOfLines={1}>{email}</Text>
          </View>
        </Entrance>
        {/* ── Identity (photo + name only; tap photo to change) ── */}
        <Entrance index={1}>
        <GlassSurface strong style={styles.identityCard}>
          <View style={styles.identityRow}>
            <Pressable
              style={styles.identityAvatar}
              onPress={onPhotoTap}
              disabled={pickingPhoto}
              accessibilityRole="button"
              accessibilityLabel={photoUri ? 'Change or remove photo' : 'Add photo'}
            >
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.photoImage} />
              ) : (
                <Text style={styles.photoInitial}>
                  {(displayName || userProfile?.displayName || email || '?').charAt(0).toUpperCase()}
                </Text>
              )}
            </Pressable>
            <View style={styles.identityMeta}>
              <Text style={styles.identityName} numberOfLines={1}>
                {displayName || userProfile?.displayName || 'Your profile'}
              </Text>
            </View>
          </View>
        </GlassSurface>
        </Entrance>

        {/* ── Activity (habit tracker from real tracked rows) ── */}
        <Entrance index={2}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Activity</Text>
        </View>
        <HabitGrid
          weeks={habit.weeks}
          activeDays={habit.activeDays}
          totalActions={habit.totalActions}
          streakDays={habit.streakDays}
          isLoading={habit.isLoading}
        />
        </Entrance>

        {/* ── About You ── */}
        <Entrance index={3}>
        <Text style={styles.sectionTitle}>About you</Text>
        <GlassSurface strong style={styles.card}>
          <Input
            label="Name"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            style={styles.inputWell}
          />

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Email</Text>
            <Text style={styles.fieldValue}>{email}</Text>
          </View>

          <Input
            label="Phone (optional)"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            placeholder="+1 555 123 4567"
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            style={styles.inputWell}
          />

          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <NumberInput
                label="Height"
                unit="cm"
                value={heightCm}
                onChangeText={setHeightCm}
                placeholder="e.g. 175"
                style={styles.inputWell}
              />
            </View>
            <View style={styles.fieldHalf}>
              <NumberInput
                label="Weight"
                unit="kg"
                value={weightKg}
                onChangeText={setWeightKg}
                placeholder="e.g. 70"
                style={styles.inputWell}
              />
            </View>
          </View>
        </GlassSurface>
        </Entrance>

        {/* ── Preferences (deliberate-change shortcuts; home is the drawer) ── */}
        <Entrance index={4}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Preferences</Text>
        </View>
        <View style={styles.prefList}>
          <GlassSurface
            noBlur
            radius={20}
            style={styles.prefRow}
            onPress={() => navigation.navigate('OnboardingSetup')}
            accessibilityRole="button"
            accessibilityLabel="Edit goals and focus areas"
          >
            <View style={styles.prefGlyph}>
              <ExploreGlyph name="target" size={22} color="rgba(255,255,255,0.92)" />
            </View>
            <View style={styles.prefMain}>
              <Text style={styles.prefTitle} numberOfLines={1}>Goals & focus areas</Text>
              <Text style={styles.prefHint} numberOfLines={1}>Edit what matters</Text>
            </View>
            <Text style={styles.prefChevron}>›</Text>
          </GlassSurface>
          <GlassSurface
            noBlur
            radius={20}
            style={styles.prefRow}
            onPress={() => navigation.navigate('HealthAreas')}
            accessibilityRole="button"
            accessibilityLabel="View health areas"
          >
            <View style={styles.prefGlyph}>
              <ExploreGlyph name="heart" size={22} color="rgba(255,255,255,0.92)" />
            </View>
            <View style={styles.prefMain}>
              <Text style={styles.prefTitle} numberOfLines={1}>Health areas</Text>
              <Text style={styles.prefHint} numberOfLines={1}>Explore</Text>
            </View>
            <Text style={styles.prefChevron}>›</Text>
          </GlassSurface>
          <GlassSurface
            noBlur
            radius={20}
            style={styles.prefRow}
            onPress={() => navigation.navigate('Report')}
            accessibilityRole="button"
            accessibilityLabel="Generate doctor report PDF"
          >
            <View style={styles.prefGlyph}>
              <ExploreGlyph name="doc" size={22} color="rgba(255,255,255,0.92)" />
            </View>
            <View style={styles.prefMain}>
              <Text style={styles.prefTitle} numberOfLines={1}>Doctor report</Text>
              <Text style={styles.prefHint} numberOfLines={1}>30-day PDF</Text>
            </View>
            <Text style={styles.prefChevron}>›</Text>
          </GlassSurface>
        </View>
        </Entrance>

        {/* ── 3D anatomy downloads ── */}
        <Entrance index={5}>
          <AnatomyStorageSection />
        </Entrance>

        {/* ── Health Connect sync (sleep + workouts, explicit consent) ── */}
        <Entrance index={5}>
          <HealthConnectSection />
        </Entrance>

        {/* ── Account Section ── */}
        <Entrance index={6}>
        <Button
          title="Sign Out"
          fullWidth
          loading={signingOut}
          disabled={signingOut}
          onPress={confirmSignOut}
          style={styles.signOutBtn}
          textStyle={styles.signOutBtnText}
        />
        </Entrance>

        {/* ── Danger Zone (tap to open; real deletion flows) ── */}
        <Entrance index={6}>
        <Pressable
          onPress={() => setDangerOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: dangerOpen }}
          accessibilityLabel={dangerOpen ? 'Close danger zone' : 'Open danger zone'}
          style={styles.dangerHead}
        >
          <Text style={[styles.sectionTitle, styles.dangerTitle]}>Danger zone</Text>
          <Text style={styles.dangerChev}>{dangerOpen ? '▴' : '▾'}</Text>
        </Pressable>
        </Entrance>
        {dangerOpen ? (
        <GlassSurface strong tint={LG.card.danger} tintOpacity={0.10} style={styles.dangerCard}>
          <Pressable
            style={styles.dangerRow}
            onPress={openDeleteDataSheet}
            accessibilityRole="button"
            accessibilityLabel="Delete all my data"
          >
            <View style={styles.menuRowContent}>
              <Text style={styles.dangerRowTitle}>Delete all my data</Text>
              <Text style={styles.menuRowSubtitle}>
                Logs, medications, documents and caches
              </Text>
            </View>
            <Text style={styles.menuRowChevron}>›</Text>
          </Pressable>
          <View style={styles.dangerDivider} />
          <Pressable
            style={styles.dangerRow}
            onPress={openDeleteAccountSheet}
            accessibilityRole="button"
            accessibilityLabel="Delete account"
          >
            <View style={styles.menuRowContent}>
              <Text style={styles.dangerRowTitle}>Delete account</Text>
              <Text style={styles.menuRowSubtitle}>
                Profile and everything tied to it
              </Text>
            </View>
            <Text style={styles.menuRowChevron}>›</Text>
          </Pressable>
        </GlassSurface>
        ) : null}
      </ScrollView>
      <View style={styles.saveBar}>
        <Button
          title={saveMutation.isSuccess ? 'Saved' : saveMutation.isPending ? 'Saving' : 'Save'}
          onPress={() => saveMutation.mutate()}
          fullWidth
          loading={saveMutation.isPending}
          disabled={saveMutation.isPending}
        />
      </View>
      <DeleteConfirmSheet
        visible={sheetMode !== null}
        mode={sheetMode ?? 'data'}
        scopeLines={sheetMode === 'account' ? ACCOUNT_SCOPE : DATA_SCOPE}
        running={deleting !== null}
        result={sheetResult}
        onConfirm={() => {
          if (sheetMode === 'account') void runDeleteAccount();
          else void runDeleteData();
        }}
        onRetry={() => {
          if (sheetMode === 'account') void runDeleteAccount();
          else void runDeleteData();
        }}
        onClose={closeSheet}
      />
      </SafeAreaView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const NAVY = '#080A11';
const TILE_BG = '#2A3049';
const HAIRLINE_ON_NAVY = 'rgba(255, 255, 255, 0.12)';

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: LG.stage.bottom,
  },
  safe: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 26,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 16,
  },
  heroBlock: {
    paddingTop: 16,
    paddingBottom: 4,
    gap: 3,
  },
  heroTitle: {
    fontWeight: '600',
    fontSize: 34,
    lineHeight: 41,
    letterSpacing: -0.8,
    color: '#FFFFFF',
  },
  heroSub: {
    fontWeight: '400',
    fontSize: 17,
    lineHeight: 22,
    color: 'rgba(233,240,255,0.66)',
  },
  // Section headings carry no margins: the parent gap sets every
  // block apart, and sectionHead sets title-to-subtitle to exactly 4.
  sectionHead: {
    gap: 4,
  },
  sectionTitle: {
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.3,
    color: '#FFFFFF',
  },
  sectionSubtitle: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233,240,255,0.66)',
  },
  card: {
    gap: 16,
    padding: 20,
  },
  inputWell: {
    borderRadius: 8,
  },
  storageBoxes: {
    flexDirection: 'row',
    gap: 12,
  },
  // Static material tile (no live blur for small repeated tiles).
  storageBox: {
    flex: 1,
    backgroundColor: LG.card.fillStatic,
    borderColor: LG.card.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    gap: 4,
    alignItems: 'center',
  },
  storageBoxLabel: {
    fontWeight: '600',
    fontSize: 16,
    lineHeight: 22,
    color: '#FFFFFF',
  },
  storageBoxActions: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 4,
  },
  storageBoxBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  storageDeleteText: {
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 22,
    color: LG.card.danger,
  },
  storageCancelText: {
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(233,240,255,0.66)',
  },
  field: {
    gap: 8,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 16,
  },
  fieldHalf: {
    flex: 1,
  },
  fieldLabel: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233,240,255,0.66)',
  },
  fieldValue: {
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 22,
    color: '#FFFFFF',
    paddingVertical: 8,
  },
  saveButton: {
    marginTop: 0,
  },
  saveBar: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 8,
  },
  signOutBtn: {
    backgroundColor: '#FFFFFF',
  },
  signOutBtnText: {
    color: '#0B0F1A',
  },
  outlineBtn: {
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  outlineBtnText: {
    color: '#FFFFFF',
  },
  dangerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  dangerChev: {
    fontWeight: '600',
    fontSize: 18,
    lineHeight: 24,
    color: 'rgba(233,240,255,0.45)',
  },
  // Quiet preference rows: monochrome glyph + headline + hint.
  prefList: {
    gap: 12,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 68,
  },
  prefGlyph: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  prefMain: {
    flex: 1,
    gap: 2,
  },
  prefTitle: {
    fontWeight: '600',
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.1,
    color: '#FFFFFF',
  },
  prefHint: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233,240,255,0.66)',
  },
  prefChevron: {
    fontSize: 22,
    color: 'rgba(233,240,255,0.45)',
  },
  // Compact deliberate-change rows (small, quiet — the drawer's Health
  // section is their primary home).
  miniRows: {
    gap: 8,
  },
  miniTiles: {
    flexDirection: 'row',
    gap: 8,
  },
  miniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    minHeight: 44,
  },
  miniRowText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONT.regular,
    color: GV.fog,
  },
  miniRowChevron: {
    fontSize: 18,
    color: GV.fog,
    opacity: 0.7,
  },
  menuRowContent: {
    flex: 1,
  },
  menuRowSubtitle: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233,240,255,0.66)',
  },
  menuRowChevron: {
    fontWeight: '400',
    fontSize: 22,
    color: 'rgba(233,240,255,0.45)',
    marginLeft: 8,
  },
  identityCard: {
    padding: 16,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  identityAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  identityMeta: {
    flex: 1,
    gap: 2,
  },
  identityName: {
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
    color: '#FFFFFF',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoInitial: {
    fontWeight: '600',
    fontSize: 24,
    lineHeight: 30,
    color: '#FFFFFF',
  },
  dangerTitle: {
    color: LG.card.danger,
  },
  dangerCard: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
  },
  dangerRowTitle: {
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 22,
    color: LG.card.danger,
    marginBottom: 2,
  },
  dangerDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
});
