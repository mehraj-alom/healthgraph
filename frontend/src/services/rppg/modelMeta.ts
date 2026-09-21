/**
 * modelMeta.ts — Pure, dependency-free rPPG model metadata.
 *
 * Manifest (version/size/checksum/URL path), user-facing failure copy, and
 * the base64 encoder used for checksum verification. Zero imports: safe for
 * node unit tests, which cannot load expo-file-system / expo-crypto.
 */

export interface RppgModelManifest {
  version: string;
  filename: string;
  /** Exact expected byte size. */
  size: number;
  /**
   * Hex SHA-256 over the RFC 4648 base64 (standard alphabet, padded) of the
   * exact file bytes. expo-crypto digests strings, and base64 ASCII is
   * UTF-8 stable, so this digest is deterministic across runtimes.
   */
  sha256Base64: string;
  remotePath: string;
}

export const RPPG_MODEL_MANIFEST: RppgModelManifest = {
  version: '1.0.0',
  filename: 'physformer_rppg_fp16.onnx',
  size: 16668043,
  sha256Base64:
    'bac6a62b9b622658a42a2181376a912861eb901539e2e7b9bba5546dc06aba90',
  remotePath: 'physformer_rppg_fp16.onnx',
};

/**
 * User-facing copy per model failure code. Pure: the hook shows exactly
 * what this returns.
 */
export function friendlyRppgModelMessage(code: string | undefined): string {
  switch (code) {
    case 'network':
      return 'The pulse model could not be downloaded. Connect to the internet and try again — your progress is saved.';
    case 'checksum':
      return 'The downloaded model failed verification and was discarded. Try again on a stable connection.';
    case 'storage':
      return 'There is not enough free space for the pulse model (17 MB). Free up space and try again.';
    default:
      return 'The pulse model could not be prepared. Try again.';
  }
}

/**
 * Standard base64 (padded) of a byte array, chunked to avoid call-stack
 * limits. Prefers btoa; pure-JS fallback keeps node tests green.
 */
export function base64Encode(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  if (typeof btoa === 'function') return btoa(binary);
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0;
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : 0;
    const n = (a << 16) | (b << 8) | c;
    out +=
      alphabet[(n >> 18) & 63] +
      alphabet[(n >> 12) & 63] +
      (i + 1 < binary.length ? alphabet[(n >> 6) & 63] : '=') +
      (i + 2 < binary.length ? alphabet[n & 63] : '=');
  }
  return out;
}
