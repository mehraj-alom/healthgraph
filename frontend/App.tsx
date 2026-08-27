import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { NavigationContainer } from '@react-navigation/native';
import {
  createNativeStackNavigator,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AuthProvider, useAuth } from '@/context/AuthContext';
import OnboardingScreen from '@/screens/Onboarding/OnboardingScreen';
import VitalsLoggerScreen from '@/screens/VitalsLogger/VitalsLoggerScreen';
import ChatScreen from '@/screens/Chat/ChatScreen';

import { COLORS } from '@/constants';

/*
 * Add your other authenticated screens here when they exist.
 *
 * Example:
 * import DashboardScreen from '@/screens/Dashboard/DashboardScreen';
 * import TimelineScreen from '@/screens/Timeline/TimelineScreen';
 */

export type RootStackParamList = {
  Onboarding: undefined;
  Dashboard: undefined;
  Vitals: undefined;
  Timeline: undefined;
  Chat: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Authentication-aware navigation.
 *
 * Firebase AuthContext determines whether the user is authenticated.
 * Unauthenticated users see Onboarding.
 * Authenticated users see the application stack.
 */
function AppNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator
          size="large"
          color={COLORS.primary}
        />

        <Text style={styles.loadingText}>
          Loading MedGraph...
        </Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: COLORS.background,
          },
          animation: 'fade',
        }}
      >
        {!user ? (
          <Stack.Screen
            name="Onboarding"
            component={OnboardingScreen}
          />
        ) : (
          <>
            {/*
             * Temporary Dashboard route.
             *
             * Replace this with your real DashboardScreen when
             * that screen is ready.
             */}
            <Stack.Screen
              name="Dashboard"
              component={DashboardPlaceholder}
            />

            <Stack.Screen
              name="Vitals"
              component={VitalsLoggerScreen}
            />

            <Stack.Screen
              name="Chat"
              component={ChatScreen}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/**
 * Temporary authenticated landing screen.
 *
 * This prevents us from referencing a DashboardScreen that may
 * not yet exist in the frontend.
 */
function DashboardPlaceholder() {
  return (
    <View style={styles.dashboardContainer}>
      <Text style={styles.dashboardTitle}>
        MedGraph
      </Text>

      <Text style={styles.dashboardSubtitle}>
        Health Dashboard
      </Text>

      <Text style={styles.dashboardStatus}>
        Authentication successful
      </Text>
    </View>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 24,
  },

  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.textSecondary,
  },

  dashboardContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 24,
  },

  dashboardTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: 8,
  },

  dashboardSubtitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 12,
  },

  dashboardStatus: {
    fontSize: 15,
    color: COLORS.textSecondary,
  },
});