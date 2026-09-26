/**
 * rppgBuildConfig — Phase 1 regression tests for the rPPG build/runtime fix.
 *
 * Guards the native-linkage + model-delivery configuration that caused
 * "Face measurement is missing from this build" / "model did not load":
 *   - app.json applies the onnxruntime-react-native config plugin (without
 *     it the ORT native module is absent: generated gradle/Podfile contain
 *     zero onnxruntime references and getOnnxRuntimeStatus() reports
 *     native-module-absent before any download/camera work runs)
 *   - app.json applies the healthgraph-rppg camera-permission plugin (the
 *     module previously relied on the PPG plugin's side effect for its iOS
 *     NSCameraUsageDescription)
 *   - the .onnx is NOT bundled: no assetBundlePatterns entry references it
 *     (Metro only packages statically require()d assets; modelManager owns
 *     on-demand download + size/SHA verification)
 *   - every EAS profile pins the public model host explicitly (no secrets),
 *     so dev clients don't fall back to the Metro :8081 host (which 404s:
 *     frontend/public/ hosts anatomy/ only, no .onnx)
 *   - no source comments claim the model is bundled anymore
 *   - the dead ASSET_RPPG_MODEL_PATH constant is gone (it disagreed with the
 *     verified flat release layout and had zero importers)
 *   - iOS camera permission is pre-flighted before native capture starts
 *   - the measurement hook detaches its native listener on every terminal
 *     path and guards against concurrent (double-tap) starts
 *
 * Pure node (reads repo files as text/JSON; no RN, no device, no new deps):
 *   node --experimental-strip-types --test frontend/tests/rppgBuildConfig.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

function repoFile(rel: string): string {
  return new URL(rel, import.meta.url).pathname;
}

function readText(rel: string): string {
  return readFileSync(repoFile(rel), 'utf8');
}

function readJson(rel: string): unknown {
  return JSON.parse(readText(rel)) as unknown;
}

const EXPECTED_ASSET_BASE = 'https://api.healthgraph.shop/assets';
// NOTE: the legacy GitHub Release host (ASSET_RELEASE_TAG) is superseded:
// runtime assets now serve from the production VPS (verified 200).

// ============================================================================
// app.json — native linkage plugins + no bundled-model pattern
// ============================================================================

describe('app.json RPPG native linkage', () => {
  const appJson = readJson('../app.json') as {
    expo: { plugins: unknown[]; assetBundlePatterns?: string[] };
  };

  test('applies the onnxruntime-react-native config plugin exactly once', () => {
    const hits = appJson.expo.plugins.filter(
      (p) => p === 'onnxruntime-react-native',
    );
    assert.equal(hits.length, 1);
  });

  test('applies both healthgraph native-module permission plugins', () => {
    const flat = appJson.expo.plugins.map((p) =>
      Array.isArray(p) ? String(p[0]) : String(p),
    );
    assert.ok(flat.includes('./modules/healthgraph-ppg/app.plugin.js'));
    assert.ok(flat.includes('./modules/healthgraph-rppg/app.plugin.js'));
  });

  test('does not claim the .onnx as a bundled asset', () => {
    const patterns = appJson.expo.assetBundlePatterns ?? [];
    assert.ok(!patterns.some((p) => p.includes('rppg')));
    assert.ok(!patterns.some((p) => p.includes('.onnx')));
    // The boot video stays bundled.
    assert.ok(patterns.includes('assets/app-load.mp4'));
  });
});

// ============================================================================
// eas.json — explicit public model host per profile (no secrets)
// ============================================================================

describe('eas.json model-host configuration', () => {
  const easJson = readJson('../eas.json') as {
    build: Record<string, { env?: Record<string, string> }>;
  };

  for (const profile of ['development', 'preview', 'production']) {
    test(`${profile} pins the public asset host (dev must not use Metro :8081)`, () => {
      const env = easJson.build[profile]?.env ?? {};
      assert.equal(env['EXPO_PUBLIC_ASSET_CDN_URL'], EXPECTED_ASSET_BASE);
    });
  }
});

// ============================================================================
// healthgraph-rppg config plugin — camera permission without torch
// ============================================================================

describe('healthgraph-rppg/app.plugin.js', () => {
  const plugin = readText('../modules/healthgraph-rppg/app.plugin.js');

  test('declares Android CAMERA without FLASHLIGHT (front camera only)', () => {
    assert.ok(plugin.includes('android.permission.CAMERA'));
    assert.ok(!plugin.includes('FLASHLIGHT'));
    assert.ok(plugin.includes('withAndroidManifest'));
  });

  test('sets an iOS face-scan usage description', () => {
    assert.ok(plugin.includes('NSCameraUsageDescription'));
    assert.ok(plugin.includes('withInfoPlist'));
    assert.ok(plugin.includes('module.exports'));
  });
});

// ============================================================================
// onnxruntime-react-native linkage path present in this checkout
// ============================================================================

describe('onnxruntime-react-native package linkage', () => {
  test('ships the config plugin that injects the gradle project + pod', () => {
    const pluginPath = repoFile(
      '../node_modules/onnxruntime-react-native/app.plugin.js',
    );
    assert.ok(existsSync(pluginPath), 'ORT package not installed?');
    const src = readFileSync(pluginPath, 'utf8');
    assert.ok(
      src.includes("implementation project(':onnxruntime-react-native')"),
    );
    assert.ok(src.includes("pod 'onnxruntime-react-native'"));
  });
});

// ============================================================================
// No stale "bundled model" claims; dead path constant removed
// ============================================================================

describe('on-demand delivery is described consistently', () => {
  test('metro still resolves .onnx but does not claim bundling', () => {
    const metro = readText('../metro.config.js');
    assert.ok(metro.includes("'onnx'"));
    assert.ok(!metro.includes('bundled via expo-asset'));
  });

  test('rppg provider sources do not claim a bundled model', () => {
    for (const rel of [
      '../src/services/rppg/onnxProvider.ts',
      '../src/services/rppg/index.ts',
    ]) {
      const src = readText(rel).toLowerCase();
      assert.ok(!src.includes('bundled physformer'));
      assert.ok(!src.includes('running the bundled'));
      assert.ok(!src.includes('uses expo-asset'));
    }
  });

  test('dead ASSET_RPPG_MODEL_PATH constant is removed', () => {
    const host = readText('../src/services/assetHost.ts');
    assert.ok(!host.includes('ASSET_RPPG_MODEL_PATH'));
  });

  test('model remotePath stays flat (verified release layout)', () => {
    const meta = readText('../src/services/rppg/modelMeta.ts');
    assert.ok(meta.includes("remotePath: 'physformer_rppg_fp16.onnx'"));
  });
});

// ============================================================================
// Runtime hardening directly tied to this phase
// ============================================================================

describe('rppg runtime hardening', () => {
  test('iOS camera permission is pre-flighted before native capture', () => {
    const perm = readText('../src/services/rppg/cameraPermission.ts');
    assert.ok(perm.includes('expo-camera'));
    assert.ok(perm.includes('requestCameraPermissionsAsync'));
  });

  test('hook detaches the native listener and guards concurrent starts', () => {
    const hook = readText('../src/hooks/useRppgMeasurement.ts');
    assert.ok(hook.includes('listenerOffRef'));
    assert.ok(hook.includes('startInFlightRef'));
  });

  test('screen cancels only an active capture (no idle CANCELLED)', () => {
    const screen = readText('../src/screens/PpgMeasure/PulseInstrumentScreen.tsx');
    assert.ok(screen.includes('busyRef'));
  });
});
