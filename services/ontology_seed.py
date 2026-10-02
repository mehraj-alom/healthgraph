"""Canonical, idempotent seed data for the application's shared ontology."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.ontology import MedicalAlias, MedicalConcept
from services.ocr.term_normalization import MedicalTermNormalizer


# Database UUIDs are identifiers, not terminology codes. Stable identity is
# therefore the terminology/code pair below.
MANUAL_LOG_CONCEPTS = (
    # ── Vitals (LOINC) ──
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
    {
        "terminology": "LOINC", "code": "29463-7",
        "display_name": "Body Weight", "short_name": "Weight",
        "aliases": ("weight", "body weight", "bodyweight", "weigh-in", "weigh in"),
    },
    {
        "terminology": "LOINC", "code": "8480-6",
        "display_name": "Systolic blood pressure", "short_name": "Systolic",
        "aliases": ("systolic", "systolic blood pressure", "sys", "top number", "blood pressure systolic"),
    },
    {
        "terminology": "LOINC", "code": "8462-4",
        "display_name": "Diastolic blood pressure", "short_name": "Diastolic",
        "aliases": ("diastolic", "diastolic blood pressure", "dia", "bottom number", "blood pressure diastolic"),
    },
    # ── Symptoms (SNOMED CT) ──
    {
        "terminology": "SNOMED", "code": "25064002",
        "display_name": "Headache", "short_name": "Headache",
        "aliases": ("headache", "head pain", "cephalalgia"),
    },
    {
        "terminology": "SNOMED", "code": "422587007",
        "display_name": "Nausea", "short_name": "Nausea",
        "aliases": ("nausea", "nauseous", "feeling sick", "queasy"),
    },
    {
        "terminology": "SNOMED", "code": "84229001",
        "display_name": "Fatigue", "short_name": "Fatigue",
        "aliases": ("fatigue", "tiredness", "tired", "exhaustion", "exhausted", "lack of energy"),
    },
    {
        "terminology": "SNOMED", "code": "404640003",
        "display_name": "Dizziness", "short_name": "Dizziness",
        "aliases": ("dizziness", "dizzy", "lightheaded", "lightheadedness", "vertigo"),
    },
    {
        "terminology": "SNOMED", "code": "29857009",
        "display_name": "Chest pain", "short_name": "Chest pain",
        "aliases": ("chest pain", "chest discomfort", "chest tightness"),
    },
    {
        "terminology": "SNOMED", "code": "49727002",
        "display_name": "Cough", "short_name": "Cough",
        "aliases": ("cough", "coughing"),
    },
    {
        "terminology": "SNOMED", "code": "386661006",
        "display_name": "Fever", "short_name": "Fever",
        "aliases": ("fever", "feverish", "high temperature", "raised temperature", "pyrexia"),
    },
    {
        "terminology": "SNOMED", "code": "51848002",
        "display_name": "Back pain", "short_name": "Back pain",
        "aliases": ("back pain", "backache", "lower back pain", "back ache"),
    },
    {
        "terminology": "SNOMED", "code": "271807003",
        "display_name": "Skin rash", "short_name": "Rash",
        "aliases": ("rash", "skin rash", "eruption"),
    },
    {
        "terminology": "SNOMED", "code": "44065004",
        "display_name": "Sore throat", "short_name": "Sore throat",
        "aliases": ("sore throat", "throat pain", "pharyngitis"),
    },
    {
        "terminology": "SNOMED", "code": "267036007",
        "display_name": "Shortness of breath", "short_name": "Shortness of breath",
        "aliases": ("shortness of breath", "breathlessness", "dyspnea", "difficulty breathing", "can't breathe"),
    },
    {
        "terminology": "SNOMED", "code": "422400008",
        "display_name": "Joint pain", "short_name": "Joint pain",
        "aliases": ("joint pain", "arthralgia", "aching joints"),
    },
    {
        "terminology": "SNOMED", "code": "62315008",
        "display_name": "Diarrhea", "short_name": "Diarrhea",
        "aliases": ("diarrhea", "loose stools", "upset stomach"),
    },
    {
        "terminology": "SNOMED", "code": "306700007",
        "display_name": "Insomnia", "short_name": "Insomnia",
        "aliases": ("insomnia", "can't sleep", "trouble sleeping", "sleeplessness"),
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
