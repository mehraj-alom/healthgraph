"""
Health Graph API — Patient-facing endpoint for 3D health visualization.

Queries Neo4j for the authenticated patient's health graph and returns
a clean, normalized node/edge model suitable for 3D rendering.

SECURITY MODEL:
- Patient isolation is enforced server-side via Firebase authentication
- All Cypher queries are parameterized (no injection risk)
- Traversal is ownership-aware: only follows outgoing relationships from
  the patient node through specific patient-owned relationship types
- Shared AnatomicalStructure reference nodes are reachable but traversal
  cannot continue through them into another patient's data
- Node detail endpoint verifies ownership before returning data
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from neo4j.exceptions import ServiceUnavailable, SessionExpired
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from core.db import get_db
from core.neo4j_client import neo4j_driver
from models.clinical_assertion import EvidenceLevel
from models.conditions import ConditionOccurrence as _ConditionOccurrence
from models.ontology import MedicalConcept
from services.retrieval import hydrate as _hydrate
from services.retrieval.evidence import Citation, EvidenceBadge

router = APIRouter(prefix="/api/v1/health-graph", tags=["Health Graph"])


class GraphNode(BaseModel):
    id: str
    type: str
    label: str
    properties: dict = {}


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    type: str
    relationship: str
    derived: bool = False
    properties: dict = {}


class HealthGraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    total_nodes: int
    total_edges: int
    has_more: bool = False


class GraphNodeDetailResponse(BaseModel):
    node: GraphNode
    connected_nodes: list[GraphNode]
    connected_edges: list[GraphEdge]
    # P0 rich detail contract (additive): genuinely informative,
    # patient-specific payload backed by PostgreSQL source data.
    detail: Optional["NodeDetailPayload"] = None


class NodeDetailPayload(BaseModel):
    """Rich node-detail contract (P0).

    Every field is sourced from stored data (Neo4j props + PostgreSQL
    truth + evidence links). Absent data is None — never invented.
    """

    summary: Optional[str] = None
    canonical_name: Optional[str] = None
    original_text: Optional[str] = None
    structured_fields: dict = {}
    status: dict = {}
    verification: dict = {}
    timestamps: dict = {}
    relationships: list[dict] = []
    source: dict = {}
    evidence: dict = {}
    confidence: Optional[float] = None
    provenance: dict = {}
    evidence_badge: Optional[str] = None
    citations: list[Citation] = []
    # P6: surrounding-timeline linkage derived from ALREADY-FETCHED
    # connected nodes (no extra queries). Groups neighbour ids by role so
    # Node → related event → evidence → document paths are navigable
    # without inventing relations.
    linked: dict = {}


def _neo4j_unavailable() -> HTTPException:
    """P7: graph-store outage is a 503 (retryable), never a 500."""
    return HTTPException(
        status_code=503,
        detail="Health graph temporarily unavailable. Please retry shortly.",
        headers={"Retry-After": "60"},
    )


NODE_TYPE_MAP = {
    "Patient": "patient",
    "AnatomicalStructure": "body_structure",
    "Observation": "observation",
    "Document": "document",
    "TimelineEvent": "timeline_event",
    "Medication": "medication",
    "MedicationTakenEvent": "medication_taken_event",
    "Concept": "concept",
    # P1 clinical graph expansion.
    "MedicationRequest": "medication_request",
    "ConditionOccurrence": "condition_occurrence",
    "Visit": "visit",
    "PatientStatement": "patient_statement",
    # P2 measurement split + regimen versions.
    "Measurement": "measurement",
    "MedicationVersion": "medication_version",
    # P3 longitudinal personal-health domains.
    "SleepEpisode": "sleep_episode",
    "ActivityEvent": "activity_event",
    "NutritionIntake": "nutrition_intake",
    "FoodScan": "food_scan",
    "FoodEntry": "food_entry",
    "PPGMeasurement": "ppg_measurement",
}


def _node_from_raw(raw) -> GraphNode | None:
    if not raw:
        return None
    node_id = raw.get("id", "")
    label = list(raw.labels)[0] if raw.labels else "Unknown"
    node_type = NODE_TYPE_MAP.get(label, label.lower())

    # P0 Concept-lite: shared terminology nodes are keyed {system, code}
    # (never display strings). Their graph id is "system|code".
    if label == "Concept" and not node_id:
        node_id = f"{raw.get('system', '')}|{raw.get('code', '')}"
    # P1 canonical Medication: shared reference keyed by normalized drug
    # identity. Graph id is the norm_key; the UI type stays distinct from
    # patient-specific regimen nodes.
    if label == "Medication" and not node_id and raw.get("norm_key"):
        node_id = raw.get("norm_key")
        node_type = "medication_canonical"

    display_name = raw.get("display_name", "")
    finding_code = raw.get("finding_code", "")
    event_type = raw.get("event_type", "")
    name = raw.get("name", "")
    display = raw.get("display", "")
    original_text = raw.get("original_text", "")
    visit_type = raw.get("visit_type", "")
    version_number = raw.get("version_number", "")
    food_label_prop = raw.get("label", "")

    if display_name:
        lbl = display_name
    elif finding_code:
        lbl = finding_code.replace("_", " ").title()
    elif event_type:
        lbl = event_type.replace("_", " ").title()
    elif label == "FoodEntry" and food_label_prop:
        # P3: entry label with correction marker when user-corrected.
        corrected = raw.get("corrected_label", "")
        lbl = f"{food_label_prop} (corrected)" if raw.get("corrected") and corrected else food_label_prop
    elif name:
        # P2 Measurement: value-qualified label so repeated readings are
        # distinguishable without opening the node.
        unit = raw.get("unit", "")
        value_text = raw.get("value_text", "")
        if label == "Measurement" and value_text:
            lbl = f"{name} {value_text}{(' ' + unit) if unit else ''}".strip()
        else:
            lbl = name
    elif display:
        lbl = display
    elif original_text:
        # P1 PatientStatement: human-readable truncation, never the raw id.
        lbl = original_text[:60] + ("…" if len(original_text) > 60 else "")
    elif visit_type:
        lbl = f"Visit ({visit_type})"
    elif version_number != "" and label == "MedicationVersion":
        lbl = f"Regimen v{version_number}"
    elif label == "SleepEpisode":
        # P3: duration-qualified from collected fields only.
        _dur = raw.get("duration_minutes", "")
        lbl = f"Sleep {_dur} min" if _dur != "" and _dur is not None else "Sleep"
    elif label == "ActivityEvent":
        _atype = raw.get("activity_type", "")
        lbl = _atype or "Activity"
    elif label == "NutritionIntake":
        _kcal = raw.get("calories_kcal", "")
        _flabel = raw.get("food_label", "")
        if _kcal != "" and _kcal is not None:
            lbl = f"{_kcal} kcal"
        elif _flabel:
            lbl = _flabel[:60]
        else:
            lbl = "Nutrition"
    elif label == "FoodScan":
        _tkcal = raw.get("total_kcal", "")
        lbl = f"Food scan ({_tkcal} kcal)" if _tkcal != "" and _tkcal is not None else "Food scan"
    elif label == "PPGMeasurement":
        _hr = raw.get("heart_rate_bpm", "")
        _method = raw.get("method", "")
        if _hr != "" and _hr is not None:
            lbl = f"HR {_hr:g} bpm" + (f" ({_method})" if _method else "")
        else:
            lbl = "PPG session"
    elif label == "Patient":
        lbl = "You"
    else:
        lbl = label.replace("_", " ").title()

    props = {k: v for k, v in raw.items() if k != "id"}

    return GraphNode(
        id=f"{node_type}:{node_id}",
        type=node_type,
        label=lbl,
        properties=props,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# SECURITY: Ownership-aware traversal patterns
# ═══════════════════════════════════════════════════════════════════════════════
#
# The graph schema has shared AnatomicalStructure nodes (created via MERGE).
# An unrestricted双向 traversal like (p)-[*1..4]-(target) could cross:
#
#   Patient A → Observation A → Heart ← Observation B ← Patient B
#
# This would leak Patient B's data to Patient A.
#
# The fix: Only follow OUTGOING relationships from the patient through
# specific patient-owned relationship types. Never follow incoming
# relationships to Patient nodes.
#
# Patient-owned relationships (outgoing from Patient):
#   (Patient)-[:HAS_OBSERVATION]->(Observation)
#   (Patient)-[:HAS_TIMELINE_EVENT]->(TimelineEvent)
#
# Observation-owned relationships (outgoing from Observation):
#   (Observation)-[:AFFECTS]->(AnatomicalStructure)
#   (Observation)-[:SOURCE_DOCUMENT]->(Document)  [legacy, dual-written]
#   (Observation)-[:DOCUMENTED_IN]->(Document)    [P0 canonical]
#   (Observation)-[:LOGGED_ON]->(TimelineEvent)
#
# TimelineEvent-owned (P0 additions, all optional):
#   (TimelineEvent)-[:DOCUMENTED_IN]->(Document)
#   (TimelineEvent)-[:HAS_CODE]->(Concept)  [flag-gated on write]
#
# P0 allow-list (see services/retrieval/templates.py ALLOWED_TRAVERSAL_RELS):
# queries must use only these relationship types, direction-fixed, with the
# patient binding `p` carried through every WITH clause.
#
# AnatomicalStructure and Concept are TERMINAL nodes for traversal — we never
# follow relationships from them to anything else. Concept nodes are shared
# terminology reference data ({system, code} key); traversing through them
# would bridge patients (A→Concept←B leak).
# ═══════════════════════════════════════════════════════════════════════════════


@router.get("", response_model=HealthGraphResponse)
def get_health_graph(
    depth: int = Query(2, ge=1, le=4),
    limit: int = Query(100, ge=10, le=500),
    category: Optional[str] = Query(None),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    """
    Return the authenticated patient's health graph.

    SECURITY: All traversal starts from the patient node and follows
    only outgoing relationships through specific patient-owned types.
    Shared AnatomicalStructure nodes are included as reference data
    but traversal stops there — it never continues into another
    patient's data through shared anatomy nodes.
    """
    patient_id_str = str(patient_id)

    # Ownership-aware traversal: only follow outgoing relationships from patient
    # through specific relationship types. AnatomicalStructure is a terminal node.
    cypher = f"""
    MATCH (p:Patient {{id: $patient_id}})

    // Depth 1: Patient → Observations (patient owns these)
    OPTIONAL MATCH (p)-[:HAS_OBSERVATION]->(o:Observation)

    // Depth 2: Observations → AnatomicalStructures (shared reference, terminal)
    OPTIONAL MATCH (o)-[:AFFECTS]->(s:AnatomicalStructure)

    // Depth 2: Observations → Documents (patient-specific via observation ownership)
    // P0: SOURCE_DOCUMENT (legacy) + DOCUMENTED_IN (canonical) are
    // dual-written; readers accept both for migration compatibility.
    OPTIONAL MATCH (o)-[:SOURCE_DOCUMENT]->(d:Document)

    // Depth 2: Observations → Documents via P0 canonical link
    OPTIONAL MATCH (o)-[:DOCUMENTED_IN]->(dd:Document)

    // Depth 1: Patient → TimelineEvents (patient owns these)
    OPTIONAL MATCH (p)-[:HAS_TIMELINE_EVENT]->(te:TimelineEvent)

    // Depth 2: Observations → TimelineEvents (via patient's observations)
    OPTIONAL MATCH (o)-[:LOGGED_ON]->(te2:TimelineEvent)

    // Depth 2: TimelineEvents → Concepts (P0 Concept-lite, flag-gated on
    // write; shared terminology nodes, terminal for traversal)
    OPTIONAL MATCH (te)-[:HAS_CODE]->(c1:Concept)
    OPTIONAL MATCH (te2)-[:HAS_CODE]->(c2:Concept)

    // Depth 1: Patient → Medications (patient owns these; legacy path,
    // P1 dual-writes MedicationRequest alongside — see below)
    OPTIONAL MATCH (p)-[:ACTIVE_MEDICATION]->(m:Medication)

    // Depth 1: Patient → MedicationTakenEvents (patient owns these)
    OPTIONAL MATCH (p)-[:HAS_MEDICATION_TAKEN]->(e:MedicationTakenEvent)

    // Depth 2: MedicationTakenEvents → Medications (via TAKEN_FROM)
    OPTIONAL MATCH (e)-[:TAKEN_FROM]->(m2:Medication)

    // P1: Patient → MedicationRequests (regimen/order; canonical drug split)
    OPTIONAL MATCH (p)-[:HAS_MEDICATION_REQUEST]->(req:MedicationRequest)

    // P1: canonical Medication nodes via the patient's own requests
    // (shared reference, terminal for traversal — same as Concept)
    OPTIONAL MATCH (p)-[:HAS_MEDICATION_REQUEST]->(reqc:MedicationRequest)-[:PRESCRIBES]->(cmc:Medication)

    // P1: Patient → ConditionOccurrences
    OPTIONAL MATCH (p)-[:HAS_CONDITION]->(cond:ConditionOccurrence)

    // P1: Patient → Visits (encounter grouping)
    OPTIONAL MATCH (p)-[:HAS_VISIT]->(vv:Visit)

    // P1: Patient → PatientStatements (user-reported, never diagnoses)
    OPTIONAL MATCH (p)-[:HAS_STATEMENT]->(st:PatientStatement)

    // P2: Patient → Measurements (one node per reading, never collapsed)
    OPTIONAL MATCH (p)-[:HAS_MEASUREMENT]->(mm:Measurement)

    // P2: regimen version nodes via the patient's own requests
    OPTIONAL MATCH (p)-[:HAS_MEDICATION_REQUEST]->(reqv:MedicationRequest)-[:HAS_VERSION]->(ver:MedicationVersion)

    // P3: longitudinal personal-health domains (all USER_REPORTED or
    // device-derived; Visit-grouped, never a Patient-hub star)
    OPTIONAL MATCH (p)-[:HAS_SLEEP]->(sl:SleepEpisode)
    OPTIONAL MATCH (p)-[:HAS_ACTIVITY]->(act:ActivityEvent)
    OPTIONAL MATCH (p)-[:HAS_NUTRITION]->(ni:NutritionIntake)
    OPTIONAL MATCH (p)-[:HAS_FOOD_SCAN]->(fs:FoodScan)
    OPTIONAL MATCH (p)-[:HAS_FOOD_SCAN]->(fs2:FoodScan)-[:HAS_ENTRY]->(fe:FoodEntry)
    OPTIONAL MATCH (p)-[:HAS_BIOMETRIC]->(pp:PPGMeasurement)

    // Collect all patient-owned nodes (anatomy is shared reference only)
    WITH p,
         collect(DISTINCT o) AS observations,
         collect(DISTINCT s) AS structures,
         collect(DISTINCT d) AS documents,
         collect(DISTINCT dd) AS documents2,
         collect(DISTINCT te) AS timeline_events1,
         collect(DISTINCT te2) AS timeline_events2,
         collect(DISTINCT m) AS medications1,
         collect(DISTINCT e) AS medication_events,
         collect(DISTINCT m2) AS medications2,
         collect(DISTINCT c1) AS concepts1,
         collect(DISTINCT c2) AS concepts2,
         collect(DISTINCT req) AS med_requests,
         collect(DISTINCT cmc) AS canon_meds,
         collect(DISTINCT cond) AS conditions,
         collect(DISTINCT vv) AS visits,
         collect(DISTINCT st) AS statements,
         collect(DISTINCT mm) AS measurements,
         collect(DISTINCT ver) AS med_versions,
         collect(DISTINCT sl) AS sleep_eps,
         collect(DISTINCT act) AS activities,
         collect(DISTINCT ni) AS nutrition,
         collect(DISTINCT fs) AS food_scans,
         collect(DISTINCT fe) AS food_entries,
         collect(DISTINCT pp) AS ppg

    // Merge medications from both paths (lists combine in this pure WITH —
    // no aggregation here, so list concatenation is legal).
    WITH p, observations, structures, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         documents, documents2,
         timeline_events1 + timeline_events2 AS all_te,
         medications1 + medications2 AS all_meds,
         concepts1 + concepts2 AS all_concepts,
         canon_meds AS all_canon_meds

    // P1: documents linked from conditions / medication requests (patient-
    // scoped through the patient's own nodes) merge into the doc set.
    // P2: same for measurement documents.
    // GQL note: an expression alias (documents + documents2) may not appear
    // inside a later aggregation, so the extra doc sets are collected here
    // as plain collect() aliases and combined in the pure WITH below.
    OPTIONAL MATCH (p)-[:HAS_CONDITION]->(cd1:ConditionOccurrence)-[:DOCUMENTED_IN]->(cdd:Document)
    OPTIONAL MATCH (p)-[:HAS_MEDICATION_REQUEST]->(reqd:MedicationRequest)-[:DOCUMENTED_IN]->(reqdd:Document)
    OPTIONAL MATCH (p)-[:HAS_MEASUREMENT]->(mdm:Measurement)-[:DOCUMENTED_IN]->(mdd:Document)
    WITH p, observations, structures, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         all_te, all_meds, all_concepts, all_canon_meds, documents, documents2,
         collect(DISTINCT cdd) AS cdds, collect(DISTINCT reqdd) AS reqdds, collect(DISTINCT mdd) AS mdds
    WITH p, observations, structures, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         all_te, all_meds, all_concepts, all_canon_meds,
         documents + documents2 + cdds + reqdds + mdds AS all_docs2

    // Build relationship list — ONLY patient-owned relationships
    // SECURITY: Each OPTIONAL MATCH must filter NULLs before collecting.
    // When a pattern doesn't fully match, ALL bound variables become NULL,
    // so type(r) returns NULL and produces invalid GraphEdge records.
    OPTIONAL MATCH (p)-[r1:HAS_OBSERVATION]->(o2:Observation)-[r2:AFFECTS]->(s2:AnatomicalStructure)
    WHERE r1 IS NOT NULL AND r2 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         collect(DISTINCT {{source: p.id, target: o2.id, type: type(r1)}}) AS rels_patient_obs,
         collect(DISTINCT {{source: o2.id, target: s2.id, type: type(r2)}}) AS rels_obs_struct

    OPTIONAL MATCH (p)-[r3:HAS_TIMELINE_EVENT]->(te3:TimelineEvent)
    WHERE r3 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct,
         collect(DISTINCT {{source: p.id, target: te3.id, type: type(r3)}}) AS rels_patient_te

    OPTIONAL MATCH (o3:Observation)-[r4:SOURCE_DOCUMENT]->(d2:Document)
    WHERE (p)-[:HAS_OBSERVATION]->(o3) AND r4 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te,
         collect(DISTINCT {{source: o3.id, target: d2.id, type: type(r4)}}) AS rels_obs_doc

    OPTIONAL MATCH (o3b:Observation)-[r4b:DOCUMENTED_IN]->(d2b:Document)
    WHERE (p)-[:HAS_OBSERVATION]->(o3b) AND r4b IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc,
         collect(DISTINCT {{source: o3b.id, target: d2b.id, type: type(r4b)}}) AS rels_obs_doc2

    OPTIONAL MATCH (o4:Observation)-[r5:LOGGED_ON]->(te4:TimelineEvent)
    WHERE (p)-[:HAS_OBSERVATION]->(o4) AND r5 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2,
         collect(DISTINCT {{source: o4.id, target: te4.id, type: type(r5)}}) AS rels_obs_te

    OPTIONAL MATCH (p)-[r6:ACTIVE_MEDICATION]->(m3:Medication)
    WHERE r6 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te,
         collect(DISTINCT {{source: p.id, target: m3.id, type: type(r6)}}) AS rels_patient_med

    OPTIONAL MATCH (p)-[r7:HAS_MEDICATION_TAKEN]->(e2:MedicationTakenEvent)-[r8:TAKEN_FROM]->(m4:Medication)
    WHERE r7 IS NOT NULL AND r8 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         collect(DISTINCT {{source: p.id, target: e2.id, type: type(r7)}}) AS rels_patient_med_taken,
         collect(DISTINCT {{source: e2.id, target: m4.id, type: type(r8)}}) AS rels_med_taken_from

    OPTIONAL MATCH (te5:TimelineEvent)-[r9:HAS_CODE]->(cc:Concept)
    WHERE (p)-[:HAS_TIMELINE_EVENT]->(te5) AND r9 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from,
         collect(DISTINCT {{source: te5.id, target: cc.system + '|' + cc.code, type: type(r9)}}) AS rels_te_concept

    // P1 ownership edges (all patient-rooted)
    OPTIONAL MATCH (p)-[r10:HAS_MEDICATION_REQUEST]->(req2:MedicationRequest)
    WHERE r10 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept,
         collect(DISTINCT {{source: p.id, target: req2.id, type: type(r10)}}) AS rels_patient_req

    OPTIONAL MATCH (p)-[r11:HAS_CONDITION]->(cond2:ConditionOccurrence)
    WHERE r11 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req,
         collect(DISTINCT {{source: p.id, target: cond2.id, type: type(r11)}}) AS rels_patient_cond

    OPTIONAL MATCH (p)-[r12:HAS_VISIT]->(vv2:Visit)
    WHERE r12 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond,
         collect(DISTINCT {{source: p.id, target: vv2.id, type: type(r12)}}) AS rels_patient_visit

    OPTIONAL MATCH (p)-[r13:HAS_STATEMENT]->(st2:PatientStatement)
    WHERE r13 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit,
         collect(DISTINCT {{source: p.id, target: st2.id, type: type(r13)}}) AS rels_patient_stmt

    // P1 clinical edges (patient-scoped through the patient's own nodes)
    OPTIONAL MATCH (req3:MedicationRequest)-[r14:PRESCRIBES]->(cm2:Medication)
    WHERE (p)-[:HAS_MEDICATION_REQUEST]->(req3) AND r14 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt,
         collect(DISTINCT {{source: req3.id, target: cm2.norm_key, type: type(r14)}}) AS rels_req_med

    OPTIONAL MATCH (req4:MedicationRequest)-[r15:PRESCRIBED_FOR]->(cond3:ConditionOccurrence)
    WHERE (p)-[:HAS_MEDICATION_REQUEST]->(req4) AND (p)-[:HAS_CONDITION]->(cond3) AND r15 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt, rels_req_med,
         collect(DISTINCT {{source: req4.id, target: cond3.id, type: type(r15)}}) AS rels_req_cond

    OPTIONAL MATCH (req5:MedicationRequest)-[r16:REASON_STATED_BY_PATIENT]->(st3:PatientStatement)
    WHERE (p)-[:HAS_MEDICATION_REQUEST]->(req5) AND (p)-[:HAS_STATEMENT]->(st3) AND r16 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt, rels_req_med, rels_req_cond,
         collect(DISTINCT {{source: req5.id, target: st3.id, type: type(r16)}}) AS rels_req_stmt

    OPTIONAL MATCH (st4:PatientStatement)-[r17:ABOUT]->(cond4:ConditionOccurrence)
    WHERE (p)-[:HAS_STATEMENT]->(st4) AND (p)-[:HAS_CONDITION]->(cond4) AND r17 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt, rels_req_med, rels_req_cond, rels_req_stmt,
         collect(DISTINCT {{source: st4.id, target: cond4.id, type: type(r17)}}) AS rels_stmt_cond

    OPTIONAL MATCH (e3:MedicationTakenEvent)-[r18:RESULTS_FROM]->(req6:MedicationRequest)
    WHERE (p)-[:HAS_MEDICATION_TAKEN]->(e3) AND r18 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt, rels_req_med, rels_req_cond, rels_req_stmt, rels_stmt_cond,
         collect(DISTINCT {{source: e3.id, target: req6.id, type: type(r18)}}) AS rels_taken_req

    OPTIONAL MATCH (n1)-[r19:OCCURRED_DURING]->(vv3:Visit)
    WHERE (p)-[:HAS_VISIT]->(vv3) AND r19 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt, rels_req_med, rels_req_cond, rels_req_stmt, rels_stmt_cond, rels_taken_req,
         collect(DISTINCT {{source: n1.id, target: vv3.id, type: type(r19)}}) AS rels_occurred

    OPTIONAL MATCH (cond5:ConditionOccurrence)-[r20:DOCUMENTED_IN]->(d3:Document)
    WHERE (p)-[:HAS_CONDITION]->(cond5) AND r20 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt, rels_req_med, rels_req_cond, rels_req_stmt, rels_stmt_cond, rels_taken_req, rels_occurred,
         collect(DISTINCT {{source: cond5.id, target: d3.id, type: type(r20)}}) AS rels_cond_doc

    OPTIONAL MATCH (req7:MedicationRequest)-[r21:DOCUMENTED_IN]->(d4:Document)
    WHERE (p)-[:HAS_MEDICATION_REQUEST]->(req7) AND r21 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt, rels_req_med, rels_req_cond, rels_req_stmt, rels_stmt_cond, rels_taken_req, rels_occurred, rels_cond_doc,
         collect(DISTINCT {{source: req7.id, target: d4.id, type: type(r21)}}) AS rels_req_doc

    // P2 ownership edges
    OPTIONAL MATCH (p)-[r22:HAS_MEASUREMENT]->(mm2:Measurement)
    WHERE r22 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt, rels_req_med, rels_req_cond, rels_req_stmt, rels_stmt_cond, rels_taken_req, rels_occurred, rels_cond_doc, rels_req_doc,
         collect(DISTINCT {{source: p.id, target: mm2.id, type: type(r22)}}) AS rels_patient_mm

    // P2 measurement provenance + coding (patient-scoped)
    OPTIONAL MATCH (mm3:Measurement)-[r23:DOCUMENTED_IN]->(d5:Document)
    WHERE (p)-[:HAS_MEASUREMENT]->(mm3) AND r23 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt, rels_req_med, rels_req_cond, rels_req_stmt, rels_stmt_cond, rels_taken_req, rels_occurred, rels_cond_doc, rels_req_doc, rels_patient_mm,
         collect(DISTINCT {{source: mm3.id, target: d5.id, type: type(r23)}}) AS rels_mm_doc

    OPTIONAL MATCH (mm4:Measurement)-[r24:HAS_CODE]->(cc2:Concept)
    WHERE (p)-[:HAS_MEASUREMENT]->(mm4) AND r24 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt, rels_req_med, rels_req_cond, rels_req_stmt, rels_stmt_cond, rels_taken_req, rels_occurred, rels_cond_doc, rels_req_doc, rels_patient_mm, rels_mm_doc,
         collect(DISTINCT {{source: mm4.id, target: cc2.system + '|' + cc2.code, type: type(r24)}}) AS rels_mm_concept

    // P2 regimen version chains (patient-scoped through own requests)
    OPTIONAL MATCH (req8:MedicationRequest)-[r25:HAS_VERSION]->(ver2:MedicationVersion)
    WHERE (p)-[:HAS_MEDICATION_REQUEST]->(req8) AND r25 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt, rels_req_med, rels_req_cond, rels_req_stmt, rels_stmt_cond, rels_taken_req, rels_occurred, rels_cond_doc, rels_req_doc, rels_patient_mm, rels_mm_doc, rels_mm_concept,
         collect(DISTINCT {{source: req8.id, target: ver2.id, type: type(r25)}}) AS rels_req_ver

    OPTIONAL MATCH (ver3:MedicationVersion)-[r26:SUPERSEDES]->(ver4:MedicationVersion)
    WHERE (p)-[:HAS_MEDICATION_REQUEST]->(:MedicationRequest)-[:HAS_VERSION]->(ver3) AND r26 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt, rels_req_med, rels_req_cond, rels_req_stmt, rels_stmt_cond, rels_taken_req, rels_occurred, rels_cond_doc, rels_req_doc, rels_patient_mm, rels_mm_doc, rels_mm_concept, rels_req_ver,
         collect(DISTINCT {{source: ver3.id, target: ver4.id, type: type(r26)}}) AS rels_ver_sup

    // P3 ownership edges (all patient-rooted, USER_REPORTED/device domains)
    OPTIONAL MATCH (p)-[r27:HAS_SLEEP]->(sl2:SleepEpisode)
    WHERE r27 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt, rels_req_med, rels_req_cond, rels_req_stmt, rels_stmt_cond, rels_taken_req, rels_occurred, rels_cond_doc, rels_req_doc, rels_patient_mm, rels_mm_doc, rels_mm_concept, rels_req_ver, rels_ver_sup,
         collect(DISTINCT {{source: p.id, target: sl2.id, type: type(r27)}}) AS rels_patient_sleep

    OPTIONAL MATCH (p)-[r28:HAS_ACTIVITY]->(act2:ActivityEvent)
    WHERE r28 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt, rels_req_med, rels_req_cond, rels_req_stmt, rels_stmt_cond, rels_taken_req, rels_occurred, rels_cond_doc, rels_req_doc, rels_patient_mm, rels_mm_doc, rels_mm_concept, rels_req_ver, rels_ver_sup, rels_patient_sleep,
         collect(DISTINCT {{source: p.id, target: act2.id, type: type(r28)}}) AS rels_patient_act

    OPTIONAL MATCH (p)-[r29:HAS_NUTRITION]->(ni2:NutritionIntake)
    WHERE r29 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt, rels_req_med, rels_req_cond, rels_req_stmt, rels_stmt_cond, rels_taken_req, rels_occurred, rels_cond_doc, rels_req_doc, rels_patient_mm, rels_mm_doc, rels_mm_concept, rels_req_ver, rels_ver_sup, rels_patient_sleep, rels_patient_act,
         collect(DISTINCT {{source: p.id, target: ni2.id, type: type(r29)}}) AS rels_patient_ni

    OPTIONAL MATCH (p)-[r30:HAS_FOOD_SCAN]->(fs3:FoodScan)
    WHERE r30 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt, rels_req_med, rels_req_cond, rels_req_stmt, rels_stmt_cond, rels_taken_req, rels_occurred, rels_cond_doc, rels_req_doc, rels_patient_mm, rels_mm_doc, rels_mm_concept, rels_req_ver, rels_ver_sup, rels_patient_sleep, rels_patient_act, rels_patient_ni,
         collect(DISTINCT {{source: p.id, target: fs3.id, type: type(r30)}}) AS rels_patient_fs

    OPTIONAL MATCH (fs4:FoodScan)-[r31:HAS_ENTRY]->(fe2:FoodEntry)
    WHERE (p)-[:HAS_FOOD_SCAN]->(fs4) AND r31 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt, rels_req_med, rels_req_cond, rels_req_stmt, rels_stmt_cond, rels_taken_req, rels_occurred, rels_cond_doc, rels_req_doc, rels_patient_mm, rels_mm_doc, rels_mm_concept, rels_req_ver, rels_ver_sup, rels_patient_sleep, rels_patient_act, rels_patient_ni, rels_patient_fs,
         collect(DISTINCT {{source: fs4.id, target: fe2.id, type: type(r31)}}) AS rels_fs_entry

    OPTIONAL MATCH (p)-[r32:HAS_BIOMETRIC]->(pp2:PPGMeasurement)
    WHERE r32 IS NOT NULL
    WITH p, observations, structures, all_docs2, all_te, all_meds, all_concepts, all_canon_meds, medication_events, med_requests, conditions, visits, statements, measurements, med_versions, sleep_eps, activities, nutrition, food_scans, food_entries, ppg,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_doc2, rels_obs_te, rels_patient_med,
         rels_patient_med_taken, rels_med_taken_from, rels_te_concept, rels_patient_req, rels_patient_cond, rels_patient_visit, rels_patient_stmt, rels_req_med, rels_req_cond, rels_req_stmt, rels_stmt_cond, rels_taken_req, rels_occurred, rels_cond_doc, rels_req_doc, rels_patient_mm, rels_mm_doc, rels_mm_concept, rels_req_ver, rels_ver_sup, rels_patient_sleep, rels_patient_act, rels_patient_ni, rels_patient_fs, rels_fs_entry,
         collect(DISTINCT {{source: p.id, target: pp2.id, type: type(r32)}}) AS rels_patient_ppg

    RETURN p,
           [x IN observations WHERE x IS NOT NULL] AS obs_list,
           [x IN structures WHERE x IS NOT NULL] AS struct_list,
           [x IN all_docs2 WHERE x IS NOT NULL] AS doc_list,
           [x IN all_te WHERE x IS NOT NULL] AS te_list,
           [x IN all_meds WHERE x IS NOT NULL] AS med_list,
           [x IN medication_events WHERE x IS NOT NULL] AS med_taken_list,
           [x IN all_concepts WHERE x IS NOT NULL] AS concept_list,
           [x IN all_canon_meds WHERE x IS NOT NULL] AS canon_med_list,
           [x IN med_requests WHERE x IS NOT NULL] AS req_list,
           [x IN conditions WHERE x IS NOT NULL] AS cond_list,
           [x IN visits WHERE x IS NOT NULL] AS visit_list,
           [x IN statements WHERE x IS NOT NULL] AS stmt_list,
           [x IN measurements WHERE x IS NOT NULL] AS mm_list,
           [x IN med_versions WHERE x IS NOT NULL] AS ver_list,
           [x IN sleep_eps WHERE x IS NOT NULL] AS sleep_list,
           [x IN activities WHERE x IS NOT NULL] AS act_list,
           [x IN nutrition WHERE x IS NOT NULL] AS ni_list,
           [x IN food_scans WHERE x IS NOT NULL] AS fs_list,
           [x IN food_entries WHERE x IS NOT NULL] AS fe_list,
           [x IN ppg WHERE x IS NOT NULL] AS ppg_list,
           rels_patient_obs + rels_obs_struct + rels_patient_te + rels_obs_doc + rels_obs_doc2 + rels_obs_te + rels_patient_med + rels_patient_med_taken + rels_med_taken_from + rels_te_concept + rels_patient_req + rels_patient_cond + rels_patient_visit + rels_patient_stmt + rels_req_med + rels_req_cond + rels_req_stmt + rels_stmt_cond + rels_taken_req + rels_occurred + rels_cond_doc + rels_req_doc + rels_patient_mm + rels_mm_doc + rels_mm_concept + rels_req_ver + rels_ver_sup + rels_patient_sleep + rels_patient_act + rels_patient_ni + rels_patient_fs + rels_fs_entry + rels_patient_ppg AS all_rels
    LIMIT 1
    """

    try:
        with neo4j_driver.session() as session:
            result = session.run(cypher, patient_id=patient_id_str)
            record = result.single()
    except (ServiceUnavailable, SessionExpired):
        raise _neo4j_unavailable()

    if not record:
        return HealthGraphResponse(nodes=[], edges=[], total_nodes=0, total_edges=0)

    nodes = []
    seen_node_ids = set()

    # Patient node
    patient_node = _node_from_raw(record["p"])
    if patient_node:
        nodes.append(patient_node)
        seen_node_ids.add(patient_node.id)

    # Timeline events (patient-owned)
    for te in record.get("te_list", []):
        node = _node_from_raw(te)
        if node and node.id not in seen_node_ids:
            nodes.append(node)
            seen_node_ids.add(node.id)

    # Observations (patient-owned)
    for obs in record.get("obs_list", []):
        node = _node_from_raw(obs)
        if node and node.id not in seen_node_ids:
            nodes.append(node)
            seen_node_ids.add(node.id)

    # AnatomicalStructures (shared reference — included as context only)
    for s in record.get("struct_list", []):
        node = _node_from_raw(s)
        if node and node.id not in seen_node_ids:
            nodes.append(node)
            seen_node_ids.add(node.id)

    # Documents (reachable only through patient's observations)
    for d in record.get("doc_list", []):
        node = _node_from_raw(d)
        if node and node.id not in seen_node_ids:
            nodes.append(node)
            seen_node_ids.add(node.id)

    # Medications (patient-owned)
    for med in record.get("med_list", []):
        node = _node_from_raw(med)
        if node and node.id not in seen_node_ids:
            nodes.append(node)
            seen_node_ids.add(node.id)

    # MedicationTakenEvents (patient-owned)
    for med_event in record.get("med_taken_list", []):
        node = _node_from_raw(med_event)
        if node and node.id not in seen_node_ids:
            nodes.append(node)
            seen_node_ids.add(node.id)

    # Concepts (shared terminology reference — terminal for traversal,
    # included as context only; see security comment above)
    for c in record.get("concept_list", []):
        node = _node_from_raw(c)
        if node and node.id not in seen_node_ids:
            nodes.append(node)
            seen_node_ids.add(node.id)

    # P1 nodes: medication requests, conditions, visits, statements,
    # canonical medications (shared reference, terminal like Concept).
    # P2 nodes: measurements (one per reading), regimen versions.
    # P3 nodes: sleep/activity/nutrition/food/ppg domain nodes.
    for raw_list_key in ("req_list", "cond_list", "visit_list", "stmt_list", "canon_med_list",
                         "mm_list", "ver_list", "sleep_list", "act_list", "ni_list",
                         "fs_list", "fe_list", "ppg_list"):
        for raw_node in record.get(raw_list_key, []):
            node = _node_from_raw(raw_node)
            if node and node.id not in seen_node_ids:
                nodes.append(node)
                seen_node_ids.add(node.id)

    # Build a quick lookup from raw ID to node
    id_to_node: dict[str, GraphNode] = {}
    for n in nodes:
        raw_id = n.id.split(":", 1)[1] if ":" in n.id else n.id
        id_to_node[raw_id] = n

    # Build edges from relationships (before category filtering)
    edges = []
    missing_node_ids: set[str] = set()
    for rel in record.get("all_rels", []):
        if not rel:
            continue
        src_raw = rel['source']
        tgt_raw = rel['target']
        rel_type = rel.get('type')

        # Secondary safeguard: skip relationship records with null type
        # (primary fix is WHERE r IS NOT NULL in Cypher)
        if not rel_type or not src_raw or not tgt_raw:
            continue

        src_node = id_to_node.get(src_raw)
        tgt_node = id_to_node.get(tgt_raw)

        source_type = src_node.type if src_node else "unknown"
        target_type = tgt_node.type if tgt_node else "unknown"

        # Track missing nodes so we can recover them
        if not src_node:
            missing_node_ids.add(src_raw)
        if not tgt_node:
            missing_node_ids.add(tgt_raw)

        edge = GraphEdge(
            id=f"{src_raw}-{rel_type}-{tgt_raw}",
            source=f"{source_type}:{src_raw}",
            target=f"{target_type}:{tgt_raw}",
            type=rel_type,
            relationship=rel_type,
        )
        if edge not in edges:
            edges.append(edge)

    # ═══════════════════════════════════════════════════════════════════
    # Invariant: no orphan edges
    # If edges reference nodes not in nodes[], recover them from the raw
    # Cypher result lists (struct_list, doc_list, etc.)
    # ═══════════════════════════════════════════════════════════════════
    if missing_node_ids:
        # Re-scan all raw lists for missing nodes
        for raw_list_key in ['struct_list', 'doc_list', 'obs_list', 'te_list', 'concept_list', 'med_list', 'med_taken_list',
                             'req_list', 'cond_list', 'visit_list', 'stmt_list', 'canon_med_list',
                             'mm_list', 'ver_list', 'sleep_list', 'act_list', 'ni_list',
                             'fs_list', 'fe_list', 'ppg_list']:
            for raw_node in record.get(raw_list_key, []):
                if not raw_node:
                    continue
                raw_id = raw_node.get("id", "")
                if raw_id in missing_node_ids and raw_id not in id_to_node:
                    recovered = _node_from_raw(raw_node)
                    if recovered:
                        nodes.append(recovered)
                        id_to_node[raw_id] = recovered
                        missing_node_ids.discard(raw_id)

        # Fix edge types for recovered nodes
        for edge in edges:
            src_id = edge.source.split(":", 1)[1] if ":" in edge.source else edge.source
            tgt_id = edge.target.split(":", 1)[1] if ":" in edge.target else edge.target
            src_n = id_to_node.get(src_id)
            tgt_n = id_to_node.get(tgt_id)
            if src_n:
                edge.source = f"{src_n.type}:{src_id}"
            if tgt_n:
                edge.target = f"{tgt_n.type}:{tgt_id}"

    # ═══════════════════════════════════════════════════════════════════
    # Final invariant check: orphanEdges MUST be 0
    # ═══════════════════════════════════════════════════════════════════
    final_node_ids = {n.id for n in nodes}
    orphan_count = 0
    for e in edges:
        if e.source not in final_node_ids or e.target not in final_node_ids:
            orphan_count += 1
    print(f"[HealthGraphInvariant] orphanEdges={orphan_count} missingTargets={len(missing_node_ids)}")
    # Remove any remaining orphan edges
    if orphan_count > 0:
        edges = [e for e in edges if e.source in final_node_ids and e.target in final_node_ids]

    # ═══════════════════════════════════════════════════════════════════
    # Derived visualization edges. These are response-only relationships;
    # the Neo4j clinical schema remains unchanged.
    # ═══════════════════════════════════════════════════════════════════
    # Connect timeline events of the same event_type chronologically
    # (only nearest neighbor to avoid edge explosion)
    events_by_type: dict[str, list[GraphNode]] = {}
    for n in nodes:
        if n.type == 'timeline_event':
            et = n.properties.get('event_type', 'unknown')
            events_by_type.setdefault(et, []).append(n)

    for etype, evts in events_by_type.items():
        if len(evts) < 2:
            continue
        # Sort by date for chronological connection
        def _evt_sort_key(n: GraphNode) -> str:
            return n.properties.get('event_time') or n.properties.get('date') or ''
        evts_sorted = sorted(evts, key=_evt_sort_key)
        # Connect each event to its nearest chronological neighbor (max 1 edge per node)
        for i in range(len(evts_sorted) - 1):
            e1 = evts_sorted[i]
            e2 = evts_sorted[i + 1]
            edge_id = f"derived-{e1.id}-{e2.id}"
            # Avoid duplicate edges
            if not any(e.id == edge_id for e in edges):
                edges.append(GraphEdge(
                    id=edge_id,
                    source=e1.id,
                    target=e2.id,
                    type='DERIVED_SAME_TYPE',
                    relationship='DERIVED_SAME_TYPE',
                    derived=True,
                ))

    # Connect a small number of observations that share the same stored site
    # or finding type. Never infer a medical relationship from proximity.
    def _matching_property(node: GraphNode, keys: tuple[str, ...]) -> str | None:
        for key in keys:
            value = node.properties.get(key)
            if value is not None and str(value).strip():
                return str(value).strip().lower()
        return None

    def _add_limited_pairs(groups: dict[str, list[GraphNode]], relation: str, cap: int) -> None:
        for group in groups.values():
            if len(group) < 2:
                continue
            ordered = sorted(group, key=lambda n: n.properties.get('recorded_at', ''))
            for first, second in zip(ordered, ordered[1:]):
                if sum(1 for edge in edges if edge.relationship == relation and (edge.source == first.id or edge.target == first.id)) >= cap:
                    continue
                edge_id = f"derived-{relation.lower()}-{first.id}-{second.id}"
                if any(edge.id == edge_id for edge in edges):
                    continue
                edges.append(GraphEdge(
                    id=edge_id,
                    source=first.id,
                    target=second.id,
                    type=relation,
                    relationship=relation,
                    derived=True,
                ))

    observations_by_site: dict[str, list[GraphNode]] = {}
    observations_by_type: dict[str, list[GraphNode]] = {}
    for observation in (n for n in nodes if n.type == 'observation'):
        site = _matching_property(observation, ('body_site', 'body_site_name', 'anatomical_site'))
        finding_type = _matching_property(observation, ('observation_type', 'finding_code', 'type'))
        if site:
            observations_by_site.setdefault(site, []).append(observation)
        if finding_type:
            observations_by_type.setdefault(finding_type, []).append(observation)
    _add_limited_pairs(observations_by_site, 'DERIVED_SAME_BODY_SITE', 2)
    _add_limited_pairs(observations_by_type, 'DERIVED_SAME_TYPE', 2)

    # Link at most one event per event type to up to three other event types
    # for each date. This keeps daily context readable without an all-to-all web.
    events_by_day: dict[str, list[GraphNode]] = {}
    for event in (n for n in nodes if n.type == 'timeline_event'):
        timestamp = event.properties.get('event_time') or event.properties.get('date')
        if timestamp:
            day = str(timestamp)[:10]
            events_by_day.setdefault(day, []).append(event)
    for day, day_events in events_by_day.items():
        ordered = sorted(day_events, key=lambda n: str(n.properties.get('event_time') or n.properties.get('date') or ''))
        anchors: dict[str, GraphNode] = {}
        for event in ordered:
            event_type = str(event.properties.get('event_type') or 'unknown').lower()
            anchor = anchors.get(event_type)
            if anchor is None:
                anchors[event_type] = event
                continue
            if len(anchors) > 4:
                break
            edge_id = f"derived-same-day-{day}-{anchor.id}-{event.id}"
            if not any(edge.id == edge_id for edge in edges):
                edges.append(GraphEdge(
                    id=edge_id,
                    source=anchor.id,
                    target=event.id,
                    type='DERIVED_SAME_DAY',
                    relationship='DERIVED_SAME_DAY',
                    derived=True,
                    properties={'date': day},
                ))

    # ═══════════════════════════════════════════════════════════════════
    # Category filter (both nodes AND edges)
    # ═══════════════════════════════════════════════════════════════════
    if category:
        nodes = [n for n in nodes if n.type == category or n.type == 'patient']
        node_ids = {n.id for n in nodes}
        edges = [
            e for e in edges
            if e.source in node_ids and e.target in node_ids
        ]

    # ═══════════════════════════════════════════════════════════════════
    # Relevance-based selection. Required context is selected before optional
    # timeline events so event volume cannot displace the clinical chain.
    # ═══════════════════════════════════════════════════════════════════
    # Priority: patient > observation > body_structure > document > timeline_event
    # Never drop patient or observations
    type_priority = {
        'patient': 0,
        'observation': 1,
        'condition_occurrence': 1,
        'measurement': 1,
        'body_structure': 2,
        'concept': 2,
        'visit': 2,
        'document': 3,
        'medication': 3,
        'medication_request': 3,
        'medication_canonical': 3,
        'patient_statement': 3,
        'medication_taken_event': 4,
        'medication_version': 4,
        'timeline_event': 4,
        # P3 personal-health domains: day-level facts sort with documents,
        # item-level entries with timeline detail.
        'sleep_episode': 3,
        'activity_event': 3,
        'nutrition_intake': 3,
        'food_scan': 3,
        'ppg_measurement': 2,
        'food_entry': 4,
    }
    nodes.sort(key=lambda n: type_priority.get(n.type, 99))
    required_ids = {n.id for n in nodes if n.type != 'timeline_event'}
    logged_event_ids = {
        edge.target for edge in edges
        if edge.relationship == 'LOGGED_ON' and not edge.derived
    }
    required_ids.update(logged_event_ids)
    timeline_events = [n for n in nodes if n.type == 'timeline_event']
    required_events = [n for n in timeline_events if n.id in required_ids]
    optional_events = [n for n in timeline_events if n.id not in required_ids]
    optional_events.sort(key=lambda n: str(n.properties.get('event_time') or n.properties.get('date') or ''), reverse=True)
    remaining_slots = max(0, limit - len(required_ids))
    selected_events = required_events + optional_events[:remaining_slots]
    selected_ids = required_ids | {event.id for event in selected_events}

    nodes = [n for n in nodes if n.id in selected_ids]

    # Only keep edges where both endpoints are selected
    selected_node_ids = {n.id for n in nodes}
    edges = [e for e in edges if e.source in selected_node_ids and e.target in selected_node_ids]

    has_more = len(optional_events) > remaining_slots

    # ═══════════════════════════════════════════════════════════════════
    # Diagnostics
    # ═══════════════════════════════════════════════════════════════════
    by_type: dict[str, int] = {}
    for n in nodes:
        by_type[n.type] = by_type.get(n.type, 0) + 1
    by_rel: dict[str, int] = {}
    for e in edges:
        by_rel[e.relationship] = by_rel.get(e.relationship, 0) + 1
    print(f"[HealthGraph] nodes={len(nodes)} edges={len(edges)}")
    print(f"[HealthGraphSelection] patient={by_type.get('patient',0)} observations={by_type.get('observation',0)} body_structures={by_type.get('body_structure',0)} documents={by_type.get('document',0)} timeline_events={by_type.get('timeline_event',0)} requiredNodes={len(required_ids)} optionalNodes={len(optional_events)} droppedNodes={len(timeline_events) - len(selected_events)}")
    print('[HealthGraphEdges] ' + ' '.join(f'{name}={by_rel.get(name, 0)}' for name in ('HAS_OBSERVATION', 'AFFECTS', 'SOURCE_DOCUMENT', 'DOCUMENTED_IN', 'LOGGED_ON', 'HAS_TIMELINE_EVENT', 'HAS_CODE', 'HAS_CONDITION', 'HAS_VISIT', 'HAS_STATEMENT', 'HAS_MEDICATION_REQUEST', 'PRESCRIBES', 'PRESCRIBED_FOR', 'REASON_STATED_BY_PATIENT', 'ABOUT', 'RESULTS_FROM', 'OCCURRED_DURING', 'HAS_MEASUREMENT', 'HAS_VERSION', 'SUPERSEDES', 'DERIVED_SAME_TYPE', 'DERIVED_SAME_BODY_SITE', 'DERIVED_SAME_DAY')))

    return HealthGraphResponse(
        nodes=nodes,
        edges=edges,
        total_nodes=len(nodes),
        total_edges=len(edges),
        has_more=has_more,
    )


def _relationships_for_detail(connected_edges: list["GraphEdge"]) -> list[dict]:
    """Map GraphEdges to detail relationship entries with evidence levels.

    Persisted (non-derived) edges are SOURCE_FACT assertions of the link's
    existence; derived visualization overlays are SYSTEM_DERIVED heuristics.
    Polarity/negation of the underlying fact rides on the node status, not
    on the edge.
    """
    out = []
    for e in connected_edges:
        out.append(
            {
                "predicate": e.relationship,
                "target_id": e.target,
                "target_type": e.target.split(":", 1)[0] if ":" in e.target else "unknown",
                "evidence_level": (
                    EvidenceLevel.SYSTEM_DERIVED.value if e.derived else EvidenceLevel.SOURCE_FACT.value
                ),
            }
        )
    return out


def _medication_detail_payload(med, d: dict, condition_name: str | None, relationships: list[dict]) -> NodeDetailPayload:
    """Shared PG-backed detail for legacy Medication and P1 MedicationRequest.

    condition_name is the resolved purpose-condition display (P1 link);
    None when the record carries no documented reason.
    """
    dose = (
        f"{med.dose_amount:g} {med.dose_unit}"
        if med.dose_amount and med.dose_unit
        else (f"{med.strength} {med.strength_unit or ''}".strip() if med.strength else None)
    )
    taken_history = [
        {
            "taken_at": t.taken_at.isoformat() if t.taken_at else None,
            "status": t.status.value if hasattr(t.status, "value") else str(t.status),
            "dose_taken": t.dose_taken,
            "dose_unit": t.dose_unit,
        }
        for t in d["taken"][:10]
    ]
    fields: dict = {
        "display_name": med.name,
        "generic_name": med.generic_name,
        "brand_name": med.brand_name,
        "strength": med.strength,
        "strength_unit": med.strength_unit,
        "dose": dose,
        "frequency": med.frequency.value if hasattr(med.frequency, "value") else str(med.frequency),
        "scheduled_times": med.scheduled_times,
        "route": med.route.value if med.route and hasattr(med.route, "value") else (str(med.route) if med.route else None),
        "status": med.status.value if hasattr(med.status, "value") else str(med.status),
        "start_date": med.start_date.isoformat() if med.start_date else None,
        "end_date": med.end_date.isoformat() if med.end_date else None,
        "prn": med.prn,
        "adherence_rate_last_30": d["adherence_rate"],
        "taken_counts": d["taken_counts"],
        "taken_history": taken_history,
    }
    if condition_name is not None:
        fields["purpose_condition"] = condition_name
    return NodeDetailPayload(
        summary=f"{med.name} — {dose or 'dose not recorded'}",
        canonical_name=med.generic_name or med.name,
        original_text=med.instructions or med.purpose,
        structured_fields=fields,
        status={"medication_status": med.status.value if hasattr(med.status, "value") else str(med.status)},
        verification={"reason_evidence_level": d["reason_evidence_level"]},
        timestamps={
            "start_date": med.start_date.isoformat() if med.start_date else None,
            "end_date": med.end_date.isoformat() if med.end_date else None,
        },
        relationships=relationships,
        source={
            "document_id": str(med.source_document_id) if med.source_document_id else None,
            "storage_url": d["citation"].storage_url,
            "prescriber": med.prescriber,
            "purpose": med.purpose,
            "purpose_evidence_level": d["reason_evidence_level"],
        },
        evidence={"quote": d["citation"].quote},
        confidence=None,
        provenance={
            "prescriber": med.prescriber,
            "source_document_id": str(med.source_document_id) if med.source_document_id else None,
        },
        evidence_badge=d["badge"],
        citations=[d["citation"]],
    )

def _scan_cites(db, patient_id, scan_id) -> list:
    """Parent-scan citation for a food entry (guarded; never raises)."""
    try:
        d = _hydrate.hydrate_food_scan_detail(db, patient_id, scan_id)
        return [d["citation"]] if d else []
    except Exception:
        return []


def _med_cites(db, patient_id, medication_id) -> list:
    """Parent-regimen citation for a version node (guarded; never raises)."""
    try:
        d = _hydrate.hydrate_medication_detail(db, patient_id, medication_id)
        return [d["citation"]] if d else []
    except Exception:
        return []


def _build_node_detail(
    node_type: str,
    raw_id: str,
    patient_id: uuid.UUID,
    db: Session,
    main_node: GraphNode,
    connected_nodes: list[GraphNode],
    connected_edges: list["GraphEdge"],
) -> Optional[NodeDetailPayload]:
    """P0 rich detail payload backed by PostgreSQL source data.

    Returns None when PG has no corresponding row (graph-only node) — the
    caller then returns Neo4j props alone. Absent fields stay None; nothing
    is invented.
    """
    import uuid as _uuid

    relationships = _relationships_for_detail(connected_edges)
    try:
        if node_type == "observation":
            d = _hydrate.hydrate_observation_detail(db, patient_id, _uuid.UUID(raw_id))
            if not d:
                return None
            obs, event = d["observation"], d["event"]
            lab = d["lab"]
            return NodeDetailPayload(
                summary=obs.finding_display_name or obs.finding_code,
                canonical_name=d["concept_display_name"] or obs.finding_display_name,
                original_text=obs.clinical_summary or obs.source_snippet,
                structured_fields={
                    "finding_code": obs.finding_code,
                    "finding_display_name": obs.finding_display_name,
                    "observation_type": obs.observation_type.value,
                    "visual_status": obs.visual_status.value,
                    "visual_severity_score": obs.visual_severity_score,
                    "trend": obs.trend.value,
                    "lab_value": lab.value if lab else None,
                    "lab_unit": lab.unit if lab else None,
                    "reference_range": lab.reference_range if lab else None,
                    "abnormal_flag": lab.abnormal_flag if lab else None,
                },
                status={
                    "polarity": obs.polarity or (event.polarity if event else None),
                    "experiencer": obs.experiencer,
                    "clinical_status": event.clinical_status if event else None,
                },
                verification={
                    "verification_status": event.verification_status.value if event else None,
                    "source_type": obs.source_type.value,
                },
                timestamps={
                    "recorded_at": obs.recorded_at.isoformat() if obs.recorded_at else None,
                    "ingested_at": obs.ingested_at.isoformat() if obs.ingested_at else None,
                    "event_time": event.event_time.isoformat() if event and event.event_time else None,
                },
                relationships=relationships,
                source={
                    "document_id": str(obs.document_id) if obs.document_id else None,
                    "storage_url": d["citation"].storage_url,
                },
                evidence={"quote": d["citation"].quote, "concept": d["concept_display_name"]},
                confidence=None,
                provenance={
                    "source_type": obs.source_type.value,
                    "source_id": obs.source_id,
                    "event_id": str(obs.event_id) if obs.event_id else None,
                    "document_id": str(obs.document_id) if obs.document_id else None,
                    "extraction_method": None,
                },
                evidence_badge=d["badge"],
                citations=[d["citation"]],
            )
        if node_type == "timeline_event":
            d = _hydrate.hydrate_event_detail(db, patient_id, _uuid.UUID(raw_id))
            if not d:
                return None
            event = d["event"]
            lab = d["lab"]
            return NodeDetailPayload(
                summary=f"{event.event_type.value} — {d['concept_display_name'] or event.event_time.isoformat()}",
                canonical_name=d["concept_display_name"] or event.event_type.value,
                original_text=(d["evidence"].extracted_text if d["evidence"] else None) or event.source_snippet,
                structured_fields={
                    "event_type": event.event_type.value,
                    "lab_value": lab.value if lab else None,
                    "lab_unit": lab.unit if lab else None,
                    "reference_range": lab.reference_range if lab else None,
                    "abnormal_flag": lab.abnormal_flag if lab else None,
                    "linked_observation_count": len(d["linked_observations"]),
                },
                status={
                    "polarity": event.polarity,
                    "experiencer": event.experiencer,
                    "clinical_status": event.clinical_status,
                },
                verification={
                    "verification_status": event.verification_status.value,
                    "source_type": event.source_type.value,
                    # P6: per-mention normalization evidence; NULL means no
                    # terminology claim was made (never force a mapping).
                    "match_confidence": event.match_confidence,
                    "match_status": event.match_status,
                },
                timestamps={
                    "event_time": event.event_time.isoformat() if event.event_time else None,
                },
                relationships=relationships,
                source={
                    "document_id": str(d["document"].document_id) if d["document"] else None,
                    "storage_url": d["citation"].storage_url,
                },
                evidence={"quote": d["citation"].quote, "concept": d["concept_display_name"]},
                confidence=event.match_confidence,
                provenance={
                    "source_type": event.source_type.value,
                    "event_id": str(event.event_id),
                    "document_id": str(d["document"].document_id) if d["document"] else None,
                    "extraction_method": None,
                },
                evidence_badge=d["badge"],
                citations=[d["citation"]],
            )
        if node_type == "medication":
            d = _hydrate.hydrate_medication_detail(db, patient_id, _uuid.UUID(raw_id))
            if not d:
                return None
            payload = _medication_detail_payload(d["medication"], d, None, relationships)
            # P2: regimen version history (PG truth; graph chains traverse it).
            payload.structured_fields["dose_history"] = _hydrate.hydrate_medication_versions(
                db, patient_id, d["medication"].medication_id
            )
            return payload
        if node_type == "document":
            d = _hydrate.hydrate_document_detail(db, patient_id, _uuid.UUID(raw_id))
            if not d:
                return None
            doc = d["document"]
            return NodeDetailPayload(
                summary=f"Document — {doc.status}",
                canonical_name=None,
                original_text=None,
                structured_fields={
                    "status": doc.status,
                    "linked_event_count": d["linked_event_count"],
                },
                status={},
                verification={},
                timestamps={"created_at": doc.created_at.isoformat() if getattr(doc, "created_at", None) else None},
                relationships=relationships,
                source={"document_id": str(doc.document_id), "storage_url": d["citation"].storage_url},
                evidence={},
                confidence=None,
                provenance={},
                evidence_badge=d["badge"],
                citations=[d["citation"]],
            )
        if node_type == "medication_request":
            # P1: the request IS the regimen row — same PG truth as the
            # legacy medication detail, framed as order + reason split.
            d = _hydrate.hydrate_medication_detail(db, patient_id, _uuid.UUID(raw_id))
            if not d:
                return None
            med = d["medication"]
            cond_name = None
            if med.purpose_condition_id:
                _cc = db.get(_ConditionOccurrence, med.purpose_condition_id)
                cond_name = _cc.name if _cc else None
            detail = _medication_detail_payload(med, d, cond_name, relationships)
            detail.summary = f"Request — {detail.summary}"
            # P2: regimen version history (PG truth; graph chains traverse it).
            detail.structured_fields["dose_history"] = _hydrate.hydrate_medication_versions(
                db, patient_id, med.medication_id
            )
            return detail
        if node_type == "condition_occurrence":
            d = _hydrate.hydrate_condition_detail(db, patient_id, _uuid.UUID(raw_id))
            if not d:
                return None
            cond = d["condition"]
            return NodeDetailPayload(
                summary=cond.display_name or cond.name,
                canonical_name=cond.display_name or cond.name,
                original_text=cond.evidence_text or cond.name,
                structured_fields={
                    "name": cond.name,
                    "terminology": cond.terminology,
                    "code": cond.code,
                    "medications_prescribed_for_it": [
                        {"medication_id": str(m.medication_id), "name": m.name} for m in d["medications"][:10]
                    ],
                    "patient_statements_about_it": [
                        {"statement_id": str(s.statement_id), "text": (s.original_text or "")[:120]}
                        for s in d["statements"][:10]
                    ],
                },
                status={
                    "polarity": cond.polarity,
                    "experiencer": cond.experiencer,
                    "clinical_status": cond.clinical_status,
                },
                verification={
                    "verification_status": cond.verification_status,
                    "assertion_verification": cond.assertion_verification,
                    "source_type": cond.source_type,
                },
                timestamps={
                    "onset_date": cond.onset_date.isoformat() if cond.onset_date else None,
                    "recorded_at": cond.recorded_at.isoformat() if cond.recorded_at else None,
                },
                relationships=relationships,
                source={
                    "document_id": str(cond.source_document_id) if cond.source_document_id else None,
                    "storage_url": d["citation"].storage_url,
                },
                evidence={"quote": d["citation"].quote},
                confidence=None,
                provenance={
                    "source_type": cond.source_type,
                    "source_event_id": str(cond.source_event_id) if cond.source_event_id else None,
                    "source_document_id": str(cond.source_document_id) if cond.source_document_id else None,
                    "source_medication_id": str(cond.source_medication_id) if cond.source_medication_id else None,
                    "extraction_method": cond.extraction_method,
                },
                evidence_badge=d["badge"],
                citations=[d["citation"]],
            )
        if node_type == "visit":
            d = _hydrate.hydrate_visit_detail(db, patient_id, _uuid.UUID(raw_id))
            if not d:
                return None
            visit = d["visit"]
            member_labels = [f"{n.type}: {n.label}" for n in connected_nodes[:15]]
            return NodeDetailPayload(
                summary=f"Visit — {visit.visit_date.isoformat()} ({visit.visit_type})",
                canonical_name=None,
                original_text=visit.reason,
                structured_fields={
                    "visit_type": visit.visit_type,
                    "member_count": len(connected_nodes),
                    "members": member_labels,
                    "same_day_events": d["event_count"],
                    "same_day_observations": d["observation_count"],
                },
                status={},
                verification={},
                timestamps={"visit_date": visit.visit_date.isoformat()},
                relationships=relationships,
                source={"source": visit.source},
                evidence={},
                confidence=None,
                provenance={"visit_type": visit.visit_type, "source": visit.source},
                evidence_badge=d["badge"],
                citations=[d["citation"]],
            )
        if node_type == "patient_statement":
            d = _hydrate.hydrate_statement_detail(db, patient_id, _uuid.UUID(raw_id))
            if not d:
                return None
            stmt = d["statement"]
            return NodeDetailPayload(
                summary="Patient statement",
                canonical_name=stmt.normalized_topic,
                original_text=stmt.original_text,
                structured_fields={
                    "topic": stmt.normalized_topic,
                    "about_condition": d["about_condition"].name if d["about_condition"] else None,
                    "about_medication": d["medication"].name if d["medication"] else None,
                    "speaker": stmt.speaker,
                    "source": stmt.source,
                },
                status={"experiencer": "patient"},
                verification={
                    "evidence_level": EvidenceLevel.USER_REPORTED.value,
                    "note": "Patient-stated information — not a clinically confirmed fact.",
                },
                timestamps={"recorded_at": stmt.recorded_at.isoformat() if stmt.recorded_at else None},
                relationships=relationships,
                source={},
                evidence={"quote": stmt.original_text[:300]},
                confidence=stmt.confidence,
                provenance={"speaker": stmt.speaker, "source": stmt.source,
                            "extraction_method": stmt.extraction_method},
                evidence_badge=d["badge"],
                citations=[d["citation"]],
            )
        if node_type == "medication_canonical":
            return NodeDetailPayload(
                summary=main_node.label,
                canonical_name=main_node.label,
                original_text=None,
                structured_fields={
                    "norm_key": raw_id,
                    "patient_request_count": len(connected_nodes),
                },
                status={},
                verification={"normalization": EvidenceLevel.NORMALIZED.value},
                timestamps={},
                relationships=relationships,
                source={},
                evidence={},
                confidence=None,
                provenance={},
                evidence_badge=EvidenceLevel.NORMALIZED.value,
                citations=[],
            )
        if node_type == "measurement":
            d = _hydrate.hydrate_measurement_detail(db, patient_id, _uuid.UUID(raw_id))
            if not d:
                return None
            m = d["measurement"]
            return NodeDetailPayload(
                summary=f"{m.name} — {m.value_text}{(' ' + m.unit) if m.unit else ''}".strip(),
                canonical_name=m.display_name or m.name,
                original_text=m.evidence_text,
                structured_fields={
                    "name": m.name,
                    "value": m.value_text,
                    "value_number": m.value_number,
                    "unit": m.unit,
                    "reference_range": m.range_text,
                    "range_low": m.range_low,
                    "range_high": m.range_high,
                    "interpretation": m.interpretation,
                    "abnormal_flag": m.abnormal_flag,
                    "method": m.method,
                    "device": m.device,
                    "series_reading_count": d["series_count"],
                    "recent_series": d["recent_series"],
                },
                status={"polarity": m.polarity, "experiencer": m.experiencer},
                verification={
                    "verification_status": m.verification_status,
                    "source_type": m.source_type,
                },
                timestamps={
                    "measured_at": m.measured_at.isoformat() if m.measured_at else None,
                    "recorded_at": m.recorded_at.isoformat() if m.recorded_at else None,
                },
                relationships=relationships,
                source={
                    "document_id": str(m.source_document_id) if m.source_document_id else None,
                    "storage_url": d["citation"].storage_url,
                },
                evidence={"quote": d["citation"].quote, "concept": m.display_name},
                confidence=None,
                provenance={
                    "source_type": m.source_type,
                    "method": m.method,
                    "source_event_id": str(m.source_event_id) if m.source_event_id else None,
                    "source_document_id": str(m.source_document_id) if m.source_document_id else None,
                },
                evidence_badge=d["badge"],
                citations=[d["citation"]],
            )
        if node_type == "medication_version":
            # P2: version rows are patient-scoped PG truth; the graph only
            # routes (Request-HAS_VERSION->Version-SUPERSEDES->Version).
            from models.medication_versions import MedicationVersion as _MedVer

            try:
                ver = db.scalar(select(_MedVer).where(_MedVer.version_id == _uuid.UUID(raw_id)))
            except Exception:
                ver = None
            if ver is None or ver.patient_id != patient_id:
                return None
            snap = ver.snapshot or {}
            dose = (
                f"{snap.get('dose_amount'):g} {snap.get('dose_unit')}"
                if snap.get("dose_amount") and snap.get("dose_unit")
                else None
            )
            return NodeDetailPayload(
                summary=f"Regimen v{ver.version_number} — {snap.get('name', '')} {dose or ''}".strip(),
                canonical_name=snap.get("generic_name") or snap.get("name"),
                original_text=ver.change_reason,
                structured_fields={
                    "version_number": ver.version_number,
                    "dose": dose,
                    "frequency": snap.get("frequency"),
                    "status": snap.get("status"),
                    "snapshot": snap,
                },
                status={},
                verification={"history": EvidenceLevel.SYSTEM_DERIVED.value},
                timestamps={"recorded_at": ver.recorded_at.isoformat() if ver.recorded_at else None},
                relationships=relationships,
                source={},
                evidence={},
                confidence=None,
                provenance={"change_reason": ver.change_reason},
                evidence_badge=EvidenceLevel.SYSTEM_DERIVED,
                # P6: parent regimen citation (dose_history lives on the
                # medication/request detail; versions stay history-marked).
                citations=_med_cites(db, patient_id, ver.medication_id),
            )
        if node_type == "sleep_episode":
            d = _hydrate.hydrate_sleep_detail(db, patient_id, _uuid.UUID(raw_id))
            if not d:
                return None
            event, payload = d["event"], d["payload"]
            return NodeDetailPayload(
                summary=f"Sleep {(payload.duration_minutes if payload else None) or '?'} min",
                canonical_name="Sleep",
                original_text=None,
                structured_fields={
                    "duration_minutes": payload.duration_minutes if payload else None,
                    "sleep_quality": payload.sleep_quality if payload else None,
                    "awakenings": payload.awakenings if payload else None,
                },
                status={"experiencer": "patient"},
                verification={
                    "verification_status": event.verification_status.value,
                    "source_type": event.source_type.value,
                    "evidence_level": EvidenceLevel.USER_REPORTED.value,
                },
                timestamps={"event_time": event.event_time.isoformat() if event.event_time else None},
                relationships=relationships,
                source={},
                evidence={},
                confidence=None,
                provenance={"source_type": event.source_type.value},
                evidence_badge=d["badge"],
                citations=[d["citation"]],
            )
        if node_type == "activity_event":
            d = _hydrate.hydrate_activity_detail(db, patient_id, _uuid.UUID(raw_id))
            if not d:
                return None
            event, payload = d["event"], d["payload"]
            return NodeDetailPayload(
                summary=(payload.activity_type if payload else None) or "Activity",
                canonical_name=(payload.activity_type if payload else None),
                original_text=None,
                structured_fields={
                    "activity_type": payload.activity_type if payload else None,
                    "duration_minutes": payload.duration_minutes if payload else None,
                    "calories_burned": payload.calories_burned if payload else None,
                },
                status={"experiencer": "patient"},
                verification={
                    "verification_status": event.verification_status.value,
                    "source_type": event.source_type.value,
                    "evidence_level": EvidenceLevel.USER_REPORTED.value,
                },
                timestamps={"event_time": event.event_time.isoformat() if event.event_time else None},
                relationships=relationships,
                source={},
                evidence={},
                confidence=None,
                provenance={"source_type": event.source_type.value},
                evidence_badge=d["badge"],
                citations=[d["citation"]],
            )
        if node_type == "nutrition_intake":
            d = _hydrate.hydrate_nutrition_detail(db, patient_id, _uuid.UUID(raw_id))
            if not d:
                return None
            event, payload = d["event"], d["payload"]
            return NodeDetailPayload(
                summary=(payload.food_label if payload and payload.food_label else None)
                or (f"{payload.calories_kcal} kcal" if payload and payload.calories_kcal else "Nutrition"),
                canonical_name=(payload.food_label if payload else None),
                original_text=(payload.food_label if payload else None),
                structured_fields={
                    "water_ml": payload.water_ml if payload else None,
                    "meals_count": payload.meals_count if payload else None,
                    "appetite_level": payload.appetite_level if payload else None,
                    "calories_kcal": payload.calories_kcal if payload else None,
                    "food_label": payload.food_label if payload else None,
                },
                status={"experiencer": "patient"},
                verification={
                    "verification_status": event.verification_status.value,
                    "source_type": event.source_type.value,
                    "evidence_level": EvidenceLevel.USER_REPORTED.value,
                },
                timestamps={"event_time": event.event_time.isoformat() if event.event_time else None},
                relationships=relationships,
                source={},
                evidence={},
                confidence=None,
                provenance={"source_type": event.source_type.value},
                evidence_badge=d["badge"],
                citations=[d["citation"]],
            )
        if node_type == "food_scan":
            d = _hydrate.hydrate_food_scan_detail(db, patient_id, _uuid.UUID(raw_id))
            if not d:
                return None
            scan = d["scan"]
            return NodeDetailPayload(
                summary=f"Food scan ({scan.total_kcal} kcal)" if scan.total_kcal is not None else "Food scan",
                canonical_name=None,
                original_text=None,
                structured_fields={
                    "total_kcal": scan.total_kcal,
                    "status": scan.status,
                    "overall_confidence": scan.overall_confidence,
                    "model": scan.model,
                    "model_version": scan.model_version,
                    "meal_type": scan.meal_type,
                    "entries": [
                        {
                            "entry_id": str(e.entry_id),
                            "label": e.corrected_label if e.corrected and e.corrected_label else e.label,
                            "original_label": e.label,
                            "kcal": e.kcal,
                            "portion_g": e.portion_g,
                            "confidence": e.confidence,
                            "corrected": e.corrected,
                        }
                        for e in d["entries"]
                    ],
                },
                status={},
                verification={
                    "status": scan.status,
                    "note": "AI estimates until user-confirmed; corrections preserve the original label.",
                },
                timestamps={"recorded_at": scan.recorded_at.isoformat() if scan.recorded_at else None},
                relationships=relationships,
                source={"photo_hash": scan.photo_hash},
                evidence={},
                confidence=None,
                provenance={"model": scan.model, "model_version": scan.model_version},
                evidence_badge=d["badge"],
                citations=[d["citation"]],
            )
        if node_type == "food_entry":
            # Entries hydrate through their parent scan (patient-scoped).
            from models.food import FoodEntry as _FoodEntry

            try:
                entry = db.scalar(select(_FoodEntry).where(_FoodEntry.entry_id == _uuid.UUID(raw_id)))
            except Exception:
                entry = None
            scan = None
            if entry is not None:
                from models.food import FoodScan as _FoodScan

                scan = db.scalar(select(_FoodScan).where(
                    _FoodScan.scan_id == entry.scan_id, _FoodScan.patient_id == patient_id,
                ))
                if scan is None:
                    return None
            else:
                return None
            shown = entry.corrected_label if entry.corrected and entry.corrected_label else entry.label
            return NodeDetailPayload(
                summary=f"{shown} ({entry.kcal:g} kcal)" if entry.kcal is not None else shown,
                canonical_name=shown,
                original_text=None,
                structured_fields={
                    "label": entry.label,
                    "corrected_label": entry.corrected_label,
                    "corrected": entry.corrected,
                    "portion_g": entry.portion_g,
                    "volume_ml": entry.volume_ml,
                    "kcal": entry.kcal,
                    "protein_g": entry.protein_g,
                    "carbs_g": entry.carbs_g,
                    "fat_g": entry.fat_g,
                    "confidence": entry.confidence,
                    "fdc_id": entry.fdc_id,
                    "scan_status": scan.status,
                },
                status={},
                verification={
                    "corrected": entry.corrected,
                    "evidence_level": EvidenceLevel.USER_REPORTED.value if entry.corrected
                    else EvidenceLevel.AI_INFERRED.value,
                },
                timestamps={"recorded_at": scan.recorded_at.isoformat() if scan.recorded_at else None},
                relationships=relationships,
                source={"scan_id": str(scan.scan_id)},
                evidence={},
                confidence=entry.confidence,
                provenance={"model": scan.model, "model_version": scan.model_version},
                evidence_badge=EvidenceBadge.USER_REPORTED if entry.corrected else EvidenceBadge.AI_INFERRED,
                # P6: parent scan citation (scan holds status/model/recorded_at).
                citations=_scan_cites(db, patient_id, scan.scan_id),
            )
        if node_type == "ppg_measurement":
            d = _hydrate.hydrate_ppg_detail(db, patient_id, _uuid.UUID(raw_id))
            if not d:
                return None
            row = d["row"]
            return NodeDetailPayload(
                summary=f"HR {row.heart_rate_bpm:g} bpm ({row.measurement_type})"
                if row.heart_rate_bpm is not None else f"PPG session ({row.measurement_type})",
                canonical_name="Heart rate" if row.heart_rate_bpm is not None else "PPG session",
                original_text=None,
                structured_fields={
                    "method": row.measurement_type,
                    "heart_rate_bpm": row.heart_rate_bpm,
                    "rmssd_ms": row.rmssd_ms,
                    "sdnn_ms": row.sdnn_ms,
                    "signal_quality": row.signal_quality,
                    "reliable": row.reliable,
                    "duration_seconds": row.duration_seconds,
                    "rr_interval_count": d["rr_count"],
                    "rr_note": "Raw intervals stay in PostgreSQL; only the count projects.",
                },
                status={},
                verification={
                    "reliable": row.reliable,
                    "note": "Device-derived session scalars; HRV only when the modality supports it.",
                },
                timestamps={"measured_at": row.measured_at.isoformat() if row.measured_at else None},
                relationships=relationships,
                source={},
                evidence={},
                confidence=row.signal_quality,
                provenance={
                    "algorithm_version": row.algorithm_version,
                    "model_version": row.model_version,
                    "sampling_rate_hz": row.sampling_rate_hz,
                },
                evidence_badge=d["badge"],
                citations=[d["citation"]],
            )
        if node_type == "concept":
            system, code = raw_id.split("|", 1)
            concept = db.scalar(
                select(MedicalConcept).where(
                    MedicalConcept.terminology == system, MedicalConcept.code == code
                )
            )
            return NodeDetailPayload(
                summary=main_node.label,
                canonical_name=concept.display_name if concept else main_node.label,
                original_text=None,
                structured_fields={
                    "system": system,
                    "code": code,
                    "patient_event_count": len(connected_nodes),
                },
                status={},
                verification={"normalization": EvidenceLevel.NORMALIZED.value},
                timestamps={},
                relationships=relationships,
                source={},
                evidence={},
                confidence=None,
                provenance={"terminology": system},
                evidence_badge=EvidenceLevel.NORMALIZED.value,
                citations=[],
            )
        if node_type == "medication_taken_event":
            # P6: the only verified node type without a detail branch.
            # Composes the parent regimen's taken row (no new hydrate:
            # hydrate_medication_detail already returns taken[:30]).
            from models.medications import MedicationTakenEvent as _TakenEvent

            try:
                _taken = db.scalar(select(_TakenEvent).where(
                    _TakenEvent.event_id == _uuid.UUID(raw_id),
                    _TakenEvent.patient_id == patient_id,
                ))
            except Exception:
                _taken = None
            if _taken is None:
                return None
            _md = _hydrate.hydrate_medication_detail(db, patient_id, _taken.medication_id)
            _med_name = _md["medication"].name if _md else None
            _dose = (f"{_taken.dose_taken:g} {_taken.dose_unit}"
                     if _taken.dose_taken and _taken.dose_unit else None)
            _status = _taken.status.value if hasattr(_taken.status, "value") else str(_taken.status)
            return NodeDetailPayload(
                summary=f"{_med_name or 'Dose'} — {_dose or _status}",
                canonical_name=_med_name,
                original_text=_taken.notes,
                structured_fields={
                    "medication": _med_name,
                    "dose_taken": _dose,
                    "status": _status,
                    "scheduled_for": _taken.scheduled_for.isoformat() if _taken.scheduled_for else None,
                },
                status={"dose_status": _status},
                verification={"source_type": "patient"},
                timestamps={
                    "taken_at": _taken.taken_at.isoformat() if _taken.taken_at else None,
                },
                relationships=relationships,
                source={"medication_id": str(_taken.medication_id)},
                evidence={},
                confidence=None,
                provenance={"clinical_event_id": str(_taken.clinical_event_id) if _taken.clinical_event_id else None},
                evidence_badge=(_md["badge"] if _md else EvidenceLevel.USER_REPORTED.value),
                citations=([_md["citation"]] if _md else []),
            )
        if node_type == "body_structure":
            findings = [n.label for n in connected_nodes if n.type == "observation"][:10]
            return NodeDetailPayload(
                summary=f"{main_node.label} — {len([n for n in connected_nodes if n.type == 'observation'])} observations",
                canonical_name=main_node.label,
                original_text=None,
                structured_fields={"recent_findings": findings},
                status={},
                verification={},
                timestamps={},
                relationships=relationships,
                source={},
                evidence={},
                confidence=None,
                provenance={},
                evidence_badge=None,
                citations=[],
            )
    except Exception:
        # PG hydration must never break the graph detail response: fall back
        # to Neo4j props alone (logged server-side for diagnosis).
        import traceback

        traceback.print_exc()
    return None


@router.get("/{node_id:path}", response_model=GraphNodeDetailResponse)
def get_node_detail(
    node_id: str,
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
):
    """
    Get detailed information about a specific graph node and its connections.

    SECURITY: Ownership-aware verification ensures the node belongs to the
    authenticated patient's graph. The verification query only follows
    outgoing relationships from the patient through specific patient-owned
    relationship types. Shared AnatomicalStructure nodes are accessible
    only if the patient has at least one observation connected to them.

    For inaccessible nodes, returns the same "Not found" response as
    nonexistent nodes — no information leakage.
    """
    # Parse the node_id (format: "type:actual_id")
    parts = node_id.split(":", 1)
    if len(parts) != 2:
        return GraphNodeDetailResponse(
            node=GraphNode(id=node_id, type="unknown", label="Unknown"),
            connected_nodes=[],
            connected_edges=[],
        )

    node_type, raw_id = parts
    patient_id_str = str(patient_id)

    # ═══════════════════════════════════════════════════════════════════════
    # SECURITY: Ownership-aware verification
    #
    # The verification query follows ONLY outgoing relationships from the
    # patient through specific patient-owned relationship types:
    #
    #   Patient →[:HAS_OBSERVATION]→ Observation →[:AFFECTS]→ AnatomicalStructure
    #   Patient →[:HAS_OBSERVATION]→ Observation →[:SOURCE_DOCUMENT]→ Document
    #   Patient →[:HAS_TIMELINE_EVENT]→ TimelineEvent
    #   Patient →[:HAS_OBSERVATION]→ Observation →[:LOGGED_ON]→ TimelineEvent
    #
    # This prevents cross-patient access through shared AnatomicalStructure
    # nodes because the traversal never follows:
    #   - Incoming relationships to Patient nodes
    #   - Relationships from AnatomicalStructure to other Observations
    # ═══════════════════════════════════════════════════════════════════════

    # For body_structure nodes: verify patient has at least one observation
    # connected to this structure through their own observations
    if node_type == "body_structure":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(o:Observation)-[:AFFECTS]->(target {id: $raw_id})
        RETURN true AS reachable
        LIMIT 1
        """
    # For observation nodes: verify the observation belongs to this patient
    elif node_type == "observation":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(target {id: $raw_id})
        RETURN true AS reachable
        LIMIT 1
        """
    # For document nodes: verify the document is reachable through patient's
    # observations (P0: accepts both legacy SOURCE_DOCUMENT and canonical
    # DOCUMENTED_IN for dual-write migration compatibility) OR through the
    # patient's own conditions / medication requests / measurements (P1/P2
    # DOCUMENTED_IN paths — audit gap fix: these docs exist in the main
    # graph but previously 404'd in detail).
    elif node_type == "document":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})
        OPTIONAL MATCH (p)-[:HAS_OBSERVATION]->(o:Observation)-[:SOURCE_DOCUMENT]->(legacy:Document {id: $raw_id})
        OPTIONAL MATCH (p)-[:HAS_OBSERVATION]->(o2:Observation)-[:DOCUMENTED_IN]->(canon:Document {id: $raw_id})
        OPTIONAL MATCH (p)-[:HAS_CONDITION]->(:ConditionOccurrence)-[:DOCUMENTED_IN]->(cd:Document {id: $raw_id})
        OPTIONAL MATCH (p)-[:HAS_MEDICATION_REQUEST]->(:MedicationRequest)-[:DOCUMENTED_IN]->(rd:Document {id: $raw_id})
        OPTIONAL MATCH (p)-[:HAS_MEASUREMENT]->(:Measurement)-[:DOCUMENTED_IN]->(md:Document {id: $raw_id})
        OPTIONAL MATCH (p)-[:HAS_TIMELINE_EVENT]->(:TimelineEvent)-[:DOCUMENTED_IN]->(td:Document {id: $raw_id})
        WITH coalesce(legacy, canon, cd, rd, md, td) AS target
        WHERE target IS NOT NULL
        RETURN true AS reachable
        LIMIT 1
        """
    # For concept nodes (P0 Concept-lite): shared terminology reference data.
    # Reachable through the patient's OWN coded nodes (timeline events in
    # P0, conditions/measurements in P1/P2 — audit gap fix). Concept is
    # TERMINAL — verification never traverses out of it.
    elif node_type == "concept":
        concept_parts = raw_id.split("|", 1)
        if len(concept_parts) != 2:
            return GraphNodeDetailResponse(
                node=GraphNode(id=node_id, type=node_type, label="Not found"),
                connected_nodes=[],
                connected_edges=[],
            )
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})
        OPTIONAL MATCH (p)-[:HAS_TIMELINE_EVENT]->(:TimelineEvent)-[:HAS_CODE]->(via_te:Concept {system: $system, code: $code})
        OPTIONAL MATCH (p)-[:HAS_CONDITION]->(:ConditionOccurrence)-[:HAS_CODE]->(via_cond:Concept {system: $system, code: $code})
        OPTIONAL MATCH (p)-[:HAS_MEASUREMENT]->(:Measurement)-[:HAS_CODE]->(via_mm:Concept {system: $system, code: $code})
        WITH coalesce(via_te, via_cond, via_mm) AS target
        WHERE target IS NOT NULL
        RETURN true AS reachable
        LIMIT 1
        """
    # For timeline_event nodes: verify the event belongs to this patient
    elif node_type == "timeline_event":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})
        OPTIONAL MATCH (p)-[:HAS_TIMELINE_EVENT]->(direct:TimelineEvent {id: $raw_id})
        OPTIONAL MATCH (p)-[:HAS_OBSERVATION]->(:Observation)-[:LOGGED_ON]->(logged:TimelineEvent {id: $raw_id})
        WITH coalesce(direct, logged) AS target
        WHERE target IS NOT NULL
        RETURN true AS reachable
        LIMIT 1
        """
    # For medication nodes: verify the medication belongs to this patient.
    # P5: accepts EITHER the live ACTIVE edge (current regimen) OR the
    # persistent HAS_MEDICATION_REQUEST edge (order history). Discontinued
    # regimens lose ACTIVE (worker removes it) but stay explorable as
    # history with their status surfaced in the detail payload.
    elif node_type == "medication":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})
        OPTIONAL MATCH (p)-[:ACTIVE_MEDICATION]->(active:Medication {id: $raw_id})
        OPTIONAL MATCH (p)-[:HAS_MEDICATION_REQUEST]->(req:MedicationRequest {id: $raw_id})
        WITH coalesce(active, req) AS target
        WHERE target IS NOT NULL
        RETURN true AS reachable
        LIMIT 1
        """
    # For medication_taken_event nodes: verify the event belongs to this patient
    elif node_type == "medication_taken_event":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_MEDICATION_TAKEN]->(target:MedicationTakenEvent {id: $raw_id})
        RETURN true AS reachable
        LIMIT 1
        """
    # P1: medication request nodes belong to the patient via HAS_MEDICATION_REQUEST
    elif node_type == "medication_request":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_MEDICATION_REQUEST]->(target:MedicationRequest {id: $raw_id})
        RETURN true AS reachable
        LIMIT 1
        """
    # P1: condition nodes belong to the patient via HAS_CONDITION
    elif node_type == "condition_occurrence":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_CONDITION]->(target:ConditionOccurrence {id: $raw_id})
        RETURN true AS reachable
        LIMIT 1
        """
    # P1: visit nodes belong to the patient via HAS_VISIT
    elif node_type == "visit":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_VISIT]->(target:Visit {id: $raw_id})
        RETURN true AS reachable
        LIMIT 1
        """
    # P1: statement nodes belong to the patient via HAS_STATEMENT
    elif node_type == "patient_statement":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_STATEMENT]->(target:PatientStatement {id: $raw_id})
        RETURN true AS reachable
        LIMIT 1
        """
    # P1: canonical Medication nodes are shared reference data (keyed by
    # norm_key). Reachable only through the patient's OWN requests via
    # PRESCRIBES. Terminal — verification never traverses out of them.
    elif node_type == "medication_canonical":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_MEDICATION_REQUEST]->(req:MedicationRequest)-[:PRESCRIBES]->(target:Medication {norm_key: $raw_id})
        RETURN true AS reachable
        LIMIT 1
        """
    # P2: measurement nodes belong to the patient via HAS_MEASUREMENT
    elif node_type == "measurement":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_MEASUREMENT]->(target:Measurement {id: $raw_id})
        RETURN true AS reachable
        LIMIT 1
        """
    # P2: version nodes reachable only through the patient's own requests
    # via HAS_VERSION (patient-scoped; versions never fan out).
    elif node_type == "medication_version":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_MEDICATION_REQUEST]->(req:MedicationRequest)-[:HAS_VERSION]->(target:MedicationVersion {id: $raw_id})
        RETURN true AS reachable
        LIMIT 1
        """
    # P3: domain nodes belong to the patient via their HAS_* ownership edge.
    elif node_type == "sleep_episode":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_SLEEP]->(target:SleepEpisode {id: $raw_id})
        RETURN true AS reachable
        LIMIT 1
        """
    elif node_type == "activity_event":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_ACTIVITY]->(target:ActivityEvent {id: $raw_id})
        RETURN true AS reachable
        LIMIT 1
        """
    elif node_type == "nutrition_intake":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_NUTRITION]->(target:NutritionIntake {id: $raw_id})
        RETURN true AS reachable
        LIMIT 1
        """
    elif node_type == "food_scan":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_FOOD_SCAN]->(target:FoodScan {id: $raw_id})
        RETURN true AS reachable
        LIMIT 1
        """
    # P3: entries reachable only through the patient's OWN scans.
    elif node_type == "food_entry":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_FOOD_SCAN]->(:FoodScan)-[:HAS_ENTRY]->(target:FoodEntry {id: $raw_id})
        RETURN true AS reachable
        LIMIT 1
        """
    elif node_type == "ppg_measurement":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_BIOMETRIC]->(target:PPGMeasurement {id: $raw_id})
        RETURN true AS reachable
        LIMIT 1
        """
    else:
        # Unknown node type — deny access
        return GraphNodeDetailResponse(
            node=GraphNode(id=node_id, type=node_type, label="Not found"),
            connected_nodes=[],
            connected_edges=[],
        )

    verify_params: dict = {"patient_id": patient_id_str, "raw_id": raw_id}
    if node_type == "concept":
        # raw_id format for shared Concept nodes: "system|code"
        verify_params["system"], verify_params["code"] = raw_id.split("|", 1)
    try:
        with neo4j_driver.session() as session:
            result = session.run(verification_cypher, **verify_params)
            verification = result.single()
    except (ServiceUnavailable, SessionExpired):
        raise _neo4j_unavailable()

    if not verification or not verification.get("reachable"):
        # Node not found or not owned by this patient
        # Return same response as nonexistent node — no information leakage
        return GraphNodeDetailResponse(
            node=GraphNode(id=node_id, type=node_type, label="Not found"),
            connected_nodes=[],
            connected_edges=[],
        )

    # P5 lifecycle: a DELETED document row (kept for FK integrity) must not
    # render as a live record. Same Not-found shape — no leakage.
    if node_type == "document":
        from models.events import Document as _Document

        try:
            _doc_status = db.scalar(
                select(_Document.status).where(
                    _Document.document_id == uuid.UUID(raw_id),
                    _Document.patient_id == patient_id,
                )
            )
        except Exception:
            _doc_status = None
        if _doc_status == "DELETED":
            return GraphNodeDetailResponse(
                node=GraphNode(id=node_id, type=node_type, label="Not found"),
                connected_nodes=[],
                connected_edges=[],
            )

    # ═══════════════════════════════════════════════════════════════════════
    # Fetch node and its connections
    #
    # SECURITY: For the connected nodes, we need to be careful not to
    # expose another patient's data through shared nodes.
    #
    # For AnatomicalStructure nodes: return the node itself but only
    # include connections that belong to the authenticated patient.
    #
    # For patient-specific nodes (Observation, Document, TimelineEvent):
    # safe to return all connections since these are patient-owned.
    # For shared Concept nodes: patient-scoped projection (see branch below).
    # ═══════════════════════════════════════════════════════════════════════

    fetch_params: dict = {"patient_id": patient_id_str, "raw_id": raw_id}
    if node_type == "concept":
        # Shared Concept node: collect the patient's own coded nodes
        # (timeline events, conditions, measurements); never traverse out
        # of the Concept into other patients' data. `p` stays bound.
        _sys, _code = raw_id.split("|", 1)
        fetch_params = {"patient_id": patient_id_str, "system": _sys, "code": _code}
        cypher = """
        MATCH (p:Patient {id: $patient_id})
        OPTIONAL MATCH (p)-[:HAS_TIMELINE_EVENT]->(t:TimelineEvent)-[:HAS_CODE]->(target:Concept {system: $system, code: $code})
        OPTIONAL MATCH (p)-[:HAS_CONDITION]->(c:ConditionOccurrence)-[:HAS_CODE]->(target)
        OPTIONAL MATCH (p)-[:HAS_MEASUREMENT]->(m:Measurement)-[:HAS_CODE]->(target)
        WITH p, target, collect(DISTINCT t) AS tes, collect(DISTINCT c) AS conds, collect(DISTINCT m) AS mms
        RETURN target,
               [x IN tes WHERE x IS NOT NULL] AS te_nodes,
               [x IN conds WHERE x IS NOT NULL] AS cond_nodes,
               [x IN mms WHERE x IS NOT NULL] AS mm_nodes
        LIMIT 1
        """
    elif node_type == "medication_canonical":
        # Shared canonical Medication node (keyed by norm_key): collect the
        # patient's own requests prescribing it; never traverse out of it.
        fetch_params = {"patient_id": patient_id_str, "norm_key": raw_id}
        cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_MEDICATION_REQUEST]->(req:MedicationRequest)-[:PRESCRIBES]->(target:Medication {norm_key: $norm_key})
        WITH p, target, collect(DISTINCT req) AS patient_reqs
        RETURN target,
               [x IN patient_reqs WHERE x IS NOT NULL] AS req_nodes
        LIMIT 1
        """
    elif node_type == "body_structure":
        # For shared anatomy nodes: only return connections through
        # the patient's own observations.
        #
        # SECURITY CRITICAL: The variable 'p' MUST be carried through every
        # WITH clause. If 'p' is dropped, subsequent OPTIONAL MATCH (p)-...
        # rebinds 'p' against ALL Patient nodes, causing cross-patient data
        # leakage through shared AnatomicalStructure nodes.
        cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(o:Observation)-[:AFFECTS]->(target {id: $raw_id})
        WITH p, target, collect(DISTINCT o) AS patient_obs

        // Get documents through patient's observations only (P0: both
        // legacy SOURCE_DOCUMENT and canonical DOCUMENTED_IN links)
        OPTIONAL MATCH (p)-[:HAS_OBSERVATION]->(o2:Observation)-[:SOURCE_DOCUMENT]->(d:Document)
        WHERE o2 IN patient_obs
        WITH p, target, patient_obs, collect(DISTINCT d) AS patient_docs_legacy
        OPTIONAL MATCH (p)-[:HAS_OBSERVATION]->(o2b:Observation)-[:DOCUMENTED_IN]->(d2:Document)
        WHERE o2b IN patient_obs
        WITH p, target, patient_obs, patient_docs_legacy, collect(DISTINCT d2) AS patient_docs_new
        WITH p, target, patient_obs, patient_docs_legacy + patient_docs_new AS patient_docs

        // Get timeline events through patient's observations only
        OPTIONAL MATCH (p)-[:HAS_OBSERVATION]->(o3:Observation)-[:LOGGED_ON]->(te:TimelineEvent)
        WHERE o3 IN patient_obs
        WITH p, target, patient_obs, patient_docs, collect(DISTINCT te) AS patient_tes

        // Get patient's direct timeline events (not already collected via observations)
        OPTIONAL MATCH (p)-[:HAS_TIMELINE_EVENT]->(te2:TimelineEvent)
        WHERE NOT te2 IN patient_tes
        WITH p, target, patient_obs, patient_docs, patient_tes, collect(DISTINCT te2) AS extra_tes

        // Combine lists in a separate step (avoids aggregation-in-expression issue)
        WITH p, target, patient_obs, patient_docs, patient_tes + extra_tes AS all_tes

        RETURN target,
               [x IN patient_obs WHERE x IS NOT NULL] AS obs_nodes,
               [x IN patient_docs WHERE x IS NOT NULL] AS doc_nodes,
               [x IN all_tes WHERE x IS NOT NULL] AS te_nodes
        LIMIT 1
        """
    else:
        # For patient-specific nodes: safe to return all connections.
        # P5: when two nodes share an id (legacy Medication + P1
        # MedicationRequest), prefer the Medication row so the detail
        # contract stays stable; verification above already proved
        # ownership through either edge.
        # P7: bounded to 50 neighbours — the panel renders a handful and
        # linked caps at 10/group; visits with large OCCURRED_DURING fans
        # must not materialize unbounded rows.
        # P15 security: the target itself must be reachable from the
        # caller's Patient node. Verification above already proved a typed
        # path, but this closes the generic fetch against any current or
        # future unscoped edge (e.g. a planted DOCUMENTED_IN): unknown ids
        # fall through to the existing "Not found" response below.
        cypher = """
        MATCH (p:Patient {id: $patient_id})-[*1..4]-(target {id: $raw_id})
        WITH target ORDER BY CASE WHEN target:Medication THEN 0 ELSE 1 END LIMIT 1
        OPTIONAL MATCH (target)-[r]-(connected)
        WHERE r IS NOT NULL
        WITH target, r, connected LIMIT 50
        RETURN target,
               collect(DISTINCT connected) AS connected_nodes,
               collect(DISTINCT {source: startNode(r).id, target: endNode(r).id, type: type(r)}) AS rels
        LIMIT 1
        """

    try:
        with neo4j_driver.session() as session:
            result = session.run(cypher, **fetch_params)
            record = result.single()
    except (ServiceUnavailable, SessionExpired):
        raise _neo4j_unavailable()

    if not record or not record["target"]:
        return GraphNodeDetailResponse(
            node=GraphNode(id=node_id, type=node_type, label="Not found"),
            connected_nodes=[],
            connected_edges=[],
        )

    main_node = _node_from_raw(record["target"])
    if not main_node:
        main_node = GraphNode(id=node_id, type=node_type, label="Unknown")

    # Build connected nodes and edges based on node type
    connected_nodes = []
    connected_edges = []
    seen = {main_node.id}

    if node_type == "body_structure":
        # Anatomy node: build connections from patient's own data
        for obs in record.get("obs_nodes", []):
            node = _node_from_raw(obs)
            if node and node.id not in seen:
                connected_nodes.append(node)
                seen.add(node.id)
                connected_edges.append(GraphEdge(
                    id=f"{node.id}-AFFECTS-{main_node.id}",
                    source=node.id,
                    target=main_node.id,
                    type="AFFECTS",
                    relationship="AFFECTS",
                ))

        for doc in record.get("doc_nodes", []):
            node = _node_from_raw(doc)
            if node and node.id not in seen:
                connected_nodes.append(node)
                seen.add(node.id)

        for te in record.get("te_nodes", []):
            node = _node_from_raw(te)
            if node and node.id not in seen:
                connected_nodes.append(node)
                seen.add(node.id)
    elif node_type == "concept":
        # Shared Concept node: expose only the patient's own coded nodes
        # (capped). The Concept itself stays terminal — no fan-out.
        for te in (record.get("te_nodes", []) or [])[:25]:
            node = _node_from_raw(te)
            if node and node.id not in seen:
                connected_nodes.append(node)
                seen.add(node.id)
                connected_edges.append(GraphEdge(
                    id=f"{node.id}-HAS_CODE-{main_node.id}",
                    source=node.id,
                    target=main_node.id,
                    type="HAS_CODE",
                    relationship="HAS_CODE",
                ))
        for cn in list(record.get("cond_nodes", []) or [])[:15] + list(record.get("mm_nodes", []) or [])[:15]:
            node = _node_from_raw(cn)
            if node and node.id not in seen:
                connected_nodes.append(node)
                seen.add(node.id)
                connected_edges.append(GraphEdge(
                    id=f"{node.id}-HAS_CODE-{main_node.id}",
                    source=node.id,
                    target=main_node.id,
                    type="HAS_CODE",
                    relationship="HAS_CODE",
                ))
    elif node_type == "medication_canonical":
        # Shared canonical Medication: expose only the patient's own
        # requests (capped). Terminal — no fan-out.
        for req in (record.get("req_nodes", []) or [])[:25]:
            node = _node_from_raw(req)
            if node and node.id not in seen:
                connected_nodes.append(node)
                seen.add(node.id)
                connected_edges.append(GraphEdge(
                    id=f"{node.id}-PRESCRIBES-{main_node.id}",
                    source=node.id,
                    target=main_node.id,
                    type="PRESCRIBES",
                    relationship="PRESCRIBES",
                ))
    else:
        # Patient-specific node: return all connections
        for cn in record.get("connected_nodes", []):
            node = _node_from_raw(cn)
            if node and node.id not in seen:
                connected_nodes.append(node)
                seen.add(node.id)

        for rel in record.get("rels", []):
            if not rel:
                continue
            rel_type = rel.get('type')
            if not rel_type or not rel.get('source') or not rel.get('target'):
                continue
            source_type = "unknown"
            target_type = "unknown"
            for n in [main_node] + connected_nodes:
                if n.id.endswith(f":{rel['source']}"):
                    source_type = n.type
                if n.id.endswith(f":{rel['target']}"):
                    target_type = n.type
            connected_edges.append(GraphEdge(
                id=f"{rel['source']}-{rel_type}-{rel['target']}",
                source=f"{source_type}:{rel['source']}",
                target=f"{target_type}:{rel['target']}",
                type=rel_type,
                relationship=rel_type,
            ))

    detail = _build_node_detail(
        node_type, raw_id, patient_id, db, main_node, connected_nodes, connected_edges
    )
    if detail is not None:
        # P6 surrounding linkage from fetched neighbours only.
        _linked: dict[str, list[dict]] = {"visits": [], "documents": [], "conditions": [],
                                          "measurements": [], "events": []}
        for _n in connected_nodes:
            _entry = {"id": _n.id, "label": _n.label}
            if _n.type == "visit":
                _linked["visits"].append(_entry)
            elif _n.type == "document":
                _linked["documents"].append(_entry)
            elif _n.type == "condition_occurrence":
                _linked["conditions"].append(_entry)
            elif _n.type in ("measurement", "ppg_measurement"):
                _linked["measurements"].append(_entry)
            elif _n.type == "timeline_event":
                _linked["events"].append(_entry)
        detail.linked = {k: v[:10] for k, v in _linked.items() if v}
    return GraphNodeDetailResponse(
        node=main_node,
        connected_nodes=connected_nodes,
        connected_edges=connected_edges,
        detail=detail,
    )
