import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Dimensions,
  Platform,
  GestureResponderEvent,
} from 'react-native';
import { GLView } from 'expo-gl';
import { Asset } from 'expo-asset';
import { File as ExpoFile } from 'expo-file-system';

import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '@/types';
import { useBodyState } from '@/hooks/useBodyState';
import {
  MVP_STRUCTURE_IDS,
  getMapping,
  buildNodeToStructureMap,
} from '@/assets/anatomy/anatomyMap';
import type { BodyStateItem } from '@/types';
import { useAnatomy } from '@/context/AnatomyContext';
import AnatomyDownloadOverlay, { NotInstalledPrompt } from '@/components/AnatomyDownloadOverlay';
import { HealthFact } from '@/components/HealthFact';
import { getLocalModelUri, type Gender } from '@/services/anatomyDownload';

// ── Filament conditional import ──
// react-native-filament requires a native build (EAS/Expo Dev Client).
// In Expo Go the native module is unavailable, so we lazy-require it
// and fall back to a safe placeholder.
let FilamentBody: React.ComponentType<any> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const _filament = require('./FilamentBody');
  FilamentBody = _filament.default;
} catch (_filamentNotAvailable) {
  // Expo Go or web — Filament native module not bundled
}

// ---------------------------------------------------------------------------
// React Native / Hermes polyfills required by three.js
// ---------------------------------------------------------------------------

// three.js FileLoader creates `new ProgressEvent(...)` during streaming
// reads.  React Native's Hermes engine does not expose ProgressEvent on
// the global scope, so we polyfill it here — before any three.js import.
if (typeof (globalThis as any).ProgressEvent === 'undefined') {
  (globalThis as any).ProgressEvent = class ProgressEvent extends Event {
    lengthComputable: boolean;
    loaded: number;
    total: number;
    constructor(type: string, eventInitDict?: ProgressEventInit) {
      super(type);
      this.lengthComputable = eventInitDict?.lengthComputable ?? false;
      this.loaded = eventInitDict?.loaded ?? 0;
      this.total = eventInitDict?.total ?? 0;
    }
  };
}

// ---------------------------------------------------------------------------
// Three.js imports
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader, DRACO_GLTF_CONFIG } from 'three/examples/jsm/loaders/DRACOLoader.js';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CANVAS_HEIGHT = SCREEN_HEIGHT * 0.6;

// ---------------------------------------------------------------------------
// React Native DRACOLoader — decodes inline without Web Workers
// ---------------------------------------------------------------------------

// Draco decoder asset IDs resolved by Metro at bundle time.
// Files were renamed from .js → .txt so Metro treats them as opaque assets
// (not executable modules).  .wasm is added to assetExts in metro.config.js.
const DRACO_WASM_WRAPPER_ASSET =
  require('../../../assets/draco/draco_wasm_wrapper.txt');
const DRACO_DECODER_WASM_ASSET =
  require('../../../assets/draco/draco_decoder.wasm');
const DRACO_DECODER_JS_ASSET =
  require('../../../assets/draco/draco_decoder_js.txt');

/**
 * Cached decoded content so we only load from disk once.
 */
let _dracoWasmWrapperText: string | null = null;
let _dracoDecoderWasm: ArrayBuffer | null = null;
let _dracoDecoderJsText: string | null = null;

async function _ensureDracoAssetsLoaded(): Promise<void> {
  if (_dracoWasmWrapperText !== null) return;

  const [wasmWrapperAssets, wasmBinAssets, decoderJsAssets] =
    await Promise.all([
      Asset.loadAsync([DRACO_WASM_WRAPPER_ASSET]),
      Asset.loadAsync([DRACO_DECODER_WASM_ASSET]),
      Asset.loadAsync([DRACO_DECODER_JS_ASSET]),
    ]);

  const [wasmWrapperResolved, wasmBinResolved, decoderJsResolved] =
    await Promise.all([
      wasmWrapperAssets[0].downloadAsync(),
      wasmBinAssets[0].downloadAsync(),
      decoderJsAssets[0].downloadAsync(),
    ]);

  const wasmWrapperUri =
    wasmWrapperResolved.localUri ?? wasmWrapperResolved.uri;
  const wasmBinUri = wasmBinResolved.localUri ?? wasmBinResolved.uri;
  const decoderJsUri = decoderJsResolved.localUri ?? decoderJsResolved.uri;

  const [wrapperFile, wasmFile, decoderFile] = [
    new ExpoFile(wasmWrapperUri),
    new ExpoFile(wasmBinUri),
    new ExpoFile(decoderJsUri),
  ];

  const [wrapperText, wasmBuf, decoderText] = await Promise.all([
    wrapperFile.text(),
    toRealArrayBuffer(await wasmFile.arrayBuffer()),
    decoderFile.text(),
  ]);

  _dracoWasmWrapperText = wrapperText as string;
  _dracoDecoderWasm = wasmBuf;
  _dracoDecoderJsText = decoderText as string;
}

/**
 * Whether the current platform has WebAssembly available.
 * Used to decide which Draco decoder variant to load.
 */
const _HAS_WASM = typeof WebAssembly === 'object';

/**
 * Create a DRACOLoader configured for React Native where Web Workers and
 * Blob URLs are not available. The decoder module is loaded and initialized
 * inline, and geometry is decoded on the main thread.
 *
 * On native, _initDecoder is fully replaced so it reads the Draco decoder
 * WASM/JS from bundled Expo assets instead of using FileLoader → fetch()
 * (which fails because the files live inside the app binary, not on a
 * web server).
 */
function createNativeDRACOLoader(): DRACOLoader {
  const dracoLoader = new DRACOLoader();

  if (Platform.OS !== 'web') {
    // -----------------------------------------------------------------
    // Override _initDecoder: load decoder from bundled Expo assets,
    // then evaluate the JS and initialise the WASM module inline.
    // -----------------------------------------------------------------
    (dracoLoader as any)._initDecoder = function () {
      if (this.decoderPending) return this.decoderPending;

      const useJS = !_HAS_WASM || this.decoderConfig?.type === 'js';

      this.decoderPending = _ensureDracoAssetsLoaded()
        .then(() => {
          if (useJS) {
            // Pure-JS fallback path (no WebAssembly)
            return { jsContent: _dracoDecoderJsText!, wasmBinary: null };
          }
          // WASM path (normal)
          // Return a copy so callers can't mutate the cache.
          const copy = new ArrayBuffer(_dracoDecoderWasm!.byteLength);
          new Uint8Array(copy).set(new Uint8Array(_dracoDecoderWasm!));
          return { jsContent: _dracoWasmWrapperText!, wasmBinary: copy };
        })
        .then(({ jsContent, wasmBinary }) => {
          if (wasmBinary) {
            this.decoderConfig.wasmBinary = wasmBinary;
          }

          // Initialize the Draco decoder module inline.
          // The loaded JS defines DracoDecoderModule as a global.
          // We evaluate it and call it to get the decoder module.
          const initModule: Promise<any> = new Promise((resolve, reject) => {
            try {
              // eslint-disable-next-line no-new-func
              const getModule = new Function(
                jsContent + '\nreturn typeof DracoDecoderModule !== "undefined" ? DracoDecoderModule : null;',
              );
              const DracoDecoderModule = getModule();
              if (!DracoDecoderModule) {
                reject(
                  new Error(
                    'THREE.DRACOLoader: DracoDecoderModule not found after evaluating decoder JS.',
                  ),
                );
                return;
              }
              const config = {
                ...this.decoderConfig,
                onModuleLoaded: (draco: any) => resolve(draco),
              };
              DracoDecoderModule(config);
            } catch (e) {
              reject(e);
            }
          });

          this._dracoModule = initModule;
          return initModule;
        })
        .then((dracoModule: any) => {
          this._dracoModule = dracoModule;
        });

      return this.decoderPending;
    };
  }

  // Override _getWorker to return an inline "worker" that decodes on the
  // main thread instead of spawning a Web Worker.
  (dracoLoader as any)._getWorker = function (
    _taskID: number,
    _taskCost: number,
  ) {
    return this._initDecoder().then(() => {
      const self = this;
      const dracoModulePromise = self._dracoModule;

      const inlineWorker: any = {
        _callbacks: {} as Record<number, { resolve: Function; reject: Function }> ,
        _taskCosts: {} as Record<number, number>,
        _taskLoad: 0,
        postMessage(data: any) {
          if (data.type === 'decode') {
            const buffer = data.buffer;
            const taskConfig = data.taskConfig;
            const taskId = data.id;

            Promise.resolve(dracoModulePromise).then((draco: any) => {
              const decoder = new draco.Decoder();
              try {
                // Inline decode — replicate DRACOWorker decodeGeometry logic
                const array = new Int8Array(buffer);
                const attributeIDs = taskConfig.attributeIDs;
                const attributeTypes = taskConfig.attributeTypes;

                let dracoGeometry: any;
                let decodingStatus: any;

                const geometryType =
                  decoder.GetEncodedGeometryType(array);

                if (geometryType === draco.TRIANGULAR_MESH) {
                  dracoGeometry = new draco.Mesh();
                  decodingStatus = decoder.DecodeArrayToMesh(
                    array,
                    array.byteLength,
                    dracoGeometry,
                  );
                } else if (geometryType === draco.POINT_CLOUD) {
                  dracoGeometry = new draco.PointCloud();
                  decodingStatus = decoder.DecodeArrayToPointCloud(
                    array,
                    array.byteLength,
                    dracoGeometry,
                  );
                } else {
                  throw new Error(
                    'THREE.DRACOLoader: Unexpected geometry type.',
                  );
                }

                if (
                  !decodingStatus.ok() ||
                  dracoGeometry.ptr === 0
                ) {
                  throw new Error(
                    'THREE.DRACOLoader: Decoding failed: ' +
                      decodingStatus.error_msg(),
                  );
                }

                const geometry: any = {
                  index: null,
                  attributes: [] as any[],
                };

                for (const attributeName in attributeIDs) {
                  // In a real Web Worker, `self` is the global scope with
                  // TypedArray constructors. In our inline worker, `self` is
                  // the DRACOLoader instance, so look up from globalThis.
                  const TypedArrayCtor =
                    (globalThis as any)[attributeTypes[attributeName]];
                  let attribute: any;
                  let attributeID: number;

                  if (taskConfig.useUniqueIDs) {
                    attributeID = attributeIDs[attributeName];
                    attribute =
                      decoder.GetAttributeByUniqueId(
                        dracoGeometry,
                        attributeID,
                      );
                  } else {
                    attributeID = decoder.GetAttributeId(
                      dracoGeometry,
                      draco[attributeIDs[attributeName]],
                    );
                    if (attributeID === -1) continue;
                    attribute = decoder.GetAttribute(
                      dracoGeometry,
                      attributeID,
                    );
                  }

                  const count =
                    dracoGeometry.num_points();
                  const itemSize =
                    attribute.num_components();
                  const srcByteStride =
                    itemSize * TypedArrayCtor.BYTES_PER_ELEMENT;
                  const dstByteStride =
                    Math.ceil(srcByteStride / 4) * 4;
                  const dstStride =
                    dstByteStride /
                    TypedArrayCtor.BYTES_PER_ELEMENT;
                  const srcByteLength =
                    count * srcByteStride;
                  const dstByteLength =
                    count * dstByteStride;

                  const dracoDataType = (() => {
                    switch (TypedArrayCtor) {
                      case Float32Array:
                        return draco.DT_FLOAT32;
                      case Int8Array:
                        return draco.DT_INT8;
                      case Int16Array:
                        return draco.DT_INT16;
                      case Int32Array:
                        return draco.DT_INT32;
                      case Uint8Array:
                        return draco.DT_UINT8;
                      case Uint16Array:
                        return draco.DT_UINT16;
                      case Uint32Array:
                        return draco.DT_UINT32;
                    }
                  })();

                  const ptr = draco._malloc(
                    srcByteLength,
                  );
                  decoder.GetAttributeDataArrayForAllPoints(
                    dracoGeometry,
                    attribute,
                    dracoDataType,
                    srcByteLength,
                    ptr,
                  );

                  const srcArray = new TypedArrayCtor(
                    draco.HEAPF32.buffer,
                    ptr,
                    srcByteLength /
                      TypedArrayCtor.BYTES_PER_ELEMENT,
                  );
                  let dstArray: any;

                  if (
                    srcByteStride === dstByteStride
                  ) {
                    dstArray = srcArray.slice();
                  } else {
                    dstArray = new TypedArrayCtor(
                      dstByteLength /
                        TypedArrayCtor.BYTES_PER_ELEMENT,
                    );
                    let dstOffset = 0;
                    for (
                      let i = 0, il = srcArray.length;
                      i < il;
                      i++
                    ) {
                      for (
                        let j = 0;
                        j < itemSize;
                        j++
                      ) {
                        dstArray[dstOffset + j] =
                          srcArray[i * itemSize + j];
                      }
                      dstOffset += dstStride;
                    }
                  }

                  draco._free(ptr);

                  const attrResult: any = {
                    name: attributeName,
                    count,
                    itemSize,
                    array: dstArray,
                    stride: dstStride,
                  };

                  if (
                    attributeName === 'color'
                  ) {
                    attrResult.vertexColorSpace =
                      taskConfig.vertexColorSpace;
                  }

                  geometry.attributes.push(attrResult);
                }

                // Add index
                if (
                  geometryType ===
                  draco.TRIANGULAR_MESH
                ) {
                  const numFaces =
                    dracoGeometry.num_faces();
                  const numIndices = numFaces * 3;
                  const indexByteLength =
                    numIndices * 4;
                  const indexPtr =
                    draco._malloc(indexByteLength);
                  decoder.GetTrianglesUInt32Array(
                    dracoGeometry,
                    indexByteLength,
                    indexPtr,
                  );
                  const index = new Uint32Array(
                    draco.HEAPF32.buffer,
                    indexPtr,
                    numIndices,
                  ).slice();
                  draco._free(indexPtr);
                  geometry.index = {
                    array: index,
                    itemSize: 1,
                  };
                }

                draco.destroy(dracoGeometry);

                inlineWorker._callbacks[taskId]?.resolve({
                  type: 'decode',
                  id: taskId,
                  geometry,
                });
              } catch (error: any) {
                console.error(error);
                inlineWorker._callbacks[taskId]?.reject({
                  type: 'error',
                  id: taskId,
                  error: error.message,
                });
              } finally {
                draco.destroy(decoder);
              }
            });
          }
        },
        onmessage: null,
        terminate() {},
      };

      self.workerPool.push(inlineWorker);
      inlineWorker._taskCosts[_taskID] = _taskCost;
      inlineWorker._taskLoad += _taskCost;

      return inlineWorker;
    });
  };

  return dracoLoader;
}

// ---------------------------------------------------------------------------
// Asset resolution — runtime loading
// ---------------------------------------------------------------------------

/**
 * Resolve a GLB file.
 * On web: returns a fetch()-able URL from public/.
 * On native: returns the local file URI (expo-asset downloaded).
 * On native, the caller uses GLTFLoader.parse() with ArrayBuffer.
 */
async function resolveGlbUri(
  fileName: string,
  assetModule?: number
): Promise<string> {
  if (Platform.OS === 'web') {
    const genderDir = fileName.includes('_female') ? 'female' : 'male';
    return `/anatomy/${genderDir}/${fileName}`;
  }

  if (assetModule) {
    const assets = await Asset.loadAsync([assetModule]);
    const resolved = assets[0];
    await resolved.downloadAsync();
    return resolved.localUri ?? resolved.uri;
  }

  const genderDir = fileName.includes('_female') ? 'female' : 'male';
  return `/anatomy/${genderDir}/${fileName}`;
}

/**
 * Ensure rawBytes is a genuine ArrayBuffer that passes
 * `instanceof ArrayBuffer` checks in three.js on Hermes.
 *
 * On Hermes / React Native, data returned by expo-file-system may be
 * a Uint8Array or a cross-realm ArrayBuffer that fails the instanceof
 * check, causing GLTFLoader.parse() to fall through to JSON.parse()
 * and throw a SyntaxError on binary data.
 */
function toRealArrayBuffer(
  raw: ArrayBuffer | ArrayBufferLike | Uint8Array,
): ArrayBuffer {
  if (raw instanceof ArrayBuffer) return raw;
  // Uint8Array / Int8Array / etc.
  const view = raw as unknown as Uint8Array;
  const buf = new ArrayBuffer(view.byteLength);
  new Uint8Array(buf).set(
    new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
  );
  return buf;
}

/**
 * Validated read of an on-demand GLB file.
 *
 * Checks size + glTF magic bytes BEFORE parsing so an HTML error page or a
 * truncated download can never reach GLTFLoader (which would throw an opaque
 * SyntaxError). A failed file is deleted so the install check flips back to
 * NOT_INSTALLED and the next Body open re-downloads cleanly — corrupt cache
 * can never wedge the feature.
 */
async function readValidatedGlbBuffer(
  localUri: string,
  fileName: string,
): Promise<ArrayBuffer> {
  const file = new ExpoFile(localUri);
  const raw = await file.arrayBuffer();
  const buffer = toRealArrayBuffer(raw);

  const bytes = new Uint8Array(buffer);
  const isGltf =
    buffer.byteLength > 12 &&
    bytes[0] === 0x67 && // g
    bytes[1] === 0x6c && // l
    bytes[2] === 0x54 && // T
    bytes[3] === 0x46; // F

  if (!isGltf) {
    try {
      await file.delete();
    } catch { /* best-effort — re-download will overwrite */ }
    throw new Error(
      `Cached anatomy file failed validation: ${fileName}. Re-open 3D Body to re-download.`,
    );
  }

  return buffer;
}

/**
 * Load a GLB file's binary data on native.
 * Returns an ArrayBuffer suitable for GLTFLoader.parse().
 */
async function loadGlbArrayBuffer(
  fileName: string,
  assetModule?: number
): Promise<ArrayBuffer | null> {
  if (Platform.OS === 'web') return null; // web uses load() not parse()
  if (!assetModule) return null;
  // NOTE: assetModule is always undefined on native since the on-demand
  // migration — native loads go through readValidatedGlbBuffer() with a
  // download-manager URI. This branch is retained for API compatibility.

  const assets = await Asset.loadAsync([assetModule]);
  const resolved = assets[0];
  await resolved.downloadAsync();
  const localUri = resolved.localUri ?? resolved.uri;

  // Use expo-file-system to read the binary, then guarantee a real
  // ArrayBuffer so three.js's instanceof checks always pass.
  const file = new ExpoFile(localUri);
  const raw = await file.arrayBuffer();
  return toRealArrayBuffer(raw);
}

// ---------------------------------------------------------------------------
// Native asset registry — INTENTIONALLY EMPTY (on-demand architecture).
// ---------------------------------------------------------------------------
// Anatomy .glb files are NOT bundled: Metro only packages statically
// require()d assets, and there are no require() calls for .glb anywhere in
// this file, so the 45 MB never enters the binary. At runtime every native
// load resolves through the download manager (getLocalModelUri + validated
// read below); web keeps serving from public/ via resolveGlbUri.
// The per-gender filename lists (MALE_MVP_FILES / FEMALE_MVP_FILES) remain
// the single source of truth for which files a gender needs.

const MALE_MVP_FILES = [
  'regional_male.glb',
  'muscular_male.glb',
  'skeletal_male.glb',
  'digestive_male.glb',
  'renal_male.glb',
  'reproductive_male.glb',
  'respiratory_male.glb',
  'endocrine_male.glb',
  'lymphatic_male.glb',
  'articular_male.glb',
  'nervous_male.glb',
  'visceral_male.glb',
  'cardiovascular_male.glb',
];

// ---------------------------------------------------------------------------
// Per-system color palette — premium anatomical layer visual identity
// ---------------------------------------------------------------------------
const SYSTEM_COLORS: Record<string, number> = {
  regional:      0xD4A574,  // warm skin tone — primary body surface
  muscular:      0xC44D4D,  // deep muscle red
  skeletal:      0xE8D8C8,  // warm ivory / bone (subdued)
  digestive:     0xA0522D,  // sienna / gut
  renal:         0xB22222,  // firebrick / kidney
  reproductive:  0xDB7093,  // pale violet red
  respiratory:   0x4682B4,  // steel blue / lungs
  endocrine:     0xDAA520,  // goldenrod / glands
  lymphatic:     0x2E8B57,  // sea green / lymph
  articular:     0x8B7D6B,  // warm gray / cartilage
  nervous:       0xFFD700,  // gold / nerves
  visceral:      0xCD853F,  // peru / visceral organs
  cardiovascular:0xDC143C, // crimson / vessels
  integumentary: 0xF5DEB3,  // wheat / skin layers
};

/**
 * Opacity hierarchy — body surface is opaque by default.
 * Skeleton is semi-transparent so organs are visible through the ribcage.
 */
const SYSTEM_OPACITY: Record<string, number> = {
  regional:      0.85,   // semi-transparent skin — shows organs beneath
  muscular:      0.0,    // hidden by default — user toggles on
  skeletal:      0.0,    // hidden by default — user toggles on
  digestive:     1.0,    // opaque organs
  renal:         1.0,
  reproductive:  1.0,
  respiratory:   1.0,
  endocrine:     1.0,
  lymphatic:     1.0,
  articular:     0.0,    // hidden by default
  nervous:       0.0,    // hidden by default
  visceral:      0.0,    // hidden by default
  cardiovascular:0.0,    // hidden by default
  integumentary: 0.85,   // skin layer — shows beneath regional
};

/** Render order — body surface first (behind), organs render on top. */
const SYSTEM_RENDER_ORDER: Record<string, number> = {
  regional:      0,     // body surface — behind everything
  integumentary: 1,     // skin layer — just above body surface
  muscular:      2,     // muscles — between skin and organs
  skeletal:      3,     // skeleton — behind organs
  digestive:     4,
  renal:         4,
  reproductive:  4,
  respiratory:   4,
  endocrine:     4,
  lymphatic:     4,
  articular:     3,     // joints/cartilage — with skeleton
  nervous:       5,     // nerves — on top
  visceral:      4,     // visceral organs
  cardiovascular:4,     // blood vessels
};

/**
 * Per-model coordinate alignment.

 * Z-Anatomy GLB files use different coordinate systems per body system.
 * muscular_male.glb is the reference space (~0.26 × 0.66 × 0.58).
 * Models outside this space need non-uniform scaling to align.
 *
 * Values are [sx, sy, sz] scale factors applied to the GLB group.
 * null means no scaling needed.
 */
/**
 * Per-model coordinate alignment.
 *
 * All Z-Anatomy GLB files share the same coordinate system:
 * ~0.6 m wide × ~1.67 m tall × ~0.26 m deep (Y-up).
 * No per-model scaling is needed — models already align anatomically.
 */
const MODEL_SCALE: Record<string, [number, number, number] | null> = {
  regional_male:    null,  // reference space
  muscular_male:    null,  // same coordinate system
  skeletal_male:    null,  // same coordinate system
  digestive_male:   null,  // same coordinate system (naturally smaller — organs)
  renal_male:       null,  // same coordinate system
  reproductive_male:null,  // same coordinate system
  respiratory_male: null,  // same coordinate system
  endocrine_male:   null,  // same coordinate system (naturally smaller — glands)
  lymphatic_male:   null,  // same coordinate system
};
const SYSTEM_LABELS: Record<string, string> = {
  regional:      'Body',
  muscular:      'Muscular',
  skeletal:      'Skeletal',
  digestive:     'Digestive',
  renal:         'Renal',
  reproductive:  'Reproductive',
  respiratory:   'Respiratory',
  endocrine:     'Endocrine',
  lymphatic:     'Lymphatic',
  articular:     'Articular',
  nervous:       'Nervous',
  visceral:      'Visceral',
  cardiovascular:'Cardiovascular',
  integumentary: 'Integumentary',
};
/** Extract the system key from a GLB filename, e.g. 'skeletal_male.glb' → 'skeletal' */
function systemKeyFromFileName(fileName: string): string {
  return fileName.replace(/_male\.glb$/, '').replace(/_female\.glb$/, '');
}

const FEMALE_MVP_FILES = [
  'skeletal_female.glb',
  'digestive_female.glb',
  'renal_female.glb',
  'reproductive_female.glb',
  'cardiovascular_female.glb',
  'lymphatic_female.glb',
  'integumentary_female.glb',
];

/**
 * On-demand coverage: the scene can draw a gender only from downloaded files.
 * There is intentionally no bundled fallback — the require() maps were
 * removed so Metro excludes the 45 MB from the binary. When files are absent
 * the download overlay/prompt (not an empty canvas) is the UI contract.
 */

/** Systems that are available for each gender */
const GENDER_SYSTEMS: Record<Gender, readonly string[]> = {
  male: ['regional', 'muscular', 'skeletal', 'digestive', 'renal', 'reproductive', 'respiratory', 'endocrine', 'lymphatic', 'articular', 'nervous', 'visceral', 'cardiovascular'],
  female: ['regional', 'skeletal', 'digestive', 'renal', 'reproductive', 'cardiovascular', 'lymphatic', 'integumentary'],
};

// ---------------------------------------------------------------------------
// Three.js Scene Manager (shared between web and native)
// ---------------------------------------------------------------------------

/** Per-layer load state for progressive loading */
export type LayerLoadState = 'idle' | 'loading' | 'loaded' | 'error';

class AnatomySceneManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer | null = null;
  loadedGroups: Map<string, THREE.Group> = new Map();
  private systemMaterials: Map<string, THREE.MeshStandardMaterial> = new Map();
  private systemVisibility: Map<string, boolean> = new Map();
  layerLoadState: Map<string, LayerLoadState> = new Map();
  private pendingLoads: Map<string, Promise<void>> = new Map();
  private nodeToStructure: Map<string, string>;
  private highlightMaterial: THREE.MeshStandardMaterial;
  private originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]> = new Map();
  private selectedStructureId: string | null = null;
  private onStructureSelected: ((structureId: string | null) => void) | null = null;
  private gl: any = null;

  // Orbit state
  private rotationY = 0;
  private rotationX = 0;
  private zoom = 1;
  private panX = 0;
  private panY = 0;

  constructor(gender: 'male' | 'female') {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf5f7f9);

    this.camera = new THREE.PerspectiveCamera(
      45,
      SCREEN_WIDTH / CANVAS_HEIGHT,
      0.01,
      100
    );
    this.camera.position.set(0, 0.3, 2.5);
    this.camera.lookAt(0, 0.3, 0);

    // Premium medical lighting setup
    // Soft ambient fill — prevents total blackness in cavities
    const ambientLight = new THREE.AmbientLight(0xf0ebe3, 0.5);
    this.scene.add(ambientLight);

    // Main key light — warm top-right
    const keyLight = new THREE.DirectionalLight(0xfff5ee, 1.0);
    keyLight.position.set(3, 8, 5);
    this.scene.add(keyLight);

    // Fill light — cool left side for dimension
    const fillLight = new THREE.DirectionalLight(0xe8f0ff, 0.45);
    fillLight.position.set(-4, 3, 2);
    this.scene.add(fillLight);

    // Rim / back light — edge definition
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.35);
    rimLight.position.set(0, 5, -6);
    this.scene.add(rimLight);

    // Subtle bottom fill to soften underside shadows
    const bottomFill = new THREE.DirectionalLight(0xf5e6d3, 0.2);
    bottomFill.position.set(0, -4, 3);
    this.scene.add(bottomFill);

    // Highlight material — for selected structures
    this.highlightMaterial = new THREE.MeshStandardMaterial({
      color: 0x0d9488,
      emissive: 0x0d9488,
      emissiveIntensity: 0.3,
      roughness: 0.3,
      metalness: 0.15,
      transparent: false,
    });

    // Default fallback material
    this.defaultMaterial = new THREE.MeshStandardMaterial({
      color: 0xe8d5c4,
      roughness: 0.6,
      metalness: 0.05,
    });

    // Build node→structure map
    this.nodeToStructure = buildNodeToStructureMap(gender);
  }

  private defaultMaterial: THREE.MeshStandardMaterial;

  /** Store the expo-gl context for endFrameEXP calls. */
  setExpoGLContext(gl: any) {
    this.gl = gl;
  }

  /** Toggle visibility of an anatomical system. */
  setSystemVisibility(systemKey: string, visible: boolean) {
    this.systemVisibility.set(systemKey, visible);
    const group = this.loadedGroups.get(systemKey);
    if (group) {
      group.visible = visible;
      // When toggling ON, restore the system's default opacity.
      // Systems like skeleton/muscular start at opacity 0 and need
      // their material opacity restored when the user enables them.
      if (visible) {
        const defaultOpacity = SYSTEM_OPACITY[systemKey] ?? 1.0;
        const mat = this.systemMaterials.get(systemKey);
        if (mat && defaultOpacity > 0) {
          mat.opacity = defaultOpacity;
          mat.transparent = defaultOpacity < 1.0;
          mat.depthWrite = defaultOpacity >= 1.0;
          mat.needsUpdate = true;
        }
      }
      console.log(`[Body] System "${systemKey}" visibility → ${visible}`);
    }
  }

  /** Get current visibility of a system. */
  getSystemVisibility(systemKey: string): boolean {
    return this.systemVisibility.get(systemKey) ?? true;
  }

  /** Get the load state of a layer. */
  getLayerLoadState(systemKey: string): LayerLoadState {
    return this.layerLoadState.get(systemKey) ?? 'idle';
  }

  /** Check if a layer is currently being loaded. */
  isLayerLoading(systemKey: string): boolean {
    return this.layerLoadState.get(systemKey) === 'loading';
  }

  /** Set the Three.js renderer. */
  setRenderer(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.renderer.setPixelRatio(Math.min(Platform.OS === 'web' ? window.devicePixelRatio : 2, 2));
    this.renderer.setSize(SCREEN_WIDTH, CANVAS_HEIGHT);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
  }

  setOnStructureSelected(cb: ((structureId: string | null) => void) | null) {
    this.onStructureSelected = cb;
  }

  /** Load a GLB file from a fetch()-able URL (web). */
  async loadGlbFromUri(fileName: string, uri: string): Promise<void> {
    if (this.loadedGroups.has(fileName)) return;
    const t0 = performance.now();
    console.log(`[Body] Loading ${fileName} from URI…`);
    try {
      const loader = new GLTFLoader();
      const dracoLoader = createNativeDRACOLoader();
      loader.setDRACOLoader(dracoLoader);
      const gltf = await new Promise<THREE.Group>((resolve, reject) => {
        loader.load(uri, (gltf) => resolve(gltf.scene), undefined, (error) => reject(error));
      });
      const parseMs = (performance.now() - t0).toFixed(0);
      this._addGlbToScene(fileName, gltf);
      const totalMs = (performance.now() - t0).toFixed(0);
      dracoLoader.dispose();
      console.log(`[Body] ✅ ${fileName} loaded (web) parse=${parseMs}ms total=${totalMs}ms`);
    } catch (error) {
      console.error(`[Body] ❌ Failed to load ${fileName}:`, error);
    }
  }

  /** Load a GLB file from an ArrayBuffer (native). */
  async loadGlbFromBuffer(fileName: string, buffer: ArrayBuffer): Promise<void> {
    if (this.loadedGroups.has(fileName)) return;
    const t0 = performance.now();
    console.log(`[Body] Loading ${fileName} (${buffer.byteLength} bytes)…`);
    try {
      const loader = new GLTFLoader();
      const dracoLoader = createNativeDRACOLoader();
      loader.setDRACOLoader(dracoLoader);
      const gltf = await new Promise<THREE.Group>((resolve, reject) => {
        loader.parse(buffer, '', (gltf) => resolve(gltf.scene), (error) => reject(error));
      });
      const parseMs = (performance.now() - t0).toFixed(0);
      this._addGlbToScene(fileName, gltf);
      const totalMs = (performance.now() - t0).toFixed(0);
      dracoLoader.dispose();
      console.log(`[Body] ✅ ${fileName} loaded (native) parse=${parseMs}ms total=${totalMs}ms`);
    } catch (error) {
      console.error(`[Body] ❌ Failed to load ${fileName} from buffer:`, error);
    }
  }

  /**
   * Load a single layer on demand.
   * Used when a user toggles a layer ON that hasn't been loaded yet.
   * Returns a promise that resolves when the layer is loaded or already loaded.
   */
  loadLayerOnDemand(
    fileName: string,
    localUri?: string,
    assetModule?: number,
  ): Promise<void> {
    const sysKey = systemKeyFromFileName(fileName);

    // Already loaded
    if (this.loadedGroups.has(fileName)) {
      return Promise.resolve();
    }

    // Already loading — return existing promise
    const pending = this.pendingLoads.get(fileName);
    if (pending) return pending;

    this.layerLoadState.set(sysKey, 'loading');
    console.log(`[Body] LOAD ON DEMAND: ${fileName} START`);
    const t0 = performance.now();

    const promise = (async () => {
      try {
        if (localUri) {
          if (Platform.OS === 'web') {
            await this.loadGlbFromUri(fileName, localUri);
          } else {
            const buffer = await readValidatedGlbBuffer(localUri, fileName);
            await this.loadGlbFromBuffer(fileName, buffer);
          }
        } else if (assetModule) {
          if (Platform.OS === 'web') {
            const uri = await resolveGlbUri(fileName, assetModule);
            await this.loadGlbFromUri(fileName, uri);
          } else {
            const buffer = await loadGlbArrayBuffer(fileName, assetModule);
            if (buffer) await this.loadGlbFromBuffer(fileName, buffer);
          }
        }
        this.layerLoadState.set(sysKey, 'loaded');
        const elapsed = (performance.now() - t0).toFixed(0);
        console.log(`[Body] LOAD ON DEMAND: ${fileName} COMPLETE (${elapsed}ms)`);
      } catch (err) {
        this.layerLoadState.set(sysKey, 'error');
        console.error(`[Body] LOAD ON DEMAND: ${fileName} FAILED`, err);
      } finally {
        this.pendingLoads.delete(fileName);
      }
    })();

    this.pendingLoads.set(fileName, promise);
    return promise;
  }

  private _addGlbToScene(fileName: string, gltf: THREE.Group) {
    const t0 = performance.now();
    const sysKey = systemKeyFromFileName(fileName);
    const colorHex = SYSTEM_COLORS[sysKey] ?? 0xe8d5c4;
    const opacity = SYSTEM_OPACITY[sysKey] ?? 1.0;
    const renderOrder = SYSTEM_RENDER_ORDER[sysKey] ?? 1;
    const isTransparent = opacity < 1.0;

    // Apply per-model coordinate alignment
    const modelKey = fileName.replace(/\.glb$/, '');
    const scale = MODEL_SCALE[modelKey];
    if (scale) {
      gltf.scale.set(scale[0], scale[1], scale[2]);
    }

    const systemMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: sysKey === 'skeletal' ? 0.7 : 0.5,
      metalness: sysKey === 'skeletal' ? 0.02 : 0.08,
      transparent: isTransparent,
      opacity: opacity,
      depthWrite: !isTransparent,
      side: THREE.DoubleSide,
    });
    this.systemMaterials.set(sysKey, systemMat);
    this.systemVisibility.set(sysKey, true);

    let meshCount = 0;
    gltf.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = systemMat;
        child.userData.selectable = true;
        child.userData.glbFile = fileName;
        child.userData.systemKey = sysKey;
        child.userData.originalMaterial = systemMat;
        child.renderOrder = renderOrder;
        meshCount++;
      }
    });
    this.scene.add(gltf);
    this.loadedGroups.set(fileName, gltf);
    const addMs = (performance.now() - t0).toFixed(0);
    console.log(`[Body] _addGlbToScene ${fileName}: ${meshCount} meshes, ${addMs}ms`);
  }

  /**
   * Compute the world-space bounding box of all loaded meshes and
   * reposition the camera to frame everything with a comfortable margin.
   */
  fitCameraToScene() {
    if (this.loadedGroups.size === 0) return;

    // Only compute bounding box from VISIBLE groups so hidden layers
    // (skeletal, organs, etc.) don't push the camera out of frame.
    const box = new THREE.Box3();
    let hasMesh = false;
    this.loadedGroups.forEach((group) => {
      if (!group.visible) return;
      group.updateMatrixWorld(true);
      group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry) {
          child.geometry.computeBoundingBox();
          const childBox = new THREE.Box3().setFromObject(child);
          if (!hasMesh) {
            box.copy(childBox);
            hasMesh = true;
          } else {
            box.union(childBox);
          }
        }
      });
    });

    // Fallback: if nothing visible, use all loaded groups
    if (!hasMesh) {
      this.loadedGroups.forEach((group) => {
        group.updateMatrixWorld(true);
        group.traverse((child) => {
          if (child instanceof THREE.Mesh && child.geometry) {
            child.geometry.computeBoundingBox();
            const childBox = new THREE.Box3().setFromObject(child);
            if (!hasMesh) {
              box.copy(childBox);
              hasMesh = true;
            } else {
              box.union(childBox);
            }
          }
        });
      });
    }

    if (!hasMesh) return;

    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (this.camera.fov * Math.PI) / 180;
    let distance = (maxDim / 2) / Math.tan(fov / 2);
    distance *= 1.3; // 30 % margin

    this.camera.position.set(center.x, center.y, center.z + distance);
    this.camera.lookAt(center);
    this.camera.near = distance * 0.001;
    this.camera.far = distance * 20;
    this.camera.updateProjectionMatrix();

    console.log(
      `[Body] Camera framed: center=[${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)}] ` +
      `size=[${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)}] distance=${distance.toFixed(2)}`,
    );
  }

  /** Render one frame. */
  render() {
    if (!this.renderer) return;

    this.loadedGroups.forEach((group) => {
      group.rotation.y = this.rotationY;
      group.rotation.x = this.rotationX;
      group.scale.setScalar(this.zoom);
      group.position.x = this.panX;
      group.position.y = this.panY;
    });

    this.renderer.render(this.scene, this.camera);

    // On native, tell expo-gl to present the frame
    if (this.gl && Platform.OS !== 'web') {
      this.gl.endFrameEXP();
    }
  }

  /** Raycast to find clicked mesh at screen coordinates. */
  handleTap(x: number, y: number) {
    if (!this.renderer) return;

    const mouse = new THREE.Vector2(
      (x / SCREEN_WIDTH) * 2 - 1,
      -((y - (SCREEN_HEIGHT - CANVAS_HEIGHT)) / CANVAS_HEIGHT) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    const meshes: THREE.Object3D[] = [];
    this.loadedGroups.forEach((group) => {
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes.push(child);
      });
    });

    const intersects = raycaster.intersectObjects(meshes, false);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      if (hit instanceof THREE.Mesh && hit.userData.selectable) {
        const nodeName = hit.name;
        const structureId = this.nodeToStructure.get(nodeName);
        if (structureId) {
          this.selectStructure(structureId);
          return;
        }
      }
    }
    this.selectStructure(null);
  }

  /** Select a structure and highlight its meshes. */
  selectStructure(structureId: string | null) {
    if (this.selectedStructureId === structureId) return;

    // Unhighlight previous
    if (this.selectedStructureId) {
      const prevMapping = getMapping(this.selectedStructureId);
      if (prevMapping) {
        const nodeNames = new Set([...prevMapping.male, ...prevMapping.female].map((r) => r.nodeName));
        this.loadedGroups.forEach((group) => {
          group.traverse((child) => {
            if (child instanceof THREE.Mesh && nodeNames.has(child.name)) {
              const orig = this.originalMaterials.get(child);
              if (orig) child.material = orig;
            }
          });
        });
      }
    }

    this.selectedStructureId = structureId;

    // Highlight new
    if (structureId) {
      const mapping = getMapping(structureId);
      if (mapping) {
        const nodeNames = new Set([...mapping.male, ...mapping.female].map((r) => r.nodeName));
        this.loadedGroups.forEach((group) => {
          group.traverse((child) => {
            if (child instanceof THREE.Mesh && nodeNames.has(child.name)) {
              if (!this.originalMaterials.has(child)) {
                this.originalMaterials.set(child, child.material);
              }
              child.material = this.highlightMaterial;
            }
          });
        });
      }
    }

    this.onStructureSelected?.(structureId);
  }

  handlePanMove(dx: number, dy: number) {
    this.rotationY += dx * 0.005;
    this.rotationX = Math.max(
      -Math.PI / 3,
      Math.min(Math.PI / 3, this.rotationX + dy * 0.005)
    );
  }

  handlePinch(scale: number) {
    this.zoom = Math.max(0.3, Math.min(3, this.zoom * scale));
  }

  resetView() {
    this.rotationY = 0;
    this.rotationX = 0;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }

  dispose() {
    this.loadedGroups.forEach((group) => {
      this.scene.remove(group);
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    });
    this.loadedGroups.clear();
    this.originalMaterials.clear();
    this.renderer?.dispose();
  }
}

// ---------------------------------------------------------------------------
// Shared setup logic
// ---------------------------------------------------------------------------

/**
 * Scene setup — loads ONLY regional.
 *
 * All other anatomy layers are loaded on-demand when the user
 * toggles them ON via toggleLayer → loadLayerOnDemand().
 *
 * This ensures:
 * - Body opens fast (only one GLB parse)
 * - UI/navigation remain responsive immediately
 * - No automatic background parsing of 12 additional GLBs
 * - Each layer loads independently when needed
 */
async function setupScene(
  gender: 'male' | 'female',
  scene: AnatomySceneManager,
  onStructureSelected: (id: string | null) => void,
  localFiles?: Map<string, string>,
): Promise<void> {
  scene.setOnStructureSelected(onStructureSelected);

  // Determine the regional file for this gender
  const regionalFile = gender === 'male' ? 'regional_male.glb' : 'skeletal_female.glb';
  console.log(`[Body] STARTUP: Loading ${regionalFile} only`);
  const t0 = performance.now();
  const localUri = localFiles?.get(regionalFile);

  if (localUri) {
    if (Platform.OS === 'web') {
      await scene.loadGlbFromUri(regionalFile, localUri);
    } else {
      // Measure file read separately from GLB parse
      const tFileRead = performance.now();
      const buffer = await readValidatedGlbBuffer(localUri, regionalFile);
      const fileReadMs = (performance.now() - tFileRead).toFixed(0);
      console.log(`[Body] ${regionalFile} file read: ${fileReadMs}ms (${buffer.byteLength} bytes)`);

      await scene.loadGlbFromBuffer(regionalFile, buffer);
    }
  } else if (Platform.OS === 'web') {
    const uri = await resolveGlbUri(regionalFile);
    await scene.loadGlbFromUri(regionalFile, uri);
  } else {
    // No downloaded file and no bundled fallback (by design): the overlay
    // above owns this state. Log loudly so a silent empty canvas is never
    // mistaken for a successful load.
    console.warn(`[Body] STARTUP: ${regionalFile} has no local file — download required`);
  }

  const elapsed = (performance.now() - t0).toFixed(0);
  console.log(`[Body] STARTUP: ${regionalFile} COMPLETE (${elapsed}ms)`);

  // Fit camera to regional only
  const tCamera = performance.now();
  scene.fitCameraToScene();
  const cameraMs = (performance.now() - tCamera).toFixed(0);
  console.log(`[Body] fitCameraToScene: ${cameraMs}ms`);
  console.log('[Body] Startup complete — other layers load on demand');
}

// ---------------------------------------------------------------------------
// Native 3D Canvas — uses expo-gl
// ---------------------------------------------------------------------------

interface NativeCanvasProps {
  gender: 'male' | 'female';
  onStructureSelected: (structureId: string | null) => void;
  sceneRef: React.MutableRefObject<AnatomySceneManager | null>;
  localFiles?: Map<string, string>;
}

function NativeCanvas({ gender, onStructureSelected, sceneRef, localFiles }: NativeCanvasProps) {
  const animFrameRef = useRef<number>(0);
  const lastTapRef = useRef<number>(0);
  const gestureState = useRef({ lastX: 0, lastY: 0, lastDist: 0, isPinching: false });
  const [loading, setLoading] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    return () => {
      mounted = false;
      cancelAnimationFrame(animFrameRef.current);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [gender]);

  const handleContextCreate = useCallback(async (gl: any) => {
    try {
      // -----------------------------------------------------------------------
      // Three.js r163+ rejects any context passed via the `context` option when
      // `context instanceof WebGLRenderingContext` is true. expo-gl's
      // WebGL2RenderingContext extends WebGLRenderingContext (per the WebGL
      // spec), so the instanceof check triggers even for expo-gl's WebGL2
      // context — a false positive.
      //
      // Fix: instead of passing the expo-gl context directly via `context`,
      // provide a canvas shim with a `getContext('webgl2')` method that
      // returns the expo-gl context. This makes Three.js create its own
      // internal reference while skipping the instanceof check entirely
      // (because `context` is null, the check block is never entered).
      // -----------------------------------------------------------------------

      const canvas = {
        width: SCREEN_WIDTH,
        height: CANVAS_HEIGHT,
        style: {} as Record<string, any>,
        getContext: (name: string, _attrs?: any) => {
          if (name === 'webgl2') {
            // Three.js accesses gl.canvas in WebGLState.js for scissor/
            // viewport sizing. expo-gl contexts don't carry a `canvas`
            // property, so attach it here.
            if (!(gl as any).canvas) {
              (gl as any).canvas = canvas;
            }
            return gl;
          }
          return null;
        },
        addEventListener: () => {},
        removeEventListener: () => {},
        setAttribute: () => {},
        removeAttribute: () => {},
      };

      const renderer = new THREE.WebGLRenderer({
        canvas: canvas as any,
        antialias: true,
        alpha: true,
      });

      renderer.setPixelRatio(Math.min(Platform.OS === 'web' ? window.devicePixelRatio : 2, 2));
      renderer.setSize(SCREEN_WIDTH, CANVAS_HEIGHT);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.sortObjects = true;

      // Create scene manager
      const scene = new AnatomySceneManager(gender);
      scene.setRenderer(renderer);
      scene.setExpoGLContext(gl);
      sceneRef.current = scene;

      // Load regional only — fast, returns quickly
      await setupScene(gender, scene, onStructureSelected, localFiles);
      setLoading(false);

      // Start render loop — UI is interactive after regional loads
      const animate = () => {
        scene.render();
        animFrameRef.current = requestAnimationFrame(animate);
      };
      animate();
    } catch (err) {
      console.error('[Body] Failed to initialize 3D renderer:', err);
      setLoading(false);
      setRenderError(err instanceof Error ? err.message : 'Failed to initialize 3D renderer');
    }
  }, [gender, onStructureSelected, sceneRef, localFiles]);

  // Gesture handlers
  const handleTouchStart = (e: GestureResponderEvent) => {
    const touches = e.nativeEvent.touches;
    if (touches.length === 1) {
      gestureState.current.lastX = touches[0].pageX;
      gestureState.current.lastY = touches[0].pageY;
      gestureState.current.isPinching = false;
    } else if (touches.length === 2) {
      const dx = touches[0].pageX - touches[1].pageX;
      const dy = touches[0].pageY - touches[1].pageY;
      gestureState.current.lastDist = Math.sqrt(dx * dx + dy * dy);
      gestureState.current.isPinching = true;
    }
  };

  const handleTouchMove = (e: GestureResponderEvent) => {
    const touches = e.nativeEvent.touches;
    if (touches.length === 1 && !gestureState.current.isPinching) {
      const dx = touches[0].pageX - gestureState.current.lastX;
      const dy = touches[0].pageY - gestureState.current.lastY;
      sceneRef.current?.handlePanMove(dx, dy);
      gestureState.current.lastX = touches[0].pageX;
      gestureState.current.lastY = touches[0].pageY;
    } else if (touches.length === 2) {
      const dx = touches[0].pageX - touches[1].pageX;
      const dy = touches[0].pageY - touches[1].pageY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (gestureState.current.lastDist > 0) {
        const scale = dist / gestureState.current.lastDist;
        sceneRef.current?.handlePinch(scale);
      }
      gestureState.current.lastDist = dist;
    }
  };

  const handleTouchEnd = (e: GestureResponderEvent) => {
    if (e.nativeEvent.touches.length === 0) {
      gestureState.current.isPinching = false;
    }
  };

  const handleResponderRelease = (e: GestureResponderEvent) => {
    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;

    if (timeSinceLastTap < 300) {
      sceneRef.current?.resetView();
    } else {
      const touch = e.nativeEvent;
      sceneRef.current?.handleTap(touch.pageX, touch.pageY);
    }
    lastTapRef.current = now;
  };

  return (
    <View
      style={styles.canvasContainer}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onResponderRelease={handleResponderRelease}
      onStartShouldSetResponder={() => true}
    >
      <GLView
        style={{ width: SCREEN_WIDTH, height: CANVAS_HEIGHT }}
        onContextCreate={handleContextCreate}
      />
      {renderError ? (
        <View style={styles.loadingOverlay}>
          <Text style={styles.loadingText}>3D viewer unavailable</Text>
        </View>
      ) : loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={GV.teal} />
          <Text style={styles.loadingText}>Loading 3D model…</Text>
          <HealthFact style={styles.factText} />
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Web 3D Canvas — uses raw <canvas>
// ---------------------------------------------------------------------------

interface WebCanvasProps {
  gender: 'male' | 'female';
  onStructureSelected: (structureId: string | null) => void;
  sceneRef: React.MutableRefObject<AnatomySceneManager | null>;
  localFiles?: Map<string, string>;
}

function WebCanvas({ gender, onStructureSelected, sceneRef, localFiles }: WebCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastTapRef = useRef<number>(0);
  const gestureState = useRef({ lastX: 0, lastY: 0, lastDist: 0, isPinching: false });

  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.width = SCREEN_WIDTH;
      canvas.height = CANVAS_HEIGHT;

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(SCREEN_WIDTH, CANVAS_HEIGHT);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      rendererRef.current = renderer;

      const scene = new AnatomySceneManager(gender);
      scene.setRenderer(renderer);
      sceneRef.current = scene;

      await setupScene(gender, scene, onStructureSelected, localFiles);

      if (!mounted) {
        scene.dispose();
        return;
      }

      const animate = () => {
        if (!mounted) return;
        scene.render();
        animFrameRef.current = requestAnimationFrame(animate);
      };
      animate();
    };

    setup();

    return () => {
      mounted = false;
      cancelAnimationFrame(animFrameRef.current);
      sceneRef.current?.dispose();
      rendererRef.current?.dispose();
      sceneRef.current = null;
      rendererRef.current = null;
    };
  }, [gender, localFiles]);

  const handleTouchStart = (e: GestureResponderEvent) => {
    const touches = e.nativeEvent.touches;
    if (touches.length === 1) {
      gestureState.current.lastX = touches[0].pageX;
      gestureState.current.lastY = touches[0].pageY;
      gestureState.current.isPinching = false;
    } else if (touches.length === 2) {
      const dx = touches[0].pageX - touches[1].pageX;
      const dy = touches[0].pageY - touches[1].pageY;
      gestureState.current.lastDist = Math.sqrt(dx * dx + dy * dy);
      gestureState.current.isPinching = true;
    }
  };

  const handleTouchMove = (e: GestureResponderEvent) => {
    const touches = e.nativeEvent.touches;
    if (touches.length === 1 && !gestureState.current.isPinching) {
      const dx = touches[0].pageX - gestureState.current.lastX;
      const dy = touches[0].pageY - gestureState.current.lastY;
      sceneRef.current?.handlePanMove(dx, dy);
      gestureState.current.lastX = touches[0].pageX;
      gestureState.current.lastY = touches[0].pageY;
    } else if (touches.length === 2) {
      const dx = touches[0].pageX - touches[1].pageX;
      const dy = touches[0].pageY - touches[1].pageY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (gestureState.current.lastDist > 0) {
        sceneRef.current?.handlePinch(dist / gestureState.current.lastDist);
      }
      gestureState.current.lastDist = dist;
    }
  };

  const handleTouchEnd = (e: GestureResponderEvent) => {
    if (e.nativeEvent.touches.length === 0) {
      gestureState.current.isPinching = false;
    }
  };

  const handleResponderRelease = (e: GestureResponderEvent) => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      sceneRef.current?.resetView();
    } else {
      sceneRef.current?.handleTap(e.nativeEvent.pageX, e.nativeEvent.pageY);
    }
    lastTapRef.current = now;
  };

  return (
    <View
      style={styles.canvasContainer}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onResponderRelease={handleResponderRelease}
      onStartShouldSetResponder={() => true}
    >
      <canvas
        ref={canvasRef}
        width={SCREEN_WIDTH}
        height={CANVAS_HEIGHT}
        style={styles.webCanvas}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Expo Go native-safe fallback (NO browser <canvas>)
// ---------------------------------------------------------------------------

interface NativePlaceholderProps {
  gender: Gender;
  onStructureSelected: (structureId: string | null) => void;
}

function NativePlaceholder({ gender, onStructureSelected }: NativePlaceholderProps) {
  return (
    <View style={styles.nativePlaceholder}>
      <Text style={styles.nativePlaceholderIcon}>3D</Text>
      <Text style={styles.nativePlaceholderTitle}>3D Body View</Text>
      <Text style={styles.nativePlaceholderText}>
        The 3D anatomy viewer requires a development build with native modules.
      </Text>
      <Text style={styles.nativePlaceholderHint}>
        Use EAS Build or Expo Dev Client for the full 3D experience.
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Platform-switching canvas wrapper
// ---------------------------------------------------------------------------

interface ThreeCanvasProps {
  gender: 'male' | 'female';
  onStructureSelected: (structureId: string | null) => void;
  sceneRef: React.MutableRefObject<AnatomySceneManager | null>;
  localFiles?: Map<string, string>;
}

function ThreeCanvas(props: ThreeCanvasProps) {
  if (Platform.OS === 'web') {
    return <WebCanvas {...props} />;
  }
  // Filament is only available in native builds (EAS / Expo Dev Client).
  // In Expo Go the conditional require above will have left it null.
  if (!FilamentBody) {
    return <NativePlaceholder gender={props.gender} onStructureSelected={props.onStructureSelected} />;
  }
  return <FilamentBody {...props as any} />;
}

// ---------------------------------------------------------------------------
// Info Panel
// ---------------------------------------------------------------------------

interface InfoPanelProps {
  structureId: string | null;
  bodyStateData: BodyStateItem[] | undefined;
  onClose: () => void;
  onViewGraph: (structureId: string) => void;
}

function InfoPanel({ structureId, bodyStateData, onClose, onViewGraph }: InfoPanelProps) {
  if (!structureId) return null;

  const mapping = getMapping(structureId);
  const bodyState = bodyStateData?.find((b) => b.structure_id === structureId);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'normal': return GV.fx.green;
      case 'mild_attention': return GV.fx.amber;
      case 'warning': return GV.danger;
      case 'critical': return GV.danger;
      default: return GV.muted;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'normal': return 'Normal';
      case 'mild_attention': return 'Mild Attention';
      case 'warning': return 'Warning';
      case 'critical': return 'Critical';
      default: return status;
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'improving': return '↓';
      case 'worsening': return '↑';
      case 'stable': return '→';
      case 'resolved': return '✓';
      default: return '—';
    }
  };

  return (
    <View style={styles.infoPanel}>
      <View style={styles.infoPanelHeader}>
        <Text style={styles.infoPanelTitle}>
          {mapping?.displayName ?? structureId}
        </Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
      </View>

      {mapping?.mappingType && (
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Mapping</Text>
          <Text style={styles.infoValue}>{mapping.mappingType}</Text>
        </View>
      )}

      {mapping?.notes && (
        <Text style={styles.infoNotes}>{mapping.notes}</Text>
      )}

      {bodyState ? (
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: getStatusColor(bodyState.visual_status) },
              ]}
            />
            <Text style={styles.statusText}>
              {getStatusLabel(bodyState.visual_status)}
            </Text>
            <Text style={styles.trendText}>
              {getTrendIcon(bodyState.trend)} {bodyState.trend}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Severity</Text>
            <Text style={styles.infoValue}>
              {(bodyState.severity * 100).toFixed(0)}%
            </Text>
          </View>

          {bodyState.latest_summary && (
            <Text style={styles.summaryText}>{bodyState.latest_summary}</Text>
          )}
        </View>
      ) : (
        <View style={styles.noObservationCard}>
          <Text style={styles.noObservationText}>No recorded observation</Text>
          <Text style={styles.noObservationSubtext}>
            This structure has no clinical data yet.
          </Text>
        </View>
      )}

      {/* Region → graph wiring: the selected anatomical structure resolves
          to its HealthGraph node (focusStructureId), reusing the existing
          anatomical IDs — never invented region ids. */}
      <TouchableOpacity
        onPress={() => structureId && onViewGraph(structureId)}
        accessibilityRole="button"
        accessibilityLabel={`View ${mapping?.displayName ?? structureId} in HealthGraph`}
        style={styles.graphLink}
      >
        <Text style={styles.graphLinkText}>View in HealthGraph</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main BodyScreen Component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Storage management section (shown below layer toggles)
// ---------------------------------------------------------------------------

function StorageManagementSection() {
  const { maleStatus, femaleStatus, deleteGender, refreshStatus } = useAnatomy();
  const [confirmDelete, setConfirmDelete] = useState<Gender | null>(null);

  const handleDelete = async (g: Gender) => {
    await deleteGender(g);
    setConfirmDelete(null);
  };

  return (
    <View style={styles.storageSection}>
      <Text style={styles.storageSectionTitle}>3D Anatomy Storage</Text>
      {(['male', 'female'] as Gender[]).map((g) => {
        const status = g === 'male' ? maleStatus : femaleStatus;
        const label = g === 'male' ? 'Male' : 'Female';
        const installed = status.state === 'INSTALLED';
        return (
          <View key={g} style={styles.storageRow}>
            <View style={styles.storageInfo}>
              <Text style={styles.storageLabel}>{label} Anatomy</Text>
              <Text style={styles.storageStatus}>
                {installed ? '✓ Installed' : 'Not installed'}
              </Text>
            </View>
            {installed && (
              confirmDelete === g ? (
                <View style={styles.storageConfirmRow}>
                  <TouchableOpacity
                    style={styles.storageConfirmBtn}
                    onPress={() => handleDelete(g)}
                  >
                    <Text style={styles.storageConfirmText}>Delete</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.storageCancelBtn}
                    onPress={() => setConfirmDelete(null)}
                  >
                    <Text style={styles.storageCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.storageDeleteBtn}
                  onPress={() => setConfirmDelete(g)}
                >
                  <Text style={styles.storageDeleteText}>Delete</Text>
                </TouchableOpacity>
              )
            )}
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main BodyScreen Component
// ---------------------------------------------------------------------------

export default function BodyScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    selectedGender: ctxGender,
    maleStatus,
    femaleStatus,
    isReady,
    isDownloading,
    selectGender: ctxSelectGender,
    downloadGender,
    refreshStatus,
  } = useAnatomy();

  const [gender, setGender] = useState<Gender>(ctxGender);
  const [selectedStructure, setSelectedStructure] = useState<string | null>(null);
  const sceneRef = useRef<AnatomySceneManager | null>(null);
  const [showGenderPrompt, setShowGenderPrompt] = useState<Gender | null>(null);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({
    regional: true,
    muscular: false,
    skeletal: false,
    digestive: true,
    renal: true,
    reproductive: true,
    respiratory: true,
    endocrine: true,
    lymphatic: true,
    articular: false,
    nervous: false,
    visceral: false,
    cardiovascular: false,
    integumentary: true,
  });

  const { data: bodyStateData } = useBodyState();

  // Sync gender with context on mount
  useEffect(() => {
    setGender(ctxGender);
  }, [ctxGender]);

  // Build local files map from download service
  const localFiles = useCallback(() => {
    const map = new Map<string, string>();
    const status = gender === 'male' ? maleStatus : femaleStatus;
    if (status.state !== 'INSTALLED') return undefined;
    const files = gender === 'male' ? MALE_MVP_FILES : FEMALE_MVP_FILES;
    for (const f of files) {
      map.set(f, getLocalModelUri(gender, f));
    }
    return map;
  }, [gender, maleStatus, femaleStatus])();

  const currentStatus = gender === 'male' ? maleStatus : femaleStatus;
  const isInstalled = currentStatus.state === 'INSTALLED';

  // The canvas only draws from downloaded files. No bundled fallback exists
  // by design (see above) — the overlay/prompt below is the full contract
  // for the not-installed and downloading states.

  // Show overlay if not installed OR currently downloading
  // This ensures the progress UI is visible during download
  const showOverlay = !isInstalled || isDownloading;

  const handleStructureSelected = useCallback((structureId: string | null) => {
    setSelectedStructure(structureId);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedStructure(null);
    sceneRef.current?.selectStructure(null);
  }, []);

  // Gender toggle — check installation before switching
  const handleGenderSwitch = useCallback((newGender: Gender) => {
    if (newGender === gender) return;

    const status = newGender === 'male' ? maleStatus : femaleStatus;
    if (status.state === 'INSTALLED') {
      // Installed — switch directly
      setGender(newGender);
      ctxSelectGender(newGender);
    } else {
      // Target not installed — show download prompt
      setShowGenderPrompt(newGender);
    }
  }, [gender, maleStatus, femaleStatus, ctxSelectGender]);

  const handleGenderPromptDownload = useCallback(() => {
    if (showGenderPrompt) {
      ctxSelectGender(showGenderPrompt);
      setGender(showGenderPrompt);
      setShowGenderPrompt(null);
      // Fire-and-forget: download runs in background, do NOT await
      downloadGender();
    }
  }, [showGenderPrompt, ctxSelectGender, downloadGender]);

  const toggleLayer = useCallback((sysKey: string) => {
    setLayerVisibility((prev) => {
      const next = { ...prev, [sysKey]: !prev[sysKey] };
      const scene = sceneRef.current;
      if (!scene) return next;

      if (next[sysKey]) {
        // Toggling ON — check if the model needs to be loaded on demand
        const genderSuffix = gender === 'male' ? '_male' : '_female';
        const fileName = `${sysKey}${genderSuffix}.glb`;
        const isLoaded = scene.loadedGroups.has(fileName);
        const isLoading = scene.isLayerLoading(sysKey);

        if (!isLoaded && !isLoading) {
          // Load on demand from the downloaded file (no bundled fallback).
          const localUri = localFiles?.get(fileName);
          scene.loadLayerOnDemand(fileName, localUri, undefined).then(() => {
            // Make visible after loading completes
            scene.setSystemVisibility(sysKey, true);
            scene.fitCameraToScene();
          });
          // Set visible optimistically — will appear once loaded
          scene.setSystemVisibility(sysKey, true);
        } else {
          scene.setSystemVisibility(sysKey, true);
          // Skip the deferred fit if the scene was torn down meanwhile
          // (unmount/dispose nulls sceneRef) — never act on a dead scene.
          setTimeout(() => { if (sceneRef.current === scene) scene.fitCameraToScene(); }, 50);
        }
      } else {
        // Toggling OFF — just hide
        scene.setSystemVisibility(sysKey, false);
        setTimeout(() => { if (sceneRef.current === scene) scene.fitCameraToScene(); }, 50);
      }

      return next;
    });
  }, [gender, localFiles]);

  // Gender-specific layer keys
  const genderSystemKeys = GENDER_SYSTEMS[gender];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>3D Body</Text>

        <View style={styles.genderToggle}>
          <TouchableOpacity
            style={[styles.genderButton, gender === 'male' && styles.genderButtonActive]}
            onPress={() => handleGenderSwitch('male')}
          >
            <Text style={[styles.genderButtonText, gender === 'male' && styles.genderButtonTextActive]}>
              Male
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.genderButton, gender === 'female' && styles.genderButtonActive]}
            onPress={() => handleGenderSwitch('female')}
          >
            <Text style={[styles.genderButtonText, gender === 'female' && styles.genderButtonTextActive]}>
              Female
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 3D Canvas with download overlay behind */}
      <View style={{ flex: 1 }}>
        <ThreeCanvas
          key={gender}
          gender={gender}
          onStructureSelected={handleStructureSelected}
          sceneRef={sceneRef}
          localFiles={isInstalled ? localFiles : undefined}
        />

        {/* Download overlay — always rendered during download/selection/error */}
        {showOverlay && (
          <AnatomyDownloadOverlay />
        )}

        {/* Gender switch download prompt */}
        {showGenderPrompt && !isDownloading && (
          <NotInstalledPrompt
            gender={showGenderPrompt}
            onDownload={handleGenderPromptDownload}
            onCancel={() => setShowGenderPrompt(null)}
            isDownloading={isDownloading}
          />
        )}
      </View>

      {/* Layer Toggle Row */}
      <ScrollView
        style={styles.layerList}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {genderSystemKeys.map((sysKey) => {
          const colorVal = SYSTEM_COLORS[sysKey];
          if (colorVal === undefined) return null;
          const hexColor = '#' + colorVal.toString(16).padStart(6, '0');
          const active = layerVisibility[sysKey] ?? false;
          return (
            <TouchableOpacity
              key={sysKey}
              style={[
                styles.layerChip,
                active && styles.layerChipActive,
              ]}
              onPress={() => toggleLayer(sysKey)}
            >
              <View style={[styles.layerDot, { backgroundColor: active ? '#FFFFFF' : hexColor }]} />
              <Text style={[styles.layerChipText, active && styles.layerChipTextActive]}>
                {SYSTEM_LABELS[sysKey] ?? sysKey}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Info Panel */}
      <InfoPanel
        structureId={selectedStructure}
        bodyStateData={bodyStateData}
        onClose={handleClosePanel}
        onViewGraph={(id) =>
          navigation.navigate('HealthGraph', { focusStructureId: id })
        }
      />

      {/* Structure Quick-Select */}
      <ScrollView
        style={styles.structureList}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {MVP_STRUCTURE_IDS.map((sid) => {
          const mapping = getMapping(sid);
          if (!mapping) return null;
          const hasData = gender === 'male' ? mapping.male.length > 0 : mapping.female.length > 0;
          if (!hasData && mapping.mappingType === 'UNAVAILABLE') return null;

          return (
            <TouchableOpacity
              key={sid}
              style={[
                styles.structureChip,
                selectedStructure === sid && styles.structureChipActive,
                mapping.mappingType === 'UNAVAILABLE' && styles.structureChipUnavailable,
              ]}
              onPress={() => {
                if (mapping.mappingType !== 'UNAVAILABLE') {
                  setSelectedStructure(sid);
                  sceneRef.current?.selectStructure(sid);
                }
              }}
            >
              <Text
                style={[
                  styles.structureChipText,
                  selectedStructure === sid && styles.structureChipTextActive,
                ]}
                numberOfLines={1}
              >
                {mapping.displayName}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Storage Management */}
      <StorageManagementSection />

      <Text style={styles.disclaimer}>
        For general wellness only. Not a medical device.
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GV.stage,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACE.screenH,
    paddingTop: 40,
    paddingBottom: 8,
  },
  headerTitle: {
    ...TYPE.display,
    color: '#FFFFFF',
  },
  genderToggle: {
    flexDirection: 'row',
    backgroundColor: GV.card,
    borderRadius: SPACE.rPill,
    padding: 2,
  },
  genderButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: SPACE.rPill,
  },
  genderButtonActive: {
    backgroundColor: GV.cta,
  },
  genderButtonText: {
    ...TYPE.chip,
    color: GV.body,
  },
  genderButtonTextActive: {
    color: '#FFFFFF',
  },
  canvasContainer: {
    width: SCREEN_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: GV.stage,
    overflow: 'hidden',
  },
  webCanvas: {
    width: '100%',
    height: '100%',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: GV.stage,
  },
  loadingText: {
    ...TYPE.body,
    color: GV.fog,
    marginTop: 8,
  },
  factText: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    maxWidth: 300,
    marginTop: 8,
  },
  nativePlaceholder: {
    width: SCREEN_WIDTH,
    height: CANVAS_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: GV.card,
    padding: SPACE.cardPad,
    gap: SPACE.cardGap,
  },
  nativePlaceholderIcon: {
    ...TYPE.display,
    color: GV.muted,
    marginBottom: 8,
  },
  nativePlaceholderTitle: {
    ...TYPE.title,
    color: GV.ink,
  },
  nativePlaceholderText: {
    ...TYPE.body,
    color: GV.body,
    textAlign: 'center',
  },
  nativePlaceholderHint: {
    ...TYPE.caption,
    color: GV.muted,
    textAlign: 'center',
  },
  infoPanel: {
    backgroundColor: GV.card,
    marginHorizontal: SPACE.screenH,
    marginTop: SPACE.cardGap,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
  },
  infoPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  infoPanelTitle: {
    ...TYPE.title,
    color: GV.ink,
    flex: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: GV.wash,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 14,
    color: GV.body,
  },
  graphLink: {
    marginTop: 12,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: SPACE.rPill,
    backgroundColor: GV.cta,
  },
  graphLinkText: {
    ...TYPE.button,
    color: '#FFFFFF',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  infoLabel: {
    ...TYPE.caption,
    color: GV.muted,
  },
  infoValue: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    color: GV.ink,
  },
  infoNotes: {
    ...TYPE.caption,
    color: GV.body,
    marginTop: 8,
  },
  statusCard: {
    marginTop: 8,
    padding: 8,
    backgroundColor: GV.wash,
    borderRadius: 12,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    ...TYPE.body,
    fontFamily: FONT.semi,
    color: GV.ink,
    flex: 1,
  },
  trendText: {
    ...TYPE.caption,
    color: GV.body,
  },
  summaryText: {
    ...TYPE.caption,
    color: GV.body,
    marginTop: 8,
  },
  noObservationCard: {
    marginTop: 8,
    padding: 16,
    backgroundColor: GV.wash,
    borderRadius: 12,
    alignItems: 'center',
  },
  noObservationText: {
    ...TYPE.body,
    fontFamily: FONT.semi,
    color: GV.muted,
  },
  noObservationSubtext: {
    ...TYPE.caption,
    color: GV.muted,
    marginTop: 4,
  },
  layerList: {
    maxHeight: 40,
    marginTop: 8,
    paddingHorizontal: SPACE.screenH,
  },
  layerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: GV.card,
    borderRadius: SPACE.rPill,
    marginRight: 8,
  },
  layerChipActive: {
    backgroundColor: GV.cta,
  },
  layerChipInactive: {
    opacity: 1,
  },
  layerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  layerChipText: {
    ...TYPE.chip,
    color: GV.ink,
  },
  layerChipTextActive: {
    color: '#FFFFFF',
  },
  layerChipTextInactive: {
    color: GV.muted,
  },
  structureList: {
    maxHeight: 40,
    marginTop: 8,
    paddingHorizontal: SPACE.screenH,
  },
  structureChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: GV.card,
    borderRadius: SPACE.rPill,
    marginRight: 8,
    marginBottom: 2,
  },
  structureChipActive: {
    backgroundColor: GV.cta,
  },
  structureChipUnavailable: {
    opacity: 0.4,
  },
  structureChipText: {
    ...TYPE.caption,
    color: GV.body,
  },
  structureChipTextActive: {
    color: '#FFFFFF',
  },
  disclaimer: {
    ...TYPE.caption,
    color: GV.fog,
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  // Storage management
  storageSection: {
    marginHorizontal: SPACE.screenH,
    marginTop: 8,
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
  },
  storageSectionTitle: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    color: GV.ink,
    marginBottom: 8,
  },
  storageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  storageInfo: {
    flex: 1,
  },
  storageLabel: {
    ...TYPE.body,
    color: GV.ink,
  },
  storageStatus: {
    ...TYPE.caption,
    color: GV.muted,
  },
  storageDeleteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: GV.wash,
  },
  storageDeleteText: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    color: GV.danger,
  },
  storageConfirmRow: {
    flexDirection: 'row',
    gap: 8,
  },
  storageConfirmBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: GV.danger,
  },
  storageConfirmText: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    color: '#FFFFFF',
  },
  storageCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: GV.wash,
  },
  storageCancelText: {
    ...TYPE.caption,
    fontFamily: FONT.semi,
    color: GV.body,
  },
});
