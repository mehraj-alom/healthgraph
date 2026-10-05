/**
 * barcodeCache.ts — device-only cache for barcode products.
 *
 * Repeat scans of the same product resolve offline from the last network
 * result: one versioned key holding a barcode-keyed map, capped at 200
 * entries (oldest dropped first). Validation lives in barcodePure;
 * this file only reads and writes JSON.
 *
 * Never imported by node tests (native storage import); covered by tsc
 * and the contract tests in barcode.test.mts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BARCODE_CACHE_KEY,
  BARCODE_CACHE_MAX,
  normalizeCachedProduct,
  type CachedBarcodeProduct,
} from './barcodePure';

export type { CachedBarcodeProduct };

export async function getCachedBarcode(code: string): Promise<CachedBarcodeProduct | null> {
  try {
    const raw = await AsyncStorage.getItem(BARCODE_CACHE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return normalizeCachedProduct((parsed as Record<string, unknown>)[code]);
  } catch {
    return null;
  }
}

export async function putCachedBarcode(product: CachedBarcodeProduct): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(BARCODE_CACHE_KEY);
    let map: Record<string, unknown> = {};
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        map = parsed as Record<string, unknown>;
      }
    }
    delete map[product.barcode];
    map[product.barcode] = product;
    const keys = Object.keys(map);
    for (const stale of keys.slice(0, Math.max(0, keys.length - BARCODE_CACHE_MAX))) {
      delete map[stale];
    }
    await AsyncStorage.setItem(BARCODE_CACHE_KEY, JSON.stringify(map));
  } catch {
    // Cache is a bonus — never fail the lookup path.
  }
}
