/**
 * useActiveEngines — THE activation selector for goal-driven engines.
 *
 * Derives active engines from the patient's stored focus selections via
 * deriveActiveEngines (any combination coexists; no per-engine branches).
 * This is the single integration point future engine dashboards consume —
 * no screen reimplements selection logic.
 */

import { useMemo } from 'react';
import { useOnboardingState } from '@/hooks/useOnboardingState';
import {
  deriveActiveEngines,
  type EngineDef,
  type EngineId,
} from '@/screens/HealthAreas/engines';

export type { EngineDef, EngineId };

export function useActiveEngines(): {
  engines: EngineDef[];
  ids: EngineId[];
  isLoading: boolean;
} {
  const { state, isLoading } = useOnboardingState();
  const engines = useMemo(
    () => deriveActiveEngines(state?.focus ?? []),
    [state?.focus],
  );
  const ids = useMemo(() => engines.map((e) => e.id), [engines]);
  return { engines, ids, isLoading };
}
