"""P0 PostgreSQL hydration for node-detail and chat retrieval.

PostgreSQL is the source of truth. Every function re-filters by patient_id
(defense-in-depth: Neo4j already routed by patient, PG re-validates).
Only identifiers + stored text are returned — never invented values.
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.anatomy import AnatomicalObservation
from models.daily_logs.events import (
    ActivityPayload,
    NutritionPayload,
    SleepPayload,
)
from models.events import ClinicalEvent, Document, EvidenceLink, LabResult
from models.food import FoodEntry, FoodScan
from models.medications import Medication, MedicationTakenEvent
from models.medication_versions import MedicationVersion
from models.measurements import Measurement
from models.ontology import MedicalConcept
from models.conditions import ConditionOccurrence
from models.ppg import PpgMeasurement
from models.visits import Visit
from models.statements import PatientStatement
from services.retrieval.evidence import Citation, EvidenceBadge, badge_for, truncate_quote
from models.clinical_assertion import EvidenceLevel


def _doc_storage_url(document: Document | None) -> str | None:
    if document is None:
        return None
    return f"/api/v1/documents/{document.document_id}/file"


def _evidence_citation(
    *,
    node_id: str | None = None,
    observation_id: uuid.UUID | None = None,
    event_id: uuid.UUID | None = None,
    document: Document | None = None,
    quote: str | None = None,
    page_number: int | None = None,
    verification_status: str | None = None,
    source_type: str | None = None,
    evidence_level: str = EvidenceLevel.SOURCE_FACT.value,
    concept_display_name: str | None = None,
    prescriber: str | None = None,
) -> Citation:
    return Citation(
        node_id=node_id,
        observation_id=str(observation_id) if observation_id else None,
        event_id=str(event_id) if event_id else None,
        document_id=str(document.document_id) if document else None,
        page_number=page_number,
        quote=truncate_quote(quote),
        verification_status=verification_status,
        source_type=source_type,
        evidence_level=evidence_level,
        concept_display_name=concept_display_name,
        prescriber=prescriber,
        storage_url=_doc_storage_url(document),
    )


def hydrate_observation_detail(db: Session, patient_id: uuid.UUID, observation_id: uuid.UUID) -> dict | None:
    """Full PG truth for one observation (patient-scoped)."""
    batch = hydrate_observations_batch(db, patient_id, [observation_id])
    return batch.get(observation_id)


def _assemble_observation_detail(obs, event, evidence, document, concept_display, lab) -> dict:
    """Shared single/batch assembly (identical shape by construction)."""
    quote = (evidence.extracted_text if evidence else None) or obs.clinical_summary or obs.source_snippet
    citation = _evidence_citation(
        node_id=f"observation:{obs.observation_id}",
        observation_id=obs.observation_id,
        event_id=obs.event_id,
        document=document,
        quote=quote,
        verification_status=event.verification_status.value if event else None,
        source_type=obs.source_type.value,
        concept_display_name=concept_display,
    )
    return {
        "observation": obs,
        "event": event,
        "evidence": evidence,
        "document": document,
        "concept_display_name": concept_display,
        "lab": lab,
        "citation": citation,
        "badge": badge_for(obs.source_type.value, event.verification_status.value if event else None),
    }


def hydrate_observations_batch(
    db: Session, patient_id: uuid.UUID, observation_ids: list[uuid.UUID]
) -> dict[uuid.UUID, dict]:
    """Batched observation hydration (P12, same shape as single).

    Same SELECTs as hydrate_observation_detail with IN-filters, mapped
    by id. Missing ids are absent from the result (lifecycle omission
    preserved). Order of `observation_ids` is NOT significant; callers
    preserve their own ordering.
    """
    ids = list(dict.fromkeys(observation_ids))
    if not ids:
        return {}
    obs_rows = db.execute(
        select(AnatomicalObservation).where(
            AnatomicalObservation.observation_id.in_(ids),
            AnatomicalObservation.patient_id == patient_id,
        )
    ).scalars().all()
    by_id = {o.observation_id: o for o in obs_rows}
    event_ids = [o.event_id for o in obs_rows if o.event_id]
    events: dict = {}
    if event_ids:
        for e in db.execute(
            select(ClinicalEvent).where(
                ClinicalEvent.event_id.in_(event_ids),
                ClinicalEvent.patient_id == patient_id,
            )
        ).scalars().all():
            events[e.event_id] = e
    concept_ids = {e.concept_id for e in events.values() if e.concept_id}
    concepts: dict = {}
    if concept_ids:
        for c in db.execute(
            select(MedicalConcept).where(MedicalConcept.id.in_(concept_ids))
        ).scalars().all():
            concepts[c.id] = c
    labs: dict = {}
    if event_ids:
        for lab in db.execute(
            select(LabResult).where(LabResult.event_id.in_(event_ids))
        ).scalars().all():
            labs[lab.event_id] = lab
    evidences: dict = {}
    if event_ids:
        for ev in db.execute(
            select(EvidenceLink).where(EvidenceLink.event_id.in_(event_ids))
        ).scalars().all():
            evidences[ev.event_id] = ev
    doc_ids = {o.document_id for o in obs_rows if o.document_id}
    documents: dict = {}
    if doc_ids:
        for d in db.execute(
            select(Document).where(
                Document.document_id.in_(doc_ids),
                Document.patient_id == patient_id,
                # P15 / D1: a DELETED document can never be attached to a
                # citation, even if a stray link still points at it.
                Document.status != "DELETED",
            )
        ).scalars().all():
            documents[d.document_id] = d
    out: dict[uuid.UUID, dict] = {}
    for oid in ids:
        obs = by_id.get(oid)
        if obs is None:
            continue
        event = events.get(obs.event_id) if obs.event_id else None
        concept_display = None
        if event and event.concept_id:
            concept = concepts.get(event.concept_id)
            concept_display = concept.display_name if concept else None
        out[oid] = _assemble_observation_detail(
            obs, event,
            evidences.get(event.event_id) if event else None,
            documents.get(obs.document_id) if obs.document_id else None,
            concept_display,
            labs.get(event.event_id) if event else None,
        )
    return out


def hydrate_event_detail(db: Session, patient_id: uuid.UUID, event_id: uuid.UUID) -> dict | None:
    """Full PG truth for one clinical/timeline event (patient-scoped)."""
    batch = hydrate_events_batch(db, patient_id, [event_id])
    return batch.get(event_id)


def _assemble_event_detail(event, evidence, document, concept_display, lab, linked_obs) -> dict:
    """Shared single/batch assembly (identical shape by construction)."""
    quote = (evidence.extracted_text if evidence else None) or event.source_snippet
    citation = _evidence_citation(
        node_id=f"timeline_event:{event.event_id}",
        event_id=event.event_id,
        document=document,
        quote=quote,
        verification_status=event.verification_status.value,
        source_type=event.source_type.value,
        concept_display_name=concept_display,
    )
    return {
        "event": event,
        "evidence": evidence,
        "document": document,
        "concept_display_name": concept_display,
        "lab": lab,
        "linked_observations": linked_obs,
        "citation": citation,
        "badge": badge_for(event.source_type.value, event.verification_status.value),
    }


def hydrate_events_batch(
    db: Session, patient_id: uuid.UUID, event_ids: list[uuid.UUID]
) -> dict[uuid.UUID, dict]:
    """Batched event hydration (P12, same shape as single).

    Same SELECTs as hydrate_event_detail with IN-filters, mapped by
    id. Missing ids are absent (lifecycle omission preserved).
    """
    ids = list(dict.fromkeys(event_ids))
    if not ids:
        return {}
    events: dict = {}
    for e in db.execute(
        select(ClinicalEvent).where(
            ClinicalEvent.event_id.in_(ids),
            ClinicalEvent.patient_id == patient_id,
        )
    ).scalars().all():
        events[e.event_id] = e
    found = [e for eid in ids for e in [events.get(eid)] if e is not None]
    found_ids = [e.event_id for e in found]
    evidences: dict = {}
    if found_ids:
        for ev in db.execute(
            select(EvidenceLink).where(EvidenceLink.event_id.in_(found_ids))
        ).scalars().all():
            evidences[ev.event_id] = ev
    doc_ids = {ev.document_id for ev in evidences.values() if ev.document_id}
    documents: dict = {}
    if doc_ids:
        for d in db.execute(
            select(Document).where(
                Document.document_id.in_(doc_ids),
                Document.patient_id == patient_id,
                # P15 / D1: a DELETED document can never be attached to a
                # citation, even if a stray link still points at it.
                Document.status != "DELETED",
            )
        ).scalars().all():
            documents[d.document_id] = d
    concept_ids = {e.concept_id for e in found if e.concept_id}
    concepts: dict = {}
    if concept_ids:
        for c in db.execute(
            select(MedicalConcept).where(MedicalConcept.id.in_(concept_ids))
        ).scalars().all():
            concepts[c.id] = c
    labs: dict = {}
    if found_ids:
        for lab in db.execute(
            select(LabResult).where(LabResult.event_id.in_(found_ids))
        ).scalars().all():
            labs[lab.event_id] = lab
    linked: dict[uuid.UUID, list] = {eid: [] for eid in found_ids}
    if found_ids:
        for o in db.execute(
            select(AnatomicalObservation).where(
                AnatomicalObservation.event_id.in_(found_ids),
                AnatomicalObservation.patient_id == patient_id,
            )
        ).scalars().all():
            linked.setdefault(o.event_id, []).append(o)
    out: dict[uuid.UUID, dict] = {}
    for eid in ids:
        event = events.get(eid)
        if event is None:
            continue
        evidence = evidences.get(eid)
        document = documents.get(evidence.document_id) if evidence and evidence.document_id else None
        concept_display = None
        if event.concept_id:
            concept = concepts.get(event.concept_id)
            concept_display = concept.display_name if concept else None
        out[eid] = _assemble_event_detail(
            event, evidence, document, concept_display,
            labs.get(eid), linked.get(eid, []),
        )
    return out


def hydrate_medication_detail(
    db: Session, patient_id: uuid.UUID, medication_id: uuid.UUID, taken_limit: int = 30
) -> dict | None:
    """Full PG truth for one medication regimen + dose history (patient-scoped).

    Reason handling: `purpose` mirrors into a reason statement whose evidence
    level is SOURCE_FACT when a source document exists, else USER_REPORTED —
    the graph never upgrades a patient statement into a clinician diagnosis.
    """
    med = db.scalar(
        select(Medication).where(
            Medication.medication_id == medication_id,
            Medication.patient_id == patient_id,
        )
    )
    if med is None:
        return None
    taken = (
        db.execute(
            select(MedicationTakenEvent)
            .where(
                MedicationTakenEvent.medication_id == med.medication_id,
                MedicationTakenEvent.patient_id == patient_id,
            )
            .order_by(MedicationTakenEvent.taken_at.desc())
            .limit(taken_limit)
        )
        .scalars()
        .all()
    )
    counts: dict[str, int] = {}
    for t in taken:
        key = t.status.value if hasattr(t.status, "value") else str(t.status)
        counts[key] = counts.get(key, 0) + 1
    denom = sum(counts.values())
    adherence_rate = round(counts.get("TAKEN", 0) / denom, 3) if denom else None
    document = None
    if med.source_document_id:
        document = db.scalar(
            select(Document).where(
                Document.document_id == med.source_document_id,
                Document.patient_id == patient_id,
                # P15 / D1: never cite a deleted source document.
                Document.status != "DELETED",
            )
        )
    reason_level = (
        EvidenceLevel.SOURCE_FACT.value if document is not None else EvidenceLevel.USER_REPORTED.value
    )
    citation = _evidence_citation(
        node_id=f"medication:{medication_id}",
        document=document,
        quote=med.purpose or med.instructions,
        source_type="document" if document else "patient",
        evidence_level=reason_level,
        prescriber=med.prescriber,
    )
    return {
        "medication": med,
        "taken": taken,
        "taken_counts": counts,
        "adherence_rate": adherence_rate,  # SYSTEM_DERIVED, last-N window only
        "document": document,
        "reason_evidence_level": reason_level,
        "citation": citation,
        "badge": badge_for("document" if document else "PATIENT_REPORTED", None),
    }


def hydrate_document_detail(db: Session, patient_id: uuid.UUID, document_id: uuid.UUID) -> dict | None:
    """PG truth for one document (patient-scoped)."""
    document = db.scalar(
        select(Document).where(
            Document.document_id == document_id,
            Document.patient_id == patient_id,
        )
    )
    if document is None:
        return None
    linked_events = (
        db.execute(
            select(ClinicalEvent).where(
                ClinicalEvent.patient_id == patient_id,
            )
            .join(EvidenceLink, EvidenceLink.event_id == ClinicalEvent.event_id)
            .where(EvidenceLink.document_id == document_id)
            .limit(50)
        )
        .scalars()
        .all()
    )
    citation = _evidence_citation(
        node_id=f"document:{document_id}",
        document=document,
        source_type="document",
    )
    return {
        "document": document,
        "linked_event_count": len(linked_events),
        "linked_events": linked_events,
        "citation": citation,
        "badge": EvidenceBadge.SYSTEM_DERIVED,
    }


def hydrate_condition_detail(db: Session, patient_id: uuid.UUID, condition_id: uuid.UUID) -> dict | None:
    """PG truth for one condition occurrence (patient-scoped)."""
    cond = db.scalar(
        select(ConditionOccurrence).where(
            ConditionOccurrence.condition_id == condition_id,
            ConditionOccurrence.patient_id == patient_id,
        )
    )
    if cond is None:
        return None
    document = None
    if cond.source_document_id:
        document = db.scalar(
            select(Document).where(
                Document.document_id == cond.source_document_id,
                Document.patient_id == patient_id,
                # P15 / D1: never cite a deleted source document.
                Document.status != "DELETED",
            )
        )
    meds = (
        db.execute(
            select(Medication).where(
                Medication.purpose_condition_id == cond.condition_id,
                Medication.patient_id == patient_id,
            )
            .limit(20)  # P7: bounded; presenters slice to 10
        )
        .scalars()
        .all()
    )
    statements = (
        db.execute(
            select(PatientStatement).where(
                PatientStatement.about_condition_id == cond.condition_id,
                PatientStatement.patient_id == patient_id,
            )
            .limit(20)  # P7: bounded; presenters slice to 10
        )
        .scalars()
        .all()
    )
    citation = _evidence_citation(
        node_id=f"condition_occurrence:{condition_id}",
        event_id=cond.source_event_id,
        document=document,
        quote=cond.evidence_text,
        verification_status=cond.verification_status,
        source_type=cond.source_type,
    )
    return {
        "condition": cond,
        "document": document,
        "medications": meds,
        "statements": statements,
        "citation": citation,
        "badge": badge_for(cond.source_type, cond.verification_status),
    }


def hydrate_visit_detail(db: Session, patient_id: uuid.UUID, visit_id: uuid.UUID) -> dict | None:
    """PG truth for one visit (patient-scoped) + member counts by domain."""
    batch = hydrate_visits_batch(db, patient_id, [visit_id])
    return batch.get(visit_id)


def _visit_day_bounds(visit):
    day_start = datetime.combine(visit.visit_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    day_end = datetime.combine(visit.visit_date, datetime.max.time()).replace(tzinfo=timezone.utc)
    return day_start, day_end


def _assemble_visit_detail(visit, event_count: int, obs_count: int) -> dict:
    """Shared single/batch assembly (identical shape by construction)."""
    citation = _evidence_citation(
        node_id=f"visit:{visit.visit_id}",
        source_type="system",
        evidence_level=EvidenceLevel.SYSTEM_DERIVED.value,
    )
    return {
        "visit": visit,
        "event_count": event_count,
        "observation_count": obs_count,
        "citation": citation,
        "badge": EvidenceBadge.SYSTEM_DERIVED,
    }


def hydrate_visits_batch(
    db: Session, patient_id: uuid.UUID, visit_ids: list[uuid.UUID]
) -> dict[uuid.UUID, dict]:
    """Batched visit hydration (P12, same shape as single).

    Visit rows fetch batched; per-visit member counts stay per-visit
    COUNT queries (identical bounds to the single path) — visits are
    few per answer (typically 1), so the residual is bounded and the
    semantics are provably unchanged.
    """
    ids = list(dict.fromkeys(visit_ids))
    if not ids:
        return {}
    visits: dict = {}
    for v in db.execute(
        select(Visit).where(
            Visit.visit_id.in_(ids),
            Visit.patient_id == patient_id,
        )
    ).scalars().all():
        visits[v.visit_id] = v
    out: dict[uuid.UUID, dict] = {}
    for vid in ids:
        visit = visits.get(vid)
        if visit is None:
            continue
        day_start, day_end = _visit_day_bounds(visit)
        event_count = db.scalar(
            select(func.count())
            .select_from(ClinicalEvent)
            .where(
                ClinicalEvent.patient_id == patient_id,
                ClinicalEvent.event_time >= day_start,
                ClinicalEvent.event_time <= day_end,
            )
        ) or 0
        obs_count = db.scalar(
            select(func.count())
            .select_from(AnatomicalObservation)
            .where(
                AnatomicalObservation.patient_id == patient_id,
                AnatomicalObservation.recorded_at >= day_start,
                AnatomicalObservation.recorded_at <= day_end,
            )
        ) or 0
        out[vid] = _assemble_visit_detail(visit, event_count, obs_count)
    return out


def hydrate_statement_detail(db: Session, patient_id: uuid.UUID, statement_id: uuid.UUID) -> dict | None:
    """PG truth for one patient statement (patient-scoped)."""
    stmt = db.scalar(
        select(PatientStatement).where(
            PatientStatement.statement_id == statement_id,
            PatientStatement.patient_id == patient_id,
        )
    )
    if stmt is None:
        return None
    about = None
    if stmt.about_condition_id:
        about = db.scalar(
            select(ConditionOccurrence).where(
                ConditionOccurrence.condition_id == stmt.about_condition_id,
                ConditionOccurrence.patient_id == patient_id,
            )
        )
    med = None
    if stmt.source_medication_id:
        med = db.scalar(
            select(Medication).where(
                Medication.medication_id == stmt.source_medication_id,
                Medication.patient_id == patient_id,
            )
        )
    citation = _evidence_citation(
        node_id=f"patient_statement:{statement_id}",
        source_type="patient",
        evidence_level=EvidenceLevel.USER_REPORTED.value,
    )
    return {
        "statement": stmt,
        "about_condition": about,
        "medication": med,
        "citation": citation,
        "badge": EvidenceBadge.USER_REPORTED,
    }


def hydrate_measurement_detail(db: Session, patient_id: uuid.UUID, measurement_id: uuid.UUID) -> dict | None:
    """PG truth for one measurement (patient-scoped) + series context."""
    m = db.scalar(
        select(Measurement).where(
            Measurement.measurement_id == measurement_id,
            Measurement.patient_id == patient_id,
        )
    )
    if m is None:
        return None
    document = None
    if m.source_document_id:
        document = db.scalar(
            select(Document).where(
                Document.document_id == m.source_document_id,
                Document.patient_id == patient_id,
                # P15 / D1: never cite a deleted source document.
                Document.status != "DELETED",
            )
        )
    # Series context (SYSTEM_DERIVED counts; rows via the trend template).
    series_count = db.scalar(
        select(func.count())
        .select_from(Measurement)
        .where(
            Measurement.patient_id == patient_id,
            Measurement.series_key == m.series_key,
        )
    ) or 0
    latest = (
        db.execute(
            select(Measurement)
            .where(
                Measurement.patient_id == patient_id,
                Measurement.series_key == m.series_key,
            )
            .order_by(Measurement.measured_at.desc())
            .limit(5)
        )
        .scalars()
        .all()
    )
    citation = _evidence_citation(
        node_id=f"measurement:{measurement_id}",
        event_id=m.source_event_id,
        document=document,
        quote=m.evidence_text,
        verification_status=m.verification_status,
        source_type=m.source_type,
        concept_display_name=m.display_name,
    )
    return {
        "measurement": m,
        "document": document,
        "series_count": series_count,
        "recent_series": [
            {
                "measurement_id": str(r.measurement_id),
                "measured_at": r.measured_at.isoformat() if r.measured_at else None,
                "value_text": r.value_text,
                "value_number": r.value_number,
                "interpretation": r.interpretation,
            }
            for r in latest
        ],
        "citation": citation,
        "badge": badge_for(m.source_type, m.verification_status),
    }


def hydrate_medication_versions(db: Session, patient_id: uuid.UUID, medication_id: uuid.UUID) -> list[dict]:
    """Regimen version history, newest first (patient-scoped, PG truth)."""
    rows = (
        db.execute(
            select(MedicationVersion)
            .where(
                MedicationVersion.medication_id == medication_id,
                MedicationVersion.patient_id == patient_id,
            )
            .order_by(MedicationVersion.version_number.desc())
            .limit(50)  # P7: bounded; presenters take newest-first slices
        )
        .scalars()
        .all()
    )
    return [
        {
            "version_id": str(v.version_id),
            "version_number": v.version_number,
            "snapshot": v.snapshot,
            "change_reason": v.change_reason,
            "recorded_at": v.recorded_at.isoformat() if v.recorded_at else None,
        }
        for v in rows
    ]


def _user_reported_citation(node_id: str) -> Citation:
    return Citation(node_id=node_id, source_type="patient", evidence_level=EvidenceLevel.USER_REPORTED.value)


def hydrate_sleep_detail(db: Session, patient_id: uuid.UUID, event_id: uuid.UUID) -> dict | None:
    """PG truth for one sleep log (patient-scoped)."""
    event = db.scalar(
        select(ClinicalEvent).where(
            ClinicalEvent.event_id == event_id, ClinicalEvent.patient_id == patient_id,
        )
    )
    if event is None:
        return None
    payload = db.scalar(select(SleepPayload).where(SleepPayload.event_id == event_id))
    citation = _user_reported_citation(f"sleep_episode:{event_id}")
    return {
        "event": event, "payload": payload, "citation": citation,
        "badge": EvidenceBadge.USER_REPORTED,
    }


def hydrate_activity_detail(db: Session, patient_id: uuid.UUID, event_id: uuid.UUID) -> dict | None:
    """PG truth for one activity log (patient-scoped)."""
    event = db.scalar(
        select(ClinicalEvent).where(
            ClinicalEvent.event_id == event_id, ClinicalEvent.patient_id == patient_id,
        )
    )
    if event is None:
        return None
    payload = db.scalar(select(ActivityPayload).where(ActivityPayload.event_id == event_id))
    citation = _user_reported_citation(f"activity_event:{event_id}")
    return {
        "event": event, "payload": payload, "citation": citation,
        "badge": EvidenceBadge.USER_REPORTED,
    }


def hydrate_nutrition_detail(db: Session, patient_id: uuid.UUID, event_id: uuid.UUID) -> dict | None:
    """PG truth for one nutrition log (patient-scoped)."""
    event = db.scalar(
        select(ClinicalEvent).where(
            ClinicalEvent.event_id == event_id, ClinicalEvent.patient_id == patient_id,
        )
    )
    if event is None:
        return None
    payload = db.scalar(select(NutritionPayload).where(NutritionPayload.event_id == event_id))
    citation = _user_reported_citation(f"nutrition_intake:{event_id}")
    return {
        "event": event, "payload": payload, "citation": citation,
        "badge": EvidenceBadge.USER_REPORTED,
    }


def hydrate_food_scan_detail(db: Session, patient_id: uuid.UUID, scan_id: uuid.UUID) -> dict | None:
    """PG truth for one food scan + entries (patient-scoped)."""
    scan = db.scalar(
        select(FoodScan).where(
            FoodScan.scan_id == scan_id, FoodScan.patient_id == patient_id,
        )
    )
    if scan is None:
        return None
    entries = (
        db.execute(select(FoodEntry).where(FoodEntry.scan_id == scan_id).limit(100))
        .scalars()
        .all()
    )
    citation = Citation(
        node_id=f"food_scan:{scan_id}", source_type="ai" if scan.status == "ai_estimated" else "patient",
        evidence_level=EvidenceLevel.AI_INFERRED.value if scan.status == "ai_estimated"
        else EvidenceLevel.USER_REPORTED.value,
    )
    return {
        "scan": scan, "entries": entries, "citation": citation,
        "badge": EvidenceBadge.AI_INFERRED if scan.status == "ai_estimated" else EvidenceBadge.USER_REPORTED,
    }


def hydrate_ppg_detail(db: Session, patient_id: uuid.UUID, measurement_id: uuid.UUID) -> dict | None:
    """PG truth for one PPG/rPPG session (patient-scoped).

    RR intervals are counted, never returned in full (raw data stays in PG).
    """
    row = db.scalar(
        select(PpgMeasurement).where(
            PpgMeasurement.measurement_id == measurement_id,
            PpgMeasurement.patient_id == patient_id,
        )
    )
    if row is None:
        return None
    rr = row.rr_intervals_ms or []
    citation = _evidence_citation(
        node_id=f"ppg_measurement:{measurement_id}",
        source_type="device",
        evidence_level=EvidenceLevel.SYSTEM_DERIVED.value,
    )
    return {
        "row": row,
        "rr_count": len(rr),
        "citation": citation,
        "badge": EvidenceBadge.SYSTEM_DERIVED,
    }


def hydrate_daily_log_day(db: Session, patient_id: uuid.UUID, log_date) -> dict:
    """PG truth for one check-in day: sections present + visit + event ids.

    Backs the "what did I log on day X" retrieval without inventing data.
    """
    from datetime import time as _time

    day_start = datetime.combine(log_date, _time.min).replace(tzinfo=timezone.utc)
    day_end = datetime.combine(log_date, _time.max).replace(tzinfo=timezone.utc)
    events = (
        db.execute(
            select(ClinicalEvent)
            .where(
                ClinicalEvent.patient_id == patient_id,
                ClinicalEvent.event_time >= day_start,
                ClinicalEvent.event_time <= day_end,
            )
            .order_by(ClinicalEvent.event_time.asc())
            .limit(500)  # P7: one day of check-in events is small; bound anyway
        )
        .scalars()
        .all()
    )
    visit = db.scalar(
        select(Visit).where(Visit.patient_id == patient_id, Visit.visit_date == log_date)
    )
    by_type: dict[str, list[str]] = {}
    for e in events:
        key = e.event_type.value if hasattr(e.event_type, "value") else str(e.event_type)
        by_type.setdefault(key, []).append(str(e.event_id))
    return {
        "log_date": log_date.isoformat(),
        "sections": sorted(by_type.keys()),
        "event_ids_by_type": by_type,
        "event_count": len(events),
        "visit_id": str(visit.visit_id) if visit else None,
        "citation": Citation(
            node_id=f"daily_log:{log_date.isoformat()}", source_type="patient",
            evidence_level=EvidenceLevel.SYSTEM_DERIVED.value,
        ),
    }
