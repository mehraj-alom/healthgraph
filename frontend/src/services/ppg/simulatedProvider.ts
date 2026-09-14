/**
 * Simulated PPG provider for Expo Go / web development.
 *
 * Runs a DETERMINISTIC synthetic pulse through the REAL signal pipeline
 * (`processPpgSignal` — the same algorithm as the native Kotlin/Swift code)
 * so UI states, quality handling, and result rendering can be exercised
 * without a camera or a custom build.
 *
 * SIMULATION IS NOT MEASUREMENT:
 * - results carry `simulated: true` and `algorithmVersion: ppg-sim-1.0.0`
 *   (which the backend schema rejects — it cannot validate or sync),
 * - the persistence layer refuses simulated input (see ppgService),
 * - consuming UI must badge results as SIMULATION and must never present
 *   them as health data.
 *
 * This file is intentionally dependency-free (pure signal code only) so it
 * stays import-safe in every runtime, including node unit tests.
 */

import { processPpgSignal } from '../../../modules/healthgraph-ppg/src/ppgSignal';
import type {
  PpgMeasurementResult,
  PpgMeasureOptions,
  PpgProvider,
  PpgStateEvent,
} from './types';

export const SIM_ALGORITHM_VERSION = 'ppg-sim-1.0.0';

/** Base pulse for simulation. Fixed so sim output is stable, not medical. */
const SIM_BASE_BPM = 72;

type Listener = (event: PpgStateEvent) => void;

const listeners = new Set<Listener>();

function emit(event: PpgStateEvent): void {
  listeners.forEach((l) => {
    try {
      l(event);
    } catch {
      // Listener errors must never break simulation.
    }
  });
}

/** Deterministic pseudo-random generator (seeded LCG) — no flaky Math.random. */
function makeRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff - 0.5;
  };
}

/** Synthetic fingertip-like pulse series at 30 Hz. Clearly fake, stable output. */
export function syntheticPulseSeries(
  bpm: number,
  durationSeconds: number,
  sampleRateHz = 30,
): { samples: number[]; timestampsMs: number[] } {
  const n = Math.max(8, Math.round(durationSeconds * sampleRateHz));
  const samples = new Array<number>(n);
  const timestampsMs = new Array<number>(n);
  const period = 60 / bpm;
  const rand = makeRand(20260913);
  for (let i = 0; i < n; i++) {
    const time = i / sampleRateHz;
    const phase = (time % period) / period;
    const pulse =
      Math.exp(-Math.pow((phase - 0.15) * 8, 2)) +
      0.4 * Math.exp(-Math.pow((phase - 0.35) * 6, 2));
    samples[i] = 100 + 6 * pulse + 0.9 * rand();
    timestampsMs[i] = Math.round(time * 1000);
  }
  return { samples, timestampsMs };
}

let currentRun: {
  timers: ReturnType<typeof setTimeout>[];
  reject: (e: Error) => void;
} | null = null;

function clearRun(): void {
  if (currentRun) {
    currentRun.timers.forEach(clearTimeout);
    currentRun = null;
  }
}

function cancelledError(): Error {
  return Object.assign(new Error('Measurement cancelled'), { code: 'CANCELLED' });
}

export const simulatedPpgProvider: PpgProvider = {
  kind: 'simulated',
  isAvailable: true,

  measure(options: PpgMeasureOptions = {}): Promise<PpgMeasurementResult> {
    clearRun();
    const durationSeconds = Math.max(
      10,
      Math.min(300, Math.round(options.durationSeconds ?? 60)),
    );
    const run: { timers: ReturnType<typeof setTimeout>[]; reject: (e: Error) => void } = {
      timers: [],
      reject: () => {},
    };
    currentRun = run;

    return new Promise<PpgMeasurementResult>((resolve, reject) => {
      run.reject = reject;
      // Compressed wall-clock timeline (~2.4s) for a full-duration signal.
      // The RESULT still reflects `durationSeconds` of synthetic data.
      emit({ state: 'STARTING' });
      run.timers.push(
        setTimeout(() => {
          emit({ state: 'ACQUIRING', signalQuality: 0.4 });
        }, 300),
        setTimeout(() => {
          emit({ state: 'MEASURING', signalQuality: 0.62, liveBpm: 71 });
        }, 700),
        setTimeout(() => {
          emit({ state: 'MEASURING', signalQuality: 0.88, liveBpm: 73 });
        }, 1400),
        setTimeout(() => {
          emit({ state: 'COMPLETING' });
          const { samples, timestampsMs } = syntheticPulseSeries(
            SIM_BASE_BPM,
            durationSeconds,
          );
          const out = processPpgSignal(samples, timestampsMs, durationSeconds);
          const result: PpgMeasurementResult = {
            heartRateBpm: out.heartRateBpm,
            rrIntervalsMs: out.rrIntervalsMs,
            rmssdMs: out.rmssdMs,
            sdnnMs: out.sdnnMs,
            signalQuality: out.signalQuality,
            durationSeconds,
            algorithmVersion: SIM_ALGORITHM_VERSION,
            simulated: true,
          };
          emit({ state: 'COMPLETE', signalQuality: result.signalQuality });
          currentRun = null;
          resolve(result);
        }, 2000),
      );
    });
  },

  cancel(): Promise<void> {
    if (currentRun) {
      const run = currentRun;
      clearRun();
      emit({ state: 'CANCELLED' });
      run.reject(cancelledError());
    } else {
      emit({ state: 'CANCELLED' });
    }
    return Promise.resolve();
  },

  addStateListener(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
