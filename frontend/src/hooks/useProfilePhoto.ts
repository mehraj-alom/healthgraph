import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
// Legacy FileSystem API (same import the documents cache uses).
import * as FileSystem from 'expo-file-system/legacy';

const STORAGE_KEY = 'profile-photo-uri';

/** Storage key export for account-deletion wipe (same key the hook uses). */
export const PROFILE_PHOTO_STORAGE_KEY = STORAGE_KEY;

/** App-sandbox subdirectory holding the persisted profile photo. */
export const PROFILE_PHOTO_DIR = 'profile/';

/** Filename export for account-deletion wipe (same file the hook writes). */
export function profilePhotoFileName(sourceUri: string): string {
  const clean = sourceUri.split('?')[0].split('#')[0].toLowerCase();
  if (clean.endsWith('.png')) return 'photo.png';
  if (clean.endsWith('.webp')) return 'photo.webp';
  if (clean.endsWith('.heic') || clean.endsWith('.heif')) return 'photo.heic';
  return 'photo.jpg';
}

/**
 * Copy a picked image into the app sandbox (documentDirectory survives
 * restarts and is cleared only on uninstall — unlike the picker cache,
 * which the OS may evict at any time). Returns the permanent URI, or
 * null when the copy is impossible (caller falls back to the source).
 */
export async function persistProfilePhoto(sourceUri: string): Promise<string | null> {
  try {
    const base = FileSystem.documentDirectory;
    if (!base) return null;
    const dir = `${base}${PROFILE_PHOTO_DIR}`;
    const dirInfo = await FileSystem.getInfoAsync(dir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    const target = `${dir}${profilePhotoFileName(sourceUri)}`;
    await FileSystem.copyAsync({ from: sourceUri, to: target });
    return target;
  } catch {
    return null;
  }
}

/**
 * Local-only profile photo (frontend preview — never uploaded).
 * The file lives permanently in the app sandbox; only its URI is kept
 * in AsyncStorage for fast reads. Reloads on screen focus so the
 * dashboard avatar picks up changes.
 */
export function useProfilePhoto() {
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          const stored = await AsyncStorage.getItem(STORAGE_KEY);
          if (!stored) {
            setPhotoUri(null);
            return;
          }
          // Pre-fix installs stored picker-cache URIs, which the OS may
          // have evicted: verify file:// entries and drop dead ones so a
          // broken image never renders (user re-picks once, then permanent).
          if (stored.startsWith('file://')) {
            const info = await FileSystem.getInfoAsync(stored).catch(() => null);
            if (!info?.exists) {
              await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
              setPhotoUri(null);
              return;
            }
          }
          setPhotoUri(stored);
        } catch {
          // Storage unavailable — keep whatever is on screen.
        }
      })();
    }, []),
  );

  const savePhoto = useCallback(async (uri: string | null) => {
    if (!uri) {
      setPhotoUri(null);
      try {
        await AsyncStorage.removeItem(STORAGE_KEY);
      } catch {
        // Storage unavailable — in-memory state still clears this session.
      }
      return;
    }
    // Persist the file first so the stored URI can never point at an
    // evicted picker-cache entry; fall back to the source URI only when
    // the sandbox copy itself fails.
    const permanent = await persistProfilePhoto(uri);
    const stored = permanent ?? uri;
    setPhotoUri(stored);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, stored);
    } catch {
      // Storage unavailable — in-memory photo still shows this session.
    }
  }, []);

  return { photoUri, savePhoto };
}
