import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { getApp, getApps, initializeApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import {
  createUserWithEmailAndPassword,
  getAuth,
  initializeAuth,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type Auth,
  type User as FirebaseUser,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Legacy HomeCache key pattern: home:{uid}:{key}:v{version}
// We remove these on first auth to clear plaintext health data.
const LEGACY_HOME_CACHE_PREFIX = 'home:';
const LEGACY_CACHE_VERSION = 1;
const LEGACY_CACHE_KEYS = ['profile', 'dailyMetrics', 'bodyState', 'trends', 'documents', 'medications'] as const;

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

type ReactNativePersistenceFactory = (storage: typeof AsyncStorage) => FirebaseAuth.Persistence;
const getReactNativePersistence = (FirebaseAuth as unknown as {
  getReactNativePersistence: ReactNativePersistenceFactory;
}).getReactNativePersistence;

function createFirebaseAuth(): Auth {
  if (Platform.OS === 'web') return getAuth(app);
  try {
    return initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error &&
      (error as { code?: unknown }).code === 'auth/already-initialized') {
      return getAuth(app);
    }
    throw error;
  }
}

export const auth = createFirebaseAuth();
export const db = getFirestore(app);

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  createdAt: Date;
}

export interface AuthContextType {
  user: FirebaseUser | null;
  userProfile: UserProfile | null;
  loading: boolean;
  error: string | null;
  signup: (email: string, password: string, displayName?: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  /** Patch the cached display name (e.g. after a Settings save). */
  refreshDisplayName: (name: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function syncBackendIdentity(): Promise<void> {
  // The Axios interceptor obtains the current Firebase ID token. No token or
  // refresh token is persisted independently by MedGraph.
  const { api } = await import('@/services/api');
  const syncResult = await api.post<{ patient_id: string; status: string }>('/api/v1/auth/sync');
  // Store patient_id for local SQLite scoping
  const { updatePatientId } = await import('@/services/patientIdentity');
  await updatePatientId(syncResult.patient_id);
}

// Import the readiness tracker (no circular dep — this is a pure module)
import { setSyncPromise } from '@/services/backendIdentity';

/**
 * One-time cleanup of legacy plaintext HomeCache keys from AsyncStorage.
 *
 * Removes: home:{uid}:{key}:v1 for all health-data keys.
 * Preserves: Firebase Auth, gender preference, anatomy state.
 *
 * Idempotent: safe to call multiple times.
 * Non-blocking: failures are logged but do not affect the app.
 */
async function cleanupLegacyHomeCache(uid: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const legacyKeys = keys.filter((key) => {
      // Match pattern: home:{uid}:{key}:v{version}
      if (!key.startsWith(LEGACY_HOME_CACHE_PREFIX)) return false;
      const parts = key.split(':');
      if (parts.length !== 4) return false;
      const [, keyUserId, cacheKey, versionPart] = parts;
      // Must match this user's UID
      if (keyUserId !== uid) return false;
      // Must be a known health-data cache key
      if (!LEGACY_CACHE_KEYS.includes(cacheKey as any)) return false;
      // Must be version 1 (the only historical version)
      if (versionPart !== `v${LEGACY_CACHE_VERSION}`) return false;
      return true;
    });

    if (legacyKeys.length > 0) {
      await AsyncStorage.multiRemove(legacyKeys);
      if (__DEV__) {
        console.log(`[Auth] Legacy HomeCache cleanup: removed ${legacyKeys.length} keys`);
      }
    }
  } catch (error) {
    // Non-blocking: cleanup failure does not affect the app
    if (__DEV__) {
      console.error('[Auth] Legacy HomeCache cleanup failed (non-blocking):', error);
    }
  }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load patient ID from SecureStore on mount
    const { loadPatientId } = require('@/services/patientIdentity');
    loadPatientId();

    let mounted = true;
    const unsubscribe = onIdTokenChanged(auth, (firebaseUser) => {
      if (!mounted) return;
      if (firebaseUser) {
        setUser(firebaseUser);
        setUserProfile({
          uid: firebaseUser.uid,
          email: firebaseUser.email ?? '',
          displayName: firebaseUser.displayName ?? undefined,
          createdAt: firebaseUser.metadata.creationTime ? new Date(firebaseUser.metadata.creationTime) : new Date(),
        });
        // Fire-and-forget: sync backend identity in the background.
        const syncPromise = syncBackendIdentity().catch((syncError) => {
          console.error('[MedGraph] Backend auth sync failed (non-blocking):', syncError);
        });
        setSyncPromise(syncPromise);
        // Prefer the backend profile name (what the user typed in Settings)
        // over the Firebase displayName. Lazy + fire-and-forget, same as above.
        import('@/services/api').then(({ api }) =>
          api.get<{ display_name?: string | null }>('/api/v1/profile').then(
            (p) => {
              const backendName = p.display_name?.trim();
              if (backendName && mounted) {
                setUserProfile((prev) =>
                  prev && prev.displayName !== backendName ? { ...prev, displayName: backendName } : prev,
                );
              }
            },
            () => {},
          ),
        ).catch(() => {});
        // One-time cleanup: remove legacy plaintext HomeCache keys
        cleanupLegacyHomeCache(firebaseUser.uid).catch(() => {});
      } else {
        setUser(null);
        setUserProfile(null);
      }
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  const signup = async (email: string, password: string, displayName?: string): Promise<void> => {
    setError(null);
    try {
      const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (displayName?.trim()) await updateProfile(result.user, { displayName: displayName.trim() });
      // Backend identity sync is handled by onIdTokenChanged listener
    } catch (authError: unknown) {
      setError(authError instanceof Error ? authError.message : 'Signup failed');
      throw authError;
    }
  };

  const login = async (email: string, password: string): Promise<void> => {
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // Backend identity sync is handled by onIdTokenChanged listener
    } catch (authError: unknown) {
      setError(authError instanceof Error ? authError.message : 'Login failed');
      throw authError;
    }
  };

  const logout = async (): Promise<void> => {
    setError(null);
    // Clear SQLite health cache and patient identity before signing out
    const { getCachedPatientId, clearPatientId } = await import('@/services/patientIdentity');
    const { clearHomeCache } = await import('@/db/queries/homeCache');
    const patientId = getCachedPatientId();
    if (patientId) {
      await clearHomeCache(patientId);
    }
    await clearPatientId();
    await firebaseSignOut(auth);
    setUser(null);
    setUserProfile(null);
  };

  return <AuthContext.Provider value={{ user, userProfile, loading, error, signup, login, logout,
    clearError: () => setError(null),
    refreshDisplayName: (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setUserProfile((prev) => (prev ? { ...prev, displayName: trimmed } : prev));
    } }}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
