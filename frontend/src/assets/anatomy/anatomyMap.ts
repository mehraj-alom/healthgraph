/**
 * anatomyMap.ts — Rendering bridge between HealthGraph AnatomicalStructure IDs
 * and Anatria3D GLB assets.
 *
 * This file does NOT modify the PostgreSQL/Neo4j anatomy schema.
 * It maps canonical HealthGraph structure_id → gender → GLB file(s) → GLTF node(s).
 *
 * ⚠️  Node names have been validated against the actual GLB binary files.
 * All "of hand" / "of foot" suffixes removed per actual Z-Anatomy naming.
 * See GLB_VALIDATION section below for the validation script results.
 *
 * ⚠️  Do NOT merge male and female assets. They are under different licences.
 * See LICENSE and NOTICE in frontend/assets/anatomy/.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MappingType = 'DIRECT' | 'COMPOSITE' | 'EQUIVALENT' | 'UNAVAILABLE';

export interface AnatriaNodeRef {
  /** GLB file name (relative to assets/anatomy/{gender}/) */
  glbFile: string;
  /** Exact GLTF node name inside the GLB */
  nodeName: string;
}

export interface StructureMapping {
  /** HealthGraph canonical structure_id */
  structureId: string;
  /** Human-readable display name */
  displayName: string;
  /** How this structure maps to Anatria */
  mappingType: MappingType;
  /** Male-specific GLB → node mappings (empty if unavailable for male) */
  male: AnatriaNodeRef[];
  /** Female-specific GLB → node mappings (empty if unavailable for female) */
  female: AnatriaNodeRef[];
  /** Clinical notes about this mapping */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Male GLB files used (node names verified against actual GLB binary)
// ---------------------------------------------------------------------------
// skeletal_male.glb       (2.7 MB)  — bones, vertebrae, ribs, skull parts, phalanges
// digestive_male.glb      (909 KB)  — liver, stomach, pancreas, intestines, tongue
// renal_male.glb          (58 KB)   — kidneys, bladder, ureters
// reproductive_male.glb   (63 KB)   — prostate, testes, penis
// respiratory_male.glb    (572 KB)  — lung lobes, trachea
// endocrine_male.glb      (39 KB)   — thyroid, pituitary, pineal, adrenals
// lymphatic_male.glb      (498 KB)  — spleen, lymph nodes
//
// Female GLB files used:
// skeletal_female.glb       (1.3 MB)
// digestive_female.glb      (466 KB)
// renal_female.glb          (603 KB)
// reproductive_female.glb   (419 KB)
// cardiovascular_female.glb (439 KB)  — vessels only, NO heart
// lymphatic_female.glb      (42 KB)

// ---------------------------------------------------------------------------
// Complete HealthGraph → Anatria mapping
// ---------------------------------------------------------------------------

export const ANATOMY_MAPPINGS: StructureMapping[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // ROOT & SYSTEMS
  // ══════════════════════════════════════════════════════════════════════════

  {
    structureId: 'FULL_BODY',
    displayName: 'Full Body',
    mappingType: 'UNAVAILABLE',
    male: [],
    female: [],
    notes: 'No single full-body mesh exists. Individual systems compose the body.',
  },
  {
    structureId: 'MUSCULAR_SYSTEM',
    displayName: 'Muscular System',
    mappingType: 'UNAVAILABLE',
    male: [],
    female: [],
    notes: 'Female atlas has no muscular system. Not loaded in MVP for performance (12 MB).',
  },
  {
    structureId: 'VASCULAR_SYSTEM',
    displayName: 'Vascular System',
    mappingType: 'UNAVAILABLE',
    male: [],
    female: [],
    notes: 'Female atlas has partial cardiovascular. Not loaded in MVP for performance (6.9 MB).',
  },
  {
    structureId: 'LYMPHATIC_SYSTEM',
    displayName: 'Lymphatic System',
    mappingType: 'UNAVAILABLE',
    male: [],
    female: [],
    notes: 'Not loaded in MVP for performance.',
  },
  {
    structureId: 'NERVOUS_SYSTEM',
    displayName: 'Nervous System',
    mappingType: 'UNAVAILABLE',
    male: [],
    female: [],
    notes: 'Female atlas has no nervous system. Not loaded in MVP for performance (8.2 MB).',
  },
  {
    structureId: 'SKELETAL_SYSTEM',
    displayName: 'Skeletal System',
    mappingType: 'UNAVAILABLE',
    male: [],
    female: [],
    notes: 'No single "Skeleton" root node exists in the GLB. Individual bones are mapped via sub-structures.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BODY REGIONS
  // ══════════════════════════════════════════════════════════════════════════

  {
    structureId: 'HEAD',
    displayName: 'Head',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Frontal bone' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Parietal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Parietal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Temporal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Temporal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Occipital bone' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Sphenoid bone' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Zygomatic bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Zygomatic bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Mandible' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Hyoid bone' },
    ],
    female: [],
    notes: 'Individual skull bones. No single "Skull" node exists in the GLB. Female atlas has no skull.',
  },
  {
    structureId: 'NECK',
    displayName: 'Neck',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Hyoid bone' },
      { glbFile: 'digestive_male.glb', nodeName: 'Thyroid cartilage' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra C3' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra C4' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra C5' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra C6' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra C7' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Clavicle.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Clavicle.r' },
    ],
    female: [],
    notes: 'Cervical vertebrae + hyoid + clavicles. Female atlas lacks skeleton detail.',
  },
  {
    structureId: 'CHEST',
    displayName: 'Chest',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Body of sternum' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Manubrium of sternum' },
      { glbFile: 'skeletal_male.glb', nodeName: 'First rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'First rib.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Second rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Second rib.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Third rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Third rib.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fourth rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fourth rib.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fifth rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fifth rib.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Sixth rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Sixth rib.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Seventh rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Seventh rib.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Eighth rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Eighth rib.r' },
    ],
    female: [],
    notes: 'Sternum + ribs 1–8. Female atlas has no rib cage nodes.',
  },
  {
    structureId: 'ABDOMEN',
    displayName: 'Abdomen',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra L1' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra L2' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra L3' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra L4' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra L5' },
    ],
    female: [],
    notes: 'Lumbar vertebrae approximation. No single pelvis bone node exists.',
  },
  {
    structureId: 'PELVIS',
    displayName: 'Pelvis',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Sacrum' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Coccyx' },
    ],
    female: [
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_ilium_compact_bone_L' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_ilium_compact_bone_R' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_ischium_compact_bone_L' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_ischium_compact_bone_R' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_pubis_compact_bone_L' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_pubis_compact_bone_R' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_sacrum' },
    ],
    notes: 'Male: sacrum + coccyx only (no "Os coxae" node in GLB). Female: ilium/ischium/pubis + sacrum.',
  },
  {
    structureId: 'SPINE',
    displayName: 'Spine',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra C3' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra C4' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra C5' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra C6' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra C7' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T1' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T2' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T3' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T4' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T5' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T6' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T7' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T8' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T9' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T10' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T11' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T12' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra L1' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra L2' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra L3' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra L4' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra L5' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Sacrum' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Coccyx' },
    ],
    female: [
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_cervical_vertebra_1' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_cervical_vertebra_2' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_cervical_vertebra_3' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_cervical_vertebra_4' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_cervical_vertebra_5' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_cervical_vertebra_6' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_cervical_vertebra_7' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_1' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_2' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_3' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_4' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_5' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_6' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_7' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_8' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_9' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_10' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_11' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_12' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_lumbar_vertebra_1' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_lumbar_vertebra_2' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_lumbar_vertebra_3' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_lumbar_vertebra_4' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_lumbar_vertebra_5' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_lumbar_vertebra_6' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_sacrum' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_coccyx' },
    ],
    notes: 'All vertebrae C3–L5 + sacrum + coccyx. Female uses VH_F naming convention.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // HEAD SUB-STRUCTURES
  // ══════════════════════════════════════════════════════════════════════════

  {
    structureId: 'BRAIN',
    displayName: 'Brain',
    mappingType: 'UNAVAILABLE',
    male: [],
    female: [],
    notes: 'No whole-brain mesh exists in Anatria. The nervous system contains brainstem, cerebellum parts, and meninges, but no unified cerebrum/cerebellum mesh.',
  },
  {
    structureId: 'FACE',
    displayName: 'Face',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Frontal bone' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Zygomatic bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Zygomatic bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Mandible' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Maxilla.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Maxilla.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Nasal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Nasal bone.r' },
    ],
    female: [],
    notes: 'Frontal bone + zygomatic + mandible + maxilla + nasal bones. Female atlas has no skull.',
  },
  {
    structureId: 'LEFT_EYE',
    displayName: 'Left Eye',
    mappingType: 'UNAVAILABLE',
    male: [],
    female: [],
    notes: 'No standalone eyeball mesh. Nervous system has ocular nerves but not the eye itself.',
  },
  {
    structureId: 'RIGHT_EYE',
    displayName: 'Right Eye',
    mappingType: 'UNAVAILABLE',
    male: [],
    female: [],
    notes: 'No standalone eyeball mesh.',
  },
  {
    structureId: 'NOSE',
    displayName: 'Nose',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Nasal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Nasal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Nasal septal cartilage' },
    ],
    female: [],
    notes: 'Nasal bones + septal cartilage. No standalone nasal cartilage mesh.',
  },
  {
    structureId: 'MOUTH',
    displayName: 'Mouth',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'digestive_male.glb', nodeName: 'Tongue' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Mandible' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Maxilla.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Maxilla.r' },
    ],
    female: [],
    notes: 'Tongue + jaw bones. Teeth/gums not individually meshed.',
  },
  {
    structureId: 'TEETH',
    displayName: 'Teeth',
    mappingType: 'UNAVAILABLE',
    male: [],
    female: [],
    notes: 'No individual tooth meshes in Anatria.',
  },
  {
    structureId: 'TONGUE',
    displayName: 'Tongue',
    mappingType: 'DIRECT',
    male: [{ glbFile: 'digestive_male.glb', nodeName: 'Tongue' }],
    female: [],
    notes: 'Direct 1:1 mapping.',
  },
  {
    structureId: 'GUMS',
    displayName: 'Gums',
    mappingType: 'UNAVAILABLE',
    male: [],
    female: [],
    notes: 'No gingiva mesh in Anatria.',
  },
  {
    structureId: 'LEFT_EAR',
    displayName: 'Left Ear',
    mappingType: 'UNAVAILABLE',
    male: [],
    female: [],
    notes: 'No ear structure mesh in Anatria.',
  },
  {
    structureId: 'RIGHT_EAR',
    displayName: 'Right Ear',
    mappingType: 'UNAVAILABLE',
    male: [],
    female: [],
    notes: 'No ear structure mesh in Anatria.',
  },
  {
    structureId: 'JAW',
    displayName: 'Jaw',
    mappingType: 'DIRECT',
    male: [{ glbFile: 'skeletal_male.glb', nodeName: 'Mandible' }],
    female: [],
    notes: 'Mandible only. TMJ not separately meshed.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // NECK
  // ══════════════════════════════════════════════════════════════════════════

  {
    structureId: 'THYROID',
    displayName: 'Thyroid',
    mappingType: 'DIRECT',
    male: [{ glbFile: 'endocrine_male.glb', nodeName: 'Thyroid gland' }],
    female: [],
    notes: 'Direct mapping to endocrine system thyroid.',
  },
  {
    structureId: 'THROAT',
    displayName: 'Throat',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'respiratory_male.glb', nodeName: 'Trachea' },
      { glbFile: 'visceral_male.glb', nodeName: 'Laryngopharynx' },
      { glbFile: 'visceral_male.glb', nodeName: 'Oropharynx' },
      { glbFile: 'visceral_male.glb', nodeName: 'Nasopharynx' },
    ],
    female: [],
    notes: 'Trachea + pharynx parts.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CHEST
  // ══════════════════════════════════════════════════════════════════════════

  {
    structureId: 'HEART',
    displayName: 'Heart',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'cardiovascular_male.glb', nodeName: 'Left atrium' },
      { glbFile: 'cardiovascular_male.glb', nodeName: 'Right atrium' },
      { glbFile: 'cardiovascular_male.glb', nodeName: 'Left ventricle' },
      { glbFile: 'cardiovascular_male.glb', nodeName: 'Right ventricle' },
    ],
    female: [],
    notes: 'No single heart mesh in male atlas. Uses four chamber nodes. Female atlas cardiovascular contains only vessels, no heart.',
  },
  {
    structureId: 'LEFT_LUNG',
    displayName: 'Left Lung',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'respiratory_male.glb', nodeName: 'Superior lobe of left lung' },
      { glbFile: 'respiratory_male.glb', nodeName: 'Inferior lobe of left lung' },
    ],
    female: [],
    notes: 'Left lung = superior lobe + inferior lobe. No whole-lung mesh.',
  },
  {
    structureId: 'RIGHT_LUNG',
    displayName: 'Right Lung',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'respiratory_male.glb', nodeName: 'Superior lobe of right lung' },
      { glbFile: 'respiratory_male.glb', nodeName: 'Middle lobe of right lung' },
      { glbFile: 'respiratory_male.glb', nodeName: 'Inferior lobe of right lung' },
    ],
    female: [],
    notes: 'Right lung = superior + middle + inferior lobes. No whole-lung mesh.',
  },
  {
    structureId: 'ESOPHAGUS',
    displayName: 'Esophagus',
    mappingType: 'DIRECT',
    male: [{ glbFile: 'digestive_male.glb', nodeName: 'Oesophagus' }],
    female: [],
    notes: 'Spelling variant: Anatria uses British "Oesophagus".',
  },
  {
    structureId: 'RIB_CAGE',
    displayName: 'Rib Cage',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Body of sternum' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Manubrium of sternum' },
      { glbFile: 'skeletal_male.glb', nodeName: 'First rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'First rib.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Second rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Second rib.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Third rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Third rib.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fourth rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fourth rib.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fifth rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fifth rib.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Sixth rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Sixth rib.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Seventh rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Seventh rib.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Eighth rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Eighth rib.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Ninth rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Ninth rib.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Tenth rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Tenth rib.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Eleventh rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Eleventh rib.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Twelfth rib.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Twelfth rib.r' },
    ],
    female: [],
    notes: 'Sternum + all 24 individual ribs. No "Rib cage.l/r" group nodes exist.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ABDOMEN
  // ══════════════════════════════════════════════════════════════════════════

  {
    structureId: 'LIVER',
    displayName: 'Liver',
    mappingType: 'DIRECT',
    male: [{ glbFile: 'digestive_male.glb', nodeName: 'Liver' }],
    female: [
      { glbFile: 'digestive_female.glb', nodeName: 'VH_F_diaphragmatic_surface_of_liver' },
    ],
    notes: 'Direct 1:1 mapping. Female uses diaphragmatic surface (closest whole-liver node).',
  },
  {
    structureId: 'GALLBLADDER',
    displayName: 'Gallbladder',
    mappingType: 'DIRECT',
    male: [{ glbFile: 'digestive_male.glb', nodeName: 'Gallbladder' }],
    female: [{ glbFile: 'digestive_female.glb', nodeName: 'VH_F_gallbladder' }],
    notes: 'Direct 1:1 mapping.',
  },
  {
    structureId: 'STOMACH',
    displayName: 'Stomach',
    mappingType: 'DIRECT',
    male: [{ glbFile: 'digestive_male.glb', nodeName: 'Stomach' }],
    female: [],
    notes: 'Direct 1:1 mapping. Female atlas has no stomach mesh.',
  },
  {
    structureId: 'PANCREAS',
    displayName: 'Pancreas',
    mappingType: 'DIRECT',
    male: [{ glbFile: 'digestive_male.glb', nodeName: 'Pancreas' }],
    female: [
      { glbFile: 'digestive_female.glb', nodeName: 'VH_F_head_of_pancreas' },
      { glbFile: 'digestive_female.glb', nodeName: 'VH_F_body_of_pancreas' },
      { glbFile: 'digestive_female.glb', nodeName: 'VH_F_tail_of_pancreas' },
      { glbFile: 'digestive_female.glb', nodeName: 'VH_F_neck_of_pancreas' },
    ],
    notes: 'Male: single node. Female: composite of head/body/tail/neck.',
  },
  {
    structureId: 'SMALL_INTESTINE',
    displayName: 'Small Intestine',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'digestive_male.glb', nodeName: 'Duodenum' },
      { glbFile: 'digestive_male.glb', nodeName: 'Jejunum' },
    ],
    female: [
      { glbFile: 'digestive_female.glb', nodeName: 'VH_F_jejenum' },
      { glbFile: 'digestive_female.glb', nodeName: 'VH_F_ileum' },
    ],
    notes: 'Male: Duodenum + Jejunum only (Ileum not in male GLB). Female: Jejunum + Ileum.',
  },
  {
    structureId: 'LARGE_INTESTINE',
    displayName: 'Large Intestine',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'digestive_male.glb', nodeName: 'Ascending colon' },
      { glbFile: 'digestive_male.glb', nodeName: 'Transverse colon' },
      { glbFile: 'digestive_male.glb', nodeName: 'Descending colon' },
      { glbFile: 'digestive_male.glb', nodeName: 'Sigmoid colon' },
    ],
    female: [
      { glbFile: 'digestive_female.glb', nodeName: 'VH_F_caecum' },
      { glbFile: 'digestive_female.glb', nodeName: 'VH_F_ascending_colon' },
      { glbFile: 'digestive_female.glb', nodeName: 'VH_F_transverse_colon' },
      { glbFile: 'digestive_female.glb', nodeName: 'VH_F_descending_colon' },
      { glbFile: 'digestive_female.glb', nodeName: 'VH_F_sigmoid_colon' },
    ],
    notes: 'Male: colon segments only (Caecum not in male GLB). Female: Caecum + all colon segments.',
  },
  {
    structureId: 'APPENDIX',
    displayName: 'Appendix',
    mappingType: 'DIRECT',
    male: [{ glbFile: 'digestive_male.glb', nodeName: 'Vermiform appendix' }],
    female: [{ glbFile: 'digestive_female.glb', nodeName: 'VH_F_vermiform_appendix' }],
    notes: 'Direct 1:1 mapping.',
  },
  {
    structureId: 'SPLEEN',
    displayName: 'Spleen',
    mappingType: 'DIRECT',
    male: [{ glbFile: 'lymphatic_male.glb', nodeName: 'Spleen' }],
    female: [],
    notes: 'Direct 1:1 mapping. In lymphatic system.',
  },
  {
    structureId: 'LEFT_KIDNEY',
    displayName: 'Left Kidney',
    mappingType: 'DIRECT',
    male: [{ glbFile: 'renal_male.glb', nodeName: 'Kidney.l' }],
    female: [
      { glbFile: 'renal_female.glb', nodeName: 'VH_F_outer_cortex_of_kidney_L' },
      { glbFile: 'renal_female.glb', nodeName: 'VH_F_renal_column_L' },
      { glbFile: 'renal_female.glb', nodeName: 'VH_F_kidney_capsule_L' },
    ],
    notes: 'Male: single kidney node. Female: composite of cortex + column + capsule (closest available).',
  },
  {
    structureId: 'RIGHT_KIDNEY',
    displayName: 'Right Kidney',
    mappingType: 'DIRECT',
    male: [{ glbFile: 'renal_male.glb', nodeName: 'Kidney.r' }],
    female: [
      { glbFile: 'renal_female.glb', nodeName: 'VH_F_outer_cortex_of_kidney_R' },
      { glbFile: 'renal_female.glb', nodeName: 'VH_F_renal_column_R' },
      { glbFile: 'renal_female.glb', nodeName: 'VH_F_kidney_capsule_R' },
    ],
    notes: 'Male: single kidney node. Female: composite of cortex + column + capsule.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PELVIS
  // ══════════════════════════════════════════════════════════════════════════

  {
    structureId: 'BLADDER',
    displayName: 'Bladder',
    mappingType: 'DIRECT',
    male: [{ glbFile: 'renal_male.glb', nodeName: 'Urinary bladder' }],
    female: [
      { glbFile: 'renal_female.glb', nodeName: 'VH_F_fundus_of_urinary_bladder_dome' },
      { glbFile: 'renal_female.glb', nodeName: 'VH_F_fundus_of_urinary_bladder_base' },
      { glbFile: 'renal_female.glb', nodeName: 'VH_F_trigone_of_urinary_bladder' },
    ],
    notes: 'Male: single node. Female: dome + base + trigone (closest composite).',
  },
  {
    structureId: 'RECTUM',
    displayName: 'Rectum',
    mappingType: 'COMPOSITE',
    male: [],
    female: [{ glbFile: 'digestive_female.glb', nodeName: 'VH_F_rectum' }],
    notes: 'Male GLB has no rectum node. Female: direct mapping.',
  },
  {
    structureId: 'UTERUS',
    displayName: 'Uterus',
    mappingType: 'COMPOSITE',
    male: [],
    female: [
      { glbFile: 'reproductive_female.glb', nodeName: 'VH_F_body_of_uterus' },
      { glbFile: 'reproductive_female.glb', nodeName: 'VH_F_cervix' },
      { glbFile: 'reproductive_female.glb', nodeName: 'VH_F_fundus_of_uterus' },
    ],
    notes: 'Female-only. Body + cervix + fundus.',
  },
  {
    structureId: 'LEFT_OVARY',
    displayName: 'Left Ovary',
    mappingType: 'DIRECT',
    male: [],
    female: [{ glbFile: 'reproductive_female.glb', nodeName: 'VH_F_left_ovary' }],
    notes: 'Female-only. Direct mapping.',
  },
  {
    structureId: 'RIGHT_OVARY',
    displayName: 'Right Ovary',
    mappingType: 'DIRECT',
    male: [],
    female: [{ glbFile: 'reproductive_female.glb', nodeName: 'VH_F_right_ovary' }],
    notes: 'Female-only. Direct mapping.',
  },
  {
    structureId: 'PROSTATE',
    displayName: 'Prostate',
    mappingType: 'DIRECT',
    male: [{ glbFile: 'reproductive_male.glb', nodeName: 'Prostate' }],
    female: [],
    notes: 'Male-only. Direct mapping.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SPINE SEGMENTS
  // ══════════════════════════════════════════════════════════════════════════

  {
    structureId: 'CERVICAL_SPINE',
    displayName: 'Cervical Spine',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra C3' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra C4' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra C5' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra C6' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra C7' },
    ],
    female: [
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_cervical_vertebra_1' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_cervical_vertebra_2' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_cervical_vertebra_3' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_cervical_vertebra_4' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_cervical_vertebra_5' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_cervical_vertebra_6' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_cervical_vertebra_7' },
    ],
    notes: 'Male: C3–C7 (C1–C2 not separately meshed). Female: C1–C7.',
  },
  {
    structureId: 'THORACIC_SPINE',
    displayName: 'Thoracic Spine',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T1' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T2' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T3' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T4' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T5' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T6' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T7' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T8' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T9' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T10' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T11' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra T12' },
    ],
    female: [
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_1' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_2' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_3' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_4' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_5' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_6' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_7' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_8' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_9' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_10' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_11' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_thoracic_vertebra_12' },
    ],
    notes: 'T1–T12 vertebrae.',
  },
  {
    structureId: 'LUMBAR_SPINE',
    displayName: 'Lumbar Spine',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra L1' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra L2' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra L3' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra L4' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Vertebra L5' },
    ],
    female: [
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_lumbar_vertebra_1' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_lumbar_vertebra_2' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_lumbar_vertebra_3' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_lumbar_vertebra_4' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_lumbar_vertebra_5' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_lumbar_vertebra_6' },
    ],
    notes: 'L1–L5 vertebrae. Female has 6 lumbar vertebrae.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // LEFT ARM
  // ══════════════════════════════════════════════════════════════════════════

  {
    structureId: 'LEFT_SHOULDER',
    displayName: 'Left Shoulder',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Clavicle.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Scapula.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Humerus.l' },
    ],
    female: [],
    notes: 'Clavicle + scapula + humerus (left).',
  },
  {
    structureId: 'LEFT_UPPER_ARM',
    displayName: 'Left Upper Arm',
    mappingType: 'DIRECT',
    male: [{ glbFile: 'skeletal_male.glb', nodeName: 'Humerus.l' }],
    female: [],
    notes: 'Single bone: left humerus.',
  },
  {
    structureId: 'LEFT_ELBOW',
    displayName: 'Left Elbow',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Humerus.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Radius.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Ulna.l' },
    ],
    female: [],
    notes: 'Humerus + radius + ulna junction (left).',
  },
  {
    structureId: 'LEFT_FOREARM',
    displayName: 'Left Forearm',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Radius.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Ulna.l' },
    ],
    female: [],
    notes: 'Radius + ulna (left).',
  },
  {
    structureId: 'LEFT_WRIST',
    displayName: 'Left Wrist',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Scaphoid bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Lunate bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Pisiform bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Trapezium bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Trapezoid bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Capitate bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Hamate bone.l' },
    ],
    female: [],
    notes: '7 carpal bones (left). Triquetral not separately meshed in GLB.',
  },
  {
    structureId: 'LEFT_HAND',
    displayName: 'Left Hand',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'First metacarpal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Second metacarpal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Third metacarpal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fourth metacarpal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fifth metacarpal bone.l' },
    ],
    female: [],
    notes: '5 metacarpal bones (left). Phalanges mapped individually below.',
  },
  {
    structureId: 'LEFT_THUMB',
    displayName: 'Left Thumb',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'First metacarpal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of first finger of hand.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of first finger of hand.l' },
    ],
    female: [],
    notes: '1st metacarpal + proximal + distal phalanx (left).',
  },
  {
    structureId: 'LEFT_INDEX_FINGER',
    displayName: 'Left Index Finger',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Second metacarpal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of second finger of hand.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Middle phalanx of second finger of hand.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of second finger of hand.l' },
    ],
    female: [],
    notes: '2nd metacarpal + proximal + middle + distal phalanx (left).',
  },
  {
    structureId: 'LEFT_MIDDLE_FINGER',
    displayName: 'Left Middle Finger',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Third metacarpal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of third finger of hand.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Middle phalanx of third finger of hand.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of third finger of hand.l' },
    ],
    female: [],
    notes: '3rd metacarpal + proximal + middle + distal phalanx (left).',
  },
  {
    structureId: 'LEFT_RING_FINGER',
    displayName: 'Left Ring Finger',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Fourth metacarpal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of fourth finger of hand.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Middle phalanx of fourth finger of hand.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of fourth finger of hand.l' },
    ],
    female: [],
    notes: '4th metacarpal + proximal + middle + distal phalanx (left).',
  },
  {
    structureId: 'LEFT_LITTLE_FINGER',
    displayName: 'Left Little Finger',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Fifth metacarpal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of fifth finger of hand.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Middle phalanx of fifth finger of hand.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of fifth finger of hand.l' },
    ],
    female: [],
    notes: '5th metacarpal + proximal + middle + distal phalanx (left).',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // RIGHT ARM
  // ══════════════════════════════════════════════════════════════════════════

  {
    structureId: 'RIGHT_SHOULDER',
    displayName: 'Right Shoulder',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Clavicle.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Scapula.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Humerus.r' },
    ],
    female: [],
    notes: 'Clavicle + scapula + humerus (right).',
  },
  {
    structureId: 'RIGHT_UPPER_ARM',
    displayName: 'Right Upper Arm',
    mappingType: 'DIRECT',
    male: [{ glbFile: 'skeletal_male.glb', nodeName: 'Humerus.r' }],
    female: [],
    notes: 'Single bone: right humerus.',
  },
  {
    structureId: 'RIGHT_ELBOW',
    displayName: 'Right Elbow',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Humerus.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Radius.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Ulna.r' },
    ],
    female: [],
    notes: 'Humerus + radius + ulna junction (right).',
  },
  {
    structureId: 'RIGHT_FOREARM',
    displayName: 'Right Forearm',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Radius.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Ulna.r' },
    ],
    female: [],
    notes: 'Radius + ulna (right).',
  },
  {
    structureId: 'RIGHT_WRIST',
    displayName: 'Right Wrist',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Scaphoid bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Lunate bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Pisiform bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Trapezium bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Trapezoid bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Capitate bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Hamate bone.r' },
    ],
    female: [],
    notes: '7 carpal bones (right). Triquetral not separately meshed in GLB.',
  },
  {
    structureId: 'RIGHT_HAND',
    displayName: 'Right Hand',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'First metacarpal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Second metacarpal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Third metacarpal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fourth metacarpal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fifth metacarpal bone.r' },
    ],
    female: [],
    notes: '5 metacarpal bones (right).',
  },
  {
    structureId: 'RIGHT_THUMB',
    displayName: 'Right Thumb',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'First metacarpal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of first finger of hand.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of first finger of hand.r' },
    ],
    female: [],
    notes: '1st metacarpal + proximal + distal phalanx (right).',
  },
  {
    structureId: 'RIGHT_INDEX_FINGER',
    displayName: 'Right Index Finger',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Second metacarpal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of second finger of hand.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Middle phalanx of second finger of hand.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of second finger of hand.r' },
    ],
    female: [],
    notes: '2nd metacarpal + proximal + middle + distal phalanx (right).',
  },
  {
    structureId: 'RIGHT_MIDDLE_FINGER',
    displayName: 'Right Middle Finger',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Third metacarpal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of third finger of hand.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Middle phalanx of third finger of hand.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of third finger of hand.r' },
    ],
    female: [],
    notes: '3rd metacarpal + proximal + middle + distal phalanx (right).',
  },
  {
    structureId: 'RIGHT_RING_FINGER',
    displayName: 'Right Ring Finger',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Fourth metacarpal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of fourth finger of hand.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Middle phalanx of fourth finger of hand.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of fourth finger of hand.r' },
    ],
    female: [],
    notes: '4th metacarpal + proximal + middle + distal phalanx (right).',
  },
  {
    structureId: 'RIGHT_LITTLE_FINGER',
    displayName: 'Right Little Finger',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Fifth metacarpal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of fifth finger of hand.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Middle phalanx of fifth finger of hand.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of fifth finger of hand.r' },
    ],
    female: [],
    notes: '5th metacarpal + proximal + middle + distal phalanx (right).',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // LEFT LEG
  // ══════════════════════════════════════════════════════════════════════════

  {
    structureId: 'LEFT_HIP',
    displayName: 'Left Hip',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Femur.l' },
    ],
    female: [
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_ilium_compact_bone_L' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_ischium_compact_bone_L' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_pubis_compact_bone_L' },
    ],
    notes: 'Male: femur only (no "Os coxae" node). Female: ilium + ischium + pubis (left).',
  },
  {
    structureId: 'LEFT_THIGH',
    displayName: 'Left Thigh',
    mappingType: 'DIRECT',
    male: [{ glbFile: 'skeletal_male.glb', nodeName: 'Femur.l' }],
    female: [],
    notes: 'Single bone: left femur.',
  },
  {
    structureId: 'LEFT_KNEE',
    displayName: 'Left Knee',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Femur.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Tibia.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fibula.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Patella.l' },
    ],
    female: [],
    notes: 'Femur + tibia + fibula + patella junction (left).',
  },
  {
    structureId: 'LEFT_CALF',
    displayName: 'Left Calf',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Tibia.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fibula.l' },
    ],
    female: [],
    notes: 'Tibia + fibula (left).',
  },
  {
    structureId: 'LEFT_ANKLE',
    displayName: 'Left Ankle',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Tibia.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fibula.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Talus.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Calcaneus.l' },
    ],
    female: [],
    notes: 'Tibia + fibula + talus + calcaneus (left).',
  },
  {
    structureId: 'LEFT_FOOT',
    displayName: 'Left Foot',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Talus.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Calcaneus.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Navicular bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Cuboid bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Medial cuneiform bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Intermediate cuneiform bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Lateral cuneiform bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'First metatarsal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Second metatarsal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Third metatarsal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fourth metatarsal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fifth metatarsal bone.l' },
    ],
    female: [],
    notes: 'Tarsals + metatarsals (left). Toes mapped individually below.',
  },
  {
    structureId: 'LEFT_BIG_TOE',
    displayName: 'Left Big Toe',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'First metatarsal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of first finger of foot.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of first finger of foot.l' },
    ],
    female: [],
    notes: '1st metatarsal + proximal + distal phalanx (left).',
  },
  {
    structureId: 'LEFT_SECOND_TOE',
    displayName: 'Left Second Toe',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Second metatarsal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of second finger of foot.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Middle phalanx of second finger of foot.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of second finger of foot.l' },
    ],
    female: [],
    notes: '2nd metatarsal + proximal + middle + distal phalanx (left).',
  },
  {
    structureId: 'LEFT_THIRD_TOE',
    displayName: 'Left Third Toe',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Third metatarsal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of third finger of foot.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Middle phalanx of third finger of foot.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of third finger of foot.l' },
    ],
    female: [],
    notes: '3rd metatarsal + proximal + middle + distal phalanx (left).',
  },
  {
    structureId: 'LEFT_FOURTH_TOE',
    displayName: 'Left Fourth Toe',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Fourth metatarsal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of fourth finger of foot.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Middle phalanx of fourth finger of foot.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of fourth finger of foot.l' },
    ],
    female: [],
    notes: '4th metatarsal + proximal + middle + distal phalanx (left).',
  },
  {
    structureId: 'LEFT_LITTLE_TOE',
    displayName: 'Left Little Toe',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Fifth metatarsal bone.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of fifth finger of foot.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Middle phalanx of fifth finger of foot.l' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of fifth finger of foot.l' },
    ],
    female: [],
    notes: '5th metatarsal + proximal + middle + distal phalanx (left).',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // RIGHT LEG
  // ══════════════════════════════════════════════════════════════════════════

  {
    structureId: 'RIGHT_HIP',
    displayName: 'Right Hip',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Femur.r' },
    ],
    female: [
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_ilium_compact_bone_R' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_ischium_compact_bone_R' },
      { glbFile: 'skeletal_female.glb', nodeName: 'VH_F_pubis_compact_bone_R' },
    ],
    notes: 'Male: femur only. Female: ilium + ischium + pubis (right).',
  },
  {
    structureId: 'RIGHT_THIGH',
    displayName: 'Right Thigh',
    mappingType: 'DIRECT',
    male: [{ glbFile: 'skeletal_male.glb', nodeName: 'Femur.r' }],
    female: [],
    notes: 'Single bone: right femur.',
  },
  {
    structureId: 'RIGHT_KNEE',
    displayName: 'Right Knee',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Femur.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Tibia.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fibula.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Patella.r' },
    ],
    female: [],
    notes: 'Femur + tibia + fibula + patella junction (right).',
  },
  {
    structureId: 'RIGHT_CALF',
    displayName: 'Right Calf',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Tibia.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fibula.r' },
    ],
    female: [],
    notes: 'Tibia + fibula (right).',
  },
  {
    structureId: 'RIGHT_ANKLE',
    displayName: 'Right Ankle',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Tibia.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fibula.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Talus.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Calcaneus.r' },
    ],
    female: [],
    notes: 'Tibia + fibula + talus + calcaneus (right).',
  },
  {
    structureId: 'RIGHT_FOOT',
    displayName: 'Right Foot',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Talus.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Calcaneus.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Navicular bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Cuboid bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Medial cuneiform bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Intermediate cuneiform bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Lateral cuneiform bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'First metatarsal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Second metatarsal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Third metatarsal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fourth metatarsal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Fifth metatarsal bone.r' },
    ],
    female: [],
    notes: 'Tarsals + metatarsals (right).',
  },
  {
    structureId: 'RIGHT_BIG_TOE',
    displayName: 'Right Big Toe',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'First metatarsal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of first finger of foot.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of first finger of foot.r' },
    ],
    female: [],
    notes: '1st metatarsal + proximal + distal phalanx (right).',
  },
  {
    structureId: 'RIGHT_SECOND_TOE',
    displayName: 'Right Second Toe',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Second metatarsal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of second finger of foot.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Middle phalanx of second finger of foot.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of second finger of foot.r' },
    ],
    female: [],
    notes: '2nd metatarsal + proximal + middle + distal phalanx (right).',
  },
  {
    structureId: 'RIGHT_THIRD_TOE',
    displayName: 'Right Third Toe',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Third metatarsal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of third finger of foot.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Middle phalanx of third finger of foot.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of third finger of foot.r' },
    ],
    female: [],
    notes: '3rd metatarsal + proximal + middle + distal phalanx (right).',
  },
  {
    structureId: 'RIGHT_FOURTH_TOE',
    displayName: 'Right Fourth Toe',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Fourth metatarsal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of fourth finger of foot.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Middle phalanx of fourth finger of foot.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of fourth finger of foot.r' },
    ],
    female: [],
    notes: '4th metatarsal + proximal + middle + distal phalanx (right).',
  },
  {
    structureId: 'RIGHT_LITTLE_TOE',
    displayName: 'Right Little Toe',
    mappingType: 'COMPOSITE',
    male: [
      { glbFile: 'skeletal_male.glb', nodeName: 'Fifth metatarsal bone.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Proximal phalanx of fifth finger of foot.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Middle phalanx of fifth finger of foot.r' },
      { glbFile: 'skeletal_male.glb', nodeName: 'Distal phalanx of fifth finger of foot.r' },
    ],
    female: [],
    notes: '5th metatarsal + proximal + middle + distal phalanx (right).',
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Map structure_id → StructureMapping for O(1) lookups. */
const _mappingById = new Map<string, StructureMapping>(
  ANATOMY_MAPPINGS.map((m) => [m.structureId, m])
);

/**
 * Get the mapping for a HealthGraph structure_id.
 * Returns undefined if the structure has no mapping entry.
 */
export function getMapping(structureId: string): StructureMapping | undefined {
  return _mappingById.get(structureId);
}

/**
 * Get all unique GLB files needed for a given gender.
 * Returns file names only (not full paths).
 */
export function getRequiredGlbFiles(
  gender: 'male' | 'female'
): string[] {
  const files = new Set<string>();
  for (const mapping of ANATOMY_MAPPINGS) {
    const refs = gender === 'male' ? mapping.male : mapping.female;
    for (const ref of refs) {
      files.add(ref.glbFile);
    }
  }
  return Array.from(files);
}

/**
 * Get all node names that belong to a given structure for a given gender.
 * Returns an array of { glbFile, nodeName } pairs.
 */
export function getStructureNodes(
  structureId: string,
  gender: 'male' | 'female'
): AnatriaNodeRef[] {
  const mapping = getMapping(structureId);
  if (!mapping) return [];
  return gender === 'male' ? mapping.male : mapping.female;
}

/**
 * Build a reverse lookup: nodeName → structureId for a given gender.
 * Used for click/tap handling on 3D meshes.
 */
export function buildNodeToStructureMap(
  gender: 'male' | 'female'
): Map<string, string> {
  const map = new Map<string, string>();
  for (const mapping of ANATOMY_MAPPINGS) {
    const refs = gender === 'male' ? mapping.male : mapping.female;
    for (const ref of refs) {
      // First-mapped structure wins if a node appears in multiple mappings
      if (!map.has(ref.nodeName)) {
        map.set(ref.nodeName, mapping.structureId);
      }
    }
  }
  return map;
}

/**
 * Get all structure IDs that map to a given node.
 * Some nodes may appear in multiple structures (e.g., femur appears in thigh AND knee).
 */
export function getStructuresForNode(
  nodeName: string,
  gender: 'male' | 'female'
): string[] {
  const structures: string[] = [];
  for (const mapping of ANATOMY_MAPPINGS) {
    const refs = gender === 'male' ? mapping.male : mapping.female;
    if (refs.some((r) => r.nodeName === nodeName)) {
      structures.push(mapping.structureId);
    }
  }
  return structures;
}

/**
 * Get the MVP structure list — structures that should be shown in the
 * 3D Body viewer sidebar for quick selection.
 */
export const MVP_STRUCTURE_IDS: string[] = [
  // Core organs
  'HEART',
  'LEFT_LUNG',
  'RIGHT_LUNG',
  'LIVER',
  'STOMACH',
  'PANCREAS',
  'SPLEEN',
  'LEFT_KIDNEY',
  'RIGHT_KIDNEY',
  'BLADDER',
  // Reproductive
  'UTERUS',
  'LEFT_OVARY',
  'RIGHT_OVARY',
  'PROSTATE',
  // Spine
  'CERVICAL_SPINE',
  'THORACIC_SPINE',
  'LUMBAR_SPINE',
  // Extremities (sample)
  'LEFT_HAND',
  'RIGHT_HAND',
  'LEFT_KNEE',
  'RIGHT_KNEE',
  'LEFT_FOOT',
  'RIGHT_FOOT',
  // Face
  'JAW',
  'TONGUE',
  // Neck
  'THYROID',
  // Digestive
  'APPENDIX',
  'ESOPHAGUS',
];

// ---------------------------------------------------------------------------
// Summary statistics (for verification report)
// ---------------------------------------------------------------------------

export const MAPPING_SUMMARY = (() => {
  let direct = 0;
  let composite = 0;
  let equivalent = 0;
  let unavailable = 0;
  let maleOnly = 0;
  let femaleOnly = 0;

  for (const m of ANATOMY_MAPPINGS) {
    switch (m.mappingType) {
      case 'DIRECT': direct++; break;
      case 'COMPOSITE': composite++; break;
      case 'EQUIVALENT': equivalent++; break;
      case 'UNAVAILABLE': unavailable++; break;
    }
    if (m.male.length > 0 && m.female.length === 0) maleOnly++;
    if (m.female.length > 0 && m.male.length === 0) femaleOnly++;
  }

  return {
    total: ANATOMY_MAPPINGS.length,
    direct,
    composite,
    equivalent,
    unavailable,
    maleOnly,
    femaleOnly,
    maleGlbFiles: getRequiredGlbFiles('male'),
    femaleGlbFiles: getRequiredGlbFiles('female'),
  };
})();
