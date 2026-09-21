import uuid
from typing import List, Dict
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db import SessionLocal
from core.neo4j_client import neo4j_driver
from models.anatomy import AnatomicalObservation, AnatomicalStructure
# P15 / D2: statements live in the template registry and are executed through
# the runtime safety gate, so inline Cypher cannot bypass terminal-label
# protection.
from services.retrieval.templates import (
    CYPHER_OBS_FOR_STRUCTURE,
    CYPHER_OBS_FOR_STRUCTURE_EXACT,
    run_patient_cypher,
)

def _get_related_observations(
    patient_id: uuid.UUID, 
    structure_id: str, 
    include_descendants: bool, 
    db: Session, 
    driver
) -> List[Dict]:
    """
    Internal logic: PostgreSQL validation -> Neo4j topological routing -> PostgreSQL clinical truth.
    """
    # Strict Validation Barrier (PostgreSQL)
    stmt = select(AnatomicalStructure.structure_id).where(
        AnatomicalStructure.structure_id == structure_id
    )
    valid_id = db.execute(stmt).scalar_one_or_none()
    
    if not valid_id:
        return [{"error": f"Invalid canonical ID '{structure_id}'. Use resolve_anatomy_id first."}]

    patient_id_str = str(patient_id)
    
    # Topological Routing (Neo4j)
    if include_descendants:
        cypher, statement_id = CYPHER_OBS_FOR_STRUCTURE, "T-OBS"
    else:
        cypher, statement_id = CYPHER_OBS_FOR_STRUCTURE_EXACT, "T-OBS-EXACT"

    obs_ids = []
    with driver.session() as session:
        result = run_patient_cypher(
            session,
            cypher,
            {"patient_id": patient_id_str, "structure_id": structure_id},
            statement_id=statement_id,
        )
        obs_ids = [uuid.UUID(record["observation_id"]) for record in result]
        
    if not obs_ids:
        return []

    # Clinical Truth Retrieval (PostgreSQL)
    # Defense-in-depth: Enforce patient_id again at the SQL level.
    stmt = (
        select(AnatomicalObservation)
        .where(
            AnatomicalObservation.patient_id == patient_id,
            AnatomicalObservation.observation_id.in_(obs_ids)
        )
        .order_by(AnatomicalObservation.recorded_at.desc())
    )
    
    observations = db.execute(stmt).scalars().all()

    # P7: per-row citation so the synthesizer can cite rows from this
    # tool without inventing references (list shape unchanged).
    return [
            {
                "observation_id": str(obs.observation_id),
                "structure_id": obs.structure_id,
                "finding_code": obs.finding_code,
                "finding_display_name": obs.finding_display_name,
                "visual_status": obs.visual_status.value,
                "visual_severity_score": obs.visual_severity_score,
                "trend": obs.trend.value,
                "source_type": obs.source_type.value,
                "clinical_summary": obs.clinical_summary,
                "recorded_at": obs.recorded_at.isoformat() if obs.recorded_at else None,
                "event_id": str(obs.event_id) if obs.event_id else None,
                "document_id": str(obs.document_id) if obs.document_id else None,
                "polarity": obs.polarity,
                "experiencer": obs.experiencer,
                "citations": [{"node_id": f"observation:{obs.observation_id}",
                               "observation_id": str(obs.observation_id)}],
            }
            for obs in observations
    ]

@tool
def get_related_observations(structure_id: str, include_descendants: bool = True, config: RunnableConfig = None) -> List[Dict]:
    """
    Retrieves the authoritative clinical observations for a specific anatomical structure.
    
    Args:
        structure_id: The canonical ID of the structure (must be strictly resolved first).
        include_descendants: If True, includes observations on all sub-parts (e.g., searching 
                             "Lower Limbs" will return "Right Knee" findings). Defaults to True.
    """
    # Security Boundary: Extract tenant ID from execution context
    patient_id_str = config.get("configurable", {}).get("session_patient_id") if config else None
    if not patient_id_str:
        raise ValueError("CRITICAL: session_patient_id missing from execution config.")
        
    patient_id = uuid.UUID(str(patient_id_str))
    
    db: Session = SessionLocal()
    try:
        return _get_related_observations(patient_id, structure_id, include_descendants, db, neo4j_driver)
    finally:
        db.close()