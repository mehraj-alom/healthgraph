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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function syncBackendIdentity(): Promise<void> {
  // The Axios interceptor obtains the current Firebase ID token. No token or
  // refresh token is persisted independently by MedGraph.
  const { api } = await import('@/services/api');
  await api.post('/api/v1/auth/sync');
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      if (!mounted) return;
      if (firebaseUser) {
        setUser(firebaseUser);
        setUserProfile({
          uid: firebaseUser.uid,
          email: firebaseUser.email ?? '',
          displayName: firebaseUser.displayName ?? undefined,
          createdAt: firebaseUser.metadata.creationTime ? new Date(firebaseUser.metadata.creationTime) : new Date(),
        });
        try {
          await syncBackendIdentity();
        } catch (syncError) {
          // Do not turn a valid Firebase session into a failed login when the
          // API is temporarily unavailable. Protected API calls will surface it.
          console.error('[MedGraph] Backend auth sync failed:', syncError);
        }
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
      await syncBackendIdentity();
    } catch (authError: unknown) {
      setError(authError instanceof Error ? authError.message : 'Signup failed');
      throw authError;
    }
  };

  const login = async (email: string, password: string): Promise<void> => {
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      await syncBackendIdentity();
    } catch (authError: unknown) {
      setError(authError instanceof Error ? authError.message : 'Login failed');
      throw authError;
    }
  };

  const logout = async (): Promise<void> => {
    setError(null);
    await firebaseSignOut(auth);
    setUser(null);
    setUserProfile(null);
  };

  return <AuthContext.Provider value={{ user, userProfile, loading, error, signup, login, logout,
    clearError: () => setError(null) }}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
