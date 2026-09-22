/**
 * useOnboardingState — per-patient onboarding personalization (SQLite).
 *
 * Single source for the setup gate AND the setup screens (no duplicate
 * state): the gate reads `needed`, screens read/write selections, and
 * completion propagates through the existing dataRefresh pub/sub (no
 * polling). Patient identity resolves via waitForIdentityReady (the same
 * race guard the API layer uses); logged-out means no state, never another
 * user's state. Fail-open: storage failure resolves to "no setup needed"
 * so onboarding infra can never block the app.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { getCachedPatientId } from '@/services/patientIdentity';
import { waitForIdentityReady } from '@/services/backendIdentity';
import {
  getOnboardingState,
  markOnboardingComplete,
  resolveOnboardingGateDb,
  saveOnboardingSelections,
  type OnboardingState,
} from '@/db/queries/onboarding';
import { sanitizeSelections, FOCUS_AREAS, HEALTH_GOALS } from '@/screens/Onboarding/options';
import { migrateLegacyFocus } from '@/screens/HealthAreas/engines';
import { subscribeDataRefresh, requestDataRefresh } from '@/services/dataRefresh';

export type { OnboardingState };

export interface UseOnboardingState {
  state: OnboardingState | null;
  /** True when the post-auth setup flow must be shown. */
  setupNeeded: boolean;
  isLoading: boolean;
  save: (goals: string[], focus: string[]) => Promise<void>;
  complete: () => Promise<void>;
  refetch: () => Promise<void>;
}

export function useOnboardingState(): UseOnboardingState {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [state, setState] = useState<OnboardingState | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      if (!uid) {
        if (mounted.current) {
          setState(null);
          setSetupNeeded(false);
          setIsLoading(false);
        }
        return;
      }
      await waitForIdentityReady().catch(() => {});
      const patientId = getCachedPatientId();
      if (!patientId || !mounted.current) {
        if (mounted.current) setIsLoading(false);
        return;
      }
      const [row, gate] = await Promise.all([
        getOnboardingState(patientId),
        resolveOnboardingGateDb(patientId),
      ]);
      if (!mounted.current) return;
      setState(
        row
          ? {
              completed: row.completed,
              goals: sanitizeSelections(row.goals, HEALTH_GOALS),
              // Pre-engine selections forward-map (never dropped silently).
              focus: sanitizeSelections(migrateLegacyFocus(row.focus), FOCUS_AREAS),
            }
          : null,
      );
      setSetupNeeded(gate.needed);
      setIsLoading(false);
    } catch {
      if (mounted.current) {
        // Fail open: never block the app on onboarding storage.
        setSetupNeeded(false);
        setIsLoading(false);
      }
    }
  }, [uid]);

  useEffect(() => {
    mounted.current = true;
    setIsLoading(true);
    void load();
    const unsubscribe = subscribeDataRefresh(() => {
      void load();
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const save = useCallback(
    async (goals: string[], focus: string[]) => {
      const patientId = getCachedPatientId();
      if (!patientId) return;
      await saveOnboardingSelections(
        patientId,
        sanitizeSelections(goals, HEALTH_GOALS),
        sanitizeSelections(migrateLegacyFocus(focus), FOCUS_AREAS),
      );
      setState((prev) => ({
        completed: prev?.completed ?? false,
        goals: sanitizeSelections(goals, HEALTH_GOALS),
        focus: sanitizeSelections(migrateLegacyFocus(focus), FOCUS_AREAS),
      }));
    },
    [],
  );

  const complete = useCallback(async () => {
    const patientId = getCachedPatientId();
    if (!patientId) return;
    await markOnboardingComplete(patientId);
    setState((prev) => ({
      completed: true,
      goals: prev?.goals ?? [],
      focus: prev?.focus ?? [],
    }));
    setSetupNeeded(false);
    // The App-level gate subscribes to the same signal.
    requestDataRefresh();
  }, []);

  const refetch = useCallback(async () => {
    await load();
  }, [load]);

  return { state, setupNeeded, isLoading, save, complete, refetch };
}
