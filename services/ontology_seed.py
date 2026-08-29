"""Canonical, idempotent seed data for the application's shared ontology."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.ontology import MedicalAlias, MedicalConcept
from services.ocr.term_normalization import MedicalTermNormalizer


# Database UUIDs are identifiers, not terminology codes. Stable identity is
# therefore the terminology/code pair below.
MANUAL_LOG_CONCEPTS = (
    {
        "terminology": "LOINC", "code": "2339-0",
        "display_name": "Glucose [Mass/volume] in Blood", "short_name": "Blood glucose",
        "aliases": ("blood sugar", "blood glucose", "glucose", "blood glucose level"),
    },
    {
        "terminology": "LOINC", "code": "8867-4",
        "display_name": "Heart rate", "short_name": "Resting pulse",
        "aliases": ("heart rate", "pulse", "resting pulse", "resting heart rate"),
    },
)


def seed_medical_concepts(db: Session) -> list[MedicalConcept]:
    """Upsert the curated seed set and aliases without inventing UUIDs."""
    seeded: list[MedicalConcept] = []
    for definition in MANUAL_LOG_CONCEPTS:
        concept = db.scalar(select(MedicalConcept).where(
            MedicalConcept.terminology == definition["terminology"],
            MedicalConcept.code == definition["code"],
        ))
        if concept is None:
            concept = MedicalConcept(terminology=definition["terminology"], code=definition["code"],
                display_name=definition["display_name"], short_name=definition["short_name"], active=True)
            db.add(concept)
            db.flush()
        else:
            concept.display_name = definition["display_name"]
            concept.short_name = definition["short_name"]
            concept.active = True
        for raw_name in definition["aliases"]:
            lexical_name = MedicalTermNormalizer.lexical_text(raw_name)
            alias = db.scalar(select(MedicalAlias).where(
                MedicalAlias.lexical_name == lexical_name, MedicalAlias.concept_id == concept.id))
            if alias is None:
                db.add(MedicalAlias(raw_name=raw_name, lexical_name=lexical_name,
                    concept_id=concept.id, source="seed", confidence=1.0, active=True))
            else:
                alias.raw_name, alias.source, alias.confidence, alias.active = raw_name, "seed", 1.0, True
        seeded.append(concept)
    return seeded
