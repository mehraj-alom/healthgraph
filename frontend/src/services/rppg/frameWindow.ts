/**
 * RPPG window-file reader — pure TypeScript (no runtime dependencies).
 *
 * The native capture modules seal a window file (little-endian):
 *   'RPPG' magic (4B) | version u16 (=1) | frameCount u16 | roiSize u16 (=128)
 *   | fps float32 | per frame: timestampMs float64 + roi*roi*3 BGR bytes
 *
 * The reader validates structure strictly; the "exactly 160 frames"
 * policy lives in the preprocessor, which refuses incomplete windows.
 * File I/O itself is injected (expo-file-system in the app, memory in tests)
 * so this module stays import-safe in node unit tests.
 */

import {
  RPPG_WINDOW_FRAMES,
  RPPG_WINDOW_MAGIC,
  RPPG_WINDOW_ROI,
  RPPG_WINDOW_VERSION,
} from './types';

export class RppgWindowError extends Error {
  readonly code: string;
  constructor(message: string) {
    super(`[rppg] invalid capture window: ${message}`);
    this.name = 'RppgWindowError';
    this.code = 'INVALID_RPPG_WINDOW';
  }
}

export interface RppgWindowFile {
  readonly frameCount: number;
  readonly roiSize: number;
  /** Effective capture rate from the native sealer (Hz). */
  readonly fps: number;
  readonly timestampsMs: readonly number[];
  /** Concatenated BGR frames, roi*roi*3 bytes each, BGR channel order. */
  readonly bgr: Uint8Array;
}

export const RPPG_WINDOW_HEADER_BYTES = 14;

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readF32LE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getFloat32(0, true);
}

function readF64LE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getFloat64(0, true);
}

/** Parse + structurally validate a window file. Never mutates the input. */
export function parseRppgWindow(bytes: Uint8Array): RppgWindowFile {
  if (!(bytes instanceof Uint8Array)) {
    throw new RppgWindowError('window bytes must be a Uint8Array.');
  }
  if (bytes.length < RPPG_WINDOW_HEADER_BYTES) {
    throw new RppgWindowError(
      `truncated header: ${bytes.length} bytes (minimum ${RPPG_WINDOW_HEADER_BYTES}).`,
    );
  }
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== RPPG_WINDOW_MAGIC) {
    throw new RppgWindowError(
      `bad magic: expected "${RPPG_WINDOW_MAGIC}", received "${magic}".`,
    );
  }
  const version = readU16LE(bytes, 4);
  if (version !== RPPG_WINDOW_VERSION) {
    throw new RppgWindowError(
      `unsupported window version ${version} (expected ${RPPG_WINDOW_VERSION}).`,
    );
  }
  const frameCount = readU16LE(bytes, 6);
  const roiSize = readU16LE(bytes, 8);
  const fps = readF32LE(bytes, 10);
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > RPPG_WINDOW_FRAMES) {
    throw new RppgWindowError(
      `frameCount ${frameCount} out of range [1, ${RPPG_WINDOW_FRAMES}].`,
    );
  }
  if (roiSize !== RPPG_WINDOW_ROI) {
    throw new RppgWindowError(
      `roiSize ${roiSize} does not match the model contract (${RPPG_WINDOW_ROI}).`,
    );
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RppgWindowError(`non-finite/non-positive fps ${fps}.`);
  }
  const frameBytes = roiSize * roiSize * 3;
  const expected = RPPG_WINDOW_HEADER_BYTES + frameCount * (8 + frameBytes);
  if (bytes.length !== expected) {
    throw new RppgWindowError(
      `byte length ${bytes.length} does not match header (expected ${expected} for ${frameCount} frames).`,
    );
  }
  const timestamps: number[] = new Array<number>(frameCount);
  let offset = RPPG_WINDOW_HEADER_BYTES;
  for (let i = 0; i < frameCount; i++) {
    const ts = readF64LE(bytes, offset);
    if (!Number.isFinite(ts)) {
      throw new RppgWindowError(`non-finite timestamp at frame ${i}.`);
    }
    if (i > 0 && ts < timestamps[i - 1]) {
      throw new RppgWindowError(
        `timestamps not monotonic at frame ${i} (${ts} < ${timestamps[i - 1]}).`,
      );
    }
    timestamps[i] = ts;
    offset += 8 + frameBytes;
  }
  const bgr = new Uint8Array(frameCount * frameBytes);
  offset = RPPG_WINDOW_HEADER_BYTES;
  for (let i = 0; i < frameCount; i++) {
    bgr.set(bytes.subarray(offset + 8, offset + 8 + frameBytes), i * frameBytes);
    offset += 8 + frameBytes;
  }
  return { frameCount, roiSize, fps, timestampsMs: timestamps, bgr };
}

/** Read a window file from device storage. Reader is injected for tests. */
export type RppgWindowBytesReader = (uri: string) => Promise<Uint8Array>;

function defaultReader(): RppgWindowBytesReader | null {
  let ExpoFile: (new (uri: string) => { arrayBuffer(): Promise<ArrayBuffer> }) | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-file-system') as {
      File?: new (uri: string) => { arrayBuffer(): Promise<ArrayBuffer> };
    };
    ExpoFile = mod?.File ?? null;
  } catch {
    ExpoFile = null;
  }
  if (!ExpoFile) return null;
  const Ctor = ExpoFile;
  return async (uri: string) => {
    const buf = await new Ctor(uri).arrayBuffer();
    return new Uint8Array(buf);
  };
}

export async function readRppgWindowFile(
  uri: string,
  reader?: RppgWindowBytesReader,
): Promise<RppgWindowFile> {
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new RppgWindowError('window URI must be a non-empty string.');
  }
  const read = reader ?? defaultReader();
  if (!read) {
    throw new RppgWindowError(
      'expo-file-system is unavailable, so the capture window cannot be read.',
    );
  }
  const bytes = await read(uri);
  return parseRppgWindow(bytes);
}

/** Deterministic window builder for tests (NOT face data — synthetic bytes). */
export function buildRppgWindowForTests(
  frameCount: number,
  fps: number,
  fill: (frame: number, byte: number) => number,
  roiSize: number = RPPG_WINDOW_ROI,
): Uint8Array {
  const frameBytes = roiSize * roiSize * 3;
  const out = new Uint8Array(
    RPPG_WINDOW_HEADER_BYTES + frameCount * (8 + frameBytes),
  );
  out[0] = 0x52;
  out[1] = 0x50;
  out[2] = 0x50;
  out[3] = 0x47;
  const view = new DataView(out.buffer);
  view.setUint16(4, RPPG_WINDOW_VERSION, true);
  view.setUint16(6, frameCount, true);
  view.setUint16(8, roiSize, true);
  view.setFloat32(10, fps, true);
  let offset = RPPG_WINDOW_HEADER_BYTES;
  for (let f = 0; f < frameCount; f++) {
    view.setFloat64(offset, (f * 1000) / fps, true);
    offset += 8;
    for (let b = 0; b < frameBytes; b++) {
      out[offset + b] = fill(f, b) & 0xff;
    }
    offset += frameBytes;
  }
  return out;
}
