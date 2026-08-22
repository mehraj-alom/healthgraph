"""Custom regex patterns targeting the clinical domain that standard NLP models often miss."""

from presidio_analyzer import Pattern, PatternRecognizer



class MedicalRecordNumberRecognizer(PatternRecognizer):
    def __init__(self):
        patterns = [
            Pattern(
                name="mrn",
                regex=r"\b(?:MRN|Medical Record Number)[\s:#-]*[A-Z0-9-]{4,}\b",
                score=0.90,
            )
        ]
        super().__init__(supported_entity="MEDICAL_RECORD_NUMBER", patterns=patterns)

class PatientIdRecognizer(PatternRecognizer):
    def __init__(self):
        patterns = [
            Pattern(
                name="patient_id",
                regex=r"\b(?:Patient ID|PatientID)[\s:#-]*[A-Z0-9-]{4,}\b",
                score=0.90,
            )
        ]
        super().__init__(supported_entity="PATIENT_ID", patterns=patterns)

class InsuranceIdRecognizer(PatternRecognizer):
    def __init__(self):
        patterns = [
            Pattern(
                name="insurance_id",
                regex=r"\b(?:Insurance ID|Member ID)[\s:#-]*[A-Z0-9-]{4,}\b",
                score=0.85,
            )
        ]
        super().__init__(supported_entity="INSURANCE_ID", patterns=patterns)

class DeviceIdRecognizer(PatternRecognizer):
    def __init__(self):
        patterns = [
            Pattern(
                name="device_id",
                regex=r"\b(?:Device ID|DeviceID)[\s:#-]*[A-Z0-9-]{4,}\b",
                score=0.85,
            )
        ]
        super().__init__(supported_entity="DEVICE_ID", patterns=patterns)

class AccountNumberRecognizer(PatternRecognizer):
    def __init__(self):
        patterns = [
            Pattern(
                name="account_number",
                regex=r"\b(?:Account Number|Account No)[\s:#-]*[A-Z0-9-]{4,}\b",
                score=0.85,
            )
        ]
        super().__init__(supported_entity="ACCOUNT_NUMBER", patterns=patterns)