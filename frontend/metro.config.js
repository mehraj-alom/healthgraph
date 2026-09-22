const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Add .glb, .gltf, .wasm, .onnx, and .txt asset support
// .wasm — Draco decoder binary
// .onnx — registered so Metro CAN resolve .onnx paths, but the PhysFormer
//         rPPG model is intentionally NOT bundled (nothing require()s it —
//         Metro only packages statically require()d assets). It downloads
//         on demand via services/rppg/modelManager.ts and is verified by
//         size + SHA-256 before ONNX Runtime opens it.
// .txt  — Draco decoder JS loaded as raw text (renamed from .js to avoid
//         Metro treating them as executable modules)
config.resolver.assetExts.push('glb', 'gltf', 'wasm', 'onnx', 'txt');

// Ensure TypeScript files in node_modules are handled
config.resolver.sourceExts = [
  ...config.resolver.sourceExts,
  'ts',
  'tsx',
];

// Ensure proper resolution for @react-three/fiber
config.resolver.unstable_enablePackageExports = true;

// Add path aliases for @/ imports using extraNodeModules
config.resolver.extraNodeModules = new Proxy({}, {
  get: (target, name) => {
    if (name.startsWith('@/')) {
      return path.join(__dirname, 'src', name.slice(2));
    }
    return path.join(__dirname, 'node_modules', name);
  },
});

module.exports = config;