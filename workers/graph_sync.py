"""This module implements a Celery task to drain the GraphSyncOutbox table and project events into Neo4j.
It handles both transient and permanent failures, with exponential backoff for retries."""
import logging
import os
import random
import re
from datetime import date as _date
from datetime import datetime, timezone, timedelta
from core.celery_app import celery_app
from sqlalchemy.orm import Session
from sqlalchemy import select, or_, and_
from neo4j.exceptions import AuthError, ServiceUnavailable, SessionExpired

from core.db import SessionLocal
from core.neo4j_client import neo4j_driver
from models.outbox import GraphSyncOutbox, OutboxStatus, OutboxEventType

from logger import logger


# P9 temporal containers: patient-scoped Day nodes + HAS_DAY/HAS_EVENT.
# Day id is ALWAYS "<patient_id>:<YYYY-MM-DD>" — never a bare date, so no
# shared/global Day node can ever bridge two patients.
_DAY_DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})")


def _day_identity(patient_id, date_value) -> tuple[str, str] | None:
    """Deterministic Day identity from a payload date (P9, pure).

    Returns (day_id, day_date) or None when the value carries no usable
    calendar date. Accepts date/datetime/ISO strings (bare dates and
    full timestamps; the calendar-date prefix wins — no TZ conversion,
    stored times are UTC ISO). Unparseable input yields None so the
    event still projects, only without a Day link (fail-safe).
    """
    if date_value is None:
        return None
    if isinstance(date_value, datetime):
        day = date_value.date().isoformat()
    elif isinstance(date_value, _date):
        day = date_value.isoformat()
    else:
        match = _DAY_DATE_RE.match(str(date_value).strip())
        if not match:
            return None
        day = match.group(1)
        try:
            _date.fromisoformat(day)
        except ValueError:
            return None
    pid = str(patient_id or "")
    if not pid or ":" in pid:
        return None
    return (f"{pid}:{day}", day)


def _day_link_cypher(subject_var: str) -> str:
    """Day-container fragment appended to event projectors (P9).

    MERGEs the patient-scoped Day, links Patient-HAS_DAY and
    Day-HAS_EVENT, and moves membership on date corrections by deleting
    stale HAS_EVENT edges from OTHER days (replay on the same day is a
    no-op). Ends in MERGE (never a bare WITH — see P8 live guards).
    Callers must have (p:Patient) and the subject var in scope and
    provide $day_id/$day_date (see _attach_day).
    """
    return (
        f" MERGE (day:Day {{id: $day_id}})"
        f" SET day.date = $day_date, day.patient_id = $patient_id"
        f" MERGE (p)-[:HAS_DAY]->(day)"
        f" OPTIONAL MATCH (old_day:Day)-[old_rel:HAS_EVENT]->({subject_var})"
        f" WHERE old_day.id <> $day_id"
        f" DELETE old_rel"
        f" MERGE (day)-[:HAS_EVENT]->({subject_var})"
    )


def _attach_day(cypher: str, parameters: dict, subject_var: str, date_value):
    """Append the Day fragment when the payload date is usable (P9).

    Mutates parameters (day_id/day_date) and returns the extended query.
    Returns cypher unchanged when no calendar date can be derived, so
    dateless replays/projections keep working exactly as before.
    """
    ident = _day_identity(parameters.get("patient_id"), date_value)
    if ident is None:
        return cypher
    day_id, day_date = ident
    parameters["day_id"] = day_id
    parameters["day_date"] = day_date
    return cypher + _day_link_cypher(subject_var)


def _concept_edges_enabled() -> bool:
    """P0 Concept-lite flag. Shared Concept nodes are TERMINAL for traversal."""
    try:
        from core.config import settings

        if settings.GRAPH_CONCEPT_EDGES_ENABLED:
            return True
    except Exception:
        pass
    return os.environ.get("GRAPH_CONCEPT_EDGES_ENABLED", "false").lower() in ("1", "true", "yes")


def _visit_edge_cypher(subject_var: str) -> str:
    """P1 shared fragment: link a patient-owned node to its Visit.

    Creates (p)-[:HAS_VISIT]->(v:Visit) + (subject)-[:OCCURRED_DURING]->(v).
    The Visit node's full properties are filled by _project_visit_tx; here
    MERGE-by-id is a safe idempotent placeholder. Callers append this only
    when payload.visit_id is present (backward compatible).
    """
    return (
        " MERGE (v:Visit {id: $visit_id})"
        " MERGE (p)-[:HAS_VISIT]->(v)"
        f" MERGE ({subject_var})-[:OCCURRED_DURING]->(v)"
    )


# Validation schemas for each outbox event type
REQUIRED_CLINICAL_EVENT_KEYS = {
    "patient_id", "event_id", "event_type",
    "source_type", "verification_status",
    "event_time", "level_number",
}

MAX_RETRIES = 5
BACKOFF_BASE_SECONDS = 10
STALE_LEASE_MINUTES = 5

REQUIRED_OBSERVATION_KEYS = {
    "patient_id", "observation_id", "structure_id",
    "finding_code", "visual_severity_score", "recorded_at", "source_type",
    "level_number"
}

REQUIRED_CONDITION_KEYS = {
    "patient_id", "condition_id", "name", "normalized_name",
}

REQUIRED_VISIT_KEYS = {
    "patient_id", "visit_id", "visit_date", "visit_type",
}

REQUIRED_STATEMENT_KEYS = {
    "patient_id", "statement_id", "original_text",
}

REQUIRED_MEASUREMENT_KEYS = {
    "patient_id", "measurement_id", "name", "series_key", "value_text",
}

REQUIRED_MEDICATION_VERSION_KEYS = {
    "patient_id", "version_id", "medication_id", "version_number",
}

REQUIRED_SLEEP_KEYS = {
    "patient_id", "event_id", "duration_minutes",
}

REQUIRED_ACTIVITY_KEYS = {
    "patient_id", "event_id", "activity_type",
}

REQUIRED_NUTRITION_KEYS = {
    "patient_id", "event_id",
}

REQUIRED_FOOD_SCAN_KEYS = {
    "patient_id", "scan_id", "entries",
}

REQUIRED_PPG_KEYS = {
    "patient_id", "measurement_id", "measurement_type",
}

class PermanentProjectionError(Exception):
    """Raised for malformed payloads or invalid routing."""
    pass



def _drop_erased_patient_events(db, events):
    """Drop claimed outbox events whose patient row is gone (erased).

    Returns the live events. Best-effort: if the liveness check itself
    cannot run, keeps everything (the erasure repass + PG residual gate
    remain the guarantee).
    """
    # P15 erasure fence: never project events for erased patients —
    # retrying would resurrect graph data the patient deleted, and the
    # erasure repass sweeps the rows.
    from models.identity import Patient
    try:
        live_ids = {
            str(row[0]) for row in db.query(Patient.patient_id).all()
        }
    except Exception:
        return events
    live_events = []
    for event in events:
        pid = (event.payload or {}).get("patient_id")
        if pid is None or str(pid) in live_ids:
            live_events.append(event)
        else:
            event.status = OutboxStatus.DEAD_LETTER
            event.last_error = "patient erased; projection dropped"
            event.locked_at = None
    db.commit()
    return live_events


def _process_outbox_events(db: Session, driver, batch_size: int = 50):
    now = datetime.now(timezone.utc)
    stale_threshold = now - timedelta(minutes=STALE_LEASE_MINUTES)
    
    # 1. Claim pending OR recover stale leases safely
    query = select(GraphSyncOutbox).where(
        or_(
            and_(GraphSyncOutbox.status == OutboxStatus.PENDING, GraphSyncOutbox.next_attempt_at <= now),
            and_(
                GraphSyncOutbox.status == OutboxStatus.PROCESSING, 
                GraphSyncOutbox.locked_at < stale_threshold,
                GraphSyncOutbox.locked_at.is_not(None)
            )
        )
    ).order_by(GraphSyncOutbox.next_attempt_at).limit(batch_size).with_for_update(skip_locked=True)
    
    events = db.execute(query).scalars().all()
    if not events:
        return

    for event in events:
        event.status = OutboxStatus.PROCESSING
        event.locked_at = now
    db.commit()

    events = _drop_erased_patient_events(db, events)
    if not events:
        return

    #Process against Neo4j
    # P7: commit per event (not once per batch) so a crash, poison row, or
    # slow projection stalls only its own row: siblings keep their terminal
    # state instead of rolling back to PROCESSING for the 5-minute lease.
    # Transient failures `continue` so one bad row never blocks the batch.
    with driver.session() as neo4j_session:
        for event in events:
            try:
                # Explicitly route event types (or fail permanently)
                if event.event_type == OutboxEventType.OBSERVATION_RECORDED:
                    neo4j_session.execute_write(_project_observation_tx, event.payload)
                elif event.event_type == OutboxEventType.CLINICAL_EVENT_RECORDED:
                    neo4j_session.execute_write(_project_clinical_event_tx, event.payload)
                elif event.event_type == OutboxEventType.MEDICATION_RECORDED:
                    neo4j_session.execute_write(_project_medication_tx, event.payload)
                elif event.event_type == OutboxEventType.MEDICATION_TAKEN_RECORDED:
                    neo4j_session.execute_write(_project_medication_taken_tx, event.payload)
                elif event.event_type == OutboxEventType.CONDITION_RECORDED:
                    neo4j_session.execute_write(_project_condition_tx, event.payload)
                elif event.event_type == OutboxEventType.VISIT_RECORDED:
                    neo4j_session.execute_write(_project_visit_tx, event.payload)
                elif event.event_type == OutboxEventType.STATEMENT_RECORDED:
                    neo4j_session.execute_write(_project_statement_tx, event.payload)
                elif event.event_type == OutboxEventType.MEASUREMENT_RECORDED:
                    neo4j_session.execute_write(_project_measurement_tx, event.payload)
                elif event.event_type == OutboxEventType.MEDICATION_VERSION_RECORDED:
                    neo4j_session.execute_write(_project_medication_version_tx, event.payload)
                elif event.event_type == OutboxEventType.SLEEP_RECORDED:
                    neo4j_session.execute_write(_project_sleep_tx, event.payload)
                elif event.event_type == OutboxEventType.ACTIVITY_RECORDED:
                    neo4j_session.execute_write(_project_activity_tx, event.payload)
                elif event.event_type == OutboxEventType.NUTRITION_RECORDED:
                    neo4j_session.execute_write(_project_nutrition_tx, event.payload)
                elif event.event_type == OutboxEventType.FOOD_SCAN_RECORDED:
                    neo4j_session.execute_write(_project_food_scan_tx, event.payload)
                elif event.event_type == OutboxEventType.PPG_RECORDED:
                    neo4j_session.execute_write(_project_ppg_tx, event.payload)
                elif event.event_type == OutboxEventType.GRAPH_NODE_RETIRED:
                    neo4j_session.execute_write(_project_node_retired_tx, event.payload)
                else:
                    raise PermanentProjectionError(f"Unsupported outbox event type: {event.event_type}")

                # Success
                event.status = OutboxStatus.PROCESSED
                event.processed_at = datetime.now(timezone.utc)
                event.locked_at = None
                event.last_error = None
                db.commit()

            except PermanentProjectionError as e:
                logger.error(f"Permanent projection failure for event {event.id}: {e}")
                event.status = OutboxStatus.DEAD_LETTER
                event.last_error = str(e)
                event.locked_at = None
                db.commit()

            except (ServiceUnavailable, SessionExpired) as e:
                _handle_transient_failure(event, e, "Neo4j transient error")
                db.commit()
                continue

            except AuthError as e:
                # P7: bad credentials can never self-heal — dead-letter
                # immediately instead of burning 5 retries.
                logger.error(f"Neo4j auth failure for event {event.id}: {e}")
                event.status = OutboxStatus.DEAD_LETTER
                event.last_error = f"auth: {e}"
                event.locked_at = None
                db.commit()
                continue

            except Exception as e:
                logger.critical(f"Unknown exception during projection for event {event.id}: {e}. Defaulting to retry.")
                _handle_transient_failure(event, e, "Unknown exception")
                db.commit()
                continue

# P7: bound to celery_app (not shared_task) so the worker's ack-late,
# prefetch, queue, and time-limit configuration actually applies to the
# outbox drain. Time limits bound a hung Neo4j projection instead of
# holding the worker slot indefinitely under acks_late.
@celery_app.task(
    name="workers.graph_sync.drain_graph_outbox",
    time_limit=900,
    soft_time_limit=600,
)
def drain_graph_outbox():
    db = SessionLocal()
    try:
        _process_outbox_events(db, neo4j_driver)
    finally:
        db.close()


def _handle_transient_failure(event: GraphSyncOutbox, error: Exception, context: str):
    logger.warning(f"{context} for event {event.id}: {error}")
    event.attempt_count += 1
    event.last_error = str(error)
    event.locked_at = None
    
    if event.attempt_count >= MAX_RETRIES:
        event.status = OutboxStatus.DEAD_LETTER
    else:
        event.status = OutboxStatus.PENDING
        delay_seconds = BACKOFF_BASE_SECONDS * (2 ** (event.attempt_count - 1))
        jitter = random.uniform(0, 0.2 * delay_seconds)
        event.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=delay_seconds + jitter)


def _project_observation_tx(tx, payload: dict):
    # Strict validation before Cypher execution
    missing_keys = REQUIRED_OBSERVATION_KEYS - set(payload.keys())
    if missing_keys:
        raise PermanentProjectionError(f"Payload missing required keys: {missing_keys}")
        
    cypher = """
    MERGE (p:Patient {id: $patient_id})
    MERGE (s:AnatomicalStructure {id: $structure_id})
    MERGE (o:Observation {id: $observation_id})
    
    SET o.finding_code = $finding_code,
        o.visual_severity_score = $visual_severity_score,
        o.recorded_at = $recorded_at,
        o.source_type = $source_type,
        o.polarity = $polarity,
        o.experiencer = $experiencer,
        o.source_snippet = $source_snippet

    MERGE (p)-[:HAS_OBSERVATION]->(o)
    MERGE (o)-[:AFFECTS]->(s)
    """
    
    # P0 keys are optional so pre-P0 outbox rows keep projecting unchanged.
    parameters = dict(payload)
    parameters.setdefault("polarity", "positive")
    parameters.setdefault("experiencer", "patient")
    parameters.setdefault("source_snippet", None)
    if payload.get("document_id"):
        # Dual-write: SOURCE_DOCUMENT (legacy, read-compatible) +
        # DOCUMENTED_IN (P0 canonical). Readers accept both.
        cypher += (
            " MERGE (d:Document {id: $document_id})"
            " MERGE (o)-[:SOURCE_DOCUMENT]->(d)"
            " MERGE (o)-[:DOCUMENTED_IN]->(d)"
        )
    if payload.get("event_id"):
        cypher += """
        MERGE (t:TimelineEvent {id: $event_id})
        SET t.date = $recorded_at,
            t.level_number = $level_number
        MERGE (p)-[:HAS_TIMELINE_EVENT]->(t)
        MERGE (o)-[:LOGGED_ON]->(t)
        """
    if payload.get("visit_id"):
        # P1: deterministic encounter grouping (backward compatible).
        cypher += _visit_edge_cypher("o")

    result = tx.run(cypher, **parameters)
    result.consume() # Ensures the transaction fully executes


def _project_clinical_event_tx(tx, payload: dict):
    """Project a general ClinicalEvent into a TimelineEvent node in Neo4j.

    Creates:
        (:Patient {id})-[:HAS_TIMELINE_EVENT]->(:TimelineEvent {id})

    P0 additions (all optional/backward compatible):
        (:TimelineEvent)-[:DOCUMENTED_IN]->(:Document)  (when document_id present)
        (:TimelineEvent)-[:HAS_CODE]->(:Concept)  (only when the
            GRAPH_CONCEPT_EDGES_ENABLED flag is on and the payload carries
            a normalized {system, code}; Concept is TERMINAL for traversal)

    Uses MERGE for idempotency: reprocessing the same outbox event will
    never create duplicate nodes or relationships.
    """
    missing_keys = REQUIRED_CLINICAL_EVENT_KEYS - set(payload.keys())
    if missing_keys:
        raise PermanentProjectionError(
            f"Clinical event payload missing required keys: {missing_keys}"
        )

    cypher = """
    MERGE (p:Patient {id: $patient_id})
    MERGE (t:TimelineEvent {id: $event_id})
    MERGE (p)-[:HAS_TIMELINE_EVENT]->(t)
    WITH p, t
    // P5 recency guard: prop SETs apply only when the stored node is
    // unstamped (pre-P5) or not newer than the incoming PG row. Structural
    // MERGEs above stay unconditional (idempotent). ISO-8601 strings
    // compare chronologically.
    WHERE t.pg_updated_at IS NULL OR $pg_updated_at IS NULL
       OR t.pg_updated_at <= $pg_updated_at
    SET t.pg_updated_at = coalesce($pg_updated_at, t.pg_updated_at),
        t.date         = $event_time,
        t.event_time   = $event_time,
        t.event_type   = $event_type,
        t.source_type  = $source_type,
        t.verification_status = $verification_status,
        t.level_number = $level_number,
        t.polarity = $polarity,
        t.assertion_verification = $assertion_verification,
        t.experiencer = $experiencer,
        t.clinical_status = $clinical_status,
        t.source_snippet = $source_snippet,
        t.evidence_text = $evidence_text,
        t.extraction_method = $extraction_method,
        t.extraction_model = $extraction_model,
        t.extraction_model_version = $extraction_model_version,
        t.match_confidence = $match_confidence,
        t.match_status = $match_status
    """
    # NOTE (P8): no trailing no-op WITH here. Neo4j 2026 (GQL conformance)
    # rejects queries that conclude with WITH; the optional suffixes below
    # only MERGE/SET on in-scope vars so no carrier is needed.

    # P0 keys are optional so pre-P0 outbox rows keep projecting unchanged.
    parameters = dict(payload)
    parameters.setdefault("pg_updated_at", None)  # P5 recency guard (None = always apply).
    parameters.setdefault("polarity", "positive")
    parameters.setdefault("assertion_verification", "unconfirmed")
    parameters.setdefault("experiencer", "patient")
    parameters.setdefault("clinical_status", None)
    parameters.setdefault("source_snippet", None)
    parameters.setdefault("evidence_text", None)
    parameters.setdefault("extraction_method", None)
    parameters.setdefault("extraction_model", None)
    parameters.setdefault("extraction_model_version", None)
    parameters.setdefault("match_confidence", None)
    parameters.setdefault("match_status", None)

    if payload.get("document_id"):
        # Canonical provenance link for timeline events (new in P0; no
        # legacy equivalent existed for this path).
        cypher += (
            " MERGE (d:Document {id: $document_id})"
            " MERGE (t)-[:DOCUMENTED_IN]->(d)"
        )
        parameters.setdefault("document_id", payload.get("document_id"))

    if payload.get("visit_id"):
        # P1: deterministic encounter grouping (backward compatible).
        cypher += _visit_edge_cypher("t")

    if (
        _concept_edges_enabled()
        and payload.get("concept_system")
        and payload.get("concept_code")
    ):
        # P0 Concept-lite: shared terminology node, TERMINAL for traversal
        # (never traverse out of :Concept — see health_graph.py).
        # MERGE key is {system, code} — never display strings.
        cypher += (
            " MERGE (c:Concept {system: $concept_system, code: $concept_code})"
            " SET c.display = $concept_display"
            " MERGE (t)-[:HAS_CODE]->(c)"
        )
        parameters.setdefault("concept_display", payload.get("concept_display"))

    # P9: patient-scoped Day container (additive; skipped when dateless).
    cypher = _attach_day(cypher, parameters, "t", payload.get("event_time"))

    result = tx.run(cypher, **parameters)
    result.consume()


def _project_medication_tx(tx, payload: dict):
    """Project a Medication into Medication + MedicationRequest nodes.

    P1 split (dual-write, backward compatible) + P5 lifecycle:
    - Legacy: (:Patient)-[:ACTIVE_MEDICATION]->(:Medication {id}) with the
      full regimen props — but ONLY while the regimen is non-terminal.
      Terminal statuses (DISCONTINUED, COMPLETED) remove the ACTIVE edge
      (idempotent DELETE); the Request edge below persists as order history.
    - (full P1 list unchanged; see git history for the original docstring)

    P5 recency guard: prop SETs + edge maintenance apply only when the
    stored nodes are unstamped or not newer than the incoming PG row.

    Uses MERGE for idempotency.
    """
    from services.ocr.term_normalization import MedicalTermNormalizer

    norm_key = (
        MedicalTermNormalizer.lexical_text(payload.get("generic_name") or payload.get("name") or "")
        or (payload.get("generic_name") or payload.get("name") or "").lower()
    )
    cypher = """
    MERGE (p:Patient {id: $patient_id})
    MERGE (m:Medication {id: $medication_id})
    MERGE (req:MedicationRequest {id: $medication_id})
    MERGE (p)-[:HAS_MEDICATION_REQUEST]->(req)
    MERGE (cm:Medication {norm_key: $norm_key})
    SET cm.display_name = $canonical_display
    MERGE (req)-[:PRESCRIBES]->(cm)
    WITH p, m, req
    WHERE m.pg_updated_at IS NULL OR $pg_updated_at IS NULL
       OR m.pg_updated_at <= $pg_updated_at
    SET m.pg_updated_at = coalesce($pg_updated_at, m.pg_updated_at),
        m.name = $name,
        m.generic_name = $generic_name,
        m.brand_name = $brand_name,
        m.strength = $strength,
        m.strength_unit = $strength_unit,
        m.dose_amount = $dose_amount,
        m.dose_unit = $dose_unit,
        m.route = $route,
        m.frequency = $frequency,
        m.scheduled_times = $scheduled_times,
        m.start_date = $start_date,
        m.end_date = $end_date,
        m.status = $status,
        m.purpose = $purpose,
        m.instructions = $instructions,
        m.prescriber = $prescriber,
        m.prn = $prn,
        m.reminder_enabled = $reminder_enabled,
        m.notes = $notes,
        req.pg_updated_at = coalesce($pg_updated_at, req.pg_updated_at),
        req.name = $name,
        req.generic_name = $generic_name,
        req.brand_name = $brand_name,
        req.strength = $strength,
        req.strength_unit = $strength_unit,
        req.dose_amount = $dose_amount,
        req.dose_unit = $dose_unit,
        req.route = $route,
        req.frequency = $frequency,
        req.scheduled_times = $scheduled_times,
        req.start_date = $start_date,
        req.end_date = $end_date,
        req.status = $status,
        req.purpose = $purpose,
        req.instructions = $instructions,
        req.prescriber = $prescriber,
        req.prn = $prn,
        req.reminder_enabled = $reminder_enabled,
        req.notes = $notes
    WITH p, m, req
    // P5: ACTIVE edge reflects the CURRENT regimen only. Terminal statuses
    // detach it; non-terminal statuses ensure it. Both branches are
    // idempotent no-ops on replay (DELETE null is a no-op in Cypher).
    OPTIONAL MATCH (p)-[ar:ACTIVE_MEDICATION]->(m)
    WITH p, m, req, ar
    FOREACH (_ IN CASE WHEN $status IN ['DISCONTINUED', 'COMPLETED'] THEN [ar] ELSE [] END |
        DELETE _
    )
    FOREACH (_ IN CASE WHEN NOT $status IN ['DISCONTINUED', 'COMPLETED'] THEN [1] ELSE [] END |
        MERGE (p)-[:ACTIVE_MEDICATION]->(m)
    )
    """
    # NOTE (P8): no trailing no-op WITH (Neo4j 2026 rejects queries
    # concluding with WITH); suffixes below only MERGE/SET in-scope vars.

    parameters = dict(payload)
    parameters["norm_key"] = norm_key
    parameters["canonical_display"] = payload.get("generic_name") or payload.get("name")
    parameters.setdefault("pg_updated_at", None)

    if payload.get("source_document_id"):
        cypher += (
            " MERGE (d:Document {id: $source_document_id})"
            " MERGE (req)-[:DOCUMENTED_IN]->(d)"
        )
    if payload.get("purpose_condition_id"):
        # Placeholder MERGE-by-id; full props come from _project_condition_tx.
        cypher += (
            " MERGE (cond:ConditionOccurrence {id: $purpose_condition_id})"
            " MERGE (req)-[:PRESCRIBED_FOR]->(cond)"
        )
        if payload.get("purpose_condition_name"):
            cypher += " SET cond.name = $purpose_condition_name"
    if payload.get("reason_statement_id"):
        # Placeholder MERGE-by-id; full props come from _project_statement_tx.
        cypher += (
            " MERGE (stmt:PatientStatement {id: $reason_statement_id})"
            " MERGE (req)-[:REASON_STATED_BY_PATIENT]->(stmt)"
        )

    result = tx.run(cypher, **parameters)
    result.consume()


def _project_medication_taken_tx(tx, payload: dict):
    """Project a MedicationTakenEvent into a MedicationTakenEvent node in Neo4j.

    Creates:
        (:Patient {id})-[:HAS_MEDICATION_TAKEN]->(:MedicationTakenEvent {id})
        (:MedicationTakenEvent {id})-[:TAKEN_FROM]->(:Medication {id})

    P1 additions (backward compatible, only when the keys are present):
        (:MedicationTakenEvent)-[:RESULTS_FROM]->(:MedicationRequest {id})
            (administration linked to its order; request node is a
            placeholder MERGE-by-id filled by _project_medication_tx)
        (:MedicationTakenEvent)-[:OCCURRED_DURING]->(:Visit)

    Uses MERGE for idempotency.
    """
    cypher = """
    MERGE (p:Patient {id: $patient_id})
    MERGE (e:MedicationTakenEvent {id: $event_id})
    SET e.taken_at = $taken_at,
        e.scheduled_for = $scheduled_for,
        e.dose_taken = $dose_taken,
        e.dose_unit = $dose_unit,
        e.status = $status,
        e.notes = $notes
    MERGE (p)-[:HAS_MEDICATION_TAKEN]->(e)
    """
    parameters = dict(payload)
    if payload.get("medication_id"):
        cypher += (
            " MERGE (m:Medication {id: $medication_id})"
            " MERGE (e)-[:TAKEN_FROM]->(m)"
            " MERGE (req:MedicationRequest {id: $medication_id})"
            " MERGE (e)-[:RESULTS_FROM]->(req)"
        )
    elif payload.get("medication_name"):
        # P3 daily free-text path: link by canonical NAME only (USER_REPORTED
        # mention). No regimen evidence → no RESULTS_FROM, and adherence
        # templates (which match Medication{id}) are unaffected.
        from services.ocr.term_normalization import MedicalTermNormalizer

        cypher += (
            " MERGE (cm:Medication {norm_key: $medication_norm_key})"
            " SET cm.display_name = $medication_name"
            " MERGE (e)-[:TAKEN_FROM]->(cm)"
        )
        _name = (payload.get("medication_name") or "").strip()
        parameters["medication_norm_key"] = (
            MedicalTermNormalizer.lexical_text(_name) or _name.lower()
        )
    if payload.get("visit_id"):
        cypher += _visit_edge_cypher("e")

    # P9: patient-scoped Day container (taken_at anchor; additive).
    cypher = _attach_day(cypher, parameters, "e", payload.get("taken_at"))

    result = tx.run(cypher, **parameters)
    result.consume()


def _project_condition_tx(tx, payload: dict):
    """Project a ConditionOccurrence node in Neo4j.

    Creates:
        (:Patient)-[:HAS_CONDITION]->(:ConditionOccurrence {id})
        (:ConditionOccurrence)-[:DOCUMENTED_IN]->(:Document)  (when present)
        (:ConditionOccurrence)-[:HAS_CODE]->(:Concept)  (flag-gated, P0 rule)
        (:ConditionOccurrence)-[:OCCURRED_DURING]->(:Visit)  (when present)

    Polarity/experiencer/verification ride on the node so negated, family,
    or hypothetical mentions can never read as confirmed conditions.
    Uses MERGE for idempotency.
    """
    missing_keys = REQUIRED_CONDITION_KEYS - set(payload.keys())
    if missing_keys:
        raise PermanentProjectionError(f"Condition payload missing required keys: {missing_keys}")

    cypher = """
    MERGE (p:Patient {id: $patient_id})
    MERGE (c:ConditionOccurrence {id: $condition_id})
    MERGE (p)-[:HAS_CONDITION]->(c)
    WITH p, c
    // P5 recency guard (same semantics as clinical/medication): prop SETs
    // apply only when the stored node is unstamped or not newer.
    WHERE c.pg_updated_at IS NULL OR $pg_updated_at IS NULL
       OR c.pg_updated_at <= $pg_updated_at
    SET c.pg_updated_at = coalesce($pg_updated_at, c.pg_updated_at),
        c.name = $name,
        c.normalized_name = $normalized_name,
        c.polarity = $polarity,
        c.assertion_verification = $assertion_verification,
        c.experiencer = $experiencer,
        c.clinical_status = $clinical_status,
        c.source_type = $source_type,
        c.verification_status = $verification_status,
        c.terminology = $terminology,
        c.code = $code,
        c.display_name = $display_name,
        c.onset_date = $onset_date,
        c.recorded_at = $recorded_at,
        c.evidence_text = $evidence_text
    """
    # NOTE (P8): no trailing no-op WITH (Neo4j 2026 rejects queries
    # concluding with WITH); suffixes below only MERGE/SET in-scope vars.
    parameters = dict(payload)
    parameters.setdefault("pg_updated_at", None)
    for key in ("polarity", "assertion_verification", "experiencer", "clinical_status",
                "source_type", "verification_status", "terminology", "code",
                "display_name", "onset_date", "recorded_at", "evidence_text"):
        parameters.setdefault(key, None)
    if payload.get("document_id"):
        cypher += (
            " MERGE (d:Document {id: $document_id})"
            " MERGE (c)-[:DOCUMENTED_IN]->(d)"
        )
    if payload.get("visit_id"):
        cypher += _visit_edge_cypher("c")
    if (
        _concept_edges_enabled()
        and payload.get("terminology")
        and payload.get("code")
    ):
        cypher += (
            " MERGE (cc:Concept {system: $terminology, code: $code})"
            " MERGE (c)-[:HAS_CODE]->(cc)"
        )

    result = tx.run(cypher, **parameters)
    result.consume()


def _project_visit_tx(tx, payload: dict):
    """Project a Visit node in Neo4j.

    Creates (:Patient)-[:HAS_VISIT]->(:Visit {id}) with visit_date/type.
    Uses MERGE for idempotency.
    """
    missing_keys = REQUIRED_VISIT_KEYS - set(payload.keys())
    if missing_keys:
        raise PermanentProjectionError(f"Visit payload missing required keys: {missing_keys}")

    cypher = """
    MERGE (p:Patient {id: $patient_id})
    MERGE (v:Visit {id: $visit_id})
    SET v.visit_date = $visit_date,
        v.visit_type = $visit_type,
        v.reason = $reason,
        v.source = $source
    MERGE (p)-[:HAS_VISIT]->(v)
    """
    parameters = dict(payload)
    parameters.setdefault("reason", None)
    parameters.setdefault("source", None)

    # P9: visits also join their calendar Day (visit_date anchor).
    cypher = _attach_day(cypher, parameters, "v", payload.get("visit_date"))

    result = tx.run(cypher, **parameters)
    result.consume()


def _project_statement_tx(tx, payload: dict):
    """Project a PatientStatement node in Neo4j.

    Creates:
        (:Patient)-[:HAS_STATEMENT]->(:PatientStatement {id})
        (:PatientStatement)-[:ABOUT]->(:ConditionOccurrence)  (when present;
            placeholder MERGE-by-id filled by _project_condition_tx)
        (:PatientStatement)-[:OCCURRED_DURING]->(:Visit)  (when present)

    Statements are USER_REPORTED evidence — never diagnoses. Uses MERGE.
    """
    missing_keys = REQUIRED_STATEMENT_KEYS - set(payload.keys())
    if missing_keys:
        raise PermanentProjectionError(f"Statement payload missing required keys: {missing_keys}")

    cypher = """
    MERGE (p:Patient {id: $patient_id})
    MERGE (s:PatientStatement {id: $statement_id})
    SET s.original_text = $original_text,
        s.normalized_topic = $normalized_topic,
        s.source = $source,
        s.recorded_at = $recorded_at
    MERGE (p)-[:HAS_STATEMENT]->(s)
    """
    parameters = dict(payload)
    parameters.setdefault("normalized_topic", None)
    parameters.setdefault("source", "manual")
    parameters.setdefault("recorded_at", None)
    if payload.get("about_condition_id"):
        cypher += (
            " MERGE (ac:ConditionOccurrence {id: $about_condition_id})"
            " MERGE (s)-[:ABOUT]->(ac)"
        )
    if payload.get("visit_id"):
        cypher += _visit_edge_cypher("s")

    result = tx.run(cypher, **parameters)
    result.consume()


def _project_measurement_tx(tx, payload: dict):
    """Project a Measurement node in Neo4j.

    Creates:
        (:Patient)-[:HAS_MEASUREMENT]->(:Measurement {id})
        (:Measurement)-[:DOCUMENTED_IN]->(:Document)  (when present)
        (:Measurement)-[:HAS_CODE]->(:Concept)  (flag-gated, P0 rule)
        (:Measurement)-[:OCCURRED_DURING]->(:Visit)  (when present)

    Repeated readings are separate nodes — longitudinal series are
    ORDER BY measured_at queries (see T-MEASURE-TREND); no materialized
    NEXT chains (out-of-order/backfilled inserts would corrupt them).
    Uses MERGE for idempotency.
    """
    missing_keys = REQUIRED_MEASUREMENT_KEYS - set(payload.keys())
    if missing_keys:
        raise PermanentProjectionError(f"Measurement payload missing required keys: {missing_keys}")

    cypher = """
    MERGE (p:Patient {id: $patient_id})
    MERGE (m:Measurement {id: $measurement_id})
    SET m.name = $name,
        m.series_key = $series_key,
        m.value_number = $value_number,
        m.value_text = $value_text,
        m.unit = $unit,
        m.range_low = $range_low,
        m.range_high = $range_high,
        m.range_text = $range_text,
        m.interpretation = $interpretation,
        m.abnormal_flag = $abnormal_flag,
        m.terminology = $terminology,
        m.code = $code,
        m.display_name = $display_name,
        m.measured_at = $measured_at,
        m.recorded_at = $recorded_at,
        m.method = $method,
        m.device = $device,
        m.source_type = $source_type,
        m.verification_status = $verification_status,
        m.polarity = $polarity,
        m.experiencer = $experiencer,
        m.evidence_text = $evidence_text
    MERGE (p)-[:HAS_MEASUREMENT]->(m)
    """
    parameters = dict(payload)
    for key in ("value_number", "unit", "range_low", "range_high", "range_text",
                "interpretation", "abnormal_flag", "terminology", "code",
                "display_name", "measured_at", "recorded_at", "method", "device",
                "source_type", "verification_status", "polarity", "experiencer",
                "evidence_text"):
        parameters.setdefault(key, None)
    if payload.get("document_id"):
        cypher += (
            " MERGE (d:Document {id: $document_id})"
            " MERGE (m)-[:DOCUMENTED_IN]->(d)"
        )
    if payload.get("visit_id"):
        cypher += _visit_edge_cypher("m")
    if (
        _concept_edges_enabled()
        and payload.get("terminology")
        and payload.get("code")
    ):
        cypher += (
            " MERGE (cc:Concept {system: $terminology, code: $code})"
            " MERGE (m)-[:HAS_CODE]->(cc)"
        )

    result = tx.run(cypher, **parameters)
    result.consume()


def _project_medication_version_tx(tx, payload: dict):
    """Project a regimen version node in Neo4j.

    Creates:
        (:MedicationRequest {id})-[:HAS_VERSION]->(:MedicationVersion {id})
        (:MedicationVersion)-[:SUPERSEDES]->(:MedicationVersion)  (when known)

    The live Request node keeps current props (existing queries unaffected);
    history is traversable directionally through version nodes. The snapshot
    dict is stored as properties are not schemaless-friendly: dose-relevant
    fields are promoted to first-class props, the full snapshot JSON is NOT
    stored on the node (it lives in PostgreSQL medication_versions).
    Uses MERGE for idempotency.
    """
    missing_keys = REQUIRED_MEDICATION_VERSION_KEYS - set(payload.keys())
    if missing_keys:
        raise PermanentProjectionError(f"Medication version payload missing required keys: {missing_keys}")

    snapshot = payload.get("snapshot") or {}
    cypher = """
    MERGE (p:Patient {id: $patient_id})
    MERGE (req:MedicationRequest {id: $medication_id})
    MERGE (ver:MedicationVersion {id: $version_id})
    SET ver.version_number = $version_number,
        ver.dose_amount = $dose_amount,
        ver.dose_unit = $dose_unit,
        ver.frequency = $frequency,
        ver.route = $route,
        ver.status = $status,
        ver.start_date = $start_date,
        ver.end_date = $end_date,
        ver.change_reason = $change_reason,
        ver.recorded_at = $recorded_at
    MERGE (p)-[:HAS_MEDICATION_REQUEST]->(req)
    MERGE (req)-[:HAS_VERSION]->(ver)
    """
    parameters = dict(payload)
    parameters["dose_amount"] = snapshot.get("dose_amount")
    parameters["dose_unit"] = snapshot.get("dose_unit")
    parameters["frequency"] = snapshot.get("frequency")
    parameters["route"] = snapshot.get("route")
    parameters["status"] = snapshot.get("status")
    parameters["start_date"] = snapshot.get("start_date")
    parameters["end_date"] = snapshot.get("end_date")
    parameters.setdefault("change_reason", None)
    parameters.setdefault("recorded_at", None)
    if payload.get("supersedes_version_id"):
        cypher += (
            " MERGE (prev:MedicationVersion {id: $supersedes_version_id})"
            " MERGE (ver)-[:SUPERSEDES]->(prev)"
        )

    result = tx.run(cypher, **parameters)
    result.consume()


def _project_sleep_tx(tx, payload: dict):
    """Project a SleepEpisode node (USER_REPORTED daily data).

    Creates (:Patient)-[:HAS_SLEEP]->(:SleepEpisode {id: event_id}) with
    only the collected fields (duration/quality/awakenings) plus
    OCCURRED_DURING when a visit is present. Uses MERGE for idempotency.
    """
    missing_keys = REQUIRED_SLEEP_KEYS - set(payload.keys())
    if missing_keys:
        raise PermanentProjectionError(f"Sleep payload missing required keys: {missing_keys}")

    cypher = """
    MERGE (p:Patient {id: $patient_id})
    MERGE (s:SleepEpisode {id: $event_id})
    SET s.duration_minutes = $duration_minutes,
        s.sleep_quality = $sleep_quality,
        s.awakenings = $awakenings,
        s.event_time = $event_time
    MERGE (p)-[:HAS_SLEEP]->(s)
    """
    parameters = dict(payload)
    parameters.setdefault("sleep_quality", None)
    parameters.setdefault("awakenings", None)
    parameters.setdefault("event_time", None)
    if payload.get("visit_id"):
        cypher += _visit_edge_cypher("s")

    # P9: patient-scoped Day container (additive; skipped when dateless).
    cypher = _attach_day(cypher, parameters, "s", payload.get("event_time"))

    result = tx.run(cypher, **parameters)
    result.consume()


def _project_activity_tx(tx, payload: dict):
    """Project an ActivityEvent node (USER_REPORTED daily data).

    Creates (:Patient)-[:HAS_ACTIVITY]->(:ActivityEvent {id: event_id})
    with only the collected fields (type/duration/calories) plus
    OCCURRED_DURING when a visit is present. Uses MERGE for idempotency.
    """
    missing_keys = REQUIRED_ACTIVITY_KEYS - set(payload.keys())
    if missing_keys:
        raise PermanentProjectionError(f"Activity payload missing required keys: {missing_keys}")

    cypher = """
    MERGE (p:Patient {id: $patient_id})
    MERGE (a:ActivityEvent {id: $event_id})
    SET a.activity_type = $activity_type,
        a.duration_minutes = $duration_minutes,
        a.calories_burned = $calories_burned,
        a.event_time = $event_time
    MERGE (p)-[:HAS_ACTIVITY]->(a)
    """
    parameters = dict(payload)
    parameters.setdefault("duration_minutes", None)
    parameters.setdefault("calories_burned", None)
    parameters.setdefault("event_time", None)
    if payload.get("visit_id"):
        cypher += _visit_edge_cypher("a")

    # P9: patient-scoped Day container (additive; skipped when dateless).
    cypher = _attach_day(cypher, parameters, "a", payload.get("event_time"))

    result = tx.run(cypher, **parameters)
    result.consume()


def _project_nutrition_tx(tx, payload: dict):
    """Project a NutritionIntake node (USER_REPORTED daily aggregates).

    Creates (:Patient)-[:HAS_NUTRITION]->(:NutritionIntake {id: event_id})
    with aggregate fields as collected (water/meals/appetite/kcal/label)
    plus OCCURRED_DURING when a visit is present. Per-item detail lives on
    FoodScan/FoodEntry nodes. Uses MERGE for idempotency.
    """
    missing_keys = REQUIRED_NUTRITION_KEYS - set(payload.keys())
    if missing_keys:
        raise PermanentProjectionError(f"Nutrition payload missing required keys: {missing_keys}")

    cypher = """
    MERGE (p:Patient {id: $patient_id})
    MERGE (n:NutritionIntake {id: $event_id})
    SET n.water_ml = $water_ml,
        n.meals_count = $meals_count,
        n.appetite_level = $appetite_level,
        n.calories_kcal = $calories_kcal,
        n.food_label = $food_label,
        n.event_time = $event_time
    MERGE (p)-[:HAS_NUTRITION]->(n)
    """
    parameters = dict(payload)
    for key in ("water_ml", "meals_count", "appetite_level", "calories_kcal",
                "food_label", "event_time"):
        parameters.setdefault(key, None)
    if payload.get("visit_id"):
        cypher += _visit_edge_cypher("n")

    # P9: patient-scoped Day container (additive; skipped when dateless).
    cypher = _attach_day(cypher, parameters, "n", payload.get("event_time"))

    result = tx.run(cypher, **parameters)
    result.consume()


def _project_food_scan_tx(tx, payload: dict):
    """Project a FoodScan + FoodEntry nodes (VLM estimate or manual log).

    Creates (:Patient)-[:HAS_FOOD_SCAN]->(:FoodScan {id}) and, via UNWIND
    over the entries array, (:FoodScan)-[:HAS_ENTRY]->(:FoodEntry {id})
    per item. AI estimates stay labeled (status/confidence); user
    corrections arrive as re-projected props (corrected/corrected_label)
    with the original label preserved. Raw images never enter Neo4j.
    OCCURRED_DURING links the scan to its visit. Uses MERGE for idempotency.
    """
    missing_keys = REQUIRED_FOOD_SCAN_KEYS - set(payload.keys())
    if missing_keys:
        raise PermanentProjectionError(f"Food scan payload missing required keys: {missing_keys}")

    cypher = """
    MERGE (p:Patient {id: $patient_id})
    MERGE (f:FoodScan {id: $scan_id})
    SET f.total_kcal = $total_kcal,
        f.overall_confidence = $overall_confidence,
        f.status = $status,
        f.model = $model,
        f.model_version = $model_version,
        f.meal_type = $meal_type,
        f.recorded_at = $recorded_at
    MERGE (p)-[:HAS_FOOD_SCAN]->(f)
    WITH p, f
    UNWIND $entries AS entry    MERGE (e:FoodEntry {id: entry.entry_id})
    SET e.label = entry.label,
        e.portion_g = entry.portion_g,
        e.volume_ml = entry.volume_ml,
        e.kcal = entry.kcal,
        e.protein_g = entry.protein_g,
        e.carbs_g = entry.carbs_g,
        e.fat_g = entry.fat_g,
        e.confidence = entry.confidence,
        e.corrected = entry.corrected,
        e.corrected_label = entry.corrected_label
    MERGE (f)-[:HAS_ENTRY]->(e)
    """
    parameters = dict(payload)
    for key in ("total_kcal", "overall_confidence", "status", "model",
                "model_version", "meal_type", "recorded_at"):
        parameters.setdefault(key, None)
    if not isinstance(parameters.get("entries"), list):
        parameters["entries"] = []
    if payload.get("visit_id"):
        # NOTE: `f` is bound above (WITH p, f carries it); the visit edge
        # attaches to the scan, not to individual entries.
        cypher += (
            " WITH p, f"
            " MERGE (v:Visit {id: $visit_id})"
            " MERGE (p)-[:HAS_VISIT]->(v)"
            " MERGE (f)-[:OCCURRED_DURING]->(v)"
        )

    # P9: patient-scoped Day container (recorded_at anchor; additive).
    # NOTE: inserted BEFORE the UNWIND — clauses after UNWIND run zero
    # times when entries is empty, silently dropping the Day edge.
    day_ident = _day_identity(parameters.get("patient_id"), payload.get("recorded_at"))
    if day_ident is not None:
        parameters["day_id"], parameters["day_date"] = day_ident
        cypher = cypher.replace(
            "    UNWIND $entries AS entry",
            _day_link_cypher("f") + "\n    UNWIND $entries AS entry",
            1,
        )

    result = tx.run(cypher, **parameters)
    result.consume()


def _project_ppg_tx(tx, payload: dict):
    """Project a PPGMeasurement node (device-derived session scalars).

    One label for both modalities; `method` (camera_ppg|face_rppg)
    distinguishes them, and HRV props are simply null for face sessions
    (by design — never invented). Raw waveforms/RR lists stay in
    PostgreSQL; only `has_rr_intervals` projects. Device provenance is
    embedded props (algorithm/model/sampling_rate); no Device ontology.
    Creates (:Patient)-[:HAS_BIOMETRIC]->(:PPGMeasurement {id}) plus
    OCCURRED_DURING when a visit is present. Uses MERGE for idempotency.
    """
    missing_keys = REQUIRED_PPG_KEYS - set(payload.keys())
    if missing_keys:
        raise PermanentProjectionError(f"PPG payload missing required keys: {missing_keys}")

    cypher = """
    MERGE (p:Patient {id: $patient_id})
    MERGE (m:PPGMeasurement {id: $measurement_id})
    SET m.method = $measurement_type,
        m.heart_rate_bpm = $heart_rate_bpm,
        m.rmssd_ms = $rmssd_ms,
        m.sdnn_ms = $sdnn_ms,
        m.signal_quality = $signal_quality,
        m.reliable = $reliable,
        m.duration_seconds = $duration_seconds,
        m.algorithm_version = $algorithm_version,
        m.model_version = $model_version,
        m.sampling_rate_hz = $sampling_rate_hz,
        m.measured_at = $measured_at,
        m.has_rr_intervals = $has_rr_intervals
    MERGE (p)-[:HAS_BIOMETRIC]->(m)
    """
    parameters = dict(payload)
    for key in ("heart_rate_bpm", "rmssd_ms", "sdnn_ms", "signal_quality",
                "reliable", "duration_seconds", "algorithm_version",
                "model_version", "sampling_rate_hz", "measured_at",
                "has_rr_intervals"):
        parameters.setdefault(key, None)
    if payload.get("visit_id"):
        cypher += _visit_edge_cypher("m")

    # P9: patient-scoped Day container (measured_at anchor; additive).
    cypher = _attach_day(cypher, parameters, "m", payload.get("measured_at"))

    result = tx.run(cypher, **parameters)
    result.consume()


REQUIRED_RETIRE_KEYS = {"patient_id", "node_label", "node_id"}


def _project_node_retired_tx(tx, payload: dict):
    """Retire one replaced graph node (P5 correction lifecycle).

    Deletes ONLY a node that (a) carries an allow-listed event-keyed label
    (models/outbox.py RETIREABLE_NODE_LABELS — anything else fails
    permanently to DEAD_LETTER, never retried), and (b) is directly
    reachable from this patient via an ownership edge. Shared reference
    nodes (Concept, AnatomicalStructure, canonical Medication), grouping
    nodes (Visit), and deduped clinical rows can never match.

    Idempotent: replaying, or retiring an already-absent node, matches zero
    rows and deletes nothing. DETACH removes incident edges only; shared
    nodes on the other end are untouched (their other edges survive).
    """
    from models.outbox import RETIREABLE_NODE_LABELS

    missing_keys = REQUIRED_RETIRE_KEYS - set(payload.keys())
    if missing_keys:
        raise PermanentProjectionError(f"Retire payload missing required keys: {missing_keys}")

    label = payload.get("node_label")
    if label not in RETIREABLE_NODE_LABELS:
        raise PermanentProjectionError(f"Refusing to retire non-allow-listed label: {label!r}")

    # NOTE: the label is interpolated, never parameterized (Cypher has no
    # label parameters). It is safe because it is allow-list gated above —
    # arbitrary input can never reach the query string.
    cypher = f"""
    MATCH (p:Patient {{id: $patient_id}})
    MATCH (n:{label} {{id: $node_id}})
    WHERE (p)-->(n)
    DETACH DELETE n
    """
    result = tx.run(cypher, patient_id=payload["patient_id"], node_id=payload["node_id"])
    result.consume()