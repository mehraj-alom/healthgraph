/**
 * Type declarations for asset modules imported via require().
 * Expo's bundler handles these and returns numeric asset IDs.
 */
declare module '*.glb' {
  const value: number;
  export default value;
}

declare module '*.gltf' {
  const value: number;
  export default value;
}

declare module '*.png' {
  const value: number;
  export default value;
}

declare module '*.jpg' {
  const value: number;
  export default value;
}

declare module '*.onnx' {
  const value: number;
  export default value;
}
