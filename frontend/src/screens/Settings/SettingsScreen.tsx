import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { Button, Card } from '@/components';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants';

export default function SettingsScreen() {
  const { user, userProfile, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Account</Text>
        <Text style={styles.subtitle}>Manage your HealthGraph session.</Text>

        <Card padding="md" style={styles.accountCard}>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.email}>{userProfile?.email ?? user?.email ?? ''}</Text>
          {userProfile?.displayName ? (
            <Text style={styles.name}>{userProfile.displayName}</Text>
          ) : null}
        </Card>

        <Button
          title="Sign Out"
          variant="outline"
          fullWidth
          loading={signingOut}
          disabled={signingOut}
          onPress={confirmSignOut}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, gap: SPACING.md },
  title: { ...TYPOGRAPHY.h1, color: COLORS.textPrimary },
  subtitle: { ...TYPOGRAPHY.body, color: COLORS.textSecondary },
  accountCard: { gap: SPACING.xs },
  label: { ...TYPOGRAPHY.label, color: COLORS.textMuted },
  email: { ...TYPOGRAPHY.bodyStrong, color: COLORS.textPrimary },
  name: { ...TYPOGRAPHY.body, color: COLORS.textSecondary },
});
