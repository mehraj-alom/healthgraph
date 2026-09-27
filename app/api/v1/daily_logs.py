import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Header
from pydantic import BaseModel
from sqlalchemy import select, delete, func
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from core.db import acquire_daily_checkin_lock, get_db
from logger import logger

from models.events import (
    ClinicalEvent,
    EvidenceLink,
    EventType,
    SourceType,
    VerificationStatus,
)
from models.outbox import enqueue_clinical_event
from models.ontology import BodyRegion, MedicalConcept
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


def _sanitize_daily_checkin(db: Session, payload: DailyCheckInRequest) -> None:
    """Defensively sanitize a check-in so it can never 500 on DB constraints.

    - Unknown ``body_location_id`` values are nulled: ``body_regions`` has
      no seed data, so any non-null location that is absent server-side
      would otherwise raise an FK IntegrityError on flush/commit and
      surface as a generic 500 for the whole check-in (offline clients
      then retry the same payload forever).
    - Over-long free-text columns are truncated to their VARCHAR widths
      (Pydantic does not cap them, unlike ``food_label``).
    Only counts are logged — never health data.
    """
    location_ids = {
        pain.body_location_id
        for pain in payload.pain
        if pain.body_location_id is not None
    }
    if location_ids:
        known = set(
            db.scalars(
                select(BodyRegion.region_id).where(
                    BodyRegion.region_id.in_(location_ids)
                )
            ).all()
        )
        unknown = location_ids - known
        if unknown:
            logger.warning(
                "Dropping %d unknown body_location_id(s) from daily check-in",
                len(unknown),
            )
            for pain in payload.pain:
                if pain.body_location_id in unknown:
                    pain.body_location_id = None

    for vital in payload.vitals:
        if vital.unit and len(vital.unit) > 30:
            vital.unit = vital.unit[:30]
    for pain in payload.pain:
        if pain.pain_type and len(pain.pain_type) > 100:
            pain.pain_type = pain.pain_type[:100]
    for activity in payload.activities:
        if len(activity.activity_type) > 100:
            activity.activity_type = activity.activity_type[:100]
    for medication in payload.medications:
        if len(medication.medication_name) > 255:
            medication.medication_name = medication.medication_name[:255]
        if medication.dosage_unit and len(medication.dosage_unit) > 50:
            medication.dosage_unit = medication.dosage_unit[:50]


@router.post("/daily-checkin")
def submit_daily_checkin(
    payload: DailyCheckInRequest,
    request: Request,
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """
    Persist a complete daily health check-in as a set of
    canonical ClinicalEvent records and their payload tables.

    The authenticated Firebase token determines patient_id.
    The client never provides patient_id.

    All child payload rows are inserted only after their
    parent ClinicalEvent has been flushed to PostgreSQL.

    Supports idempotency via the Idempotency-Key header.
    If the same key is reused with the same payload, the original result is returned.
    If the same key is reused with a different payload, 409 is returned.
    """
    from services.idempotency import compute_request_hash, check_idempotency, store_idempotency_key

    # Serialize concurrent check-ins for this (patient, day) BEFORE the
    # idempotency check: two racing POSTs would otherwise both pass the
    # check, both find-or-create the deterministic Visit, and the loser's
    # flush would IntegrityError into a generic 500. The transaction-scoped
    # lock makes the second request wait, then replay the stored response.
    acquire_daily_checkin_lock(db, patient_id, payload.log_date)

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

    # Null unknown body locations / truncate over-long strings so the
    # check-in can never fail the commit with an IntegrityError (500).
    _sanitize_daily_checkin(db, payload)

    # P3: the day's deterministic daily-checkin Visit, shared by every
    # section below (OCCURRED_DURING grouping instead of a Patient hub).
    from services.clinical.daily_domains import (
        checkin_visit,
        enqueue_checkin_event,
        project_activity,
        project_daily_meds_taken,
        project_notes_statement,
        project_nutrition,
        project_sleep,
        project_symptom_condition,
    )

    _visit = checkin_visit(db, patient_id, timestamp)

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

        enqueue_checkin_event(db, patient_id, event, _visit)

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

        enqueue_checkin_event(db, patient_id, symptom_event, _visit, concept_id=symptom.concept_id)

        db.add(
            SymptomPayload(
                event_id=symptom_event_id,
                severity=symptom.severity,
                duration_minutes=symptom.duration_minutes,
                notes=symptom.notes,
                safe_notes=safe_notes,
            )
        )

        # P3: validated-concept symptom → ConditionOccurrence (USER_REPORTED).
        project_symptom_condition(
            db, patient_id, symptom_event, symptom.concept_id,
            symptom.severity, symptom.duration_minutes, safe_notes, _visit,
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
            polarity="positive",
            assertion_verification="unconfirmed",
            experiencer="patient",
        )

        db.add(vital_event)
        db.flush()

        # P2: first-class Measurement on the day's shared Visit.
        from services.clinical.measurements import create_vital_measurement

        _concept = db.get(MedicalConcept, vital.concept_id) if vital.concept_id else None
        _vital_name = _concept.display_name if _concept else "vital"
        create_vital_measurement(
            db,
            patient_id=patient_id,
            name=_vital_name,
            concept_display=_concept.display_name if _concept else None,
            value_number=vital.value,
            value_text=str(vital.value) if vital.value is not None else "",
            unit=vital.unit,
            terminology=_concept.terminology if _concept else None,
            code=_concept.code if _concept else None,
            measured_at=timestamp,
            source_event_id=vital_event.event_id,
            visit_id=_visit.visit_id,
        )

        enqueue_clinical_event(
            db,
            event_id=vital_event.event_id,
            patient_id=patient_id,
            event_type=vital_event.event_type,
            source_type=vital_event.source_type,
            verification_status=vital_event.verification_status,
            event_time=vital_event.event_time,
            polarity="positive",
            assertion_verification="unconfirmed",
            experiencer="patient",
            concept_id=vital.concept_id,
            concept_system=_concept.terminology if _concept else None,
            concept_code=_concept.code if _concept else None,
            concept_display=_concept.display_name if _concept else None,
            visit_id=_visit.visit_id,
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

        enqueue_checkin_event(db, patient_id, pain_event, _visit)

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

        enqueue_checkin_event(db, patient_id, sleep_event, _visit)

        db.add(
            SleepPayload(
                event_id=sleep_event_id,
                duration_minutes=payload.sleep.duration_minutes,
                sleep_quality=payload.sleep.sleep_quality,
                awakenings=payload.sleep.awakenings,
            )
        )

        # P3: first-class SleepEpisode (only collected fields, USER_REPORTED).
        project_sleep(
            db, patient_id, sleep_event,
            payload.sleep.duration_minutes, payload.sleep.sleep_quality,
            payload.sleep.awakenings, _visit,
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

        enqueue_checkin_event(db, patient_id, activity_event, _visit)

        db.add(
            ActivityPayload(
                event_id=activity_event_id,
                activity_type=activity.activity_type,
                duration_minutes=activity.duration_minutes,
                calories_burned=activity.calories_burned,
            )
        )

        # P3: first-class ActivityEvent (only collected fields, USER_REPORTED).
        project_activity(
            db, patient_id, activity_event,
            activity.activity_type, activity.duration_minutes,
            activity.calories_burned, _visit,
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

        enqueue_checkin_event(db, patient_id, nutrition_event, _visit)

        db.add(
            NutritionPayload(
                event_id=nutrition_event_id,
                water_ml=payload.nutrition.water_ml,
                meals_count=payload.nutrition.meals_count,
                appetite_level=payload.nutrition.appetite_level,
                calories_kcal=payload.nutrition.calories_kcal,
                # DB column is VARCHAR(255): truncate defensively so an
                # over-long client label can never 500 the whole check-in.
                food_label=(payload.nutrition.food_label or None)
                and payload.nutrition.food_label[:255],
            )
        )

        # P3: first-class NutritionIntake (aggregate fields as collected).
        project_nutrition(
            db, patient_id, nutrition_event,
            payload.nutrition.water_ml, payload.nutrition.meals_count,
            payload.nutrition.appetite_level, payload.nutrition.calories_kcal,
            (payload.nutrition.food_label or None)
            and payload.nutrition.food_label[:255],
            _visit,
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

        enqueue_checkin_event(db, patient_id, medication_event, _visit)

        db.add(
            MedicationTakenPayload(
                event_id=medication_event_id,
                medication_name=medication.medication_name,
                dosage_value=medication.dosage_value,
                dosage_unit=medication.dosage_unit,
            )
        )

        # P3: daily free-text med → TakenEvent by canonical NAME only (no
        # regimen evidence → no RESULTS_FROM, no adherence impact).
        project_daily_meds_taken(
            db, patient_id, medication_event,
            medication.medication_name, medication.dosage_value,
            medication.dosage_unit, _visit,
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

        enqueue_checkin_event(db, patient_id, note_event, _visit)

        db.add(
            PatientNotePayload(
                event_id=note_event_id,
                safe_notes=result.text,
            )
        )

        # P3: journal note → PatientStatement (verbatim, USER_REPORTED).
        project_notes_statement(db, patient_id, result.text, _visit, event=note_event)

    # =========================================================================
    # Store idempotency key INSIDE the transaction before commit
    # This ensures atomicity: either both the mutation and idempotency key
    # are committed, or neither is.
    # =========================================================================

    if idempotency_key:
        store_idempotency_key(
            db, patient_id, idempotency_key, "submit_daily_checkin",
            request_hash, 200, {
                "status": "success",
                "group_id": daily_group_id,
                "message": (
                    "Daily log successfully persisted "
                    "to the longitudinal timeline."
                ),
            },
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

    response = {
        "status": "success",
        "group_id": daily_group_id,
        "message": (
            "Daily log successfully persisted "
            "to the longitudinal timeline."
        ),
    }

    # P7: the idempotency key was already stored pre-commit above (atomic
    # with the mutation; store is ON CONFLICT DO NOTHING). Do not store or
    # commit twice — the second write was redundant and added a failure
    # window after the response was built.

    return response


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
    calories_kcal: int | None = None
    food_label: str | None = None
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
                result.calories_kcal = nut.calories_kcal
                result.food_label = nut.food_label

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
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """
    Update an existing daily check-in group.

    Deletes all events in the group and replaces them with the new
    payload. The group_id is preserved so the timeline maintains
    a consistent reference.

    Security: verifies that the group belongs to the authenticated patient.

    Supports idempotency via the Idempotency-Key header.
    If the same key is reused with the same payload, the original result is returned.
    If the same key is reused with a different payload, 409 is returned.
    """
    from services.idempotency import compute_request_hash, check_idempotency, store_idempotency_key

    # Serialize concurrent check-ins for this (patient, day) BEFORE the
    # idempotency check (same race as POST — see submit_daily_checkin).
    acquire_daily_checkin_lock(db, patient_id, payload.log_date)

    # Compute request hash for comparison
    request_hash = compute_request_hash(payload.model_dump())

    # Check idempotency if key provided
    # IMPORTANT: This check happens INSIDE the transaction to ensure atomicity
    if idempotency_key:
        existing = check_idempotency(db, patient_id, idempotency_key, request_hash)
        if existing:
            if existing["status"] == "conflict":
                raise HTTPException(status_code=409, detail=existing["error"])
            if existing["status"] == "replay":
                return existing["response"]

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

    # P4 correction consistency: dependent first-class rows keyed 1:1 to the
    # replaced events are removed here so the delete below cannot hit FK
    # violations (Measurement.source_event_id has no CASCADE) and cannot
    # leave orphaned projections. They are recreated by the section logic
    # below. Shared/deduped rows are NOT deleted: ConditionOccurrence rows
    # are relinked to the replacement event (see symptom section).
    # P5: collect the doomed Neo4j node ids BEFORE deleting (the scope
    # deletes below would make them unqueryable); retirement events are
    # enqueued with the event deletes further down.
    from models.measurements import Measurement
    from models.statements import PatientStatement

    _retire_measurement_ids = [
        m.measurement_id
        for m in db.query(Measurement).filter(Measurement.source_event_id.in_(event_ids)).all()
    ]
    _retire_statement_ids = [
        s.statement_id
        for s in db.query(PatientStatement).filter(PatientStatement.source_event_id.in_(event_ids)).all()
    ]
    db.query(Measurement).filter(Measurement.source_event_id.in_(event_ids)).delete(
        synchronize_session=False
    )
    db.query(PatientStatement).filter(PatientStatement.source_event_id.in_(event_ids)).delete(
        synchronize_session=False
    )

    # -----------------------------------------------------------------------
    # Delete existing events in the group
    # (payloads cascade-delete via foreign key on event_id)
    # P5: enqueue retirement events for the replaced Neo4j nodes so the
    # worker detaches them instead of leaving orphans. Label mapping mirrors
    # the projections: domain nodes share the ClinicalEvent id; measurements
    # and statements carry their own ids (collected above).
    # -----------------------------------------------------------------------
    from models.outbox import enqueue_graph_node_retired

    _retire_label_by_type = {
        EventType.SLEEP_LOG: "SleepEpisode",
        EventType.ACTIVITY_LOG: "ActivityEvent",
        EventType.NUTRITION_LOG: "NutritionIntake",
        EventType.MEDICATION_TAKEN: "MedicationTakenEvent",
    }
    _retire_ids: list[tuple[str, uuid.UUID]] = [
        (_retire_label_by_type.get(e.event_type, "TimelineEvent"), e.event_id)
        for e in existing_events
    ]
    _retire_ids += [("Measurement", _mid) for _mid in _retire_measurement_ids]
    _retire_ids += [("PatientStatement", _sid) for _sid in _retire_statement_ids]
    for _label, _nid in _retire_ids:
        enqueue_graph_node_retired(db, patient_id, _label, _nid, reason="daily-log-correction")
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

    # Null unknown body locations / truncate over-long strings so the
    # update can never fail the commit with an IntegrityError (500).
    _sanitize_daily_checkin(db, payload)

    # P3: same day-visit discipline as the create path (see above).
    from services.clinical.daily_domains import (
        checkin_visit,
        enqueue_checkin_event,
        project_activity,
        project_daily_meds_taken,
        project_notes_statement,
        project_nutrition,
        project_sleep,
        project_symptom_condition,
    )

    _visit = checkin_visit(db, patient_id, timestamp)

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
        enqueue_checkin_event(db, patient_id, event, _visit)
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
        enqueue_checkin_event(db, patient_id, symptom_event, _visit, concept_id=symptom.concept_id)
        db.add(SymptomPayload(
            event_id=symptom_event_id, severity=symptom.severity,
            duration_minutes=symptom.duration_minutes, notes=symptom.notes, safe_notes=safe_notes,
        ))
        # P3 (PUT parity): symptom → ConditionOccurrence.
        project_symptom_condition(
            db, patient_id, symptom_event, symptom.concept_id,
            symptom.severity, symptom.duration_minutes, safe_notes, _visit,
            relink=True,
        )

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
        enqueue_checkin_event(db, patient_id, vital_event, _visit, concept_id=vital.concept_id)
        db.add(VitalSignPayload(event_id=vital_event_id, value=vital.value, unit=vital.unit))
        # P4: POST parity — the replacement vital gets a fresh Measurement
        # (the old row was scope-deleted above; same-day dedup is by
        # series_key + measured_at at read time, not by row identity).
        from services.clinical.measurements import create_vital_measurement as _create_vital

        _concept = db.get(MedicalConcept, vital.concept_id) if vital.concept_id else None
        _create_vital(
            db,
            patient_id=patient_id,
            name=_concept.display_name if _concept else "vital",
            concept_display=_concept.display_name if _concept else None,
            value_number=vital.value,
            value_text=str(vital.value) if vital.value is not None else "",
            unit=vital.unit,
            terminology=_concept.terminology if _concept else None,
            code=_concept.code if _concept else None,
            measured_at=timestamp,
            source_event_id=vital_event.event_id,
            visit_id=_visit.visit_id,
        )

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
        enqueue_checkin_event(db, patient_id, pain_event, _visit)
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
        enqueue_checkin_event(db, patient_id, sleep_event, _visit)
        db.add(SleepPayload(
            event_id=sleep_event_id, duration_minutes=payload.sleep.duration_minutes,
            sleep_quality=payload.sleep.sleep_quality, awakenings=payload.sleep.awakenings,
        ))
        # P3 (PUT parity): SleepEpisode.
        project_sleep(
            db, patient_id, sleep_event,
            payload.sleep.duration_minutes, payload.sleep.sleep_quality,
            payload.sleep.awakenings, _visit,
        )

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
        enqueue_checkin_event(db, patient_id, activity_event, _visit)
        db.add(ActivityPayload(
            event_id=activity_event_id, activity_type=activity.activity_type,
            duration_minutes=activity.duration_minutes, calories_burned=activity.calories_burned,
        ))
        # P3 (PUT parity): ActivityEvent.
        project_activity(
            db, patient_id, activity_event,
            activity.activity_type, activity.duration_minutes,
            activity.calories_burned, _visit,
        )

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
        enqueue_checkin_event(db, patient_id, nutrition_event, _visit)
        db.add(NutritionPayload(
            event_id=nutrition_event_id, water_ml=payload.nutrition.water_ml,
            meals_count=payload.nutrition.meals_count, appetite_level=payload.nutrition.appetite_level,
            calories_kcal=payload.nutrition.calories_kcal,
            food_label=(payload.nutrition.food_label or None)
            and payload.nutrition.food_label[:255],
        ))
        # P3 (PUT parity): NutritionIntake.
        project_nutrition(
            db, patient_id, nutrition_event,
            payload.nutrition.water_ml, payload.nutrition.meals_count,
            payload.nutrition.appetite_level, payload.nutrition.calories_kcal,
            (payload.nutrition.food_label or None)
            and payload.nutrition.food_label[:255],
            _visit,
        )

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
        enqueue_checkin_event(db, patient_id, medication_event, _visit)
        db.add(MedicationTakenPayload(
            event_id=medication_event_id, medication_name=medication.medication_name,
            dosage_value=medication.dosage_value, dosage_unit=medication.dosage_unit,
        ))
        # P3 (PUT parity): daily free-text med → name-linked TakenEvent.
        project_daily_meds_taken(
            db, patient_id, medication_event,
            medication.medication_name, medication.dosage_value,
            medication.dosage_unit, _visit,
        )

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
        enqueue_checkin_event(db, patient_id, note_event, _visit)
        db.add(PatientNotePayload(event_id=note_event_id, safe_notes=result.text))
        # P3 (PUT parity): journal note → PatientStatement.
        project_notes_statement(db, patient_id, result.text, _visit, event=note_event)

    # Store idempotency key INSIDE the transaction before commit
    # This ensures atomicity: either both the mutation and idempotency key
    # are committed, or neither is.
    if idempotency_key:
        store_idempotency_key(
            db, patient_id, idempotency_key, "update_daily_checkin",
            request_hash, 200, {
                "status": "success",
                "group_id": str(group_id),
                "message": "Daily log updated successfully.",
            },
        )

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