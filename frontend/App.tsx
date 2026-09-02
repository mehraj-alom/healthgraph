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

import OnboardingScreen from '@/screens/Onboarding/OnboardingScreen';
import DashboardScreen from '@/screens/Dashboard/DashboardScreen';
import VitalsLoggerScreen from '@/screens/VitalsLogger/VitalsLoggerScreen';
import TimelineScreen from '@/screens/Timeline/TimelineScreen';
import ChatScreen from '@/screens/Chat/ChatScreen';

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


/* ============================================================================
 * Navigation types
 * ========================================================================== */

export type MainTabParamList = {
  Dashboard: undefined;
  DailyLog: undefined;
  Body: undefined;
  Timeline: undefined;
  Chat: undefined;
};

export type RootStackParamList = {
  Onboarding: undefined;
  Main: undefined;
};

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
          COLORS.textSecondary,

        tabBarStyle: {
          backgroundColor:
            COLORS.background,

          borderTopColor:
            COLORS.border,

          height: 64,

          paddingBottom: 8,

          paddingTop: 6,
        },

        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },

        tabBarHideOnKeyboard: true,
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
          <RootStack.Screen
            name="Main"
            component={MainTabs}
          />
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
          <AppNavigator />
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
