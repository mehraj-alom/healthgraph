#!/usr/bin/env node
/**
 * generate-graph-nodes.js
 *
 * Generates small GLB sphere files for each health graph node type.
 * Each GLB contains a UV-sphere with the node type's material color.
 *
 * Output: frontend/assets/graph-nodes/
 *   node_patient.glb          (gold sphere, 32 segments)
 *   node_body_structure.glb   (teal sphere, 24 segments)
 *   node_observation.glb      (blue sphere, 20 segments)
 *   node_document.glb         (purple sphere, 16 segments)
 *   node_event.glb            (orange sphere, 14 segments)
 *   edge_line.glb             (thin cylinder for edges)
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'assets', 'graph-nodes');

// Node type configs: [R, G, B, A] in linear space, segments count
const NODE_TYPES = {
  patient:        { color: [0.89, 0.77, 0.10, 1.0], segments: 32, name: 'node_patient' },
  body_structure: { color: [0.13, 0.72, 0.65, 1.0], segments: 24, name: 'node_body_structure' },
  observation:    { color: [0.30, 0.55, 1.00, 1.0], segments: 20, name: 'node_observation' },
  document:       { color: [0.61, 0.42, 1.00, 1.0], segments: 16, name: 'node_document' },
  timeline_event: { color: [0.96, 0.72, 0.25, 1.0], segments: 14, name: 'node_event' },
};

function generateSphere(segments, rings) {
  const positions = [];
  const normals = [];
  const indices = [];

  for (let lat = 0; lat <= rings; lat++) {
    const theta = (lat * Math.PI) / rings;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let lon = 0; lon <= segments; lon++) {
      const phi = (lon * 2 * Math.PI) / segments;
      const x = sinTheta * Math.cos(phi);
      const y = cosTheta;
      const z = sinTheta * Math.sin(phi);

      positions.push(x, y, z);
      normals.push(x, y, z);
    }
  }

  for (let lat = 0; lat < rings; lat++) {
    for (let lon = 0; lon < segments; lon++) {
      const first = lat * (segments + 1) + lon;
      const second = first + segments + 1;

      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }

  return { positions, normals, indices };
}

function generateCylinder(segments) {
  const positions = [];
  const normals = [];
  const indices = [];
  const radius = 0.02; // thin line
  const height = 1.0;

  // Side vertices
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    // Bottom vertex
    positions.push(x, -height / 2, z);
    normals.push(Math.cos(angle), 0, Math.sin(angle));

    // Top vertex
    positions.push(x, height / 2, z);
    normals.push(Math.cos(angle), 0, Math.sin(angle));
  }

  // Side faces
  for (let i = 0; i < segments; i++) {
    const bottomLeft = i * 2;
    const topLeft = i * 2 + 1;
    const bottomRight = (i + 1) * 2;
    const topRight = (i + 1) * 2 + 1;

    indices.push(bottomLeft, bottomRight, topLeft);
    indices.push(topLeft, bottomRight, topRight);
  }

  return { positions, normals, indices };
}

function createGLB(geometry, color) {
  const { positions, normals, indices } = geometry;
  const posBuffer = new Float32Array(positions);
  const normBuffer = new Float32Array(normals);
  const idxBuffer = new Uint16Array(indices);

  // Pad each buffer to 4-byte alignment
  const posBytes = posBuffer.buffer.slice(0);
  const normBytes = normBuffer.buffer.slice(0);
  const idxBytes = idxBuffer.buffer.slice(0);

  const posAligned = Math.ceil(posBytes.byteLength / 4) * 4;
  const normAligned = Math.ceil(normBytes.byteLength / 4) * 4;
  const idxAligned = Math.ceil(idxBytes.byteLength / 4) * 4;

  const totalBinLength = posAligned + normAligned + idxAligned;

  // Compute bounds
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxX = Math.max(maxX, positions[i]);
    maxY = Math.max(maxY, positions[i + 1]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }

  const gltf = {
    asset: { version: '2.0', generator: 'healthgraph-graph-nodes' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1 },
        indices: 2,
        material: 0,
      }],
    }],
    materials: [{
      pbrMetallicRoughness: {
        baseColorFactor: color,
        metallicFactor: 0.15,
        roughnessFactor: 0.45,
      },
      emissiveFactor: [color[0] * 0.15, color[1] * 0.15, color[2] * 0.15],
    }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126, // FLOAT
        count: positions.length / 3,
        type: 'VEC3',
        max: [maxX, maxY, maxZ],
        min: [minX, minY, minZ],
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: normals.length / 3,
        type: 'VEC3',
      },
      {
        bufferView: 2,
        componentType: 5123, // UNSIGNED_SHORT
        count: indices.length,
        type: 'SCALAR',
        max: [Math.max(...indices)],
        min: [Math.min(...indices)],
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.byteLength, target: 34962 },
      { buffer: 0, byteOffset: posAligned, byteLength: normBytes.byteLength, target: 34962 },
      { buffer: 0, byteOffset: posAligned + normAligned, byteLength: idxBytes.byteLength, target: 34963 },
    ],
    buffers: [{ byteLength: totalBinLength }],
  };

  const jsonStr = JSON.stringify(gltf);
  const jsonPadded = jsonStr + ' '.repeat(4 - (jsonStr.length % 4));
  const jsonBytes = Buffer.from(jsonPadded, 'utf8');

  // Binary buffer
  const binBuffer = Buffer.alloc(totalBinLength);
  Buffer.from(posBytes).copy(binBuffer, 0);
  Buffer.from(normBytes).copy(binBuffer, posAligned);
  Buffer.from(idxBytes).copy(binBuffer, posAligned + normAligned);

  // GLB header
  const glbLength = 12 + 8 + jsonBytes.length + 8 + binBuffer.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0); // magic: "glTF"
  header.writeUInt32LE(2, 4); // version
  header.writeUInt32LE(glbLength, 8); // total length

  // JSON chunk
  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBytes.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4E4F534A, 4); // "JSON"

  // BIN chunk
  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binBuffer.length, 0);
  binChunkHeader.writeUInt32LE(0x004E4942, 4); // "BIN\0"

  return Buffer.concat([header, jsonChunkHeader, jsonBytes, binChunkHeader, binBuffer]);
}

// Generate sphere GLBs for each node type
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

for (const [type, config] of Object.entries(NODE_TYPES)) {
  const rings = Math.max(config.segments / 2, 8);
  const sphere = generateSphere(config.segments, rings);
  const glb = createGLB(sphere, config.color);
  const outPath = path.join(OUTPUT_DIR, `${config.name}.glb`);
  fs.writeFileSync(outPath, glb);
  console.log(`Generated ${outPath} (${glb.length} bytes, ${sphere.positions.length / 3} vertices)`);
}

// Generate edge line GLB (thin gray cylinder)
const edgeCyl = generateCylinder(8);
const edgeColor = [0.23, 0.42, 0.61, 1.0]; // subtle blue-gray
const edgeGlb = createGLB(edgeCyl, edgeColor);
const edgePath = path.join(OUTPUT_DIR, 'edge_line.glb');
fs.writeFileSync(edgePath, edgeGlb);
console.log(`Generated ${edgePath} (${edgeGlb.length} bytes, ${edgeCyl.positions.length / 3} vertices)`);

console.log('\nAll graph node GLB files generated successfully!');
