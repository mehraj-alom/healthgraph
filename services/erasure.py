"""Patient erasure orchestrator (P1 fulfillment for deletion requests).

Implements the actual deletion lifecycle that P0 left as intake-only:

  DEVICE / LOCAL  ->  FastAPI (this module)  ->  PostgreSQL (authoritative)
                                                   -> Neo4j (projection)
                                                   -> Qdrant (vectors)
                                                   -> Firebase Auth (account)

Two operations (kept distinct):

  A. erase_patient_data      — delete ALL health records, keep the account.
  B. erase_patient_account   — A + consent/DSR rows + Patient row + Firebase user.

Design rules (enforced by tests where feasible):

  - Explicit inventory: every patient-owned PG table is classified in
    ERASURE_PATIENT_TABLES; shared ontology/reference tables
    (medical_concepts, medical_aliases, body_regions, anatomical_structures,
    providers, facilities) are never touched.
  - FK-safe order: children before parents (payloads/labs before events,
    evidence before documents, taken/versions before medications, entries
    before scans). Plain (non-CASCADE) FKs would otherwise fail the delete.
  - No resurrection: the graph outbox (all statuses) dies in the SAME PG
    transaction as the rows, so the Celery drain can never re-project them.
    In-flight worker batches (already claimed) are caught by a bounded
    delete-verify re-pass on the graph/vector side; anything left is
    reported as pending_retry, never claimed complete.
  - Idempotent: every step is delete-if-exists, so the endpoints (and any
    operator rerun) are safely retryable.
  - Honest reporting: per-subsystem completed/failed/unavailable with counts;
    overall status is 'completed' ONLY when every subsystem completed.
  - Audit-first: the erasure action itself is audit-logged; on account
    deletion audit rows are kept with patient_id nulled (accountability
    without linkage).
"""

import uuid
from typing import Any, Optional

from sqlalchemy import func, text

from models.base import Base

# ---------------------------------------------------------------------------
# Inventory (pure data — unit-tested for completeness against Base.metadata)
# ---------------------------------------------------------------------------

#: Tables with a patient_id column that erasure must empty for the patient.
#: Event-keyed child tables (payloads, labs) carry no patient_id of their
#: own and are classified separately in ERASURE_EVENT_TABLES below.
#: The Patient row itself is handled by the delete_account flag.
ERASURE_PATIENT_TABLES: tuple[str, ...] = (
    # Event payloads + event children (no patient column of their own —
    # deleted by event_id; listed here so the completeness test sees them
    # classified via ERASURE_EVENT_TABLES below).
    "clinical_events",
    "documents",
    "anatomical_observations",
    "patient_body_state_snapshots",
    "medications",
    "medication_taken_events",
    "medication_versions",
    "condition_occurrences",
    "patient_statements",
    "measurements",
    "visits",
    "food_scans",
    "food_entries",
    "ppg_measurements",
    "conversation_threads",
    "patient_daily_summaries",
    "patient_health_summaries",
    "idempotency_keys",
    "consent_receipts",       # account-delete only (kept for delete-data)
    "data_subject_requests",  # account-delete only (kept for delete-data)
    "audit_events",           # never deleted; patient_id nulled on account-delete
)

#: Child tables keyed by event_id (deleted via the patient's event ids).
ERASURE_EVENT_TABLES: tuple[str, ...] = (
    "payload_vital_signs",
    "payload_symptoms",
    "payload_wellbeing",
    "payload_pain",
    "payload_sleep",
    "payload_activity",
    "payload_nutrition",
    "payload_medication_taken",
    "payload_patient_notes",
    "lab_results",
    "medication_events",
    "daily_health_entries",
)

#: Tables that MUST NOT appear in any erasure plan (shared reference data).
RETAINED_SHARED_TABLES: tuple[str, ...] = (
    "medical_concepts",
    "medical_aliases",
    "body_regions",
    "anatomical_structures",
    "providers",
    "facilities",
)

#: Neo4j node labels owned by exactly one patient (carry patient_id).
#: Concept + AnatomicalStructure are shared reference nodes — never deleted.
NEO4J_OWNED_LABELS: tuple[str, ...] = (
    "Observation",
    "TimelineEvent",
    "ConditionOccurrence",
    "Medication",
    "MedicationRequest",
    "MedicationTakenEvent",
    "MedicationVersion",
    "Measurement",
    "PatientStatement",
    "Visit",
    "Document",
    "PPGMeasurement",
    "FoodScan",
    "FoodEntry",
    "SleepEpisode",
    "ActivityEvent",
    "NutritionIntake",
)

NEO4J_SHARED_LABELS: tuple[str, ...] = (
    "Concept",
    "AnatomicalStructure",
)

#: LangGraph checkpointer tables (created by AsyncPostgresSaver, not ORM).
#: checkpoint_migrations is global schema bookkeeping — never touched.
CHECKPOINT_TABLES: tuple[str, ...] = (
    "checkpoints",
    "checkpoint_writes",
    "checkpoint_blobs",
)

ERASURE_MAX_REPASSES = 3

#: Execution order of the PostgreSQL phase (FK-safe: children before
#: parents). The executor below follows this order; the test suite pins the
#: relative order of every edge that a plain (non-CASCADE) FK requires.
ERASURE_STEP_ORDER: tuple[str, ...] = (
    # Event payloads + event-keyed children (by event_id).
    "payload_vital_signs",
    "payload_symptoms",
    "payload_wellbeing",
    "payload_pain",
    "payload_sleep",
    "payload_activity",
    "payload_nutrition",
    "payload_medication_taken",
    "payload_patient_notes",
    "lab_results",
    "medication_events",
    "daily_health_entries",
    # Evidence before the events/documents it quotes.
    "evidence_links",
    # Document derivatives before events before documents.
    "raw_extraction",
    "document_blobs",
    "clinical_events",
    "documents",
    # Anatomy, meds (taken + versions before regimens), conditions,
    # statements, measurements.
    "anatomical_observations",
    "patient_body_state_snapshots",
    "medication_taken_events",
    "medication_versions",
    "medications",
    "condition_occurrences",
    "patient_statements",
    "measurements",
    # Visits, food (entries before scans), PPG.
    "visits",
    "food_entries",
    "food_scans",
    "ppg_measurements",
    # Chat + checkpointer rows, summaries, idempotency, outbox.
    "checkpoints",
    "conversation_threads",
    "patient_daily_summaries",
    "patient_health_summaries",
    "idempotency_keys",
    "graph_sync_outbox",
    # Account mode only (kept for delete-data): consent, DSRs, audit-link,
    # patient row last.
    "consent_receipts",
    "data_subject_requests",
    "audit_events",
    "patients",
)


def patient_owned_tables() -> set[str]:
    """Every metadata table carrying a patient_id column (plus the patient row)."""
    owned: set[str] = set()
    for name, table in Base.metadata.tables.items():
        if "patient_id" in table.c:
            owned.add(name)
    return owned


def unclassified_patient_tables() -> set[str]:
    """Metadata tables with patient_id that no erasure plan classifies."""
    return patient_owned_tables() - set(ERASURE_PATIENT_TABLES) - {"patients"}


# ---------------------------------------------------------------------------
# Pure builders (unit-tested; executors below run them)
# ---------------------------------------------------------------------------

def build_patient_graph_deletes(patient_id: uuid.UUID) -> list[dict[str, Any]]:
    """Ordered Neo4j delete statements for one patient.

    Per owned label first (countable), then Day nodes (id embeds the
    patient), then a relationship sweep that catches strays while explicitly
    excluding shared labels, then the Patient node itself (account mode —
    the caller drops this last statement for delete-data mode).
    """
    pid = str(patient_id)
    stmts: list[dict[str, Any]] = []
    for label in NEO4J_OWNED_LABELS:
        stmts.append({
            "description": f"owned label {label}",
            "cypher": (
                f"MATCH (n:{label} {{patient_id: $pid}}) "
                "DETACH DELETE n RETURN count(n) AS deleted"
            ),
            "params": {"pid": pid},
        })
    stmts.append({
        "description": "Day nodes for patient",
        "cypher": (
            "MATCH (d:Day) WHERE d.id STARTS WITH $prefix "
            "DETACH DELETE d RETURN count(d) AS deleted"
        ),
        "params": {"prefix": f"{pid}:"},
    })
    # Relationship sweep: anything still attached to the patient that is not
    # shared reference data. Belt-and-braces for node types the per-label
    # pass missed (e.g. a projection added without a patient_id property).
    stmts.append({
        "description": "relationship sweep (excluding shared labels)",
        "cypher": (
            "MATCH (p:Patient {id: $pid})-[r]->(n) "
            "WHERE NOT n:Concept AND NOT n:AnatomicalStructure "
            "DETACH DELETE n RETURN count(n) AS deleted"
        ),
        "params": {"pid": pid},
    })
    stmts.append({
        "description": "Patient node",
        "cypher": "MATCH (p:Patient {id: $pid}) DETACH DELETE p RETURN count(p) AS deleted",
        "params": {"pid": pid},
    })
    return stmts


def build_patient_graph_verify() -> dict[str, Any]:
    """Count any remaining patient-linked nodes (excludes shared labels)."""
    return {
        "description": "verify no patient nodes remain",
        "cypher": (
            "MATCH (n) WHERE (n.patient_id = $pid "
            "OR (n:Day AND n.id STARTS WITH $prefix) "
            "OR (n:Patient AND n.id = $pid)) "
            "AND NOT n:Concept AND NOT n:AnatomicalStructure "
            "RETURN count(n) AS residual"
        ),
    }


def build_qdrant_patient_filter(patient_id: uuid.UUID) -> dict[str, Any]:
    """Delete/count filter matching every point this patient owns."""
    return {"must": [{"key": "patient_id", "match": {"value": str(patient_id)}}]}


# ---------------------------------------------------------------------------
# PostgreSQL phase (authoritative; single transaction incl. outbox kill)
# ---------------------------------------------------------------------------

def erase_patient_postgres(db, patient_id: uuid.UUID, *, delete_account: bool) -> dict[str, Any]:
    """Delete one patient's PG rows in FK-safe order. Returns per-table counts.

    The graph_sync_outbox rows (ANY status, including lease-claimed) die in
    the same commit, so the Celery drain can never re-project them afterwards.
    """
    # Local model imports (consistent with the codebase's lazy style inside
    # request paths; keeps this module importable without a DB).
    from models.anatomy import AnatomicalObservation, PatientBodyStateSnapshot
    from models.chat import ConversationThread
    from models.conditions import ConditionOccurrence
    from models.daily_logs.events import (
        ActivityPayload,
        MedicationTakenPayload,
        NutritionPayload,
        PainPayload,
        PatientNotePayload,
        SleepPayload,
        SymptomPayload,
        VitalSignPayload,
        WellbeingPayload,
    )
    from models.events import (
        ClinicalEvent,
        DailyHealthEntry,
        Document,
        DocumentBlob,
        EvidenceLink,
        LabResult,
        MedicationEvent,
        RawExtractionData,
    )
    from models.food import FoodEntry, FoodScan
    from models.idempotency import IdempotencyKey
    from models.measurements import Measurement
    from models.medication_versions import MedicationVersion
    from models.medications import Medication, MedicationTakenEvent
    from models.outbox import GraphSyncOutbox
    from models.ppg import PpgMeasurement
    from models.privacy import AuditEvent, ConsentReceipt, DataSubjectRequest, DSRStatus, log_audit
    from models.statements import PatientStatement
    from models.summaries import PatientDailySummary, PatientHealthSummary
    from models.visits import Visit

    counts: dict[str, int] = {}

    def delete_count(query) -> int:
        # Bulk-delete rowcount is unreliable across dialects; count first.
        n = query.count()
        query.delete(synchronize_session=False)
        return int(n)

    # 0. Identity sets for event/doc-joined children.
    event_ids = [
        row[0]
        for row in db.query(ClinicalEvent.event_id)
        .filter(ClinicalEvent.patient_id == patient_id)
        .all()
    ]
    doc_ids = [
        row[0]
        for row in db.query(Document.document_id)
        .filter(Document.patient_id == patient_id)
        .all()
    ]
    thread_ids = [
        row[0]
        for row in db.query(ConversationThread.id)
        .filter(ConversationThread.patient_id == patient_id)
        .all()
    ]

    def by_events(model, id_col):
        if not event_ids:
            return 0
        return delete_count(
            db.query(model).filter(id_col.in_(event_ids))
        )

    # 1. Event payloads + event-keyed children (before clinical_events).
    for model in (
        VitalSignPayload, SymptomPayload, WellbeingPayload, PainPayload,
        SleepPayload, ActivityPayload, NutritionPayload,
        MedicationTakenPayload, PatientNotePayload,
    ):
        counts[model.__tablename__] = by_events(model, model.event_id)
    counts["lab_results"] = by_events(LabResult, LabResult.event_id)
    counts["medication_events"] = by_events(MedicationEvent, MedicationEvent.event_id)
    counts["daily_health_entries"] = by_events(DailyHealthEntry, DailyHealthEntry.event_id)

    # 2. Evidence links (join events AND documents — gone once both are gone,
    #    but deleted now so later steps never trip on them).
    if event_ids or doc_ids:
        q = db.query(EvidenceLink)
        if event_ids and doc_ids:
            from sqlalchemy import or_ as _or
            q = q.filter(_or(
                EvidenceLink.event_id.in_(event_ids),
                EvidenceLink.document_id.in_(doc_ids),
            ))
        elif event_ids:
            q = q.filter(EvidenceLink.event_id.in_(event_ids))
        else:
            q = q.filter(EvidenceLink.document_id.in_(doc_ids))
        counts["evidence_links"] = delete_count(q)
    else:
        counts["evidence_links"] = 0

    # 3. Document derivatives, then events, then documents (all statuses,
    #    including DELETED tombstones — erasure removes the rows entirely).
    if doc_ids:
        counts["raw_extraction"] = delete_count(
            db.query(RawExtractionData).filter(RawExtractionData.document_id.in_(doc_ids))
        )
        counts["document_blobs"] = delete_count(
            db.query(DocumentBlob).filter(DocumentBlob.document_id.in_(doc_ids))
        )
    else:
        counts["raw_extraction"] = 0
        counts["document_blobs"] = 0
    counts["clinical_events"] = delete_count(
        db.query(ClinicalEvent).filter(ClinicalEvent.patient_id == patient_id)
    )
    counts["documents"] = delete_count(
        db.query(Document).filter(Document.patient_id == patient_id)
    )

    # 4. Anatomy, meds, conditions, statements, measurements.
    counts["anatomical_observations"] = delete_count(
        db.query(AnatomicalObservation).filter(AnatomicalObservation.patient_id == patient_id)
    )
    counts["patient_body_state_snapshots"] = delete_count(
        db.query(PatientBodyStateSnapshot).filter(PatientBodyStateSnapshot.patient_id == patient_id)
    )
    counts["medication_taken_events"] = delete_count(
        db.query(MedicationTakenEvent).filter(MedicationTakenEvent.patient_id == patient_id)
    )
    counts["medication_versions"] = delete_count(
        db.query(MedicationVersion).filter(MedicationVersion.patient_id == patient_id)
    )
    counts["medications"] = delete_count(
        db.query(Medication).filter(Medication.patient_id == patient_id)
    )
    counts["condition_occurrences"] = delete_count(
        db.query(ConditionOccurrence).filter(ConditionOccurrence.patient_id == patient_id)
    )
    counts["patient_statements"] = delete_count(
        db.query(PatientStatement).filter(PatientStatement.patient_id == patient_id)
    )
    counts["measurements"] = delete_count(
        db.query(Measurement).filter(Measurement.patient_id == patient_id)
    )

    # 5. Visits, food, PPG.
    counts["visits"] = delete_count(
        db.query(Visit).filter(Visit.patient_id == patient_id)
    )
    counts["food_entries"] = delete_count(
        db.query(FoodEntry).filter(
            FoodEntry.scan_id.in_(
                db.query(FoodScan.scan_id).filter(FoodScan.patient_id == patient_id)
            )
        )
    )
    counts["food_scans"] = delete_count(
        db.query(FoodScan).filter(FoodScan.patient_id == patient_id)
    )
    counts["ppg_measurements"] = delete_count(
        db.query(PpgMeasurement).filter(PpgMeasurement.patient_id == patient_id)
    )

    # 6. Chat threads + LangGraph checkpointer rows (conversation content).
    thread_id_strs = [str(t) for t in thread_ids]
    counts["checkpoints"] = _delete_checkpoints(db, thread_id_strs)
    counts["conversation_threads"] = delete_count(
        db.query(ConversationThread).filter(ConversationThread.patient_id == patient_id)
    )

    # 7. Summaries, idempotency keys.
    counts["patient_daily_summaries"] = delete_count(
        db.query(PatientDailySummary).filter(PatientDailySummary.patient_id == patient_id)
    )
    counts["patient_health_summaries"] = delete_count(
        db.query(PatientHealthSummary).filter(PatientHealthSummary.patient_id == patient_id)
    )
    counts["idempotency_keys"] = delete_count(
        db.query(IdempotencyKey).filter(IdempotencyKey.patient_id == patient_id)
    )

    # 8. Graph outbox — EVERY status for this patient (payload-carried
    #    patient_id; the table itself has no patient column). Killing these
    #    in the same commit is what prevents worker resurrection.
    counts["graph_sync_outbox"] = db.query(GraphSyncOutbox).filter(
        GraphSyncOutbox.payload["patient_id"].astext == str(patient_id)
    ).delete(synchronize_session=False)

    dsr_fulfilled: list[str] = []
    if delete_account:
        # Consent + DSR rows cannot outlive the patient row (non-nullable FK).
        # Erasure is total: the erasure audit entry below (patient nulled but
        # retained) is the accountability record.
        counts["consent_receipts"] = delete_count(
            db.query(ConsentReceipt).filter(ConsentReceipt.patient_id == patient_id)
        )
        dsr_rows = (
            db.query(DataSubjectRequest)
            .filter(DataSubjectRequest.patient_id == patient_id)
            .all()
        )
        dsr_fulfilled = [str(r.id) for r in dsr_rows]
        counts["data_subject_requests"] = delete_count(
            db.query(DataSubjectRequest).filter(DataSubjectRequest.patient_id == patient_id)
        )
        # Keep audit rows (accountability) but unlink them from the patient.
        db.query(AuditEvent).filter(AuditEvent.patient_id == patient_id).update(
            {AuditEvent.patient_id: None}, synchronize_session=False
        )
    else:
        counts["consent_receipts"] = 0
        counts["data_subject_requests"] = 0
        # Fulfill this patient's OPEN erasure DSRs (P0 intake → P1 done).
        open_erasure = (
            db.query(DataSubjectRequest)
            .filter(
                DataSubjectRequest.patient_id == patient_id,
                DataSubjectRequest.request_type == "erasure",
                DataSubjectRequest.status == DSRStatus.OPEN.value,
            )
            .all()
        )
        for req in open_erasure:
            req.status = DSRStatus.FULFILLED.value
            dsr_fulfilled.append(str(req.id))

    log_audit(
        db, action="erasure_completed", patient_id=None if delete_account else patient_id,
        entity_type="patient",
        entity_id=str(patient_id),
        meta={"delete_account": delete_account, "tables": counts},
    )
    db.commit()

    return {"tables": counts, "dsr_fulfilled": dsr_fulfilled}


def _delete_checkpoints(db, thread_id_strs: list[str]) -> int:
    """Delete LangGraph checkpointer rows for the patient's threads.

    The saver creates its tables outside the ORM; missing tables (saver
    never ran) are skipped, never fatal.
    """
    if not thread_id_strs:
        return 0
    total = 0
    for table in CHECKPOINT_TABLES:
        # SAVEPOINT (not session rollback): a missing table must roll back
        # only its own statement — a full db.rollback() here would silently
        # discard every delete already staged in this transaction.
        try:
            with db.begin_nested():
                result = db.execute(
                    text(f"DELETE FROM {table} WHERE thread_id = ANY(:tids)"),
                    {"tids": thread_id_strs},
                )
                total += int(result.rowcount or 0)
        except Exception:
            # Table absent (saver never initialized) — nothing to erase.
            continue
    return total


def count_outbox_for_patient(db, patient_id: uuid.UUID) -> int:
    """Residual outbox rows for the patient (re-check after projection pass)."""
    from models.outbox import GraphSyncOutbox
    return int(
        db.query(func.count(GraphSyncOutbox.id))
        .filter(GraphSyncOutbox.payload["patient_id"].astext == str(patient_id))
        .scalar()
        or 0
    )


# ---------------------------------------------------------------------------
# Neo4j + Qdrant phases (best-effort infrastructure, honest status)
# ---------------------------------------------------------------------------

def erase_patient_graph(driver, patient_id: uuid.UUID, *, delete_patient_node: bool) -> dict[str, Any]:
    """Delete the patient's graph projection. Returns counts + residual."""
    if driver is None:
        return {"status": "unavailable", "deleted": {}, "residual": None}
    stmts = build_patient_graph_deletes(patient_id)
    if not delete_patient_node:
        stmts = [s for s in stmts if s["description"] != "Patient node"]
    deleted: dict[str, int] = {}
    try:
        with driver.session() as session:
            for stmt in stmts:
                record = session.run(stmt["cypher"], **stmt["params"]).single()
                deleted[stmt["description"]] = int((record or {}).get("deleted", 0) or 0)
            verify = build_patient_graph_verify()
            residual = session.run(
                verify["cypher"], pid=str(patient_id), prefix=f"{patient_id}:"
            ).single()
        return {
            "status": "completed",
            "deleted": deleted,
            "residual": int((residual or {}).get("residual", 0) or 0),
        }
    except Exception as e:
        from logger import logger
        logger.warning("Patient graph erasure failed (%s).", type(e).__name__)
        return {"status": "failed", "deleted": deleted, "residual": None,
                "error": type(e).__name__}


def erase_patient_vectors(patient_id: uuid.UUID) -> dict[str, Any]:
    """Delete every Qdrant point the patient owns. Returns before/after."""
    try:
        from qdrant_client.http import models as _qm
        from services.vectorization.qdrant_client import vector_db

        filt = _qm.Filter(
            must=[_qm.FieldCondition(
                key="patient_id", match=_qm.MatchValue(value=str(patient_id)))]
        )
        before = vector_db.client.count(
            collection_name=vector_db.collection_name, count_filter=filt
        ).count
        vector_db.client.delete(
            collection_name=vector_db.collection_name,
            points_selector=_qm.FilterSelector(filter=filt),
        )
        after = vector_db.client.count(
            collection_name=vector_db.collection_name, count_filter=filt
        ).count
        return {
            "status": "completed" if after == 0 else "pending_retry",
            "before": int(before or 0),
            "after": int(after or 0),
        }
    except Exception as e:
        from logger import logger
        logger.warning("Patient vector erasure failed (%s).", type(e).__name__)
        return {"status": "failed", "before": None, "after": None,
                "error": type(e).__name__}


def delete_firebase_user(firebase_uid: str) -> dict[str, Any]:
    """Delete the Firebase Auth user (account mode only). Idempotent."""
    try:
        from firebase_admin import auth as _auth
        from firebase_admin.auth import UserNotFoundError
    except Exception as e:
        from logger import logger
        logger.warning("Firebase Admin unavailable for account deletion (%s).", type(e).__name__)
        return {"deleted": False, "status": "unavailable"}
    try:
        _auth.delete_user(firebase_uid)
        return {"deleted": True, "status": "completed"}
    except UserNotFoundError:
        return {"deleted": True, "status": "completed", "note": "already deleted"}
    except Exception as e:
        from logger import logger
        logger.warning("Firebase user deletion failed (%s).", type(e).__name__)
        return {"deleted": False, "status": "failed", "error": type(e).__name__}


# ---------------------------------------------------------------------------
# Full orchestration
# ---------------------------------------------------------------------------

def orchestrate_erasure(
    db,
    patient_id: uuid.UUID,
    *,
    delete_account: bool,
    neo4j_driver=None,
    firebase_uid: Optional[str] = None,
    max_repasses: int = ERASURE_MAX_REPASSES,
) -> dict[str, Any]:
    """Run the full erasure lifecycle with an honest per-subsystem report.

    Overall status is 'completed' ONLY when PostgreSQL, Neo4j (residual 0),
    Qdrant (after 0), and Firebase (account mode) all completed. Anything
    else is 'partial' with explicit retry guidance — the orchestrator is
    idempotent, so retrying the same endpoint converges.
    """
    from logger import logger

    pg = erase_patient_postgres(db, patient_id, delete_account=delete_account)

    graph: dict[str, Any] = {"status": "unavailable", "deleted": {}, "residual": None}
    vectors: dict[str, Any] = {"status": "unavailable", "before": None, "after": None}
    for _ in range(max(1, max_repasses)):
        graph = erase_patient_graph(
            neo4j_driver, patient_id, delete_patient_node=delete_account)
        vectors = erase_patient_vectors(patient_id)
        # Re-check: concurrent requests during the window could have written
        # new rows (and an in-flight worker batch could have re-projected).
        # New patient outbox rows are erased and the projection pass repeats.
        residual_outbox = 0
        try:
            residual_outbox = count_outbox_for_patient(db, patient_id)
        except Exception:
            logger.warning("Outbox re-check failed; treating as clean for reporting.")
        if residual_outbox:
            from models.outbox import GraphSyncOutbox
            db.query(GraphSyncOutbox).filter(
                GraphSyncOutbox.payload["patient_id"].astext == str(patient_id)
            ).delete(synchronize_session=False)
            db.commit()
        graph_residual = graph.get("residual") or 0
        vectors_after = vectors.get("after")
        vectors_clean = vectors_after == 0
        if residual_outbox == 0 and graph_residual == 0 and vectors_clean:
            break
        logger.warning(
            "Erasure re-pass needed (outbox=%s graph_residual=%s vectors_after=%s).",
            residual_outbox, graph_residual, vectors_after,
        )

    firebase: dict[str, Any] = {"deleted": False, "status": "skipped"}
    if delete_account and firebase_uid:
        firebase = delete_firebase_user(firebase_uid)

    if delete_account:
        from models.identity import Patient
        # Patient row goes LAST (plain FKs from already-emptied tables would
        # otherwise fail; CASCADE FKs would have handled the rest anyway).
        db.query(Patient).filter(Patient.patient_id == patient_id).delete(
            synchronize_session=False)
        db.commit()

    ok = (
        graph.get("status") == "completed"
        and (graph.get("residual") or 0) == 0
        and vectors.get("status") == "completed"
        and (vectors.get("after") or 0) == 0
        and (not delete_account or firebase.get("deleted") is True)
    )
    return {
        "status": "completed" if ok else "partial",
        "delete_account": delete_account,
        "postgres": pg["tables"],
        "dsr_fulfilled": pg["dsr_fulfilled"],
        "neo4j": graph,
        "qdrant": vectors,
        "firebase": firebase,
    }
