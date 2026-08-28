from presidio_analyzer import AnalyzerEngine
from presidio_analyzer.nlp_engine import NlpEngineProvider

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

        # Pseudonymize
        safe_text, entities_audit = self._replace_entities(
            text,
            results,
        )

        # Validate for leakage
        validation = self.validator.validate(safe_text)

        return DeIdentificationResult(
            text=safe_text,
            entities=entities_audit,
            validation_passed=validation.passed,
            validation_errors=validation.errors,
            policy_version="v1",
            pseudonym_count=len(entities_audit),
        )