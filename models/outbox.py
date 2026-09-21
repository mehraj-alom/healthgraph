"""The main work of this model is to define the Outbox table, which is used to reliably queue events for projection into Neo4j."""
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional
from sqlalchemy import String, DateTime, Enum as SQLEnum, Integer, Text, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base

class OutboxStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    PROCESSED = "processed"
    DEAD_LETTER = "dead_letter"

class OutboxEventType(str, Enum):
    OBSERVATION_RECORDED = "observation_recorded"
    CLINICAL_EVENT_RECORDED = "clinical_event_recorded"
    MEDICATION_RECORDED = "medication_recorded"
    MEDICATION_TAKEN_RECORDED = "medication_taken_recorded"
    # P1 clinical graph expansion (all projected with idempotent MERGE).
    CONDITION_RECORDED = "condition_recorded"
    VISIT_RECORDED = "visit_recorded"
    STATEMENT_RECORDED = "statement_recorded"
    # P2 measurement split + regimen version history.
    MEASUREMENT_RECORDED = "measurement_recorded"
    MEDICATION_VERSION_RECORDED = "medication_version_recorded"
    # P3 longitudinal personal-health domains.
    SLEEP_RECORDED = "sleep_recorded"
    ACTIVITY_RECORDED = "activity_recorded"
    NUTRITION_RECORDED = "nutrition_recorded"
    FOOD_SCAN_RECORDED = "food_scan_recorded"
    PPG_RECORDED = "ppg_recorded"
    # P5 lifecycle: retirement of replaced graph nodes (PUT corrections).
    GRAPH_NODE_RETIRED = "graph_node_retired"

class GraphSyncOutbox(Base):
    """Reliable queue for projecting PostgreSQL state into Neo4j."""
    __tablename__ = "graph_sync_outbox"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_type: Mapped[OutboxEventType] = mapped_column(SQLEnum(OutboxEventType), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[OutboxStatus] = mapped_column(SQLEnum(OutboxStatus), default=OutboxStatus.PENDING, nullable=False)
    
    # Retry & Lease State Machine
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_outbox_poll", "status", "next_attempt_at", "locked_at"),
    )


# ---------------------------------------------------------------------------
# Shared helpers for outbox producers
# ---------------------------------------------------------------------------

def compute_level_number(event_time: datetime) -> int:
    """Deterministic YYYYMMDD level number derived from event_time."""
    return int(event_time.strftime("%Y%m%d"))


def enqueue_clinical_event(
    db,
    event_id: uuid.UUID,
    patient_id: uuid.UUID,
    event_type,
    source_type,
    verification_status,
    event_time: datetime,
    *,
    level_number: Optional[int] = None,
    # P0 assertion foundation (all optional, backward compatible).
    # See models/clinical_assertion.py.
    polarity: str | None = None,
    assertion_verification: str | None = None,
    experiencer: str | None = None,
    clinical_status: str | None = None,
    source_snippet: str | None = None,
    # P0 provenance (all optional, backward compatible).
    document_id: uuid.UUID | str | None = None,
    evidence_text: str | None = None,
    extraction_method: str | None = None,
    extraction_model: str | None = None,
    extraction_model_version: str | None = None,
    # P0 Concept-lite (optional; consumed only when the
    # GRAPH_CONCEPT_EDGES_ENABLED flag is on).
    concept_id: uuid.UUID | str | None = None,
    concept_system: str | None = None,
    concept_code: str | None = None,
    concept_display: str | None = None,
    # P1 visit linkage for OCCURRED_DURING (optional, backward compatible).
    visit_id: uuid.UUID | str | None = None,
    # P5 recency guard (optional): ISO timestamp of the sourcing PG row's
    # updated_at. The worker applies prop SETs only when the stored node is
    # older-or-equal, so stale replays cannot regress newer state. Rows
    # without it project exactly as before.
    pg_updated_at: str | None = None,
    # P6 per-mention normalization evidence (optional, backward compatible).
    match_confidence: float | None = None,
    match_status: str | None = None,
) -> None:
    """
    Enqueue a ClinicalEvent for projection into Neo4j.

    Call this inside the same database session that created the ClinicalEvent,
    after the ClinicalEvent has been flushed (so event_id is valid).

    The idempotency key is ``event_id`` inside the JSONB payload.  The
    graph_sync worker uses MERGE so re-enqueueing is safe.
    """
    if level_number is None:
        level_number = compute_level_number(event_time)

    payload = {
        "patient_id": str(patient_id),
        "event_id": str(event_id),
        "event_type": event_type.value
        if hasattr(event_type, "value")
        else str(event_type),
        "source_type": source_type.value
        if hasattr(source_type, "value")
        else str(source_type),
        "verification_status": verification_status.value
        if hasattr(verification_status, "value")
        else str(verification_status),
        "event_time": event_time.isoformat(),
        "level_number": level_number,
    }
    # Optional P0 keys are only present when the producer supplies them, so
    # old outbox rows (without them) keep projecting unchanged.
    if polarity is not None:
        payload["polarity"] = polarity
    if assertion_verification is not None:
        payload["assertion_verification"] = assertion_verification
    if experiencer is not None:
        payload["experiencer"] = experiencer
    if clinical_status is not None:
        payload["clinical_status"] = clinical_status
    if source_snippet is not None:
        payload["source_snippet"] = source_snippet
    if document_id is not None:
        payload["document_id"] = str(document_id)
    if evidence_text is not None:
        payload["evidence_text"] = evidence_text
    if extraction_method is not None:
        payload["extraction_method"] = extraction_method
    if extraction_model is not None:
        payload["extraction_model"] = extraction_model
    if extraction_model_version is not None:
        payload["extraction_model_version"] = extraction_model_version
    if concept_id is not None:
        payload["concept_id"] = str(concept_id)
    if concept_system is not None:
        payload["concept_system"] = concept_system
    if concept_code is not None:
        payload["concept_code"] = concept_code
    if concept_display is not None:
        payload["concept_display"] = concept_display
    if visit_id is not None:
        payload["visit_id"] = str(visit_id)
    if pg_updated_at is not None:
        payload["pg_updated_at"] = pg_updated_at
    if match_confidence is not None:
        payload["match_confidence"] = match_confidence
    if match_status is not None:
        payload["match_status"] = match_status

    db.add(
        GraphSyncOutbox(
            event_type=OutboxEventType.CLINICAL_EVENT_RECORDED,
            payload=payload,
        )
    )


def enqueue_clinical_events_batch(
    db,
    events: list,
) -> None:
    """
    Batch-enqueue multiple ClinicalEvent ORM objects.

    Each event must already be added to the session and flushed so that
    ``event_id`` is populated.
    """
    for event in events:
        enqueue_clinical_event(
            db,
            event_id=event.event_id,
            patient_id=event.patient_id,
            event_type=event.event_type,
            source_type=event.source_type,
            verification_status=event.verification_status,
            event_time=event.event_time,
        )


def enqueue_medication(
    db,
    medication_id: uuid.UUID,
    patient_id: uuid.UUID,
    name: str,
    generic_name: str | None = None,
    brand_name: str | None = None,
    strength: str | None = None,
    strength_unit: str | None = None,
    dose_amount: float | None = None,
    dose_unit: str | None = None,
    route: str | None = None,
    frequency: str | None = None,
    scheduled_times: list | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    status: str = "ACTIVE",
    purpose: str | None = None,
    instructions: str | None = None,
    prescriber: str | None = None,
    prn: bool = False,
    reminder_enabled: bool = False,
    notes: str | None = None,
    # P1 graph context (all optional, backward compatible).
    source_document_id: uuid.UUID | str | None = None,
    purpose_condition_id: uuid.UUID | str | None = None,
    purpose_condition_name: str | None = None,
    reason_statement_id: uuid.UUID | str | None = None,
    # P5 recency guard (optional; see enqueue_clinical_event).
    pg_updated_at: str | None = None,
) -> None:
    """
    Enqueue a Medication for projection into Neo4j.
    """
    payload = {
        "patient_id": str(patient_id),
        "medication_id": str(medication_id),
        "name": name,
        "generic_name": generic_name,
        "brand_name": brand_name,
        "strength": strength,
        "strength_unit": strength_unit,
        "dose_amount": dose_amount,
        "dose_unit": dose_unit,
        "route": route,
        "frequency": frequency,
        "scheduled_times": scheduled_times,
        "start_date": start_date,
        "end_date": end_date,
        "status": status,
        "purpose": purpose,
        "instructions": instructions,
        "prescriber": prescriber,
        "prn": prn,
        "reminder_enabled": reminder_enabled,
        "notes": notes,
    }
    if source_document_id is not None:
        payload["source_document_id"] = str(source_document_id)
    if purpose_condition_id is not None:
        payload["purpose_condition_id"] = str(purpose_condition_id)
    if purpose_condition_name is not None:
        payload["purpose_condition_name"] = purpose_condition_name
    if reason_statement_id is not None:
        payload["reason_statement_id"] = str(reason_statement_id)
    if pg_updated_at is not None:
        payload["pg_updated_at"] = pg_updated_at
    db.add(
        GraphSyncOutbox(
            event_type=OutboxEventType.MEDICATION_RECORDED,
            payload=payload,
        )
    )


def enqueue_medication_taken(
    db,
    event_id: uuid.UUID,
    patient_id: uuid.UUID,
    medication_id: uuid.UUID | str | None,
    taken_at: str,
    scheduled_for: str | None = None,
    dose_taken: float | None = None,
    dose_unit: str | None = None,
    status: str = "TAKEN",
    notes: str | None = None,
    # P1: visit linkage for OCCURRED_DURING (optional, backward compatible).
    visit_id: uuid.UUID | str | None = None,
    # P3: daily-checkin free-text path carries a stated name but no regimen
    # link. RESULTS_FROM is omitted then (no order evidence); the projection
    # links TAKEN_FROM to the canonical name node instead.
    medication_name: str | None = None,
) -> None:
    """
    Enqueue a MedicationTakenEvent for projection into Neo4j.
    """
    payload = {
        "patient_id": str(patient_id),
        "event_id": str(event_id),
        "taken_at": taken_at,
        "scheduled_for": scheduled_for,
        "dose_taken": dose_taken,
        "dose_unit": dose_unit,
        "status": status,
        "notes": notes,
    }
    if medication_id is not None:
        payload["medication_id"] = str(medication_id)
    if visit_id is not None:
        payload["visit_id"] = str(visit_id)
    if medication_name is not None:
        payload["medication_name"] = medication_name
    db.add(
        GraphSyncOutbox(
            event_type=OutboxEventType.MEDICATION_TAKEN_RECORDED,
            payload=payload,
        )
    )


def enqueue_visit(
    db,
    visit_id: uuid.UUID,
    patient_id: uuid.UUID,
    visit_date: str,
    visit_type: str,
    reason: str | None = None,
    source: str | None = None,
) -> None:
    """Enqueue a Visit for projection (idempotent MERGE on visit_id)."""
    db.add(
        GraphSyncOutbox(
            event_type=OutboxEventType.VISIT_RECORDED,
            payload={
                "patient_id": str(patient_id),
                "visit_id": str(visit_id),
                "visit_date": visit_date,
                "visit_type": visit_type,
                "reason": reason,
                "source": source,
            },
        )
    )


def enqueue_condition(
    db,
    condition_id: uuid.UUID,
    patient_id: uuid.UUID,
    name: str,
    normalized_name: str,
    polarity: str = "positive",
    assertion_verification: str = "unconfirmed",
    experiencer: str = "patient",
    clinical_status: str | None = None,
    source_type: str = "PATIENT_REPORTED",
    verification_status: str = "UNVERIFIED",
    terminology: str | None = None,
    code: str | None = None,
    display_name: str | None = None,
    onset_date: str | None = None,
    recorded_at: str | None = None,
    document_id: uuid.UUID | str | None = None,
    event_id: uuid.UUID | str | None = None,
    evidence_text: str | None = None,
    visit_id: uuid.UUID | str | None = None,
    # P5 recency guard (optional; see enqueue_clinical_event).
    pg_updated_at: str | None = None,
) -> None:
    """Enqueue a ConditionOccurrence for projection (idempotent MERGE)."""
    payload = {
        "patient_id": str(patient_id),
        "condition_id": str(condition_id),
        "name": name,
        "normalized_name": normalized_name,
        "polarity": polarity,
        "assertion_verification": assertion_verification,
        "experiencer": experiencer,
        "clinical_status": clinical_status,
        "source_type": source_type,
        "verification_status": verification_status,
        "terminology": terminology,
        "code": code,
        "display_name": display_name,
        "onset_date": onset_date,
        "recorded_at": recorded_at,
        "evidence_text": evidence_text,
    }
    if document_id is not None:
        payload["document_id"] = str(document_id)
    if event_id is not None:
        payload["event_id"] = str(event_id)
    if visit_id is not None:
        payload["visit_id"] = str(visit_id)
    if pg_updated_at is not None:
        payload["pg_updated_at"] = pg_updated_at
    db.add(
        GraphSyncOutbox(
            event_type=OutboxEventType.CONDITION_RECORDED,
            payload=payload,
        )
    )


def enqueue_statement(
    db,
    statement_id: uuid.UUID,
    patient_id: uuid.UUID,
    original_text: str,
    normalized_topic: str | None = None,
    source: str = "manual",
    about_condition_id: uuid.UUID | str | None = None,
    source_medication_id: uuid.UUID | str | None = None,
    visit_id: uuid.UUID | str | None = None,
    recorded_at: str | None = None,
) -> None:
    """Enqueue a PatientStatement for projection (idempotent MERGE)."""
    payload = {
        "patient_id": str(patient_id),
        "statement_id": str(statement_id),
        "original_text": original_text,
        "normalized_topic": normalized_topic,
        "source": source,
        "recorded_at": recorded_at,
    }
    if about_condition_id is not None:
        payload["about_condition_id"] = str(about_condition_id)
    if source_medication_id is not None:
        payload["source_medication_id"] = str(source_medication_id)
    if visit_id is not None:
        payload["visit_id"] = str(visit_id)
    db.add(
        GraphSyncOutbox(
            event_type=OutboxEventType.STATEMENT_RECORDED,
            payload=payload,
        )
    )


def enqueue_measurement(
    db,
    measurement_id: uuid.UUID,
    patient_id: uuid.UUID,
    name: str,
    series_key: str,
    value_number: float | None = None,
    value_text: str = "",
    unit: str | None = None,
    range_low: float | None = None,
    range_high: float | None = None,
    range_text: str | None = None,
    interpretation: str = "unknown",
    abnormal_flag: str | None = None,
    terminology: str | None = None,
    code: str | None = None,
    display_name: str | None = None,
    measured_at: str | None = None,
    recorded_at: str | None = None,
    method: str | None = None,
    device: str | None = None,
    source_type: str = "LAB_REPORT",
    verification_status: str = "UNVERIFIED",
    polarity: str = "positive",
    experiencer: str = "patient",
    event_id: uuid.UUID | str | None = None,
    document_id: uuid.UUID | str | None = None,
    evidence_text: str | None = None,
    visit_id: uuid.UUID | str | None = None,
) -> None:
    """Enqueue a Measurement for projection (idempotent MERGE on measurement_id)."""
    payload = {
        "patient_id": str(patient_id),
        "measurement_id": str(measurement_id),
        "name": name,
        "series_key": series_key,
        "value_number": value_number,
        "value_text": value_text,
        "unit": unit,
        "range_low": range_low,
        "range_high": range_high,
        "range_text": range_text,
        "interpretation": interpretation,
        "abnormal_flag": abnormal_flag,
        "terminology": terminology,
        "code": code,
        "display_name": display_name,
        "measured_at": measured_at,
        "recorded_at": recorded_at,
        "method": method,
        "device": device,
        "source_type": source_type,
        "verification_status": verification_status,
        "polarity": polarity,
        "experiencer": experiencer,
        "evidence_text": evidence_text,
    }
    if event_id is not None:
        payload["event_id"] = str(event_id)
    if document_id is not None:
        payload["document_id"] = str(document_id)
    if visit_id is not None:
        payload["visit_id"] = str(visit_id)
    db.add(
        GraphSyncOutbox(
            event_type=OutboxEventType.MEASUREMENT_RECORDED,
            payload=payload,
        )
    )


def enqueue_medication_version(
    db,
    version_id: uuid.UUID,
    medication_id: uuid.UUID,
    patient_id: uuid.UUID,
    version_number: int,
    snapshot: dict,
    change_reason: str | None = None,
    recorded_at: str | None = None,
    supersedes_version_id: uuid.UUID | str | None = None,
) -> None:
    """Enqueue a regimen version for projection (idempotent MERGE on version_id)."""
    payload = {
        "patient_id": str(patient_id),
        "version_id": str(version_id),
        "medication_id": str(medication_id),
        "version_number": version_number,
        "snapshot": snapshot,
        "change_reason": change_reason,
        "recorded_at": recorded_at,
    }
    if supersedes_version_id is not None:
        payload["supersedes_version_id"] = str(supersedes_version_id)
    db.add(
        GraphSyncOutbox(
            event_type=OutboxEventType.MEDICATION_VERSION_RECORDED,
            payload=payload,
        )
    )


def enqueue_sleep(
    db,
    event_id: uuid.UUID,
    patient_id: uuid.UUID,
    duration_minutes: int,
    sleep_quality: int | None = None,
    awakenings: int | None = None,
    event_time: str | None = None,
    visit_id: uuid.UUID | str | None = None,
) -> None:
    """Enqueue a sleep episode for projection (idempotent MERGE on event_id)."""
    payload = {
        "patient_id": str(patient_id),
        "event_id": str(event_id),
        "duration_minutes": duration_minutes,
        "sleep_quality": sleep_quality,
        "awakenings": awakenings,
        "event_time": event_time,
    }
    if visit_id is not None:
        payload["visit_id"] = str(visit_id)
    db.add(GraphSyncOutbox(event_type=OutboxEventType.SLEEP_RECORDED, payload=payload))


def enqueue_activity(
    db,
    event_id: uuid.UUID,
    patient_id: uuid.UUID,
    activity_type: str,
    duration_minutes: int | None = None,
    calories_burned: float | None = None,
    event_time: str | None = None,
    visit_id: uuid.UUID | str | None = None,
) -> None:
    """Enqueue an activity event for projection (idempotent MERGE on event_id)."""
    payload = {
        "patient_id": str(patient_id),
        "event_id": str(event_id),
        "activity_type": activity_type,
        "duration_minutes": duration_minutes,
        "calories_burned": calories_burned,
        "event_time": event_time,
    }
    if visit_id is not None:
        payload["visit_id"] = str(visit_id)
    db.add(GraphSyncOutbox(event_type=OutboxEventType.ACTIVITY_RECORDED, payload=payload))


def enqueue_nutrition(
    db,
    event_id: uuid.UUID,
    patient_id: uuid.UUID,
    water_ml: int | None = None,
    meals_count: int | None = None,
    appetite_level: int | None = None,
    calories_kcal: int | None = None,
    food_label: str | None = None,
    event_time: str | None = None,
    visit_id: uuid.UUID | str | None = None,
) -> None:
    """Enqueue a nutrition intake for projection (idempotent MERGE on event_id)."""
    payload = {
        "patient_id": str(patient_id),
        "event_id": str(event_id),
        "water_ml": water_ml,
        "meals_count": meals_count,
        "appetite_level": appetite_level,
        "calories_kcal": calories_kcal,
        "food_label": food_label,
        "event_time": event_time,
    }
    if visit_id is not None:
        payload["visit_id"] = str(visit_id)
    db.add(GraphSyncOutbox(event_type=OutboxEventType.NUTRITION_RECORDED, payload=payload))


def enqueue_food_scan(
    db,
    scan_id: uuid.UUID,
    patient_id: uuid.UUID,
    entries: list,
    total_kcal: int | None = None,
    overall_confidence: str | None = None,
    status: str = "ai_estimated",
    model: str | None = None,
    model_version: str | None = None,
    meal_type: str | None = None,
    recorded_at: str | None = None,
    visit_id: uuid.UUID | str | None = None,
) -> None:
    """Enqueue a food scan + entries (each entry carries its entry_id for
    idempotent MERGE; the projection UNWINDs the entries array)."""
    payload = {
        "patient_id": str(patient_id),
        "scan_id": str(scan_id),
        "entries": entries,
        "total_kcal": total_kcal,
        "overall_confidence": overall_confidence,
        "status": status,
        "model": model,
        "model_version": model_version,
        "meal_type": meal_type,
        "recorded_at": recorded_at,
    }
    if visit_id is not None:
        payload["visit_id"] = str(visit_id)
    db.add(GraphSyncOutbox(event_type=OutboxEventType.FOOD_SCAN_RECORDED, payload=payload))


def enqueue_ppg(
    db,
    measurement_id: uuid.UUID,
    patient_id: uuid.UUID,
    measurement_type: str,
    heart_rate_bpm: float | None = None,
    rmssd_ms: float | None = None,
    sdnn_ms: float | None = None,
    signal_quality: float | None = None,
    reliable: bool = False,
    duration_seconds: int | None = None,
    algorithm_version: str | None = None,
    model_version: str | None = None,
    sampling_rate_hz: float | None = None,
    measured_at: str | None = None,
    has_rr_intervals: bool = False,
    visit_id: uuid.UUID | str | None = None,
) -> None:
    """Enqueue a PPG/rPPG session (idempotent MERGE on measurement_id).

    Raw waveforms/RR lists stay in PostgreSQL; only scalar metadata +
    a has_rr_intervals flag project to Neo4j.
    """
    payload = {
        "patient_id": str(patient_id),
        "measurement_id": str(measurement_id),
        "measurement_type": measurement_type,
        "heart_rate_bpm": heart_rate_bpm,
        "rmssd_ms": rmssd_ms,
        "sdnn_ms": sdnn_ms,
        "signal_quality": signal_quality,
        "reliable": reliable,
        "duration_seconds": duration_seconds,
        "algorithm_version": algorithm_version,
        "model_version": model_version,
        "sampling_rate_hz": sampling_rate_hz,
        "measured_at": measured_at,
        "has_rr_intervals": has_rr_intervals,
    }
    if visit_id is not None:
        payload["visit_id"] = str(visit_id)
    db.add(GraphSyncOutbox(event_type=OutboxEventType.PPG_RECORDED, payload=payload))


# P5 lifecycle: labels eligible for retirement deletes. ONLY event-keyed,
# patient-owned nodes whose PG row was deleted by a correction. Shared
# reference nodes (Concept, AnatomicalStructure, canonical Medication),
# grouping nodes (Visit), and deduped clinical rows (ConditionOccurrence,
# MedicationRequest, Medication) are NEVER retired by this path.
# P8.1: "Observation" admitted for auto-derived observations only — the
# 1:1 artifacts the mapper creates per event (observation.source_id ==
# event id). The worker's patient-reachability guard still applies, so a
# shared/manual observation can never match.
RETIREABLE_NODE_LABELS = frozenset(
    {
        "TimelineEvent",
        "SleepEpisode",
        "ActivityEvent",
        "NutritionIntake",
        "MedicationTakenEvent",
        "Measurement",
        "PatientStatement",
        "Observation",
    }
)


def enqueue_graph_node_retired(
    db,
    patient_id: uuid.UUID,
    node_label: str,
    node_id: uuid.UUID | str,
    reason: str = "correction",
) -> None:
    """Enqueue a scoped Neo4j node retirement (idempotent delete).

    The worker detaches ONLY a node with this exact id + allow-listed label
    that is directly reachable from this patient. Replays and already-absent
    nodes are no-ops. Raises PermanentProjectionError (→ DEAD_LETTER, no
    retry storm) for non-allow-listed labels.
    """
    db.add(
        GraphSyncOutbox(
            event_type=OutboxEventType.GRAPH_NODE_RETIRED,
            payload={
                "patient_id": str(patient_id),
                "node_label": node_label,
                "node_id": str(node_id),
                "reason": reason,
            },
        )
    )