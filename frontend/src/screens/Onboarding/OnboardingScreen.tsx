import { useCallback, useEffect, useRef, useState } from 'react';
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
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '@/context/AuthContext';
import { BrandLogo, Button, Input } from '@/components';
import { Reveal } from '@/components/home/Reveal';
import { GlassSurface } from '@/components/home/GlassSurface';
import { HomeStageBackdrop } from '@/components/home/HomeStageBackdrop';
import { GV, SPACE } from '@/theme/guava';
import { LG } from '@/theme/liquidGlass';
import { useReducedMotion } from '@/theme/useReducedMotion';

import { MEDICAL_DISCLAIMER } from '@/constants';

import { IntroVisual } from './IntroVisual';
import { ProgressGraphVisual } from './ProgressGraphVisual';
import { clearPricingNeeded, markPricingNeeded } from './PricingScreen';

/**
 * Onboarding — two value screens, then sign-in. All three pages share the
 * Home redesign's Liquid Glass schema: the aurora stage behind everything,
 * the instrument visuals inside frosted panels, system (SF-style)
 * typography, one glass CTA per page. Apple psychology: few words, one
 * job per screen, quiet confidence.
 *
 * Pages (horizontal pager):
 *  0. Introduction — "Your health, connected." (connected-hub visual)
 *  1. Bigger picture — "See the bigger picture." (7-day progress visual)
 *  2. Authentication — email/password form, unchanged logic.
 */

const PAGES = [0, 1, 2] as const;
/** Module-level list identity so the pager never re-mounts on keystrokes. */
const PAGE_LIST: number[] = [0, 1, 2];
const STORY_PAGES = 2;

/** Auth views. Password reset uses Firebase email links: there is no
 *  server-issued OTP in this stack, so "forgot" sends a link and
 *  "resetSent" confirms it (with resend countdown) instead of a code
 *  screen that would have nothing real to verify against. */
type AuthView = 'login' | 'signup' | 'forgot' | 'resetSent';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REMEMBER_KEY = 'hg:rememberedEmail:v1';
const RESEND_SECONDS = 30;

/**
 * GlassCard — the auth form panel in the sidebar's liquid-glass material:
 * live blur over the stage, brand tint for depth, bright hairline edge.
 * Solid translucent panel under reduced motion. White input wells stay
 * solid for legibility (same rule as the sidebar's white-on-glass text).
 */
function GlassCard({ children }: { children: React.ReactNode }) {
  const glassOff = useReducedMotion();
  return (
    <View style={styles.glassCard}>
      {glassOff ? (
        <View style={styles.glassSolid} />
      ) : (
        <BlurView tint="dark" intensity={84} style={styles.glassFill} />
      )}
      <View style={styles.glassTint} />
      <View style={styles.glassContent}>{children}</View>
    </View>
  );
}

/**
 * CheckRow — 44px tappable checkbox row (remember-me, terms accept).
 * Local to auth: the only place checkboxes exist, so no shared component.
 */
function CheckRow({
  checked,
  onToggle,
  label,
  accessibilityLabel,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [
        styles.checkRow,
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={[styles.box, checked && styles.boxOn]}>
        {checked ? <Text style={styles.tick}>✓</Text> : null}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

export default function OnboardingScreen() {
  const { width, height } = useWindowDimensions();
  const pager = useRef<FlatList<number> | null>(null);
  const [step, setStep] = useState(0);

  const {
    signup,
    login,
    sendReset,
    loading,
    error,
    clearError,
  } = useAuth();

  const [authView, setAuthView] = useState<AuthView>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);
  // Read-first CTA: the pager arrow appears 4s after each story page
  // lands, so the copy is read before the way forward shows up. The
  // timer resets on every page change and clears on unmount.
  const [ctaVisible, setCtaVisible] = useState(false);
  useEffect(() => {
    if (step >= STORY_PAGES) return;
    setCtaVisible(false);
    const timer = setTimeout(() => setCtaVisible(true), 4000);
    return () => clearTimeout(timer);
  }, [step]);

  const busy = loading || submitting;

  // Remembered email: prefill only, never a password. Best-effort.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(REMEMBER_KEY)
      .then(saved => {
        if (!cancelled && saved) {
          setEmail(saved);
          setRememberMe(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Resend countdown ticks only while the confirmation is showing.
  useEffect(() => {
    if (authView !== 'resetSent' || resendIn <= 0) return;
    const timer = setTimeout(
      () => setResendIn(value => Math.max(0, value - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [authView, resendIn]);

  const reducedMotion = useReducedMotion();

  // Visual size adapts to both axes so small (360×640) and large phones
  // fit visual + copy + CTA without scrolling in practice.
  // Visual size adapts to both axes so small (360×640) and large phones
  // fit visual + copy + CTA without scrolling in practice. The extra 28
  // is the glass panel's own padding (14×2) — the visual must fit INSIDE
  // the panel, never clip against its rim.
  const visualSize = Math.min(
    width - 48 - 28,
    320,
    Math.max(200, height * 0.34),
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
  // Submit authentication form (validation + Firebase, busy-guarded)
  // ---------------------------------------------------------------------------

  const handleSubmit = async (): Promise<void> => {
    if (submitting) return;
    const signingUp = authView === 'signup';
    const trimmedEmail = email.trim();
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    const trimmedName = `${trimmedFirst} ${trimmedLast}`.trim();

    setFormError('');

    if (!trimmedEmail || !password) {
      setFormError(
        'Please enter both email and password'
      );
      return;
    }

    if (!EMAIL_RE.test(trimmedEmail)) {
      setFormError(
        'Enter a valid email address.'
      );
      return;
    }

    if (signingUp && !trimmedFirst) {
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

    if (signingUp && password !== confirmPassword) {
      setFormError(
        'Passwords do not match.'
      );
      return;
    }

    if (signingUp && !termsAccepted) {
      setFormError(
        'Please accept the Terms & Privacy Policy to continue.'
      );
      return;
    }

    clearError();
    setSubmitting(true);

    try {
      if (!signingUp) {
        await login(
          trimmedEmail,
          password
        );
        // Remember-me stores the email for prefill only, never a password.
        try {
          if (rememberMe) await AsyncStorage.setItem(REMEMBER_KEY, trimmedEmail);
          else await AsyncStorage.removeItem(REMEMBER_KEY);
        } catch {
          // Best-effort: prefill must never block sign-in.
        }
        // A stale flag must never follow anyone into the app: login
        // always clears it, so only a fresh signup can show pricing.
        try {
          await clearPricingNeeded();
        } catch {
          // Flag read treats storage failure as "no pricing".
        }
      } else {
        // Flag BEFORE signup: App reads it the moment the user appears,
        // so setting it after would race the gate and skip pricing.
        // A failed signup leaves user null and the !user branch clears it.
        // Storage failure here only skips pricing — never an auth error.
        try {
          await markPricingNeeded();
        } catch {
          // Fail open to the app.
        }
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
  // Password reset (Firebase email link) + resend countdown
  // ---------------------------------------------------------------------------

  const handleForgot = async (): Promise<void> => {
    if (submitting) return;
    const trimmedEmail = email.trim();

    setFormError('');

    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      setFormError(
        'Enter the email address for your account.'
      );
      return;
    }

    clearError();
    setSubmitting(true);

    try {
      await sendReset(trimmedEmail);
      setResendIn(RESEND_SECONDS);
      setAuthView('resetSent');
    } catch (resetError: unknown) {
      const message =
        resetError instanceof Error
          ? resetError.message
          : 'Could not send the reset link.';
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async (): Promise<void> => {
    if (submitting || resendIn > 0) return;
    const trimmedEmail = email.trim();

    setFormError('');
    clearError();
    setSubmitting(true);

    try {
      await sendReset(trimmedEmail);
      setResendIn(RESEND_SECONDS);
    } catch (resetError: unknown) {
      const message =
        resetError instanceof Error
          ? resetError.message
          : 'Could not resend the reset link.';
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Switch auth views (keeps what was typed, clears stale errors)
  // ---------------------------------------------------------------------------

  const goAuth = (view: AuthView): void => {
    setAuthView(view);
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
      {/* The instrument in its glass case — one material language with Home. */}
      <GlassSurface radius={28} style={styles.visualPanel}>
        <IntroVisual size={visualSize} active={active} />
      </GlassSurface>
        {/* Remount on activation so the copy entrance replays each visit. */}
        <View key={active ? 'intro-copy-on' : 'intro-copy-off'} style={styles.copy}>
          <Reveal delay={450}>
            <BrandLogo height={22} tint="#FFFFFF" style={styles.wordmark} />
          </Reveal>
          <Reveal delay={620}>
            <Text
              style={styles.headlineShowcase}
              accessibilityLabel={'Your health,\nconnected.'}
            >
              {'Your health,\n'}
              <Text style={styles.headlineAccent}>{'connected.'}</Text>
            </Text>
          </Reveal>
          <Reveal delay={780}>
            <Text style={styles.subShowcase}>
              All of your health, in one place.
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
      <GlassSurface radius={28} style={styles.visualPanel}>
        <ProgressGraphVisual size={visualSize} active={active} />
      </GlassSurface>
      <View key={active ? 'system-copy-on' : 'system-copy-off'} style={styles.copy}>
        <Reveal delay={720}>
          <Text
            style={styles.headlineShowcase}
            accessibilityLabel="See the bigger picture."
          >
            {'See the '}
            <Text style={styles.headlineAccent}>{'bigger picture.'}</Text>
          </Text>
        </Reveal>
        <Reveal delay={800}>
          <Text style={styles.subShowcase}>
            Watch your patterns emerge, day after day.
          </Text>
        </Reveal>
      </View>
    </ScrollView>
  );

  const renderAuthErrors = (): React.ReactNode => (
    <>
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
    </>
  );

  const renderPasswordToggle = (
    showing: boolean,
    onToggle: () => void,
  ): React.ReactNode => (
    <Pressable
      onPress={onToggle}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={showing ? 'Hide password' : 'Show password'}
      style={styles.passwordToggle}
    >
      <Text style={styles.passwordToggleText}>
        {showing ? 'Hide' : 'Show'}
      </Text>
    </Pressable>
  );

  const renderLoginView = (): React.ReactNode => (
    <>
      <GlassCard>
        <Text style={styles.formTitle}>
          Welcome back
        </Text>

        {renderAuthErrors()}

        <View style={styles.formFields}>
          <Input
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            disabled={busy}
              labelStyle={styles.fieldLabel}
              hintStyle={styles.fieldHint}
              style={styles.fieldWell}
              inputStyle={styles.fieldText}
          />

          <Input
            label="Password"
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
              labelStyle={styles.fieldLabel}
              hintStyle={styles.fieldHint}
              style={styles.fieldWell}
              inputStyle={styles.fieldText}
            rightElement={renderPasswordToggle(showPassword, () =>
              setShowPassword(previous => !previous),
            )}
            autoCapitalize="none"
            autoComplete="current-password"
            disabled={busy}
          />
        </View>

        <View style={styles.authRow}>
          <CheckRow
            checked={rememberMe}
            onToggle={() => setRememberMe(previous => !previous)}
            label="Remember me"
            accessibilityLabel="Remember my email on this device"
          />
          <Pressable
            onPress={() => goAuth('forgot')}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Forgot password"
            style={styles.linkHit}
          >
            <Text style={styles.linkText}>Forgot password?</Text>
          </Pressable>
        </View>

        <Button
          title="Sign In"
          variant="secondary"
          onPress={() => {
            void handleSubmit();
          }}
          disabled={busy}
          loading={busy}
          fullWidth
          style={styles.submitButton}
        />
        </GlassCard>

        <View
          style={styles.toggleContainer}
      >
        <Text style={styles.toggleText}>
          {"New here? "}

          <Text
            style={styles.toggleLink}
            onPress={() => goAuth('signup')}
          >
            Create an account
          </Text>
        </Text>
      </View>
    </>
  );

  const renderSignupView = (): React.ReactNode => (
    <>
      <GlassCard>
        <Text style={styles.formTitle}>
          Create your account
        </Text>

        {renderAuthErrors()}

        <View style={styles.formFields}>
          <Input
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            disabled={busy}
              labelStyle={styles.fieldLabel}
              hintStyle={styles.fieldHint}
              style={styles.fieldWell}
              inputStyle={styles.fieldText}
          />

          <View style={styles.nameRow}>
            <View style={styles.nameCol}>
              <Input
                label="First Name"
                placeholder="John"
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                autoComplete="name"
                disabled={busy}
                labelStyle={styles.fieldLabel}
                hintStyle={styles.fieldHint}
                style={styles.fieldWell}
                inputStyle={styles.fieldText}
              />
            </View>
            <View style={styles.nameCol}>
              <Input
                label="Last Name"
                placeholder="Doe"
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
                autoComplete="name"
                disabled={busy}
                labelStyle={styles.fieldLabel}
                hintStyle={styles.fieldHint}
                style={styles.fieldWell}
                inputStyle={styles.fieldText}
              />
            </View>
          </View>

          <Input
            label="Password"
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            hint="Password must be at least 6 characters."
              labelStyle={styles.fieldLabel}
              hintStyle={styles.fieldHint}
              style={styles.fieldWell}
              inputStyle={styles.fieldText}
            rightElement={renderPasswordToggle(showPassword, () =>
              setShowPassword(previous => !previous),
            )}
            autoCapitalize="none"
            autoComplete="new-password"
            disabled={busy}
          />

          <Input
            label="Confirm Password"
            placeholder="••••••••"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!showConfirm}
              labelStyle={styles.fieldLabel}
              hintStyle={styles.fieldHint}
              style={styles.fieldWell}
              inputStyle={styles.fieldText}
            rightElement={renderPasswordToggle(showConfirm, () =>
              setShowConfirm(previous => !previous),
            )}
            autoCapitalize="none"
            autoComplete="new-password"
            disabled={busy}
          />
        </View>

        <View style={styles.termsRow}>
          <CheckRow
            checked={termsAccepted}
            onToggle={() => setTermsAccepted(previous => !previous)}
            label="I agree to the Terms & Privacy Policy"
            accessibilityLabel="Agree to the Terms and Privacy Policy"
          />
        </View>

        <Button
          title="Create Account"
          variant="secondary"
          onPress={() => {
            void handleSubmit();
          }}
          disabled={busy}
          loading={busy}
          fullWidth
          style={styles.submitButton}
        />
        </GlassCard>

        <View
          style={styles.toggleContainer}
      >
        <Text style={styles.toggleText}>
          {'Already have an account? '}

          <Text
            style={styles.toggleLink}
            onPress={() => goAuth('login')}
          >
            Sign In
          </Text>
        </Text>
      </View>
    </>
  );

  const renderForgotView = (): React.ReactNode => (
    <>
      <GlassCard>
        <Text style={styles.formTitle}>
          Reset password
        </Text>

        <Text style={styles.formSubtitle}>
          We'll email you a secure reset link.
        </Text>

        {renderAuthErrors()}

        <View style={styles.formFields}>
          <Input
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            disabled={busy}
              labelStyle={styles.fieldLabel}
              hintStyle={styles.fieldHint}
              style={styles.fieldWell}
              inputStyle={styles.fieldText}
          />
        </View>

        <Button
          title="Send Reset Link"
          variant="secondary"
          onPress={() => {
            void handleForgot();
          }}
          disabled={busy}
          loading={busy}
          fullWidth
          style={styles.submitButton}
        />
        </GlassCard>

        <View
          style={styles.toggleContainer}
      >
        <Text style={styles.toggleText}>
          <Text
            style={styles.toggleLink}
            onPress={() => goAuth('login')}
          >
            Back to Sign In
          </Text>
        </Text>
      </View>
    </>
  );

  const renderResetSentView = (): React.ReactNode => (
    <>
      <GlassCard>
        <Text style={styles.formTitle}>
          Check your email
        </Text>

        <Text style={styles.formSubtitle}>
          {`A reset link is on its way to ${email.trim()}.`}
        </Text>

        {renderAuthErrors()}

        <Button
          title={resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend Link'}
          variant="secondary"
          onPress={() => {
            void handleResend();
          }}
          disabled={busy || resendIn > 0}
          loading={busy}
          fullWidth
          style={styles.submitButton}
        />
        </GlassCard>

        <View
          style={styles.toggleContainer}
      >
        <Text style={styles.toggleText}>
          <Text
            style={styles.toggleLink}
            onPress={() => goAuth('login')}
          >
            Back to Sign In
          </Text>
        </Text>
      </View>
    </>
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
        <View key={authView} style={styles.authBody}>
          {authView === 'login' ? renderLoginView() : authView === 'signup' ? renderSignupView() : authView === 'forgot' ? renderForgotView() : renderResetSentView()}
        </View>

        <View style={styles.disclaimerCard}>
          <Pressable
            onPress={() => setLegalOpen(previous => !previous)}
            accessibilityRole="button"
            accessibilityState={{ expanded: legalOpen }}
            accessibilityLabel="Medical disclaimer"
            style={({ pressed }) => [
              styles.disclaimerHead,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={styles.disclaimerTitle}>
              Medical disclaimer
            </Text>
            <Text style={styles.disclaimerChev}>{legalOpen ? '▾' : '›'}</Text>
          </Pressable>

          {legalOpen ? (
            <Text style={styles.disclaimerText}>
              {MEDICAL_DISCLAIMER}
            </Text>
          ) : null}
        </View>
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
    <View style={styles.root}>
      {/* The same aurora stage the Home screen sits on — one brand world
          from the first frame. Rich color for the glass panels to sample. */}
      <HomeStageBackdrop />
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

      {/* Read-first CTA on story pages: a quiet glass arrow, bottom-right,
          fading in 4s after the page lands. Auth page keeps no footer. */}
      {onAuth ? null : (
        <View style={styles.footer}>
          {ctaVisible ? (
            <Reveal key={`cta-${step}`}>
              <Pressable
                onPress={() => goTo(step + 1)}
                accessibilityRole="button"
                accessibilityLabel={
                  step === 0
                    ? 'Continue to see the bigger picture'
                    : 'Continue to sign in'
                }
                hitSlop={12}
                style={({ pressed }) => [
                  styles.ctaCircle,
                  pressed && { opacity: 0.7, transform: [{ scale: 0.94 }] },
                ]}
              >
                <Text style={styles.ctaArrow}>→</Text>
              </Pressable>
            </Reveal>
          ) : null}
        </View>
      )}
      </SafeAreaView>
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  // Root owns the stage color; the film layer covers it edge to edge on
  // story pages (including behind the top bar, footer, and safe insets).
  root: {
    flex: 1,
    backgroundColor: '#05070F',
  },

  container: {
    flex: 1,
    backgroundColor: 'transparent',
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
    fontWeight: '600',
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(233, 240, 255, 0.72)',
  },

  backHit: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },

  backText: {
    fontWeight: '600',
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

  // --------------------------------------------------------------------------
  // Showcase hero treatment (mirrors aurora-onboarding-showcase.html):
  // fullscreen root film + readability scrim + glowing italic accent line.
  // --------------------------------------------------------------------------

  headlineShowcase: {
    // Apple typography: system face (SF Pro on iOS), Display-weight
    // tracking at large sizes — no custom family.
    fontWeight: '600',
    fontSize: 40,
    lineHeight: 46,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.8,
    textShadowColor: 'rgba(255, 255, 255, 0.22)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 34,
  },

  headlineAccent: {
    fontStyle: 'italic',
    textShadowColor: 'rgba(255, 235, 190, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 20,
  },

  subShowcase: {
    fontWeight: '400',
    fontSize: 17,
    lineHeight: 23,
    color: 'rgba(255, 255, 255, 0.72)',
    textAlign: 'center',
    maxWidth: 330,
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
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
    gap: 14,
    paddingBottom: 4,
  },

  visualPanel: {
    alignSelf: 'center',
    padding: 14,
  },

  wordmark: {
    marginBottom: 2,
  },

  footer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
    minHeight: 88,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },

  // Read-first arrow: transparent glass circle, bottom-right.
  ctaCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },

  ctaArrow: {
    color: '#FFFFFF',
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '600',
    marginTop: -2,
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

  // Liquid-glass form panel: real backdrop blur + neutral dark wash over
  // the film — the same material language as Home's functional layer, no
  // brand-green tint fighting the story film behind it.
  glassCard: {
    width: '100%',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },

  glassFill: {
    ...StyleSheet.absoluteFill,
  },

  glassTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(14, 19, 31, 0.55)',
  },

  glassSolid: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },

  glassContent: {
    padding: 24,
  },

  formTitle: {
    fontWeight: '600',
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.4,
    color: '#FFFFFF',
    marginBottom: 16,
  },

  formSubtitle: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: 'rgba(233, 240, 255, 0.66)',
    marginBottom: 16,
    marginTop: -10,
  },

  // One connected group: the fields read as a single form, not loose rows.
  formFields: {
    gap: 12,
  },

  // Auth view container: remounts per view so the entrance replays.
  authBody: {
    width: '100%',
  },

  // Remember-me + forgot link share one row (reference layout).
  authRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 12,
  },

  linkHit: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },

  linkText: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: LG.card.mint,
  },

  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    flexShrink: 1,
  },

  box: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  boxOn: {
    backgroundColor: LG.card.mint,
    borderColor: LG.card.mint,
  },

  tick: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },

  checkLabel: {
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
    flexShrink: 1,
  },

  termsRow: {
    marginTop: 12,
  },

  // Light wells on the frosted card (reference look): explicit so the
  // shared Input keeps its theme everywhere else.
  fieldWell: {
    backgroundColor: '#FFFFFF',
    borderColor: GV.line,
  },

  fieldText: {
    color: GV.ink,
  },

  fieldLabel: {
    color: '#FFFFFF',
  },

  fieldHint: {
    color: GV.fog,
  },

  errorBanner: {
    backgroundColor: 'rgba(214, 69, 69, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(214, 69, 69, 0.35)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },

  formErrorBanner: {
    backgroundColor: 'rgba(214, 69, 69, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(214, 69, 69, 0.35)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },

  errorText: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: LG.card.danger,
  },

  submitButton: {
    marginTop: 8,
  },

  passwordToggle: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },

  passwordToggleText: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: LG.card.mint,
  },

  nameRow: {
    flexDirection: 'row',
    gap: 12,
  },

  nameCol: {
    flex: 1,
  },

  toggleContainer: {
    alignItems: 'center',
    marginTop: 16,
  },

  toggleText: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: 'rgba(233, 240, 255, 0.66)',
    textAlign: 'center',
  },

  toggleLink: {
    color: LG.card.mint,
    fontWeight: '600',
  },

  disclaimerCard: {
    marginTop: SPACE.sectionGap,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 16,
    paddingVertical: 4,
  },

  disclaimerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
  },

  disclaimerChev: {
    fontSize: 20,
    color: 'rgba(233, 240, 255, 0.5)',
  },

  disclaimerTitle: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233, 240, 255, 0.72)',
  },

  disclaimerText: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(233, 240, 255, 0.6)',
    marginTop: 8,
  },
});
