"""P5 lightweight deterministic router (pure function, no LLM, no I/O).

Maps a user question to SUGGESTED retrieval tools. This is advisory only:
the orchestrator keeps free LLM tool choice for ambiguous multi-domain
questions; the router output is appended as a hint, never enforced. Every
mapping is unit-tested here so routing expectations are explicit.

Suggested tools must already exist in agents/orchestrator.py tools[].
"""
import re

_MEDICATION_RE = re.compile(
    r"\b(medicat|medicine|pill|dose|dosage|prescrib|prescription|taking this|take this|adherence|missed dose|refill)\b",
    re.IGNORECASE,
)
_MEASUREMENT_RE = re.compile(
    r"\b(blood pressure|bp\b|glucose|cholesterol|weight|hrv|spo2|oxygen|temperature|lab|labs|test result|trend|higher|lower|increas|decreas|chang\w* (over|in)|over time)\b",
    re.IGNORECASE,
)
_LIFESTYLE_RE = re.compile(
    r"\b(sleep|slept|insomnia|activity|exercise|walk|steps|running|workout|food|meal|ate|eating|calori|nutrition|diet|water|hydrat|heart rate|hr\b|ppg|rppg|pulse)\b",
    re.IGNORECASE,
)
_WINDOW_RE = re.compile(
    r"\b(around|when i started|since starting|after starting|before|during|same (day|time|visit|week)|change[sd]? (around|after|since)|what happened)\b",
    re.IGNORECASE,
)
_EVIDENCE_RE = re.compile(
    r"\b(evidence|support|confirm|suspicion|suspect|diagnos|condition|why\b.*(have|got)|report|reported|document|snippet|quote|source)\b",
    re.IGNORECASE,
)
_DAYLOG_RE = re.compile(
    r"\b(what did i log|logged on|log on|that day|check.?in|journal|note wrote)\b",
    re.IGNORECASE,
)
# P11: temporal-window wording routes to the Day-backed timeline tool.
# Purely advisory like every other mapping below; the LLM keeps free
# tool choice. Matches explicit windows, not bare domain words.
_TEMPORAL_RE = re.compile(
    r"\b(today|yesterday|this week|last week|this month|last month|"
    r"last\s+\d+\s+(days?|weeks?|months?)|past\s+\d+\s+(days?|weeks?|months?)|"
    r"2 months|6 months|timeline|recent|what happened|everything that happened)\b",
    re.IGNORECASE,
)

# P13: comparative temporal wording (general patterns, never
# question-specific strings). Resolved by resolve_comparison_windows
# into two explicit (start, end) periods for per-period Day-timeline
# retrieval. Advisory: the router only suggests get_day_timeline
# first; the agent keeps free tool choice.
_COMPARE_SIGNAL_RE = re.compile(
    r"\b(vs\.?|versus|compared?\s+(with|to)|comparison|"
    r"between\s+.+?\s+and\s+|before\s+and\s+after|"
    r"change[sd]?\s+(over|between)|over\s+time)\b",
    re.IGNORECASE,
)
_PERIOD_WORD_RE = re.compile(
    r"\b(this month|last month|this week|last week|today|yesterday)\b",
    re.IGNORECASE,
)
_ISO_DATE_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
_MONTH_DAY_RE = re.compile(
    r"\b(january|february|march|april|may|june|july|august|"
    r"september|october|november|december|jan|feb|mar|apr|jun|jul|"
    r"aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\b",
    re.IGNORECASE,
)
_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5,
    "june": 6, "july": 7, "august": 8, "september": 9, "october": 10,
    "november": 11, "december": 12, "jan": 1, "feb": 2, "mar": 3,
    "apr": 4, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "sept": 9,
    "oct": 10, "nov": 11, "dec": 12,
}


def _period_bounds(label: str, today) -> tuple[str, str] | None:
    """Resolve one period expression to an inclusive (start, end) pair."""
    from datetime import timedelta as _td

    key = label.strip().lower()
    if key == "today":
        return (today.isoformat(), today.isoformat())
    if key == "yesterday":
        d = today - _td(days=1)
        return (d.isoformat(), d.isoformat())
    if key == "this week":
        return ((today - _td(days=6)).isoformat(), today.isoformat())
    if key == "last week":
        return ((today - _td(days=13)).isoformat(), (today - _td(days=7)).isoformat())
    if key == "this month":
        return (today.replace(day=1).isoformat(), today.isoformat())
    if key == "last month":
        first_this = today.replace(day=1)
        last_prev = first_this - _td(days=1)
        return (last_prev.replace(day=1).isoformat(), last_prev.isoformat())
    m = _ISO_DATE_RE.fullmatch(label.strip())
    if m:
        return (m.group(1), m.group(1))
    m = _MONTH_DAY_RE.fullmatch(label.strip())
    if m:
        import calendar as _cal

        month = _MONTHS[m.group(1).lower()]
        year = int(m.group(3)) if m.group(3) else today.year
        last = _cal.monthrange(year, month)[1]
        day = min(int(m.group(2)), last)
        iso = f"{year:04d}-{month:02d}-{day:02d}"
        return (iso, iso)
    return None


def _find_period_exprs(text: str) -> list[str]:
    """Period expressions in textual order (words, ISO dates, Month D)."""
    found: list[tuple[int, str]] = []
    for m in _PERIOD_WORD_RE.finditer(text):
        found.append((m.start(), m.group(1)))
    for m in _ISO_DATE_RE.finditer(text):
        found.append((m.start(), m.group(1)))
    for m in _MONTH_DAY_RE.finditer(text):
        found.append((m.start(), m.group(0)))
    return [expr for _, expr in sorted(found)]


def resolve_comparison_windows(
    text: str | None, today=None,
) -> dict | None:
    """Resolve a comparative temporal question to explicit periods (pure).

    Returns None when the text carries no comparison signal. Otherwise
    returns {"periods": [{"label", "start", "end"}, ...]} with zero, one,
    or two periods:

    - "<P1> vs/versus <P2>", "compared X with/to Y", "between <P1>
      and <P2>" (period words) → the two named periods.
    - "between <date> and <date>" → NOT a comparison (single range);
      returns None so normal window handling applies.
    - "before and after <D>" → 30 days before D vs D..+30d (capped at
      today): {"periods": [...], "anchor": D}.
    - signal but no resolvable pair ("change over time") → {"periods":
      []}: comparison intent without prescribed windows; the agent
      picks per-period windows itself.
    """
    from datetime import date as _date
    from datetime import timedelta as _td

    text = (text or "").strip()
    if not text:
        return None
    if today is None:
        today = _date.today()
    elif isinstance(today, str):
        today = _date.fromisoformat(today)
    if not _COMPARE_SIGNAL_RE.search(text):
        return None
    lowered = text.lower()
    # "between <date> and <date>" is one range, not a comparison.
    iso_dates = _ISO_DATE_RE.findall(text)
    if re.search(r"\bbetween\b", lowered) and len(iso_dates) >= 2:
        return None
    anchor_m = re.search(r"before\s+and\s+after\s+(.+)$", text, re.IGNORECASE)
    if anchor_m:
        exprs = _find_period_exprs(anchor_m.group(1))
        if exprs:
            bounds = _period_bounds(exprs[0], today)
            if bounds:
                anchor = _date.fromisoformat(bounds[0])
                end_b = min(anchor + _td(days=30), today)
                return {"periods": [
                    {"label": f"before {bounds[0]}",
                     "start": (anchor - _td(days=30)).isoformat(),
                     "end": (anchor - _td(days=1)).isoformat()},
                    {"label": f"after {bounds[0]}",
                     "start": anchor.isoformat(), "end": end_b.isoformat()},
                ], "anchor": bounds[0]}
        return {"periods": []}
    exprs = _find_period_exprs(text)
    periods = []
    for expr in exprs[:2]:
        bounds = _period_bounds(expr, today)
        if bounds:
            periods.append({"label": expr, "start": bounds[0], "end": bounds[1]})
    if len(periods) == 2:
        return {"periods": periods}
    return {"periods": []}


def route_question(text: str | None) -> list[str]:
    """Return ordered suggested tool names for a question (possibly empty)."""
    text = (text or "").strip()
    if not text:
        return []
    suggested: list[str] = []
    # P13: comparison intent surfaces the Day-backed timeline first —
    # it is the source that can serve each period explicitly. Advisory
    # only; domain hints below still apply and the LLM keeps free choice.
    if resolve_comparison_windows(text) is not None:
        suggested.append("get_day_timeline")
    if _TEMPORAL_RE.search(text):
        suggested.append("get_day_timeline")
    if _WINDOW_RE.search(text):
        suggested.append("get_context_around")
    if _MEDICATION_RE.search(text):
        suggested.append("get_medication_context")
    if _EVIDENCE_RE.search(text):
        suggested.append("get_condition_evidence")
    if _DAYLOG_RE.search(text) and "get_daily_log" not in suggested:
        suggested.append("get_daily_log")
    if _LIFESTYLE_RE.search(text):
        suggested.append("get_lifestyle_series")
    if _MEASUREMENT_RE.search(text):
        suggested.append("get_measurement_trend")
    # De-duplicate preserving order.
    seen: set[str] = set()
    ordered = [t for t in suggested if not (t in seen or seen.add(t))]
    return ordered
