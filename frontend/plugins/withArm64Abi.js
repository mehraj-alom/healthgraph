/**
 * withArm64Abi.js — Local Expo config plugin: arm64-only Android builds.
 *
 * WHY THIS EXISTS: `expo-build-properties` has no `abiFilters` option
 * (an `abiFilters` key there is silently ignored — verified against the
 * installed plugin schema — which is how a 4-ABI universal APK shipped).
 * The sanctioned mechanism for arbitrary app/build.gradle tweaks is a local
 * config plugin using `withAppBuildGradle`, which is what this does.
 *
 * WHAT IT DOES: injects `ndk { abiFilters "arm64-v8a" }` into the
 * `defaultConfig` block of android/app/build.gradle at prebuild time.
 * Verified safe: every one of the 31 native .so files in the current APK
 * ships an arm64-v8a binary (incl. libonnxruntime.so, SQLCipher via
 * expo-sqlite, CameraX modules, Hermes, Reanimated, Filament).
 *
 * CONSEQUENCE: the APK/AAB will not install on 32-bit ARM (armeabi-v7a)
 * or x86/x86_64 devices (notably x86_64 Android emulators — use an arm64
 * emulator image or a physical phone for testing). Google Play filters the
 * listing automatically; this is allowed (64-bit support is mandatory,
 * 32-bit is optional).
 */

const { withAppBuildGradle } = require('@expo/config-plugins');

const NDK_ABI_BLOCK = `        ndk {
            abiFilters "arm64-v8a"
        }`;

function injectAbiFilters(buildGradle) {
  if (buildGradle.includes('abiFilters')) {
    return buildGradle;
  }
  const anchor = 'defaultConfig {';
  const idx = buildGradle.indexOf(anchor);
  if (idx === -1) {
    console.warn(
      '[withArm64Abi] defaultConfig block not found — abiFilters not applied.',
    );
    return buildGradle;
  }
  const insertAt = idx + anchor.length;
  return (
    buildGradle.slice(0, insertAt) +
    '\n' +
    NDK_ABI_BLOCK +
    buildGradle.slice(insertAt)
  );
}

const withArm64Abi = (config) => {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      config.modResults.contents = injectAbiFilters(
        config.modResults.contents,
      );
    } else {
      console.warn(
        '[withArm64Abi] app build.gradle is not groovy — abiFilters not applied.',
      );
    }
    return config;
  });
};

module.exports = withArm64Abi;
module.exports.injectAbiFilters = injectAbiFilters;
