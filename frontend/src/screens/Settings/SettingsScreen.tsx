import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Input, NumberInput, SectionHeader } from '@/components';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants';
import { api } from '@/services/api';
import type { PatientProfile, RootStackParamList } from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const { user, userProfile, logout } = useAuth();
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

  // --- Save mutation ---
  const saveMutation = useMutation({
    mutationFn: () => {
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
      // Reset mutation state after brief success feedback
      setTimeout(() => saveMutation.reset(), 2000);
    },
    onError: (error: any) => {
      const status = error?.response?.status ?? 'network';
      console.error(`[Profile] PROFILE_SAVE_ERROR status=${status}`);
      Alert.alert('Error', 'Could not save profile. Please try again.');
    },
  });

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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Profile Section ── */}
        <SectionHeader title="Profile" />
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
        <SectionHeader title="Health Profile" />
        <Text style={styles.sectionSubtitle}>
          Optional. These help personalize your experience.
        </Text>
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

        {/* ── Medications Entry ── */}
        <SectionHeader title="Health" />
        <Pressable
          style={styles.menuRow}
          onPress={() => navigation.navigate('Medications')}
        >
          <View style={styles.menuRowContent}>
            <Text style={styles.menuRowTitle}>Medications</Text>
            <Text style={styles.menuRowSubtitle}>
              Manage active medicines, schedules & reminders
            </Text>
          </View>
          <Text style={styles.menuRowChevron}>›</Text>
        </Pressable>

        {/* ── Save Button ── */}
        <Button
          title={saveMutation.isSuccess ? 'Saved ✓' : saveMutation.isPending ? 'Saving…' : 'Save Profile'}
          onPress={() => saveMutation.mutate()}
          fullWidth
          loading={saveMutation.isPending}
          disabled={saveMutation.isPending}
          style={styles.saveButton}
        />

        {/* ── Account Section ── */}
        <Text style={styles.sectionTitle}>Account</Text>
        <Button
          title="Sign Out"
          variant="outline"
          fullWidth
          loading={signingOut}
          disabled={signingOut}
          onPress={confirmSignOut}
        />
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
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
    gap: SPACING.sm,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
    marginTop: SPACING.md,
    marginBottom: SPACING.xs,
  },
  sectionSubtitle: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  card: {
    gap: SPACING.md,
  },
  field: {
    gap: SPACING.xs,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  fieldHalf: {
    flex: 1,
  },
  fieldLabel: {
    ...TYPOGRAPHY.label,
    color: COLORS.textSecondary,
  },
  fieldValue: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
    paddingVertical: SPACING.sm,
  },
  saveButton: {
    marginTop: SPACING.sm,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  menuRowContent: {
    flex: 1,
  },
  menuRowTitle: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  menuRowSubtitle: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  menuRowChevron: {
    ...TYPOGRAPHY.h2,
    color: COLORS.textMuted,
    marginLeft: SPACING.sm,
  },
});
