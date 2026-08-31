# get_patient_timeline() -> Neo4j + PostgreSQL
import uuid
import logging
from typing import List, Dict
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from sqlalchemy import select
from sqlalchemy.orm import Session
from logger import logger 

from core.db import SessionLocal
from core.neo4j_client import neo4j_driver
from models.anatomy import AnatomicalObservation


def _get_patient_timeline( patient_id: uuid.UUID, limit: int, db: Session, driver) -> List[Dict]:
    """
    Internal logic: Neo4j sequences the timeline events safely; 
    PostgreSQL populates the authoritative clinical data.
    """
    # Input Validation
    if not isinstance(limit, int) or limit < 1 or limit > 50:
        return [{"error": "INVALID_LIMIT: limit must be between 1 and 50."}]
        
    patient_id_str = str(patient_id)
    
    # Topological Routing & Sequencing (Neo4j)
    cypher = """
    MATCH (p:Patient {id: $patient_id})-[:HAS_TIMELINE_EVENT]->(t:TimelineEvent)
    OPTIONAL MATCH (o:Observation)-[:LOGGED_ON]->(t)
    RETURN 
        t.id AS event_id, 
        t.level_number AS level_number, 
        COALESCE(t.event_time, t.date) AS event_date,
        t.event_type AS event_type,
        t.source_type AS source_type,
        t.verification_status AS verification_status,
        collect(o.id) AS observation_ids
    ORDER BY t.level_number DESC, COALESCE(t.event_time, t.date) DESC, t.id DESC
    LIMIT $limit
    """
    
    timeline_nodes = []
    all_obs_ids = set()
    
    with driver.session() as session:
        result = session.run(cypher, patient_id=patient_id_str, limit=limit)
        for record in result:
            obs_ids = []
            
            # Safely validate UUIDs to prevent crashes from malformed graph data
            for oid in record["observation_ids"]:
                if oid is None:
                    continue
                try:
                    valid_uuid = uuid.UUID(str(oid))
                    obs_ids.append(valid_uuid)
                    all_obs_ids.add(valid_uuid)
                except ValueError:
                    logger.warning(
                        "Ignoring malformed observation ID %r for timeline event %s",
                        oid,
                        record["event_id"]
                    )
            
            timeline_nodes.append({
                "event_id": record["event_id"],
                "level_number": record["level_number"],
                "date": record["event_date"],
                "event_type": record.get("event_type"),
                "source_type": record.get("source_type"),
                "verification_status": record.get("verification_status"),
                "observations": obs_ids
            })
            
    if not timeline_nodes:
        return []

    # Clinical Truth Retrieval (PostgreSQL)
    obs_map = {}
    if all_obs_ids:
        stmt = select(AnatomicalObservation).where(
            AnatomicalObservation.patient_id == patient_id,
            AnatomicalObservation.observation_id.in_(all_obs_ids)
        )
        observations = db.execute(stmt).scalars().all()
        
        for obs in observations:
            obs_map[obs.observation_id] = {
                "observation_id": str(obs.observation_id),
                "structure_id": obs.structure_id,
                "finding_code": obs.finding_code,
                "finding_display_name": obs.finding_display_name,
                "visual_severity_score": obs.visual_severity_score,
                "trend": obs.trend.value,
                "clinical_summary": obs.clinical_summary
            }

    #  Assembly
    for node in timeline_nodes:
        node["observations"] = [
            obs_map[oid] for oid in node["observations"] 
            if oid in obs_map
        ]

    return timeline_nodes

@tool
def get_patient_timeline(limit: int = 10, config: RunnableConfig = None) -> List[Dict]:
    """
    Retrieves the patient's chronological timeline events (levels) and any clinical 
    observations logged on those specific days.
    """
    patient_id_str = config.get("configurable", {}).get("session_patient_id") if config else None
    if not patient_id_str:
        raise ValueError("CRITICAL: session_patient_id missing from execution config.")
        
    patient_id = uuid.UUID(str(patient_id_str))
    
    db: Session = SessionLocal()
    try:
        return _get_patient_timeline(patient_id, limit, db, neo4j_driver)
    finally:
        db.close()