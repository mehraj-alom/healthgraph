import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { Platform } from 'react-native';

import {
  initializeApp,
  getApp,
  getApps,
} from 'firebase/app';

import * as FirebaseAuth from 'firebase/auth';

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  getAuth,
  initializeAuth,
  type Auth,
  type User as FirebaseUser,
} from 'firebase/auth';

import { getFirestore } from 'firebase/firestore';

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  setItemAsync,
  deleteItemAsync,
} from 'expo-secure-store';

// =============================================================================
// Firebase configuration
// =============================================================================

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain:
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId:
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:
    process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// =============================================================================
// Firebase App
// =============================================================================

const app = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

// =============================================================================
// React Native Firebase persistence compatibility
// =============================================================================
//
// Firebase 12.x exposes getReactNativePersistence from the React Native
// runtime entry point, but some TypeScript configurations do not expose the
// symbol correctly through the public `firebase/auth` declaration.
//
// Runtime: function exists.
// TypeScript: cast the namespace to the expected API shape.
//
// This avoids:
//   TS2305: Module '"firebase/auth"' has no exported member
//   'getReactNativePersistence'.
//
// It also avoids importing:
//   firebase/auth/react-native
//
// because that subpath is not available in this Expo setup.
// =============================================================================

type ReactNativePersistenceFactory = (
  storage: typeof AsyncStorage,
) => FirebaseAuth.Persistence;

const getReactNativePersistence =
  (
    FirebaseAuth as unknown as {
      getReactNativePersistence:
        ReactNativePersistenceFactory;
    }
  ).getReactNativePersistence;

// =============================================================================
// Firebase Auth
// =============================================================================

const createFirebaseAuth = (): Auth => {
  // ---------------------------------------------------------------------------
  // Web
  // ---------------------------------------------------------------------------
  //
  // Web Firebase Auth should use its browser-specific default persistence.
  //
  // Do NOT call getReactNativePersistence() on Web.
  // ---------------------------------------------------------------------------

  if (Platform.OS === 'web') {
    return getAuth(app);
  }

  // ---------------------------------------------------------------------------
  // Android / iOS
  // ---------------------------------------------------------------------------
  //
  // Explicitly provide AsyncStorage so Firebase Auth persists the signed-in
  // user across application restarts.
  // ---------------------------------------------------------------------------

  try {
    return initializeAuth(app, {
      persistence:
        getReactNativePersistence(
          AsyncStorage,
        ),
    });
  } catch (error: unknown) {
    // Fast Refresh / Metro can re-evaluate this module while the Firebase
    // Auth provider is already initialized.
    //
    // Only recover from the already-initialized case.
    // Do NOT silently swallow other Firebase initialization errors.

    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code ===
        'auth/already-initialized'
    ) {
      return getAuth(app);
    }

    throw error;
  }
};

export const auth = createFirebaseAuth();

// =============================================================================
// Firestore
// =============================================================================

export const db = getFirestore(app);

// =============================================================================
// Types
// =============================================================================

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  createdAt: Date;
}

export interface AuthState {
  user: FirebaseUser | null;
  userProfile: UserProfile | null;
  loading: boolean;
  error: string | null;
}

export interface AuthContextType extends AuthState {
  signup: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<void>;

  login: (
    email: string,
    password: string,
  ) => Promise<void>;

  logout: () => Promise<void>;

  clearError: () => void;
}

// =============================================================================
// Context
// =============================================================================

const AuthContext =
  createContext<AuthContextType | undefined>(
    undefined,
  );

// =============================================================================
// Cross-platform application storage
// =============================================================================

/**
 * Stores application-level authentication data.
 *
 * Firebase Auth persistence itself is handled separately:
 *
 * Android/iOS:
 *   Firebase Auth -> AsyncStorage
 *
 * Web:
 *   Firebase Auth -> browser persistence
 *
 * This helper is for our own API token/user cache.
 */
const setAuthStorage = async (
  key: string,
  value: string,
): Promise<void> => {
  if (Platform.OS === 'web') {
    if (
      typeof window !== 'undefined' &&
      window.localStorage
    ) {
      window.localStorage.setItem(
        key,
        value,
      );
    }

    return;
  }

  await setItemAsync(key, value);
};

/**
 * Deletes application-level authentication data.
 */
const deleteAuthStorage = async (
  key: string,
): Promise<void> => {
  if (Platform.OS === 'web') {
    if (
      typeof window !== 'undefined' &&
      window.localStorage
    ) {
      window.localStorage.removeItem(key);
    }

    return;
  }

  await deleteItemAsync(key);
};

/**
 * Clears all application-level auth data.
 */
const clearAuthData = async (): Promise<void> => {
  try {
    await Promise.all([
      deleteAuthStorage(
        'access_token',
      ),
      deleteAuthStorage(
        'refresh_token',
      ),
      deleteAuthStorage(
        'user_data',
      ),
    ]);
  } catch (error) {
    console.error(
      '[MedGraph] Failed to clear auth data:',
      error,
    );
  }
};

// =============================================================================
// Auth Provider
// =============================================================================

export const AuthProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [user, setUser] =
    useState<FirebaseUser | null>(null);

  const [userProfile, setUserProfile] =
    useState<UserProfile | null>(null);

  const [loading, setLoading] =
    useState<boolean>(true);

  const [error, setError] =
    useState<string | null>(null);

  // ===========================================================================
  // Persist application user data
  // ===========================================================================

  const persistUserData = async (
    firebaseUser: FirebaseUser,
  ): Promise<void> => {
    try {
      const token =
        await firebaseUser.getIdToken();

      await setAuthStorage(
        'access_token',
        token,
      );

      if (firebaseUser.refreshToken) {
        await setAuthStorage(
          'refresh_token',
          firebaseUser.refreshToken,
        );
      }

      const userData = {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName:
          firebaseUser.displayName,
        createdAt:
          firebaseUser.metadata
            .creationTime ??
          new Date().toISOString(),
      };

      await setAuthStorage(
        'user_data',
        JSON.stringify(userData),
      );
    } catch (storageError) {
      console.error(
        '[MedGraph] Failed to persist auth data:',
        storageError,
      );
    }
  };

  // ===========================================================================
  // Auth state listener
  // ===========================================================================

  useEffect(() => {
    let mounted = true;

    const unsubscribe =
      onAuthStateChanged(
        auth,
        async firebaseUser => {
          if (!mounted) {
            return;
          }

          if (firebaseUser) {
            setUser(firebaseUser);

            const createdAt =
              firebaseUser.metadata
                .creationTime;

            const profile: UserProfile = {
              uid: firebaseUser.uid,
              email:
                firebaseUser.email ?? '',
              displayName:
                firebaseUser.displayName ??
                undefined,
              createdAt: createdAt
                ? new Date(createdAt)
                : new Date(),
            };

            setUserProfile(profile);

            await persistUserData(
              firebaseUser,
            );
          } else {
            setUser(null);
            setUserProfile(null);

            await clearAuthData();
          }

          if (mounted) {
            setLoading(false);
          }
        },
      );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  // ===========================================================================
  // Signup
  // ===========================================================================

  const signup = async (
    email: string,
    password: string,
    displayName?: string,
  ): Promise<void> => {
    setError(null);

    try {
      const cleanEmail =
        email.trim();

      const cleanName =
        displayName?.trim();

      // -----------------------------------------------------------------------
      // Create Firebase account
      // -----------------------------------------------------------------------

      const result =
        await createUserWithEmailAndPassword(
          auth,
          cleanEmail,
          password,
        );

      // -----------------------------------------------------------------------
      // Update Firebase display name
      // -----------------------------------------------------------------------

      if (cleanName) {
        await updateProfile(
          result.user,
          {
            displayName:
              cleanName,
          },
        );
      }

      // -----------------------------------------------------------------------
      // Get Firebase ID token
      // -----------------------------------------------------------------------

      const token =
        await result.user.getIdToken(
          true,
        );

      // -----------------------------------------------------------------------
      // Persist application auth data
      // -----------------------------------------------------------------------

      await setAuthStorage(
        'access_token',
        token,
      );

      if (result.user.refreshToken) {
        await setAuthStorage(
          'refresh_token',
          result.user.refreshToken,
        );
      }

      const userData = {
        uid: result.user.uid,
        email: result.user.email,
        displayName:
          result.user.displayName ??
          cleanName ??
          null,
        createdAt:
          result.user.metadata
            .creationTime ??
          new Date().toISOString(),
      };

      await setAuthStorage(
        'user_data',
        JSON.stringify(userData),
      );

      // -----------------------------------------------------------------------
      // Backend synchronization
      // -----------------------------------------------------------------------

      try {
        const { api } =
          await import(
            '@/services/api'
          );

        await api.post(
          '/api/v1/auth/sync',
          {},
          {
            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          },
        );
      } catch (backendError) {
        /*
         * Firebase signup succeeded.
         *
         * Backend synchronization is intentionally non-blocking so a
         * temporary backend outage does not incorrectly tell the user that
         * account creation failed.
         */
        console.error(
          '[MedGraph] Backend auth sync failed:',
          backendError,
        );
      }
    } catch (authError: unknown) {
      const message =
        authError instanceof Error
          ? authError.message
          : 'Signup failed';

      setError(message);

      throw authError;
    }
  };

  // ===========================================================================
  // Login
  // ===========================================================================

  const login = async (
    email: string,
    password: string,
  ): Promise<void> => {
    setError(null);

    try {
      const cleanEmail =
        email.trim();

      // -----------------------------------------------------------------------
      // Firebase login
      // -----------------------------------------------------------------------

      const result =
        await signInWithEmailAndPassword(
          auth,
          cleanEmail,
          password,
        );

      // -----------------------------------------------------------------------
      // Firebase ID token
      // -----------------------------------------------------------------------

      const token =
        await result.user.getIdToken(
          true,
        );

      // -----------------------------------------------------------------------
      // Persist application auth data
      // -----------------------------------------------------------------------

      await setAuthStorage(
        'access_token',
        token,
      );

      if (result.user.refreshToken) {
        await setAuthStorage(
          'refresh_token',
          result.user.refreshToken,
        );
      }

      const userData = {
        uid: result.user.uid,
        email: result.user.email,
        displayName:
          result.user.displayName,
        createdAt:
          result.user.metadata
            .creationTime ??
          new Date().toISOString(),
      };

      await setAuthStorage(
        'user_data',
        JSON.stringify(userData),
      );

      // -----------------------------------------------------------------------
      // Backend synchronization
      // -----------------------------------------------------------------------

      try {
        const { api } =
          await import(
            '@/services/api'
          );

        await api.post(
          '/api/v1/auth/sync',
          {},
          {
            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          },
        );
      } catch (backendError) {
        /*
         * Firebase login succeeded.
         *
         * Keep the Firebase session active if the backend is temporarily
         * unavailable.
         */
        console.error(
          '[MedGraph] Backend auth sync failed:',
          backendError,
        );
      }
    } catch (authError: unknown) {
      const message =
        authError instanceof Error
          ? authError.message
          : 'Login failed';

      setError(message);

      throw authError;
    }
  };

  // ===========================================================================
  // Logout
  // ===========================================================================

  const logout = async (): Promise<void> => {
    setError(null);

    try {
      // -----------------------------------------------------------------------
      // Clear application storage
      // -----------------------------------------------------------------------

      await clearAuthData();

      // -----------------------------------------------------------------------
      // Firebase logout
      // -----------------------------------------------------------------------

      await firebaseSignOut(auth);

      setUser(null);
      setUserProfile(null);
    } catch (logoutError) {
      console.error(
        '[MedGraph] Logout error:',
        logoutError,
      );

      // Ensure UI does not remain in an authenticated state.
      setUser(null);
      setUserProfile(null);

      throw logoutError;
    }
  };

  // ===========================================================================
  // Clear error
  // ===========================================================================

  const clearError = (): void => {
    setError(null);
  };

  // ===========================================================================
  // Context value
  // ===========================================================================

  const value: AuthContextType = {
    user,
    userProfile,
    loading,
    error,
    signup,
    login,
    logout,
    clearError,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// =============================================================================
// useAuth
// =============================================================================

export const useAuth =
  (): AuthContextType => {
    const context =
      useContext(AuthContext);

    if (!context) {
      throw new Error(
        'useAuth must be used within an AuthProvider',
      );
    }

    return context;
  };