"""P13 deterministic answer-evaluation checks (pure, DB-less).

Every check returns (passed: bool, reason: str) — binary PASS/FAIL,
no subjective scores. Checks compare the final answer against the
recorded tool results of the SAME run (grounding), never against
hard-coded database values, so fixtures may grow without breaking
the harness. Anything requiring prose judgment (completeness,
phrasing) is explicitly out of scope here and documented as manual.
"""
import re

from services.retrieval.day_range import resolve_window
from services.retrieval.evidence import (
    _MAX_SYNTHESIZED_CITATIONS,
    _NODE_ID_RE,
    _UUID_RE,
    filter_valid_citations,
)

_CAUSAL_RE = re.compile(
    r"\b(caus(e[sd]?|ing|al)|led to|resulted in|triggered|"
    r"brought on|gave rise to|responsible for|due to|"
    r"explains? (the|your|this)|treated (the|your)|"
    r"cured|prevented (the|your))\b",
    re.IGNORECASE,
)
_NEGATION_RE = re.compile(
    r"\b(not|n't|never|no evidence|does not imply|do not imply|"
    r"is not causation|not causation|co-occurrence is not|"
    r"co-occur|association)\b",
    re.IGNORECASE,
)

def _normalize_ws(text: str) -> str:
    """Collapse whitespace runs (tool corpora escape newlines).

    ToolMessage content is str() of tool outputs, so a real newline in
    a stored quote appears as a literal backslash-n in the corpus while
    the citation quote carries the real character. Both reduce to a
    space here before whitespace collapsing.
    """
    text = (text or "").replace("\\n", " ").replace("\\r", " ").replace("\\t", " ")
    return re.sub(r"\s+", " ", text).strip()


_NO_DATA_RECORDED = "I don't have recorded data for that."
_NO_DATA_INSUFFICIENT = "I don't have enough recorded data to determine that."

# P14 Rule-6 contract: the canonical sentences are preferred, but a
# safe paraphrase is compliant iff it states the lack plainly, carries
# zero citations, and asserts no patient facts.
_NO_DATA_INTENT_RE = re.compile(
    r"don'?t have .*data|no .* (recorded|available)|nothing recorded|"
    r"not recorded|no record of|haven'?t recorded|unable to find .*data",
    re.IGNORECASE,
)
_PATIENT_FACT_RE = re.compile(
    r"\b\d+(\.\d+)?\s*(bpm|mmhg|mg\b|iu\b|minutes|min\b|hours|kg|%|percent)\b|"
    r"\b\d{4}-\d{2}-\d{2}\b",
    re.IGNORECASE,
)

# P14 comparison grounding: a month name used as a PERIOD LABEL (header,
# "Month YYYY", "Month:" — never an event date like "September 13")
# must be backed by a corpus-grounded date within that month.
_MONTHS_FULL = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5,
    "june": 6, "july": 7, "august": 8, "september": 9, "october": 10,
    "november": 11, "december": 12,
}
_MONTH_LABEL_RE = re.compile(
    r"(?m)^#{1,4}\s*.*?\b(january|february|march|april|may|june|july|"
    r"august|september|october|november|december)\b"
    r"|\b(january|february|march|april|may|june|july|august|"
    r"september|october|november|december)\s+20\d{2}\b"
    r"|\b(january|february|march|april|may|june|july|august|"
    r"september|october|november|december)\s*[:(\-–]",
    re.IGNORECASE,
)
_MONTH_DAY_RE = re.compile(
    r"\b(january|february|march|april|may|june|july|august|"
    r"september|october|november|december)\s+(\d{1,2})\b",
    re.IGNORECASE,
)
_ISO_DATE_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_HEADER_RE = re.compile(r"(?m)^#{1,4}\s")


class _ToolMsg:
    """Minimal ToolMessage stand-in (type name carries 'tool')."""

    def __init__(self, content: str):
        self.content = content


def traceable_citations(citations, tool_texts) -> list:
    """Citations surviving the production post-hoc filter."""
    return filter_valid_citations(
        citations, [_ToolMsg(t) for t in tool_texts]
    )


def corpus_uuids(tool_texts) -> set:
    """All id tokens present in tool outputs (the grounding corpus)."""
    corpus = "\n".join(tool_texts or [])
    return set(_UUID_RE.findall(corpus)) | set(_NODE_ID_RE.findall(corpus))


def _resolve_tool_window(args: dict, today) -> tuple[str, str] | None:
    """Normalize one tool call's window args to (start, end).

    Handles get_day_timeline (window preset or start/end dates) and
    get_lifestyle_series (days lookback = today-(days-1)..today).
    """
    args = args or {}
    if (args.get("window") or "").strip():
        try:
            return resolve_window(args["window"].strip(), today)
        except ValueError:
            return None
    start, end = (args.get("start_date") or "").strip(), (args.get("end_date") or "").strip()
    if start and end:
        return (start, end)
    try:
        days = int(args.get("days") or 0)
    except (TypeError, ValueError):
        days = 0
    if days > 0:
        from datetime import timedelta as _td

        return ((today - _td(days=days - 1)).isoformat(), today.isoformat())
    return None


def _overlaps(window: tuple[str, str], period: dict) -> bool:
    """Day-granular overlap (ISO YYYY-MM-DD strings compare directly)."""
    return not (window[1] < period["start"] or window[0] > period["end"])


def check_expected_tool(tool_calls, expected_tools) -> tuple[bool, str]:
    """At least one expected tool was selected."""
    if not expected_tools:
        return True, "no tool expectation"
    used = [c.get("name") for c in tool_calls or []]
    for want in expected_tools or []:
        if want in used:
            return True, f"selected {want} (used={sorted(set(used))})"
    return False, f"none of {expected_tools} in used={sorted(set(used))}"


def check_periods_covered(tool_calls, periods, today) -> tuple[bool, str]:
    """Every expected period overlaps at least one retrieved tool window.

    Overlap (not equality): lifestyle `days` lookbacks and agent-chosen
    explicit ranges legitimately differ from preset boundaries while
    still retrieving the period's records. This check verifies data
    availability per period; whether the prose structures the
    comparison correctly is manual (rule 7e).
    """
    if not periods:
        return True, "no periods required"
    windows = []
    for call in tool_calls or []:
        window = _resolve_tool_window(call.get("args"), today)
        if window:
            windows.append((call.get("name"), window))
    missing = [p for p in periods
               if not any(_overlaps(w, p) for _, w in windows)]
    if missing:
        return False, f"periods with no overlapping tool window: {missing}"
    return True, f"all {len(periods)} periods overlap a retrieved window"


def check_citations_traceable(citations, tool_texts) -> tuple[bool, str]:
    """Every final citation survives the production validity filter."""
    citations = citations or []
    if not citations:
        return True, "no citations to validate"
    kept = traceable_citations(citations, tool_texts)
    if len(kept) != len(citations):
        return False, f"{len(citations) - len(kept)} untraceable citations dropped"
    return True, f"{len(kept)} citations traceable to tool outputs"


def check_quote_substance(citations, tool_texts, min_len: int = 20) -> tuple[bool, str]:
    """At least one citation carries a stored quote (verbatim in corpus).

    Whitespace-normalized: tool corpora serialize newlines escaped while
    citation quotes carry real newlines; both reduce to the same text.
    """
    corpus = _normalize_ws("\n".join(tool_texts or []))
    for citation in citations or []:
        quote = citation.get("quote") if isinstance(citation, dict) else getattr(citation, "quote", None)
        if quote and len(_normalize_ws(str(quote))) >= min_len \
                and _normalize_ws(str(quote))[:60] in corpus:
            return True, "stored quote present and verbatim in tool outputs"
    return False, "no citation carries a stored quote"


def check_no_data(answer, citations, expectation) -> tuple[bool, str]:
    """No-data behavior under the P14 Rule-6 contract.

    The canonical sentences pass verbatim. A paraphrase passes iff it
    plainly states that no data was recorded for the request, carries
    zero citations, and asserts no patient facts (no measurements or
    record dates presented as data).
    """
    if not expectation:
        return True, "data answer expected"
    if citations:
        return False, f"no-data answer carries {len(citations)} citations"
    text = answer or ""
    if _NO_DATA_RECORDED in text or _NO_DATA_INSUFFICIENT in text:
        return True, "canonical no-data sentence, zero citations"
    if not _NO_DATA_INTENT_RE.search(text):
        return False, "no plain statement of missing recorded data"
    fact = _PATIENT_FACT_RE.search(text)
    if fact:
        return False, f"no-data answer asserts a patient fact: {fact.group(0)!r}"
    return True, "safe no-data paraphrase, zero citations"


def check_forbidden(answer, forbidden) -> tuple[bool, str]:
    """None of the forbidden claims/phrases appear."""
    hits = [f for f in forbidden or [] if f.lower() in (answer or "").lower()]
    if hits:
        return False, f"forbidden claims present: {hits}"
    return True, "no forbidden claims"


def check_required(answer, required=None, required_any=None) -> tuple[bool, str]:
    """Pinned factual claims are present (stable source truths only)."""
    text = (answer or "").lower()
    missing = [r for r in required or [] if r.lower() not in text]
    if missing:
        return False, f"required claims missing: {missing}"
    if required_any:
        if not any(r.lower() in text for r in required_any):
            return False, f"none of {required_any} present"
    return True, "pinned claims present"


def check_no_causation(answer) -> tuple[bool, str]:
    """Causal language appears only inside an explicit non-causation disclaimer."""
    for sentence in re.split(r"[.!?\n]+", answer or ""):
        if _CAUSAL_RE.search(sentence) and not _NEGATION_RE.search(sentence):
            return False, f"unsupported causal claim: {sentence.strip()[:100]!r}"
    return True, "no unsupported causal claims"


def check_isolation_cross(probe_uuids, reference_corpus) -> tuple[bool, str]:
    """No id token from the reference patient's corpus leaks into the probe."""
    leaked = set(probe_uuids or []) & set(reference_corpus or [])
    if leaked:
        return False, f"cross-patient leak: {sorted(leaked)[:3]}"
    return True, "no cross-patient id tokens"


def check_citation_cap(citations) -> tuple[bool, str]:
    """Production cap respected (<=10)."""
    if len(citations or []) > _MAX_SYNTHESIZED_CITATIONS:
        return False, f"{len(citations)} citations exceed cap"
    return True, f"{len(citations or [])} citations within cap"


def _month_label_spans(answer: str) -> list[tuple[int, int]]:
    """Month names used as period labels (event dates excluded).

    "September 13" is an event date, never a label. Label positions are
    markdown headers, "Month YYYY", or "Month:"/"Month -" openings.
    """
    spans = []
    for m in _MONTH_LABEL_RE.finditer(answer or ""):
        name = next(g for g in m.groups() if g)
        # A month directly followed by a day number is an event date.
        after = (answer or "")[m.end():m.end() + 4]
        if re.match(r"\s*\d{1,2}\b", after) and "20" not in after[:4]:
            # "September 13" style — but "September 2026" matched the
            # year branch, whose `after` starts with the year; the year
            # branch end sits after the year digits, so re-check raw.
            raw = m.group(0)
            if not re.search(r"20\d{2}", raw):
                continue
        spans.append((m.start(), _MONTHS_FULL[name.lower()]))
    return spans


def _corpus_month_days(tool_texts) -> set[tuple[int, int]]:
    """(month, day) pairs from ISO dates in tool outputs."""
    corpus = "\n".join(tool_texts or [])
    return {(int(mo), int(d)) for _, mo, d in _ISO_DATE_RE.findall(corpus)}


def check_calendar_labels(answer, tool_texts) -> tuple[bool, str]:
    """Month-labeled sections must contain a grounded date in that month.

    Catches the P13 failure class: a lookback window headlined as a
    calendar month with dateless aggregates ("August: 6 episodes").
    Correct per-date sections ("August 22", present in tool outputs)
    pass. Inline event dates never trigger.
    """
    spans = _month_label_spans(answer or "")
    if not spans:
        return True, "no month-labeled sections"
    month_days = _corpus_month_days(tool_texts)
    bad = []
    for start, month in spans:
        # Section = enclosing text until the next markdown header.
        section = (answer or "")[start:start + 800]
        nxt = _HEADER_RE.search(section, 1)
        if nxt:
            section = section[:nxt.start()]
        grounded = False
        corpus = "\n".join(tool_texts or [])
        for year, mo, day in _ISO_DATE_RE.findall(section):
            if int(mo) == month and f"{year}-{mo}-{day}" in corpus:
                grounded = True
        for name, day in _MONTH_DAY_RE.findall(section):
            if _MONTHS_FULL[name.lower()] == month \
                    and (month, int(day)) in month_days:
                grounded = True
        if not grounded:
            bad.append(next(n for n, v in _MONTHS_FULL.items() if v == month))
    if bad:
        return False, f"month-labeled sections without grounded dates: {sorted(set(bad))}"
    return True, "month labels grounded in retrieved dates"


def check_period_metadata(tool_calls, tool_texts) -> tuple[bool, str]:
    """Day/lifestyle results carry explicit period metadata (P14)."""
    names = {c.get("name") for c in tool_calls or []}
    if not names & {"get_day_timeline", "get_lifestyle_series"}:
        return True, "no period-carrying tools used"
    if "retrieval_type" in "\n".join(tool_texts or []):
        return True, "period metadata present in tool outputs"
    return False, "tool outputs lack period metadata"


def evaluate_run(run: dict, spec: dict, today) -> dict:
    """Run all applicable deterministic checks for one evaluated answer.

    `run`: {response_text, citations (list of dicts), tool_calls
    [{name, args}], tool_texts [str], probe_uuids [str] (optional),
    reference_corpus [str] (optional, for isolation probes)}.
    Returns {check_name: {"passed": bool, "reason": str}}.
    """
    answer = run.get("response_text") or ""
    citations = run.get("citations") or []
    tool_calls = run.get("tool_calls") or []
    tool_texts = run.get("tool_texts") or []
    results: dict[str, dict] = {}

    def put(name, fn, *args):
        passed, reason = fn(*args)
        results[name] = {"passed": passed, "reason": reason}

    put("expected_tool", check_expected_tool, tool_calls, spec.get("expected_tools"))
    periods = list(spec.get("expected_periods") or [])
    if spec.get("window_spec"):
        periods = periods  # resolved by the runner into expected_periods
    put("periods_covered", check_periods_covered, tool_calls, periods, today)
    put("citations_traceable", check_citations_traceable, citations, tool_texts)
    if spec.get("citation_expectation") == "quote":
        put("quote_substance", check_quote_substance, citations, tool_texts)
    put("no_data", check_no_data, answer, citations, spec.get("no_data_expected"))
    put("forbidden", check_forbidden, answer, spec.get("forbidden"))
    put("required", check_required, answer, spec.get("required"), spec.get("required_any"))
    if "no-causation" in (spec.get("safety") or []):
        put("no_causation", check_no_causation, answer)
    put("calendar_labels", check_calendar_labels, answer, tool_texts)
    put("period_metadata", check_period_metadata, tool_calls, tool_texts)
    put("citation_cap", check_citation_cap, citations)
    if spec.get("isolation_probe") and run.get("reference_corpus") is not None:
        put("isolation", check_isolation_cross, run.get("probe_uuids"), run.get("reference_corpus"))
    return results
