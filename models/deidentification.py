from dataclasses import dataclass, field

@dataclass
class DeIdentificationEntity:
    entity_type: str
    original: str
    replacement: str
    start: int
    end: int

@dataclass
class DeIdentificationResult:
    text: str
    entities: list[DeIdentificationEntity] = field(default_factory=list)
    validation_passed: bool = False
    validation_errors: list[str] = field(default_factory=list)
    policy_version: str = "v1"
    pseudonym_count: int = 0