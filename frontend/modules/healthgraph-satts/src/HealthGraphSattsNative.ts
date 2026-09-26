import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * Minimal structural type for the natively-registered HealthGraphSatts
 * module. Resolved via `requireOptionalNativeModule` (documented Expo
 * lookup). Importing this file must never crash, including in Expo Go.
 */
interface NativeSattsBinding {
  isAvailable(): boolean;
  loadVoices(frontPath: string, modelPath: string): boolean;
  getSampleRate(): number;
  getLastError(): string;
  synthesize(ids: number[]): Promise<string | null>;
  close(): void;
}

function resolveNativeModule(): NativeSattsBinding | null {
  try {
    if (Platform.OS !== 'android') return null;
    const mod = requireOptionalNativeModule<NativeSattsBinding>('HealthGraphSatts');
    if (!mod || typeof mod.synthesize !== 'function') return null;
    return mod;
  } catch {
    // Expo Go / iOS / web: no custom native module.
    return null;
  }
}

let cached: NativeSattsBinding | null | undefined;
function nativeModule(): NativeSattsBinding | null {
  if (cached === undefined) cached = resolveNativeModule();
  return cached;
}

export const isSattsAvailable: boolean = (() => {
  try {
    const mod = nativeModule();
    return !!mod && mod.isAvailable() === true;
  } catch {
    return false;
  }
})();

export function getSattsModule(): NativeSattsBinding | null {
  return nativeModule();
}
