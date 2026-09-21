from presidio_analyzer import AnalyzerEngine
from presidio_analyzer.nlp_engine import NlpEngineProvider

import re
from dataclasses import dataclass

from .config import DeIdentificationConfig
from models.deidentification import DeIdentificationEntity, DeIdentificationResult
from .pseudonymizer import Pseudonymizer
from .recognizers import (
    MedicalRecordNumberRecognizer,
    PatientIdRecognizer,
    InsuranceIdRecognizer,
    DeviceIdRecognizer,
    AccountNumberRecognizer,
)
from .validator import LeakageValidator


class DeIdentificationService:
    # P8.1: minimum token length for known-identifier matching. Excludes
    # initials ("P", "S") that would nuke clinical text, while keeping
    # short name tokens ("ALOM"). Full names always match regardless.
    _MIN_KNOWN_TOKEN_LEN = 3
    _MAX_KNOWN_VARIANTS = 40
    def __init__(
        self,
        secret: bytes,
        config: DeIdentificationConfig | None = None,
    ):
        self.config = config or DeIdentificationConfig()

        # Explicitly configure Presidio to use the lightweight
        # spaCy model installed in the Docker image.
        nlp_configuration = {
            "nlp_engine_name": "spacy",
            "models": [
                {
                    "lang_code": self.config.language,
                    "model_name": "en_core_web_sm",
                }
            ],
        }

        provider = NlpEngineProvider(
            nlp_configuration=nlp_configuration
        )

        nlp_engine = provider.create_engine()

        self.analyzer = AnalyzerEngine(
            nlp_engine=nlp_engine,
            supported_languages=[self.config.language],
        )

        self.pseudonymizer = Pseudonymizer(secret)
        self.validator = LeakageValidator()

        self._register_custom_recognizers()

    @classmethod
    def known_name_variants(cls, names) -> list[str]:
        """Expand known identifiers into match variants (P8.1).

        Returns full names plus whitespace/punctuation-split tokens
        (len >= 3), longest-first, deduplicated, capped. Matching is
        case-insensitive at use sites, so all-caps, mixed-case, and
        repeated occurrences in headers, tables, or OCR text all match.
        Only explicit known identifiers are ever matched — never generic
        uppercase phrases — so clinical terminology is untouched.
        """
        variants: list[str] = []
        seen: set[str] = set()
        for name in names or []:
            if not name or not isinstance(name, str):
                continue
            full = " ".join(name.strip().split())
            if not full:
                continue
            candidates = [full] + [
                tok
                for tok in re.split(r"[^A-Za-z]+", full)
                if len(tok) >= cls._MIN_KNOWN_TOKEN_LEN
            ]
            for cand in candidates:
                key = cand.lower()
                if key not in seen:
                    seen.add(key)
                    variants.append(cand)
                if len(variants) >= cls._MAX_KNOWN_VARIANTS:
                    return sorted(variants, key=len, reverse=True)
        return sorted(variants, key=len, reverse=True)

    @dataclass
    class _KnownSpan:
        """Minimal recognizer-result shape for known-identifier hits."""

        entity_type: str
        start: int
        end: int
        score: float = 1.0

    def _known_spans(self, text: str, variants: list[str], occupied: list[tuple[int, int]]):
        """Find known-identifier spans not overlapping analyzer hits."""
        spans = []
        for variant in variants:
            try:
                pattern = re.compile(re.escape(variant), re.IGNORECASE)
            except re.error:  # pragma: no cover - escaped input is safe
                continue
            for match in pattern.finditer(text):
                start, end = match.span()
                if any(start < occ_end and end > occ_start for occ_start, occ_end in occupied):
                    continue
                spans.append(self._KnownSpan(entity_type="PERSON", start=start, end=end))
                occupied.append((start, end))
        return spans

    def _register_custom_recognizers(self):
        recognizers = [
            MedicalRecordNumberRecognizer(),
            PatientIdRecognizer(),
            InsuranceIdRecognizer(),
            DeviceIdRecognizer(),
            AccountNumberRecognizer(),
        ]

        for recognizer in recognizers:
            self.analyzer.registry.add_recognizer(recognizer)

    def _replace_entities(
        self,
        text: str,
        results,
    ) -> tuple[str, list[DeIdentificationEntity]]:
        # Process from right → left so offsets remain valid during replacement.
        results = sorted(
            results,
            key=lambda r: r.start,
            reverse=True,
        )

        entities_audit = []

        for result in results:
            original = text[result.start:result.end]

            replacement = self.pseudonymizer.pseudonym(
                result.entity_type,
                original,
            )

            text = (
                text[:result.start]
                + replacement
                + text[result.end:]
            )

            entities_audit.append(
                DeIdentificationEntity(
                    entity_type=result.entity_type,
                    original=original,
                    replacement=replacement,
                    start=result.start,
                    end=result.end,
                )
            )

        return text, entities_audit

    def deidentify(
        self,
        text: str,
        extra_names: list[str] | None = None,
    ) -> DeIdentificationResult:
        if not text:
            return DeIdentificationResult(
                text="",
                validation_passed=True,
            )

        entities_to_detect = (
            list(self.config.presidio_entities)
            + list(self.config.custom_entities)
        )

        # Analyze
        results = self.analyzer.analyze(
            text=text,
            entities=entities_to_detect,
            language=self.config.language,
        )

        # P8.1: patient-specific known identifiers (PG full_name, ADE
        # patient/requester/authorisation names). These match regardless
        # of case or table layout — the P8-live all-caps miss is closed
        # here even when the NER analyzer sees nothing.
        variants = self.known_name_variants(extra_names)
        if variants:
            occupied = [(r.start, r.end) for r in results]
            results = list(results) + self._known_spans(text, variants, occupied)

        # Pseudonymize
        safe_text, entities_audit = self._replace_entities(
            text,
            results,
        )

        # Validate for leakage (known names included; error strings never
        # carry identifier values — the worker logs them).
        validation = self.validator.validate(safe_text, extra_names=variants)

        return DeIdentificationResult(
            text=safe_text,
            entities=entities_audit,
            validation_passed=validation.passed,
            validation_errors=validation.errors,
            policy_version="v1",
            pseudonym_count=len(entities_audit),
        )