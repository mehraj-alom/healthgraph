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
from services.retrieval import hydrate as _hydrate
# P15 / D2: the statement lives in the template registry and is executed
# through the runtime safety gate (see services/retrieval/templates.py).
from services.retrieval.templates import CYPHER_TIMELINE, run_patient_cypher


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
    # P0 SECURITY: the LOGGED_ON hop is bound to the authenticated patient's
    # own observations. The previous unscoped
    #   OPTIONAL MATCH (o:Observation)-[:LOGGED_ON]->(t)
    # relied on UUID unguessability instead of ownership; with shared
    # Concept/Visit nodes in the schema that pattern would leak across
    # patients, so every hop now carries the `p` binding.
    # Registered as T-TIME; identical text (verified) but now covered by
    # check_cypher_safety() and re-validated at execution time.
    cypher = CYPHER_TIMELINE

    timeline_nodes = []
    all_obs_ids = set()

    with driver.session() as session:
        result = run_patient_cypher(
            session,
            cypher,
            {"patient_id": patient_id_str, "limit": limit},
            statement_id="T-TIME",
        )
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
                "polarity": record.get("polarity"),
                "experiencer": record.get("experiencer"),
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
                "visual_status": obs.visual_status.value,
                "visual_severity_score": obs.visual_severity_score,
                "trend": obs.trend.value,
                "clinical_summary": obs.clinical_summary,
                "source_type": obs.source_type.value,
                "recorded_at": obs.recorded_at.isoformat() if obs.recorded_at else None,
                "event_id": str(obs.event_id) if obs.event_id else None,
                "document_id": str(obs.document_id) if obs.document_id else None,
                "polarity": obs.polarity,
                "experiencer": obs.experiencer,
            }

    #  Assembly
    # P13: quote-carrying event citations. One batched PG hydration over
    # the timeline event ids (patient-scoped; missing/deleted ids are
    # absent → legacy quote-less envelope preserved, explicitly marked
    # quote-unavailable). Quotes come only from stored source text
    # (EvidenceLink.extracted_text → event.source_snippet fallback inside
    # the hydrator); nothing is manufactured from event properties.
    event_ids: list[uuid.UUID] = []
    for node in timeline_nodes:
        try:
            event_ids.append(uuid.UUID(str(node["event_id"])))
        except (ValueError, TypeError):
            continue
    try:
        event_details = _hydrate.hydrate_events_batch(db, patient_id, event_ids)
    except Exception:
        event_details = {}
    for node in timeline_nodes:
        node["observations"] = [
            obs_map[oid] for oid in node["observations"]
            if oid in obs_map
        ]
        detail = None
        try:
            detail = event_details.get(uuid.UUID(str(node["event_id"])))
        except (ValueError, TypeError):
            detail = None
        citation = detail.get("citation") if detail else None
        if citation is not None and getattr(citation, "quote", None):
            # Traceable citation: patient + event + document/source +
            # exact stored quote (+ page where the source carries one;
            # EvidenceLink rows carry none → None, never invented).
            node["citations"] = [citation]
            node["quote_available"] = True
        else:
            # P7 legacy behavior preserved; availability explicit so the
            # synthesizer (rule 7a) and evaluators can tell "no source
            # text recorded" apart from "source text exists".
            node["citations"] = [
                {"node_id": f"timeline_event:{node['event_id']}",
                 "event_id": node["event_id"]}
            ]
            node["quote_available"] = False
            node["citation_note"] = (
                "quote-unavailable: no source text recorded for this "
                "event in PostgreSQL"
            )

    return timeline_nodes

@tool
def get_patient_timeline(limit: int = 10, config: RunnableConfig = None) -> List[Dict]:
    """
    Retrieves the patient's chronological timeline events (levels) and any clinical
    observations logged on those specific days. Timeline events carry
    quote-carrying citations where PostgreSQL holds recorded source text
    (quote_available true); otherwise a quote-less citation explicitly
    marked quote-unavailable.
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