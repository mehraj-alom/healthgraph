/**
 * usePriorityIntro — three-lifetime-exposure Priority intro (post-Batch-6).
 *
 * Eligibility is evaluated on focus from persistent patient-scoped state
 * (onboarding row: completed flag + exposure count + last-shown date):
 * completed setup, fewer than three lifetime exposures, nothing shown
 * yet today. When eligible, the card is presented AND the exposure is
 * recorded in the same flow (presented = rendered); the count caps at 3
 * and never resets on navigation, restart, relogin, or priority edits.
 * Grandfathered users start at exposure 1 on their first eligible day —
 * the gate writes their completion row before the Dashboard can mount.
 */

import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { getCachedPatientId } from '@/services/patientIdentity';
import { waitForIdentityReady } from '@/services/backendIdentity';
import {
  getPriorityIntro,
  recordPriorityIntro,
} from '@/db/queries/onboarding';
import { todayKey } from '@/screens/Onboarding/momentum';
import {
  MAX_PRIORITY_EXPOSURES,
  introDayNumber,
  shouldShowPriorityIntro,
} from '@/screens/Priority/priorityLayer';

export function usePriorityIntro(): {
  /** Card should be presented now (already recorded as shown). */
  visible: boolean;
  /** Exposure day number (1, 2, or 3). */
  day: 1 | 2 | 3;
  /** Hide without recording (recording already happened on present). */
  dismiss: () => void;
} {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [visible, setVisible] = useState(false);
  const [day, setDay] = useState<1 | 2 | 3>(1);
  const mounted = useRef(true);
  const checkedDay = useRef<string | null>(null);

  const check = useCallback(async () => {
    try {
      if (!uid) return;
      await waitForIdentityReady().catch(() => {});
      const patientId = getCachedPatientId();
      if (!patientId || !mounted.current) return;
      const today = todayKey();
      // One evaluation per calendar day per mount: navigation away/back
      // must not re-present or double-record within the same day.
      if (checkedDay.current === `${patientId}:${today}`) return;
      checkedDay.current = `${patientId}:${today}`;
      const exposure = await getPriorityIntro(patientId).catch(() => null);
      if (!exposure || !mounted.current) return;
      if (!shouldShowPriorityIntro({ ...exposure, today })) return;
      const nextDay = introDayNumber(exposure.count);
      const nextCount = Math.min(MAX_PRIORITY_EXPOSURES, exposure.count + 1);
      // Record the presentation, then present: a crash between the two
      // can only under-show (never over-show past the lifetime cap).
      await recordPriorityIntro(patientId, nextCount, today).catch(() => {});
      if (!mounted.current) return;
      setDay(nextDay);
      setVisible(true);
    } catch {
      // Intro is non-critical: never break the Dashboard over it.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      mounted.current = true;
      void check();
      return () => {
        mounted.current = false;
      };
    }, [check]),
  );

  const dismiss = useCallback(() => {
    if (mounted.current) setVisible(false);
  }, []);

  return { visible, day, dismiss };
}
