/**
 * profile-glbs.js — Profile all anatomy GLB files.
 *
 * Usage: node scripts/profile-glbs.js
 *
 * Measures: file size, Draco detection, JSON chunk metadata,
 * mesh/node names, and file-level statistics.
 *
 * Does NOT decode geometry (Draco requires WASM decoder).
 * Instead, extracts metadata from the GLB JSON chunk.
 */

const fs = require('fs');
const path = require('path');

const MALE_DIR = path.join(__dirname, '../assets/anatomy/male');
const FEMALE_DIR = path.join(__dirname, '../assets/anatomy/female');

function getGlbFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.glb'))
    .sort()
    .map(f => ({ fullPath: path.join(dir, f), name: f }));
}

function parseGlbJson(filePath) {
  const buffer = fs.readFileSync(filePath);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // GLB header: magic (4 bytes) + version (4 bytes) + length (4 bytes)
  const magic = view.getUint32(0, true);
  if (magic !== 0x46546C67) { // "glTF"
    return { error: 'Not a valid GLB file' };
  }

  const version = view.getUint32(4, true);
  const totalLength = view.getUint32(8, true);

  // First chunk should be JSON
  const chunkLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);

  if (chunkType !== 0x4E4F534A) { // "JSON"
    return { error: 'First chunk is not JSON' };
  }

  const jsonStr = buffer.toString('utf8', 20, 20 + chunkLength);

  // Remove trailing null bytes
  const cleanJson = jsonStr.replace(/\0+$/, '');

  try {
    const gltf = JSON.parse(cleanJson);

    // Count meshes, nodes, materials, textures
    const meshCount = (gltf.meshes || []).length;
    const nodeCount = (gltf.nodes || []).length;
    const materialCount = (gltf.materials || []).length;
    const textureCount = (gltf.textures || []).length;
    const imageCount = (gltf.images || []).length;
    const accessorCount = (gltf.accessors || []).length;
    const bufferViewCount = (gltf.bufferViews || []).length;

    // Check for Draco extension
    const hasDraco = cleanJson.includes('KHR_draco_mesh_compression');

    // Check for other extensions
    const extensions = (gltf.extensionsUsed || []);

    // Get mesh names
    const meshNames = (gltf.meshes || []).map(m => m.name || '(unnamed)');

    // Get node names (only mesh nodes)
    const meshNodeNames = (gltf.nodes || [])
      .filter(n => n.mesh !== undefined)
      .map(n => n.name || '(unnamed)');

    // Estimate vertex count from accessors
    // Position accessor with componentType 5126 (FLOAT) gives vertex count
    let estimatedVertices = 0;
    let estimatedTriangles = 0;
    for (const accessor of (gltf.accessors || [])) {
      if (accessor.byteOffset === undefined) {
        // This is likely a position accessor
        const componentType = accessor.componentType;
        const count = accessor.count || 0;
        const type = accessor.type;

        // VEC3 position accessors
        if (type === 'VEC3' && componentType === 5126) {
          // This could be position or normal — we count all VEC3 FLOAT accessors
          // but only once per mesh (rough estimate)
        }
      }
    }

    // Better approach: count from buffer views
    // Each mesh primitive has attributes with accessors
    // Accessors reference buffer views which reference buffers
    // We can estimate total geometry size from buffer sizes
    let totalBufferBytes = 0;
    for (const buf of (gltf.buffers || [])) {
      totalBufferBytes += buf.byteLength || 0;
    }

    return {
      version,
      totalLength,
      meshCount,
      nodeCount,
      materialCount,
      textureCount,
      imageCount,
      accessorCount,
      bufferViewCount,
      hasDraco,
      extensions,
      meshNames,
      meshNodeNames,
      totalBufferBytes,
      totalBufferMB: (totalBufferBytes / (1024 * 1024)).toFixed(2),
    };
  } catch (e) {
    return { error: `JSON parse error: ${e.message}` };
  }
}

function main() {
  console.log('=== GLB Anatomy Profiler ===');
  console.log('Measures file-level properties (no Draco decoding needed)\n');

  const results = [];

  // Profile male GLBs
  const maleFiles = getGlbFiles(MALE_DIR);
  console.log(`Profiling ${maleFiles.length} male GLBs...\n`);

  for (const { fullPath, name } of maleFiles) {
    const fileSize = fs.statSync(fullPath).size;
    const t0 = Date.now();
    const metadata = parseGlbJson(fullPath);
    const parseMs = Date.now() - t0;

    const result = {
      fileName: name,
      gender: 'male',
      fileSize,
      fileSizeKB: (fileSize / 1024).toFixed(1),
      fileSizeMB: (fileSize / (1024 * 1024)).toFixed(2),
      parseJsonMs: parseMs,
      ...metadata,
    };
    results.push(result);

    if (metadata.error) {
      console.log(`  ✗ ${name}: ${metadata.error}`);
    } else {
      console.log(`  ✓ ${name}: ${result.fileSizeMB}MB, ${metadata.meshCount} meshes, ${metadata.nodeCount} nodes, ${metadata.materialCount} materials, ${metadata.textureCount} textures, draco=${metadata.hasDraco}, buffer=${metadata.totalBufferMB}MB`);
    }
  }

  // Profile female GLBs
  const femaleFiles = getGlbFiles(FEMALE_DIR);
  console.log(`\nProfiling ${femaleFiles.length} female GLBs...\n`);

  for (const { fullPath, name } of femaleFiles) {
    const fileSize = fs.statSync(fullPath).size;
    const t0 = Date.now();
    const metadata = parseGlbJson(fullPath);
    const parseMs = Date.now() - t0;

    const result = {
      fileName: name,
      gender: 'female',
      fileSize,
      fileSizeKB: (fileSize / 1024).toFixed(1),
      fileSizeMB: (fileSize / (1024 * 1024)).toFixed(2),
      parseJsonMs: parseMs,
      ...metadata,
    };
    results.push(result);

    if (metadata.error) {
      console.log(`  ✗ ${name}: ${metadata.error}`);
    } else {
      console.log(`  ✓ ${name}: ${result.fileSizeMB}MB, ${metadata.meshCount} meshes, ${metadata.nodeCount} nodes, ${metadata.materialCount} materials, ${metadata.textureCount} textures, draco=${metadata.hasDraco}, buffer=${metadata.totalBufferMB}MB`);
    }
  }

  // Summary
  const valid = results.filter(r => !r.error);
  const dracoCount = valid.filter(r => r.hasDraco).length;
  const totalMeshes = valid.reduce((s, r) => s + (r.meshCount || 0), 0);
  const totalNodes = valid.reduce((s, r) => s + (r.nodeCount || 0), 0);
  const totalMaterials = valid.reduce((s, r) => s + (r.materialCount || 0), 0);
  const totalTextures = valid.reduce((s, r) => s + (r.textureCount || 0), 0);
  const totalBufferSize = valid.reduce((s, r) => s + (r.totalBufferBytes || 0), 0);

  console.log('\n=== SUMMARY ===');
  console.log(`Total GLBs: ${valid.length}`);
  console.log(`Total file size: ${(valid.reduce((s, r) => s + r.fileSize, 0) / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Total buffer size: ${(totalBufferSize / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Total meshes: ${totalMeshes}`);
  console.log(`Total nodes: ${totalNodes}`);
  console.log(`Total materials: ${totalMaterials}`);
  console.log(`Total textures: ${totalTextures}`);
  console.log(`Draco compressed: ${dracoCount}/${valid.length}`);

  // Top 5 by file size
  const bySize = [...valid].sort((a, b) => b.fileSize - a.fileSize);
  console.log('\nTop 5 by file size:');
  bySize.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.fileName}: ${r.fileSizeMB}MB, ${r.meshCount} meshes, draco=${r.hasDraco}`);
  });

  // Top 5 by mesh count
  const byMeshes = [...valid].sort((a, b) => (b.meshCount || 0) - (a.meshCount || 0));
  console.log('\nTop 5 by mesh count:');
  byMeshes.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.fileName}: ${r.meshCount} meshes, ${r.fileSizeMB}MB`);
  });

  // Files with most textures
  const byTextures = [...valid].sort((a, b) => (b.textureCount || 0) - (a.textureCount || 0));
  console.log('\nTop 5 by texture count:');
  byTextures.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.fileName}: ${r.textureCount} textures, ${r.fileSizeMB}MB`);
  });
}

main();
