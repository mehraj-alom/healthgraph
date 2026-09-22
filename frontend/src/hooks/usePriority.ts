/**
 * usePriority — the user-facing Priority from the Batch 6A source of
 * truth (post-Batch-6 layer).
 *
 * Reads stored focus ids through the existing onboarding state and
 * projects them through the pure priorityLayer contract. No second
 * store, no second selection system — changing priorities means editing
 * focus (which never deletes health history).
 */

import { useMemo } from 'react';
import { useOnboardingState } from '@/hooks/useOnboardingState';
import {
  buildPriority,
  formatPriorityNames,
  type PriorityEntry,
} from '@/screens/Priority/priorityLayer';

export function usePriority(): {
  entries: PriorityEntry[];
  names: string;
  isEmpty: boolean;
  isLoading: boolean;
} {
  const { state, isLoading } = useOnboardingState();
  const entries = useMemo(() => buildPriority(state?.focus), [state?.focus]);
  return {
    entries,
    names: formatPriorityNames(entries),
    isEmpty: entries.length === 0,
    isLoading,
  };
}
