"""Camera-PPG derived-measurement endpoints.

Contract:
- POST /api/v1/ppg/measurements accepts ONLY the compact derived payload
  defined in schemas/ppg.py. No frames, no video, no raw streams, no
  server-side PPG worker.
- HRV fields are optional and accepted only as derived scalars.
- Blood-pressure fields do not exist on this API and must never be added
  via the PPG path.
- Reliability is computed server-side (see schemas.ppg.is_reliable).
"""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from core.db import get_db
from logger import logger
from models.ppg import PpgMeasurement
from schemas.ppg import PpgMeasurementCreate, PpgMeasurementResponse, is_reliable

router = APIRouter(prefix="/api/v1/ppg", tags=["ppg"])


@router.post("/measurements", response_model=PpgMeasurementResponse, status_code=201)
def submit_ppg_measurement(
    payload: PpgMeasurementCreate,
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    reliable = is_reliable(
        payload.heartRateBpm,
        payload.signalQuality,
        payload.durationSeconds,
        payload.measurementType,
    )
    row = PpgMeasurement(
        patient_id=patient_id,
        measurement_type=payload.measurementType,
        measured_at=payload.measuredAt,
        heart_rate_bpm=payload.heartRateBpm,
        signal_quality=payload.signalQuality,
        duration_seconds=payload.durationSeconds,
        rmssd_ms=payload.rmssdMs,
        sdnn_ms=payload.sdnnMs,
        rr_intervals_ms=payload.rrIntervalsMs,
        algorithm_version=payload.algorithmVersion,
        model_version=payload.modelVersion,
        sampling_rate_hz=payload.samplingRateHz,
        reliable=reliable,
    )
    db.add(row)
    db.flush()
    # P3: project the session into the graph (scalars + provenance only;
    # raw waveforms/RR lists stay in PostgreSQL). Sessions group under the
    # day's daily-checkin Visit for temporal queries ("PPG around med X").
    from models.outbox import enqueue_ppg
    from models.visits import VisitType
    from services.clinical.occurrences import get_or_create_visit

    _ppg_visit = get_or_create_visit(
        db, patient_id, payload.measuredAt, VisitType.DAILY_CHECKIN, source="ppg",
    )
    enqueue_ppg(
        db,
        measurement_id=row.measurement_id,
        patient_id=patient_id,
        measurement_type=payload.measurementType,
        heart_rate_bpm=payload.heartRateBpm,
        rmssd_ms=payload.rmssdMs,
        sdnn_ms=payload.sdnnMs,
        signal_quality=payload.signalQuality,
        reliable=reliable,
        duration_seconds=payload.durationSeconds,
        algorithm_version=payload.algorithmVersion,
        model_version=payload.modelVersion,
        sampling_rate_hz=payload.samplingRateHz,
        measured_at=payload.measuredAt.isoformat() if payload.measuredAt else None,
        has_rr_intervals=bool(payload.rrIntervalsMs),
        visit_id=_ppg_visit.visit_id,
    )
    db.commit()
    db.refresh(row)
    # Log identifiers only — never health values.
    logger.info(
        "PPG_MEASUREMENT_SAVED reliable=%s duration=%d",
        reliable,
        payload.durationSeconds,
    )
    return PpgMeasurementResponse(
        measurementId=str(row.measurement_id),
        measurementType=row.measurement_type,
        measuredAt=row.measured_at,
        heartRateBpm=row.heart_rate_bpm,
        signalQuality=row.signal_quality,
        durationSeconds=row.duration_seconds,
        rmssdMs=row.rmssd_ms,
        sdnnMs=row.sdnn_ms,
        rrIntervalsMs=row.rr_intervals_ms,
        algorithmVersion=row.algorithm_version,
        modelVersion=row.model_version,
        samplingRateHz=row.sampling_rate_hz,
        reliable=row.reliable,
    )


@router.get("/measurements", response_model=list[PpgMeasurementResponse])
def list_ppg_measurements(
    limit: int = 20,
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    limit = max(1, min(limit, 100))
    rows = db.scalars(
        select(PpgMeasurement)
        .where(PpgMeasurement.patient_id == patient_id)
        .order_by(desc(PpgMeasurement.measured_at))
        .limit(limit)
    ).all()
    return [
        PpgMeasurementResponse(
            measurementId=str(r.measurement_id),
            measurementType=r.measurement_type,
            measuredAt=r.measured_at,
            heartRateBpm=r.heart_rate_bpm,
            signalQuality=r.signal_quality,
            durationSeconds=r.duration_seconds,
            rmssdMs=r.rmssd_ms,
            sdnnMs=r.sdnn_ms,
            rrIntervalsMs=r.rr_intervals_ms,
            algorithmVersion=r.algorithm_version,
            modelVersion=r.model_version,
            samplingRateHz=r.sampling_rate_hz,
            reliable=r.reliable,
        )
        for r in rows
    ]
