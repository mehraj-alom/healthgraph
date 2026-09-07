/**
 * Minimal network monitor for sync triggers.
 *
 * Uses AppState for foreground detection and tracks network status
 * based on sync success/failure. No external dependencies required.
 *
 * Strategy:
 *   - Track online status via sync success/failure
 *   - Trigger sync on network recovery
 *   - Coalesce multiple triggers via mutex in sync engine
 */

import { AppState, Platform } from 'react-native';

// ============================================================================
// State
// ============================================================================

let _isOnline = true;
let _listeners: Set<() => void> = new Set();
let _subscription: ReturnType<typeof AppState.addEventListener> | null = null;

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if the app is likely online.
 * Returns true unless a recent sync failure indicated offline.
 */
export function isOnline(): boolean {
  return _isOnline;
}

/**
 * Subscribe to network state changes.
 * Returns an unsubscribe function.
 */
export function subscribe(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/**
 * Mark the network as online.
 * Called after a successful sync or API call.
 */
export function markOnline(): void {
  if (!_isOnline) {
    _isOnline = true;
    _notifyListeners();
  }
}

/**
 * Mark the network as offline.
 * Called after a network-related sync failure.
 */
export function markOffline(): void {
  if (_isOnline) {
    _isOnline = false;
    _notifyListeners();
  }
}

/**
 * Initialize the network monitor.
 * Call once on app startup.
 */
export function initNetworkMonitor(): void {
  if (_subscription) return;

  // Track AppState transitions
  _subscription = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') {
      // When app comes to foreground, assume online
      // The sync engine will verify connectivity
      markOnline();
    }
  });
}

/**
 * Cleanup the network monitor.
 * Call on app shutdown or logout.
 */
export function cleanupNetworkMonitor(): void {
  if (_subscription) {
    _subscription.remove();
    _subscription = null;
  }
  _listeners.clear();
}

// ============================================================================
// Internal
// ============================================================================

function _notifyListeners(): void {
  _listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Ignore listener errors
    }
  });
}
