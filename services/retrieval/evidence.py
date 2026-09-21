"""P0 citation + evidence-level model shared by node-detail and chat.

Evidence classes (from the P0 research):
- SOURCE_FACT: directly stated in source doc / explicit PG field.
- USER_REPORTED: patient stated it; truth = "patient stated X".
- SYSTEM_DERIVED: deterministic transform (parse, join, group, aggregate).
- NORMALIZED: terminology resolution to a shared Concept.
- AI_INFERRED: model guess — quarantine only, never an authoritative edge.
"""
from typing import Optional
from pydantic import BaseModel, Field
import re

from models.clinical_assertion import (
    EvidenceLevel,
    NO_DATA_RECORDED,
    NO_DATA_DETERMINABLE,
    NO_DOCUMENTED_REASON,
)


class Citation(BaseModel):
    """Provenance object every clinical answer must carry (or no-data)."""

    node_id: Optional[str] = Field(default=None, description="Graph node id, e.g. 'observation:<uuid>'.")
    observation_id: Optional[str] = None
    event_id: Optional[str] = None
    document_id: Optional[str] = None
    page_number: Optional[int] = None
    quote: Optional[str] = Field(default=None, description="Exact supporting text, <=300 chars.")
    verification_status: Optional[str] = None
    source_type: Optional[str] = None
    evidence_level: str = Field(default=EvidenceLevel.SOURCE_FACT.value)
    concept_display_name: Optional[str] = None
    prescriber: Optional[str] = None
    storage_url: Optional[str] = None


class EvidenceBadge(str):
    """UI-facing evidence tiers. The UI must render these distinctly."""

    CONFIRMED_SOURCE_STATED = "CONFIRMED / SOURCE-STATED"
    USER_REPORTED = "USER-REPORTED"
    SYSTEM_DERIVED = "SYSTEM-DERIVED"
    AI_INFERRED = "AI-INFERRED"
    UNVERIFIED = "UNVERIFIED"


def badge_for(source_type: str | None, verification_status: str | None) -> str:
    """Map (source_type, verification_status) to a UI evidence badge."""
    st = (source_type or "").upper()
    vs = (verification_status or "").upper()
    if vs in ("HUMAN_VERIFIED", "CONFIRMED"):
        return EvidenceBadge.CONFIRMED_SOURCE_STATED
    if st in ("PATIENT_REPORTED",) or vs == "UNVERIFIED":
        # Patient-reported content is truthful *as a statement*, but clinically
        # unverified until corroborated.
        if st == "PATIENT_REPORTED":
            return EvidenceBadge.USER_REPORTED
        return EvidenceBadge.UNVERIFIED
    if st in ("AI_INFERRED",):
        return EvidenceBadge.AI_INFERRED
    if vs in ("EXTRACTED", "PROVISIONAL"):
        return EvidenceBadge.UNVERIFIED
    return EvidenceBadge.SYSTEM_DERIVED


def truncate_quote(text: str | None, limit: int = 300) -> str | None:
    if not text:
        return None
    t = text.strip()
    return t if len(t) <= limit else t[:limit].rstrip() + "…"


def no_data_result(reason: str = NO_DATA_RECORDED) -> dict:
    """Standard no-data payload: explicit absence, never an invented answer."""
    return {"message": reason, "citations": []}


_UUID_RE = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
)
_NODE_ID_RE = re.compile(r"\b[a-z_]+:[0-9a-fA-F\-]{8,}[^\s\"']*")

_MAX_SYNTHESIZED_CITATIONS = 10


def _citation_text(citation) -> tuple[list[str], str | None]:
    """Extract (id tokens, quote) from a Citation-like object or dict."""
    if isinstance(citation, dict):
        get = citation.get
    else:
        get = lambda k: getattr(citation, k, None)  # noqa: E731
    ids = [str(get(k)) for k in ("node_id", "observation_id", "event_id", "document_id")
           if get(k)]
    quote = get("quote")
    return ids, (str(quote) if quote else None)


def filter_valid_citations(citations, messages) -> list:
    """P7 post-hoc citation validation (pure, tested).

    Keeps only citations traceable to tool outputs in this conversation:
    at least one id token (node/observation/event/document id) must appear
    verbatim in a tool message, or a >=20-char quote prefix must appear.
    Anything else (including LLM-invented references) is dropped.     Caps at
    10. Empty/None input passes through as [].
    """
    if not citations:
        return []
    tool_texts = []
    for m in messages or []:
        name = type(m).__name__
        if name in ("ToolMessage",) or "tool" in name.lower():
            try:
                tool_texts.append(str(m.content))
            except Exception:
                continue
    corpus = "\n".join(tool_texts)
    corpus_uuids = set(_UUID_RE.findall(corpus))
    corpus_nodes = set(_NODE_ID_RE.findall(corpus))
    allowed_tokens = corpus_uuids | corpus_nodes

    kept = []
    for citation in citations:
        ids, quote = _citation_text(citation)
        matched = any(
            tok and (tok in allowed_tokens or tok in corpus) for tok in ids
        )
        if not matched and quote and len(quote.strip()) >= 20:
            matched = quote.strip()[:60] in corpus
        if matched:
            kept.append(citation)
        if len(kept) >= _MAX_SYNTHESIZED_CITATIONS:
            break
    return kept
