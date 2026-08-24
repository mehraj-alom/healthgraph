import uuid
from typing import Dict
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db import SessionLocal
from core.neo4j_client import neo4j_driver
from models.anatomy import AnatomicalStructure

def _get_patient_graph_context(
    patient_id: uuid.UUID, 
    structure_id: str, 
    include_descendants: bool, 
    db: Session, 
    driver
) -> Dict:
    """
    Internal logic: Validates canonical ID, then executes a comprehensive 
    topology and patient-data aggregation query in Neo4j without query fan-out.
    """
    # Strict Validation Barrier (PostgreSQL)
    stmt = select(AnatomicalStructure.structure_id).where(
        AnatomicalStructure.structure_id == structure_id
    )
    valid_id = db.execute(stmt).scalar_one_or_none()
    
    if not valid_id:
        return {"error": f"Invalid canonical ID '{structure_id}'. Use resolve_anatomy_id first."}

    patient_id_str = str(patient_id)
    
    #  Comprehensive Topology & Context Aggregation (Neo4j)
    # Using CALL {} subqueries to aggregate independently and avoid Cartesian fan-out.
    if include_descendants:
        cypher = """
        MATCH (target:AnatomicalStructure {id: $structure_id})
        
        CALL {
            WITH target
            OPTIONAL MATCH (target)<-[:CONTAINS*1..]-(a:AnatomicalStructure)
            RETURN collect(DISTINCT a.id) AS ancestors
        }
        
        CALL {
            WITH target
            OPTIONAL MATCH (target)-[:CONTAINS*1..]->(d:AnatomicalStructure)
            RETURN collect(DISTINCT d.id) AS descendants
        }
        
        CALL {
            WITH target, descendants
            OPTIONAL MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(o:Observation)-[:AFFECTS]->(struct:AnatomicalStructure)
            WHERE struct.id = target.id OR struct.id IN descendants
            RETURN collect(DISTINCT o) AS obs_nodes
        }
        
        CALL {
            WITH obs_nodes
            UNWIND (CASE WHEN size(obs_nodes) > 0 THEN obs_nodes ELSE [null] END) AS o
            OPTIONAL MATCH (o)-[:SOURCE_DOCUMENT]->(doc:Document)
            RETURN collect(DISTINCT doc.id) AS documents
        }
        
        CALL {
            WITH obs_nodes
            UNWIND (CASE WHEN size(obs_nodes) > 0 THEN obs_nodes ELSE [null] END) AS o
            OPTIONAL MATCH (o)-[:LOGGED_ON]->(t:TimelineEvent)
            RETURN collect(DISTINCT t.level_number) AS timeline_levels
        }
        
        RETURN 
            target.id AS structure,
            [x IN ancestors WHERE x IS NOT NULL] AS ancestors,
            [x IN descendants WHERE x IS NOT NULL] AS descendants,
            [o IN obs_nodes WHERE o IS NOT NULL | o.id] AS observations,
            [x IN documents WHERE x IS NOT NULL] AS documents,
            [x IN timeline_levels WHERE x IS NOT NULL] AS timeline_event_levels
        """
    else:
        cypher = """
        MATCH (target:AnatomicalStructure {id: $structure_id})
        
        CALL {
            WITH target
            OPTIONAL MATCH (target)<-[:CONTAINS*1..]-(a:AnatomicalStructure)
            RETURN collect(DISTINCT a.id) AS ancestors
        }
        
        CALL {
            WITH target
            OPTIONAL MATCH (target)-[:CONTAINS*1..]->(d:AnatomicalStructure)
            RETURN collect(DISTINCT d.id) AS descendants
        }
        
        CALL {
            WITH target
            OPTIONAL MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(o:Observation)-[:AFFECTS]->(target)
            RETURN collect(DISTINCT o) AS obs_nodes
        }
        
        CALL {
            WITH obs_nodes
            UNWIND (CASE WHEN size(obs_nodes) > 0 THEN obs_nodes ELSE [null] END) AS o
            OPTIONAL MATCH (o)-[:SOURCE_DOCUMENT]->(doc:Document)
            RETURN collect(DISTINCT doc.id) AS documents
        }
        
        CALL {
            WITH obs_nodes
            UNWIND (CASE WHEN size(obs_nodes) > 0 THEN obs_nodes ELSE [null] END) AS o
            OPTIONAL MATCH (o)-[:LOGGED_ON]->(t:TimelineEvent)
            RETURN collect(DISTINCT t.level_number) AS timeline_levels
        }
        
        RETURN 
            target.id AS structure,
            [x IN ancestors WHERE x IS NOT NULL] AS ancestors,
            [x IN descendants WHERE x IS NOT NULL] AS descendants,
            [o IN obs_nodes WHERE o IS NOT NULL | o.id] AS observations,
            [x IN documents WHERE x IS NOT NULL] AS documents,
            [x IN timeline_levels WHERE x IS NOT NULL] AS timeline_event_levels
        """
        
    with driver.session() as session:
        result = session.run(cypher, patient_id=patient_id_str, structure_id=structure_id)
        record = result.single()
        
        if not record:
            return {"error": f"Anatomy '{structure_id}' found in registry but missing from graph projection."}
            
        return {
            "structure": record["structure"],
            "ancestors": record["ancestors"],
            "descendants": record["descendants"],
            "observations": record["observations"],
            "documents": record["documents"],
            "timeline_event_levels": record["timeline_event_levels"]
        }

@tool
def get_patient_graph_context(structure_id: str, include_descendants: bool = True, config: RunnableConfig = None) -> Dict:
    """
    Provides a compact "Table of Contents" summary of a patient's data for a specific body part.
    Returns lists of IDs for related ancestors, descendants, observations, documents, and timeline events.
    Use this to understand the scope of available data before fetching heavy text evidence.
    
    Args:
        structure_id: The canonical ID of the structure (must be strictly resolved first).
        include_descendants: Controls whether observations/documents/timeline data from 
                             descendant anatomical structures are included. The topology array 
                             of descendants is always returned regardless of this flag.
    """
    patient_id_str = config.get("configurable", {}).get("session_patient_id") if config else None
    if not patient_id_str:
        raise ValueError("CRITICAL: session_patient_id missing from execution config.")
        
    patient_id = uuid.UUID(str(patient_id_str))
    
    db: Session = SessionLocal()
    try:
        return _get_patient_graph_context(patient_id, structure_id, include_descendants, db, neo4j_driver)
    finally:
        db.close()