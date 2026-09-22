/**
 * Expo config plugin for healthgraph-rppg.
 * Adds CAMERA permission intent (Android) + NSCameraUsageDescription (iOS).
 * Front camera only: no torch permission (unlike the fingertip PPG module,
 * which needs the flash). The module itself requires a custom dev/production
 * build (not Expo Go).
 */
const { withAndroidManifest, withInfoPlist } = require('@expo/config-plugins');

function withHealthGraphRppg(config) {
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    const perms = manifest['uses-permission'].map((p) => p.$['android:name']);
    for (const name of ['android.permission.CAMERA']) {
      if (!perms.includes(name)) manifest['uses-permission'].push({ $: { 'android:name': name } });
    }
    return cfg;
  });
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.NSCameraUsageDescription =
      cfg.modResults.NSCameraUsageDescription ||
      'HealthGraph uses the front camera to measure your pulse from your face, entirely on this device.';
    return cfg;
  });
  return config;
}

module.exports = withHealthGraphRppg;
