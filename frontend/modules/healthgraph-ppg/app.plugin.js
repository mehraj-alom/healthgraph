/**
 * Expo config plugin for healthgraph-ppg.
 * Adds CAMERA permission intent (Android) + NSCameraUsageDescription (iOS).
 * The module itself requires a custom dev/production build (not Expo Go).
 */
const { withAndroidManifest, withInfoPlist } = require('@expo/config-plugins');

function withHealthGraphPpg(config) {
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    const perms = manifest['uses-permission'].map((p) => p.$['android:name']);
    for (const name of ['android.permission.CAMERA', 'android.permission.FLASHLIGHT']) {
      if (!perms.includes(name)) manifest['uses-permission'].push({ $: { 'android:name': name } });
    }
    return cfg;
  });
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.NSCameraUsageDescription =
      cfg.modResults.NSCameraUsageDescription ||
      'HealthGraph uses the camera and flash to measure your pulse from your fingertip, entirely on this device.';
    return cfg;
  });
  return config;
}

module.exports = withHealthGraphPpg;
