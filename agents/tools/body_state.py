import uuid
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db import SessionLocal
from models.anatomy import PatientBodyStateSnapshot, AnatomicalStructure

def _get_current_body_state(patient_id: uuid.UUID, db: Session) -> list[dict]:
    """
    Queries the materialized read model in PostgreSQL, joining with the 
    anatomy registry to fetch the authoritative human-readable display name.
    """
    stmt = (
        select(PatientBodyStateSnapshot, AnatomicalStructure.display_name, AnatomicalStructure.mesh_node_name)
        .join(
            AnatomicalStructure,
            AnatomicalStructure.structure_id == PatientBodyStateSnapshot.structure_id
        )
        .where(PatientBodyStateSnapshot.patient_id == patient_id)
    )
    
    results = db.execute(stmt).all()
    
    return [
        {
            "structure_id": row.PatientBodyStateSnapshot.structure_id,
            "display_name": row.display_name,
            "mesh_node_name": row.mesh_node_name,
            "visual_status": row.PatientBodyStateSnapshot.visual_status.value,
            "severity": row.PatientBodyStateSnapshot.visual_severity_score,
            "trend": row.PatientBodyStateSnapshot.trend.value,
            "latest_summary": row.PatientBodyStateSnapshot.latest_summary
        }
        for row in results
    ]

@tool
def get_current_body_state(config: RunnableConfig) -> list[dict]:
    """
    Retrieves the patient's current, authoritative 3D body state and active severities.
    Requires no arguments.
    """
    # Security Boundary: Retrieved from LangGraph execution config, not LLM arguments
    patient_id_str = config.get("configurable", {}).get("session_patient_id")
    if not patient_id_str:
        raise ValueError("CRITICAL: session_patient_id missing from execution config.")
        
    patient_id = uuid.UUID(str(patient_id_str))
    
    db: Session = SessionLocal()
    try:
        return _get_current_body_state(patient_id, db)
    finally:
        db.close()