/**
 * barcodePure — zero-import barcode math (node-testable).
 *
 * GS1 validation shared with the backend suite (same vectors) plus the
 * portion math that turns a looked-up product into a reviewable scan
 * result. Network and storage live in services/barcode (untested runtime).
 */

export type ScanConfidence = 'low' | 'med' | 'high';

export interface ProductNutrients {
  kcal_per_100g: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface ScannedProduct {
  name: string;
  brand: string;
  nutrients: ProductNutrients;
  serving_size: string;
}

export interface ScanResultItem {
  label: string;
  grams: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: ScanConfidence;
  barcode: string;
}

export interface ScanResultBuilt {
  items: ScanResultItem[];
  total_kcal: number;
  confidence: ScanConfidence;
  note: string;
}

/** GS1 check digit over the leading digits. */
function checkDigitValid(digits: string): boolean {
  let total = 0;
  for (let i = 0; i < digits.length - 1; i++) {
    const d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    const posFromRight = digits.length - 1 - i;
    total += d * (posFromRight % 2 === 1 ? 3 : 1);
  }
  const check = digits.charCodeAt(digits.length - 1) - 48;
  return check >= 0 && check <= 9 && (10 - (total % 10)) % 10 === check;
}

/**
 * Normalize a raw scan to EAN digits, or null when invalid. UPC-A gains a
 * leading 0 (EAN-13 numbering); EAN-14 logistic codes shed theirs.
 */
export function normalizeBarcode(raw: string): string | null {
  const digits = (raw || '').replace(/[^0-9]/g, '');
  let code = digits;
  if (code.length === 12) code = `0${code}`;
  if (code.length === 14) {
    if (!code.startsWith('0')) return null;
    code = code.slice(1);
  }
  if (code.length !== 8 && code.length !== 13) return null;
  if (!checkDigitValid(code)) return null;
  return code;
}

/**
 * Build a reviewable scan result from a looked-up product at a chosen
 * portion. Same math as the photo review sheet (per-100g scaling).
 */
export function barcodeResultFor(
  product: ScannedProduct,
  grams: number,
  barcode: string,
): ScanResultBuilt {
  const safeGrams = Math.max(10, Math.round(grams));
  const factor = safeGrams / 100;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    items: [
      {
        label: product.brand ? `${product.name} (${product.brand})`.slice(0, 200) : product.name.slice(0, 200),
        grams: safeGrams,
        kcal: Math.round(product.nutrients.kcal_per_100g * factor),
        protein_g: round1(product.nutrients.protein_g * factor),
        carbs_g: round1(product.nutrients.carbs_g * factor),
        fat_g: round1(product.nutrients.fat_g * factor),
        confidence: 'med',
        barcode,
      },
    ],
    total_kcal: Math.round(product.nutrients.kcal_per_100g * factor),
    confidence: 'med',
    note: `Open Food Facts · barcode ${barcode}${product.serving_size ? ` · pack: ${product.serving_size}` : ''}`,
  };
}
