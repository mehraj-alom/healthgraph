import React from 'react';
import {
  ActivityIndicator,
  AppState,
  LogBox,
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

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';

import { AuthProvider, useAuth } from '@/context/AuthContext';
import { AnatomyProvider } from '@/context/AnatomyContext';
import { DocumentsProvider } from '@/context/DocumentsContext';

import { ThemeProvider } from '@/theme';
import { ToastProvider } from '@/components';
import { UmbrellaTabBar } from '@/components';

import OnboardingScreen from '@/screens/Onboarding/OnboardingScreen';
import HealthDashboardScreen from '@/screens/Dashboard/HealthDashboardScreen';
import VitalsLoggerScreen from '@/screens/VitalsLogger/VitalsLoggerScreen';
import TimelineScreen from '@/screens/Timeline/TimelineScreen';
import ChatScreen from '@/screens/Chat/ChatScreen';
import DocumentUploadScreen from '@/screens/Documents/DocumentUploadScreen';
import DocumentDetailScreen from '@/screens/Documents/DocumentDetailScreen';
import SettingsScreen from '@/screens/Settings/SettingsScreen';
import HealthGraphScreen from '@/screens/Body/HealthGraphScreen';
import MedicationsScreen from '@/screens/Medications/MedicationsScreen';
import PpgMeasureScreen from '@/screens/PpgMeasure/PpgMeasureScreen';
import ImproveScreen from '@/screens/Dashboard/ImproveScreen';

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
import { TrendRangeProvider } from '@/context/TrendRangeContext';


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
      <Tab.Screen name="PpgMeasure" component={PpgMeasureScreen} />
      <Tab.Screen name="Chat" component={ChatScreen} />
    </Tab.Navigator>
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

  React.useEffect(() => {
    if (user !== null) return;
    queryClient.removeQueries({
      predicate: (query) => ['bodyState', 'daily-metrics', 'timeline'].includes(String(query.queryKey[0])),
    });
  }, [user]);

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
    const startupSync = async () => {
      await retryFailedSyncs();
      await syncPendingMutations();
    };
    startupSync().catch(() => {});

    // Sync on foreground transition
    const appSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && isOnline()) {
        syncPendingMutations().catch(() => {});
      }
    });

    // Sync on network recovery
    const networkUnsubscribe = subscribeNetwork(() => {
      if (isOnline()) {
        syncPendingMutations().catch(() => {});
      }
    });

    return () => {
      appSubscription.remove();
      networkUnsubscribe();
      cleanupNetworkMonitor();
    };
  }, [user]);

  /* --------------------------------------------------------------------------
   * Firebase authentication state is still restoring.
   * ------------------------------------------------------------------------ */

  if (loading) {
    return (
      <View
        style={
          styles.loadingContainer
        }
      >
        <ActivityIndicator
          size="large"
          color={COLORS.primary}
        />

        <Text
          style={
            styles.loadingText
          }
        >
          Loading healthgraph...
        </Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
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
        ) : (
          <>
            <RootStack.Screen
              name="Main"
              component={MainTabs}
            />
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
                headerTitle: 'Account',
                headerTintColor: COLORS.primary,
                headerStyle: { backgroundColor: COLORS.background },
              }}
            />
            <RootStack.Screen
              name="DocumentUpload"
              component={DocumentUploadScreen}
              options={{
                headerShown: true,
                headerTitle: 'Upload Document',
                headerTintColor: COLORS.primary,
                headerStyle: { backgroundColor: COLORS.background },
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

    alignItems: 'center',

    justifyContent: 'center',

    backgroundColor:
      COLORS.background,

    paddingHorizontal: 24,
  },

  loadingText: {
    marginTop: 16,

    fontSize: 16,

    color:
      COLORS.textSecondary,
  },
});
