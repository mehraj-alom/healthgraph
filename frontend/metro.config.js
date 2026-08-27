const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Add .glb and .gltf asset support
config.resolver.assetExts.push('glb', 'gltf');

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