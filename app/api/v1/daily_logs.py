import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, delete, func
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from core.db import get_db
from logger import logger

from models.events import (
    ClinicalEvent,
    EvidenceLink,
    EventType,
    SourceType,
    VerificationStatus,
)
from models.outbox import enqueue_clinical_event
from models.ontology import MedicalConcept
from models.anatomy import (
    AnatomicalObservation,
    AnatomicalStructure,
    FindingTrend,
    ObservationType,
    SourceType as AnatomySourceType,
    VisualStatus,
)
from services.anatomy.body_state_service import (
    record_anatomical_observation,
)

from models.daily_logs.events import (
    ActivityPayload,
    MedicationTakenPayload,
    NutritionPayload,
    PainPayload,
    SleepPayload,
    SymptomPayload,
    VitalSignPayload,
    WellbeingPayload,
    PatientNotePayload,
)

from schemas.daily_logs import DailyCheckInRequest
from services.summaries.daily_summary_service import upsert_daily_summary


router = APIRouter(
    prefix="/api/v1/logs",
    tags=["daily_logs"],
)


@router.post("/daily-checkin")
def submit_daily_checkin(
    payload: DailyCheckInRequest,
    request: Request,
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    """
    Persist a complete daily health check-in as a set of
    canonical ClinicalEvent records and their payload tables.

    The authenticated Firebase token determines patient_id.
    The client never provides patient_id.

    All child payload rows are inserted only after their
    parent ClinicalEvent has been flushed to PostgreSQL.
    """

    deidentifier = request.app.state.deidentifier

    daily_group_id = uuid.uuid4()

    timestamp = datetime.combine(
        payload.log_date,
        datetime.min.time(),
        tzinfo=timezone.utc,
    )

    # =========================================================================
    # Validate referenced medical concepts
    # =========================================================================

    concept_ids = {
        item.concept_id
        for item in payload.vitals
    }

    concept_ids.update(
        item.concept_id
        for item in payload.symptoms
    )

    if concept_ids:
        active_concept_ids = set(
            db.scalars(
                select(MedicalConcept.id).where(
                    MedicalConcept.id.in_(concept_ids),
                    MedicalConcept.active.is_(True),
                )
            ).all()
        )

        unknown_concept_ids = (
            concept_ids - active_concept_ids
        )

        if unknown_concept_ids:
            raise HTTPException(
                status_code=422,
                detail=(
                    "One or more submitted medical concepts "
                    "are unknown or inactive."
                ),
            )

    # =========================================================================
    # Wellbeing
    # =========================================================================

    if any(value is not None for value in (payload.overall_wellbeing, payload.energy_level, payload.stress_level)):
        event_id = uuid.uuid4()

        event = ClinicalEvent(
            event_id=event_id,
            patient_id=patient_id,
            concept_id=None,
            event_type=EventType.WELLBEING_LOG,
            source_type=SourceType.PATIENT_REPORTED,
            verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp,
            group_id=daily_group_id,
        )

        db.add(event)
        db.flush()

        enqueue_clinical_event(
            db,
            event_id=event.event_id,
            patient_id=patient_id,
            event_type=event.event_type,
            source_type=event.source_type,
            verification_status=event.verification_status,
            event_time=event.event_time,
        )

        db.add(
            WellbeingPayload(
                event_id=event_id,
                overall_wellbeing=payload.overall_wellbeing,
                energy_level=payload.energy_level,
                stress_level=payload.stress_level,
            )
        )

    # =========================================================================
    # Symptoms
    # =========================================================================

    for symptom in payload.symptoms:
        symptom_event_id = uuid.uuid4()

        safe_notes = None

        if symptom.notes and symptom.notes.strip():
            result = deidentifier.deidentify(
                symptom.notes
            )

            if not result.validation_passed:
                logger.warning(
                    "Sanitization failed for symptom notes: %s",
                    result.validation_errors,
                )

                raise HTTPException(
                    status_code=422,
                    detail=(
                        "Symptom note could not be safely stored."
                    ),
                )

            safe_notes = result.text

        symptom_event = ClinicalEvent(
            event_id=symptom_event_id,
            patient_id=patient_id,
            concept_id=symptom.concept_id,
            event_type=EventType.SYMPTOM,
            source_type=SourceType.PATIENT_REPORTED,
            verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp,
            group_id=daily_group_id,
        )

        db.add(symptom_event)
        db.flush()

        enqueue_clinical_event(
            db,
            event_id=symptom_event.event_id,
            patient_id=patient_id,
            event_type=symptom_event.event_type,
            source_type=symptom_event.source_type,
            verification_status=symptom_event.verification_status,
            event_time=symptom_event.event_time,
        )

        db.add(
            SymptomPayload(
                event_id=symptom_event_id,
                severity=symptom.severity,
                duration_minutes=symptom.duration_minutes,
                notes=symptom.notes,
                safe_notes=safe_notes,
            )
        )

    # =========================================================================
    # Vitals
    # =========================================================================

    for vital in payload.vitals:
        vital_event_id = uuid.uuid4()

        vital_event = ClinicalEvent(
            event_id=vital_event_id,
            patient_id=patient_id,
            concept_id=vital.concept_id,
            event_type=EventType.VITAL_SIGN,
            source_type=SourceType.PATIENT_REPORTED,
            verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp,
            group_id=daily_group_id,
        )

        db.add(vital_event)
        db.flush()

        enqueue_clinical_event(
            db,
            event_id=vital_event.event_id,
            patient_id=patient_id,
            event_type=vital_event.event_type,
            source_type=vital_event.source_type,
            verification_status=vital_event.verification_status,
            event_time=vital_event.event_time,
        )

        db.add(
            VitalSignPayload(
                event_id=vital_event_id,
                value=vital.value,
                unit=vital.unit,
            )
        )

    # =========================================================================
    # Pain
    # =========================================================================

    for pain in payload.pain:
        pain_event_id = uuid.uuid4()

        pain_event = ClinicalEvent(
            event_id=pain_event_id,
            patient_id=patient_id,
            concept_id=None,
            event_type=EventType.PAIN_LOG,
            source_type=SourceType.PATIENT_REPORTED,
            verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp,
            group_id=daily_group_id,
        )

        db.add(pain_event)
        db.flush()

        enqueue_clinical_event(
            db,
            event_id=pain_event.event_id,
            patient_id=patient_id,
            event_type=pain_event.event_type,
            source_type=pain_event.source_type,
            verification_status=pain_event.verification_status,
            event_time=pain_event.event_time,
        )

        db.add(
            PainPayload(
                event_id=pain_event_id,
                body_location_id=pain.body_location_id,
                severity=pain.severity,
                pain_type=pain.pain_type,
            )
        )

        # -----------------------------------------------------------------
        # Anatomical observation (only when structure_id is provided)
        # -----------------------------------------------------------------

        if pain.structure_id:
            anatomical_structure = db.scalar(
                select(AnatomicalStructure).where(
                    AnatomicalStructure.structure_id
                    == pain.structure_id
                )
            )

            if anatomical_structure:
                severity_score = (
                    pain.severity / 10.0
                )

                visual_status = (
                    VisualStatus.NORMAL
                    if pain.severity <= 3
                    else VisualStatus.MILD_ATTENTION
                    if pain.severity <= 6
                    else VisualStatus.WARNING
                    if pain.severity <= 8
                    else VisualStatus.CRITICAL
                )

                pain_observation = AnatomicalObservation(
                    observation_id=uuid.uuid4(),
                    patient_id=patient_id,
                    structure_id=pain.structure_id,
                    observation_type=ObservationType.SYMPTOM,
                    finding_code="pain_level",
                    finding_display_name="Pain",
                    visual_status=visual_status,
                    visual_severity_score=severity_score,
                    trend=FindingTrend.STABLE,
                    source_type=AnatomySourceType.PATIENT_REPORTED,
                    source_id=str(pain_event_id),
                    event_id=pain_event_id,
                    clinical_summary=pain.pain_type,
                    recorded_at=timestamp,
                    ingested_at=datetime.now(timezone.utc),
                )

                record_anatomical_observation(
                    db,
                    pain_observation,
                    auto_commit=False,
                )

    # =========================================================================
    # Sleep
    # =========================================================================

    if payload.sleep is not None:
        sleep_event_id = uuid.uuid4()

        sleep_event = ClinicalEvent(
            event_id=sleep_event_id,
            patient_id=patient_id,
            concept_id=None,
            event_type=EventType.SLEEP_LOG,
            source_type=SourceType.PATIENT_REPORTED,
            verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp,
            group_id=daily_group_id,
        )

        db.add(sleep_event)
        db.flush()

        enqueue_clinical_event(
            db,
            event_id=sleep_event.event_id,
            patient_id=patient_id,
            event_type=sleep_event.event_type,
            source_type=sleep_event.source_type,
            verification_status=sleep_event.verification_status,
            event_time=sleep_event.event_time,
        )

        db.add(
            SleepPayload(
                event_id=sleep_event_id,
                duration_minutes=payload.sleep.duration_minutes,
                sleep_quality=payload.sleep.sleep_quality,
                awakenings=payload.sleep.awakenings,
            )
        )

    # =========================================================================
    # Activities
    # =========================================================================

    for activity in payload.activities:
        activity_event_id = uuid.uuid4()

        activity_event = ClinicalEvent(
            event_id=activity_event_id,
            patient_id=patient_id,
            concept_id=None,
            event_type=EventType.ACTIVITY_LOG,
            source_type=SourceType.PATIENT_REPORTED,
            verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp,
            group_id=daily_group_id,
        )

        db.add(activity_event)
        db.flush()

        enqueue_clinical_event(
            db,
            event_id=activity_event.event_id,
            patient_id=patient_id,
            event_type=activity_event.event_type,
            source_type=activity_event.source_type,
            verification_status=activity_event.verification_status,
            event_time=activity_event.event_time,
        )

        db.add(
            ActivityPayload(
                event_id=activity_event_id,
                activity_type=activity.activity_type,
                duration_minutes=activity.duration_minutes,
                calories_burned=activity.calories_burned,
            )
        )

    # =========================================================================
    # Nutrition
    # =========================================================================

    if payload.nutrition is not None:
        nutrition_event_id = uuid.uuid4()

        nutrition_event = ClinicalEvent(
            event_id=nutrition_event_id,
            patient_id=patient_id,
            concept_id=None,
            event_type=EventType.NUTRITION_LOG,
            source_type=SourceType.PATIENT_REPORTED,
            verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp,
            group_id=daily_group_id,
        )

        db.add(nutrition_event)
        db.flush()

        enqueue_clinical_event(
            db,
            event_id=nutrition_event.event_id,
            patient_id=patient_id,
            event_type=nutrition_event.event_type,
            source_type=nutrition_event.source_type,
            verification_status=nutrition_event.verification_status,
            event_time=nutrition_event.event_time,
        )

        db.add(
            NutritionPayload(
                event_id=nutrition_event_id,
                water_ml=payload.nutrition.water_ml,
                meals_count=payload.nutrition.meals_count,
                appetite_level=payload.nutrition.appetite_level,
            )
        )

    # =========================================================================
    # Medications
    # =========================================================================

    for medication in payload.medications:
        medication_event_id = uuid.uuid4()

        medication_event = ClinicalEvent(
            event_id=medication_event_id,
            patient_id=patient_id,
            concept_id=None,
            event_type=EventType.MEDICATION_TAKEN,
            source_type=SourceType.PATIENT_REPORTED,
            verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp,
            group_id=daily_group_id,
        )

        db.add(medication_event)
        db.flush()

        enqueue_clinical_event(
            db,
            event_id=medication_event.event_id,
            patient_id=patient_id,
            event_type=medication_event.event_type,
            source_type=medication_event.source_type,
            verification_status=medication_event.verification_status,
            event_time=medication_event.event_time,
        )

        db.add(
            MedicationTakenPayload(
                event_id=medication_event_id,
                medication_name=medication.medication_name,
                dosage_value=medication.dosage_value,
                dosage_unit=medication.dosage_unit,
            )
        )

    # =========================================================================
    # Daily Note
    # =========================================================================
    #
    # DailyCheckInRequest in some repository revisions does not expose
    # `notes`. Use getattr so the endpoint remains compatible with the
    # current schema until the field is formally added.
    # =========================================================================

    daily_note = getattr(
        payload,
        "notes",
        None,
    )

    if daily_note and daily_note.strip():
        result = deidentifier.deidentify(
            daily_note
        )

        if not result.validation_passed:
            raise HTTPException(
                status_code=422,
                detail=(
                    "Daily note could not be safely stored."
                ),
            )

        note_event_id = uuid.uuid4()

        note_event = ClinicalEvent(
            event_id=note_event_id,
            patient_id=patient_id,
            concept_id=None,
            event_type=EventType.WELLBEING_LOG,
            source_type=SourceType.PATIENT_REPORTED,
            verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp,
            group_id=daily_group_id,
        )

        db.add(note_event)
        db.flush()

        enqueue_clinical_event(
            db,
            event_id=note_event.event_id,
            patient_id=patient_id,
            event_type=note_event.event_type,
            source_type=note_event.source_type,
            verification_status=note_event.verification_status,
            event_time=note_event.event_time,
        )

        db.add(
            PatientNotePayload(
                event_id=note_event_id,
                safe_notes=result.text,
            )
        )

    # =========================================================================
    # Atomic commit
    # =========================================================================

    try:
        db.commit()

    except Exception:
        db.rollback()

        logger.exception(
            "Failed to persist daily check-in"
        )

        raise HTTPException(
            status_code=500,
            detail="Failed to save daily log.",
        )

    # =========================================================================
    # Daily summary update (best-effort, non-blocking)
    # =========================================================================
    # The summary is a derived read-model cache.  If the update fails
    # the clinical data is already committed and the summary can be
    # rebuilt later.

    try:
        upsert_daily_summary(
            db,
            patient_id,
            payload.log_date,
            auto_commit=True,
        )
    except Exception:
        logger.warning(
            "Daily summary update failed for patient=%s date=%s",
            patient_id,
            payload.log_date,
            exc_info=True,
        )

    return {
        "status": "success",
        "group_id": daily_group_id,
        "message": (
            "Daily log successfully persisted "
            "to the longitudinal timeline."
        ),
    }


# ===========================================================================
# Response schema for GET daily-checkin
# ===========================================================================


class DailyCheckInResponse(BaseModel):
    """Reconstructed daily check-in payload for a specific date."""
    group_id: str
    log_date: str
    overall_wellbeing: int | None = None
    energy_level: int | None = None
    stress_level: int | None = None
    sleep_duration_minutes: int | None = None
    sleep_quality: int | None = None
    sleep_awakenings: int | None = None
    water_ml: int | None = None
    meals_count: int | None = None
    appetite_level: int | None = None
    symptoms: list[dict] = []
    vitals: list[dict] = []
    pain: list[dict] = []
    activities: list[dict] = []
    medications: list[dict] = []
    notes: str | None = None


def _reconstruct_checkin(
    db: Session,
    events: list[ClinicalEvent],
    group_id: uuid.UUID,
) -> DailyCheckInResponse:
    """Reconstruct a DailyCheckInResponse from a group of ClinicalEvents."""
    result = DailyCheckInResponse(
        group_id=str(group_id),
        log_date="",
    )

    if not events:
        return result

    # Use the first event's date as the log date
    result.log_date = events[0].event_time.date().isoformat()

    for event in events:
        if event.event_type == EventType.WELLBEING_LOG:
            # Check if this is a note or a wellbeing log
            note_payload = db.get(PatientNotePayload, event.event_id)
            if note_payload:
                result.notes = note_payload.safe_notes
            else:
                wb = db.get(WellbeingPayload, event.event_id)
                if wb:
                    result.overall_wellbeing = wb.overall_wellbeing
                    result.energy_level = wb.energy_level
                    result.stress_level = wb.stress_level

        elif event.event_type == EventType.SLEEP_LOG:
            sleep = db.get(SleepPayload, event.event_id)
            if sleep:
                result.sleep_duration_minutes = sleep.duration_minutes
                result.sleep_quality = sleep.sleep_quality
                result.sleep_awakenings = sleep.awakenings

        elif event.event_type == EventType.SYMPTOM:
            symptom = db.get(SymptomPayload, event.event_id)
            if symptom:
                result.symptoms.append({
                    "concept_id": str(event.concept_id) if event.concept_id else None,
                    "severity": symptom.severity,
                    "duration_minutes": symptom.duration_minutes,
                    "notes": symptom.notes,
                })

        elif event.event_type == EventType.VITAL_SIGN:
            vital = db.get(VitalSignPayload, event.event_id)
            if vital:
                result.vitals.append({
                    "concept_id": str(event.concept_id) if event.concept_id else None,
                    "value": vital.value,
                    "unit": vital.unit,
                })

        elif event.event_type == EventType.PAIN_LOG:
            pain = db.get(PainPayload, event.event_id)
            if pain:
                result.pain.append({
                    "body_location_id": str(pain.body_location_id) if pain.body_location_id else None,
                    "severity": pain.severity,
                    "pain_type": pain.pain_type,
                })

        elif event.event_type == EventType.ACTIVITY_LOG:
            activity = db.get(ActivityPayload, event.event_id)
            if activity:
                result.activities.append({
                    "activity_type": activity.activity_type,
                    "duration_minutes": activity.duration_minutes,
                    "calories_burned": activity.calories_burned,
                })

        elif event.event_type == EventType.MEDICATION_TAKEN:
            med = db.get(MedicationTakenPayload, event.event_id)
            if med:
                result.medications.append({
                    "medication_name": med.medication_name,
                    "dosage_value": med.dosage_value,
                    "dosage_unit": med.dosage_unit,
                })

        elif event.event_type == EventType.NUTRITION_LOG:
            nut = db.get(NutritionPayload, event.event_id)
            if nut:
                result.water_ml = nut.water_ml
                result.meals_count = nut.meals_count
                result.appetite_level = nut.appetite_level

    return result


@router.get("/daily-checkin/{check_date}", response_model=DailyCheckInResponse)
def get_daily_checkin(
    check_date: date,
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    """
    Retrieve the existing daily check-in for a specific date.

    Returns the reconstructed payload that was originally submitted,
    so the frontend can pre-populate the form for editing.

    If multiple check-in groups exist for the same date, returns the
    most recent one (by group creation order).
    """
    day_start = datetime.combine(check_date, datetime.min.time(), tzinfo=timezone.utc)
    day_end = datetime.combine(check_date, datetime.max.time(), tzinfo=timezone.utc)

    # Find all events for this patient on this date with a group_id
    events = db.scalars(
        select(ClinicalEvent).where(
            ClinicalEvent.patient_id == patient_id,
            ClinicalEvent.event_time >= day_start,
            ClinicalEvent.event_time <= day_end,
            ClinicalEvent.group_id.isnot(None),
        ).order_by(ClinicalEvent.event_time.desc())
    ).all()

    if not events:
        raise HTTPException(
            status_code=404,
            detail=f"No daily check-in found for {check_date}.",
        )

    # Group events by group_id — use the most recent group
    groups: dict[uuid.UUID, list[ClinicalEvent]] = {}
    for event in events:
        gid = event.group_id
        if gid not in groups:
            groups[gid] = []
        groups[gid].append(event)

    # Use the group with the latest event_time
    latest_group_id = max(
        groups.keys(),
        key=lambda gid: max(e.event_time for e in groups[gid]),
    )

    return _reconstruct_checkin(db, groups[latest_group_id], latest_group_id)


@router.put("/daily-checkin/{group_id}")
def update_daily_checkin(
    group_id: uuid.UUID,
    payload: DailyCheckInRequest,
    request: Request,
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    """
    Update an existing daily check-in group.

    Deletes all events in the group and replaces them with the new
    payload. The group_id is preserved so the timeline maintains
    a consistent reference.

    Security: verifies that the group belongs to the authenticated patient.
    """
    # -----------------------------------------------------------------------
    # Verify the group belongs to this patient and is safe to replace
    # -----------------------------------------------------------------------
    existing_events = db.scalars(
        select(ClinicalEvent).where(
            ClinicalEvent.group_id == group_id,
            ClinicalEvent.patient_id == patient_id,
        )
    ).all()

    if not existing_events:
        raise HTTPException(
            status_code=404,
            detail="Daily check-in group not found or access denied.",
        )

    # Safety: only allow replacing PATIENT_REPORTED events.
    # LAB_REPORT, IMAGING_REPORT, etc. must never be deleted here.
    for event in existing_events:
        if event.source_type != SourceType.PATIENT_REPORTED:
            raise HTTPException(
                status_code=409,
                detail="Cannot replace non-patient-reported events.",
            )

    # Safety: verify no evidence links reference these events.
    # EvidenceLink.event_id has no CASCADE — deleting the event would
    # orphan the evidence record.
    event_ids = [e.event_id for e in existing_events]
    evidence_count = db.scalar(
        select(func.count()).select_from(
            select(EvidenceLink).where(
                EvidenceLink.event_id.in_(event_ids)
            ).subquery()
        )
    )
    if evidence_count and evidence_count > 0:
        raise HTTPException(
            status_code=409,
            detail="Cannot replace events that have linked evidence.",
        )

    # Safety: verify no anatomical observations reference these events.
    # AnatomicalObservation.event_id has no CASCADE — deleting the event
    # would orphan the observation record.
    observation_count = db.scalar(
        select(func.count()).select_from(
            select(AnatomicalObservation).where(
                AnatomicalObservation.event_id.in_(event_ids)
            ).subquery()
        )
    )
    if observation_count and observation_count > 0:
        raise HTTPException(
            status_code=409,
            detail="Cannot replace events that have anatomical observations.",
        )

    # -----------------------------------------------------------------------
    # Delete existing events in the group
    # (payloads cascade-delete via foreign key on event_id)
    # -----------------------------------------------------------------------
    for event in existing_events:
        db.delete(event)
    db.flush()

    # -----------------------------------------------------------------------
    # Create new events with the same group_id
    # (Reuses the same logic as submit_daily_checkin)
    # -----------------------------------------------------------------------
    deidentifier = request.app.state.deidentifier

    timestamp = datetime.combine(
        payload.log_date,
        datetime.min.time(),
        tzinfo=timezone.utc,
    )

    # Validate referenced medical concepts
    concept_ids = {item.concept_id for item in payload.vitals}
    concept_ids.update(item.concept_id for item in payload.symptoms)

    if concept_ids:
        active_concept_ids = set(
            db.scalars(
                select(MedicalConcept.id).where(
                    MedicalConcept.id.in_(concept_ids),
                    MedicalConcept.active.is_(True),
                )
            ).all()
        )
        unknown_concept_ids = concept_ids - active_concept_ids
        if unknown_concept_ids:
            raise HTTPException(
                status_code=422,
                detail="One or more submitted medical concepts are unknown or inactive.",
            )

    # Wellbeing
    if any(value is not None for value in (payload.overall_wellbeing, payload.energy_level, payload.stress_level)):
        event_id = uuid.uuid4()
        event = ClinicalEvent(
            event_id=event_id, patient_id=patient_id, concept_id=None,
            event_type=EventType.WELLBEING_LOG, source_type=SourceType.PATIENT_REPORTED,
            verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp, group_id=group_id,
        )
        db.add(event)
        db.flush()
        enqueue_clinical_event(
            db, event_id=event.event_id, patient_id=patient_id,
            event_type=event.event_type, source_type=event.source_type,
            verification_status=event.verification_status, event_time=event.event_time,
        )
        db.add(WellbeingPayload(
            event_id=event_id,
            overall_wellbeing=payload.overall_wellbeing,
            energy_level=payload.energy_level,
            stress_level=payload.stress_level,
        ))

    # Symptoms
    for symptom in payload.symptoms:
        symptom_event_id = uuid.uuid4()
        safe_notes = None
        if symptom.notes and symptom.notes.strip():
            result = deidentifier.deidentify(symptom.notes)
            if not result.validation_passed:
                raise HTTPException(status_code=422, detail="Symptom note could not be safely stored.")
            safe_notes = result.text

        symptom_event = ClinicalEvent(
            event_id=symptom_event_id, patient_id=patient_id, concept_id=symptom.concept_id,
            event_type=EventType.SYMPTOM, source_type=SourceType.PATIENT_REPORTED,
            verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp, group_id=group_id,
        )
        db.add(symptom_event)
        db.flush()
        enqueue_clinical_event(
            db, event_id=symptom_event.event_id, patient_id=patient_id,
            event_type=symptom_event.event_type, source_type=symptom_event.source_type,
            verification_status=symptom_event.verification_status, event_time=symptom_event.event_time,
        )
        db.add(SymptomPayload(
            event_id=symptom_event_id, severity=symptom.severity,
            duration_minutes=symptom.duration_minutes, notes=symptom.notes, safe_notes=safe_notes,
        ))

    # Vitals
    for vital in payload.vitals:
        vital_event_id = uuid.uuid4()
        vital_event = ClinicalEvent(
            event_id=vital_event_id, patient_id=patient_id, concept_id=vital.concept_id,
            event_type=EventType.VITAL_SIGN, source_type=SourceType.PATIENT_REPORTED,
            verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp, group_id=group_id,
        )
        db.add(vital_event)
        db.flush()
        enqueue_clinical_event(
            db, event_id=vital_event.event_id, patient_id=patient_id,
            event_type=vital_event.event_type, source_type=vital_event.source_type,
            verification_status=vital_event.verification_status, event_time=vital_event.event_time,
        )
        db.add(VitalSignPayload(event_id=vital_event_id, value=vital.value, unit=vital.unit))

    # Pain
    for pain in payload.pain:
        pain_event_id = uuid.uuid4()
        pain_event = ClinicalEvent(
            event_id=pain_event_id, patient_id=patient_id, concept_id=None,
            event_type=EventType.PAIN_LOG, source_type=SourceType.PATIENT_REPORTED,
            verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp, group_id=group_id,
        )
        db.add(pain_event)
        db.flush()
        enqueue_clinical_event(
            db, event_id=pain_event.event_id, patient_id=patient_id,
            event_type=pain_event.event_type, source_type=pain_event.source_type,
            verification_status=pain_event.verification_status, event_time=pain_event.event_time,
        )
        db.add(PainPayload(
            event_id=pain_event_id, body_location_id=pain.body_location_id,
            severity=pain.severity, pain_type=pain.pain_type,
        ))
        if pain.structure_id:
            anatomical_structure = db.scalar(select(AnatomicalStructure).where(AnatomicalStructure.structure_id == pain.structure_id))
            if anatomical_structure:
                severity_score = pain.severity / 10.0
                visual_status = (
                    VisualStatus.NORMAL if pain.severity <= 3
                    else VisualStatus.MILD_ATTENTION if pain.severity <= 6
                    else VisualStatus.WARNING if pain.severity <= 8
                    else VisualStatus.CRITICAL
                )
                pain_observation = AnatomicalObservation(
                    observation_id=uuid.uuid4(), patient_id=patient_id,
                    structure_id=pain.structure_id, observation_type=ObservationType.SYMPTOM,
                    finding_code="pain_level", finding_display_name="Pain",
                    visual_status=visual_status, visual_severity_score=severity_score,
                    trend=FindingTrend.STABLE, source_type=AnatomySourceType.PATIENT_REPORTED,
                    source_id=str(pain_event_id), event_id=pain_event_id,
                    clinical_summary=pain.pain_type, recorded_at=timestamp,
                    ingested_at=datetime.now(timezone.utc),
                )
                record_anatomical_observation(db, pain_observation, auto_commit=False)

    # Sleep
    if payload.sleep is not None:
        sleep_event_id = uuid.uuid4()
        sleep_event = ClinicalEvent(
            event_id=sleep_event_id, patient_id=patient_id, concept_id=None,
            event_type=EventType.SLEEP_LOG, source_type=SourceType.PATIENT_REPORTED,
            verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp, group_id=group_id,
        )
        db.add(sleep_event)
        db.flush()
        enqueue_clinical_event(
            db, event_id=sleep_event.event_id, patient_id=patient_id,
            event_type=sleep_event.event_type, source_type=sleep_event.source_type,
            verification_status=sleep_event.verification_status, event_time=sleep_event.event_time,
        )
        db.add(SleepPayload(
            event_id=sleep_event_id, duration_minutes=payload.sleep.duration_minutes,
            sleep_quality=payload.sleep.sleep_quality, awakenings=payload.sleep.awakenings,
        ))

    # Activities
    for activity in payload.activities:
        activity_event_id = uuid.uuid4()
        activity_event = ClinicalEvent(
            event_id=activity_event_id, patient_id=patient_id, concept_id=None,
            event_type=EventType.ACTIVITY_LOG, source_type=SourceType.PATIENT_REPORTED,
            verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp, group_id=group_id,
        )
        db.add(activity_event)
        db.flush()
        enqueue_clinical_event(
            db, event_id=activity_event.event_id, patient_id=patient_id,
            event_type=activity_event.event_type, source_type=activity_event.source_type,
            verification_status=activity_event.verification_status, event_time=activity_event.event_time,
        )
        db.add(ActivityPayload(
            event_id=activity_event_id, activity_type=activity.activity_type,
            duration_minutes=activity.duration_minutes, calories_burned=activity.calories_burned,
        ))

    # Nutrition
    if payload.nutrition is not None:
        nutrition_event_id = uuid.uuid4()
        nutrition_event = ClinicalEvent(
            event_id=nutrition_event_id, patient_id=patient_id, concept_id=None,
            event_type=EventType.NUTRITION_LOG, source_type=SourceType.PATIENT_REPORTED,
            verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp, group_id=group_id,
        )
        db.add(nutrition_event)
        db.flush()
        enqueue_clinical_event(
            db, event_id=nutrition_event.event_id, patient_id=patient_id,
            event_type=nutrition_event.event_type, source_type=nutrition_event.source_type,
            verification_status=nutrition_event.verification_status, event_time=nutrition_event.event_time,
        )
        db.add(NutritionPayload(
            event_id=nutrition_event_id, water_ml=payload.nutrition.water_ml,
            meals_count=payload.nutrition.meals_count, appetite_level=payload.nutrition.appetite_level,
        ))

    # Medications
    for medication in payload.medications:
        medication_event_id = uuid.uuid4()
        medication_event = ClinicalEvent(
            event_id=medication_event_id, patient_id=patient_id, concept_id=None,
            event_type=EventType.MEDICATION_TAKEN, source_type=SourceType.PATIENT_REPORTED,
            verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp, group_id=group_id,
        )
        db.add(medication_event)
        db.flush()
        enqueue_clinical_event(
            db, event_id=medication_event.event_id, patient_id=patient_id,
            event_type=medication_event.event_type, source_type=medication_event.source_type,
            verification_status=medication_event.verification_status, event_time=medication_event.event_time,
        )
        db.add(MedicationTakenPayload(
            event_id=medication_event_id, medication_name=medication.medication_name,
            dosage_value=medication.dosage_value, dosage_unit=medication.dosage_unit,
        ))

    # Daily Note
    daily_note = getattr(payload, "notes", None)
    if daily_note and daily_note.strip():
        result = deidentifier.deidentify(daily_note)
        if not result.validation_passed:
            raise HTTPException(status_code=422, detail="Daily note could not be safely stored.")
        note_event_id = uuid.uuid4()
        note_event = ClinicalEvent(
            event_id=note_event_id, patient_id=patient_id, concept_id=None,
            event_type=EventType.WELLBEING_LOG, source_type=SourceType.PATIENT_REPORTED,
            verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp, group_id=group_id,
        )
        db.add(note_event)
        db.flush()
        enqueue_clinical_event(
            db, event_id=note_event.event_id, patient_id=patient_id,
            event_type=note_event.event_type, source_type=note_event.source_type,
            verification_status=note_event.verification_status, event_time=note_event.event_time,
        )
        db.add(PatientNotePayload(event_id=note_event_id, safe_notes=result.text))

    # Atomic commit
    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to update daily check-in")
        raise HTTPException(status_code=500, detail="Failed to update daily log.")

    # Daily summary update (best-effort)
    try:
        upsert_daily_summary(db, patient_id, payload.log_date, auto_commit=True)
    except Exception:
        logger.warning("Daily summary update failed for patient=%s date=%s", patient_id, payload.log_date, exc_info=True)

    return {
        "status": "success",
        "group_id": str(group_id),
        "message": "Daily log updated successfully.",
    }