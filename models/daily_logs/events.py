from sqlalchemy import Float, ForeignKey, Integer, SmallInteger, String, Text, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
import uuid
from models.base import Base

class VitalSignPayload(Base):
    __tablename__ = "payload_vital_signs"
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinical_events.event_id", ondelete="CASCADE"), primary_key=True)
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(30), nullable=True)

class SymptomPayload(Base):
    __tablename__ = "payload_symptoms"
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinical_events.event_id", ondelete="CASCADE"), primary_key=True)
    severity: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    safe_notes: Mapped[str | None] = mapped_column(Text)  # Sanitized notes for outside call
    __table_args__ = (
        CheckConstraint("severity BETWEEN 1 AND 10", name="ck_symptom_severity"),
    )

class WellbeingPayload(Base):
    __tablename__ = "payload_wellbeing"
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinical_events.event_id", ondelete="CASCADE"), primary_key=True)
    overall_wellbeing: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    energy_level: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    stress_level: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    
    __table_args__ = (
        CheckConstraint("overall_wellbeing BETWEEN 1 AND 5", name="ck_wellbeing_range"),
        CheckConstraint("energy_level BETWEEN 1 AND 5", name="ck_energy_range"),
        CheckConstraint("stress_level BETWEEN 1 AND 5", name="ck_stress_range"),
    )
class PainPayload(Base):
    __tablename__ = "payload_pain"
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinical_events.event_id", ondelete="CASCADE"), primary_key=True)
    body_location_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("body_regions.region_id", ondelete="SET NULL")) # Links to ontology
    severity: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    pain_type: Mapped[str | None] = mapped_column(String(100)) # Sharp, dull, throbbing
    __table_args__ = (CheckConstraint("severity BETWEEN 1 AND 10", name="ck_pain_severity"),)

class SleepPayload(Base):
    __tablename__ = "payload_sleep"
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinical_events.event_id", ondelete="CASCADE"), primary_key=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    sleep_quality: Mapped[int | None] = mapped_column(SmallInteger)
    awakenings: Mapped[int | None] = mapped_column(Integer)
    __table_args__ = (CheckConstraint("sleep_quality BETWEEN 1 AND 5", name="ck_sleep_quality"),)

class ActivityPayload(Base):
    __tablename__ = "payload_activity"
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinical_events.event_id", ondelete="CASCADE"), primary_key=True)
    activity_type: Mapped[str] = mapped_column(String(100), nullable=False) # e.g., Running, Yoga
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    calories_burned: Mapped[float | None] = mapped_column(Float)

class NutritionPayload(Base):
    __tablename__ = "payload_nutrition"
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinical_events.event_id", ondelete="CASCADE"), primary_key=True)
    water_ml: Mapped[int | None] = mapped_column(Integer)
    meals_count: Mapped[int | None] = mapped_column(SmallInteger)
    appetite_level: Mapped[int | None] = mapped_column(SmallInteger) # 1-5
    calories_kcal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    food_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    __table_args__ = (CheckConstraint("appetite_level BETWEEN 1 AND 5", name="ck_appetite"),)

class MedicationTakenPayload(Base):
    __tablename__ = "payload_medication_taken"
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinical_events.event_id", ondelete="CASCADE"), primary_key=True)
    medication_name: Mapped[str] = mapped_column(String(255), nullable=False)
    dosage_value: Mapped[float | None] = mapped_column(Float)
    dosage_unit: Mapped[str | None] = mapped_column(String(50))


class PatientNotePayload(Base):
    """Free-text manual note associated with a canonical clinical event."""
    __tablename__ = "payload_patient_notes"
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("clinical_events.event_id", ondelete="CASCADE"), primary_key=True
    )
    safe_notes: Mapped[str] = mapped_column(Text, nullable=False)
