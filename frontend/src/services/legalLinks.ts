/**
 * legalLinks.ts — external legal URLs (pure).
 *
 * The privacy policy and Impressum are hosted outside the app (owner's
 * website). Until the owner provides the URLs these stay null and the UI
 * hides the link rows instead of showing dead links — a listing with a
 * dead privacy link fails review, a missing row just waits for config.
 *
 * Zero imports: safe for node unit tests.
 */

/** Full https URL of the published privacy policy, or null when unset. */
export const PRIVACY_POLICY_URL: string | null = null;

/** Full https URL of the German Impressum (§ 5 DDG), or null when unset. */
export const IMPRINT_URL: string | null = null;

/** Required Open Food Facts attribution (ODbL) for packaged-food data. */
export const OFF_ATTRIBUTION = 'Packaged-food data: © Open Food Facts contributors (ODbL).';

function isHttpUrl(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^https:\/\//.test(value.trim());
}

/** True when a published privacy policy URL is configured. */
export function hasPrivacyPolicyUrl(): boolean {
  return isHttpUrl(PRIVACY_POLICY_URL);
}

/** True when a published Impressum URL is configured. */
export function hasImprintUrl(): boolean {
  return isHttpUrl(IMPRINT_URL);
}
