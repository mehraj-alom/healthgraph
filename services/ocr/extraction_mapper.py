import uuid
from datetime import datetime, timezone
from logger import logger
from sqlalchemy.orm import Session
from models.events import ClinicalEvent, EventType, SourceType, VerificationStatus, LabResult
from models.events import EvidenceLink, RawExtractionData, Document
from models.anatomy import (
    AnatomicalObservation, AnatomicalStructure,
    ObservationType, VisualStatus, FindingTrend, SourceType as AnatomySourceType,
)
from services.ocr.canonicalization import CanonicalizationResult, Canonicalizer, MatchStatus
from sqlalchemy import select


def _resolve_structure_id(db: Session, concept_code: str | None, terminology: str | None) -> str:
    """Best-effort mapping from medical concept SNOMED code to AnatomicalStructure."""
    if concept_code and terminology:
        structure = db.execute(
            select(AnatomicalStructure.structure_id)
            .where(AnatomicalStructure.snomed_concept_id == concept_code)
            .limit(1)
        ).scalar_one_or_none()
        if structure:
            return structure
    default = db.execute(
        select(AnatomicalStructure.structure_id)
        .where(AnatomicalStructure.structure_id == "FULL_BODY")
        .limit(1)
    ).scalar_one_or_none()
    return default or "FULL_BODY"


def _lab_severity(abnormal_flag: str | None) -> tuple[VisualStatus, float]:
    """Derive visual severity from lab abnormal flag."""
    if not abnormal_flag:
        return VisualStatus.NORMAL, 0.0
    flag = abnormal_flag.upper()
    if flag in ("H", "HH", "CRITICAL", "PANIC"):
        return VisualStatus.CRITICAL, 0.9
    if flag in ("L", "LL"):
        return VisualStatus.WARNING, 0.7
    if flag in ("A",):
        return VisualStatus.MILD_ATTENTION, 0.4
    return VisualStatus.NORMAL, 0.0


class EventBuilder:
    @staticmethod
    def build_clinical_event(
        db: Session,
        patient_id: uuid.UUID,
        document_id: uuid.UUID,
        canon_res: CanonicalizationResult,
        raw_test_name: str,
        value: str,
        unit: str,
        ref_range: str,
        source_text: str,
        bbox: dict = None,
        event_time: datetime = None,
    ) -> tuple[ClinicalEvent, AnatomicalObservation | None]:
        """
        Build a ClinicalEvent and a corresponding AnatomicalObservation.
        Returns (clinical_event, anatomical_observation).
        """
        match_status = getattr(canon_res, "match_status", getattr(canon_res, "status"))
        if match_status == MatchStatus.AUTO_MATCH:
            verification_status = VerificationStatus.EXTRACTED
        else:
            verification_status = VerificationStatus.UNVERIFIED

        event = ClinicalEvent(
            event_id=uuid.uuid4(),
            patient_id=patient_id,
            concept_id=canon_res.concept_id,
            event_type=EventType.LAB_RESULT,
            source_type=SourceType.DOCUMENT,
            verification_status=verification_status,
            event_time=event_time if event_time else datetime.now(timezone.utc),
        )
        db.add(event)
        db.flush()

        lab_payload = LabResult(
            event_id=event.event_id,
            value=str(value),
            unit=unit,
            reference_range=ref_range,
        )
        db.add(lab_payload)

        evidence = EvidenceLink(
            evidence_id=uuid.uuid4(),
            event_id=event.event_id,
            document_id=document_id,
            source_text=source_text or f"{raw_test_name} :{value} {unit}",
            bounding_box=bbox,
        )
        db.add(evidence)

        observation = None
        structure_id = _resolve_structure_id(db, canon_res.code, canon_res.terminology)
        abnormal_flag = getattr(lab_payload, "abnormal_flag", None)
        visual_status, visual_severity_score = _lab_severity(abnormal_flag)

        observation = AnatomicalObservation(
            observation_id=uuid.uuid4(),
            patient_id=patient_id,
            structure_id=structure_id,
            observation_type=ObservationType.LAB_ASSOCIATED_FINDING,
            finding_code=canon_res.code or raw_test_name,
            finding_display_name=canon_res.display_name or raw_test_name,
            visual_status=visual_status,
            visual_severity_score=visual_severity_score,
            trend=FindingTrend.STABLE,
            source_type=AnatomySourceType.LAB_REPORT,
            source_id=str(event.event_id),
            event_id=event.event_id,
            document_id=document_id,
            clinical_summary=f"{raw_test_name}: {value} {unit} (ref: {ref_range})",
            recorded_at=event.event_time,
            ingested_at=datetime.now(timezone.utc),
        )

        return event, observation


event_builder = EventBuilder()

class ExtractionMapper:
    @staticmethod
    def map_to_timeline(db: Session, document_id: uuid.UUID) -> tuple[int, list]:
        """Parse the raw extraction data and map it to the timeline events in the database.
        Returns (events_created, list of AnatomicalObservation objects created).
        """
        raw_record = db.scalars(select(RawExtractionData).where(RawExtractionData.document_id == document_id)).first()
        document = db.scalars(select(Document).where(Document.document_id == document_id)).first()

        if not raw_record or not raw_record.extraction or not document:
                logger.warning(f"No valid extraction data found for document {document_id}.")
                return 0, []
        
        doc_json = raw_record.extraction.get("document", {})
        sections = doc_json.get("sections", [])
        events_created = 0
        observations_created = []

        for section in sections:
             results = section.get("results", [])

             for result in results:
                raw_test_name = result.get("test_name", "")
                value = result.get("result", "")
                if not raw_test_name or not value:
                        logger.warning(f"Missing test name or value in result: {result}. Skipping.")
                        continue
                canon_res = Canonicalizer.resolve_concept(db, raw_term=raw_test_name)

                unit = result.get("unit", "")
                ref_range = result.get("reference_range", "")
                source_text = result.get("source_text", "")

                event, observation = event_builder.build_clinical_event(
                       db=db,
                       patient_id=document.patient_id,
                       document_id=document.document_id,
                       canon_res=canon_res,
                       raw_test_name=raw_test_name,
                       value=value,
                       unit=unit,
                       ref_range=ref_range,
                       source_text=source_text,
                       bbox=None,
                )
                events_created += 1
                if observation:
                    observations_created.append(observation)

        db.commit()
        logger.info(f"Successfully mapped {events_created} events for document {document_id}.")
        return events_created, observations_created
          
                      

