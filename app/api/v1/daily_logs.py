import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from core.db import get_db
from logger import logger

from models.events import (
    ClinicalEvent,
    EventType,
    SourceType,
    VerificationStatus,
)
from models.ontology import MedicalConcept

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

    if payload.overall_wellbeing is not None:
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

        db.add(
            WellbeingPayload(
                event_id=event_id,
                overall_wellbeing=payload.overall_wellbeing,
                energy_level=(
                    payload.energy_level
                    if payload.energy_level is not None
                    else 3
                ),
                stress_level=(
                    payload.stress_level
                    if payload.stress_level is not None
                    else 3
                ),
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

        db.add(
            PainPayload(
                event_id=pain_event_id,
                body_location_id=pain.body_location_id,
                severity=pain.severity,
                pain_type=pain.pain_type,
            )
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

    return {
        "status": "success",
        "group_id": daily_group_id,
        "message": (
            "Daily log successfully persisted "
            "to the longitudinal timeline."
        ),
    }