import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'profile-photo-uri';

/**
 * Local-only profile photo (frontend preview — never uploaded).
 * Reloads on screen focus so the dashboard avatar picks up changes.
 */
export function useProfilePhoto() {
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(STORAGE_KEY)
        .then((v) => setPhotoUri(v))
        .catch(() => {});
    }, []),
  );

  const savePhoto = useCallback(async (uri: string | null) => {
    setPhotoUri(uri);
    try {
      if (uri) await AsyncStorage.setItem(STORAGE_KEY, uri);
      else await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable — in-memory photo still shows this session.
    }
  }, []);

  return { photoUri, savePhoto };
}
