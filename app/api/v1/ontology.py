from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from core.db import get_db
from models.ontology import MedicalConcept
from services.ontology_seed import MANUAL_LOG_CONCEPTS

router = APIRouter(prefix="/api/v1/ontology", tags=["ontology"])


class ManualLogConceptResponse(BaseModel):
    id: UUID
    terminology: str
    code: str
    display_name: str
    short_name: str | None


@router.get("/manual-log-concepts", response_model=list[ManualLogConceptResponse])
def get_manual_log_concepts(db: Session = Depends(get_db), _: UUID = Depends(get_authenticated_patient_id)):
    """Return canonical concepts the manual logger may submit."""
    identities = [(item["terminology"], item["code"]) for item in MANUAL_LOG_CONCEPTS]
    return db.scalars(select(MedicalConcept).where(MedicalConcept.active.is_(True)).where(
        tuple_(MedicalConcept.terminology, MedicalConcept.code).in_(identities)
    ).order_by(MedicalConcept.terminology, MedicalConcept.code)).all()
