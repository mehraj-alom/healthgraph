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
import { useProfilePhoto } from '@/hooks/useProfilePhoto';
import { useHabitTracker } from '@/hooks/useHabitTracker';
import { HabitGrid } from '@/screens/Settings/HabitGrid';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Input, NumberInput } from '@/components';
import { MarkerHighlight } from '@/components/MarkerHighlight';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { StageGradient } from '@/components/StageGradient';
import { api } from '@/services/api';
import { getCachedPatientId } from '@/services/patientIdentity';
import { getOnboardingState, saveOnboardingSelections } from '@/db/queries/onboarding';
import { requestDataRefresh } from '@/services/dataRefresh';
import { deleteAccountCompletely, deleteAllHealthData } from '@/services/deletion';
import { deletionFailureMessage } from '@/services/deletionContract';
import type { PatientProfile, RootStackParamList } from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const { user, userProfile, logout, refreshDisplayName } = useAuth();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);

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

  // --- Danger zone: real deletion flows (server first, then local wipe).
  // Double-submit is prevented twice: a synchronous ref (same-tick double
  // taps, which state cannot catch) plus the `deleting` state (re-renders).
  // Every failure path leaves existing data untouched. A 404 means the
  // deployed backend predates the erasure routes — reported as such, never
  // as a connection problem.
  const [deleting, setDeleting] = useState<'data' | 'account' | null>(null);
  const deletingRef = useRef(false);

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
      if (report.status === 'completed') {
        Alert.alert(
          'Data deleted',
          'All health records were removed from your account and this device.',
        );
      } else {
        Alert.alert(
          'Partially deleted',
          'Your records were removed, but some background systems need another pass. ' +
            'Please try again in a little while to finish.',
        );
      }
    } catch (error) {
      Alert.alert('Could not delete data', deletionFailureMessage(error, 'data'));
    } finally {
      deletingRef.current = false;
      setDeleting(null);
    }
  }, [deleting, queryClient]);

  const confirmDeleteData = useCallback(() => {
    if (deleting) return;
    Alert.alert(
      'Delete all my data?',
      'This removes daily logs, medications, documents and cached health data ' +
        'from this device and your account. Your profile stays. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () =>
            Alert.alert('Final confirmation', 'Permanently delete all health data?', [
              { text: 'Back', style: 'cancel' },
              {
                text: 'Delete everything',
                style: 'destructive',
                onPress: () => void runDeleteData(),
              },
            ]),
        },
      ],
    );
  }, [deleting, runDeleteData]);

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
      if (report.status === 'completed') {
        Alert.alert('Account deleted', 'Your account and all data were removed.', [
          {
            text: 'Done',
            onPress: () => {
              logout().catch(() => {
                Alert.alert('Sign-out needed', 'Please sign out to finish.');
              });
            },
          },
        ]);
      } else {
        Alert.alert(
          'Partially deleted',
          'Your account removal needs another pass to finish background systems. ' +
            'Please try again in a little while. Your session stays active until it completes.',
        );
      }
    } catch (error) {
      Alert.alert('Could not delete account', deletionFailureMessage(error, 'account'));
    } finally {
      deletingRef.current = false;
      setDeleting(null);
    }
  }, [deleting, queryClient, logout, savePhoto]);

  const confirmDeleteAccount = useCallback(() => {
    if (deleting) return;
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account, profile and all health data. ' +
        'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () =>
            Alert.alert('Final confirmation', 'Permanently delete your account?', [
              { text: 'Back', style: 'cancel' },
              {
                text: 'Delete account',
                style: 'destructive',
                onPress: () => void runDeleteAccount(),
              },
            ]),
        },
      ],
    );
  }, [deleting, runDeleteAccount]);

  return (
    <SafeAreaView style={styles.container}>
      <StageGradient />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Identity (local photo + account name) ── */}
        <Card padding="sm" level={1} style={styles.identityCard}>
          <View style={styles.identityRow}>
            <Pressable
              style={styles.identityAvatar}
              onPress={() => void pickPhoto()}
              accessibilityRole="button"
              accessibilityLabel="Change profile photo"
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
              {email ? <Text style={styles.identityEmail} numberOfLines={1}>{email}</Text> : null}
            </View>
          </View>
          <View style={styles.identityDivider} />
          <View style={styles.identityActions}>
            <Pressable
              style={styles.identityBtn}
              onPress={() => void pickPhoto()}
              disabled={pickingPhoto}
              accessibilityRole="button"
              accessibilityLabel={photoUri ? 'Change photo' : 'Add photo'}
            >
              <Text style={styles.identityBtnPrimary}>
                {pickingPhoto ? 'Opening…' : photoUri ? 'Change photo' : 'Add photo'}
              </Text>
            </Pressable>
            {photoUri ? (
              <Pressable
                style={styles.identityBtn}
                onPress={() => void savePhoto(null)}
                accessibilityRole="button"
                accessibilityLabel="Remove photo"
              >
                <Text style={styles.identityBtnQuiet}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        </Card>

        {/* ── Activity (habit tracker from real tracked rows) ── */}
        <View style={styles.sectionHead}>
          <MarkerHighlight textStyle={styles.sectionTitle}>Activity</MarkerHighlight>
          <Text style={styles.sectionSubtitle}>
            Every square is a real tracked day.
          </Text>
        </View>
        <HabitGrid
          weeks={habit.weeks}
          activeDays={habit.activeDays}
          totalActions={habit.totalActions}
          streakDays={habit.streakDays}
          isLoading={habit.isLoading}
        />

        {/* ── Profile Section ── */}
        <MarkerHighlight textStyle={styles.sectionTitle}>Profile</MarkerHighlight>
        <Card padding="lg" level={1} style={styles.card}>
          <Input
            label="Name"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
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
          />
        </Card>

        {/* ── Health Profile Section ── */}
        <View style={styles.sectionHead}>
          <MarkerHighlight textStyle={styles.sectionTitle}>Health Profile</MarkerHighlight>
          <Text style={styles.sectionSubtitle}>
            Optional. These help personalize your experience.
          </Text>
        </View>
        <Card padding="lg" level={1} style={styles.card}>
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <NumberInput
                label="Height"
                unit="cm"
                value={heightCm}
                onChangeText={setHeightCm}
                placeholder="e.g. 175"
              />
            </View>
            <View style={styles.fieldHalf}>
              <NumberInput
                label="Weight"
                unit="kg"
                value={weightKg}
                onChangeText={setWeightKg}
                placeholder="e.g. 70"
              />
            </View>
          </View>
        </Card>

        {/* ── Save Button ── */}
        <Button
          title={saveMutation.isSuccess ? 'Saved' : saveMutation.isPending ? 'Saving' : 'Save Profile'}
          onPress={() => saveMutation.mutate()}
          fullWidth
          loading={saveMutation.isPending}
          disabled={saveMutation.isPending}
          style={styles.saveButton}
        />

        {/* ── Preferences (deliberate-change shortcuts; home is the drawer) ── */}
        <View style={styles.sectionHead}>
          <MarkerHighlight textStyle={styles.sectionTitle}>Preferences</MarkerHighlight>
          <Text style={styles.sectionSubtitle}>
            Profile syncs to your account on save; health logs sync automatically.
          </Text>
        </View>
        <View style={styles.miniRows}>
          <Pressable
            style={styles.miniRow}
            onPress={() => navigation.navigate('OnboardingSetup')}
            accessibilityRole="button"
            accessibilityLabel="Edit goals and focus areas"
          >
            <Text style={styles.miniRowText}>Goals & focus areas</Text>
            <Text style={styles.miniRowChevron}>›</Text>
          </Pressable>
          <Pressable
            style={styles.miniRow}
            onPress={() => navigation.navigate('HealthAreas')}
            accessibilityRole="button"
            accessibilityLabel="View health areas"
          >
            <Text style={styles.miniRowText}>Health areas</Text>
            <Text style={styles.miniRowChevron}>›</Text>
          </Pressable>
        </View>

        {/* ── Account Section ── */}
        <MarkerHighlight textStyle={styles.sectionTitle}>Account</MarkerHighlight>
        <Button
          title="Sign Out"
          variant="outline"
          fullWidth
          loading={signingOut}
          disabled={signingOut}
          onPress={confirmSignOut}
        />

        {/* ── Danger Zone (real deletion: server erasure, then local wipe) ── */}
        <MarkerHighlight textStyle={[styles.sectionTitle, styles.dangerTitle]}>Danger zone</MarkerHighlight>
        <View style={styles.dangerCard}>
          <Pressable
            style={styles.dangerRow}
            onPress={confirmDeleteData}
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
            onPress={confirmDeleteAccount}
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
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GV.stage,
  },
  content: {
    paddingHorizontal: SPACE.screenH,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 24,
  },
  // Section headings carry no margins: the parent gap sets every
  // block exactly 24 apart, and sectionHead sets title-to-subtitle
  // to exactly 4. One rhythm, no stacked margins.
  sectionHead: {
    gap: 4,
  },
  sectionTitle: {
    ...TYPE.title,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  sectionSubtitle: {
    ...TYPE.caption,
    color: GV.fog,
  },
  card: {
    gap: 16,
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
    ...TYPE.caption,
    color: GV.muted,
  },
  fieldValue: {
    ...TYPE.body,
    fontFamily: FONT.semi,
    color: GV.ink,
    paddingVertical: 8,
  },
  saveButton: {
    marginTop: 0,
  },
  // Compact deliberate-change rows (small, quiet — the drawer's Health
  // section is their primary home).
  miniRows: {
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
    ...TYPE.caption,
    color: GV.muted,
  },
  menuRowChevron: {
    ...TYPE.title,
    color: GV.muted,
    opacity: 0.7,
    marginLeft: 8,
  },
  identityCard: {
    gap: 0,
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
    backgroundColor: GV.wash,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  identityMeta: {
    flex: 1,
    gap: 2,
  },
  identityName: {
    ...TYPE.title,
    color: GV.ink,
  },
  identityEmail: {
    ...TYPE.caption,
    color: GV.muted,
  },
  identityDivider: {
    height: 1,
    backgroundColor: GV.line,
    marginVertical: 12,
  },
  identityActions: {
    flexDirection: 'row',
    gap: 8,
  },
  identityBtn: {
    paddingRight: 16,
    minHeight: 44,
    justifyContent: 'center',
  },
  identityBtnPrimary: {
    ...TYPE.button,
    fontSize: 15,
    color: GV.cta,
  },
  identityBtnQuiet: {
    ...TYPE.button,
    fontSize: 15,
    color: GV.muted,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoInitial: {
    ...TYPE.display,
    color: GV.ink,
  },
  dangerTitle: {
    color: GV.danger,
  },
  dangerCard: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(214, 69, 69, 0.35)',
  },
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
  },
  dangerRowTitle: {
    ...TYPE.body,
    fontFamily: FONT.semi,
    color: GV.danger,
    marginBottom: 2,
  },
  dangerDivider: {
    height: 1,
    backgroundColor: GV.line,
  },
});
