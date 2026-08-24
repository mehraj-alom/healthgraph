from langchain_core.tools import tool
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db import SessionLocal
from core.neo4j_client import neo4j_driver
from models.anatomy import AnatomicalStructure

def _get_anatomy_context(structure_id: str, db: Session, driver) -> dict:
    """
    Internal logic: Validates canonical ID in PostgreSQL, then fetches 
    hierarchical context from Neo4j.
    """
    #Strict Validation Barrier (PostgreSQL)
    stmt = select(AnatomicalStructure.structure_id).where(
        AnatomicalStructure.structure_id == structure_id
    )
    valid_id = db.execute(stmt).scalar_one_or_none()
    
    if not valid_id:
        return {
            "error": f"Invalid canonical ID '{structure_id}'. "
                     f"You MUST use resolve_anatomy_id first to get a valid structure_id."
        }

    # Graph Traversal 
    cypher = """
    MATCH (target:AnatomicalStructure {id: $structure_id})
    
    // 1. Traverse UP to find all ancestors
    OPTIONAL MATCH (target)<-[:CONTAINS*1..]-(a:AnatomicalStructure)
    WITH target, collect(DISTINCT {id: a.id, name: a.display_name}) AS ancestors
    
    // 2. Traverse DOWN to find all descendants
    OPTIONAL MATCH (target)-[:CONTAINS*1..]->(d:AnatomicalStructure)
    WITH target, ancestors, collect(DISTINCT {id: d.id, name: d.display_name}) AS descendants
    
    RETURN 
        target.id AS structure_id,
        target.display_name AS display_name,
        target.category AS category,
        [x IN ancestors WHERE x.id IS NOT NULL] AS ancestors,
        [x IN descendants WHERE x.id IS NOT NULL] AS descendants
    """
    
    with driver.session() as session:
        result = session.run(cypher, structure_id=structure_id)
        record = result.single()
        
        if not record:
            # Defensive check: Exists in Postgres but missing from graph projection
            return {"error": f"Anatomy '{structure_id}' found in registry but missing from graph projection."}
            
        return {
            "structure_id": record["structure_id"],
            "display_name": record["display_name"],
            "category": record["category"],
            "ancestors": record["ancestors"],
            "descendants": record["descendants"]
        }

@tool
def get_anatomy_context(structure_id: str) -> dict:
    """
    Provides the hierarchical context of a body part (e.g., what it is part of, 
    and what sub-parts it contains). 
    
    Args:
        structure_id: The canonical ID of the structure (must be strictly resolved first).
    """
    db: Session = SessionLocal()
    try:
        return _get_anatomy_context(structure_id, db, neo4j_driver)
    finally:
        db.close()