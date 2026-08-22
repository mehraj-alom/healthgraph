import re
from dataclasses import dataclass

@dataclass
class ValidationResult:
    passed: bool
    errors: list[str]

class LeakageValidator:
    PATTERNS = {
        "EMAIL": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
        "PHONE": re.compile(r"(?<!\d)(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}(?!\d)"),
        "IP_ADDRESS": re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
        "SSN": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    }

    def validate(self, text: str) -> ValidationResult:
        errors = []
        for name, pattern in self.PATTERNS.items():
            if pattern.search(text):
                errors.append(f"Potential {name} detected")
        
        return ValidationResult(
            passed=len(errors) == 0,
            errors=errors,
        )