import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';

import { AuthProvider, useAuth } from '@/context/AuthContext';
import { AnatomyProvider } from '@/context/AnatomyContext';
import { DocumentsProvider } from '@/context/DocumentsContext';

import OnboardingScreen from '@/screens/Onboarding/OnboardingScreen';
import DashboardScreen from '@/screens/Dashboard/DashboardScreen';
import VitalsLoggerScreen from '@/screens/VitalsLogger/VitalsLoggerScreen';
import TimelineScreen from '@/screens/Timeline/TimelineScreen';
import ChatScreen from '@/screens/Chat/ChatScreen';
import DocumentUploadScreen from '@/screens/Documents/DocumentUploadScreen';
import DocumentDetailScreen from '@/screens/Documents/DocumentDetailScreen';
import SettingsScreen from '@/screens/Settings/SettingsScreen';
import HealthGraphScreen from '@/screens/Body/HealthGraphScreen';
import MedicationsScreen from '@/screens/Medications/MedicationsScreen';

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
      screenOptions={{
        headerShown: false,

        tabBarActiveTintColor:
          COLORS.primary,

        tabBarInactiveTintColor:
          COLORS.textMuted,

        tabBarStyle: {
          backgroundColor:
            COLORS.surface,

          borderTopColor:
            COLORS.border,
          borderTopWidth: 1,

          height: 64,

          paddingBottom: 8,

          paddingTop: 6,
        },

        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },

        tabBarHideOnKeyboard: false,
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarLabel: 'Home',
        }}
      />

      <Tab.Screen
        name="DailyLog"
        component={VitalsLoggerScreen}
        options={{
          tabBarLabel: 'Daily Log',
        }}
      />

      <Tab.Screen
        name="Body"
        component={BodyScreenWrapper}
        options={{
          tabBarLabel: '3D Body',
        }}
      />

      <Tab.Screen
        name="Timeline"
        component={TimelineScreen}
        options={{
          tabBarLabel: 'Timeline',
        }}
      />

      <Tab.Screen
        name="Chat"
        component={ChatScreen}
        options={{
          tabBarLabel: 'Chat',
        }}
      />
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
          Loading MedGraph...
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
    <QueryClientProvider
      client={queryClient}
    >
      <AuthProvider>
        <AnatomyProvider>
          <DocumentsProvider>
            <AppNavigator />
          </DocumentsProvider>
        </AnatomyProvider>
      </AuthProvider>
    </QueryClientProvider>
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
