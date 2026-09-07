/**
 * patientIdentity.ts — Secure storage for the backend patient ID.
 *
 * The backend derives patient_id from Firebase UID via POST /api/v1/auth/sync.
 * This module stores it in expo-secure-store (iOS Keychain / Android Keystore)
 * so the local SQLite layer can scope queries to the authenticated patient.
 *
 * Flow:
 *   1. AuthContext calls syncBackendIdentity() on login/signup
 *   2. syncBackendIdentity() captures patient_id from sync response
 *   3. Stores it here via setPatientId()
 *   4. SQLite layer retrieves it via getPatientId()
 */

import * as SecureStore from 'expo-secure-store';

const PATIENT_ID_KEY = 'medgraph_patient_id';

/**
 * Store the backend patient ID after successful auth sync.
 */
export async function setPatientId(patientId: string): Promise<void> {
  await SecureStore.setItemAsync(PATIENT_ID_KEY, patientId);
}

/**
 * Retrieve the backend patient ID.
 * Returns null if not yet synced.
 */
export async function getPatientId(): Promise<string | null> {
  return SecureStore.getItemAsync(PATIENT_ID_KEY);
}

/**
 * Synchronous access to the cached patient ID.
 * Returns null if not yet loaded. Use for non-critical reads
 * where async is impractical (e.g., hook initialization).
 */
let _cachedPatientId: string | null = null;
let _loadPromise: Promise<string | null> | null = null;

/**
 * Initialize the cache from SecureStore. Call once on app startup.
 */
export async function loadPatientId(): Promise<string | null> {
  if (_loadPromise) return _loadPromise;
  _loadPromise = getPatientId().then((id) => {
    _cachedPatientId = id;
    return id;
  });
  return _loadPromise;
}

/**
 * Get the cached patient ID synchronously.
 * Must call loadPatientId() first (e.g., on app mount).
 */
export function getCachedPatientId(): string | null {
  return _cachedPatientId;
}

/**
 * Update both cache and SecureStore.
 */
export async function updatePatientId(patientId: string): Promise<void> {
  _cachedPatientId = patientId;
  await setPatientId(patientId);
}

/**
 * Clear patient ID on logout.
 */
export async function clearPatientId(): Promise<void> {
  _cachedPatientId = null;
  _loadPromise = null;
  await SecureStore.deleteItemAsync(PATIENT_ID_KEY);
}
