const { withMainApplication } = require('@expo/config-plugins');

module.exports = function withOnnxruntimePackage(config) {
  return withMainApplication(config, (config) => {
    const contents = config.modResults.contents;
    // Add import
    if (!contents.includes('import ai.onnxruntime.reactnative.OnnxruntimePackage')) {
      config.modResults.contents = contents.replace(
        'import expo.modules.ExpoReactHostFactory',
        'import expo.modules.ExpoReactHostFactory\nimport ai.onnxruntime.reactnative.OnnxruntimePackage',
      );
    }
    // Add package to list
    if (!contents.includes('add(OnnxruntimePackage())')) {
      config.modResults.contents = config.modResults.contents.replace(
        '          // add(MyReactNativePackage())',
        '          // add(MyReactNativePackage())\n          add(OnnxruntimePackage())',
      );
    }
    return config;
  });
};
