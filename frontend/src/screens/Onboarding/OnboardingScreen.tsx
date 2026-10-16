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
import { VideoView, useVideoPlayer } from 'expo-video';
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '@/context/AuthContext';
import { BrandLogo, Button, Card, Input } from '@/components';
import { Reveal } from '@/components/home/Reveal';
import { FONT, GV, LG, SPACE, TYPE } from '@/theme/guava';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { StageGradient } from '@/components/StageGradient';

import { MEDICAL_DISCLAIMER } from '@/constants';

import { IntroVisual } from './IntroVisual';
import { ProgressGraphVisual } from './ProgressGraphVisual';
import { ValueStackVisual } from './ValueStackVisual';
import { EarlyBirdVisual } from './EarlyBirdVisual';
import { clearPricingNeeded, markPricingNeeded } from './PricingScreen';

/* Showcase hero films (same sources as aurora-onboarding-showcase.html).
 * Remote streams: fail silent to the flat stage (never block, never error). */
const HERO_VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260710_114906_ad7cee37-9e56-434f-99bc-92d5bdc4f9fe.mp4';
const SYSTEM_VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260710_115050_a1ba47d0-aedf-413c-9dea-14509599d3dd.mp4';

// Bundled fallback film (same asset as the boot splash — always playable
// offline). Metro literal require so the file is bundled (see
// assetBundlePatterns).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOCAL_FILM = require('../../../assets/app-load.mp4');

/**
 * Onboarding — four premium value screens, then the existing sign-in.
 *
 * Pages (horizontal pager):
 *  0. Introduction — "Your health, connected." (connected-hub visual)
 *  1. Bigger picture — "See the bigger picture." (illustrative 7-day
 *     progress graph; fixed artwork, never patient data)
 *  2. Value stack — "10 apps in one. One price." (glass value card;
 *     price comparison is an illustration, never a competitor quote)
 *  3. Early access — "Be early. Be different." (first-100 €9 vs €11;
 *     no fake countdown, no charge today, no cure claim)
 *  4. Authentication — the existing email/password form, unchanged logic.
 *
 * Visuals are pure code (Views + react-native-svg + Reanimated): no image
 * assets, no new dependencies. Copy, typography and the CTA reuse the
 * Guava system (Poppins, stage, CTA green).
 */

const PAGES = [0, 1, 2, 3, 4] as const;
/** Module-level list identity so the pager never re-mounts on keystrokes. */
const PAGE_LIST: number[] = [0, 1, 2, 3, 4];
const STORY_PAGES = 4;

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
  const [demoBusy, setDemoBusy] = useState(false);
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

  // Fullscreen story films: one root layer behind the top bar, pager,
  // and footer — edge to edge, no stage bands. The active page's film
  // plays; both pause on the auth page (readability + battery).
  // Reduced motion or any error falls back to the flat stage.
  const reducedMotion = useReducedMotion();
  const [heroFailed, setHeroFailed] = useState(false);
  const [systemFailed, setSystemFailed] = useState(false);
  const [heroReady, setHeroReady] = useState(false);
  const [systemReady, setSystemReady] = useState(false);
  const heroPlayer = useVideoPlayer(HERO_VIDEO_URL, p => {
    p.loop = true;
    p.muted = true;
  });
  const systemPlayer = useVideoPlayer(SYSTEM_VIDEO_URL, p => {
    p.loop = true;
    p.muted = true;
  });

  // Remote streams can fail on-device (no network, blocked CDN ranges):
  // instead of dropping to the stage wash, each player swaps to the
  // bundled local film and keeps going. Only if the local asset also
  // errors does that side fall back to the stage. Refs (not state) track
  // the swap so the status listener never reads a stale closure.
  const heroLocalRef = useRef(false);
  const systemLocalRef = useRef(false);

  useEffect(() => {
    const heroSub = heroPlayer.addListener('statusChange', ({ status }) => {
      if (status === 'error') {
        if (!heroLocalRef.current) {
          heroLocalRef.current = true;
          try {
            heroPlayer.replace(LOCAL_FILM);
            setHeroReady(false);
          } catch {
            setHeroFailed(true);
          }
        } else {
          setHeroFailed(true);
        }
      } else if (status === 'readyToPlay') {
        setHeroReady(true);
      }
    });
    const systemSub = systemPlayer.addListener('statusChange', ({ status }) => {
      if (status === 'error') {
        if (!systemLocalRef.current) {
          systemLocalRef.current = true;
          try {
            systemPlayer.replace(LOCAL_FILM);
            setSystemReady(false);
          } catch {
            setSystemFailed(true);
          }
        } else {
          setSystemFailed(true);
        }
      } else if (status === 'readyToPlay') {
        setSystemReady(true);
      }
    });
    return () => {
      heroSub.remove();
      systemSub.remove();
    };
  }, [heroPlayer, systemPlayer]);

  // Play only what is ready: a play() attempt on a loading remote stream
  // throws, and that must never unmount the film — only a real 'error'
  // status falls back to the stage. Pause everything on the auth page.
  useEffect(() => {
    if (reducedMotion || step >= STORY_PAGES) {
      try {
        heroPlayer.pause();
      } catch {
        // Best-effort.
      }
      try {
        systemPlayer.pause();
      } catch {
        // Best-effort.
      }
      return;
    }
    try {
      if (step === 0 && heroReady && !heroFailed) heroPlayer.play();
      else heroPlayer.pause();
    } catch {
      // Not ready yet — keep the layer mounted and try again later.
    }
    try {
      if (step === 1 && systemReady && !systemFailed) systemPlayer.play();
      else systemPlayer.pause();
    } catch {
      // Not ready yet — keep the layer mounted and try again later.
    }
  }, [step, reducedMotion, heroReady, systemReady, heroFailed, systemFailed, heroPlayer, systemPlayer]);

  useEffect(() => {
    return () => {
      try {
        heroPlayer.pause();
        systemPlayer.pause();
      } catch {
        // Best-effort teardown.
      }
    };
  }, [heroPlayer, systemPlayer]);

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
  // Sandbox demo (reviewers): sample data, no account, nothing syncs.
  // Offered only while signed out, so a demo session provably has no
  // Firebase user and no backend row.
  // ---------------------------------------------------------------------------

  const handleDemo = useCallback(async (): Promise<void> => {
    if (demoBusy) return;
    setDemoBusy(true);
    setFormError('');
    try {
      const { enterDemoMode } = await import('@/services/demoSession');
      await enterDemoMode();
    } catch {
      setFormError('Could not start the demo. Please try again.');
      setDemoBusy(false);
    }
  }, [demoBusy]);

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
      <IntroVisual size={visualSize} active={active} />
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
              Track what matters and see how everything connects in one
              place.
            </Text>
          </Reveal>
        <Reveal delay={860}>
          <View style={styles.phases} accessibilityRole="progressbar" accessibilityLabel="3 quick phases">
            <View style={[styles.phase, styles.phaseOn]}>
              <Text style={[styles.phaseNum, styles.phaseNumOn]}>1</Text>
              <Text style={[styles.phaseText, styles.phaseTextOn]}>Register your identity</Text>
            </View>
            <View style={styles.phase}>
              <Text style={styles.phaseNum}>2</Text>
              <Text style={styles.phaseText}>Configure your studio</Text>
            </View>
            <View style={styles.phase}>
              <Text style={styles.phaseNum}>3</Text>
              <Text style={styles.phaseText}>Finalize your profile</Text>
            </View>
          </View>
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
      <ProgressGraphVisual size={visualSize} active={active} />
      <View key={active ? 'system-copy-on' : 'system-copy-off'} style={styles.copy}>
        <Reveal delay={580}>
          <Text style={styles.overline}>ONE HEALTH SYSTEM</Text>
        </Reveal>
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
            Connect your health data and understand how everything changes over time.
          </Text>
        </Reveal>
        <Reveal delay={880}>
          <View style={styles.phases} accessibilityRole="progressbar" accessibilityLabel="3 quick phases">
            <View style={[styles.phase, styles.phaseOn]}>
              <Text style={[styles.phaseNum, styles.phaseNumOn]}>1</Text>
              <Text style={[styles.phaseText, styles.phaseTextOn]}>Register your identity</Text>
            </View>
            <View style={styles.phase}>
              <Text style={styles.phaseNum}>2</Text>
              <Text style={styles.phaseText}>Configure your studio</Text>
            </View>
            <View style={styles.phase}>
              <Text style={styles.phaseNum}>3</Text>
              <Text style={styles.phaseText}>Finalize your profile</Text>
            </View>
          </View>
        </Reveal>
      </View>
    </ScrollView>
  );

  const renderValue = (active: boolean): React.ReactNode => (
    <ScrollView
      contentContainerStyle={styles.pageScroll}
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      <ValueStackVisual active={active} />
      <View key={active ? 'value-copy-on' : 'value-copy-off'} style={styles.copy}>
        <Reveal delay={880}>
          <View style={styles.phases} accessibilityRole="progressbar" accessibilityLabel="Step 3 of 4">
            <View style={styles.phase}>
              <Text style={styles.phaseNum}>1</Text>
              <Text style={styles.phaseText}>Connect</Text>
            </View>
            <View style={styles.phase}>
              <Text style={styles.phaseNum}>2</Text>
              <Text style={styles.phaseText}>See all</Text>
            </View>
            <View style={[styles.phase, styles.phaseOn]}>
              <Text style={[styles.phaseNum, styles.phaseNumOn]}>3</Text>
              <Text style={[styles.phaseText, styles.phaseTextOn]}>One price</Text>
            </View>
            <View style={styles.phase}>
              <Text style={styles.phaseNum}>4</Text>
              <Text style={styles.phaseText}>Be early</Text>
            </View>
          </View>
        </Reveal>
      </View>
    </ScrollView>
  );

  const renderEarly = (active: boolean): React.ReactNode => (
    <ScrollView
      contentContainerStyle={styles.pageScroll}
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      <EarlyBirdVisual active={active} />
      <View key={active ? 'early-copy-on' : 'early-copy-off'} style={styles.copy}>
        <Reveal delay={880}>
          <View style={styles.phases} accessibilityRole="progressbar" accessibilityLabel="Step 4 of 4">
            <View style={styles.phase}>
              <Text style={styles.phaseNum}>1</Text>
              <Text style={styles.phaseText}>Connect</Text>
            </View>
            <View style={styles.phase}>
              <Text style={styles.phaseNum}>2</Text>
              <Text style={styles.phaseText}>See all</Text>
            </View>
            <View style={styles.phase}>
              <Text style={styles.phaseNum}>3</Text>
              <Text style={styles.phaseText}>One price</Text>
            </View>
            <View style={[styles.phase, styles.phaseOn]}>
              <Text style={[styles.phaseNum, styles.phaseNumOn]}>4</Text>
              <Text style={[styles.phaseText, styles.phaseTextOn]}>Be early</Text>
            </View>
          </View>
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
          Sign In
        </Text>

        <Text style={styles.formSubtitle}>
          Sign in to open your dashboard
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
            <Text style={styles.linkText}>Forgot Password?</Text>
          </Pressable>
        </View>

        <Button
          title="Sign In"
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
          {"Don't have an account? "}

          <Text
            style={styles.toggleLink}
            onPress={() => goAuth('signup')}
          >
            Sign Up
          </Text>
        </Text>
      </View>

        <View
          style={styles.toggleContainer}
      >
        <Text style={styles.toggleText}>
          {"Just looking around? "}

          <Text
            style={styles.toggleLink}
            onPress={() => void handleDemo()}
          >
            {demoBusy ? 'Preparing demo…' : 'Try the demo'}
          </Text>
        </Text>
      </View>
    </>
  );

  const renderSignupView = (): React.ReactNode => (
    <>
      <View style={styles.authPhase}>
        <Text style={styles.authPhaseText}>Step 3 of 3 · Create New Profile</Text>
      </View>
      <GlassCard>
        <Text style={styles.formTitle}>
          Create Account
        </Text>

        <Text style={styles.formSubtitle}>
          Takes less than a minute.
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
          Forgot Password?
        </Text>

        <Text style={styles.formSubtitle}>
          Enter your account email and we will send a reset link.
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
          {`A reset link is on its way to ${email.trim()}. Didn't get it? Check spam, then resend below.`}
        </Text>

        {renderAuthErrors()}

        <Button
          title={resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend Link'}
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

        <Card
          style={styles.disclaimerCard}
          padding="sm"
        >
          <Pressable
            onPress={() => setLegalOpen(previous => !previous)}
            accessibilityRole="button"
            accessibilityState={{ expanded: legalOpen }}
            accessibilityLabel="Important disclaimer"
            style={({ pressed }) => [
              styles.disclaimerHead,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={styles.disclaimerTitle}>
              Important Disclaimer
            </Text>
            <Text style={styles.disclaimerChev}>{legalOpen ? '▾' : '›'}</Text>
          </Pressable>

          {legalOpen ? (
            <Text style={styles.disclaimerText}>
              {MEDICAL_DISCLAIMER}
            </Text>
          ) : null}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const renderPage = ({ item }: { item: number }): React.ReactElement => (
    <View style={{ width, flex: 1 }}>
      {item === 0 ? renderIntro(step === 0) : null}
      {item === 1 ? renderSystem(step === 1) : null}
      {item === 2 ? renderValue(step === 2) : null}
      {item === 3 ? renderEarly(step === 3) : null}
      {item === 4 ? renderAuth() : null}
    </View>
  );

  const onAuth = step === 4;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <View style={styles.root}>
      {/* Stage wash at the very bottom (auth page + any film fallback). */}
      <StageGradient variant="algae" />
      {/* Fullscreen story film above the wash, below the content. */}
      {!reducedMotion && step < 2 && (!heroFailed || !systemFailed) ? (
        <View style={styles.filmLayer} pointerEvents="none">
          {!heroFailed ? (
            <VideoView
              player={heroPlayer}
              style={[styles.film, step === 0 && heroReady && styles.filmOn]}
              contentFit="cover"
              nativeControls={false}
            />
          ) : null}
          {!systemFailed ? (
            <VideoView
              player={systemPlayer}
              style={[styles.film, step === 1 && systemReady && styles.filmOn]}
              contentFit="cover"
              nativeControls={false}
            />
          ) : null}
          <View style={styles.filmScrim} />
        </View>
      ) : null}
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Top bar: progress on story pages, back on auth. */}
      <View style={styles.topBar}>
        {onAuth ? (
          <>
            <Pressable
              onPress={() => goTo(3)}
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
              onPress={() => goTo(4)}
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
                  step === 2
                    ? 'Continue to early access'
                    : step === 3
                      ? 'Continue to sign in'
                      : step === 0
                    ? 'Continue to see the bigger picture'
                    : 'Continue to value'
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
    backgroundColor: LG.stage,
  },

  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  // Fullscreen film: both features mounted, active one opaque.
  filmLayer: {
    ...StyleSheet.absoluteFill,
  },

  film: {
    ...StyleSheet.absoluteFill,
    opacity: 0,
  },

  filmOn: {
    opacity: 1,
  },

  // Readability scrim over the film (heavier at the bottom, like a fade).
  filmScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(2, 4, 12, 0.42)',
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

  // --------------------------------------------------------------------------
  // Showcase hero treatment (mirrors aurora-onboarding-showcase.html):
  // fullscreen root film + readability scrim + glowing italic accent line.
  // --------------------------------------------------------------------------

  headlineShowcase: {
    fontFamily: FONT.semi,
    fontSize: 40,
    lineHeight: 46,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
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
    ...TYPE.body,
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
    fontFamily: FONT.semi,
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

  // Liquid-glass form panel (sidebar material): frosted blur, brand
  // tint, hairline light edge. Content stays white-on-glass.
  glassCard: {
    width: '100%',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },

  glassFill: {
    ...StyleSheet.absoluteFill,
  },

  glassTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(11, 74, 63, 0.62)',
  },

  glassSolid: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },

  glassContent: {
    padding: 24,
  },

  formTitle: {
    ...TYPE.title,
    color: '#FFFFFF',
    marginBottom: 8,
  },

  formSubtitle: {
    ...TYPE.body,
    color: GV.fog,
    marginBottom: 16,
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
    fontFamily: FONT.semi,
    fontSize: 13,
    lineHeight: 18,
    color: GV.cta,
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
    backgroundColor: GV.teal,
    borderColor: GV.teal,
  },

  tick: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },

  checkLabel: {
    fontFamily: FONT.medium,
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

  passwordToggle: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },

  passwordToggleText: {
    fontFamily: FONT.semi,
    fontSize: 13,
    lineHeight: 18,
    color: GV.cta,
  },

  phases: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
  },

  phase: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },

  phaseOn: {
    backgroundColor: '#FFFFFF',
  },

  phaseNum: {
    width: 20,
    height: 20,
    borderRadius: 10,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontFamily: FONT.semi,
    fontSize: 11,
    lineHeight: 20,
    color: 'rgba(255, 255, 255, 0.6)',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },

  phaseNumOn: {
    color: '#FFFFFF',
    backgroundColor: GV.stage,
  },

  phaseText: {
    fontFamily: FONT.semi,
    fontSize: 11,
    lineHeight: 16,
    color: 'rgba(255, 255, 255, 0.75)',
  },

  phaseTextOn: {
    color: GV.stage,
  },

  authPhase: {
    alignSelf: 'center',
    marginBottom: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },

  authPhaseText: {
    fontFamily: FONT.semi,
    fontSize: 12,
    lineHeight: 16,
    color: '#FFFFFF',
    textAlign: 'center',
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

  disclaimerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
  },

  disclaimerChev: {
    fontSize: 20,
    color: GV.body,
  },

  disclaimerTitle: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    color: GV.ink,
  },

  disclaimerText: {
    ...TYPE.caption,
    color: GV.body,
    marginTop: 8,
  },
});
