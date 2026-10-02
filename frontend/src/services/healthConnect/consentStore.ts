/**
 * consentStore.ts — AsyncStorage binding for the consent + watermark ports.
 *
 * Thin and boring on purpose: all validation lives in consent.ts and
 * importer.ts. Never imported by node tests (AsyncStorage is native).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ConsentStoragePort } from './consent';

export const asyncConsentStorage: ConsentStoragePort = {
  getItem: async (key: string) => AsyncStorage.getItem(key),
  setItem: async (key: string, value: string) => {
    await AsyncStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    await AsyncStorage.removeItem(key);
  },
};
