/**
 * CompressionBenchmark.tsx — Draco vs Meshopt benchmark overlay.
 *
 * Loads skeletal_male.glb in both Draco and Meshopt formats,
 * measures each phase, and displays results.
 *
 * This is a development-only diagnostic tool.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { File as ExpoFile } from 'expo-file-system';
import { Asset } from 'expo-asset';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { COLORS, SPACING, BORDER_RADIUS, TYPOGRAPHY } from '@/constants';

// ---------------------------------------------------------------------------
// Draco decoder assets (same as BodyScreen)
// ---------------------------------------------------------------------------

const DRACO_WASM_WRAPPER_ASSET = require('../../assets/draco/draco_wasm_wrapper.txt');
const DRACO_DECODER_WASM_ASSET = require('../../assets/draco/draco_decoder.wasm');
const DRACO_DECODER_JS_ASSET = require('../../assets/draco/draco_decoder_js.txt');

let _dracoWasmWrapperText: string | null = null;
let _dracoDecoderWasm: ArrayBuffer | null = null;
let _dracoDecoderJsText: string | null = null;
let _dracoAssetsLoaded = false;

async function ensureDracoAssets(): Promise<void> {
  if (_dracoAssetsLoaded) return;
  const [wasmWrapperAssets, wasmBinAssets, decoderJsAssets] = await Promise.all([
    Asset.loadAsync([DRACO_WASM_WRAPPER_ASSET]),
    Asset.loadAsync([DRACO_DECODER_WASM_ASSET]),
    Asset.loadAsync([DRACO_DECODER_JS_ASSET]),
  ]);
  const [wasmWrapperResolved, wasmBinResolved, decoderJsResolved] = await Promise.all([
    wasmWrapperAssets[0].downloadAsync(),
    wasmBinAssets[0].downloadAsync(),
    decoderJsAssets[0].downloadAsync(),
  ]);
  const [wrapperFile, wasmFile, decoderFile] = [
    new ExpoFile(wasmWrapperResolved.localUri ?? wasmWrapperResolved.uri),
    new ExpoFile(wasmBinResolved.localUri ?? wasmBinResolved.uri),
    new ExpoFile(decoderJsResolved.localUri ?? decoderJsResolved.uri),
  ];
  const [wrapperText, wasmBuf, decoderText] = await Promise.all([
    wrapperFile.text(),
    wasmFile.arrayBuffer(),
    decoderFile.text(),
  ]);
  _dracoWasmWrapperText = wrapperText as string;
  _dracoDecoderWasm = wasmBuf as ArrayBuffer;
  _dracoDecoderJsText = decoderText as string;
  _dracoAssetsLoaded = true;
}

function toRealArrayBuffer(raw: ArrayBuffer | ArrayBufferLike | Uint8Array): ArrayBuffer {
  if (raw instanceof ArrayBuffer) return raw;
  const view = raw as unknown as Uint8Array;
  const buf = new ArrayBuffer(view.byteLength);
  new Uint8Array(buf).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return buf;
}

// ---------------------------------------------------------------------------
// Draco loader (copied from BodyScreen — unchanged)
// ---------------------------------------------------------------------------

function createDracoLoader(): DRACOLoader {
  const dracoLoader = new DRACOLoader();
  if (Platform.OS !== 'web') {
    (dracoLoader as any)._initDecoder = function () {
      if (this.decoderPending) return this.decoderPending;
      const useJS = typeof WebAssembly !== 'object' || this.decoderConfig?.type === 'js';
      this.decoderPending = ensureDracoAssets().then(() => {
        if (useJS) {
          return { jsContent: _dracoDecoderJsText!, wasmBinary: null };
        }
        const copy = new ArrayBuffer(_dracoDecoderWasm!.byteLength);
        new Uint8Array(copy).set(new Uint8Array(_dracoDecoderWasm!));
        return { jsContent: _dracoWasmWrapperText!, wasmBinary: copy };
      }).then(({ jsContent, wasmBinary }) => {
        if (wasmBinary) this.decoderConfig.wasmBinary = wasmBinary;
        const initModule: Promise<any> = new Promise((resolve, reject) => {
          try {
            const getModule = new Function(
              jsContent + '\nreturn typeof DracoDecoderModule !== "undefined" ? DracoDecoderModule : null;',
            );
            const DracoDecoderModule = getModule();
            if (!DracoDecoderModule) { reject(new Error('DracoDecoderModule not found')); return; }
            DracoDecoderModule({ ...this.decoderConfig, onModuleLoaded: (draco: any) => resolve(draco) });
          } catch (e) { reject(e); }
        });
        this._dracoModule = initModule;
        return initModule;
      }).then((dracoModule: any) => { this._dracoModule = dracoModule; });
      return this.decoderPending;
    };
    (dracoLoader as any)._getWorker = function (_taskID: number, _taskCost: number) {
      return this._initDecoder().then(() => {
        const self = this;
        const dracoModulePromise = self._dracoModule;
        const inlineWorker: any = {
          _callbacks: {} as Record<number, { resolve: Function; reject: Function }>,
          postMessage(data: any) {
            if (data.type === 'decode') {
              Promise.resolve(dracoModulePromise).then((draco: any) => {
                const decoder = new draco.Decoder();
                try {
                  const array = new Int8Array(data.buffer);
                  const geometryType = decoder.GetEncodedGeometryType(array);
                  let dracoGeometry: any;
                  if (geometryType === draco.TRIANGULAR_MESH) {
                    dracoGeometry = new draco.Mesh();
                    const status = decoder.DecodeArrayToMesh(array, array.byteLength, dracoGeometry);
                    if (!status.ok() || dracoGeometry.ptr === 0) throw new Error('Decode failed');
                  } else { throw new Error('Unexpected geometry type'); }
                  const geometry: any = { index: null, attributes: [] as any[] };
                  for (const attrName in data.taskConfig.attributeIDs) {
                    const TypedArrayCtor = (globalThis as any)[data.taskConfig.attributeTypes[attrName]];
                    const attrID = data.taskConfig.useUniqueIDs
                      ? decoder.GetAttributeByUniqueId(dracoGeometry, data.taskConfig.attributeIDs[attrName])
                      : decoder.GetAttributeId(dracoGeometry, draco[data.taskConfig.attributeIDs[attrName]]);
                    if (attrID === -1) continue;
                    const attr = decoder.GetAttribute(dracoGeometry, attrID);
                    const count = dracoGeometry.num_points();
                    const itemSize = attr.num_components();
                    const ptr = draco._malloc(count * itemSize * TypedArrayCtor.BYTES_PER_ELEMENT);
                    decoder.GetAttributeDataArrayForAllPoints(dracoGeometry, attr,
                      draco[`DT_${TypedArrayCtor.name.replace('Array', '').toUpperCase()}`],
                      count * itemSize * TypedArrayCtor.BYTES_PER_ELEMENT, ptr);
                    const arr = new TypedArrayCtor(draco.HEAPF32.buffer, ptr, count * itemSize).slice();
                    draco._free(ptr);
                    geometry.attributes.push({ name: attrName, count, itemSize, array: arr, stride: itemSize });
                  }
                  const numFaces = dracoGeometry.num_faces();
                  const numIndices = numFaces * 3;
                  const indexPtr = draco._malloc(numIndices * 4);
                  decoder.GetTrianglesUInt32Array(dracoGeometry, numIndices * 4, indexPtr);
                  geometry.index = { array: new Uint32Array(draco.HEAPF32.buffer, indexPtr, numIndices).slice(), itemSize: 1 };
                  draco._free(indexPtr);
                  draco.destroy(dracoGeometry);
                  inlineWorker._callbacks[data.id]?.resolve({ type: 'decode', id: data.id, geometry });
                } catch (error: any) {
                  inlineWorker._callbacks[data.id]?.reject({ type: 'error', id: data.id, error: error.message });
                } finally { draco.destroy(decoder); }
              });
            }
          },
          onmessage: null,
          terminate() {},
        };
        self.workerPool.push(inlineWorker);
        return inlineWorker;
      });
    };
  }
  return dracoLoader;
}

// ---------------------------------------------------------------------------
// Meshopt initialization — with exhaustive diagnostics
// ---------------------------------------------------------------------------

/**
 * Initialize the MeshoptDecoder WASM module.
 *
 * The MeshoptDecoder IIFE calls WebAssembly.instantiate() at import time.
 * That Promise may resolve or reject depending on whether the runtime
 * supports WASM with the required features.
 *
 * This function:
 * 1. Logs every diagnostic we can gather
 * 2. Waits for MeshoptDecoder.ready with a timeout
 * 3. Reports exactly which layer failed if it fails
 */
let _meshoptInitResult: 'pending' | 'success' | 'failed' = 'pending';
let _meshoptInitError: string | null = null;

function logMeshoptFailure(stage: string, error: string, stack?: string) {
  console.error(`[Benchmark] MESHopT_FAILURE_STAGE = ${stage}`);
  console.error(`[Benchmark] MESHopT_FAILURE_ERROR = ${error}`);
  if (stack) console.error(`[Benchmark] MESHopT_FAILURE_STACK = ${stack}`);
}

async function ensureMeshoptReady(): Promise<void> {
  if (_meshoptInitResult === 'success') return;
  if (_meshoptInitResult === 'failed') {
    throw new Error(`Meshopt init previously failed: ${_meshoptInitError}`);
  }

  // ── STAGE 1: Module import ────────────────────────────────────────
  console.log('[Benchmark] MESHopT_STAGE_1_IMPORT');
  const mdAny = MeshoptDecoder as any;
  console.log(`[Benchmark]   MeshoptDecoder imported = ${MeshoptDecoder !== undefined && MeshoptDecoder !== null}`);
  console.log(`[Benchmark]   MeshoptDecoder type = ${typeof MeshoptDecoder}`);
  console.log(`[Benchmark]   MeshoptDecoder.supported = ${mdAny.supported}`);
  console.log(`[Benchmark]   typeof MeshoptDecoder.ready = ${typeof mdAny.ready}`);
  console.log(`[Benchmark]   THREE.REVISION = ${THREE.REVISION}`);
  console.log(`[Benchmark]   Platform = ${Platform.OS} ${Platform.Version}`);
  const isHermes = typeof (globalThis as any).HermesInternal !== 'undefined';
  console.log(`[Benchmark]   JS engine = ${isHermes ? 'Hermes' : 'Other (V8/JSC)'}`);

  // ── STAGE 2: WebAssembly availability ──────────────────────────────
  console.log('[Benchmark] MESHopT_STAGE_2_WASM');
  console.log(`[Benchmark]   typeof WebAssembly = "${typeof WebAssembly}"`);
  console.log(`[Benchmark]   typeof WebAssembly.instantiate = "${typeof WebAssembly !== 'undefined' ? typeof WebAssembly.instantiate : 'N/A'}`);
  console.log(`[Benchmark]   typeof WebAssembly.compile = "${typeof WebAssembly !== 'undefined' ? typeof WebAssembly.compile : 'N/A'}`);

  if (typeof WebAssembly !== 'object') {
    const msg = 'WebAssembly is NOT available in this runtime (typeof WebAssembly = "' + typeof WebAssembly + '"). Meshopt requires WASM.';
    logMeshoptFailure('STAGE_2_WASM', msg);
    _meshoptInitResult = 'failed';
    _meshoptInitError = msg;
    throw new Error(msg);
  }

  if (!mdAny.supported) {
    const msg = 'MeshoptDecoder.supported is false. WASM is available but the decoder IIFE returned early.';
    logMeshoptFailure('STAGE_2_WASM', msg);
    _meshoptInitResult = 'failed';
    _meshoptInitError = msg;
    throw new Error(msg);
  }

  if (!mdAny.ready) {
    const msg = 'MeshoptDecoder.ready is undefined. The decoder IIFE may have thrown during execution.';
    logMeshoptFailure('STAGE_2_WASM', msg);
    _meshoptInitResult = 'failed';
    _meshoptInitError = msg;
    throw new Error(msg);
  }

  // ── STAGE 3: Await WASM instantiation ──────────────────────────────
  console.log('[Benchmark] MESHopT_STAGE_3_READY_START');
  const tReady = performance.now();

  try {
    const readyResult = await Promise.race([
      mdAny.ready.then(() => 'resolved' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30000)),
    ]);

    const readyMs = performance.now() - tReady;

    if (readyResult === 'timeout') {
      const msg = `MeshoptDecoder.ready did NOT resolve within 30000 ms (timeout).`;
      logMeshoptFailure('STAGE_3_READY', msg);
      _meshoptInitResult = 'failed';
      _meshoptInitError = msg;
      throw new Error(msg);
    }

    console.log(`[Benchmark] MESHopT_STAGE_3_READY_COMPLETE (${readyMs.toFixed(0)} ms)`);

    _meshoptInitResult = 'success';
    _meshoptInitError = null;
  } catch (err: any) {
    const readyMs = performance.now() - tReady;
    const msg = `MeshoptDecoder.ready REJECTED after ${readyMs.toFixed(0)} ms: ${err?.message ?? err}`;
    logMeshoptFailure('STAGE_3_READY', msg, err?.stack);
    _meshoptInitResult = 'failed';
    _meshoptInitError = msg;
    throw new Error(msg);
  }
}

// ---------------------------------------------------------------------------
// Benchmark result type
// ---------------------------------------------------------------------------

interface BenchmarkResult {
  label: string;
  fileSizeKB: number;
  fileReadMs: number;
  decodeParseMs: number;
  sceneConstructionMs: number;
  totalMs: number;
  meshCount: number;
  nodeCount: number;
  vertexCount: number;
  triangleCount: number;
}

// ---------------------------------------------------------------------------
// Count vertices and triangles from a THREE.Group
// ---------------------------------------------------------------------------

function countGeometry(scene: THREE.Group): { meshCount: number; vertexCount: number; triangleCount: number } {
  let meshCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      meshCount++;
      const geo = child.geometry;
      if (geo) {
        const posAttr = geo.getAttribute('position');
        if (posAttr) {
          const vc = posAttr.count;
          vertexCount += (typeof vc === 'number' && isFinite(vc)) ? vc : 0;
        }
        if (geo.index) {
          const tc = geo.index.count / 3;
          triangleCount += (typeof tc === 'number' && isFinite(tc)) ? tc : 0;
        } else if (posAttr && typeof posAttr.count === 'number' && isFinite(posAttr.count)) {
          triangleCount += posAttr.count / 3;
        }
      }
    }
  });
  return { meshCount, vertexCount, triangleCount };
}

// ---------------------------------------------------------------------------
// Benchmark a single load
// ---------------------------------------------------------------------------

async function benchmarkLoad(
  label: string,
  fileName: string,
  localUri: string,
  useDraco: boolean,
): Promise<BenchmarkResult> {
  const tStart = performance.now();

  // Phase 1: File read
  const tRead = performance.now();
  const file = new ExpoFile(localUri);
  const raw = await file.arrayBuffer();
  const buffer = toRealArrayBuffer(raw);
  const fileReadMs = performance.now() - tRead;
  const fileSizeKB = buffer.byteLength / 1024;

  // ── STAGE 5: File read ────────────────────────────────────────────
  if (!useDraco) console.log('[Benchmark] MESHopT_STAGE_5_FILE_READ');
  console.log(`[Benchmark] ${label} file read: ${fileReadMs.toFixed(0)} ms, size: ${fileSizeKB.toFixed(1)} KB`);
  console.log(`[Benchmark] ${label} URI = ${localUri}`);

  // Phase 2: GLTF parse + Draco/Meshopt decode
  const tParse = performance.now();
  const loader = new GLTFLoader();

  if (useDraco) {
    const dracoLoader = createDracoLoader();
    loader.setDRACOLoader(dracoLoader);
    console.log('[Benchmark] DRACOLoader set on GLTFLoader');
  } else {
    // ── STAGE 3 (continues): Await ready, then STAGE 4 ────────────
    await ensureMeshoptReady();
    // ── STAGE 4: Set decoder on GLTFLoader ──────────────────────────
    console.log('[Benchmark] MESHopT_STAGE_4_SET_DECODER');
    loader.setMeshoptDecoder(MeshoptDecoder);
    console.log('[Benchmark]   setMeshoptDecoder() completed');
  }

  // ── STAGE 6: GLTF parse ───────────────────────────────────────────
  if (!useDraco) console.log('[Benchmark] MESHopT_STAGE_6_PARSE_START');
  else console.log(`[Benchmark] ${label} decode + parse START`);

  let gltf: THREE.Group;
  try {
    gltf = await new Promise<THREE.Group>((resolve, reject) => {
      loader.parse(buffer, '', (result) => resolve(result.scene), (error) => reject(error));
    });
  } catch (parseErr: any) {
    const parseMs = performance.now() - tParse;
    if (!useDraco) {
      logMeshoptFailure('STAGE_6_PARSE', parseErr?.message ?? String(parseErr), parseErr?.stack);
    }
    console.error(`[Benchmark] ${label} GLTF parse FAILED after ${parseMs.toFixed(0)} ms:`, parseErr?.message ?? parseErr);
    throw parseErr;
  }

  const decodeParseMs = performance.now() - tParse;
  // ── STAGE 7: Parse complete ───────────────────────────────────────
  if (!useDraco) console.log(`[Benchmark] MESHopT_STAGE_7_PARSE_COMPLETE (${decodeParseMs.toFixed(0)} ms)`);
  else console.log(`[Benchmark] ${label} decode + parse COMPLETE: ${decodeParseMs.toFixed(0)} ms`);

  // Phase 3: Scene construction (traverse + count)
  const tScene = performance.now();
  const counts = countGeometry(gltf);
  const sceneConstructionMs = performance.now() - tScene;
  const totalMs = performance.now() - tStart;

  // ── STAGE 8: Scene construction complete ───────────────────────────
  if (!useDraco) console.log(`[Benchmark] MESHopT_STAGE_8_SCENE_COMPLETE (${sceneConstructionMs.toFixed(0)} ms)`);
  console.log(`[Benchmark] ${label} TOTAL: ${totalMs.toFixed(0)} ms`);
  console.log(`[Benchmark] ${label} meshes=${counts.meshCount} vertices=${counts.vertexCount} triangles=${counts.triangleCount}`);

  // Dispose the temporary scene to free GPU/memory
  gltf.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  });

  return {
    label,
    fileSizeKB,
    fileReadMs,
    decodeParseMs,
    sceneConstructionMs,
    totalMs,
    meshCount: counts.meshCount,
    nodeCount: counts.meshCount,
    vertexCount: counts.vertexCount,
    triangleCount: counts.triangleCount,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  onClose: () => void;
  maleFiles?: Map<string, string>;
}

export default function CompressionBenchmark({ onClose, maleFiles }: Props) {
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runBenchmark = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResults([]);

    try {
      // ── System diagnostics (run once) ──────────────────────────────
      const isHermes = typeof (globalThis as any).HermesInternal !== 'undefined';
      console.log('[Benchmark] ═══ System Diagnostics ═══');
      console.log(`[Benchmark] THREE_VERSION = ${THREE.REVISION}`);
      console.log(`[Benchmark] Platform = ${Platform.OS} ${Platform.Version}`);
      console.log(`[Benchmark] JS engine = ${isHermes ? 'Hermes' : 'Other'}`);
      console.log(`[Benchmark] typeof WebAssembly = ${typeof WebAssembly}`);
      console.log(`[Benchmark] typeof MeshoptDecoder = ${typeof MeshoptDecoder}`);
      console.log(`[Benchmark] MeshoptDecoder.supported = ${(MeshoptDecoder as any).supported}`);
      console.log(`[Benchmark] typeof MeshoptDecoder.ready = ${typeof (MeshoptDecoder as any).ready}`);
      console.log(`[Benchmark] typeof DRACOLoader = ${typeof DRACOLoader}`);
      console.log(`[Benchmark] typeof GLTFLoader = ${typeof GLTFLoader}`);

      // ── Draco benchmark ────────────────────────────────────────────
      const dracoUri = maleFiles?.get('skeletal_male.glb');
      if (!dracoUri) {
        setError('skeletal_male.glb not found in local files');
        setRunning(false);
        return;
      }

      console.log('[Benchmark] ═══ Draco Benchmark ═══');
      console.log(`[Benchmark] DRACO_ASSET_URI = ${dracoUri}`);
      console.log('[Benchmark]   Expected: skeletal_male.glb ≈ 2.76 MB (2823 KB)');
      const dracoResult = await benchmarkLoad('Draco', 'skeletal_male.glb', dracoUri, true);
      console.log('[Benchmark] Draco benchmark COMPLETE:', dracoResult.totalMs.toFixed(0) + 'ms');
      setResults([dracoResult]);

      // Brief pause to let GC settle between benchmarks
      await new Promise((resolve) => setTimeout(resolve, 500));

      // ── Meshopt benchmark ──────────────────────────────────────────
      console.log('[Benchmark] ═══ Meshopt Benchmark ═══');
      try {
        // @ts-ignore — Metro handles .glb asset requires
        const meshoptModule = require('../../assets/anatomy/male/skeletal_male_meshopt.glb');
        console.log(`[Benchmark] meshoptModule type = ${typeof meshoptModule}, value = ${meshoptModule}`);

        const assets = await Asset.loadAsync([meshoptModule as unknown as number]);
        console.log(`[Benchmark] Asset.loadAsync resolved, count = ${assets.length}`);

        const resolved = assets[0];
        await resolved.downloadAsync();
        const meshoptUri = resolved.localUri ?? resolved.uri;
        console.log(`[Benchmark] MESHopT_ASSET_URI = ${meshoptUri}`);
        console.log('[Benchmark]   Expected: skeletal_male_meshopt.glb ≈ 4.65 MB (4765 KB)');
        console.log('[Benchmark]   Actual extension: EXT_meshopt_compression + KHR_mesh_quantization');

        const meshoptResult = await benchmarkLoad('Meshopt', 'skeletal_male_meshopt.glb', meshoptUri, false);
        console.log('[Benchmark] Meshopt benchmark COMPLETE:', meshoptResult.totalMs.toFixed(0) + 'ms');
        setResults([dracoResult, meshoptResult]);
      } catch (meshoptErr: any) {
        console.error('[Benchmark] ═══ Meshopt Benchmark FAILED ═══');
        console.error('[Benchmark] Error type:', typeof meshoptErr);
        console.error('[Benchmark] Error name:', meshoptErr?.name);
        console.error('[Benchmark] Error message:', meshoptErr?.message);
        console.error('[Benchmark] Error stack:', meshoptErr?.stack);
        setError(`Meshopt benchmark failed: ${meshoptErr?.message}. Only Draco benchmarked.`);
      }
    } catch (err: any) {
      console.error('[Benchmark] ═══ Benchmark FAILED ═══');
      console.error('[Benchmark] Error:', err?.message ?? err);
      setError(err?.message ?? String(err));
    } finally {
      setRunning(false);
    }
  }, [maleFiles]);

  return (
    <View style={styles.overlay}>
      <View style={styles.panel}>
        <View style={styles.header}>
          <Text style={styles.title}>Compression Benchmark</Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </Pressable>
        </View>

        <Text style={styles.subtitle}>
          Draco vs Meshopt on skeletal_male.glb
        </Text>

        <Pressable
          style={[styles.runBtn, running && styles.runBtnDisabled]}
          onPress={runBenchmark}
          disabled={running}
        >
          {running ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.runBtnText}>Run Benchmark</Text>
          )}
        </Pressable>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {results.length > 0 && (
          <ScrollView style={styles.results}>
            {results.map((r, i) => (
              <View key={i} style={styles.resultCard}>
                <Text style={styles.resultLabel}>{r.label}</Text>
                <View style={styles.resultRow}>
                  <Text style={styles.resultKey}>File size</Text>
                  <Text style={styles.resultVal}>{r.fileSizeKB.toFixed(1)} KB</Text>
                </View>
                <View style={styles.resultRow}>
                  <Text style={styles.resultKey}>File read</Text>
                  <Text style={styles.resultVal}>{r.fileReadMs.toFixed(0)} ms</Text>
                </View>
                <View style={styles.resultRow}>
                  <Text style={styles.resultKey}>Decode + Parse</Text>
                  <Text style={[styles.resultVal, styles.resultValHighlight]}>
                    {r.decodeParseMs.toFixed(0)} ms
                  </Text>
                </View>
                <View style={styles.resultRow}>
                  <Text style={styles.resultKey}>Scene construction</Text>
                  <Text style={styles.resultVal}>{r.sceneConstructionMs.toFixed(0)} ms</Text>
                </View>
                <View style={[styles.resultRow, styles.resultRowTotal]}>
                  <Text style={[styles.resultKey, styles.resultKeyTotal]}>Total</Text>
                  <Text style={[styles.resultVal, styles.resultValTotal]}>
                    {r.totalMs.toFixed(0)} ms
                  </Text>
                </View>
                <View style={styles.resultRow}>
                  <Text style={styles.resultKey}>Meshes</Text>
                  <Text style={styles.resultVal}>{r.meshCount}</Text>
                </View>
                <View style={styles.resultRow}>
                  <Text style={styles.resultKey}>Vertices</Text>
                  <Text style={styles.resultVal}>{r.vertexCount.toLocaleString()}</Text>
                </View>
                <View style={styles.resultRow}>
                  <Text style={styles.resultKey}>Triangles</Text>
                  <Text style={styles.resultVal}>{r.triangleCount.toLocaleString()}</Text>
                </View>
              </View>
            ))}

            {results.length === 2 && (() => {
              const draco = results[0];
              const meshopt = results[1];

              const decodeSpeedup = draco.decodeParseMs / meshopt.decodeParseMs;
              const decodePctImprovement = ((draco.decodeParseMs - meshopt.decodeParseMs) / draco.decodeParseMs) * 100;
              const totalSpeedup = draco.totalMs / meshopt.totalMs;
              const totalPctImprovement = ((draco.totalMs - meshopt.totalMs) / draco.totalMs) * 100;
              const sizeDiffKB = meshopt.fileSizeKB - draco.fileSizeKB;
              const sizePctDiff = (sizeDiffKB / draco.fileSizeKB) * 100;

              const meshDiff = meshopt.meshCount - draco.meshCount;
              const vertDiff = meshopt.vertexCount - draco.vertexCount;
              const triDiff = meshopt.triangleCount - draco.triangleCount;
              const geometrySame = meshDiff === 0 && vertDiff === 0 && triDiff === 0;

              return (
                <View style={styles.comparisonCard}>
                  <Text style={styles.comparisonTitle}>Comparison</Text>
                  <View style={styles.resultRow}>
                    <Text style={styles.resultKey}>Decode speedup</Text>
                    <Text style={[styles.resultVal, styles.resultValHighlight]}>
                      {decodeSpeedup.toFixed(2)}x
                    </Text>
                  </View>
                  <View style={styles.resultRow}>
                    <Text style={styles.resultKey}>Meshopt improvement</Text>
                    <Text style={[
                      styles.resultVal,
                      decodePctImprovement > 0 ? styles.valFaster : decodePctImprovement < 0 ? styles.valSlower : null,
                    ]}>
                      {decodePctImprovement > 0
                        ? `${decodePctImprovement.toFixed(1)}% faster decode`
                        : decodePctImprovement < 0
                          ? `${Math.abs(decodePctImprovement).toFixed(1)}% slower decode`
                          : 'Same decode speed'}
                    </Text>
                  </View>
                  <View style={styles.resultRow}>
                    <Text style={styles.resultKey}>Total time speedup</Text>
                    <Text style={[
                      styles.resultVal,
                      totalPctImprovement > 0 ? styles.valFaster : totalPctImprovement < 0 ? styles.valSlower : null,
                    ]}>
                      {totalPctImprovement > 0
                        ? `${totalSpeedup.toFixed(2)}x (${totalPctImprovement.toFixed(1)}% faster)`
                        : totalPctImprovement < 0
                          ? `${Math.abs(totalPctImprovement).toFixed(1)}% slower`
                          : 'Same total time'}
                    </Text>
                  </View>
                  <View style={styles.resultRow}>
                    <Text style={styles.resultKey}>File size</Text>
                    <Text style={[
                      styles.resultVal,
                      sizePctDiff > 0 ? styles.valSlower : styles.valFaster,
                    ]}>
                      {sizePctDiff > 0
                        ? `Meshopt ${sizePctDiff.toFixed(1)}% larger (+${sizeDiffKB.toFixed(1)} KB)`
                        : `Meshopt ${Math.abs(sizePctDiff).toFixed(1)}% smaller (${sizeDiffKB.toFixed(1)} KB)`}
                    </Text>
                  </View>
                  <View style={styles.resultRow}>
                    <Text style={styles.resultKey}>Geometry</Text>
                    <Text style={[styles.resultVal, !geometrySame ? styles.valNote : styles.valFaster]}>
                      {geometrySame
                        ? 'SAME'
                        : `DIFFERENT (meshes: ${draco.meshCount}→${meshopt.meshCount}, verts: ${draco.vertexCount.toLocaleString()}→${meshopt.vertexCount.toLocaleString()}, tris: ${draco.triangleCount.toLocaleString()}→${meshopt.triangleCount.toLocaleString()})`}
                    </Text>
                  </View>
                </View>
              );
            })()}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  panel: {
    width: '90%',
    maxWidth: 400,
    maxHeight: '80%',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  title: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  subtitle: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginBottom: SPACING.md,
  },
  runBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.sm,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  runBtnDisabled: {
    opacity: 0.6,
  },
  runBtnText: {
    ...TYPOGRAPHY.bodyStrong,
    color: '#fff',
  },
  errorBox: {
    backgroundColor: COLORS.error + '15',
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
  },
  errorText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.error,
  },
  results: {
    maxHeight: 400,
  },
  resultCard: {
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  resultLabel: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  resultRowTotal: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: SPACING.xs,
    paddingTop: SPACING.xs,
  },
  resultKey: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },
  resultKeyTotal: {
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  resultVal: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.textPrimary,
  },
  resultValHighlight: {
    color: COLORS.primary,
    fontSize: 14,
  },
  resultValTotal: {
    fontSize: 16,
    fontWeight: '700',
  },
  comparisonCard: {
    backgroundColor: COLORS.primaryBg,
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.sm,
    marginTop: SPACING.sm,
  },
  comparisonTitle: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.primary,
    marginBottom: SPACING.xs,
  },
  valFaster: {
    color: COLORS.success,
  },
  valSlower: {
    color: COLORS.error,
  },
  valNote: {
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },
});
