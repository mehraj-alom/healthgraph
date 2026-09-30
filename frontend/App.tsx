import React, { useEffect, useRef } from 'react';
import {
  Animated,
  AppState,
  Easing,
  Image,
  LogBox,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';

// Benign native-module noise, not app errors:
// - EXGL pixelStorei: three.js sets an unpack flag expo-gl intentionally stubs.
// - ExpoGL "context is not registered (yet)": surface-setup race when the
//   embedded 3D view remounts during fast list scrolling.
LogBox.ignoreLogs([
  'gl.pixelStorei',
  'is not registered (yet); skipping surface setup',
]);

import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { FONT } from '@/theme/guava';

import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';

import { AuthProvider, useAuth } from '@/context/AuthContext';
import { AnatomyProvider } from '@/context/AnatomyContext';
import { DocumentsProvider } from '@/context/DocumentsContext';

import { ThemeProvider, useReducedMotion } from '@/theme';
import { BootSplash, ToastProvider } from '@/components';
import { HealthFact } from '@/components/HealthFact';
import { UmbrellaTabBar } from '@/components';
import Svg, { Circle } from 'react-native-svg';

import OnboardingScreen from '@/screens/Onboarding/OnboardingScreen';
import OnboardingSetupScreen from '@/screens/Onboarding/OnboardingSetupScreen';
import PricingScreen, {
  clearPricingNeeded,
  shouldShowPricing,
} from '@/screens/Onboarding/PricingScreen';
import HealthDashboardScreen from '@/screens/Dashboard/HealthDashboardScreen';
import VitalsLoggerScreen from '@/screens/VitalsLogger/VitalsLoggerScreen';
import TimelineScreen from '@/screens/Timeline/TimelineScreen';
import ChatScreen from '@/screens/Chat/ChatScreen';
import DocumentUploadScreen from '@/screens/Documents/DocumentUploadScreen';
import DocumentDetailScreen from '@/screens/Documents/DocumentDetailScreen';
import DocumentsScreen from '@/screens/Documents/DocumentsScreen';
import SettingsScreen from '@/screens/Settings/SettingsScreen';
import HealthGraphScreen from '@/screens/Body/HealthGraphScreen';
import MedicationsScreen from '@/screens/Medications/MedicationsScreen';
import MedicationReminderScreen from '@/screens/Medications/MedicationReminderScreen';
import MedicationCallScreen from '@/screens/Medications/MedicationCallScreen';
import VoiceCheckinScreen from '@/screens/VoiceCheckin/VoiceCheckinScreen';
import SattsTestScreen from '@/screens/Voice/SattsTestScreen';
import VoiceTurnScreen from '@/screens/Voice/VoiceTurnScreen';
import SymptomMapScreen from '@/screens/Body/SymptomMapScreen';
import PulseInstrumentScreen from '@/screens/PpgMeasure/PulseInstrumentScreen';
import ImproveScreen from '@/screens/Dashboard/ImproveScreen';
import FoodScanScreen from '@/screens/FoodScan/FoodScanScreen';
import PrescriptionScannerScreen from '@/screens/Medications/PrescriptionScannerScreen';
import PrescriptionReviewScreen from '@/screens/Medications/PrescriptionReviewScreen';
import HealthAreasScreen from '@/screens/HealthAreas/HealthAreasScreen';
import SubstanceScreen from '@/screens/Substance/SubstanceScreen';
import CycleScreen from '@/screens/Cycle/CycleScreen';
import SleepEngineScreen from '@/screens/SleepEngine/SleepEngineScreen';
import WeightEngineScreen from '@/screens/WeightEngine/WeightEngineScreen';
import DisciplineEngineScreen from '@/screens/DisciplineEngine/DisciplineEngineScreen';
import FitnessEngineScreen from '@/screens/FitnessEngine/FitnessEngineScreen';
import NutritionEngineScreen from '@/screens/NutritionEngine/NutritionEngineScreen';
import WellbeingEngineScreen from '@/screens/WellbeingEngine/WellbeingEngineScreen';
import HeartEngineScreen from '@/screens/HeartEngine/HeartEngineScreen';
import RecoveryScreen from '@/screens/Recovery/RecoveryScreen';
import PriorityWorldScreen from '@/screens/Priority/PriorityWorldScreen';

// Lazy-load the 3D Body screen to keep Three.js/expo-gl code out of the main bundle
// and prevent the WebGL renderer from blocking app startup on Android.
const LazyBodyScreen = React.lazy(() => import('@/screens/Body/BodyScreen'));

function BodyScreenWrapper() {
  return (
    <React.Suspense fallback={null}>
      <LazyBodyScreen />
    </React.Suspense>
  );
}

import { COLORS } from '@/constants';
import type { RootStackParamList, MainTabParamList } from '@/types';
import { syncPendingMutations, retryFailedSyncs } from '@/services/syncEngine';
import { initNetworkMonitor, cleanupNetworkMonitor, subscribe as subscribeNetwork, isOnline } from '@/services/networkMonitor';
import { initSyncState, clearSyncState } from '@/services/syncState';
import { getCachedPatientId } from '@/services/patientIdentity';
import { waitForIdentityReady } from '@/services/backendIdentity';
import { subscribeDataRefresh } from '@/services/dataRefresh';
import { TrendRangeProvider } from '@/context/TrendRangeContext';
import {
  notificationListeners,
  parseReminderTap,
  setReminderNotificationHandler,
} from '@/services/reminderNotifications';
import { reconcileMedicationReminders } from '@/services/medicationReminders';
import { isVoiceCheckinTap } from '@/services/voiceCheckin/schedule';


/* ============================================================================
 * Navigation types
 * ========================================================================== */

const RootStack =
  createNativeStackNavigator<RootStackParamList>();

const Tab =
  createBottomTabNavigator<MainTabParamList>();

/* ============================================================================
 * React Query
 * ========================================================================== */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/* ============================================================================
 * Medication reminder bridge (local notifications → reminder screen)
 * ========================================================================== */

/**
 * OS-driven only: foreground delivery opens the call-like screen, taps
 * and shade actions route to it (shortcuts auto-run once there). No
 * polling, no timers — listeners are subscriptions with cleanup. The
 * expo-notifications package is loaded lazily (never statically) so
 * Expo Go — where its native modules don't exist — never evaluates it.
 */
function ReminderBridge() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const seen = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    let onReceived: { remove: () => void } | null = null;
    let onResponse: { remove: () => void } | null = null;
    void (async () => {
      const { isReminderRuntimeSupported } = await import(
        '@/services/reminderNotifications'
      );
      if (cancelled || !isReminderRuntimeSupported()) return;
      const { DEFAULT_ACTION_IDENTIFIER } = await import('expo-notifications');
      if (cancelled) return;
      setReminderNotificationHandler();
      onReceived = notificationListeners.addReceivedListener((event) => {
        if (AppState.currentState !== 'active') return;
        const data = event.request.content.data;
        if (isVoiceCheckinTap(data)) {
          navigation.navigate('VoiceCheckin', { mode: 'ringing' });
          return;
        }
        const parsed = parseReminderTap(
          event.request.content.data,
          DEFAULT_ACTION_IDENTIFIER,
          getCachedPatientId(),
          DEFAULT_ACTION_IDENTIFIER,
        );
        if (!parsed || seen.current.has(parsed.occurrenceId)) return;
        seen.current.add(parsed.occurrenceId);
        // Foreground delivery auto-presents the incoming-call experience.
        navigation.navigate('MedicationCall', { occurrenceId: parsed.occurrenceId });
      });
      onResponse = notificationListeners.addResponseListener((response) => {
        if (isVoiceCheckinTap(response.notification.request.content.data)) {
          navigation.navigate('VoiceCheckin', { mode: 'ringing' });
          return;
        }
        const parsed = parseReminderTap(
          response.notification.request.content.data,
          response.actionIdentifier,
          getCachedPatientId(),
          DEFAULT_ACTION_IDENTIFIER,
        );
        if (!parsed) return;
        if (parsed.action === 'open') {
          // Tap (foreground banner, lock screen, notification center) opens
          // the call UI; the call screen stale-guards already-handled rows.
          navigation.navigate('MedicationCall', { occurrenceId: parsed.occurrenceId });
        } else {
          // Shade shortcuts keep their existing auto-run behavior.
          navigation.navigate('MedicationReminder', {
            occurrenceId: parsed.occurrenceId,
            action: parsed.action,
          });
        }
      });
      // Cold-start drain: a tap that launched a dead app never reaches the
      // listeners above. Drain the last response once so it routes the same.
      try {
        const { getLastNotificationResponseAsync } = await import('expo-notifications');
        const last = await getLastNotificationResponseAsync().catch(() => null);
        if (!cancelled && last) {
          if (isVoiceCheckinTap(last.notification.request.content.data)) {
            navigation.navigate('VoiceCheckin', { mode: 'ringing' });
            return;
          }
          const parsed = parseReminderTap(
            last.notification.request.content.data,
            last.actionIdentifier,
            getCachedPatientId(),
            DEFAULT_ACTION_IDENTIFIER,
          );
          if (parsed && !seen.current.has(parsed.occurrenceId)) {
            seen.current.add(parsed.occurrenceId);
            if (parsed.action === 'open') {
              navigation.navigate('MedicationCall', { occurrenceId: parsed.occurrenceId });
            } else {
              navigation.navigate('MedicationReminder', {
                occurrenceId: parsed.occurrenceId,
                action: parsed.action,
              });
            }
          }
        }
      } catch {
        // Cold-start routing is best-effort; the notification stays visible.
      }
    })();
    return () => {
      cancelled = true;
      onReceived?.remove();
      onResponse?.remove();
    };
  }, [navigation]);
  return null;
}

/* ============================================================================
 * Main authenticated application
 * ========================================================================== */

function MainTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Dashboard"
      tabBar={(props) => <UmbrellaTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tab.Screen name="Dashboard" component={HealthDashboardScreen} />
      {/* Pulse entry: method selector (fingertip PPG vs face rPPG). The
          red tab button lands here; each method pushes its own flow. */}
      <Tab.Screen name="PpgMeasure" component={PulseInstrumentScreen} />
      {/* Chat is a full-screen surface: the dock never mounts there and
          the system back button handles exit. */}
      <Tab.Screen
        name="Chat"
        component={ChatScreen}
      />
    </Tab.Navigator>
  );
}

/* ============================================================================
 * Loading screen — black skill backdrop, assembling logo, buffering ring,
 * quote pinned to the bottom on a long rotation so it can be read.
 * ========================================================================== */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOADING_LOGO = require('./assets/logo.png');
const LOGO_W = 220;
const LOGO_H = 56;

function LoadingScreen() {
  const reduced = useReducedMotion();
  // Logo starts split apart and comes together on mount.
  const assemble = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  // Buffering ring spins while loading.
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      assemble.setValue(1);
      return;
    }
    Animated.timing(assemble, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, assemble, spin]);

  const leftHalf = {
    opacity: assemble,
    transform: [
      {
        translateX: assemble.interpolate({
          inputRange: [0, 1],
          outputRange: [-26, 0],
        }),
      },
    ],
  };
  const rightHalf = {
    opacity: assemble,
    transform: [
      {
        translateX: assemble.interpolate({
          inputRange: [0, 1],
          outputRange: [26, 0],
        }),
      },
    ],
  };
  const ringSpin = {
    transform: [
      {
        rotate: spin.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', '360deg'],
        }),
      },
    ],
  };

  return (
    <View
      style={styles.loadingContainer}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading HealthGraph"
    >
      <View style={styles.loadingTop} />
      <View style={styles.loadingMiddle}>
        <View style={styles.logoRow} accessibilityLabel="HealthGraph">
          <Animated.View style={[styles.logoHalf, leftHalf]}>
            <Image
              source={LOADING_LOGO}
              style={[styles.logoImg, { left: 0 }]}
              resizeMode="contain"
            />
          </Animated.View>
          <Animated.View style={[styles.logoHalf, rightHalf]}>
            <Image
              source={LOADING_LOGO}
              style={[styles.logoImg, { left: -LOGO_W / 2 }]}
              resizeMode="contain"
            />
          </Animated.View>
        </View>
        <Animated.View style={[styles.ring, ringSpin]}>
          <Svg width={76} height={76} viewBox="0 0 76 76">
            <Circle
              cx={38}
              cy={38}
              r={30}
              stroke="rgba(255, 255, 255, 0.12)"
              strokeWidth={5}
              fill="none"
            />
            <Circle
              cx={38}
              cy={38}
              r={30}
              stroke="#4FD1C5"
              strokeWidth={5}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${2 * Math.PI * 30 * 0.28} ${2 * Math.PI * 30}`}
            />
          </Svg>
        </Animated.View>
        <Text style={styles.loadingText}>Loading HealthGraph</Text>
      </View>
      <View style={styles.loadingBottom}>
        <HealthFact style={styles.factText} />
      </View>
    </View>
  );
}

/* ============================================================================
 * Authentication-aware root navigator
 * ========================================================================== */

function AppNavigator() {
  const {
    user,
    loading,
  } = useAuth();

  // Account switch isolation: the previous user's server-backed caches must
  // never serve the next user (query keys are not patient-scoped). Clear
  // EVERYTHING — not a key subset — and cancel in-flight fetches so a late
  // response cannot repopulate the cache after logout. SQLite tables stay on
  // disk (product semantics: pending rows must survive) but are all
  // patient-scoped at query time, and the sync queue is owner-filtered.
  React.useEffect(() => {
    if (user !== null) return;
    queryClient.cancelQueries().catch(() => {});
    queryClient.clear();
  }, [user]);

  // Post-auth setup gate: first-run patients see the personalization flow
  // (goals → focus → momentum → done) exactly once; established users are
  // grandfathered past it (see resolveOnboardingGateDb). Focus-free on
  // purpose — this runs above NavigationContainer, so no useFocusEffect.
  // Completion propagates via dataRefresh (same signal the hook uses).
  const [setupNeeded, setSetupNeeded] = React.useState(false);
  const [setupChecked, setSetupChecked] = React.useState(false);
  React.useEffect(() => {
    if (!user) {
      setSetupNeeded(false);
      setSetupChecked(true);
      return;
    }
    let cancelled = false;
    const check = async () => {
      try {
        await waitForIdentityReady().catch(() => {});
        const patientId = getCachedPatientId();
        if (!patientId) {
          if (!cancelled) {
            setSetupNeeded(false);
            setSetupChecked(true);
          }
          return;
        }
        const { resolveOnboardingGateDb } = await import('@/db/queries/onboarding');
        const gate = await resolveOnboardingGateDb(patientId);
        if (!cancelled) {
          setSetupNeeded(gate.needed);
          setSetupChecked(true);
        }
      } catch {
        // Fail open: onboarding infra must never block the app.
        if (!cancelled) {
          setSetupNeeded(false);
          setSetupChecked(true);
        }
      }
    };
    void check();
    const unsubscribe = subscribeDataRefresh(() => {
      setSetupChecked(false);
      void check();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user?.uid]);

  // Post-signup pricing gate: a brand-new signup sees the pricing screen
  // exactly once. Login never sets the flag, and sign-out clears it, so
  // established users are never interrupted. Fail open everywhere: any
  // storage failure resolves to "no pricing" and the app proceeds.
  const [pricingNeeded, setPricingNeeded] = React.useState(false);
  const [pricingChecked, setPricingChecked] = React.useState(false);
  React.useEffect(() => {
    if (!user) {
      setPricingNeeded(false);
      setPricingChecked(true);
      clearPricingNeeded().catch(() => {});
      return;
    }
    let cancelled = false;
    shouldShowPricing()
      .then(needed => {
        if (!cancelled) {
          setPricingNeeded(needed);
          setPricingChecked(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPricingNeeded(false);
          setPricingChecked(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  const handlePricingDone = React.useCallback(() => {
    setPricingNeeded(false);
  }, []);

  // Initialize network monitor and sync on lifecycle events
  React.useEffect(() => {
    if (!user) {
      clearSyncState();
      return;
    }

    // Initialize network monitor
    initNetworkMonitor();

    // Initialize sync state
    initSyncState();

    // Self-heal + sync on startup (after authentication).
    // retryFailedSyncs() resets any 'failed' rows (left from crashes, older
    // builds that misclassified transient failures as failed, or a previous
    // permanent failure) back to 'pending' so the sync pass re-attempts them.
    // True permanent failures are re-classified as 'failed' right after.
    // Deferred past first paint so the startup flush does not compete with
    // Dashboard mount IO (SQLite open + migrations + initial reads).
    const startupSyncTimer = setTimeout(() => {
      const startupSync = async () => {
        await retryFailedSyncs();
        await syncPendingMutations();
        // Reminder reconciliation rides the same deferred startup slot:
        // schedules are derived locally, so this works fully offline.
        const patientId = getCachedPatientId();
        if (patientId) {
          await reconcileMedicationReminders(patientId).catch(() => {});
        }
      };
      startupSync().catch(() => {});
    }, 2500);

    // Sync on foreground transition (reminders reconcile here too: the
    // wall-clock derivation re-absorbs DST/timezone shifts on return).
    const appSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        if (isOnline()) {
          syncPendingMutations().catch(() => {});
        }
        const patientId = getCachedPatientId();
        if (patientId) {
          void reconcileMedicationReminders(patientId);
        }
      }
    });

    // Sync on network recovery
    const networkUnsubscribe = subscribeNetwork(() => {
      if (isOnline()) {
        syncPendingMutations().catch(() => {});
      }
    });

    return () => {
      clearTimeout(startupSyncTimer);
      appSubscription.remove();
      networkUnsubscribe();
      cleanupNetworkMonitor();
    };
  }, [user]);

  /* --------------------------------------------------------------------------
   * Firebase authentication state is still restoring, or the per-patient
   * setup gate has not resolved yet (fast SQLite read — avoids flashing
   * Main before a first-run patient is routed to setup), or the one-shot
   * post-signup pricing flag has not been read yet.
   * ------------------------------------------------------------------------ */

  if (loading || (user && (!pricingChecked || (!pricingNeeded && !setupChecked)))) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer>
      <ReminderBridge />
      <RootStack.Navigator
        key={user ? 'authenticated' : 'unauthenticated'}
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: {
            backgroundColor:
              COLORS.background,
          },
        }}
      >
        {!user ? (
          <RootStack.Screen
            name="Onboarding"
            component={OnboardingScreen}
          />
        ) : pricingNeeded ? (
          <RootStack.Screen
            name="Pricing"
            options={{
              headerShown: false,
            }}
          >
            {() => <PricingScreen onDone={handlePricingDone} />}
          </RootStack.Screen>
        ) : setupNeeded ? (
          <RootStack.Screen
            name="OnboardingSetup"
            component={OnboardingSetupScreen}
          />
        ) : (
          <>
            <RootStack.Screen
              name="Main"
              component={MainTabs}
            />
            {/* Call-like local medication reminder (one dose occurrence). */}
            <RootStack.Screen
              name="MedicationReminder"
              component={MedicationReminderScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Incoming-call medication reminder (same engine, call UX). */}
            <RootStack.Screen
              name="MedicationCall"
              component={MedicationCallScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Scheduled voice check-in call (setup, ringing, interview). */}
            <RootStack.Screen
              name="VoiceCheckin"
              component={VoiceCheckinScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Isolated sanoTTS test (dev only, disconnected from call flow). */}
            <RootStack.Screen
              name="SattsTest"
              component={SattsTestScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Isolated turn-based voice loop (dev only, no call flow). */}
            <RootStack.Screen
              name="VoiceTurn"
              component={VoiceTurnScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Face rPPG flow is hosted inside the unified pulse instrument
                (Pulse tab) — exactly one measurement path is ever active. */}
            <RootStack.Screen
              name="DailyLog"
              component={VitalsLoggerScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Timeline lives here — not in the tab bar. It opens only
                from the notification bell (and in-app links). */}
            <RootStack.Screen
              name="Timeline"
              component={TimelineScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* 3D Body lives here while out of the tab bar. Chat body-links
                and graph links resolve to this stack route. */}
            <RootStack.Screen
              name="Body"
              component={BodyScreenWrapper}
              options={{
                headerShown: false,
              }}
            />
            {/* Improve / Keep actions window from the dashboard duo. */}
            <RootStack.Screen
              name="Improve"
              component={ImproveScreen}
              options={{
                headerShown: false,
              }}
            />
            <RootStack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{
                headerShown: true,
                headerTitle: 'Settings',
                headerTintColor: COLORS.primary,
                headerStyle: { backgroundColor: COLORS.background },
              }}
            />
            <RootStack.Screen
              name="DocumentUpload"
              component={DocumentUploadScreen}
              options={{
                headerShown: false,
              }}
            />
            <RootStack.Screen
              name="Documents"
              component={DocumentsScreen}
              options={{
                headerShown: false,
              }}
            />
            <RootStack.Screen
              name="DocumentDetail"
              component={DocumentDetailScreen}
              options={{
                headerShown: true,
                headerTitle: 'Document Details',
                headerTintColor: COLORS.primary,
                headerStyle: { backgroundColor: COLORS.background },
              }}
            />
            <RootStack.Screen
              name="HealthGraph"
              component={HealthGraphScreen}
              options={{
                headerShown: false,
              }}
            />
            <RootStack.Screen
              name="Medications"
              component={MedicationsScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Symptom body map — stack route (no tab), local state only. */}
            <RootStack.Screen
              name="SymptomMap"
              component={SymptomMapScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Food photo calorie estimation — stack route (no tab). */}
            <RootStack.Screen
              name="FoodScan"
              component={FoodScanScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Guided multipage prescription capture (premium) — stack route. */}
            <RootStack.Screen
              name="PrescriptionScanner"
              component={PrescriptionScannerScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Confirm-or-tweak review of extracted prescription medicines. */}
            <RootStack.Screen
              name="PrescriptionReview"
              component={PrescriptionReviewScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Health-area hub (real-data availability per area). */}
            <RootStack.Screen
              name="HealthAreas"
              component={HealthAreasScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Setup flow is ALSO registered here (not only in the gate
                branch above): Settings links to it for review, which must
                work even when the gate resolved "no setup needed". The gate
                branch controls the automatic first-run routing only. */}
            <RootStack.Screen
              name="OnboardingSetup"
              component={OnboardingSetupScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Neutral substance-use tracking (device-only). */}
            <RootStack.Screen
              name="Substance"
              component={SubstanceScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Explicit cycle tracking (device-only, no predictions). */}
            <RootStack.Screen
              name="Cycle"
              component={CycleScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Sleep goal engine (device check-in data, tracking only). */}
            <RootStack.Screen
              name="SleepEngine"
              component={SleepEngineScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Weight goal engine (profile weight shell, tracking only). */}
            <RootStack.Screen
              name="WeightEngine"
              component={WeightEngineScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Discipline goal engine (tracked-action counts, tracking only). */}
            <RootStack.Screen
              name="DisciplineEngine"
              component={DisciplineEngineScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Fitness goal engine (logged activity, tracking only). */}
            <RootStack.Screen
              name="FitnessEngine"
              component={FitnessEngineScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Nutrition goal engine (logged meals, tracking only). */}
            <RootStack.Screen
              name="NutritionEngine"
              component={NutritionEngineScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Wellbeing goal engine (user-entered ratings, tracking only). */}
            <RootStack.Screen
              name="WellbeingEngine"
              component={WellbeingEngineScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Heart goal engine (camera measurements, tracking only). */}
            <RootStack.Screen
              name="HeartEngine"
              component={HeartEngineScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Overnight-recovery hint from the user's own baseline. */}
            <RootStack.Screen
              name="Recovery"
              component={RecoveryScreen}
              options={{
                headerShown: false,
              }}
            />
            {/* Priority world (selected engines + shared dial, tracking only). */}
            <RootStack.Screen
              name="Priority"
              component={PriorityWorldScreen}
              options={{
                headerShown: false,
              }}
            />
          </>
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

/* ============================================================================
 * Application root
 * ========================================================================== */

export default function App() {
  // Poppins loads under the boot video — first paint is already covered,
  // so there is no font-flash and no splash coordination needed.
  useFonts({
    [FONT.regular]: require('./assets/fonts/Poppins-Regular.ttf'),
    [FONT.medium]: require('./assets/fonts/Poppins-Medium.ttf'),
    [FONT.semi]: require('./assets/fonts/Poppins-SemiBold.ttf'),
    [FONT.bold]: require('./assets/fonts/Poppins-Bold.ttf'),
  });
  return (
    <SafeAreaProvider>
      <QueryClientProvider
        client={queryClient}
      >
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <AnatomyProvider>
                <DocumentsProvider>
                  <TrendRangeProvider>
                    <AppNavigator />
                    {/* Video boot animation over first paint: internal init
                        (auth restore, providers, navigation) runs underneath
                        and the overlay fades once ready — never blocking. */}
                    <BootSplash />
                  </TrendRangeProvider>
                </DocumentsProvider>
              </AnatomyProvider>
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/* ============================================================================
 * Styles
 * ========================================================================== */

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#080A11',
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 48,
  },
  loadingTop: {
    flex: 1,
  },
  loadingMiddle: {
    alignItems: 'center',
    gap: 20,
  },
  logoRow: {
    flexDirection: 'row',
    height: LOGO_H,
  },
  logoHalf: {
    width: LOGO_W / 2,
    height: LOGO_H,
    overflow: 'hidden',
  },
  logoImg: {
    position: 'absolute',
    top: 0,
    width: LOGO_W,
    height: LOGO_H,
  },
  ring: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#A7B8B2',
  },
  factText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#A7B8B2',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  loadingBottom: {
    flex: 1,
    justifyContent: 'flex-end',
  },
});
