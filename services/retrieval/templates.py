"""P0 allow-listed graph traversal templates.

Every template here obeys the traversal security rules:
1. Only relationship types in ALLOWED_TRAVERSAL_RELS, direction-fixed.
2. The patient binding `p` (`{id: $patient_id}`) is present and carried
   through every WITH clause.
3. Shared labels (TERMINAL_LABELS) are collected but never traversed through.
4. No variable-length traversals except CONTAINS* on the global anatomy
   hierarchy (reference data with no patient edges).
5. Neo4j returns routing IDs; PostgreSQL hydration happens in hydrate.py.

check_cypher_safety() statically enforces these invariants and is asserted
in tests/test_p0_graph_foundation.py for every registered template.
"""
import re
from dataclasses import dataclass

# Patient-owned (outgoing from Patient) + observation/event-owned (outgoing
# from patient-owned nodes). This is the complete P0 allow-list: any Cypher
# outside this set must go through design review before persisting/reading.
ALLOWED_TRAVERSAL_RELS = frozenset(
    {
        "HAS_OBSERVATION",
        "HAS_TIMELINE_EVENT",
        "ACTIVE_MEDICATION",
        "HAS_MEDICATION_TAKEN",
        "AFFECTS",
        "SOURCE_DOCUMENT",  # legacy, dual-written with DOCUMENTED_IN in P0
        "DOCUMENTED_IN",  # P0 canonical provenance link
        "LOGGED_ON",  # legacy, superseded by OCCURRED_DURING in P1
        "TAKEN_FROM",
        "HAS_CODE",  # P0 Concept-lite, flag-gated on write
        "CONTAINS",  # global anatomy hierarchy only
        # P1 clinical graph expansion (all patient-scoped, WITH p carried).
        "HAS_CONDITION",
        "HAS_VISIT",
        "HAS_STATEMENT",
        "HAS_MEDICATION_REQUEST",
        "PRESCRIBES",
        "PRESCRIBED_FOR",  # only from explicit PG purpose evidence
        "REASON_STATED_BY_PATIENT",  # USER_REPORTED, never a diagnosis
        "ABOUT",
        "RESULTS_FROM",
        "OCCURRED_DURING",
        # P2 measurement split + regimen version history.
        "HAS_MEASUREMENT",
        "HAS_VERSION",
        "SUPERSEDES",
        # P3 longitudinal personal-health domains (all patient-scoped,
        # WITH p carried; user-reported evidence, never clinical facts).
        "HAS_SLEEP",
        "HAS_ACTIVITY",
        "HAS_NUTRITION",
        "HAS_FOOD_SCAN",
        "HAS_ENTRY",
        "HAS_BIOMETRIC",
        # P9 temporal containers (patient-scoped Day nodes; Day id embeds
        # patient_id so no shared/global Day can bridge patients).
        "HAS_DAY",
        "HAS_EVENT",
    }
)

# Shared reference labels: terminal for traversal. A query may END at these
# nodes but must never continue through them into other patients' data.
# P10: Medication joins the set — canonical Medication nodes are shared by
# norm_key across patients (proven live: P10A–TAKEN_FROM→ shared
# Medication{norm_key:'vitamin d'} ←TAKEN_FROM–P9A bridges in 3 hops),
# while every registered template only ever ENDS at them (verified by
# test). MedicationRequest stays OUT: it is MERGEd by globally-unique
# medication id, hence patient-unique in practice, and P1 templates
# legitimately traverse (req)-[:PRESCRIBED_FOR]->(own condition).
TERMINAL_LABELS = frozenset({"AnatomicalStructure", "Concept", "Medication"})

_REL_TYPE_RE = re.compile(r"\[:([A-Z_*| ]+)\]")
_VARLEN_RE = re.compile(r"\*[\d.]*\]")
_WITH_RE = re.compile(r"^\s*WITH\s", re.IGNORECASE | re.MULTILINE)
# P15 / D2: direction-agnostic terminal detection.
#
# The original pattern only matched an OUTGOING edge from a terminal label
# (`(m:Medication)-[:REL]->(x)`). The realistic cross-patient bridge in this
# schema arrives at the shared node instead:
#
#     (e1)-[:TAKEN_FROM]->(m:Medication)<-[:TAKEN_FROM]-(e2)
#
# i.e. the edge leaving the terminal node is written with the `<-[:REL]-`
# arrow, which the outgoing-only regex never saw — so the bridge that was
# "flagged" in tests was not the bridge that actually exists live. Both
# directions are now violations, with the CONTAINS carve-out preserved.
_TERMINAL_EDGE_RE = re.compile(
    r"\(([a-zA-Z_][a-zA-Z0-9_]*:([A-Za-z]+))(?:\s*\{[^{}]*\})?\)"
    r"(-\[[^\]]*\]->|<-\[[^\]]*\]-)"
)


def check_cypher_safety(cypher: str) -> list[str]:
    """Return a list of traversal-safety violations (empty = safe)."""
    violations: list[str] = []
    if "$patient_id" not in cypher:
        violations.append("missing $patient_id binding")
    if "(p:Patient" not in cypher:
        violations.append("missing (p:Patient ...) anchor")
    rel_names: set[str] = set()
    for group in _REL_TYPE_RE.findall(cypher):
        for name in group.split("|"):
            name = name.strip().rstrip("*0123456789. ")
            if name:
                rel_names.add(name)
    unknown = rel_names - ALLOWED_TRAVERSAL_RELS
    if unknown:
        violations.append(f"non-allow-listed relationship types: {sorted(unknown)}")
    for m in _VARLEN_RE.finditer(cypher):
        start = cypher.rfind("[", 0, m.start())
        segment = cypher[start : m.end()]
        if "CONTAINS" not in segment:
            violations.append(f"variable-length traversal outside CONTAINS: {segment}")
    # Undirected full expansion is only acceptable post-verification on
    # patient-owned nodes; new templates must not introduce it.
    if re.search(r"\(\w+\)-\[r\]-\(\w+\)", cypher):
        violations.append("undirected (target)-[r]-(connected) expansion")
    # P10: shared reference nodes are terminal — a template may end at
    # them but must never traverse OUT of them into other patients.
    # CONTAINS is carved out: it runs only on the global anatomy
    # hierarchy, which carries no patient edges by construction.
    for m in _TERMINAL_EDGE_RE.finditer(cypher):
        if m.group(2) in TERMINAL_LABELS and "CONTAINS" not in m.group(0):
            violations.append(
                f"traversal through terminal label {m.group(2)}: {m.group(0)[:80]}"
            )
    return violations


@dataclass(frozen=True)
class GraphTemplate:
    template_id: str
    description: str
    cypher: str


CYPHER_OBS_FOR_STRUCTURE = """
MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(o:Observation)-[:AFFECTS]->(struct:AnatomicalStructure)
MATCH (target:AnatomicalStructure {id: $structure_id})-[:CONTAINS*0..]->(struct)
RETURN DISTINCT o.id AS observation_id
"""

CYPHER_OBS_FOR_STRUCTURE_EXACT = """
MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(o:Observation)-[:AFFECTS]->(struct:AnatomicalStructure {id: $structure_id})
RETURN DISTINCT o.id AS observation_id
"""

# P0 fix vs agents/tools/timeline.py: the LOGGED_ON hop is now bound to the
# authenticated patient's own observations (previously unscoped).
CYPHER_TIMELINE = """
MATCH (p:Patient {id: $patient_id})-[:HAS_TIMELINE_EVENT]->(t:TimelineEvent)
OPTIONAL MATCH (p)-[:HAS_OBSERVATION]->(o:Observation)-[:LOGGED_ON]->(t)
RETURN
    t.id AS event_id,
    t.level_number AS level_number,
    COALESCE(t.event_time, t.date) AS event_date,
    t.event_type AS event_type,
    t.source_type AS source_type,
    t.verification_status AS verification_status,
    t.polarity AS polarity,
    t.experiencer AS experiencer,
    collect(DISTINCT o.id) AS observation_ids
ORDER BY t.level_number DESC, COALESCE(t.event_time, t.date) DESC, t.id DESC
LIMIT $limit
"""

CYPHER_MEDICATIONS_FOR_PATIENT = """
MATCH (p:Patient {id: $patient_id})-[:ACTIVE_MEDICATION]->(m:Medication)
RETURN DISTINCT m.id AS medication_id
"""

CYPHER_TAKEN_FOR_MEDICATION = """
MATCH (p:Patient {id: $patient_id})-[:HAS_MEDICATION_TAKEN]->(e:MedicationTakenEvent)-[:TAKEN_FROM]->(m:Medication {id: $medication_id})
RETURN e.id AS taken_event_id
ORDER BY e.id DESC
LIMIT $limit
"""

CYPHER_EVIDENCE_CHAIN_FOR_OBSERVATION = """
MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(o:Observation {id: $observation_id})
OPTIONAL MATCH (o)-[:SOURCE_DOCUMENT]->(d1:Document)
OPTIONAL MATCH (o)-[:DOCUMENTED_IN]->(d2:Document)
OPTIONAL MATCH (o)-[:LOGGED_ON]->(t:TimelineEvent)
OPTIONAL MATCH (o)-[:HAS_CODE]->(c:Concept)
RETURN o.id AS observation_id,
       collect(DISTINCT d1.id) + collect(DISTINCT d2.id) AS document_ids,
       collect(DISTINCT t.id) AS timeline_ids,
       collect(DISTINCT {system: c.system, code: c.code}) AS concepts
LIMIT 1
"""

CYPHER_EVIDENCE_CHAIN_FOR_EVENT = """
MATCH (p:Patient {id: $patient_id})-[:HAS_TIMELINE_EVENT]->(t:TimelineEvent {id: $event_id})
OPTIONAL MATCH (o:Observation)-[:LOGGED_ON]->(t) WHERE (p)-[:HAS_OBSERVATION]->(o)
OPTIONAL MATCH (t)-[:DOCUMENTED_IN]->(d:Document)
OPTIONAL MATCH (t)-[:HAS_CODE]->(c:Concept)
WITH p, t, collect(DISTINCT o.id) AS observation_ids, collect(DISTINCT d.id) AS document_ids,
     collect(DISTINCT {system: c.system, code: c.code}) AS concepts
RETURN t.id AS event_id, observation_ids, document_ids, concepts
LIMIT 1
"""

# P1: condition detail routing — anchored at the patient's own condition;
# neighbors are collected, never traversed through.
CYPHER_CONDITION_CONTEXT = """
MATCH (p:Patient {id: $patient_id})-[:HAS_CONDITION]->(c:ConditionOccurrence {id: $condition_id})
OPTIONAL MATCH (req:MedicationRequest)-[:PRESCRIBED_FOR]->(c) WHERE (p)-[:HAS_MEDICATION_REQUEST]->(req)
OPTIONAL MATCH (s:PatientStatement)-[:ABOUT]->(c) WHERE (p)-[:HAS_STATEMENT]->(s)
OPTIONAL MATCH (c)-[:DOCUMENTED_IN]->(d:Document)
OPTIONAL MATCH (c)-[:OCCURRED_DURING]->(v:Visit)
WITH p, c, collect(DISTINCT req.id) AS request_ids, collect(DISTINCT s.id) AS statement_ids,
     collect(DISTINCT d.id) AS document_ids, collect(DISTINCT v.id) AS visit_ids
RETURN c.id AS condition_id, request_ids, statement_ids, document_ids, visit_ids
LIMIT 1
"""

# P1: visit detail routing — members re-validated as patient-owned.
CYPHER_VISIT_MEMBERS = """
MATCH (p:Patient {id: $patient_id})-[:HAS_VISIT]->(v:Visit {id: $visit_id})
OPTIONAL MATCH (n)-[:OCCURRED_DURING]->(v)
// P6: P3 lifestyle/biometric members included — every OCCURRED_DURING
// holder the projections emit, still re-validated as patient-owned.
WHERE (p)-[:HAS_OBSERVATION|HAS_TIMELINE_EVENT|HAS_CONDITION|HAS_MEDICATION_TAKEN|HAS_STATEMENT|HAS_MEASUREMENT|HAS_SLEEP|HAS_ACTIVITY|HAS_NUTRITION|HAS_FOOD_SCAN|HAS_BIOMETRIC]->(n)
RETURN v.id AS visit_id, collect(DISTINCT n.id) AS member_ids
LIMIT 1
"""

# P1: medication-request routing with reason split intact.
CYPHER_MEDICATION_REQUEST = """
MATCH (p:Patient {id: $patient_id})-[:HAS_MEDICATION_REQUEST]->(req:MedicationRequest {id: $request_id})
OPTIONAL MATCH (req)-[:PRESCRIBES]->(cm:Medication)
OPTIONAL MATCH (req)-[:PRESCRIBED_FOR]->(c:ConditionOccurrence)
OPTIONAL MATCH (req)-[:REASON_STATED_BY_PATIENT]->(s:PatientStatement)
OPTIONAL MATCH (req)-[:DOCUMENTED_IN]->(d:Document)
RETURN req.id AS request_id, cm.norm_key AS canonical_key,
       collect(DISTINCT c.id) AS condition_ids, collect(DISTINCT s.id) AS statement_ids,
       collect(DISTINCT d.id) AS document_ids
LIMIT 1
"""

# P2: longitudinal series for one measurement key, ascending by valid time.
# No materialized NEXT chains: ordering is query-time so backfilled or
# out-of-order readings can never corrupt the sequence.
CYPHER_MEASURE_TREND = """
MATCH (p:Patient {id: $patient_id})-[:HAS_MEASUREMENT]->(m:Measurement)
WHERE m.series_key = $series_key
RETURN m.id AS measurement_id,
       m.measured_at AS measured_at,
       m.value_number AS value_number,
       m.value_text AS value_text,
       m.unit AS unit,
       m.interpretation AS interpretation
ORDER BY m.measured_at ASC, m.id ASC
LIMIT $limit
"""

# P2: temporal refinement — facts grouped by visit inside a date window.
# Members re-validated as patient-owned; visits are the grouping key so
# Patient is never the connector between clinical entities.
CYPHER_VISIT_RANGE = """
MATCH (p:Patient {id: $patient_id})-[:HAS_VISIT]->(v:Visit)
WHERE v.visit_date >= $start_date AND v.visit_date <= $end_date
OPTIONAL MATCH (n)-[:OCCURRED_DURING]->(v)
WHERE (p)-[:HAS_OBSERVATION|HAS_TIMELINE_EVENT|HAS_CONDITION|HAS_MEDICATION_TAKEN|HAS_STATEMENT|HAS_MEASUREMENT|HAS_SLEEP|HAS_ACTIVITY|HAS_NUTRITION|HAS_FOOD_SCAN|HAS_BIOMETRIC]->(n)
WITH p, v, collect(DISTINCT n.id) AS member_ids
RETURN v.id AS visit_id, v.visit_date AS visit_date, v.visit_type AS visit_type, member_ids
ORDER BY v.visit_date ASC, v.id ASC
LIMIT $limit
"""

# P2: evidence chain for one measurement.
CYPHER_EVIDENCE_CHAIN_FOR_MEASUREMENT = """
MATCH (p:Patient {id: $patient_id})-[:HAS_MEASUREMENT]->(m:Measurement {id: $measurement_id})
OPTIONAL MATCH (m)-[:DOCUMENTED_IN]->(d:Document)
OPTIONAL MATCH (m)-[:HAS_CODE]->(c:Concept)
OPTIONAL MATCH (m)-[:OCCURRED_DURING]->(v:Visit)
WITH p, m, collect(DISTINCT d.id) AS document_ids,
     collect(DISTINCT {system: c.system, code: c.code}) AS concepts,
     collect(DISTINCT v.id) AS visit_ids
RETURN m.id AS measurement_id, document_ids, concepts, visit_ids
LIMIT 1
"""

# P3: sleep series, ascending by event time (USER_REPORTED readings).
CYPHER_SLEEP_TREND = """
MATCH (p:Patient {id: $patient_id})-[:HAS_SLEEP]->(s:SleepEpisode)
RETURN s.id AS episode_id,
       s.event_time AS event_time,
       s.duration_minutes AS duration_minutes,
       s.sleep_quality AS sleep_quality,
       s.awakenings AS awakenings
ORDER BY s.event_time ASC, s.id ASC
LIMIT $limit
"""

# P3: activity series, ascending by event time (USER_REPORTED readings).
CYPHER_ACTIVITY_TREND = """
MATCH (p:Patient {id: $patient_id})-[:HAS_ACTIVITY]->(a:ActivityEvent)
RETURN a.id AS activity_id,
       a.event_time AS event_time,
       a.activity_type AS activity_type,
       a.duration_minutes AS duration_minutes,
       a.calories_burned AS calories_burned
ORDER BY a.event_time ASC, a.id ASC
LIMIT $limit
"""

# P3: nutrition intakes in a date window, via day visits (visit-grouped so
# Patient is never the connector between intake facts).
CYPHER_NUTRITION_RANGE = """
MATCH (p:Patient {id: $patient_id})-[:HAS_VISIT]->(v:Visit)
WHERE v.visit_date >= $start_date AND v.visit_date <= $end_date
OPTIONAL MATCH (n:NutritionIntake)-[:OCCURRED_DURING]->(v)
WHERE (p)-[:HAS_NUTRITION]->(n)
OPTIONAL MATCH (f:FoodScan)-[:OCCURRED_DURING]->(v)
WHERE (p)-[:HAS_FOOD_SCAN]->(f)
WITH p, v, collect(DISTINCT n.id) AS intake_ids, collect(DISTINCT f.id) AS scan_ids
RETURN v.visit_date AS visit_date, intake_ids, scan_ids
ORDER BY v.visit_date ASC
LIMIT $limit
"""

# P3: biometric (PPG/rPPG) series, ascending by measured time. One label
# for both modalities; method distinguishes camera_ppg from face_rppg.
CYPHER_BIOMETRIC_TREND = """
MATCH (p:Patient {id: $patient_id})-[:HAS_BIOMETRIC]->(m:PPGMeasurement)
RETURN m.id AS measurement_id,
       m.measured_at AS measured_at,
       m.method AS method,
       m.heart_rate_bpm AS heart_rate_bpm,
       m.rmssd_ms AS rmssd_ms,
       m.sdnn_ms AS sdnn_ms,
       m.signal_quality AS signal_quality,
       m.reliable AS reliable
ORDER BY m.measured_at ASC, m.id ASC
LIMIT $limit
"""

# P3: food scans in a date window with their entries.
CYPHER_FOOD_CONTEXT = """
MATCH (p:Patient {id: $patient_id})-[:HAS_FOOD_SCAN]->(f:FoodScan)-[:HAS_ENTRY]->(e:FoodEntry)
WHERE f.recorded_at >= $start_datetime AND f.recorded_at <= $end_datetime
WITH p, f, collect(DISTINCT {id: e.id, label: e.label, kcal: e.kcal,
     corrected: e.corrected, corrected_label: e.corrected_label}) AS entries
RETURN f.id AS scan_id, f.recorded_at AS recorded_at, f.total_kcal AS total_kcal,
       f.status AS status, entries
ORDER BY f.recorded_at ASC
LIMIT $limit
"""

# P9: patient-scoped day-range retrieval. Day nodes are calendar
# containers (id "<patient_id>:<YYYY-MM-DD>"); exact event timestamps
# ride on the events and are returned alongside for precise ordering.
# Covers: single day (start=end), week, 30 days, 2 months, custom range.
# P10: optional domain filter ($kinds null = all kinds). Boundary rule:
# Day.date string comparison is INCLUSIVE and DAY-GRANULAR — membership
# is per calendar day; exact_time orders within, never filters.
CYPHER_DAY_RANGE = """
MATCH (p:Patient {id: $patient_id})-[:HAS_DAY]->(d:Day)
WHERE d.date >= $start_date AND d.date <= $end_date
MATCH (d)-[:HAS_EVENT]->(e)
WHERE $kinds IS NULL OR labels(e)[0] IN $kinds
WITH p, d, e
RETURN d.date AS day,
       labels(e)[0] AS kind,
       e.id AS event_id,
       COALESCE(e.event_time, e.measured_at, e.recorded_at, e.taken_at, e.visit_date) AS exact_time
ORDER BY d.date ASC, exact_time ASC, e.id ASC
LIMIT $limit
"""

# ---------------------------------------------------------------------------
# P15 / D2: tool-level Cypher.
#
# These queries are issued directly by agent tools rather than through the
# router. They previously lived inline in agents/tools/*.py, where they were
# invisible to check_cypher_safety() — the checker only ever ran over the
# TEMPLATES registry in tests, so an inline query could bypass terminal-label
# protection (e.g. traverse out of a shared Medication node into another
# patient's data) with nothing to catch it.
#
# They now live here so the single safety checker covers them, and tools
# execute them through run_patient_cypher() which re-asserts safety at
# execution time (see below).
# ---------------------------------------------------------------------------

# T-DOC-PROVENANCE (agents/tools/evidence.py): accept the legacy
# SOURCE_DOCUMENT link and the canonical DOCUMENTED_IN link, patient-anchored.
CYPHER_DOCUMENT_PROVENANCE = """
MATCH (p:Patient {id: $patient_id})
      -[:HAS_OBSERVATION]->(o:Observation)
OPTIONAL MATCH (o)-[:SOURCE_DOCUMENT]->(legacy:Document {id: $document_id})
OPTIONAL MATCH (o)-[:DOCUMENTED_IN]->(canon:Document {id: $document_id})
WITH coalesce(legacy, canon) AS d
WHERE d IS NOT NULL
RETURN d.id
LIMIT 1
"""

# T-STRUCT-CTX (agents/tools/patient_graph_context.py): anatomy topology plus
# the patient's own observations/documents/timeline levels. CONTAINS runs on
# the global anatomy hierarchy only; every patient hop is anchored on `p`.
CYPHER_STRUCTURE_CONTEXT_DESCENDANTS = """
MATCH (target:AnatomicalStructure {id: $structure_id})

CALL {
    WITH target
    OPTIONAL MATCH (target)<-[:CONTAINS*1..]-(a:AnatomicalStructure)
    RETURN collect(DISTINCT a.id) AS ancestors
}

CALL {
    WITH target
    OPTIONAL MATCH (target)-[:CONTAINS*1..]->(d:AnatomicalStructure)
    RETURN collect(DISTINCT d.id) AS descendants
}

CALL {
    WITH target, descendants
    OPTIONAL MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(o:Observation)-[:AFFECTS]->(struct:AnatomicalStructure)
    WHERE struct.id = target.id OR struct.id IN descendants
    RETURN collect(DISTINCT o) AS obs_nodes
}

CALL {
    WITH obs_nodes
    UNWIND (CASE WHEN size(obs_nodes) > 0 THEN obs_nodes ELSE [null] END) AS o
    OPTIONAL MATCH (o)-[:SOURCE_DOCUMENT]->(doc:Document)
    RETURN collect(DISTINCT doc.id) AS documents
}

CALL {
    WITH obs_nodes
    UNWIND (CASE WHEN size(obs_nodes) > 0 THEN obs_nodes ELSE [null] END) AS o
    OPTIONAL MATCH (o)-[:LOGGED_ON]->(t:TimelineEvent)
    RETURN collect(DISTINCT t.level_number) AS timeline_levels
}

RETURN 
    target.id AS structure,
    [x IN ancestors WHERE x IS NOT NULL] AS ancestors,
    [x IN descendants WHERE x IS NOT NULL] AS descendants,
    [o IN obs_nodes WHERE o IS NOT NULL | o.id] AS observations,
    [x IN documents WHERE x IS NOT NULL] AS documents,
    [x IN timeline_levels WHERE x IS NOT NULL] AS timeline_event_levels
"""

CYPHER_STRUCTURE_CONTEXT_EXACT = """
MATCH (target:AnatomicalStructure {id: $structure_id})

CALL {
    WITH target
    OPTIONAL MATCH (target)<-[:CONTAINS*1..]-(a:AnatomicalStructure)
    RETURN collect(DISTINCT a.id) AS ancestors
}

CALL {
    WITH target
    OPTIONAL MATCH (target)-[:CONTAINS*1..]->(d:AnatomicalStructure)
    RETURN collect(DISTINCT d.id) AS descendants
}

CALL {
    WITH target
    OPTIONAL MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(o:Observation)-[:AFFECTS]->(target)
    RETURN collect(DISTINCT o) AS obs_nodes
}

CALL {
    WITH obs_nodes
    UNWIND (CASE WHEN size(obs_nodes) > 0 THEN obs_nodes ELSE [null] END) AS o
    OPTIONAL MATCH (o)-[:SOURCE_DOCUMENT]->(doc:Document)
    RETURN collect(DISTINCT doc.id) AS documents
}

CALL {
    WITH obs_nodes
    UNWIND (CASE WHEN size(obs_nodes) > 0 THEN obs_nodes ELSE [null] END) AS o
    OPTIONAL MATCH (o)-[:LOGGED_ON]->(t:TimelineEvent)
    RETURN collect(DISTINCT t.level_number) AS timeline_levels
}

RETURN 
    target.id AS structure,
    [x IN ancestors WHERE x IS NOT NULL] AS ancestors,
    [x IN descendants WHERE x IS NOT NULL] AS descendants,
    [o IN obs_nodes WHERE o IS NOT NULL | o.id] AS observations,
    [x IN documents WHERE x IS NOT NULL] AS documents,
    [x IN timeline_levels WHERE x IS NOT NULL] AS timeline_event_levels
"""

# Every Cypher statement an agent tool executes, keyed by a stable id.
# TEMPLATES is folded in by ALL_CYPHER so one test covers both sets.
TOOL_CYPHER: dict[str, str] = {
    "T-OBS": CYPHER_OBS_FOR_STRUCTURE,
    "T-OBS-EXACT": CYPHER_OBS_FOR_STRUCTURE_EXACT,
    "T-TIME": CYPHER_TIMELINE,
    "T-DOC-PROVENANCE": CYPHER_DOCUMENT_PROVENANCE,
    "T-STRUCT-CTX": CYPHER_STRUCTURE_CONTEXT_DESCENDANTS,
    "T-STRUCT-CTX-EXACT": CYPHER_STRUCTURE_CONTEXT_EXACT,
}


class UnsafeCypherError(RuntimeError):
    """Raised when a statement violates the traversal safety invariants."""


def assert_cypher_safe(cypher: str, *, statement_id: str | None = None) -> None:
    """Raise UnsafeCypherError if `cypher` violates the traversal rules.

    P15 / D2 runtime gate: registration alone only protects statements the
    tests know about. Calling this at execution time means an inline or newly
    added query cannot silently bypass terminal-label protection.
    """
    violations = check_cypher_safety(cypher)
    if violations:
        label = statement_id or "<unnamed>"
        raise UnsafeCypherError(
            f"Unsafe Cypher rejected for {label}: {'; '.join(violations)}"
        )


def run_patient_cypher(session, cypher: str, parameters: dict | None = None,
                       *, statement_id: str | None = None):
    """Execute a patient-scoped statement after asserting its safety.

    All agent-tool Neo4j reads go through here so the safety invariants are
    enforced at runtime, not only in tests.
    """
    assert_cypher_safe(cypher, statement_id=statement_id)
    return session.run(cypher, **(parameters or {}))


TEMPLATES: dict[str, GraphTemplate] = {    "C-OBS": GraphTemplate("C-OBS", "observations for structure (+descendants)", CYPHER_OBS_FOR_STRUCTURE),
    "C-OBS-EXACT": GraphTemplate("C-OBS-EXACT", "observations for exact structure", CYPHER_OBS_FOR_STRUCTURE_EXACT),
    "C-TIME": GraphTemplate("C-TIME", "sequenced timeline events (P0 p-bound fix)", CYPHER_TIMELINE),
    "T-MED-REGIMEN": GraphTemplate("T-MED-REGIMEN", "medication ids for patient", CYPHER_MEDICATIONS_FOR_PATIENT),
    "T-MED-ADHERENCE": GraphTemplate("T-MED-ADHERENCE", "taken-event ids for medication", CYPHER_TAKEN_FOR_MEDICATION),
    "T-EVID-CHAIN-OBS": GraphTemplate("T-EVID-CHAIN-OBS", "evidence chain for observation", CYPHER_EVIDENCE_CHAIN_FOR_OBSERVATION),
    "T-EVID-CHAIN-EVENT": GraphTemplate("T-EVID-CHAIN-EVENT", "evidence chain for timeline event", CYPHER_EVIDENCE_CHAIN_FOR_EVENT),
    "T-COND-CTX": GraphTemplate("T-COND-CTX", "P1 condition context (requests, statements, docs, visits)", CYPHER_CONDITION_CONTEXT),
    "T-VISIT-MEMBERS": GraphTemplate("T-VISIT-MEMBERS", "P1 visit members (patient-owned only)", CYPHER_VISIT_MEMBERS),
    "T-MED-REQUEST": GraphTemplate("T-MED-REQUEST", "P1 medication request with reason split", CYPHER_MEDICATION_REQUEST),
    "T-MEASURE-TREND": GraphTemplate("T-MEASURE-TREND", "P2 longitudinal measurement series (query-time order)", CYPHER_MEASURE_TREND),
    "T-VISIT-RANGE": GraphTemplate("T-VISIT-RANGE", "P2 visit-grouped facts in a date window", CYPHER_VISIT_RANGE),
    "T-EVID-CHAIN-MEASURE": GraphTemplate("T-EVID-CHAIN-MEASURE", "P2 evidence chain for measurement", CYPHER_EVIDENCE_CHAIN_FOR_MEASUREMENT),
    "T-SLEEP-TREND": GraphTemplate("T-SLEEP-TREND", "P3 sleep series (query-time order)", CYPHER_SLEEP_TREND),
    "T-ACTIVITY-TREND": GraphTemplate("T-ACTIVITY-TREND", "P3 activity series (query-time order)", CYPHER_ACTIVITY_TREND),
    "T-NUTRITION-RANGE": GraphTemplate("T-NUTRITION-RANGE", "P3 nutrition intakes + scans via day visits", CYPHER_NUTRITION_RANGE),
    "T-BIOMETRIC-TREND": GraphTemplate("T-BIOMETRIC-TREND", "P3 PPG/rPPG series (query-time order)", CYPHER_BIOMETRIC_TREND),
    "T-FOOD-CONTEXT": GraphTemplate("T-FOOD-CONTEXT", "P3 food scans with entries in a window", CYPHER_FOOD_CONTEXT),
    "T-DAY-RANGE": GraphTemplate("T-DAY-RANGE", "P9 day-container events in a date range", CYPHER_DAY_RANGE),
}


# Everything the safety guarantee must hold over: registered read templates
# plus every statement an agent tool executes.
ALL_CYPHER: dict[str, str] = {
    **{tid: tmpl.cypher for tid, tmpl in TEMPLATES.items()},
    **TOOL_CYPHER,
}
