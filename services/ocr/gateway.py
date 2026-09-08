"""Medical document classification gateway.

Replaced the local LFS/GGUF (llama-cpp-python) classifier with the remote
LandingAI ADE Classify API. No local model is loaded or retained.

The public surface of ``OCRGateway`` is preserved so the downstream document
pipeline (``workers/ingestion_tasks.py``, ``RawExtractionData.gateway_json``,
and the frontend document-detail screen) is unchanged:

    classify_document(file_path) -> dict
        returns the existing fields ``is_medical``, ``document_type``,
        ``type_text``, ``bbox``, ``bbox_pixels``, ``image_width``,
        ``image_height``, plus additive transparency fields
        (``classifier``, ``model``, ``pages``, ``page_count``,
        ``credit_usage``, ``duration_ms``, ``version``,
        ``aggregate_rule``).

    unload_model() -> None
        no-op, retained for pipeline compatibility (classification is remote).
"""

import json
import os
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()  # Load environment variables for local config

from logger import logger

from services.ocr.extraction import get_ade_client


# Classification model version. The official Python/library example uses
# "classify-latest"; pin a version like "classify-20260420" in production.
ADE_CLASSIFY_MODEL = os.getenv("ADE_CLASSIFY_MODEL", "classify-latest")


class ClassificationError(RuntimeError):
    """Raised when classification fails explicitly and must not be masked."""


class OCRGateway:
    """
    Remote medical-document classifier backed by LandingAI ADE Classify.

    ADE Classify returns a per-page class label for every page. The labels we
    request are the existing application vocabulary (LAB_REPORT, PRESCRIPTION,
    DISCHARGE, IMAGING) plus an explicit NON_MEDICAL class. Per-page results
    are aggregated deterministically into the document-level classification
    that the application has always consumed.
    """

    ALLOWED_TYPES = {
        "LAB_REPORT",
        "PRESCRIPTION",
        "DISCHARGE",
        "IMAGING",
        "JUNK",
        "UNKNOWN",
    }

    # Page labels requested from ADE Classify. These are the ONLY labels ADE
    # is allowed to return (anything else is treated as unknown below).
    ADE_CLASSES = [
        {
            "class": "LAB_REPORT",
            "description": (
                "A medical laboratory report page listing blood, urine, or other "
                "lab test results with measured values, units, and reference ranges."
            ),
        },
        {
            "class": "PRESCRIPTION",
            "description": (
                "A medical prescription or medication order written by a clinician "
                "listing medications, dosages, and patient instructions."
            ),
        },
        {
            "class": "DISCHARGE",
            "description": (
                "A hospital discharge summary or discharge report summarizing a "
                "patient's admission, treatment, and discharge plan."
            ),
        },
        {
            "class": "IMAGING",
            "description": (
                "A medical imaging or radiology report such as X-ray, CT, MRI, "
                "ultrasound, or another imaging study interpretation."
            ),
        },
        {
            "class": "NON_MEDICAL",
            "description": (
                "A page that is not a medical document: general correspondence, "
                "forms, identity documents, invoices, advertisements, receipts, "
                "or blank/scanner junk pages."
            ),
        },
    ]

    MEDICAL_TYPES = {"LAB_REPORT", "PRESCRIPTION", "DISCHARGE", "IMAGING"}

    # Deterministic tie-break: when multiple medical types have equal page
    # counts, the highest-priority type (lowest index) wins.
    _TIE_BREAK_ORDER = ["LAB_REPORT", "PRESCRIPTION", "DISCHARGE", "IMAGING"]

    @classmethod
    def _normalize_page_label(cls, raw_label) -> str:
        """Map an ADE page label into the existing ALLOWED_TYPES vocabulary.

        - known medical labels pass through
        - the NON_MEDICAL class maps to JUNK (existing non-medical marker)
        - ADE's 'unknown' maps to UNKNOWN
        - any unexpected label is UNKNOWN (defensive; never guessed)
        """
        label = str(raw_label).strip().upper()
        if label in cls.ALLOWED_TYPES:
            return label
        if label == "NON_MEDICAL":
            return "JUNK"
        return "UNKNOWN"

    @classmethod
    def _aggregate(cls, per_page: list[dict], page_count: int, meta) -> dict:
        """
        Deterministically aggregate per-page ADE classes into the existing
        document-level classification.

        Rule (stable across runs):
        1. Medical pages = labels in {LAB_REPORT, PRESCRIPTION, DISCHARGE, IMAGING}.
        2. is_medical = True iff at least one page is medical.
        3. document_type:
           - if any medical page: the most frequent medical type across ALL
             medical pages; ties broken by fixed order LAB_REPORT >
             PRESCRIPTION > DISCHARGE > IMAGING.
           - else if any page is UNKNOWN: UNKNOWN  (no medical content was
             confirmed, so the class must not be silently invented)
           - else: JUNK  (every page was explicitly non-medical)
        4. type_text / bbox / bbox_pixels: always None (ADE returns no visible
           type-text string or geometry). Keep null rather than invent text.
        """
        labels = [cls._normalize_page_label(p["class"]) for p in per_page]
        medical = [label for label in labels if label in cls.MEDICAL_TYPES]
        n_unknown = sum(1 for label in labels if label == "UNKNOWN")

        if medical:
            is_medical = True
            counts = Counter(medical)
            document_type = max(
                cls._TIE_BREAK_ORDER,
                key=lambda t: (counts.get(t, 0), -cls._TIE_BREAK_ORDER.index(t)),
            )
        elif n_unknown > 0:
            is_medical = False
            document_type = "UNKNOWN"
        else:
            is_medical = False
            document_type = "JUNK"

        return {
            "is_medical": is_medical,
            "document_type": document_type,
            "type_text": None,
            "bbox": None,
            "bbox_pixels": None,
            "image_width": 0,
            "image_height": 0,
            # Additive transparency fields (JSONB column, ignored by frontend).
            "classifier": "landingai.ade.classify",
            "model": ADE_CLASSIFY_MODEL,
            "page_count": page_count,
            "credit_usage": getattr(meta, "credit_usage", None),
            "duration_ms": getattr(meta, "duration_ms", None),
            "version": getattr(meta, "version", None),
            "pages": per_page,
            "aggregate_rule": (
                "is_medical if any medical page; dominant medical type across "
                "medical pages (tie-break LAB_REPORT>PRESCRIPTION>DISCHARGE>IMAGING); "
                "no medical page + any unknown => UNKNOWN; all non-medical => JUNK"
            ),
        }

    @classmethod
    def classify_document(cls, file_path: str) -> dict:
        """
        Classify a document via the remote LandingAI ADE Classify API.

        Returns the existing gateway dict shape consumed by the pipeline and
        frontend (see module docstring), aggregated from per-page classes.

        Raises:
            ClassificationError: explicitly surfaced when ADE is not
                configured, the API request fails, the response is
                malformed/empty, or a timeout occurs. These never degrade
                silently into an incorrect document class.
        """
        client = get_ade_client()
        if client is None:
            raise ClassificationError(
                "LandingAI ADE classification is not configured. "
                "Set VISION_AGENT_API_KEY or LANDINGAI_API_KEY to enable "
                "document classification."
            )

        logger.info(
            "Classifying document %s via LandingAI ADE (model=%s)...",
            file_path,
            ADE_CLASSIFY_MODEL,
        )

        try:
            response = client.classify(
                classes=json.dumps(cls.ADE_CLASSES),
                document=Path(file_path),
                model=ADE_CLASSIFY_MODEL,
            )
        except Exception as exc:
            raise ClassificationError(
                f"LandingAI ADE classify request failed: {exc}"
            ) from exc

        per_page = []
        items = getattr(response, "classification", None)
        if items is None:
            raise ClassificationError(
                "Malformed LandingAI ADE classify response: missing 'classification'."
            )

        for index, item in enumerate(items):
            raw_class = getattr(item, "class_", None)
            if raw_class is None:
                raw_class = getattr(item, "class", None)
            if raw_class is None:
                raise ClassificationError(
                    f"Malformed LandingAI ADE classify response: page item {index} "
                    "has no class label."
                )
            per_page.append(
                {
                    "page": int(getattr(item, "page", index)),
                    "class": cls._normalize_page_label(raw_class),
                    "reason": getattr(item, "reason", None),
                    "suggested_class": getattr(item, "suggested_class", None),
                }
            )

        if not per_page:
            raise ClassificationError(
                "LandingAI ADE classify returned no per-page results."
            )

        meta = getattr(response, "metadata", None)
        page_count = int(getattr(meta, "page_count", None) or len(per_page))
        if page_count != len(per_page):
            # Metadata may report trailing blank/omitted pages; keep both but do
            # not hide the discrepancy from operators.
            logger.warning(
                "LandingAI ADE page_count=%s differs from %s classification items.",
                page_count,
                len(per_page),
            )

        result = cls._aggregate(per_page, page_count, meta)
        page_labels = [p["class"] for p in per_page]
        logger.info(
            "ADE classification result: type=%s medical=%s pages=%s per_page=%s",
            result["document_type"],
            result["is_medical"],
            page_count,
            page_labels,
        )
        return result

    @classmethod
    def unload_model(cls) -> None:
        """No-op retained for pipeline compatibility.

        Classification now happens on the landingai ADE Classify API; there is
        no local model in this process to unload.
        """
        logger.info("No local model to unload (classification is remote via LandingAI ADE).")