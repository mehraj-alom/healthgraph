#!/usr/bin/env python3
"""
Canonical PostgreSQL seed for anatomical_structures.

Idempotent — safe to run repeatedly without creating duplicates.
Uses session.merge() (upsert on primary key) so existing rows are
updated in place while new rows are inserted.

Hierarchy
─────────
FULL_BODY
├── MUSCULAR_SYSTEM
├── VASCULAR_SYSTEM
├── LYMPHATIC_SYSTEM
├── NERVOUS_SYSTEM
├── SKELETAL_SYSTEM
├── HEAD
│   ├── BRAIN
│   ├── FACE
│   │   ├── LEFT_EYE
│   │   ├── RIGHT_EYE
│   │   ├── NOSE
│   │   ├── MOUTH
│   │   │   ├── TEETH
│   │   │   ├── TONGUE
│   │   │   └── GUMS
│   │   ├── LEFT_EAR
│   │   └── RIGHT_EAR
│   └── JAW
├── NECK
│   ├── THYROID
│   └── THROAT
├── CHEST
│   ├── HEART
│   ├── LEFT_LUNG
│   ├── RIGHT_LUNG
│   ├── ESOPHAGUS
│   └── RIB_CAGE
├── ABDOMEN
│   ├── LIVER
│   ├── GALLBLADDER
│   ├── STOMACH
│   ├── PANCREAS
│   ├── SMALL_INTESTINE
│   ├── LARGE_INTESTINE
│   ├── APPENDIX
│   ├── SPLEEN
│   ├── LEFT_KIDNEY
│   └── RIGHT_KIDNEY
├── PELVIS
│   ├── BLADDER
│   ├── RECTUM
│   ├── UTERUS
│   ├── LEFT_OVARY
│   ├── RIGHT_OVARY
│   └── PROSTATE
├── SPINE
│   ├── CERVICAL_SPINE
│   ├── THORACIC_SPINE
│   └── LUMBAR_SPINE
├── LEFT_ARM
│   ├── LEFT_SHOULDER
│   ├── LEFT_UPPER_ARM
│   ├── LEFT_ELBOW
│   ├── LEFT_FOREARM
│   ├── LEFT_WRIST
│   └── LEFT_HAND
│       ├── LEFT_THUMB
│       ├── LEFT_INDEX_FINGER
│       ├── LEFT_MIDDLE_FINGER
│       ├── LEFT_RING_FINGER
│       └── LEFT_LITTLE_FINGER
├── RIGHT_ARM
│   ├── RIGHT_SHOULDER
│   ├── RIGHT_UPPER_ARM
│   ├── RIGHT_ELBOW
│   ├── RIGHT_FOREARM
│   ├── RIGHT_WRIST
│   └── RIGHT_HAND
│       ├── RIGHT_THUMB
│       ├── RIGHT_INDEX_FINGER
│       ├── RIGHT_MIDDLE_FINGER
│       ├── RIGHT_RING_FINGER
│       └── RIGHT_LITTLE_FINGER
├── LEFT_LEG
│   ├── LEFT_HIP
│   ├── LEFT_THIGH
│   ├── LEFT_KNEE
│   ├── LEFT_CALF
│   ├── LEFT_ANKLE
│   └── LEFT_FOOT
│       ├── LEFT_BIG_TOE
│       ├── LEFT_SECOND_TOE
│       ├── LEFT_THIRD_TOE
│       ├── LEFT_FOURTH_TOE
│       └── LEFT_LITTLE_TOE
└── RIGHT_LEG
    ├── RIGHT_HIP
    ├── RIGHT_THIGH
    ├── RIGHT_KNEE
    ├── RIGHT_CALF
    ├── RIGHT_ANKLE
    └── RIGHT_FOOT
        ├── RIGHT_BIG_TOE
        ├── RIGHT_SECOND_TOE
        ├── RIGHT_THIRD_TOE
        ├── RIGHT_FOURTH_TOE
        └── RIGHT_LITTLE_TOE

Usage (inside docker):
    docker compose exec api python -m scripts.seed_anatomical_structures

Or directly:
    PYTHONPATH=. python scripts/seed_anatomical_structures.py

⚠️  MESH MAPPING NOTE
    mesh_node_name values are canonical placeholders matching structure IDs.
    These MUST be verified against the actual GLB/GLTF 3D model node names
    before production deployment.  Discrepancies will cause silent rendering
    failures in the 3D body viewer.
"""

from sqlalchemy import select, func

from core.db import SessionLocal
from models.anatomy import AnatomicalStructure, StructureCategory

# ---------------------------------------------------------------------------
# Static seed data
# ---------------------------------------------------------------------------
# (structure_id, display_name, category, parent_id, mesh_node_name, is_internal_organ)

SEED_DATA = [
    # ── Root ──────────────────────────────────────────────────────────────
    ("FULL_BODY", "Full Body", StructureCategory.ROOT, None, "FULL_BODY", False),

    # ── Organ systems (direct children of FULL_BODY) ─────────────────────
    ("MUSCULAR_SYSTEM", "Muscular System", StructureCategory.BODY_REGION, "FULL_BODY", "MUSCULAR_SYSTEM", False),
    ("VASCULAR_SYSTEM", "Vascular System", StructureCategory.VASCULAR_SYSTEM, "FULL_BODY", "VASCULAR_SYSTEM", False),
    ("LYMPHATIC_SYSTEM", "Lymphatic System", StructureCategory.BODY_REGION, "FULL_BODY", "LYMPHATIC_SYSTEM", False),
    ("NERVOUS_SYSTEM", "Nervous System", StructureCategory.BODY_REGION, "FULL_BODY", "NERVOUS_SYSTEM", False),
    ("SKELETAL_SYSTEM", "Skeletal System", StructureCategory.BODY_REGION, "FULL_BODY", "SKELETAL_SYSTEM", False),

    # ── Body regions (direct children of FULL_BODY) ──────────────────────
    ("HEAD", "Head", StructureCategory.BODY_REGION, "FULL_BODY", "HEAD", False),
    ("NECK", "Neck", StructureCategory.BODY_REGION, "FULL_BODY", "NECK", False),
    ("CHEST", "Chest", StructureCategory.BODY_REGION, "FULL_BODY", "CHEST", False),
    ("ABDOMEN", "Abdomen", StructureCategory.BODY_REGION, "FULL_BODY", "ABDOMEN", False),
    ("PELVIS", "Pelvis", StructureCategory.BODY_REGION, "FULL_BODY", "PELVIS", False),
    ("SPINE", "Spine", StructureCategory.BODY_REGION, "FULL_BODY", "SPINE", False),
    ("LEFT_ARM", "Left Arm", StructureCategory.BODY_REGION, "FULL_BODY", "LEFT_ARM", False),
    ("RIGHT_ARM", "Right Arm", StructureCategory.BODY_REGION, "FULL_BODY", "RIGHT_ARM", False),
    ("LEFT_LEG", "Left Leg", StructureCategory.BODY_REGION, "FULL_BODY", "LEFT_LEG", False),
    ("RIGHT_LEG", "Right Leg", StructureCategory.BODY_REGION, "FULL_BODY", "RIGHT_LEG", False),

    # ══════════════════════════════════════════════════════════════════════
    # HEAD
    # ══════════════════════════════════════════════════════════════════════
    ("BRAIN", "Brain", StructureCategory.ORGAN, "HEAD", "BRAIN", True),

    # ── FACE ─────────────────────────────────────────────────────────────
    ("FACE", "Face", StructureCategory.SUB_REGION, "HEAD", "FACE", False),
    ("LEFT_EYE", "Left Eye", StructureCategory.ORGAN, "FACE", "LEFT_EYE", True),
    ("RIGHT_EYE", "Right Eye", StructureCategory.ORGAN, "FACE", "RIGHT_EYE", True),
    ("NOSE", "Nose", StructureCategory.ORGAN, "FACE", "NOSE", True),
    ("MOUTH", "Mouth", StructureCategory.SUB_REGION, "FACE", "MOUTH", True),
    ("TEETH", "Teeth", StructureCategory.BONE_JOINT, "MOUTH", "TEETH", False),
    ("TONGUE", "Tongue", StructureCategory.ORGAN, "MOUTH", "TONGUE", True),
    ("GUMS", "Gums", StructureCategory.ORGAN, "MOUTH", "GUMS", True),
    ("LEFT_EAR", "Left Ear", StructureCategory.ORGAN, "FACE", "LEFT_EAR", True),
    ("RIGHT_EAR", "Right Ear", StructureCategory.ORGAN, "FACE", "RIGHT_EAR", True),

    # ── JAW ──────────────────────────────────────────────────────────────
    ("JAW", "Jaw", StructureCategory.BONE_JOINT, "HEAD", "JAW", False),

    # ══════════════════════════════════════════════════════════════════════
    # NECK
    # ══════════════════════════════════════════════════════════════════════
    ("THYROID", "Thyroid", StructureCategory.ORGAN, "NECK", "THYROID", True),
    ("THROAT", "Throat", StructureCategory.SUB_REGION, "NECK", "THROAT", True),

    # ══════════════════════════════════════════════════════════════════════
    # CHEST
    # ══════════════════════════════════════════════════════════════════════
    ("HEART", "Heart", StructureCategory.ORGAN, "CHEST", "HEART", True),
    ("LEFT_LUNG", "Left Lung", StructureCategory.ORGAN, "CHEST", "LEFT_LUNG", True),
    ("RIGHT_LUNG", "Right Lung", StructureCategory.ORGAN, "CHEST", "RIGHT_LUNG", True),
    ("ESOPHAGUS", "Esophagus", StructureCategory.ORGAN, "CHEST", "ESOPHAGUS", True),
    ("RIB_CAGE", "Rib Cage", StructureCategory.BONE_JOINT, "CHEST", "RIB_CAGE", False),

    # ══════════════════════════════════════════════════════════════════════
    # ABDOMEN
    # ══════════════════════════════════════════════════════════════════════
    ("LIVER", "Liver", StructureCategory.ORGAN, "ABDOMEN", "LIVER", True),
    ("GALLBLADDER", "Gallbladder", StructureCategory.ORGAN, "ABDOMEN", "GALLBLADDER", True),
    ("STOMACH", "Stomach", StructureCategory.ORGAN, "ABDOMEN", "STOMACH", True),
    ("PANCREAS", "Pancreas", StructureCategory.ORGAN, "ABDOMEN", "PANCREAS", True),
    ("SMALL_INTESTINE", "Small Intestine", StructureCategory.ORGAN, "ABDOMEN", "SMALL_INTESTINE", True),
    ("LARGE_INTESTINE", "Large Intestine", StructureCategory.ORGAN, "ABDOMEN", "LARGE_INTESTINE", True),
    ("APPENDIX", "Appendix", StructureCategory.ORGAN, "ABDOMEN", "APPENDIX", True),
    ("SPLEEN", "Spleen", StructureCategory.ORGAN, "ABDOMEN", "SPLEEN", True),
    ("LEFT_KIDNEY", "Left Kidney", StructureCategory.ORGAN, "ABDOMEN", "LEFT_KIDNEY", True),
    ("RIGHT_KIDNEY", "Right Kidney", StructureCategory.ORGAN, "ABDOMEN", "RIGHT_KIDNEY", True),

    # ══════════════════════════════════════════════════════════════════════
    # PELVIS
    # ══════════════════════════════════════════════════════════════════════
    ("BLADDER", "Bladder", StructureCategory.ORGAN, "PELVIS", "BLADDER", True),
    ("RECTUM", "Rectum", StructureCategory.ORGAN, "PELVIS", "RECTUM", True),
    ("UTERUS", "Uterus", StructureCategory.ORGAN, "PELVIS", "UTERUS", True),
    ("LEFT_OVARY", "Left Ovary", StructureCategory.ORGAN, "PELVIS", "LEFT_OVARY", True),
    ("RIGHT_OVARY", "Right Ovary", StructureCategory.ORGAN, "PELVIS", "RIGHT_OVARY", True),
    ("PROSTATE", "Prostate", StructureCategory.ORGAN, "PELVIS", "PROSTATE", True),

    # ══════════════════════════════════════════════════════════════════════
    # SPINE
    # ══════════════════════════════════════════════════════════════════════
    ("CERVICAL_SPINE", "Cervical Spine", StructureCategory.BONE_JOINT, "SPINE", "CERVICAL_SPINE", False),
    ("THORACIC_SPINE", "Thoracic Spine", StructureCategory.BONE_JOINT, "SPINE", "THORACIC_SPINE", False),
    ("LUMBAR_SPINE", "Lumbar Spine", StructureCategory.BONE_JOINT, "SPINE", "LUMBAR_SPINE", False),

    # ══════════════════════════════════════════════════════════════════════
    # LEFT ARM
    # ══════════════════════════════════════════════════════════════════════
    ("LEFT_SHOULDER", "Left Shoulder", StructureCategory.BONE_JOINT, "LEFT_ARM", "LEFT_SHOULDER", False),
    ("LEFT_UPPER_ARM", "Left Upper Arm", StructureCategory.SUB_REGION, "LEFT_ARM", "LEFT_UPPER_ARM", False),
    ("LEFT_ELBOW", "Left Elbow", StructureCategory.BONE_JOINT, "LEFT_ARM", "LEFT_ELBOW", False),
    ("LEFT_FOREARM", "Left Forearm", StructureCategory.SUB_REGION, "LEFT_ARM", "LEFT_FOREARM", False),
    ("LEFT_WRIST", "Left Wrist", StructureCategory.BONE_JOINT, "LEFT_ARM", "LEFT_WRIST", False),
    ("LEFT_HAND", "Left Hand", StructureCategory.SUB_REGION, "LEFT_ARM", "LEFT_HAND", False),
    ("LEFT_THUMB", "Left Thumb", StructureCategory.BONE_JOINT, "LEFT_HAND", "LEFT_THUMB", False),
    ("LEFT_INDEX_FINGER", "Left Index Finger", StructureCategory.BONE_JOINT, "LEFT_HAND", "LEFT_INDEX_FINGER", False),
    ("LEFT_MIDDLE_FINGER", "Left Middle Finger", StructureCategory.BONE_JOINT, "LEFT_HAND", "LEFT_MIDDLE_FINGER", False),
    ("LEFT_RING_FINGER", "Left Ring Finger", StructureCategory.BONE_JOINT, "LEFT_HAND", "LEFT_RING_FINGER", False),
    ("LEFT_LITTLE_FINGER", "Left Little Finger", StructureCategory.BONE_JOINT, "LEFT_HAND", "LEFT_LITTLE_FINGER", False),

    # ══════════════════════════════════════════════════════════════════════
    # RIGHT ARM
    # ══════════════════════════════════════════════════════════════════════
    ("RIGHT_SHOULDER", "Right Shoulder", StructureCategory.BONE_JOINT, "RIGHT_ARM", "RIGHT_SHOULDER", False),
    ("RIGHT_UPPER_ARM", "Right Upper Arm", StructureCategory.SUB_REGION, "RIGHT_ARM", "RIGHT_UPPER_ARM", False),
    ("RIGHT_ELBOW", "Right Elbow", StructureCategory.BONE_JOINT, "RIGHT_ARM", "RIGHT_ELBOW", False),
    ("RIGHT_FOREARM", "Right Forearm", StructureCategory.SUB_REGION, "RIGHT_ARM", "RIGHT_FOREARM", False),
    ("RIGHT_WRIST", "Right Wrist", StructureCategory.BONE_JOINT, "RIGHT_ARM", "RIGHT_WRIST", False),
    ("RIGHT_HAND", "Right Hand", StructureCategory.SUB_REGION, "RIGHT_ARM", "RIGHT_HAND", False),
    ("RIGHT_THUMB", "Right Thumb", StructureCategory.BONE_JOINT, "RIGHT_HAND", "RIGHT_THUMB", False),
    ("RIGHT_INDEX_FINGER", "Right Index Finger", StructureCategory.BONE_JOINT, "RIGHT_HAND", "RIGHT_INDEX_FINGER", False),
    ("RIGHT_MIDDLE_FINGER", "Right Middle Finger", StructureCategory.BONE_JOINT, "RIGHT_HAND", "RIGHT_MIDDLE_FINGER", False),
    ("RIGHT_RING_FINGER", "Right Ring Finger", StructureCategory.BONE_JOINT, "RIGHT_HAND", "RIGHT_RING_FINGER", False),
    ("RIGHT_LITTLE_FINGER", "Right Little Finger", StructureCategory.BONE_JOINT, "RIGHT_HAND", "RIGHT_LITTLE_FINGER", False),

    # ══════════════════════════════════════════════════════════════════════
    # LEFT LEG
    # ══════════════════════════════════════════════════════════════════════
    ("LEFT_HIP", "Left Hip", StructureCategory.BONE_JOINT, "LEFT_LEG", "LEFT_HIP", False),
    ("LEFT_THIGH", "Left Thigh", StructureCategory.SUB_REGION, "LEFT_LEG", "LEFT_THIGH", False),
    ("LEFT_KNEE", "Left Knee", StructureCategory.BONE_JOINT, "LEFT_LEG", "LEFT_KNEE", False),
    ("LEFT_CALF", "Left Calf", StructureCategory.SUB_REGION, "LEFT_LEG", "LEFT_CALF", False),
    ("LEFT_ANKLE", "Left Ankle", StructureCategory.BONE_JOINT, "LEFT_LEG", "LEFT_ANKLE", False),
    ("LEFT_FOOT", "Left Foot", StructureCategory.SUB_REGION, "LEFT_LEG", "LEFT_FOOT", False),
    ("LEFT_BIG_TOE", "Left Big Toe", StructureCategory.BONE_JOINT, "LEFT_FOOT", "LEFT_BIG_TOE", False),
    ("LEFT_SECOND_TOE", "Left Second Toe", StructureCategory.BONE_JOINT, "LEFT_FOOT", "LEFT_SECOND_TOE", False),
    ("LEFT_THIRD_TOE", "Left Third Toe", StructureCategory.BONE_JOINT, "LEFT_FOOT", "LEFT_THIRD_TOE", False),
    ("LEFT_FOURTH_TOE", "Left Fourth Toe", StructureCategory.BONE_JOINT, "LEFT_FOOT", "LEFT_FOURTH_TOE", False),
    ("LEFT_LITTLE_TOE", "Left Little Toe", StructureCategory.BONE_JOINT, "LEFT_FOOT", "LEFT_LITTLE_TOE", False),

    # ══════════════════════════════════════════════════════════════════════
    # RIGHT LEG
    # ══════════════════════════════════════════════════════════════════════
    ("RIGHT_HIP", "Right Hip", StructureCategory.BONE_JOINT, "RIGHT_LEG", "RIGHT_HIP", False),
    ("RIGHT_THIGH", "Right Thigh", StructureCategory.SUB_REGION, "RIGHT_LEG", "RIGHT_THIGH", False),
    ("RIGHT_KNEE", "Right Knee", StructureCategory.BONE_JOINT, "RIGHT_LEG", "RIGHT_KNEE", False),
    ("RIGHT_CALF", "Right Calf", StructureCategory.SUB_REGION, "RIGHT_LEG", "RIGHT_CALF", False),
    ("RIGHT_ANKLE", "Right Ankle", StructureCategory.BONE_JOINT, "RIGHT_LEG", "RIGHT_ANKLE", False),
    ("RIGHT_FOOT", "Right Foot", StructureCategory.SUB_REGION, "RIGHT_LEG", "RIGHT_FOOT", False),
    ("RIGHT_BIG_TOE", "Right Big Toe", StructureCategory.BONE_JOINT, "RIGHT_FOOT", "RIGHT_BIG_TOE", False),
    ("RIGHT_SECOND_TOE", "Right Second Toe", StructureCategory.BONE_JOINT, "RIGHT_FOOT", "RIGHT_SECOND_TOE", False),
    ("RIGHT_THIRD_TOE", "Right Third Toe", StructureCategory.BONE_JOINT, "RIGHT_FOOT", "RIGHT_THIRD_TOE", False),
    ("RIGHT_FOURTH_TOE", "Right Fourth Toe", StructureCategory.BONE_JOINT, "RIGHT_FOOT", "RIGHT_FOURTH_TOE", False),
    ("RIGHT_LITTLE_TOE", "Right Little Toe", StructureCategory.BONE_JOINT, "RIGHT_FOOT", "RIGHT_LITTLE_TOE", False),
]

# Constants applied to every record
MESH_ASSET_ID = "human_body_v1"
MESH_VERSION  = 1

# ── SNOMED CT Concept IDs ──────────────────────────────────────────────────
# Maps structure_id → SNOMED CT identifier.
# Used by extraction_mapper._resolve_structure_id() to link OCR-extracted
# medical concepts (which carry SNOMED/LOINC codes) to anatomical structures.
#
# Only body-region and common organ structures are mapped here.
# Internal bones/joints are not individually SNOMED-mapped because clinical
# findings rarely reference them at that granularity.
SNOMED_MAP: dict[str, str] = {
    # Body regions
    "HEAD":      "818981005",   # Head structure (body region)
    "NECK":      "45048000",    # Neck structure
    "CHEST":     "51185008",    # Thorax structure
    "ABDOMEN":   "818982003",   # Abdominal cavity
    "PELVIS":    "129103003",   # Pelvis structure
    "SPINE":     "422587006",   # Spinal column
    "LEFT_ARM":  "40983000",    # Left upper limb
    "RIGHT_ARM": "72693000",    # Right upper limb
    "LEFT_LEG":  "61685007",    # Left lower limb
    "RIGHT_LEG": "30021000",    # Right lower limb
    # Chest sub-structures
    "HEART":     "80891009",    # Heart structure
    "LEFT_LUNG":  "240488003",  # Left lung
    "RIGHT_LUNG": "373875006",  # Right lung
    "RIB_CAGE":  "41695006",    # Rib cage
    "ESOPHAGUS": "32849002",    # Esophagus
    # Abdomen sub-structures
    "LIVER":     "361267004",   # Liver
    "STOMACH":   "36997003",    # Stomach
    "SPLEEN":    "78960004",    # Spleen
    "PANCREAS":  "15776005",    # Pancreas
    "LEFT_KIDNEY":  "72318003", # Left kidney
    "RIGHT_KIDNEY": "32841005", # Right kidney
    # Head sub-structures
    "BRAIN":     "127295002",   # Cerebral structure
    "JAW":       "59539008",    # Mandible
    # Neck sub-structures
    "THYROID":   "181960002",   # Thyroid gland
    "THROAT":    "49757009",    # Pharyngeal structure
}


# ---------------------------------------------------------------------------
# Hierarchy validation
# ---------------------------------------------------------------------------

def _validate_hierarchy(seed_data: list[tuple]) -> list[str]:
    """Return a list of validation error strings. Empty list means valid."""
    errors: list[str] = []
    ids = {row[0] for row in seed_data}
    parents = {row[3] for row in seed_data if row[3] is not None}
    children_map: dict[str | None, list[str]] = {}
    for row in seed_data:
        children_map.setdefault(row[3], []).append(row[0])

    # 1. No orphaned structures — every parent_id must exist or be None
    for sid, _, _, parent_id, *_ in seed_data:
        if parent_id is not None and parent_id not in ids:
            errors.append(f"ORPHAN: {sid} references non-existent parent {parent_id}")

    # 2. Exactly one ROOT
    roots = [row[0] for row in seed_data if row[1] == StructureCategory.ROOT
             or (hasattr(row[2], "value") and row[2] == StructureCategory.ROOT)]
    # More robust: check the category field (index 2)
    roots = [row[0] for row in seed_data if row[2] == StructureCategory.ROOT]
    if len(roots) != 1:
        errors.append(f"ROOT count: expected 1, got {len(roots)} ({roots})")

    # 3. FULL_BODY must be the root
    if "FULL_BODY" not in roots:
        errors.append("FULL_BODY is not the ROOT structure")

    # 4. FULL_BODY parent must be None
    full_body = next((row for row in seed_data if row[0] == "FULL_BODY"), None)
    if full_body and full_body[3] is not None:
        errors.append(f"FULL_BODY parent_id is {full_body[3]}, expected None")

    # 5. mesh_node_name == structure_id for every entry
    for sid, _, _, _, mesh_name, *_ in seed_data:
        if mesh_name != sid:
            errors.append(f"mesh_node_name mismatch: {sid} -> {mesh_name}")

    return errors


def _print_hierarchy(seed_data: list[tuple]) -> None:
    """Print the tree structure to stdout."""
    children_map: dict[str | None, list[str]] = {}
    id_to_name: dict[str, str] = {}
    for row in seed_data:
        children_map.setdefault(row[3], []).append(row[0])
        id_to_name[row[0]] = row[1]

    def _render(node_id: str | None, prefix: str, is_last: bool) -> None:
        children = children_map.get(node_id, [])
        for i, child_id in enumerate(children):
            connector = "└── " if i == len(children) - 1 else "├── "
            extension = "    " if i == len(children) - 1 else "│   "
            display = id_to_name.get(child_id, child_id)
            print(f"{prefix}{connector}{child_id} ({display})")
            _render(child_id, prefix + extension, i == len(children) - 1)

    root_children = children_map.get(None, [])
    if len(root_children) == 1:
        root = root_children[0]
        print(f"{root} ({id_to_name.get(root, root)})")
        _render(root, "", True)
    else:
        for child in root_children:
            print(f"{child} ({id_to_name.get(child, child)})")
            _render(child, "", True)


# ---------------------------------------------------------------------------
# Seed logic
# ---------------------------------------------------------------------------

def seed_anatomical_structures() -> None:
    """Upsert the canonical anatomical hierarchy into PostgreSQL."""
    # Pre-flight validation
    validation_errors = _validate_hierarchy(SEED_DATA)
    if validation_errors:
        print("❌  Hierarchy validation FAILED:")
        for err in validation_errors:
            print(f"   • {err}")
        raise SystemExit(1)
    print("✅  Hierarchy validation passed")

    db = SessionLocal()
    created = 0
    updated = 0

    try:
        # Snapshot existing IDs so we can report creates vs updates
        existing_ids: set[str] = set(
            row[0]
            for row in db.execute(select(AnatomicalStructure.structure_id)).all()
        )

        for (
            structure_id,
            display_name,
            category,
            parent_id,
            mesh_node_name,
            is_internal_organ,
        ) in SEED_DATA:
            snomed_code = SNOMED_MAP.get(structure_id)

            if structure_id in existing_ids:
                # Explicit UPDATE — merge() can fail to overwrite NULL
                # snomed_concept_id on existing rows.
                from sqlalchemy import update as sql_update
                db.execute(
                    sql_update(AnatomicalStructure)
                    .where(AnatomicalStructure.structure_id == structure_id)
                    .values(
                        display_name=display_name,
                        category=category,
                        parent_id=parent_id,
                        snomed_concept_id=snomed_code,
                        mesh_asset_id=MESH_ASSET_ID,
                        mesh_node_name=mesh_node_name,
                        mesh_version=MESH_VERSION,
                        is_internal_organ=is_internal_organ,
                    )
                )
                updated += 1
            else:
                structure = AnatomicalStructure(
                    structure_id=structure_id,
                    display_name=display_name,
                    category=category,
                    parent_id=parent_id,
                    snomed_concept_id=snomed_code,
                    mesh_asset_id=MESH_ASSET_ID,
                    mesh_node_name=mesh_node_name,
                    mesh_version=MESH_VERSION,
                    is_internal_organ=is_internal_organ,
                )
                db.add(structure)
                created += 1

        db.commit()
        total = created + updated
        print(
            f"✅  anatomical_structures seed complete — "
            f"created: {created}, updated: {updated}, total: {total}"
        )

    except Exception:
        db.rollback()
        print("❌  Seed failed — transaction rolled back.")
        raise
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Post-seed verification
# ---------------------------------------------------------------------------

def verify_and_print() -> None:
    """Re-read the DB and print counts + hierarchy."""
    db = SessionLocal()
    try:
        rows = db.execute(
            select(
                AnatomicalStructure.structure_id,
                AnatomicalStructure.display_name,
                AnatomicalStructure.category,
                AnatomicalStructure.parent_id,
            ).order_by(AnatomicalStructure.parent_id.nulls_first(), AnatomicalStructure.structure_id)
        ).all()

        total = len(rows)
        print(f"\n📊  Database contains {total} anatomical structures")

        # Rebuild hierarchy from DB rows for printing
        db_data = [(r[0], r[1], r[2], r[3]) for r in rows]
        # We need to add the mesh fields; reconstruct SEED_DATA-like tuples
        # For hierarchy printing we only need id, name, category, parent
        children_map: dict[str | None, list[str]] = {}
        id_to_name: dict[str, str] = {}
        for sid, name, _cat, pid in db_data:
            children_map.setdefault(pid, []).append(sid)
            id_to_name[sid] = name

        def _render(node_id: str | None, prefix: str) -> None:
            children = children_map.get(node_id, [])
            for i, child_id in enumerate(children):
                connector = "└── " if i == len(children) - 1 else "├── "
                extension = "    " if i == len(children) - 1 else "│   "
                display = id_to_name.get(child_id, child_id)
                print(f"{prefix}{connector}{child_id} ({display})")
                _render(child_id, prefix + extension)

        root_children = children_map.get(None, [])
        print("\n🌳  Full hierarchy:")
        for root in root_children:
            print(f"{root} ({id_to_name.get(root, root)})")
            _render(root, "")

    finally:
        db.close()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    seed_anatomical_structures()
    verify_and_print()
