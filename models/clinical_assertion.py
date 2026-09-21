"""P0 clinical assertion foundation.

Every extracted clinical fact carries assertion metadata so negated,
hypothetical, historical, or family-attributed mentions can NEVER be
mistaken for confirmed active patient conditions.

Design references (lite, not copied):
- FHIR Condition clinicalStatus / verificationStatus (incl. refuted,
  entered-in-error as modifiers).
- OMOP CDM rule: rule-out / history-of mentions belong in Observation,
  not in condition_occurrence.
- NegEx/ConText: negation + hypothetical + experiencer + temporality
  triggers around a mention.

The classifier below is deterministic ConText-lite (regex triggers only,
no model calls) so extraction stays reproducible. It returns a
classification for a source-text snippet; callers decide persistence.
"""
import re
from dataclasses import dataclass
from enum import Enum


class Polarity(str, Enum):
    """Assertion polarity of a clinical mention."""

    POSITIVE = "positive"
    NEGATIVE = "negative"  # explicitly negated ("no diabetes", "denies pain")
    HYPOTHETICAL = "hypothetical"  # suspected / rule-out / differential
    HISTORICAL = "historical"  # resolved past / history-of (patient's own past)
    CONDITIONAL = "conditional"  # if-needed / PRN-style conditional mention


class AssertionVerification(str, Enum):
    """Verification state of the assertion (FHIR verificationStatus lite)."""

    CONFIRMED = "confirmed"
    UNCONFIRMED = "unconfirmed"
    PROVISIONAL = "provisional"  # suspected / differential
    REFUTED = "refuted"  # negated or ruled-out
    ENTERED_IN_ERROR = "entered-in-error"


class Experiencer(str, Enum):
    """Who the clinical statement is about (ConText experiencer)."""

    PATIENT = "patient"
    FAMILY = "family"
    OTHER = "other"


class ClinicalStatus(str, Enum):
    """Course status of a condition-like fact (FHIR clinicalStatus lite)."""

    ACTIVE = "active"
    RECURRENCE = "recurrence"
    RELAPSE = "relapse"
    INACTIVE = "inactive"
    REMISSION = "remission"
    RESOLVED = "resolved"


class EvidenceLevel(str, Enum):
    """Evidence class for every persisted or returned graph relationship/fact.

    AI_INFERRED must NEVER become an authoritative Neo4j edge — it is only
    ever stored as an Assertion-style record with provenance, or returned
    as a derived/UI overlay explicitly labeled as unverified.
    """

    SOURCE_FACT = "SOURCE_FACT"  # directly stated in source doc / explicit PG field
    USER_REPORTED = "USER_REPORTED"  # patient stated it; truth = "patient stated X"
    SYSTEM_DERIVED = "SYSTEM_DERIVED"  # deterministic transform (parse/join/group)
    NORMALIZED = "NORMALIZED"  # terminology resolution to a shared Concept
    AI_INFERRED = "AI_INFERRED"  # model guess; quarantine only


# Exact no-data sentences the chat synthesizer must emit instead of inventing
# an answer. Mirrors agents/orchestrator.py synthesize() rules 6-7.
NO_DATA_RECORDED = "I don't have recorded data for that."
NO_DATA_DETERMINABLE = "I don't have enough recorded data to determine that."
NO_DOCUMENTED_REASON = (
    "Your stored record does not contain a documented reason for this."
)


# --- ConText-lite trigger patterns (ordered by precedence) -------------------

# Imperative / differential language FIRST: "rule out pneumonia" is
# hypothetical, while "ruled out" (below) is negative. Order matters.
_HYPOTHETICAL_RE = re.compile(
    r"\b(rule\s*out|r/o|differential|consider\s+\w+\s+vs|vs\.?\s+\w+|"
    r"possible|possibly|probable|probably|suspected|suspect|likely|"
    r"cannot\s+exclude|can\'t\s+exclude|not\s+excluded|may\s+represent|"
    r"consistent\s+with|evaluation\s+for|workup\s+for)\b",
    re.IGNORECASE,
)

_FAMILY_RE = re.compile(
    r"\b(family\s+history|family\s+hx|fhx|fam\s*hx|mother|father|parent|"
    r"sibling|brother|sister|grandmother|grandfather)\b",
    re.IGNORECASE,
)

_NEGATION_RE = re.compile(
    r"\b(no|denies|denied|deny|negative\s+for|absent|without|free\s+of|"
    r"no\s+evidence\s+of|no\s+sign\s+of|ruled\s+out|resolved\s+out|"
    r"never\s+had|not\s+present|unremarkable\s+for|"
    # P8.1: radiology negation verbs demonstrated by report1.pdf
    # ("The lung fields do not show any active lesion"). Tight verb
    # list — imaging verbs only, never bare "not".
    r"do(?:es)?\s+not\s+(show|reveal|demonstrate|visualise|visualize)|"
    r"did\s+not\s+(show|reveal|demonstrate|visualise|visualize)|"
    # P8.1: normal-finding copulas demonstrated by report1.pdf
    # ("Cardiac silhouette is normal"). Tight copula+normal shape only.
    r"(is|are|was|were|remains?|appears?)\s+normal)\b",
    re.IGNORECASE,
)

_HISTORICAL_RE = re.compile(
    r"\b(history\s+of|history:|hx\s+of|past\s+medical\s+history|\bpmh\b|"
    r"previous|previously|in\s+the\s+past|childhood|resolved|no\s+longer|"
    r"used\s+to\s+have|had\s+in\s+the\s+past)\b",
    re.IGNORECASE,
)

_RESOLVED_RE = re.compile(
    r"\b(resolved|remission|no\s+longer|no\s+more|cured|cleared)\b", re.IGNORECASE
)

_CONDITIONAL_RE = re.compile(
    r"\b(if\s+needed|in\s+case\s+of|\bprn\b|as\s+needed|when\s+needed|"
    r"as\s+required)\b",
    re.IGNORECASE,
)

_DISCONTINUED_RE = re.compile(
    r"\b(discontinued|stopped|stop\s+taking|held|withdrawn|taken\s+off)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class AssertionClassification:
    polarity: Polarity
    experiencer: Experiencer
    verification: AssertionVerification
    clinical_status: ClinicalStatus | None
    matched_trigger: str | None
    snippet: str


def _first_match(pattern: re.Pattern, text: str) -> str | None:
    m = pattern.search(text)
    return m.group(0) if m else None


def classify_assertion(source_text: str | None, max_snippet_chars: int = 500) -> AssertionClassification:
    """Classify a clinical mention deterministically (ConText-lite).

    Pure function — no DB, no model calls. Safe to use in extraction and tests.
    Precedence: hypothetical > family > negation > discontinued/historical >
    conditional > positive.
    """
    raw = source_text or ""
    text = raw.strip()
    snippet = text[:max_snippet_chars]

    hypo = _first_match(_HYPOTHETICAL_RE, text)
    if hypo:
        return AssertionClassification(
            polarity=Polarity.HYPOTHETICAL,
            experiencer=Experiencer.PATIENT,
            verification=AssertionVerification.PROVISIONAL,
            clinical_status=None,
            matched_trigger=hypo,
            snippet=snippet,
        )

    fam = _first_match(_FAMILY_RE, text)
    if fam:
        return AssertionClassification(
            polarity=Polarity.HISTORICAL,
            experiencer=Experiencer.FAMILY,
            verification=AssertionVerification.UNCONFIRMED,
            clinical_status=None,
            matched_trigger=fam,
            snippet=snippet,
        )

    neg = _first_match(_NEGATION_RE, text)
    if neg and not re.search(r"\bno\s+(longer|more)\b", text, re.IGNORECASE):
        return AssertionClassification(
            polarity=Polarity.NEGATIVE,
            experiencer=Experiencer.PATIENT,
            verification=AssertionVerification.REFUTED,
            clinical_status=None,
            matched_trigger=neg,
            snippet=snippet,
        )

    discontinued = _first_match(_DISCONTINUED_RE, text)
    hist = _first_match(_HISTORICAL_RE, text)
    if discontinued or hist:
        trigger = discontinued or hist
        status = (
            ClinicalStatus.RESOLVED
            if _RESOLVED_RE.search(text)
            else ClinicalStatus.INACTIVE
        )
        return AssertionClassification(
            polarity=Polarity.HISTORICAL,
            experiencer=Experiencer.PATIENT,
            verification=AssertionVerification.UNCONFIRMED,
            clinical_status=status,
            matched_trigger=trigger,
            snippet=snippet,
        )

    cond = _first_match(_CONDITIONAL_RE, text)
    if cond:
        return AssertionClassification(
            polarity=Polarity.CONDITIONAL,
            experiencer=Experiencer.PATIENT,
            verification=AssertionVerification.UNCONFIRMED,
            clinical_status=None,
            matched_trigger=cond,
            snippet=snippet,
        )

    return AssertionClassification(
        polarity=Polarity.POSITIVE,
        experiencer=Experiencer.PATIENT,
        verification=AssertionVerification.UNCONFIRMED,
        clinical_status=ClinicalStatus.ACTIVE,
        matched_trigger=None,
        snippet=snippet,
    )


def is_authoritative_positive(classification: AssertionClassification) -> bool:
    """True only when a mention may be treated as a real patient fact."""
    return (
        classification.polarity == Polarity.POSITIVE
        and classification.experiencer == Experiencer.PATIENT
        and classification.verification
        not in (
            AssertionVerification.REFUTED,
            AssertionVerification.ENTERED_IN_ERROR,
            AssertionVerification.PROVISIONAL,
        )
    )
