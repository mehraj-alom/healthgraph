/**
 * proceduralBody.ts — bundled procedural body shell (img2threejs, ours).
 *
 * A code-generated male body shell with HealthGraph region ids as node
 * names, bundled in-app: no download, no Draco dependency, works fully
 * offline. Used as the base layer when the downloaded regional model is
 * unavailable. Fine-grained ids map to zones (EQUIVALENT); systems map
 * to nothing. Generated from object-sculpt-spec.json (strict-gated);
 * region vocabulary matches anatomyMap structure_ids.
 */

/**
 * Bundled asset handle (Metro packs the GLB at build time). Resolved
 * lazily so node unit tests can import the pure mapping without a
 * Metro require.
 */
export function proceduralMaleAsset(): number {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../assets/anatomy/procedural_male_shell.glb');
}

export const PROCEDURAL_REGION_IDS: string[] = [
  'HEAD', 'FACE', 'NECK', 'CHEST', 'ABDOMEN', 'PELVIS',
  'SPINE_CERVICAL', 'SPINE_THORACIC', 'SPINE_LUMBAR',
  ...(['LEFT', 'RIGHT'] as const).flatMap((side) =>
    ['SHOULDER', 'UPPER_ARM', 'ELBOW', 'FOREARM', 'WRIST', 'HAND',
     'HIP', 'THIGH', 'KNEE', 'CALF', 'ANKLE', 'FOOT'].map((z) => `${side}_${z}`),
  ),
];

/** Fine structure ids that have no own zone: nearest procedural zone. */
const EQUIVALENT_ZONE: Record<string, string> = {
  JAW: 'HEAD',
  BRAIN: 'HEAD',
  TEETH: 'FACE',
  TONGUE: 'FACE',
  GUMS: 'FACE',
  MOUTH: 'FACE',
  NOSE: 'FACE',
  LEFT_EYE: 'FACE',
  RIGHT_EYE: 'FACE',
  LEFT_EAR: 'HEAD',
  RIGHT_EAR: 'HEAD',
  THROAT: 'NECK',
  THYROID: 'NECK',
  HEART: 'CHEST',
  LEFT_LUNG: 'CHEST',
  RIGHT_LUNG: 'CHEST',
  ESOPHAGUS: 'CHEST',
  RIB_CAGE: 'CHEST',
  LIVER: 'ABDOMEN',
  GALLBLADDER: 'ABDOMEN',
  STOMACH: 'ABDOMEN',
  PANCREAS: 'ABDOMEN',
  SMALL_INTESTINE: 'ABDOMEN',
  LARGE_INTESTINE: 'ABDOMEN',
  APPENDIX: 'ABDOMEN',
  SPLEEN: 'ABDOMEN',
  LEFT_KIDNEY: 'ABDOMEN',
  RIGHT_KIDNEY: 'ABDOMEN',
  BLADDER: 'PELVIS',
  RECTUM: 'PELVIS',
  UTERUS: 'PELVIS',
  LEFT_OVARY: 'PELVIS',
  RIGHT_OVARY: 'PELVIS',
  PROSTATE: 'PELVIS',
};

for (const side of ['LEFT', 'RIGHT']) {
  for (const finger of ['THUMB', 'INDEX_FINGER', 'MIDDLE_FINGER', 'RING_FINGER', 'LITTLE_FINGER']) {
    EQUIVALENT_ZONE[`${side}_${finger}`] = `${side}_HAND`;
  }
  for (const toe of ['BIG_TOE', 'SECOND_TOE', 'THIRD_TOE', 'FOURTH_TOE', 'LITTLE_TOE']) {
    EQUIVALENT_ZONE[`${side}_${toe}`] = `${side}_FOOT`;
  }
}

/** Zone (or equivalent zone) node names to highlight for a structure. */
export function proceduralHighlightNodes(structureId: string | null): string[] {
  if (!structureId) return [];
  if (PROCEDURAL_REGION_IDS.includes(structureId)) return [structureId];
  const zone = EQUIVALENT_ZONE[structureId];
  return zone ? [zone] : [];
}

/** Reverse entries (node → structure) merged into the tap map for male. */
export function proceduralNodeEntries(): Array<[string, string]> {
  return PROCEDURAL_REGION_IDS.map((id) => [id, id]);
}

let cachedUri: string | null | undefined;

/** Local URI of the bundled shell (expo-asset resolve, offline-safe). */
export async function getProceduralBodyUri(): Promise<string | null> {
  if (cachedUri !== undefined) return cachedUri;
  try {
    const { Asset } = await import('expo-asset');
    const assets = await Asset.loadAsync([proceduralMaleAsset()]);
    const resolved = assets[0];
    await resolved.downloadAsync().catch(() => {});
    cachedUri = resolved.localUri ?? resolved.uri ?? null;
  } catch {
    cachedUri = null;
  }
  return cachedUri;
}
