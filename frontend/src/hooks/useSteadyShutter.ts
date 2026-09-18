/**
 * useSteadyShutter.ts — Stability-triggered auto-capture, no CV needed.
 *
 * True boundary detection requires a native vision module (heavy — at odds
 * with the app-size budget), so the scanner fires when the phone itself is
 * held steady inside the frame guide instead:
 *   - Samples the accelerometer (~10 Hz) and watches the magnitude window.
 *   - When max-min stays under STEADY_G for ~1.2 s → onSteady() once.
 *   - Re-arms only after real motion returns (anti-burst cooldown).
 *   - The parent decides what "fire" means (capture) and can pause via
 *     the `enabled` flag. Manual shutter always works alongside.
 */

import { useEffect, useRef, useState } from 'react';
import { Accelerometer, type AccelerometerMeasurement } from 'expo-sensors';

const SAMPLE_MS = 100;
const WINDOW_SAMPLES = 12; // ~1.2 s of steadiness required
const STEADY_G = 0.06; // max-min magnitude band that counts as "held still"
const REARM_G = 0.3; // motion band that re-arms after a shot

export function useSteadyShutter(
  enabled: boolean,
  onSteady: () => void,
): { steady: boolean; supported: boolean } {
  const [steady, setSteady] = useState(false);
  const [supported, setSupported] = useState(true);
  const windowRef = useRef<number[]>([]);
  const firedRef = useRef(false);
  const cbRef = useRef(onSteady);
  cbRef.current = onSteady;

  useEffect(() => {
    if (!enabled) return;
    let subscription: { remove: () => void } | null = null;

    Accelerometer.isAvailableAsync()
      .then((ok) => {
        if (!ok) {
          setSupported(false);
          return;
        }
        Accelerometer.setUpdateInterval(SAMPLE_MS);
        subscription = Accelerometer.addListener((m: AccelerometerMeasurement) => {
          const mag = Math.sqrt(m.x * m.x + m.y * m.y + m.z * m.z);
          const w = windowRef.current;
          w.push(mag);
          if (w.length > WINDOW_SAMPLES) w.shift();
          if (w.length < WINDOW_SAMPLES) return;

          let lo = w[0];
          let hi = w[0];
          for (const v of w) {
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
          const band = hi - lo;

          if (!firedRef.current && band <= STEADY_G) {
            firedRef.current = true;
            setSteady(true);
            cbRef.current();
          } else if (firedRef.current && band >= REARM_G) {
            // Real motion again — re-arm for the next page.
            firedRef.current = false;
            windowRef.current = [];
            setSteady(false);
          } else if (!firedRef.current) {
            setSteady(false);
          }
        });
      })
      .catch(() => setSupported(false));

    return () => {
      subscription?.remove();
      windowRef.current = [];
      firedRef.current = false;
    };
    // onSteady via ref on purpose: re-subscribing would reset the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      firedRef.current = false;
      windowRef.current = [];
      setSteady(false);
    }
  }, [enabled]);

  return { steady, supported };
}
