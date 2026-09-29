import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
// Legacy FileSystem API (same import the documents cache uses).
import * as FileSystem from 'expo-file-system/legacy';
import { getCachedPatientId } from '@/services/patientIdentity';

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
 * which the OS may evict at any time). Sealed when a patient session
 * exists; returns the permanent URI, or null when the copy is impossible
 * (caller falls back to the source).
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
    const patientId = getCachedPatientId();
    if (!patientId) return target;
    const { sealCachedFile } = await import('@/services/fileVault');
    return await sealCachedFile(patientId, target);
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
  const tempRef = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        try {
          // Wipe the previous focus's decrypted temp (never lingers).
          if (tempRef.current) {
            const { wipeFile } = await import('@/services/fileVault');
            await wipeFile(tempRef.current);
            tempRef.current = null;
          }
          const stored = await AsyncStorage.getItem(STORAGE_KEY);
          if (!stored) {
            if (live) setPhotoUri(null);
            return;
          }
          // Sealed photos open to a short-lived temp for the <Image>.
          const { isSealedUri, openSealedFile } = await import('@/services/fileVault');
          const patientId = getCachedPatientId();
          if (stored && isSealedUri(stored) && patientId) {
            const info = await FileSystem.getInfoAsync(stored).catch(() => null);
            if (!info?.exists) {
              await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
              if (live) setPhotoUri(null);
              return;
            }
            const tmp = await openSealedFile(patientId, stored);
            tempRef.current = tmp;
            if (live) setPhotoUri(tmp);
            return;
          }
          // Pre-fix installs stored picker-cache URIs, which the OS may
          // have evicted: verify file:// entries and drop dead ones so a
          // broken image never renders (user re-picks once, then permanent).
          if (stored.startsWith('file://')) {
            const info = await FileSystem.getInfoAsync(stored).catch(() => null);
            if (!info?.exists) {
              await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
              if (live) setPhotoUri(null);
              return;
            }
          }
          if (live) setPhotoUri(stored);
        } catch {
          // Storage unavailable — keep whatever is on screen.
        }
      })();
      return () => {
        live = false;
      };
    }, []),
  );

  const savePhoto = useCallback(async (uri: string | null) => {
    if (!uri) {
      setPhotoUri(null);
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        await AsyncStorage.removeItem(STORAGE_KEY);
        // Removing the photo also removes its file (sealed or legacy).
        const { wipeFile } = await import('@/services/fileVault');
        await wipeFile(stored);
        if (tempRef.current) {
          await wipeFile(tempRef.current);
          tempRef.current = null;
        }
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
