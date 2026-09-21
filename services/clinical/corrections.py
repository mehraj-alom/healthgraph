"""Document-derived event correction (P8.1-O, minimal).

The review API verifies and re-projects events but cannot remove a wrong
document-derived event from the graph. This module provides the smallest
correction lifecycle compatible with P5:

    retire_document_event()
      -> ownership check
      -> refuse when dependents exist (observations / conditions /
         measurements keyed to the event survive it)
      -> delete the event + its evidence link (PG)
      -> enqueue GRAPH_NODE_RETIRED for the TimelineEvent node (Neo4j,
         via the P8-verified P5 path; replay-safe no-op if absent)

Deliberately NOT a generic editing framework: no replacement entity is
created here (re-ingestion or a new clinical statement is the replacement
path), and no endpoint is wired in this change — endpoint exposure is a
product/API decision. The function is sync, patient-scoped, and raises
LookupError (not found) or CorrectionConflict (dependents) instead of
HTTP errors so any caller (API, worker, script) can map them.
"""
import uuid

from logger import logger


class CorrectionConflict(Exception):
    """The event cannot be retired because dependents reference it."""


def retire_document_event(db, patient_id: uuid.UUID, event_id: uuid.UUID, reason: str = "document-correction") -> dict:
    """Retire one document-derived ClinicalEvent (P8.1-O).

    Returns {"event_id", "retired_node", "reason"}. Leaves the commit to
    the caller (flush only), matching mapper/worker conventions.
    """
    from models.anatomy import AnatomicalObservation, PatientBodyStateSnapshot
    from models.conditions import ConditionOccurrence
    from models.events import ClinicalEvent, EvidenceLink
    from models.measurements import Measurement
    from models.outbox import enqueue_graph_node_retired

    event = (
        db.query(ClinicalEvent)
        .filter(
            ClinicalEvent.event_id == event_id,
            ClinicalEvent.patient_id == patient_id,
        )
        .first()
    )
    if event is None:
        raise LookupError(f"ClinicalEvent {event_id} not found for patient.")

    dependents = []
    # Auto-derived observations (the mapper's 1:1 artifacts:
    # observation.source_id == event id) retire WITH the event — both the
    # PG row and the graph node (Observation is allow-listed for exactly
    # this shape). Manually linked observations survive the event and
    # therefore block the correction.
    auto_observations = []
    for obs in (
        db.query(AnatomicalObservation)
        .filter(AnatomicalObservation.event_id == event_id)
        .all()
    ):
        if getattr(obs, "source_id", None) == str(event_id):
            auto_observations.append(obs)
        else:
            dependents.append("anatomical_observations")
    if (
        db.query(ConditionOccurrence)
        .filter(ConditionOccurrence.source_event_id == event_id)
        .first()
        is not None
    ):
        dependents.append("condition_occurrences")
    if (
        db.query(Measurement)
        .filter(Measurement.source_event_id == event_id)
        .first()
        is not None
    ):
        dependents.append("measurements")
    if dependents:
        raise CorrectionConflict(
            "Event has dependents that outlive it ("
            + ", ".join(dependents)
            + "); correct via document re-ingestion instead."
        )

    db.query(EvidenceLink).filter(EvidenceLink.event_id == event_id).delete(
        synchronize_session=False
    )
    # Body-state snapshots point at the latest observation per structure
    # (non-nullable FK, no cascade). Repoint affected snapshots to the
    # newest SURVIVING observation for the same structure — the snapshot
    # still describes the latest known state — or drop the snapshot row
    # when nothing remains. Excludes all observations deleted in this
    # call so one correction can retire several siblings.
    auto_ids = {o.observation_id for o in auto_observations}
    for obs in auto_observations:
        snaps = (
            db.query(PatientBodyStateSnapshot)
            .filter(
                PatientBodyStateSnapshot.patient_id == patient_id,
                PatientBodyStateSnapshot.latest_observation_id == obs.observation_id,
            )
            .all()
        )
        for snap in snaps:
            replacement = (
                db.query(AnatomicalObservation)
                .filter(
                    AnatomicalObservation.patient_id == patient_id,
                    AnatomicalObservation.structure_id == obs.structure_id,
                )
                .order_by(
                    AnatomicalObservation.recorded_at.desc(),
                    AnatomicalObservation.ingested_at.desc(),
                    AnatomicalObservation.observation_id.desc(),
                )
                .all()
            )
            replacement = [r for r in replacement if r.observation_id not in auto_ids]
            if replacement:
                newest = replacement[0]
                snap.latest_observation_id = newest.observation_id
                snap.latest_summary = newest.clinical_summary
                snap.visual_status = newest.visual_status
                snap.visual_severity_score = newest.visual_severity_score
                snap.trend = newest.trend
                snap.observation_recorded_at = newest.recorded_at
                snap.observation_ingested_at = newest.ingested_at
            else:
                db.delete(snap)
    for obs in auto_observations:
        db.delete(obs)
        enqueue_graph_node_retired(
            db, patient_id, "Observation", obs.observation_id, reason=reason
        )
    db.delete(event)
    enqueue_graph_node_retired(
        db, patient_id, "TimelineEvent", event_id, reason=reason
    )
    db.flush()
    logger.info(f"Retired document event {event_id} for patient {patient_id} ({reason}).")
    return {
        "event_id": str(event_id),
        "retired_nodes": ["TimelineEvent"]
        + ["Observation"] * len(auto_observations),
        "retired_node": "TimelineEvent",
        "reason": reason,
    }
