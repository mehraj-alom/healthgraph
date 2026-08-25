from sqlalchemy import select
from models.anatomy import AnatomicalStructure, StructureCategory


FULL_BODY_ID = "FULL_BODY"
FULL_BODY_DISPLAY = "Full Body"
FULL_BODY_MESH = "human_body_v1"
FULL_BODY_MESH_NODE = "HumanBodyRoot"


def seed_full_body(db_session):
    """Ensure the canonical FULL_BODY root structure exists."""
    existing = db_session.execute(
        select(AnatomicalStructure).where(AnatomicalStructure.structure_id == FULL_BODY_ID)
    ).scalar_one_or_none()

    if not existing:
        db_session.add(AnatomicalStructure(
            structure_id=FULL_BODY_ID,
            display_name=FULL_BODY_DISPLAY,
            category=StructureCategory.ROOT,
            parent_id=None,
            mesh_asset_id=FULL_BODY_MESH,
            mesh_node_name=FULL_BODY_MESH_NODE,
            is_internal_organ=False,
        ))
        db_session.commit()


def project_anatomy_hierarchy(db_session, neo4j_driver):
    """
    Reads the canonical hierarchy from PostgreSQL and builds the Neo4j Anatomy Graph.
    """
    seed_full_body(db_session)

    structures = db_session.execute(select(AnatomicalStructure)).scalars().all()
    
    cypher = """
    UNWIND $structures AS struct
    MERGE (node:AnatomicalStructure {id: struct.structure_id})
    SET node.category = struct.category,
        node.display_name = struct.display_name,
        node.is_internal_organ = struct.is_internal_organ,
        node.mesh_asset_id = struct.mesh_asset_id,
        node.snomed_concept_id = struct.snomed_concept_id
        
    WITH struct, node
    WHERE struct.parent_id IS NOT NULL
    
    MERGE (parent:AnatomicalStructure {id: struct.parent_id})
    MERGE (parent)-[:CONTAINS]->(node)
    """
    
    payload = [
        {
            "structure_id": s.structure_id, 
            "category": s.category.value,
            "display_name": s.display_name,
            "parent_id": s.parent_id,
            "is_internal_organ": s.is_internal_organ,
            "mesh_asset_id": s.mesh_asset_id,
            "snomed_concept_id": s.snomed_concept_id
        } 
        for s in structures
    ]
    
    with neo4j_driver.session() as session:
        result = session.run(cypher, structures=payload)
        result.consume()
