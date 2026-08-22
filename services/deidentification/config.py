from dataclasses import dataclass


@dataclass(frozen=True)
class DeIdentificationConfig:
    language: str = "en"

    # default entities
    presidio_entities: tuple[str, ...] = (
        "PERSON",
        "PHONE_NUMBER",
        "EMAIL_ADDRESS",
        "LOCATION",
        "IP_ADDRESS",
        "URL",
        "US_SSN",
        "DATE_TIME",
    )

    # Application-specific medical entities
    custom_entities: tuple[str, ...] = (
        "MEDICAL_RECORD_NUMBER",
        "PATIENT_ID",
        "INSURANCE_ID",
        "DEVICE_ID",
        "ACCOUNT_NUMBER",
        "LICENSE_NUMBER",
    )

    # Date and Age policies
    transform_dates: bool = True
    preserve_date_intervals: bool = True  # Keep chronology while shifting actual dates
    transform_ages: bool = True
    
    # Security: Fail closed
    fail_on_validation_error: bool = True