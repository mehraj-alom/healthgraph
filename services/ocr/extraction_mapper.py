import re
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


# Key medical terms for better canonicalization
MEDICAL_KEY_TERMS = {
    'chest', 'thorax', 'lung', 'lungs', 'heart', 'head', 'brain',
    'abdomen', 'pelvis', 'spine', 'neck', 'mediastinum', 'diaphragm',
    'rib', 'ribs', 'ribcage', 'skull', 'cervical', 'thoracic', 'lumbar',
    'xray', 'x-ray', 'xray', 'ct', 'mri', 'ultrasound', 'ultrasonography',
    'ct scan', 'ct scan of the head', 'ct scan of the chest', 'chest x-ray',
    'chest xray', 'chest x ray', 'head ct', 'chest ct',
    'radiation dose', 'radiation', 'dose', 'dlp', 'impression', 'findings',
    'technique', 'comparison', 'clinical history', 'history',
}


def extract_key_medical_terms(text: str) -> list[str]:
    """Extract key medical terms from text for better canonicalization."""
    if not text:
        return []
    text_lower = text.lower()
    found_terms = set()
    for term in MEDICAL_KEY_TERMS:
        if term in text_lower:
            found_terms.add(term)
    return list(found_terms)


def resolve_with_key_terms(db: Session, text: str):
    """Try to resolve concept using key medical terms extracted from text."""
    key_terms = extract_key_medical_terms(text)
    for term in key_terms:
        result = Canonicalizer.resolve_concept(db, raw_term=term)
        if result.status.value != 'unknown':
            return result, term
    return None, None


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


class ExtractionMapper:
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
        is_lab_result: bool = True,
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
            source_type=SourceType.LAB_REPORT,
            verification_status=verification_status,
            event_time=event_time if event_time else datetime.now(timezone.utc),
        )
        db.add(event)
        db.flush()

        if is_lab_result:
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
            extracted_text=source_text or f"{raw_test_name} :{value} {unit}",
            bounding_box=bbox,
        )
        db.add(evidence)

        observation = None
        structure_id = _resolve_structure_id(db, canon_res.code, canon_res.terminology)
        abnormal_flag = getattr(lab_payload, "abnormal_flag", None) if is_lab_result else None
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
            source_type=AnatomySourceType.LAB_REPORT if is_lab_result else AnatomySourceType.IMAGING_REPORT,
            source_id=str(event.event_id),
            event_id=event.event_id,
            document_id=document_id,
            clinical_summary=source_text[:500] if source_text else f"{raw_test_name}: {value} {unit}",
            recorded_at=event.event_time,
            ingested_at=datetime.now(timezone.utc),
        )

        return event, observation


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
        is_lab_result: bool = True,
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
            source_type=SourceType.LAB_REPORT,
            verification_status=verification_status,
            event_time=event_time if event_time else datetime.now(timezone.utc),
        )
        db.add(event)
        db.flush()

        if is_lab_result:
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
            extracted_text=source_text or f"{raw_test_name} :{value} {unit}",
            bounding_box=bbox,
        )
        db.add(evidence)

        observation = None
        structure_id = _resolve_structure_id(db, canon_res.code, canon_res.terminology)
        abnormal_flag = getattr(lab_payload, "abnormal_flag", None) if is_lab_result else None
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
            source_type=AnatomySourceType.LAB_REPORT if is_lab_result else AnatomySourceType.IMAGING_REPORT,
            source_id=str(event.event_id),
            event_id=event.event_id,
            document_id=document_id,
            clinical_summary=source_text[:500] if source_text else f"{raw_test_name}: {value} {unit}",
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
        pages = doc_json.get("pages", [])
        events_created = 0
        observations_created = []

        # Process sections for lab results and diagnostic findings
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

            # Also process diagnostic findings from radiology/imaging sections
            diagnosis = section.get("diagnosis")
            if diagnosis:
                canon_res = Canonicalizer.resolve_concept(db, raw_term=diagnosis)
                if canon_res.status.value == 'unknown':
                    key_res, matched_term = resolve_with_key_terms(db, diagnosis)
                    if key_res:
                        canon_res = key_res
                event, observation = event_builder.build_clinical_event(
                    db=db,
                    patient_id=document.patient_id,
                    document_id=document.document_id,
                    canon_res=canon_res,
                    raw_test_name=section.get("section_title", "Imaging Finding"),
                    value=diagnosis,
                    unit="",
                    ref_range="",
                    source_text=diagnosis,
                    bbox=None,
                    is_lab_result=False,
                )
                events_created += 1
                if observation:
                    observations_created.append(observation)
            else:
                # Fallback: use comments as finding if no diagnosis
                comments = section.get("comments")
                if comments and len(comments) > 20:  # Only meaningful comments
                    canon_res = Canonicalizer.resolve_concept(db, raw_term=comments[:200])
                    if canon_res.status.value == 'unknown':
                        key_res, matched_term = resolve_with_key_terms(db, comments[:200])
                        if key_res:
                            canon_res = key_res
                    event, observation = event_builder.build_clinical_event(
                        db=db,
                        patient_id=document.patient_id,
                        document_id=document.document_id,
                        canon_res=canon_res,
                        raw_test_name=section.get("section_title", "Clinical Finding"),
                        value=comments[:500],
                        unit="",
                        ref_range="",
                        source_text=comments[:500],
                        bbox=None,
                        is_lab_result=False,
                    )
                    events_created += 1
                    if observation:
                        observations_created.append(observation)

        # Also process page_text from pages array for findings not in sections
        # This captures radiology findings that are in page_text but not in structured sections
        for page in pages:
            page_text = page.get("page_text", "")
            page_type = page.get("page_type", "")
            section_ids = page.get("section_ids", [])

            # Skip non-radiology pages
            if page_type not in ["Radiology Report", "Medical Report", "Medical Report"]:
                continue

            # Check which sections were actually processed (had diagnosis or meaningful comments)
            processed_section_titles = set()
            for section in sections:
                section_title = section.get("section_title", "").rstrip(":")
                diagnosis = section.get("diagnosis")
                comments = section.get("comments")
                # Only mark as processed if we actually created events from it
                if diagnosis or (comments and len(comments) > 20):
                    processed_section_titles.add(section_title)

                # Extract relevant text from page_text for this section
                # Use section_id to find relevant content in page_text
                if section_title and page_text:
                    # Extract content after the section header
                    import re
                    pattern = rf"\*\*{re.escape(section_title)}:?\*\*(.*?)(?:\*\*|\Z)"
                    match = re.search(pattern, page_text, re.DOTALL)
                    if match:
                        content = match.group(1).strip()
                        if len(content) > 20:
                            canon_res = Canonicalizer.resolve_concept(db, raw_term=content[:200])
                            if canon_res.status.value == 'unknown':
                                key_res, matched_term = resolve_with_key_terms(db, content[:200])
                                if key_res:
                                    canon_res = key_res
                            event, observation = event_builder.build_clinical_event(
                                db=db,
                                patient_id=document.patient_id,
                                document_id=document.document_id,
                                canon_res=canon_res,
                                raw_test_name=section_title,
                                value=content[:500],
                                unit="",
                                ref_range="",
                                source_text=content[:500],
                                bbox=None,
                                is_lab_result=False,
                            )
                            events_created += 1
                            if observation:
                                observations_created.append(observation)

        db.commit()
        logger.info(f"Successfully mapped {events_created} events for document {document_id}.")
        return events_created, observations_created