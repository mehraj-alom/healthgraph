import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException ,Request
from sqlalchemy.orm import Session
from sqlalchemy import select
from logger import logger
from core.db import get_db
from core.security import get_current_user
from models.identity import Patient
from models.events import ClinicalEvent, EventType, SourceType, VerificationStatus
from models.daily_logs.events import SleepPayload, VitalSignPayload, SymptomPayload, WellbeingPayload, PainPayload,ActivityPayload, NutritionPayload,  MedicationTakenPayload
from schemas.daily_logs import DailyCheckInRequest

router = APIRouter(prefix="/v1/logs", tags=["daily_logs"])

@router.post("/daily-checkin")
def submit_daily_checkin(
    payload: DailyCheckInRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_uid: str = Depends(get_current_user)
):
    patient = db.scalar(select(Patient).where(Patient.firebase_uid == current_uid))
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found.")

    deidentifier = request.app.state.deidentifier # will initialized at app startup
    daily_group_id = uuid.uuid4() 
    timestamp = datetime.combine(payload.log_date, datetime.min.time(), tzinfo=timezone.utc)

    # Shred Wellbeing
    if payload.overall_wellbeing:
        event_id = uuid.uuid4()
        event = ClinicalEvent(
            event_id=event_id, patient_id=patient.patient_id, 
            event_type=EventType.WELLBEING_LOG, source_type=SourceType.MANUAL_ENTRY,
            verification_status=VerificationStatus.HUMAN_VERIFIED, event_time=timestamp,
            group_id=daily_group_id
        )
        wellbeing = WellbeingPayload(
            event_id=event_id, overall_wellbeing=payload.overall_wellbeing,
            energy_level=payload.energy_level or 3, stress_level=payload.stress_level or 3
        )
        db.add_all([event, wellbeing])

    # Shred Symptoms
    for sym in payload.symptoms:
        sym_id = uuid.uuid4()

        #### De identification layer ####
        safe_notes = None
        if sym.notes:
            result = deidentifier.sanitize(sym.notes)
            if result.validation_passed:
                safe_notes = result.text
            else:
                # if validation fails, no store of safe note at all 
                logger.warning(f"Sanitization failed for symptom notes: {result.errors}")
                safe_notes = None


        db.add(ClinicalEvent(
            event_id=sym_id, patient_id=patient.patient_id, concept_id=sym.concept_id,
            event_type=EventType.SYMPTOM, source_type=SourceType.MANUAL_ENTRY,
            verification_status=VerificationStatus.HUMAN_VERIFIED, event_time=timestamp,
            group_id=daily_group_id
        ))
        db.add(SymptomPayload(
            event_id=sym_id, severity=sym.severity, 
            duration_minutes=sym.duration_minutes, 
            notes=sym.notes,
            safe_notes=safe_notes 
        ))

    # Shred Vitals
    for vit in payload.vitals:
        vit_id = uuid.uuid4()
        db.add(ClinicalEvent(
            event_id=vit_id, patient_id=patient.patient_id, concept_id=vit.concept_id,
            event_type=EventType.VITAL_SIGN, source_type=SourceType.MANUAL_ENTRY,
            verification_status=VerificationStatus.HUMAN_VERIFIED, event_time=timestamp,
            group_id=daily_group_id
        ))
        db.add(VitalSignPayload(
            event_id=vit_id, value=vit.value, unit=vit.unit
        ))
    for p in payload.pain:
        p_id = uuid.uuid4()
        db.add(ClinicalEvent(
            event_id=p_id, patient_id=patient.patient_id, event_type=EventType.PAIN_LOG,
            source_type=SourceType.MANUAL_ENTRY, verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp, group_id=daily_group_id
        ))
        db.add(PainPayload(event_id=p_id, body_location_id=p.body_location_id, severity=p.severity, pain_type=p.pain_type))

    # Shred Sleep
    if payload.sleep:
        sl_id = uuid.uuid4()
        db.add(ClinicalEvent(
            event_id=sl_id, patient_id=patient.patient_id, event_type=EventType.SLEEP_LOG,
            source_type=SourceType.MANUAL_ENTRY, verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp, group_id=daily_group_id
        ))
        db.add(SleepPayload(event_id=sl_id, duration_minutes=payload.sleep.duration_minutes, sleep_quality=payload.sleep.sleep_quality, awakenings=payload.sleep.awakenings))
    # Shred Activity
    if payload.activities:
        for act in payload.activities:
            act_id = uuid.uuid4()
            db.add(ClinicalEvent(
                event_id=act_id, patient_id=patient.patient_id, event_type=EventType.ACTIVITY_LOG,
                source_type=SourceType.MANUAL_ENTRY, verification_status=VerificationStatus.HUMAN_VERIFIED,
                event_time=timestamp, group_id=daily_group_id
            ))
            db.add(ActivityPayload(event_id=act_id, activity_type=act.activity_type, duration_minutes=act.duration_minutes, calories_burned=act.calories_burned))
    # Shred Nutrition
    if payload.nutrition:
        nut_id = uuid.uuid4()
        db.add(ClinicalEvent(
            event_id=nut_id, patient_id=patient.patient_id, event_type=EventType.NUTRITION_LOG,
            source_type=SourceType.MANUAL_ENTRY, verification_status=VerificationStatus.HUMAN_VERIFIED,
            event_time=timestamp, group_id=daily_group_id
        ))
        db.add(NutritionPayload(event_id=nut_id, water_ml=payload.nutrition.water_ml, meals_count=payload.nutrition.meals_count, appetite_level=payload.nutrition.appetite_level))
    # Shred Medications
    if payload.medications:
        for med in payload.medications:
            med_id = uuid.uuid4()
            db.add(ClinicalEvent(
                event_id=med_id, patient_id=patient.patient_id, event_type=EventType.MEDICATION_TAKEN,
                source_type=SourceType.MANUAL_ENTRY, verification_status=VerificationStatus.HUMAN_VERIFIED,
                event_time=timestamp, group_id=daily_group_id
            ))
            db.add(MedicationTakenPayload(event_id=med_id, medication_name=med.medication_name, dosage_value=med.dosage_value, dosage_unit=med.dosage_unit))
    
    # Commit everything atomically
    db.commit()
    
    return {
        "status": "success", 
        "group_id": daily_group_id, 
        "message": "Daily log successfully shredded into timeline."
    }