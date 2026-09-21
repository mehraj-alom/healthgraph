/**
 * assetHost.ts — Single configurable host for static application assets.
 *
 * Large data assets (anatomy GLBs, the PhysFormer ONNX model) are NOT
 * bundled: they download on demand from a public GitHub Release
 * (flat filename namespace — every asset filename is already unique).
 * All such downloads resolve their base URL here so there is exactly
 * one lever:
 *
 *   1. EXPO_PUBLIC_ASSET_CDN_URL (preferred — migrate to R2/CDN later
 *      by setting this; paths below stay identical)
 *   2. EXPO_PUBLIC_ANATOMY_CDN_URL (legacy anatomy-only override)
 *   3. __DEV__: derived Metro host (local frontend/public over HTTP)
 *   4. Public GitHub Release healthgraph-assets-v1 (default).
 *
 * These are static PUBLIC application assets: no auth tokens, no patient or
 * health data ever travels through these URLs. Bump ASSET_RELEASE_TAG for
 * a future asset generation (old caches invalidate via manifest versions).
 */

/** GitHub Release tag hosting the runtime assets. Bump for a new generation. */
export const ASSET_RELEASE_TAG = 'healthgraph-assets-v1';

const RELEASE_BASE =
  'https://github.com/mehraj-alom/healthgraph-assets/releases/download';

export const ASSET_ANATOMY_PATH = 'anatomy/v1';
export const ASSET_RPPG_MODEL_PATH = 'models/rppg/v1';

declare const __DEV__: boolean | undefined;

function resolveAssetBase(): string {
  const unified = process.env.EXPO_PUBLIC_ASSET_CDN_URL;
  if (unified) return unified.replace(/\/+$/, '');

  const legacyAnatomy = process.env.EXPO_PUBLIC_ANATOMY_CDN_URL;
  if (legacyAnatomy) return legacyAnatomy.replace(/\/+$/, '');

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || '';
    if (apiUrl) {
      try {
        const url = new URL(apiUrl);
        return `${url.protocol}//${url.hostname}:8081`;
      } catch {
        /* ignore parse errors */
      }
    }
    return 'http://localhost:8081';
  }

  return `${RELEASE_BASE}/${ASSET_RELEASE_TAG}`;
}

const ASSET_BASE = resolveAssetBase();

/** Base URL for static assets (no trailing slash). */
export function getAssetBaseUrl(): string {
  return ASSET_BASE;
}

/** Full URL for an asset path relative to the base (e.g. anatomy/v1/…). */
export function assetUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '');
  return `${ASSET_BASE}/${clean}`;
}
