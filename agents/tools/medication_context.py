# get_medication_context() -> Neo4j routing + PostgreSQL truth + citations
import uuid
from typing import List, Dict
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from sqlalchemy import select, or_
from sqlalchemy.orm import Session

from core.db import SessionLocal
from core.neo4j_client import neo4j_driver
from models.conditions import ConditionOccurrence as _ConditionOccurrence
from models.medications import Medication
from models.statements import PatientStatement as _PatientStatement
from models.clinical_assertion import NO_DATA_RECORDED, NO_DOCUMENTED_REASON
from services.retrieval import hydrate as _hydrate
from services.retrieval.templates import CYPHER_MEDICATIONS_FOR_PATIENT


def _get_medication_context(
    patient_id: uuid.UUID, medication_name: str, db: Session, driver
) -> List[Dict]:
    """Internal logic: PG regimen truth + Neo4j projection check + citations."""
    if not medication_name or not medication_name.strip():
        return [{"error": "INVALID_QUERY: medication_name cannot be empty."}]

    needle = medication_name.strip()
    stmt = (
        select(Medication)
        .where(
            Medication.patient_id == patient_id,
            or_(
                Medication.name.ilike(f"%{needle}%"),
                Medication.generic_name.ilike(f"%{needle}%"),
                Medication.brand_name.ilike(f"%{needle}%"),
            ),
        )
        .limit(5)
    )
    candidates = db.execute(stmt).scalars().all()
    if not candidates:
        return [{"message": NO_DATA_RECORDED, "citations": []}]

    # Neo4j routing: which of these regimens are projected to the graph?
    projected: set[str] = set()
    try:
        with driver.session() as session:
            result = session.run(CYPHER_MEDICATIONS_FOR_PATIENT, patient_id=str(patient_id))
            for record in result:
                projected.add(str(record["medication_id"]))
    except Exception:
        # Graph routing is best-effort; PG remains the source of truth.
        pass

    out: List[Dict] = []
    for med in candidates:
        d = _hydrate.hydrate_medication_detail(db, patient_id, med.medication_id)
        if not d:
            continue
        citation = d["citation"].model_dump()
        dose = (
            f"{med.dose_amount:g} {med.dose_unit}"
            if med.dose_amount and med.dose_unit
            else ((f"{med.strength} {med.strength_unit or ''}".strip()) if med.strength else None)
        )
        reason = med.purpose
        # P1 reason split: resolve the linked condition + statement rows so
        # the answer distinguishes prescribed purpose from patient-stated
        # reason with explicit evidence levels.
        purpose_condition = None
        if med.purpose_condition_id is not None:
            cond = db.get(_ConditionOccurrence, med.purpose_condition_id)
            if cond is not None and cond.patient_id == patient_id:
                purpose_condition = {
                    "condition_id": str(cond.condition_id),
                    "name": cond.name,
                    "polarity": cond.polarity,
                    "verification": cond.assertion_verification,
                    "experiencer": cond.experiencer,
                }
        reason_statement = None
        if med.reason_statement_id is not None:
            stmt = db.get(_PatientStatement, med.reason_statement_id)
            if stmt is not None and stmt.patient_id == patient_id:
                reason_statement = {
                    "statement_id": str(stmt.statement_id),
                    "text": stmt.original_text,
                    "evidence_level": "USER_REPORTED",
                }
        out.append(
            {
                "medication_id": str(med.medication_id),
                "request_id": str(med.medication_id),  # P1: request shares the regimen id
                "name": med.name,
                "generic_name": med.generic_name,
                "brand_name": med.brand_name,
                "dose": dose,
                "frequency": med.frequency.value if hasattr(med.frequency, "value") else str(med.frequency),
                "scheduled_times": med.scheduled_times,
                "route": med.route.value if med.route and hasattr(med.route, "value") else (str(med.route) if med.route else None),
                "status": med.status.value if hasattr(med.status, "value") else str(med.status),
                "start_date": med.start_date.isoformat() if med.start_date else None,
                "end_date": med.end_date.isoformat() if med.end_date else None,
                "prescriber": med.prescriber,
                "purpose": reason,
                "purpose_evidence_level": d["reason_evidence_level"],
                "purpose_condition": purpose_condition,
                "reason_statement": reason_statement,
                "purpose_note": (
                    NO_DOCUMENTED_REASON
                    if not reason
                    else ("Patient-stated reason — not a clinician-confirmed diagnosis."
                          if d["reason_evidence_level"] == "USER_REPORTED"
                          else "Reason as documented in the patient record.")
                ),
                "instructions": med.instructions,
                "projected_to_graph": str(med.medication_id) in projected,
                "adherence_rate_last_30": d["adherence_rate"],
                "taken_counts": d["taken_counts"],
                "recent_taken": [
                    {
                        "taken_at": t.taken_at.isoformat() if t.taken_at else None,
                        "status": t.status.value if hasattr(t.status, "value") else str(t.status),
                        "dose_taken": t.dose_taken,
                    }
                    for t in d["taken"][:10]
                ],
                "evidence_badge": d["badge"],
                "citations": [citation],
            }
        )
    return out or [{"message": NO_DATA_RECORDED, "citations": []}]


@tool
def get_medication_context(medication_name: str, config: RunnableConfig = None) -> List[Dict]:
    """
    Retrieves the patient's structured medication record: dosage, frequency,
    prescriber, documented reason (with evidence level), adherence history,
    and source citations.

    Args:
        medication_name: Full or partial medication name (brand or generic).
    """
    patient_id_str = config.get("configurable", {}).get("session_patient_id") if config else None
    if not patient_id_str:
        raise ValueError("CRITICAL: session_patient_id missing from execution config.")

    patient_id = uuid.UUID(str(patient_id_str))

    db: Session = SessionLocal()
    try:
        return _get_medication_context(patient_id, medication_name, db, neo4j_driver)
    finally:
        db.close()
