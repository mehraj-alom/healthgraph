import re
import uuid
from datetime import datetime, timezone
from logger import logger
from sqlalchemy.orm import Session
from models.events import ClinicalEvent, EventType, SourceType, VerificationStatus, LabResult
from models.events import EvidenceLink, RawExtractionData, Document
from models.outbox import enqueue_clinical_event
from models.clinical_assertion import classify_assertion, Polarity, Experiencer
from models.visits import VisitType
from models.anatomy import (
    AnatomicalObservation, AnatomicalStructure,
    ObservationType, VisualStatus, FindingTrend, SourceType as AnatomySourceType,
)
from services.ocr.canonicalization import CanonicalizationResult, Canonicalizer, MatchStatus
from sqlalchemy import select


# P8.1: organ-vs-region term tables for _resolve_structure_id.
# Organ terms match ONLY the canonical display name or the finding's
# subject title — never free-text source snippets. Rationale (P8-live):
# "Cardiac silhouette is normal" inside a chest X-ray snippet matched
# `cardiac` → HEART before CHEST was tried. Incidental normal-anatomy
# mentions must not steer the structure; the finding's own subject does.
# Region terms remain matchable in all text (conservative highlight).
_ORGAN_TERMS: list[tuple[str, list[str]]] = [
    ("LEFT_LUNG",   ["left lung"],),
    ("RIGHT_LUNG",  ["right lung"],),
    ("LEFT_KIDNEY", ["left kidney"],),
    ("RIGHT_KIDNEY", ["right kidney"],),
    ("HEART",       ["heart", "cardiac"],),
    ("LIVER",       ["liver", "hepatic"],),
    ("STOMACH",     ["stomach", "gastric"],),
    ("SPLEEN",      ["spleen", "splenic"],),
    ("PANCREAS",    ["pancreas", "pancreatic"],),
    ("BLADDER",     ["bladder", "vesical"],),
    ("THYROID",     ["thyroid"],),
    ("BRAIN",       ["brain", "cerebral", "cranial"],),
]
# Region terms match display + snippet text (conservative highlight).
# NOTE: generic "lung" has no single LUNG structure — only LEFT_LUNG and
# RIGHT_LUNG exist. Mapping generic "lung" to either side would be
# clinically wrong; it maps to the containing region CHEST instead.
_REGION_TERMS: list[tuple[str, list[str]]] = [
    ("CHEST",       ["chest", "thorax", "thoracic", "pulmonary", "lung"],),
    ("HEAD",        ["head", "skull", "cephalic"],),
    ("ABDOMEN",     ["abdomen", "abdominal"],),
    ("NECK",        ["neck", "cervical", "throat"],),
    ("PELVIS",      ["pelvis", "pelvic"],),
    ("SPINE",       ["spine", "spinal", "vertebral", "lumbar"],),
    ("LEFT_ARM",    ["left arm", "left shoulder", "left elbow", "left wrist", "left hand"],),
    ("RIGHT_ARM",   ["right arm", "right shoulder", "right elbow", "right wrist", "right hand"],),
    ("LEFT_LEG",    ["left leg", "left hip", "left knee", "left ankle", "left foot"],),
    ("RIGHT_LEG",   ["right leg", "right hip", "right knee", "right ankle", "right foot"],),
]


def _match_structure_term(
    structure_terms: list[tuple[str, list[str]]],
    search_text: str,
) -> str | None:
    """First structure whose term appears in search_text (ordered)."""
    if not search_text:
        return None
    lowered = search_text.lower()
    for structure_id, terms in structure_terms:
        for term in terms:
            if term in lowered:
                return structure_id
    return None


def _is_measurement_result(result: dict) -> bool:
    """Conservative measurement-ness gate (P8.1).

    A results[] entry is treated as a lab/measurement ONLY when it
    carries measurement evidence: a unit, a reference range, an abnormal
    flag, or a result that LEADS with a number ("13.5", "927", ">200").
    Bare numbers buried in prose (P8.1-live: "RMS maximus 32 digital
    electro-encephalograph…") fail the gate so free-text findings can
    never spawn LabResult payloads or Measurement rows.
    """
    if result.get("unit") or result.get("reference_range") or result.get("flag"):
        return True
    raw = result.get("result")
    if raw is None:
        return False
    text = str(raw).strip()
    if not re.match(r"^[<>=~\u2264\u2265]?\s*[+-]?(?:\d[\d.,]*|\.\d+)", text):
        return False
    try:
        from services.clinical.measurements import parse_number

        return parse_number(raw) is not None
    except Exception:  # pragma: no cover - defensive; fail closed
        return False


def _parse_source_date(value: str | None):
    """Best-effort parse of an ADE date string to a date (P8.1).

    Returns None when the source gives nothing parseable — callers fall
    back to ingestion time. Never invents dates.
    """
    if not value or not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    from datetime import date as _date

    try:
        return _date.fromisoformat(text)
    except ValueError:
        pass
    for fmt in ("%Y/%m/%d", "%d-%b-%Y", "%d %b %Y", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _document_date(doc_json: dict):
    """Best source date for document-derived events (P8.1).

    Priority: authorisation date → specimen collection/received dates →
    first encounter date. None when the source states no usable date
    (caller falls back to ingestion time). Distinct date roles are NOT
    collapsed silently: this is only the default event_time; encounter
    dates stay in the extraction JSON as source metadata.
    """
    auth = doc_json.get("authorisation") or {}
    for key in ("authorised_date",):
        parsed = _parse_source_date(auth.get(key))
        if parsed:
            return parsed
    for spec in doc_json.get("specimens") or []:
        for key in ("collection_date", "received_date"):
            parsed = _parse_source_date(spec.get(key))
            if parsed:
                return parsed
    for enc in doc_json.get("encounters") or []:
        parsed = _parse_source_date(enc.get("encounter_date"))
        if parsed:
            return parsed
    return None


def _classify_result_entry(result: dict):
    """Map a results[] entry to (EventType, is_lab, SourceType) (P8.1).

    ADE `finding_type` hints are advisory; the measurement gate is
    authoritative. Free-text findings dressed as results become
    IMAGING_RESULT (never LAB_RESULT/Measurement rows). Pure — unit
    tested in test_p8_1_extraction.py.
    """
    from models.events import EventType as _EventType, SourceType as _SourceType

    hint = ((result or {}).get("finding_type") or "").strip().lower()
    measurement = _is_measurement_result(result or {})
    # Even an explicit measurement hint cannot force LAB/Measurement rows
    # without measurement evidence (P8-live junk would otherwise return
    # through the hint). Hints downgrade gracefully to findings.
    if measurement and hint in ("", "measurement"):
        return _EventType.LAB_RESULT, True, _SourceType.LAB_REPORT
    if hint == "symptom":
        return _EventType.SYMPTOM, False, _SourceType.DOCTOR_ENTERED
    if hint == "diagnosis":
        return _EventType.DIAGNOSIS, False, _SourceType.IMAGING_REPORT
    return _EventType.IMAGING_RESULT, False, _SourceType.IMAGING_REPORT


def _should_create_condition(event_type, value, assertion) -> bool:
    """Whether a DIAGNOSIS mention earns a ConditionOccurrence (P8.1).

    Positive, patient-experienced assertions only. Negated ("No
    hemorrhage"), family, historical, hypothetical, or conditional
    mentions stay source-assertion events — never Condition rows. Pure.
    """
    from models.events import EventType as _EventType

    return bool(
        event_type == _EventType.DIAGNOSIS
        and (value or "").strip()
        and assertion is not None
        and assertion.polarity == Polarity.POSITIVE
        and assertion.experiencer == Experiencer.PATIENT
    )


def _is_normal_study_statement(text: str | None) -> bool:
    """Whether the text is a normal-study statement, not a diagnosis (P8.1).

    "Normal chest X-ray findings." / "Normal awake record." assert a
    normal study — they must stay citable findings but never become
    disease diagnoses or Condition rows. Patterns are deliberately tight
    (require a study/result noun or a canonical normal phrase) so real
    diagnoses containing "normal" ("Normal pressure hydrocephalus")
    never match. Pure.
    """
    if not text:
        return False
    lowered = " ".join(text.strip().lower().split())
    if re.match(
        r"^normal\b[\w\s\-\.]*\b(study|record|findings?|results?|"
        r"examination|exam|eeg|ecg|x-?ray|ct|mri|ultrasound|limits)\b[\s\.]*$",
        lowered,
    ):
        return True
    return lowered in {
        "unremarkable",
        "unremarkable study",
        "within normal limits",
        "within normal limit",
        "no abnormality",
        "no abnormality detected",
        "no abnormality seen",
        "no abnormality noted",
        "normal",
    }


def _page_envelope(page_number) -> dict | None:
    """Provenance envelope for EvidenceLink.bounding_box (P8.1).

    The schema provides page numbers but no bounding boxes and PG has no
    page column; storing {"page": n} in the existing JSONB box column
    preserves page provenance with zero migration. Never fabricated:
    None in → None out.
    """
    try:
        if page_number is None:
            return None
        return {"page": int(page_number)}
    except (TypeError, ValueError):
        return None
# Legacy key-term fallback set (unchanged semantics; used by
# resolve_with_key_terms when canonicalization returns unknown).
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


def _resolve_structure_id(
    db: Session,
    concept_code: str | None,
    terminology: str | None,
    concept_display_name: str | None = None,
    raw_text: str | None = None,
) -> str:
    """Best-effort mapping from medical concept to AnatomicalStructure.

    Resolution priority:
      1. Direct SNOMED concept_id match on AnatomicalStructure.
         (Most reliable — exact ontology mapping.)
      2. Organ terms (_ORGAN_TERMS) matched against the concept's display
         name ONLY — the display already falls back to the finding's
         subject title at call sites. Free-text snippets are excluded:
         incidental normal-anatomy mentions (e.g. "cardiac silhouette"
         inside a chest X-ray) must not steer the structure (P8.1).
      3. Region terms (_REGION_TERMS, longest-match-first) matched
         against display + snippet text. Generic "lung" maps to CHEST
         (no single LUNG structure exists; either side would be wrong).
      4. FULL_BODY — only when no reliable mapping exists.
    """
    #  Direct SNOMED code match (most reliable)
    if concept_code and terminology:
        structure = db.execute(
            select(AnatomicalStructure.structure_id)
            .where(AnatomicalStructure.snomed_concept_id == concept_code)
            .limit(1)
        ).scalar_one_or_none()
        if structure:
            return structure

    # Conservative text fallback on concept display name.
    #    Terms are ordered longest-first so "left lung" matches before
    #    "lung", preventing false escalation to a parent region.
    #    Each entry maps a specific text pattern to exactly one structure.
    #    Generic organs (heart, brain, etc.) map to their own structure,
    #    NOT to a parent body region.
    # P8.1: organ terms match the concept display name (which already
    # falls back to the finding's subject title at call sites) ONLY —
    # incidental organ words in free-text snippets (P8-live: "cardiac
    # silhouette" inside a chest X-ray snippet matching HEART) must not
    # steer the structure. Region terms still match display + snippet.
    organ_hit = _match_structure_term(_ORGAN_TERMS, concept_display_name or "")
    if organ_hit:
        exists = db.execute(
            select(AnatomicalStructure.structure_id)
            .where(AnatomicalStructure.structure_id == organ_hit)
            .limit(1)
        ).scalar_one_or_none()
        if exists:
            return organ_hit

    region_hit = _match_structure_term(
        _REGION_TERMS,
        " ".join(filter(None, [concept_display_name, raw_text])),
    )
    if region_hit:
        exists = db.execute(
            select(AnatomicalStructure.structure_id)
            .where(AnatomicalStructure.structure_id == region_hit)
            .limit(1)
        ).scalar_one_or_none()
        if exists:
            return region_hit

    # 3. Fall back to FULL_BODY — conservative default when no mapping found
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
        abnormal_flag: str | None = None,
    ) -> tuple[ClinicalEvent, AnatomicalObservation | None]:
        """
        Build a ClinicalEvent and a corresponding AnatomicalObservation.
        Returns (clinical_event, anatomical_observation).

        NOTE: legacy variant kept for compatibility; the live path is
        EventBuilder.build_clinical_event below.
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
                # P2 fix: the extraction schema provides `flag` but no caller
                # passed it through, so abnormal_flag was always NULL and the
                # severity/interpretation pipeline was dead.
                abnormal_flag=(abnormal_flag or None),
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
        structure_id = _resolve_structure_id(
            db, canon_res.code, canon_res.terminology,
            concept_display_name=canon_res.display_name or raw_test_name,
            raw_text=source_text,
        )
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
        event_type: EventType = EventType.LAB_RESULT,
        source_type: SourceType = SourceType.LAB_REPORT,
        abnormal_flag: str | None = None,
    ) -> tuple[ClinicalEvent, AnatomicalObservation | None]:
        """
        Build a ClinicalEvent and a corresponding AnatomicalObservation.
        Returns (clinical_event, anatomical_observation).

        P1: callers pass event_type=DIAGNOSIS for explicit diagnosis mentions;
        those also create a ConditionOccurrence (evidence-backed, never
        inferred) and attach a deterministic document Visit. All other
        mentions keep their existing semantics untouched.

        P8.1: ConditionOccurrence rows are created ONLY for positive,
        patient-experienced assertions. A negated mention ("No
        hemorrhage") still becomes a ClinicalEvent (explicit negative
        source assertion — queryable, citable) but never a Condition row.
        """
        match_status = getattr(canon_res, "match_status", getattr(canon_res, "status"))
        if match_status == MatchStatus.AUTO_MATCH:
            verification_status = VerificationStatus.EXTRACTED
        else:
            verification_status = VerificationStatus.UNVERIFIED

        # P0 assertion foundation: classify the source mention (ConText-lite,
        # deterministic) so negated / hypothetical / family / historical
        # statements never project as confirmed active facts.
        assertion = classify_assertion(source_text or f"{raw_test_name} :{value} {unit}")

        occurred = event_time if event_time else datetime.now(timezone.utc)
        event = ClinicalEvent(
            event_id=uuid.uuid4(),
            patient_id=patient_id,
            concept_id=canon_res.concept_id,
            event_type=event_type,
            source_type=source_type,
            verification_status=verification_status,
            event_time=occurred,
            polarity=assertion.polarity.value,
            assertion_verification=assertion.verification.value,
            experiencer=assertion.experiencer.value,
            clinical_status=assertion.clinical_status.value if assertion.clinical_status else None,
            source_snippet=assertion.snippet[:500],
            # P6: per-mention normalization evidence (NULL unless resolved;
            # original text in source_snippet is never overwritten).
            match_confidence=canon_res.combined_score if match_status == MatchStatus.AUTO_MATCH else None,
            match_status=canon_res.status.value if hasattr(canon_res.status, "value") else str(canon_res.status),
        )
        db.add(event)
        db.flush()

        # P1: deterministic document Visit for OCCURRED_DURING grouping.
        # Lazy import avoids a hard dependency cycle at module load.
        from services.clinical.occurrences import find_or_create_condition, get_or_create_visit

        visit = get_or_create_visit(
            db, patient_id, occurred, VisitType.DOCUMENT, source=str(document_id)
        )

        enqueue_clinical_event(
            db,
            event_id=event.event_id,
            patient_id=patient_id,
            event_type=event.event_type,
            source_type=event.source_type,
            verification_status=event.verification_status,
            event_time=event.event_time,
            polarity=assertion.polarity.value,
            assertion_verification=assertion.verification.value,
            experiencer=assertion.experiencer.value,
            clinical_status=assertion.clinical_status.value if assertion.clinical_status else None,
            source_snippet=assertion.snippet[:500],
            document_id=document_id,
            evidence_text=(source_text or f"{raw_test_name} :{value} {unit}")[:500],
            extraction_method="ADE",
            concept_id=canon_res.concept_id,
            concept_system=canon_res.terminology,
            concept_code=canon_res.code,
            concept_display=canon_res.display_name,
            visit_id=visit.visit_id,
            match_confidence=event.match_confidence,
            match_status=event.match_status,
        )

        if is_lab_result:
            lab_payload = LabResult(
                event_id=event.event_id,
                value=str(value),
                unit=unit,
                reference_range=ref_range,
                # P2 fix: the extraction schema provides `flag` but no caller
                # passed it through, so abnormal_flag was always NULL and the
                # severity/interpretation pipeline was dead.
                abnormal_flag=(abnormal_flag or None),
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
        structure_id = _resolve_structure_id(
            db, canon_res.code, canon_res.terminology,
            concept_display_name=canon_res.display_name or raw_test_name,
            raw_text=source_text,
        )
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
            polarity=assertion.polarity.value,
            experiencer=assertion.experiencer.value,
            source_snippet=assertion.snippet[:500],
        )

        # P2: lab readings become first-class Measurements (one row per
        # reading — never collapsed) with numeric parse + interpretation.
        if is_lab_result:
            from services.clinical.measurements import create_lab_measurement

            create_lab_measurement(
                db,
                patient_id=patient_id,
                name=raw_test_name,
                value=str(value),
                unit=unit or None,
                ref_range=ref_range or None,
                abnormal_flag=(abnormal_flag or None),
                terminology=canon_res.terminology,
                code=canon_res.code,
                display_name=canon_res.display_name,
                measured_at=occurred,
                source_event_id=event.event_id,
                source_document_id=document_id,
                evidence_text=(source_text or f"{raw_test_name} :{value} {unit}")[:500],
                visit_id=visit.visit_id,
            )

        # P1: explicit diagnosis mentions become ConditionOccurrences with
        # full assertion + provenance + visit linkage. The condition keeps
        # the canonical coding when the mention auto-matched; otherwise the
        # raw diagnosis text is preserved with null coding (never guessed).
        # P8.1: ONLY for positive, patient-experienced assertions. A negated
        # mention ("No hemorrhage") stays a ClinicalEvent (explicit negative
        # source assertion) and never becomes a Condition row; family or
        # hypothetical mentions likewise create no patient Condition.
        if _should_create_condition(event_type, value, assertion):
            auto = match_status == MatchStatus.AUTO_MATCH
            find_or_create_condition(
                db,
                patient_id,
                value.strip(),
                terminology=canon_res.terminology if auto else None,
                code=canon_res.code if auto else None,
                display_name=canon_res.display_name if auto else None,
                source_type=event.source_type.value,
                verification_status=verification_status.value,
                onset_date=occurred.date(),
                recorded_at=occurred,
                source_event_id=event.event_id,
                source_document_id=document_id,
                evidence_text=(source_text or value)[:500],
                extraction_method="ADE",
                visit_id=visit.visit_id,
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

        # P15: never map a deleted document — the delete endpoint removes
        # derivatives, and the pipeline must not recreate them afterwards.
        if document.status == "DELETED":
            logger.warning(f"Document {document_id} is DELETED; skipping timeline mapping.")
            return 0, []

        doc_json = raw_record.extraction.get("document", {})
        sections = doc_json.get("sections", [])
        pages = doc_json.get("pages", [])
        events_created = 0
        observations_created = []

        # P8.1: default event_time is the source's own date (authorisation
        # → specimen → encounter), NOT ingestion time. Distinct date roles
        # stay in the extraction JSON as source metadata.
        source_date = _document_date(doc_json)
        default_event_time = (
            datetime(source_date.year, source_date.month, source_date.day, tzinfo=timezone.utc)
            if source_date
            else None
        )

        # P8.1: clinical history / reason for investigation (e.g. Headache)
        # was previously discarded. Map it as a SYMPTOM source assertion;
        # assertion classification + normalization decide the rest.
        clinical_information = (doc_json.get("clinical_information") or "").strip()
        if clinical_information and len(clinical_information) > 2:
            canon_res = Canonicalizer.resolve_concept(db, raw_term=clinical_information[:200])
            event, observation = event_builder.build_clinical_event(
                db=db,
                patient_id=document.patient_id,
                document_id=document.document_id,
                canon_res=canon_res,
                raw_test_name="Clinical History",
                value=clinical_information[:500],
                unit="",
                ref_range="",
                source_text=clinical_information[:500],
                bbox=None,
                event_time=default_event_time,
                is_lab_result=False,
                event_type=EventType.SYMPTOM,
                source_type=SourceType.DOCTOR_ENTERED,
            )
            events_created += 1
            if observation:
                observations_created.append(observation)

        # Process sections for lab results and diagnostic findings
        for section in sections:
            results = section.get("results", [])

            for result in results:
                raw_test_name = result.get("test_name", "")
                value = result.get("result", "")
                if not raw_test_name or not value:
                    logger.warning("Missing test name or value in result: skipping entry")
                    continue
                canon_res = Canonicalizer.resolve_concept(db, raw_term=raw_test_name)

                unit = result.get("unit", "")
                ref_range = result.get("reference_range", "")
                source_text = result.get("source_text", "")

                # P8.1: hint-aware finding classification. ADE hints are
                # advisory; the measurement gate + local assertion are
                # authoritative. Free-text findings dressed as results must
                # never become LAB_RESULT/Measurement rows.
                result_type, as_lab, result_source = _classify_result_entry(result)

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
                    bbox=_page_envelope(result.get("page_number")),
                    event_time=default_event_time,
                    is_lab_result=as_lab,
                    event_type=result_type,
                    source_type=result_source,
                    abnormal_flag=(result.get("flag") or None),
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
                # P8.1: normal-study statements ("Normal awake record.")
                # are findings, not disease diagnoses — same event shape,
                # but IMAGING_RESULT so no Condition row is ever created.
                diagnosis_type = (
                    EventType.IMAGING_RESULT
                    if _is_normal_study_statement(diagnosis)
                    else EventType.DIAGNOSIS
                )
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
                    event_time=default_event_time,
                    is_lab_result=False,
                    event_type=diagnosis_type,
                    source_type=SourceType.IMAGING_REPORT,
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
                        event_time=default_event_time,
                        is_lab_result=False,
                        # P8.1: section comments are findings, not labs.
                        event_type=EventType.IMAGING_RESULT,
                        source_type=SourceType.IMAGING_REPORT,
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
                                # P8.1: page provenance envelope (no
                                # migration; None stays None).
                                bbox=_page_envelope(page.get("page_number")),
                                event_time=default_event_time,
                                is_lab_result=False,
                                # P8.1: page-text findings are findings.
                                event_type=EventType.IMAGING_RESULT,
                                source_type=SourceType.IMAGING_REPORT,
                            )
                            events_created += 1
                            if observation:
                                observations_created.append(observation)

        # P7: flush only — the caller (ingestion worker) owns the commit, so
        # clinical records + outbox rows + observations commit atomically in
        # one transaction instead of splitting across two commits.
        db.flush()
        logger.info(f"Successfully mapped {events_created} events for document {document_id}.")
        return events_created, observations_created