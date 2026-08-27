import {
  StyleSheet,
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { Button, Input, Card } from '@/components';

import {
  COLORS,
  SPACING,
  BORDER_RADIUS,
  TYPOGRAPHY,
  MEDICAL_DISCLAIMER,
} from '@/constants';

export default function OnboardingScreen() {
  const {
    signup,
    login,
    loading,
    error,
    clearError,
  } = useAuth();

  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const busy = loading || submitting;

  // ---------------------------------------------------------------------------
  // Submit authentication form
  // ---------------------------------------------------------------------------

  const handleSubmit = async (): Promise<void> => {
    const trimmedEmail = email.trim();
    const trimmedName = displayName.trim();

    setFormError('');

    if (!trimmedEmail || !password) {
      setFormError(
        'Please enter both email and password'
      );
      return;
    }

    if (!isLogin && !trimmedName) {
      setFormError(
        'Please enter your name'
      );
      return;
    }

    if (password.length < 6) {
      setFormError(
        'Password must be at least 6 characters'
      );
      return;
    }

    clearError();
    setSubmitting(true);

    try {
      if (isLogin) {
        await login(
          trimmedEmail,
          password
        );
      } else {
        await signup(
          trimmedEmail,
          password,
          trimmedName
        );
      }

      /*
       * Do NOT navigate here.
       *
       * AuthContext updates the Firebase user.
       * App.tsx observes that authenticated state
       * and renders the authenticated application.
       */
    } catch (authError: unknown) {
      const message =
        authError instanceof Error
          ? authError.message
          : 'Authentication failed';

      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Toggle login / signup
  // ---------------------------------------------------------------------------

  const toggleAuthMode = (): void => {
    setIsLogin(
      previous => !previous
    );

    setFormError('');
    clearError();
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={
          Platform.OS === 'ios'
            ? 'padding'
            : 'height'
        }
        style={styles.keyboardAvoiding}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={
            styles.scrollContent
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ---------------------------------------------------------------- */}
          {/* Header                                                           */}
          {/* ---------------------------------------------------------------- */}

          <View style={styles.header}>
            <View
              style={styles.logoContainer}
            >
              <Text style={styles.logo}>
                MedGraph
              </Text>
            </View>

            <Text style={styles.tagline}>
              Your Health Intelligence
            </Text>
          </View>

          {/* ---------------------------------------------------------------- */}
          {/* Authentication Card                                              */}
          {/* ---------------------------------------------------------------- */}

          <Card style={styles.formCard}>
            <Text style={styles.formTitle}>
              {isLogin
                ? 'Welcome Back'
                : 'Create Account'}
            </Text>

            <Text style={styles.formSubtitle}>
              {isLogin
                ? 'Sign in to access your health dashboard'
                : 'Start your wellness journey today'}
            </Text>

            {/* Firebase/Auth error */}

            {error ? (
              <View
                style={styles.errorBanner}
              >
                <Text
                  style={styles.errorText}
                >
                  {error}
                </Text>
              </View>
            ) : null}

            {/* Form validation error */}

            {formError ? (
              <View
                style={
                  styles.formErrorBanner
                }
              >
                <Text
                  style={styles.errorText}
                >
                  {formError}
                </Text>
              </View>
            ) : null}

            {/* ---------------------------------------------------------------- */}
            {/* Email                                                              */}
            {/* ---------------------------------------------------------------- */}

            <Input
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              disabled={busy}
            />

            {/* ---------------------------------------------------------------- */}
            {/* Full Name                                                         */}
            {/* ---------------------------------------------------------------- */}

            {!isLogin ? (
              <Input
                label="Full Name"
                placeholder="John Doe"
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
                autoComplete="name"
                disabled={busy}
              />
            ) : null}

            {/* ---------------------------------------------------------------- */}
            {/* Password                                                          */}
            {/* ---------------------------------------------------------------- */}

            <Input
              label="Password"
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={
                isLogin
                  ? 'current-password'
                  : 'new-password'
              }
              disabled={busy}
            />

            {/* ---------------------------------------------------------------- */}
            {/* Submit Button                                                     */}
            {/* ---------------------------------------------------------------- */}

            <Button
              title={
                isLogin
                  ? 'Sign In'
                  : 'Create Account'
              }
              onPress={() => {
                void handleSubmit();
              }}
              disabled={busy}
              loading={busy}
              fullWidth
              style={styles.submitButton}
            />
          </Card>

          {/* ---------------------------------------------------------------- */}
          {/* Login / Signup Toggle                                              */}
          {/* ---------------------------------------------------------------- */}

          <View
            style={styles.toggleContainer}
          >
            <Text style={styles.toggleText}>
              {isLogin
                ? "Don't have an account? "
                : 'Already have an account? '}

              <Text
                style={styles.toggleLink}
                onPress={toggleAuthMode}
              >
                {isLogin
                  ? 'Sign Up'
                  : 'Sign In'}
              </Text>
            </Text>
          </View>

          {/* ---------------------------------------------------------------- */}
          {/* Medical Disclaimer                                                 */}
          {/* ---------------------------------------------------------------- */}

          <Card
            style={styles.disclaimerCard}
            padding="sm"
          >
            <Text
              style={styles.disclaimerTitle}
            >
              Important Disclaimer
            </Text>

            <Text
              style={styles.disclaimerText}
            >
              {MEDICAL_DISCLAIMER}
            </Text>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor:
      COLORS.background,
  },

  keyboardAvoiding: {
    flex: 1,
  },

  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal:
      SPACING.xl,
    paddingVertical:
      SPACING.xxl,
  },

  // --------------------------------------------------------------------------
  // Header
  // --------------------------------------------------------------------------

  header: {
    alignItems: 'center',
    marginBottom:
      SPACING.xl,
  },

  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom:
      SPACING.sm,
  },

  logo: {
    ...TYPOGRAPHY.display,
    color: COLORS.primary,
    fontWeight: '700',
  },

  tagline: {
    ...TYPOGRAPHY.body,
    color:
      COLORS.textSecondary,
    textAlign: 'center',
  },

  // --------------------------------------------------------------------------
  // Form
  // --------------------------------------------------------------------------

  formCard: {
    width: '100%',
  },

  formTitle: {
    ...TYPOGRAPHY.h2,
    color: COLORS.textPrimary,
    marginBottom:
      SPACING.xs,
  },

  formSubtitle: {
    ...TYPOGRAPHY.body,
    color:
      COLORS.textSecondary,
    marginBottom:
      SPACING.lg,
  },

  // --------------------------------------------------------------------------
  // Errors
  // --------------------------------------------------------------------------

  errorBanner: {
    backgroundColor:
      'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor:
      'rgba(239, 68, 68, 0.3)',
    borderRadius:
      BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom:
      SPACING.md,
  },

  formErrorBanner: {
    backgroundColor:
      'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor:
      'rgba(239, 68, 68, 0.3)',
    borderRadius:
      BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom:
      SPACING.md,
  },

  errorText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.error,
  },

  // --------------------------------------------------------------------------
  // Submit
  // --------------------------------------------------------------------------

  submitButton: {
    marginTop:
      SPACING.sm,
  },

  // --------------------------------------------------------------------------
  // Auth mode toggle
  // --------------------------------------------------------------------------

  toggleContainer: {
    alignItems: 'center',
    marginTop:
      SPACING.lg,
  },

  toggleText: {
    ...TYPOGRAPHY.body,
    color:
      COLORS.textSecondary,
    textAlign: 'center',
  },

  toggleLink: {
    color: COLORS.primary,
    fontWeight: '600',
  },

  // --------------------------------------------------------------------------
  // Disclaimer
  // --------------------------------------------------------------------------

  disclaimerCard: {
    marginTop:
      SPACING.xl,
    backgroundColor:
      COLORS.surface,
  },

  disclaimerTitle: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.warning,
    marginBottom:
      SPACING.xs,
  },

  disclaimerText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
});