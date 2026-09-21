"""P9/P10 temporal range retrieval (query layer only — no business logic moved).

Groups a patient's Day-container events by calendar day for daily /
weekly / monthly / custom windows. Clinical aggregation (averages,
interpretation) stays in the application layer; this module returns
grouped records with exact event timestamps preserved.

Boundary rule (P10, contractual): Day.date string comparison is
INCLUSIVE and DAY-GRANULAR. An event belongs to a window iff its
calendar day is within [start_date, end_date]. Sub-day precision
("one second before start") is therefore decided by the event's DAY,
not its clock time: 23:59:59 on the day before start is OUT,
00:00:00 on start day is IN. exact_time orders within groups but
never filters. One consistent rule, documented and tested.
"""
import calendar
import re
import uuid
from datetime import date as _date
from datetime import timedelta as _timedelta

from services.retrieval.templates import CYPHER_DAY_RANGE

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DEFAULT_LIMIT = 500
_MAX_LIMIT = 2000

# P10 preset windows (all relative to a caller-supplied today; no
# hard-coded dates anywhere in this module).
_PRESETS_MONTHS = {
    "today": (0, 0),
    "yesterday": (1, 1),
    "last_7_days": (6, 0),
    "last_30_days": (29, 0),
}
_PRESETS_CALENDAR_MONTHS = {
    "last_2_months": 2,
    "last_6_months": 6,
}


def _shift_months(day: _date, months: int) -> _date:
    """Subtract calendar months, clamping the day (pure)."""
    total = day.year * 12 + (day.month - 1) - months
    year, month0 = divmod(total, 12)
    last = calendar.monthrange(year, month0 + 1)[1]
    return _date(year, month0 + 1, min(day.day, last))


def resolve_window(preset: str, today: _date | str | None = None) -> tuple[str, str]:
    """Resolve a preset (or 'YYYY-MM-DD:YYYY-MM-DD' custom) to (start, end).

    Presets: today, yesterday, last_7_days, last_30_days, last_2_months,
    last_6_months. All ranges INCLUSIVE on both ends (see boundary
    rule). `today` defaults to the current date; tests inject it.
    """
    if today is None:
        today = _date.today()
    elif isinstance(today, str):
        today = _date.fromisoformat(_checked_date(today, "today"))
    if preset in _PRESETS_MONTHS:
        back_start, back_end = _PRESETS_MONTHS[preset]
        start = today - _timedelta(days=back_start)
        end = today - _timedelta(days=back_end)
    elif preset in _PRESETS_CALENDAR_MONTHS:
        months = _PRESETS_CALENDAR_MONTHS[preset]
        start = _first_of_month(_shift_months(today, months - 1))
        end = today
    elif ":" in preset:
        start_s, end_s = preset.split(":", 1)
        start = _date.fromisoformat(_checked_date(start_s.strip(), "start"))
        end = _date.fromisoformat(_checked_date(end_s.strip(), "end"))
    else:
        raise ValueError(f"unknown window preset: {preset!r}.")
    if end < start:
        raise ValueError(f"end_date {end} precedes start_date {start}.")
    return (start.isoformat(), end.isoformat())


def _first_of_month(day: _date) -> _date:
    return day.replace(day=1)


def _checked_date(value: str, name: str) -> str:
    if not isinstance(value, str) or not _DATE_RE.match(value):
        raise ValueError(f"{name} must be YYYY-MM-DD, got {value!r}.")
    return value


def query_day_range(
    driver,
    patient_id: uuid.UUID | str,
    start_date: str,
    end_date: str,
    limit: int = _DEFAULT_LIMIT,
    kinds: list[str] | tuple[str, ...] | None = None,
) -> list[dict]:
    """Return [{day, events: [{kind, event_id, exact_time}]}] (P9/P10).

    Patient-scoped by construction (Day ids embed patient_id and the
    query re-anchors every hop at (p:Patient {id})). `kinds` restricts
    to domain labels (e.g. ["SleepEpisode"]); None = all kinds. Raises
    ValueError on bad dates or unknown patient id shape; LookupError is
    NOT raised for empty ranges (empty list = no data, by retrieval
    convention).
    """
    pid = str(patient_id)
    uuid.UUID(pid)  # fail fast on non-uuid patient ids
    start = _checked_date(start_date, "start_date")
    end = _checked_date(end_date, "end_date")
    if end < start:
        raise ValueError(f"end_date {end} precedes start_date {start}.")
    bounded = max(1, min(int(limit or _DEFAULT_LIMIT), _MAX_LIMIT))
    kind_list = sorted(set(kinds)) if kinds is not None else None

    with driver.session() as session:
        rows = session.run(
            CYPHER_DAY_RANGE,
            patient_id=pid,
            start_date=start,
            end_date=end,
            limit=bounded,
            kinds=kind_list,
        ).data()

    grouped: dict[str, list[dict]] = {}
    seen: set[tuple[str, str]] = set()
    for row in rows:
        # Deliberate duplicate-path prevention (P10): the traversal is
        # single-path, but any future join across legacy + Day edges
        # could repeat (day, event). Exact dupes collapse; distinct days
        # sharing an event id never collapse (see correction-move tests).
        key = (row["day"], row["event_id"])
        if key in seen:
            continue
        seen.add(key)
        grouped.setdefault(row["day"], []).append(
            {
                "kind": row["kind"],
                "event_id": row["event_id"],
                "exact_time": row["exact_time"],
            }
        )
    return [
        {"day": day, "events": grouped[day]}
        for day in sorted(grouped)
    ]


def _iso_week_key(day: str) -> str:
    ymd = _date.fromisoformat(day)
    iso_year, iso_week, _ = ymd.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def group_records(
    day_groups: list[dict], granularity: str = "day"
) -> list[dict]:
    """Regroup day-grouped records by day/week/month (P10, pure).

    Week = ISO week ("2026-W38"); month = "YYYY-MM". Exact timestamps
    stay on the events underneath; grouping never replaces them.
    """
    if granularity == "day":
        return day_groups
    if granularity not in ("week", "month"):
        raise ValueError(f"granularity must be day|week|month, got {granularity!r}.")
    keyed: dict[str, list[dict]] = {}
    order: dict[str, str] = {}
    for group in day_groups:
        key = _iso_week_key(group["day"]) if granularity == "week" else group["day"][:7]
        keyed.setdefault(key, []).append(group)
        order.setdefault(key, group["day"])
    return [
        {"period": key, "start_day": order[key], "days": keyed[key]}
        for key in sorted(keyed, key=lambda k: order[k])
    ]


def classify_window(start_iso: str, end_iso: str) -> dict:
    """Classify an explicit (start, end) range for answer-context labels (pure).

    Returns {"retrieval_type", "label"} where retrieval_type is one of:
    - "single_day": start == end.
    - "calendar_month": exactly one full calendar month (1st..last).
    - "explicit_range": anything else (label is the date span, never a
      month name — a lookback or custom span must not be renamed into
      a calendar month by the synthesizer).
    """
    start = _date.fromisoformat(_checked_date(start_iso, "start"))
    end = _date.fromisoformat(_checked_date(end_iso, "end"))
    if end < start:
        raise ValueError(f"end_date {end} precedes start_date {start}.")
    if start == end:
        return {"retrieval_type": "single_day",
                "label": start.isoformat()}
    last_day = calendar.monthrange(start.year, start.month)[1]
    if (start.day == 1 and end == _date(start.year, start.month, last_day)):
        return {"retrieval_type": "calendar_month",
                "label": start.strftime("%B %Y")}
    return {"retrieval_type": "explicit_range",
            "label": f"{start.isoformat()} to {end.isoformat()}"}
