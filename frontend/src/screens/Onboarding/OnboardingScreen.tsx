import { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/AuthContext';
import { BrandLogo, Button, Card, Input } from '@/components';
import { Reveal } from '@/components/home/Reveal';
import { FONT, GV, SPACE, TYPE } from '@/theme/guava';

import { MEDICAL_DISCLAIMER } from '@/constants';

import { IntroVisual } from './IntroVisual';
import { SystemVisual } from './SystemVisual';

/**
 * Onboarding — two premium value screens, then the existing sign-in.
 *
 * Pages (horizontal pager):
 *  0. Introduction — "Your health, connected."
 *  1. One-health-system — "Everything about your health. In one place."
 *  2. Authentication — the existing email/password form, unchanged logic.
 *
 * Visuals are pure code (Views + react-native-svg + Reanimated): no image
 * assets, no new dependencies. Copy, typography and the CTA reuse the
 * Guava system (Poppins, stage, CTA green).
 */

const PAGES = [0, 1, 2] as const;
/** Module-level list identity so the pager never re-mounts on keystrokes. */
const PAGE_LIST: number[] = [0, 1, 2];
const STORY_PAGES = 2;

export default function OnboardingScreen() {
  const { width, height } = useWindowDimensions();
  const pager = useRef<FlatList<number> | null>(null);
  const [step, setStep] = useState(0);

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

  // Visual size adapts to both axes so small (360×640) and large phones
  // fit visual + copy + CTA without scrolling in practice.
  const visualSize = Math.min(
    width - 48,
    340,
    Math.max(220, height * 0.36),
  );

  // ---------------------------------------------------------------------------
  // Pager
  // ---------------------------------------------------------------------------

  const goTo = useCallback(
    (index: number) => {
      setStep(index);
      try {
        pager.current?.scrollToIndex({ index, animated: true });
      } catch {
        pager.current?.scrollToOffset({
          offset: index * width,
          animated: true,
        });
      }
    },
    [width],
  );

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(
        event.nativeEvent.contentOffset.x / width,
      );
      setStep(Math.max(0, Math.min(PAGES.length - 1, index)));
    },
    [width],
  );

  // ---------------------------------------------------------------------------
  // Submit authentication form (unchanged behavior)
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
  // Page renderers
  // ---------------------------------------------------------------------------

  const renderIntro = (active: boolean): React.ReactNode => (
    <ScrollView
      contentContainerStyle={styles.pageScroll}
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      <IntroVisual size={visualSize} active={active} />
      {/* Remount on activation so the copy entrance replays each visit. */}
      <View key={active ? 'intro-copy-on' : 'intro-copy-off'} style={styles.copy}>
        <Reveal>
          <BrandLogo height={22} tint="#FFFFFF" style={styles.wordmark} />
        </Reveal>
        <Reveal>
          <Text style={styles.headline}>
            {'Your health,\nconnected.'}
          </Text>
        </Reveal>
        <Reveal>
          <Text style={styles.sub}>
            Understand your health, track what matters, and see how
            everything connects — all in one place.
          </Text>
        </Reveal>
      </View>
    </ScrollView>
  );

  const renderSystem = (active: boolean): React.ReactNode => (
    <ScrollView
      contentContainerStyle={styles.pageScroll}
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      <SystemVisual size={visualSize} active={active} />
      <View key={active ? 'system-copy-on' : 'system-copy-off'} style={styles.copy}>
        <Reveal>
          <Text style={styles.overline}>ONE HEALTH SYSTEM</Text>
        </Reveal>
        <Reveal>
          <Text style={styles.headline}>
            {'Everything about your health.\nIn one place.'}
          </Text>
        </Reveal>
        <Reveal>
          <Text style={styles.sub}>
            Connect your health information, measurements, habits and
            daily life into one personal HealthGraph.
          </Text>
        </Reveal>
      </View>
    </ScrollView>
  );

  const renderAuth = (): React.ReactNode => (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.keyboardAvoiding}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : undefined}
      enabled={Platform.OS === 'ios'}
    >
      <ScrollView
        contentContainerStyle={styles.authScroll}
        keyboardDismissMode="none"
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <BrandLogo height={24} tint="#FFFFFF" />
          <Text style={styles.tagline}>
            Your Health Intelligence
          </Text>
        </View>

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
  );

  const renderPage = ({ item }: { item: number }): React.ReactElement => (
    <View style={{ width, flex: 1 }}>
      {item === 0 ? renderIntro(step === 0) : null}
      {item === 1 ? renderSystem(step === 1) : null}
      {item === 2 ? renderAuth() : null}
    </View>
  );

  const onAuth = step === 2;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Top bar: progress on story pages, back on auth. */}
      <View style={styles.topBar}>
        {onAuth ? (
          <>
            <Pressable
              onPress={() => goTo(1)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Back to onboarding"
              style={styles.backHit}
            >
              <Text style={styles.backText}>‹ Back</Text>
            </Pressable>
            <View style={styles.topSpacer} />
          </>
        ) : (
          <>
            <View
              style={styles.segments}
              accessibilityRole="progressbar"
              accessibilityLabel={`Step ${step + 1} of ${STORY_PAGES}`}
            >
              {Array.from({ length: STORY_PAGES }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.segment,
                    i <= step ? styles.segmentOn : styles.segmentOff,
                  ]}
                />
              ))}
            </View>
            <Pressable
              onPress={() => goTo(2)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Skip to sign in"
              style={styles.skipHit}
            >
              <Text style={styles.skipText}>Sign in</Text>
            </Pressable>
          </>
        )}
      </View>

      <FlatList
        ref={pager}
        data={PAGE_LIST}
        keyExtractor={item => String(item)}
        renderItem={renderPage}
        horizontal
        pagingEnabled
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumEnd}
        getItemLayout={(_, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
        initialNumToRender={3}
        windowSize={3}
        style={styles.pager}
      />

      {/* CTA footer on story pages only. */}
      {onAuth ? null : (
        <View style={styles.footer}>
          <Button
            title="Continue"
            onPress={() => goTo(step + 1)}
            fullWidth
            size="large"
            accessibilityLabel={
              step === 0
                ? 'Continue to the one health system'
                : 'Continue to sign in'
            }
            style={styles.cta}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GV.stage,
  },

  // --------------------------------------------------------------------------
  // Top bar
  // --------------------------------------------------------------------------

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    minHeight: 48,
    gap: 12,
  },

  segments: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
  },

  segment: {
    flex: 1,
    maxWidth: 64,
    height: 4,
    borderRadius: 2,
  },

  segmentOn: {
    backgroundColor: '#FFFFFF',
  },

  segmentOff: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },

  skipHit: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },

  skipText: {
    fontFamily: FONT.semi,
    fontSize: 14,
    lineHeight: 20,
    color: GV.fog,
  },

  backHit: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },

  backText: {
    fontFamily: FONT.semi,
    fontSize: 15,
    lineHeight: 22,
    color: '#FFFFFF',
  },

  topSpacer: {
    flex: 1,
  },

  // --------------------------------------------------------------------------
  // Pager + story pages
  // --------------------------------------------------------------------------

  pager: {
    flex: 1,
  },

  pageScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    gap: 20,
  },

  copy: {
    alignItems: 'center',
    gap: 12,
    paddingBottom: 4,
  },

  wordmark: {
    marginBottom: 2,
  },

  overline: {
    fontFamily: FONT.semi,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 3,
    color: GV.teal,
    textAlign: 'center',
  },

  headline: {
    fontFamily: FONT.semi,
    fontSize: 32,
    lineHeight: 38,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
  },

  sub: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
    maxWidth: 330,
  },

  footer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
  },

  cta: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },

  // --------------------------------------------------------------------------
  // Auth (existing form, unchanged styling)
  // --------------------------------------------------------------------------

  keyboardAvoiding: {
    flex: 1,
  },

  authScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACE.screenH,
    paddingVertical: SPACE.sectionGap,
  },

  header: {
    alignItems: 'center',
    marginBottom: SPACE.sectionGap,
  },

  tagline: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
    marginTop: 8,
  },

  formCard: {
    width: '100%',
  },

  formTitle: {
    ...TYPE.title,
    color: GV.ink,
    marginBottom: 8,
  },

  formSubtitle: {
    ...TYPE.body,
    color: GV.body,
    marginBottom: 16,
  },

  errorBanner: {
    backgroundColor: GV.wash,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },

  formErrorBanner: {
    backgroundColor: GV.wash,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },

  errorText: {
    ...TYPE.caption,
    color: GV.danger,
  },

  submitButton: {
    marginTop: 8,
  },

  toggleContainer: {
    alignItems: 'center',
    marginTop: 16,
  },

  toggleText: {
    ...TYPE.body,
    color: GV.fog,
    textAlign: 'center',
  },

  toggleLink: {
    color: GV.teal,
    fontFamily: FONT.semi,
  },

  disclaimerCard: {
    marginTop: SPACE.sectionGap,
  },

  disclaimerTitle: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    color: GV.ink,
    marginBottom: 8,
  },

  disclaimerText: {
    ...TYPE.caption,
    color: GV.body,
  },
});
