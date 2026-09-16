"""Medication CRUD API endpoints.

Provides endpoints for managing medications and recording medication taken events.
"""
import uuid
from datetime import datetime, timezone, date, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, Header
from sqlalchemy import select, func, and_
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from core.db import get_db
from models.medications import (
    Medication,
    MedicationTakenEvent,
    MedicationStatus,
    MedicationFrequency,
    MedicationRoute,
    DoseTakenStatus,
)
from models.outbox import enqueue_clinical_event, enqueue_medication, enqueue_medication_taken
from models.events import ClinicalEvent, EventType, SourceType, VerificationStatus
from schemas.medications import (
    MedicationCreate,
    MedicationUpdate,
    MedicationResponse,
    MedicationListResponse,
    MedicationTakenCreate,
    MedicationTakenResponse,
    MedicationTakenListResponse,
    ActiveMedicationForDailyLog,
    DailyMedicationSchedule,
)

router = APIRouter(prefix="/api/v1/medications", tags=["medications"])


# ═══════════════════════════════════════════════════════════════════════════════
# Medication CRUD
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("", response_model=MedicationListResponse)
def list_medications(
    status: Optional[MedicationStatus] = Query(None),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
):
    """List all medications for the authenticated patient."""
    query = select(Medication).where(Medication.patient_id == patient_id)
    
    if status:
        query = query.where(Medication.status == status)
    
    query = query.order_by(Medication.created_at.desc())
    
    medications = db.execute(query).scalars().all()
    
    return MedicationListResponse(
        medications=[MedicationResponse.model_validate(m) for m in medications],
        total=len(medications),
    )


@router.get("/active", response_model=List[ActiveMedicationForDailyLog])
def list_active_medications(
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
):
    """List active medications for the daily log view."""
    query = (
        select(Medication)
        .where(
            and_(
                Medication.patient_id == patient_id,
                Medication.status == MedicationStatus.ACTIVE,
            )
        )
        .order_by(Medication.name)
    )
    
    medications = db.execute(query).scalars().all()
    
    return [ActiveMedicationForDailyLog.model_validate(m) for m in medications]


@router.get("/schedule/{target_date}", response_model=List[DailyMedicationSchedule])
def get_daily_schedule(
    target_date: date,
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
):
    """Get the medication schedule for a specific date with taken status."""
    # Get active medications
    query = (
        select(Medication)
        .where(
            and_(
                Medication.patient_id == patient_id,
                Medication.status == MedicationStatus.ACTIVE,
            )
        )
    )
    medications = db.execute(query).scalars().all()

    # Single bulk fetch of taken events for the whole day (one indexed range
    # query) instead of one query per medication. Grouped in Python below —
    # identical matching semantics.
    day_start = datetime.combine(target_date, datetime.min.time(), tzinfo=timezone.utc)
    day_end = datetime.combine(target_date, datetime.max.time(), tzinfo=timezone.utc)
    candidate_ids = [med.medication_id for med in medications]
    taken_by_med: dict = {}
    if candidate_ids:
        all_taken = db.execute(
            select(MedicationTakenEvent).where(
                and_(
                    MedicationTakenEvent.medication_id.in_(candidate_ids),
                    MedicationTakenEvent.patient_id == patient_id,
                    MedicationTakenEvent.taken_at >= day_start,
                    MedicationTakenEvent.taken_at <= day_end,
                )
            )
        ).scalars().all()
        for event in all_taken:
            taken_by_med.setdefault(event.medication_id, []).append(event)

    schedule = []

    for med in medications:
        # Skip medications that haven't started yet
        if med.start_date and med.start_date > target_date:
            continue

        # Skip medications that have ended
        if med.end_date and med.end_date < target_date:
            continue

        # Check if medication is scheduled for this day of week
        if med.scheduled_weekdays and target_date.weekday() not in med.scheduled_weekdays:
            continue
        
        # Get scheduled times
        scheduled_times = med.scheduled_times or []
        
        # If no scheduled times, use frequency to infer
        if not scheduled_times:
            if med.frequency == MedicationFrequency.ONCE_DAILY:
                scheduled_times = ["08:00"]
            elif med.frequency == MedicationFrequency.TWICE_DAILY:
                scheduled_times = ["08:00", "20:00"]
            elif med.frequency == MedicationFrequency.THREE_TIMES_DAILY:
                scheduled_times = ["08:00", "14:00", "20:00"]
            elif med.frequency == MedicationFrequency.FOUR_TIMES_DAILY:
                scheduled_times = ["08:00", "12:00", "16:00", "20:00"]
            elif med.frequency == MedicationFrequency.EVERY_MORNING:
                scheduled_times = ["08:00"]
            elif med.frequency == MedicationFrequency.EVERY_EVENING:
                scheduled_times = ["20:00"]
            elif med.frequency == MedicationFrequency.EVERY_NIGHT:
                scheduled_times = ["22:00"]
            elif med.frequency == MedicationFrequency.EVERY_8_HOURS:
                scheduled_times = ["08:00", "16:00", "00:00"]
            elif med.frequency == MedicationFrequency.EVERY_12_HOURS:
                scheduled_times = ["08:00", "20:00"]
            elif med.frequency == MedicationFrequency.WEEKLY:
                scheduled_times = ["08:00"]
            elif med.frequency == MedicationFrequency.AS_NEEDED:
                scheduled_times = []  # PRN medications don't have scheduled times
            else:
                scheduled_times = ["08:00"]  # Default
        
        # Taken events for this medication on this date (from the bulk fetch).
        taken_events = taken_by_med.get(med.medication_id, [])

        # Build schedule entries
        for scheduled_time in scheduled_times:
            # Check if this scheduled time has been taken
            taken = False
            taken_event_id = None
            taken_at = None
            
            for event in taken_events:
                # Match by scheduled time or within a reasonable window
                event_time = event.taken_at.strftime("%H:%M")
                if event_time == scheduled_time or (
                    event.scheduled_for and event.scheduled_for.strftime("%H:%M") == scheduled_time
                ):
                    taken = True
                    taken_event_id = event.event_id
                    taken_at = event.taken_at
                    break
            
            schedule.append(DailyMedicationSchedule(
                medication=ActiveMedicationForDailyLog.model_validate(med),
                scheduled_time=scheduled_time,
                taken=taken,
                taken_event_id=taken_event_id,
                taken_at=taken_at,
            ))
    
    return schedule


@router.post("", response_model=MedicationResponse)
def create_medication(
    payload: MedicationCreate,
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """Create a new medication.

    Supports idempotency via the Idempotency-Key header.
    If the same key is reused with the same payload, the original result is returned.
    If the same key is reused with a different payload, 409 is returned.
    """
    from services.idempotency import compute_request_hash, check_idempotency, store_idempotency_key

    # Compute request hash for comparison
    request_hash = compute_request_hash(payload.model_dump())

    # Check idempotency if key provided
    if idempotency_key:
        existing = check_idempotency(db, patient_id, idempotency_key, request_hash)
        if existing:
            if existing["status"] == "conflict":
                raise HTTPException(status_code=409, detail=existing["error"])
            if existing["status"] == "replay":
                return existing["response"]

    medication = Medication(
        patient_id=patient_id,
        name=payload.name,
        generic_name=payload.generic_name,
        brand_name=payload.brand_name,
        strength=payload.strength,
        strength_unit=payload.strength_unit,
        dose_amount=payload.dose_amount,
        dose_unit=payload.dose_unit,
        route=payload.route,
        frequency=payload.frequency,
        scheduled_times=payload.scheduled_times,
        scheduled_weekdays=payload.scheduled_weekdays,
        start_date=payload.start_date,
        end_date=payload.end_date,
        status=payload.status,
        purpose=payload.purpose,
        instructions=payload.instructions,
        prescriber=payload.prescriber,
        prn=payload.prn,
        reminder_enabled=payload.reminder_enabled,
        notes=payload.notes,
        source_document_id=payload.source_document_id,
    )
    
    db.add(medication)
    db.flush()
    
    # Enqueue for graph sync
    enqueue_medication(
        db,
        medication_id=medication.medication_id,
        patient_id=patient_id,
        name=medication.name,
        generic_name=medication.generic_name,
        brand_name=medication.brand_name,
        strength=medication.strength,
        strength_unit=medication.strength_unit,
        dose_amount=medication.dose_amount,
        dose_unit=medication.dose_unit,
        route=medication.route.value if medication.route else None,
        frequency=medication.frequency.value,
        scheduled_times=medication.scheduled_times,
        start_date=medication.start_date.isoformat() if medication.start_date else None,
        end_date=medication.end_date.isoformat() if medication.end_date else None,
        status=medication.status.value,
        purpose=medication.purpose,
        instructions=medication.instructions,
        prescriber=medication.prescriber,
        prn=medication.prn,
        reminder_enabled=medication.reminder_enabled,
        notes=medication.notes,
    )
    
    # Store idempotency key INSIDE the transaction before commit
    # This ensures atomicity: either both the mutation and idempotency key
    # are committed, or neither is.
    if idempotency_key:
        store_idempotency_key(
            db, patient_id, idempotency_key, "create_medication",
            request_hash, 201, MedicationResponse.model_validate(medication).model_dump(mode="json"),
        )
    
    db.commit()
    db.refresh(medication)
    
    return MedicationResponse.model_validate(medication)


@router.get("/{medication_id}", response_model=MedicationResponse)
def get_medication(
    medication_id: uuid.UUID,
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
):
    """Get a specific medication."""
    medication = db.execute(
        select(Medication).where(
            and_(
                Medication.medication_id == medication_id,
                Medication.patient_id == patient_id,
            )
        )
    ).scalar_one_or_none()
    
    if not medication:
        raise HTTPException(status_code=404, detail="Medication not found")
    
    return MedicationResponse.model_validate(medication)


@router.put("/{medication_id}", response_model=MedicationResponse)
def update_medication(
    medication_id: uuid.UUID,
    payload: MedicationUpdate,
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
):
    """Update a medication."""
    medication = db.execute(
        select(Medication).where(
            and_(
                Medication.medication_id == medication_id,
                Medication.patient_id == patient_id,
            )
        )
    ).scalar_one_or_none()
    
    if not medication:
        raise HTTPException(status_code=404, detail="Medication not found")
    
    # Update fields that are provided
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(medication, field, value)
    
    # Enqueue for graph sync
    enqueue_medication(
        db,
        medication_id=medication.medication_id,
        patient_id=patient_id,
        name=medication.name,
        generic_name=medication.generic_name,
        brand_name=medication.brand_name,
        strength=medication.strength,
        strength_unit=medication.strength_unit,
        dose_amount=medication.dose_amount,
        dose_unit=medication.dose_unit,
        route=medication.route.value if medication.route else None,
        frequency=medication.frequency.value,
        scheduled_times=medication.scheduled_times,
        start_date=medication.start_date.isoformat() if medication.start_date else None,
        end_date=medication.end_date.isoformat() if medication.end_date else None,
        status=medication.status.value,
        purpose=medication.purpose,
        instructions=medication.instructions,
        prescriber=medication.prescriber,
        prn=medication.prn,
        reminder_enabled=medication.reminder_enabled,
        notes=medication.notes,
    )
    
    db.commit()
    db.refresh(medication)
    
    return MedicationResponse.model_validate(medication)


@router.delete("/{medication_id}")
def delete_medication(
    medication_id: uuid.UUID,
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
):
    """Delete a medication (soft delete by setting status to DISCONTINUED)."""
    medication = db.execute(
        select(Medication).where(
            and_(
                Medication.medication_id == medication_id,
                Medication.patient_id == patient_id,
            )
        )
    ).scalar_one_or_none()
    
    if not medication:
        raise HTTPException(status_code=404, detail="Medication not found")
    
    medication.status = MedicationStatus.DISCONTINUED
    medication.end_date = date.today()
    
    # Enqueue for graph sync
    enqueue_medication(
        db,
        medication_id=medication.medication_id,
        patient_id=patient_id,
        name=medication.name,
        generic_name=medication.generic_name,
        brand_name=medication.brand_name,
        strength=medication.strength,
        strength_unit=medication.strength_unit,
        dose_amount=medication.dose_amount,
        dose_unit=medication.dose_unit,
        route=medication.route.value if medication.route else None,
        frequency=medication.frequency.value,
        scheduled_times=medication.scheduled_times,
        start_date=medication.start_date.isoformat() if medication.start_date else None,
        end_date=medication.end_date.isoformat() if medication.end_date else None,
        status=medication.status.value,
        purpose=medication.purpose,
        instructions=medication.instructions,
        prescriber=medication.prescriber,
        prn=medication.prn,
        reminder_enabled=medication.reminder_enabled,
        notes=medication.notes,
    )
    
    db.commit()
    
    return {"message": "Medication discontinued"}


# ═══════════════════════════════════════════════════════════════════════════════
# Medication Taken Events
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/taken", response_model=MedicationTakenResponse)
def record_medication_taken(
    payload: MedicationTakenCreate,
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """Record that a medication dose was taken.

    Supports idempotency via the Idempotency-Key header.
    If the same key is reused with the same payload, the original result is returned.
    If the same key is reused with a different payload, 409 is returned.
    """
    from services.idempotency import compute_request_hash, check_idempotency, store_idempotency_key

    # Compute request hash for comparison
    request_hash = compute_request_hash(payload.model_dump())

    # Check idempotency if key provided
    if idempotency_key:
        existing = check_idempotency(db, patient_id, idempotency_key, request_hash)
        if existing:
            if existing["status"] == "conflict":
                raise HTTPException(status_code=409, detail=existing["error"])
            if existing["status"] == "replay":
                return existing["response"]

    # Verify medication exists and belongs to patient
    medication = db.execute(
        select(Medication).where(
            and_(
                Medication.medication_id == payload.medication_id,
                Medication.patient_id == patient_id,
            )
        )
    ).scalar_one_or_none()
    
    if not medication:
        raise HTTPException(status_code=404, detail="Medication not found")
    
    # Use provided taken_at or default to now
    taken_at = payload.taken_at or datetime.now(timezone.utc)
    
    # Create the taken event
    taken_event = MedicationTakenEvent(
        medication_id=payload.medication_id,
        patient_id=patient_id,
        taken_at=taken_at,
        scheduled_for=payload.scheduled_for,
        dose_taken=payload.dose_taken or medication.dose_amount,
        dose_unit=payload.dose_unit or medication.dose_unit,
        status=payload.status,
        notes=payload.notes,
        clinical_event_id=payload.clinical_event_id,
    )
    
    db.add(taken_event)
    db.flush()
    
    # Also create a ClinicalEvent for backward compatibility
    clinical_event = ClinicalEvent(
        event_id=uuid.uuid4(),
        patient_id=patient_id,
        concept_id=None,
        event_type=EventType.MEDICATION_TAKEN,
        source_type=SourceType.PATIENT_REPORTED,
        verification_status=VerificationStatus.HUMAN_VERIFIED,
        event_time=taken_at,
    )
    
    db.add(clinical_event)
    db.flush()
    
    # Link the taken event to the clinical event
    taken_event.clinical_event_id = clinical_event.event_id
    
    # Enqueue for graph sync
    enqueue_clinical_event(
        db,
        event_id=clinical_event.event_id,
        patient_id=patient_id,
        event_type=clinical_event.event_type,
        source_type=clinical_event.source_type,
        verification_status=clinical_event.verification_status,
        event_time=clinical_event.event_time,
    )
    
    # Also enqueue the medication taken event for richer graph
    enqueue_medication_taken(
        db,
        event_id=taken_event.event_id,
        patient_id=patient_id,
        medication_id=payload.medication_id,
        taken_at=taken_at.isoformat(),
        scheduled_for=payload.scheduled_for.isoformat() if payload.scheduled_for else None,
        dose_taken=taken_event.dose_taken,
        dose_unit=taken_event.dose_unit,
        status=taken_event.status.value,
        notes=taken_event.notes,
    )
    
    # Store idempotency key INSIDE the transaction before commit
    # This ensures atomicity: either both the mutation and idempotency key
    # are committed, or neither is.
    if idempotency_key:
        store_idempotency_key(
            db, patient_id, idempotency_key, "record_medication_taken",
            request_hash, 201, MedicationTakenResponse.model_validate(taken_event).model_dump(mode="json"),
        )
    
    db.commit()
    db.refresh(taken_event)
    
    return MedicationTakenResponse.model_validate(taken_event)


@router.get("/{medication_id}/taken", response_model=MedicationTakenListResponse)
def list_medication_taken_events(
    medication_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
):
    """List taken events for a specific medication."""
    # Verify medication belongs to patient
    medication = db.execute(
        select(Medication).where(
            and_(
                Medication.medication_id == medication_id,
                Medication.patient_id == patient_id,
            )
        )
    ).scalar_one_or_none()
    
    if not medication:
        raise HTTPException(status_code=404, detail="Medication not found")
    
    query = (
        select(MedicationTakenEvent)
        .where(
            and_(
                MedicationTakenEvent.medication_id == medication_id,
                MedicationTakenEvent.patient_id == patient_id,
            )
        )
        .order_by(MedicationTakenEvent.taken_at.desc())
        .limit(limit)
    )
    
    events = db.execute(query).scalars().all()
    
    return MedicationTakenListResponse(
        events=[MedicationTakenResponse.model_validate(e) for e in events],
        total=len(events),
    )