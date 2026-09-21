# get_condition_evidence() -> Neo4j routing + PostgreSQL truth + citations
import uuid
from typing import List, Dict
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db import SessionLocal
from core.neo4j_client import neo4j_driver
from models.conditions import ConditionOccurrence as _ConditionOccurrence
from models.events import ClinicalEvent
from models.ontology import MedicalConcept
from models.clinical_assertion import NO_DATA_RECORDED
from services.retrieval import hydrate as _hydrate
from services.retrieval.templates import CYPHER_EVIDENCE_CHAIN_FOR_EVENT


def _get_condition_evidence(
    patient_id: uuid.UUID, query: str, event_id: str, db: Session, driver
) -> List[Dict]:
    """Internal logic: find events by concept text (or direct id), hydrate
    PG truth incl. assertion fields, attach Neo4j evidence-chain routing."""
    if event_id and event_id.strip():
        try:
            eid = uuid.UUID(event_id.strip())
        except ValueError:
            return [{"error": "INVALID_EVENT_ID: event_id must be a valid UUID."}]
        d = _hydrate.hydrate_event_detail(db, patient_id, eid)
        if not d:
            return [{"message": NO_DATA_RECORDED, "citations": []}]
        return [_present_event(db, patient_id, d, driver)]

    if not query or not query.strip():
        return [{"error": "INVALID_QUERY: query cannot be empty."}]

    needle = query.strip()
    out: List[Dict] = []
    # P1: first search first-class condition occurrences (name match,
    # patient-scoped) — these carry assertion status + linked meds,
    # statements, documents, and visits.
    cond_stmt = (
        select(_ConditionOccurrence)
        .where(
            _ConditionOccurrence.patient_id == patient_id,
            _ConditionOccurrence.name.ilike(f"%{needle}%"),
        )
        .order_by(_ConditionOccurrence.recorded_at.desc())
        .limit(5)
    )
    for cond in db.execute(cond_stmt).scalars().all():
        d = _hydrate.hydrate_condition_detail(db, patient_id, cond.condition_id)
        if d:
            out.append(_present_condition(d))
    if out:
        return out

    stmt = (
        select(ClinicalEvent)
        .join(MedicalConcept, MedicalConcept.id == ClinicalEvent.concept_id)
        .where(
            ClinicalEvent.patient_id == patient_id,
            MedicalConcept.display_name.ilike(f"%{needle}%"),
        )
        .order_by(ClinicalEvent.event_time.desc())
        .limit(5)
    )
    events = db.execute(stmt).scalars().all()
    if not events:
        return [{"message": NO_DATA_RECORDED, "citations": []}]

    for event in events:
        d = _hydrate.hydrate_event_detail(db, patient_id, event.event_id)
        if d:
            out.append(_present_event(db, patient_id, d, driver))
    return out or [{"message": NO_DATA_RECORDED, "citations": []}]


def _present_condition(d: dict) -> Dict:
    cond = d["condition"]
    return {
        "condition_id": str(cond.condition_id),
        "name": cond.name,
        "concept": cond.display_name,
        "polarity": cond.polarity,
        "assertion_verification": cond.assertion_verification,
        "experiencer": cond.experiencer,
        "clinical_status": cond.clinical_status,
        "confirmation_note": (
            "Confirmed patient fact."
            if (cond.polarity in (None, "positive") and (cond.assertion_verification or "unconfirmed") not in ("refuted", "provisional"))
            and (cond.experiencer in (None, "patient"))
            else "Not a confirmed active condition — see polarity/verification fields."
        ),
        "onset_date": cond.onset_date.isoformat() if cond.onset_date else None,
        "recorded_at": cond.recorded_at.isoformat() if cond.recorded_at else None,
        "source_type": cond.source_type,
        "verification_status": cond.verification_status,
        "medications_prescribed_for_it": [
            {"medication_id": str(m.medication_id), "name": m.name} for m in d["medications"][:10]
        ],
        "patient_statements_about_it": [
            {"statement_id": str(s.statement_id), "text": (s.original_text or "")[:200]}
            for s in d["statements"][:10]
        ],
        "evidence_badge": d["badge"],
        "citations": [d["citation"].model_dump()],
    }


def _present_event(db: Session, patient_id: uuid.UUID, d: dict, driver) -> Dict:
    event = d["event"]
    lab = d["lab"]
    # Neo4j evidence-chain routing (documents + linked observations + concepts).
    chain: dict = {"document_ids": [], "observation_ids": [], "concepts": []}
    try:
        with driver.session() as session:
            result = session.run(
                CYPHER_EVIDENCE_CHAIN_FOR_EVENT,
                patient_id=str(patient_id),
                event_id=str(event.event_id),
            )
            rec = result.single()
            if rec:
                chain = {
                    "document_ids": [x for x in (rec["document_ids"] or []) if x],
                    "observation_ids": [x for x in (rec["observation_ids"] or []) if x],
                    "concepts": rec["concepts"] or [],
                }
    except Exception:
        pass
    return {
        "event_id": str(event.event_id),
        "event_type": event.event_type.value,
        "concept": d["concept_display_name"],
        "polarity": event.polarity,
        "assertion_verification": event.assertion_verification,
        "experiencer": event.experiencer,
        "clinical_status": event.clinical_status,
        "confirmation_note": (
            "Confirmed patient fact."
            if (event.polarity in (None, "positive") and (event.assertion_verification or "unconfirmed") not in ("refuted", "provisional"))
            and (event.experiencer in (None, "patient"))
            else "Not a confirmed active condition — see polarity/verification fields."
        ),
        "event_time": event.event_time.isoformat() if event.event_time else None,
        "source_type": event.source_type.value,
        "verification_status": event.verification_status.value,
        "lab_value": lab.value if lab else None,
        "lab_unit": lab.unit if lab else None,
        "reference_range": lab.reference_range if lab else None,
        "graph_chain": chain,
        "linked_observations": [
            {
                "observation_id": str(o.observation_id),
                "structure_id": o.structure_id,
                "finding_display_name": o.finding_display_name,
            }
            for o in d["linked_observations"][:10]
        ],
        "evidence_badge": d["badge"],
        "citations": [d["citation"].model_dump()],
    }


@tool
def get_condition_evidence(query: str = "", event_id: str = "", config: RunnableConfig = None) -> List[Dict]:
    """
    Retrieves structured evidence for a condition/finding: assertion status
    (confirmed vs suspected vs negated), polarity, experiencer, supporting
    document, exact evidence quote, and source citations.

    Args:
        query: Condition or finding text to search (e.g. "hypertension").
        event_id: Optional specific clinical event UUID for direct lookup.
    """
    patient_id_str = config.get("configurable", {}).get("session_patient_id") if config else None
    if not patient_id_str:
        raise ValueError("CRITICAL: session_patient_id missing from execution config.")

    patient_id = uuid.UUID(str(patient_id_str))

    db: Session = SessionLocal()
    try:
        return _get_condition_evidence(patient_id, query, event_id, db, neo4j_driver)
    finally:
        db.close()
