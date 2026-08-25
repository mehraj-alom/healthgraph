import uuid
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert

from models.anatomy import AnatomicalObservation, PatientBodyStateSnapshot, AnatomicalStructure
from models.outbox import GraphSyncOutbox, OutboxEventType

# Fast Read Model for 3D Frontend
def get_patient_body_state(db: Session, patient_id: uuid.UUID) -> dict:
    """Returns the precomputed 3D visualization state. Target: single-digit ms DB latency."""
    query = select(PatientBodyStateSnapshot).where(PatientBodyStateSnapshot.patient_id == patient_id)
    results = db.execute(query).scalars().all()

    body_state = {}
    for row in results:
        body_state[row.structure_id] = {
            "mesh_asset_id": row.mesh_asset_id,
            "mesh_node_name": row.mesh_node_name,
            "mesh_version": row.mesh_version,
            "visual_status": row.visual_status.value,
            "visual_severity_score": row.visual_severity_score,
            "trend": row.trend.value,
            "latest_summary": row.latest_summary,
            "observation_recorded_at": row.observation_recorded_at.isoformat()
        }

    return {
        "patient_id": str(patient_id),
        "structures": body_state
    }

# WRITE PATH: Authoritative Log + Snapshot Upsert
def record_anatomical_observation(db: Session, observation: AnatomicalObservation, *, auto_commit: bool = True):
    """Saves the observation and defensively upserts the snapshot.
    
    Args:
        db: SQLAlchemy session.
        observation: The AnatomicalObservation to record.
        auto_commit: If True (default), commits the transaction. Set to False
                     when the caller manages its own transaction boundaries.
    """
    
    db.add(observation)
    db.flush() 

    structure = db.execute(
        select(AnatomicalStructure).where(AnatomicalStructure.structure_id == observation.structure_id)
    ).scalar_one()

    stmt = insert(PatientBodyStateSnapshot).values(
        patient_id=observation.patient_id,
        structure_id=observation.structure_id,
        mesh_asset_id=structure.mesh_asset_id,
        mesh_node_name=structure.mesh_node_name,
        mesh_version=structure.mesh_version,
        visual_status=observation.visual_status,
        visual_severity_score=observation.visual_severity_score,
        trend=observation.trend,
        latest_observation_id=observation.observation_id,
        latest_summary=observation.clinical_summary,
        observation_recorded_at=observation.recorded_at,
        observation_ingested_at=observation.ingested_at
    )

    # Deterministic Tie-Breaker: recorded_at -> ingested_at -> observation_id
    stmt = stmt.on_conflict_do_update(
        index_elements=['patient_id', 'structure_id'],
        set_=dict(
            visual_status=stmt.excluded.visual_status,
            visual_severity_score=stmt.excluded.visual_severity_score,
            trend=stmt.excluded.trend,
            latest_observation_id=stmt.excluded.latest_observation_id,
            latest_summary=stmt.excluded.latest_summary,
            observation_recorded_at=stmt.excluded.observation_recorded_at,
            observation_ingested_at=stmt.excluded.observation_ingested_at,
            mesh_asset_id=stmt.excluded.mesh_asset_id,
            mesh_node_name=stmt.excluded.mesh_node_name,
            mesh_version=stmt.excluded.mesh_version
        ),
        where=(
            (stmt.excluded.observation_recorded_at > PatientBodyStateSnapshot.observation_recorded_at) |
            (
                (stmt.excluded.observation_recorded_at == PatientBodyStateSnapshot.observation_recorded_at) &
                (stmt.excluded.observation_ingested_at > PatientBodyStateSnapshot.observation_ingested_at)
            ) |
            (
                (stmt.excluded.observation_recorded_at == PatientBodyStateSnapshot.observation_recorded_at) &
                (stmt.excluded.observation_ingested_at == PatientBodyStateSnapshot.observation_ingested_at) &
                (stmt.excluded.latest_observation_id > PatientBodyStateSnapshot.latest_observation_id)
            )
        )
    )
    
    db.execute(stmt)

    payload = {
        "patient_id": str(observation.patient_id),
        "observation_id": str(observation.observation_id),
        "structure_id": observation.structure_id,
        "finding_code": observation.finding_code,
        "visual_severity_score": float(observation.visual_severity_score),
        "recorded_at": observation.recorded_at.isoformat(),
        "source_type": observation.source_type.value,
        "level_number": int(observation.recorded_at.strftime("%Y%m%d")),
    }
    if observation.document_id is not None:
        payload["document_id"] = str(observation.document_id)
    if observation.event_id is not None:
        payload["event_id"] = str(observation.event_id)

    db.add(
        GraphSyncOutbox(
            event_type=OutboxEventType.OBSERVATION_RECORDED,
            payload=payload,
        )
    )
    
    if auto_commit:
        db.commit()