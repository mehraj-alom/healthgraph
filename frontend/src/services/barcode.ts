/**
 * barcode — retail barcode validation + Open Food Facts lookup.
 *
 * Free and unlimited (no key): GET /api/v1/nutrition/barcode/{code} proxies
 * world.openfoodfacts.org. Validation mirrors the backend GS1 check digits
 * (EAN-8 / UPC-A / EAN-13, EAN-14 logistic form) so malformed scans fail
 * instantly on-device without a network round trip.
 */

import axios from 'axios';
import { api } from '@/services/api';
import type { FoodScanConfidence, FoodScanResult } from './nutritionService';
import { barcodeResultFor as barcodeResultForPure, normalizeBarcode } from './barcodePure';

export { normalizeBarcode };

export interface BarcodeNutrients {
  kcal_per_100g: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface BarcodeProduct {
  barcode: string;
  name: string;
  brand: string;
  nutrients: BarcodeNutrients;
  serving_size: string;
  image_url: string;
  source: string;
}

/** GS1 validation + portion math live in the zero-import pure module. */

export async function lookupBarcode(code: string): Promise<BarcodeProduct> {
  const normalized = normalizeBarcode(code);
  if (!normalized) {
    throw new Error("That code isn't a valid product barcode. Try again or enter the food manually.");
  }
  let response;
  try {
    response = await api.getClient().get<BarcodeProduct>(
      `/api/v1/nutrition/barcode/${encodeURIComponent(normalized)}`,
      { timeout: 30000 },
    );
  } catch (error: unknown) {
    throw new Error(barcodeErrorMessage(error));
  }
  const data = response.data;
  if (!data || typeof data.name !== 'string' || !data.name || !data.nutrients) {
    throw new Error('No product found for that barcode. Try a photo scan or enter it manually.');
  }
  return data;
}

export function barcodeErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error && error.message
      ? error.message
      : 'Barcode lookup failed. Please try again.';
  }
  if (error.code === 'ECONNABORTED') return 'Barcode lookup timed out. Please try again.';
  if (error.response?.status === 401) return 'Your session has expired. Please sign in again.';
  if (error.response?.status === 400) {
    const detail = (error.response.data as { detail?: unknown } | undefined)?.detail;
    return typeof detail === 'string' ? detail : "That code isn't a valid product barcode.";
  }
  if (error.response?.status === 404) return 'No product found for that barcode. Try a photo scan or enter it manually.';
  if ((error.response?.status ?? 0) >= 500) {
    return 'Product lookup is unavailable right now. Please try again shortly.';
  }
  if (error.code === 'ERR_NETWORK' || error.response == null) {
    return 'You appear to be offline. Reconnect and try again.';
  }
  return 'Barcode lookup failed. Please try again.';
}

/**
 * Build a reviewable scan result from a looked-up product at a chosen
 * portion. Delegates to the pure math; typed for the review sheet.
 */
export function barcodeResultFor(
  product: BarcodeProduct,
  grams: number,
  barcode: string,
): FoodScanResult {
  const built = barcodeResultForPure(
    {
      name: product.name,
      brand: product.brand,
      nutrients: product.nutrients,
      serving_size: product.serving_size,
    },
    grams,
    barcode,
  );
  return {
    ...built,
    items: built.items.map((item) => ({ ...item, confidence: 'med' as FoodScanConfidence })),
    confidence: 'med' as FoodScanConfidence,
  };
}
