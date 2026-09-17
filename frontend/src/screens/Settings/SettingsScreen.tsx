import { useCallback, useEffect, useState } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Input, NumberInput, SectionHeader } from '@/components';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { api } from '@/services/api';
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

  // --- Danger zone (frontend preview — confirmations only, nothing is sent) ---
  const confirmDeleteData = useCallback(() => {
    Alert.alert(
      'Delete all my data?',
      'This would remove daily logs, medications, documents and cached health data from this device and your account. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: () => Alert.alert('Frontend preview', 'UI only — nothing was deleted.'),
        },
      ],
    );
  }, []);

  const confirmDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete account?',
      'This would permanently delete your account, profile and all health data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () => Alert.alert('Frontend preview', 'UI only — no request was sent.'),
        },
      ],
    );
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Photo (local only) ── */}
        <View style={styles.photoWrap}>
          <Pressable
            style={styles.photoAvatar}
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
          <Text style={styles.photoName} numberOfLines={1}>
            {displayName || userProfile?.displayName || 'Your profile'}
          </Text>
          {email ? <Text style={styles.photoEmail} numberOfLines={1}>{email}</Text> : null}
          <View style={styles.photoActions}>
            <Pressable
              style={styles.photoBtn}
              onPress={() => void pickPhoto()}
              disabled={pickingPhoto}
              accessibilityRole="button"
              accessibilityLabel={photoUri ? 'Change photo' : 'Add photo'}
            >
              <Text style={styles.photoBtnText}>
                {pickingPhoto ? 'Opening…' : photoUri ? 'Change photo' : 'Add photo'}
              </Text>
            </Pressable>
            {photoUri ? (
              <Pressable
                style={styles.photoBtn}
                onPress={() => void savePhoto(null)}
                accessibilityRole="button"
                accessibilityLabel="Remove photo"
              >
                <Text style={styles.photoBtnText}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

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

        {/* ── Danger Zone (frontend preview) ── */}
        <Text style={[styles.sectionTitle, styles.dangerTitle]}>Danger zone</Text>
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
    paddingVertical: SPACE.sectionGap,
    paddingBottom: 48,
    gap: SPACE.cardGap,
  },
  sectionTitle: {
    ...TYPE.title,
    color: '#FFFFFF',
    marginTop: SPACE.sectionGap,
    marginBottom: 8,
  },
  sectionSubtitle: {
    ...TYPE.caption,
    color: GV.fog,
    marginBottom: 8,
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
    marginTop: 8,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
  },
  menuRowContent: {
    flex: 1,
  },
  menuRowTitle: {
    ...TYPE.body,
    fontFamily: FONT.semi,
    color: GV.ink,
    marginBottom: 2,
  },
  menuRowSubtitle: {
    ...TYPE.caption,
    color: GV.muted,
  },
  menuRowChevron: {
    ...TYPE.title,
    color: GV.muted,
    marginLeft: 8,
  },
  photoWrap: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 4,
  },
  photoAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: GV.card,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoInitial: {
    ...TYPE.display,
    color: GV.ink,
  },
  photoName: {
    ...TYPE.title,
    color: '#FFFFFF',
    marginTop: 8,
  },
  photoEmail: {
    ...TYPE.caption,
    color: GV.fog,
  },
  photoActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  photoBtn: {
    borderRadius: SPACE.rPill,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: GV.card,
  },
  photoBtnText: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    color: GV.ink,
  },
  dangerTitle: {
    color: GV.danger,
  },
  dangerCard: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    paddingHorizontal: SPACE.cardPad,
  },
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACE.cardPad,
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
