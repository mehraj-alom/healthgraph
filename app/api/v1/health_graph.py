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

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.api.dependencies import get_authenticated_patient_id
from core.neo4j_client import neo4j_driver

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


NODE_TYPE_MAP = {
    "Patient": "patient",
    "AnatomicalStructure": "body_structure",
    "Observation": "observation",
    "Document": "document",
    "TimelineEvent": "timeline_event",
    "Medication": "medication",
    "MedicationTakenEvent": "medication_taken_event",
}


def _node_from_raw(raw) -> GraphNode | None:
    if not raw:
        return None
    node_id = raw.get("id", "")
    label = list(raw.labels)[0] if raw.labels else "Unknown"
    node_type = NODE_TYPE_MAP.get(label, label.lower())

    display_name = raw.get("display_name", "")
    finding_code = raw.get("finding_code", "")
    event_type = raw.get("event_type", "")
    name = raw.get("name", "")

    if display_name:
        lbl = display_name
    elif finding_code:
        lbl = finding_code.replace("_", " ").title()
    elif event_type:
        lbl = event_type.replace("_", " ").title()
    elif name:
        lbl = name
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
#   (Observation)-[:SOURCE_DOCUMENT]->(Document)
#   (Observation)-[:LOGGED_ON]->(TimelineEvent)
#
# AnatomicalStructure is a TERMINAL node for traversal — we never follow
# relationships from AnatomicalStructure to anything else.
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
    OPTIONAL MATCH (o)-[:SOURCE_DOCUMENT]->(d:Document)

    // Depth 1: Patient → TimelineEvents (patient owns these)
    OPTIONAL MATCH (p)-[:HAS_TIMELINE_EVENT]->(te:TimelineEvent)

    // Depth 2: Observations → TimelineEvents (via patient's observations)
    OPTIONAL MATCH (o)-[:LOGGED_ON]->(te2:TimelineEvent)

    // Depth 1: Patient → Medications (patient owns these)
    OPTIONAL MATCH (p)-[:ACTIVE_MEDICATION]->(m:Medication)

    // Depth 1: Patient → MedicationTakenEvents (patient owns these)
    OPTIONAL MATCH (p)-[:HAS_MEDICATION_TAKEN]->(e:MedicationTakenEvent)

    // Depth 2: MedicationTakenEvents → Medications (via TAKEN_FROM)
    OPTIONAL MATCH (e)-[:TAKEN_FROM]->(m2:Medication)

    // Collect all patient-owned nodes (anatomy is shared reference only)
    WITH p,
         collect(DISTINCT o) AS observations,
         collect(DISTINCT s) AS structures,
         collect(DISTINCT d) AS documents,
         collect(DISTINCT te) AS timeline_events1,
         collect(DISTINCT te2) AS timeline_events2,
         collect(DISTINCT m) AS medications1,
         collect(DISTINCT e) AS medication_events,
         collect(DISTINCT m2) AS medications2

    // Merge medications from both paths
    WITH p, observations, structures, documents, medication_events,
         timeline_events1 + timeline_events2 AS all_te,
         medications1 + medications2 AS all_meds

    // Build relationship list — ONLY patient-owned relationships
    // SECURITY: Each OPTIONAL MATCH must filter NULLs before collecting.
    // When a pattern doesn't fully match, ALL bound variables become NULL,
    // so type(r) returns NULL and produces invalid GraphEdge records.
    OPTIONAL MATCH (p)-[r1:HAS_OBSERVATION]->(o2:Observation)-[r2:AFFECTS]->(s2:AnatomicalStructure)
    WHERE r1 IS NOT NULL AND r2 IS NOT NULL
    WITH p, observations, structures, documents, all_te, all_meds, medication_events,
         collect(DISTINCT {{source: p.id, target: o2.id, type: type(r1)}}) AS rels_patient_obs,
         collect(DISTINCT {{source: o2.id, target: s2.id, type: type(r2)}}) AS rels_obs_struct

    OPTIONAL MATCH (p)-[r3:HAS_TIMELINE_EVENT]->(te3:TimelineEvent)
    WHERE r3 IS NOT NULL
    WITH p, observations, structures, documents, all_te, all_meds, medication_events,
         rels_patient_obs, rels_obs_struct,
         collect(DISTINCT {{source: p.id, target: te3.id, type: type(r3)}}) AS rels_patient_te

    OPTIONAL MATCH (o3:Observation)-[r4:SOURCE_DOCUMENT]->(d2:Document)
    WHERE (p)-[:HAS_OBSERVATION]->(o3) AND r4 IS NOT NULL
    WITH p, observations, structures, documents, all_te, all_meds, medication_events,
         rels_patient_obs, rels_obs_struct, rels_patient_te,
         collect(DISTINCT {{source: o3.id, target: d2.id, type: type(r4)}}) AS rels_obs_doc

    OPTIONAL MATCH (o4:Observation)-[r5:LOGGED_ON]->(te4:TimelineEvent)
    WHERE (p)-[:HAS_OBSERVATION]->(o4) AND r5 IS NOT NULL
    WITH p, observations, structures, documents, all_te, all_meds, medication_events,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc,
         collect(DISTINCT {{source: o4.id, target: te4.id, type: type(r5)}}) AS rels_obs_te

    OPTIONAL MATCH (p)-[r6:ACTIVE_MEDICATION]->(m3:Medication)
    WHERE r6 IS NOT NULL
    WITH p, observations, structures, documents, all_te, all_meds, medication_events,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_te,
         collect(DISTINCT {{source: p.id, target: m3.id, type: type(r6)}}) AS rels_patient_med

    OPTIONAL MATCH (p)-[r7:HAS_MEDICATION_TAKEN]->(e2:MedicationTakenEvent)-[r8:TAKEN_FROM]->(m4:Medication)
    WHERE r7 IS NOT NULL AND r8 IS NOT NULL
    WITH p, observations, structures, documents, all_te, all_meds, medication_events,
         rels_patient_obs, rels_obs_struct, rels_patient_te, rels_obs_doc, rels_obs_te, rels_patient_med,
         collect(DISTINCT {{source: p.id, target: e2.id, type: type(r7)}}) AS rels_patient_med_taken,
         collect(DISTINCT {{source: e2.id, target: m4.id, type: type(r8)}}) AS rels_med_taken_from

    RETURN p,
           [x IN observations WHERE x IS NOT NULL] AS obs_list,
           [x IN structures WHERE x IS NOT NULL] AS struct_list,
           [x IN documents WHERE x IS NOT NULL] AS doc_list,
           [x IN all_te WHERE x IS NOT NULL] AS te_list,
           [x IN all_meds WHERE x IS NOT NULL] AS med_list,
           [x IN medication_events WHERE x IS NOT NULL] AS med_taken_list,
           rels_patient_obs + rels_obs_struct + rels_patient_te + rels_obs_doc + rels_obs_te + rels_patient_med + rels_patient_med_taken + rels_med_taken_from AS all_rels
    LIMIT 1
    """

    with neo4j_driver.session() as session:
        result = session.run(cypher, patient_id=patient_id_str)
        record = result.single()

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
        for raw_list_key in ['struct_list', 'doc_list', 'obs_list', 'te_list']:
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
        'body_structure': 2,
        'document': 3,
        'timeline_event': 4,
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
    print('[HealthGraphEdges] ' + ' '.join(f'{name}={by_rel.get(name, 0)}' for name in ('HAS_OBSERVATION', 'AFFECTS', 'SOURCE_DOCUMENT', 'LOGGED_ON', 'HAS_TIMELINE_EVENT', 'DERIVED_SAME_TYPE', 'DERIVED_SAME_BODY_SITE', 'DERIVED_SAME_DAY')))

    return HealthGraphResponse(
        nodes=nodes,
        edges=edges,
        total_nodes=len(nodes),
        total_edges=len(edges),
        has_more=has_more,
    )


@router.get("/{node_id:path}", response_model=GraphNodeDetailResponse)
def get_node_detail(
    node_id: str,
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
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
    # For document nodes: verify the document is reachable through patient's observations
    elif node_type == "document":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(o:Observation)-[:SOURCE_DOCUMENT]->(target {id: $raw_id})
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
    # For medication nodes: verify the medication belongs to this patient
    elif node_type == "medication":
        verification_cypher = """
        MATCH (p:Patient {id: $patient_id})-[:ACTIVE_MEDICATION]->(target:Medication {id: $raw_id})
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
    else:
        # Unknown node type — deny access
        return GraphNodeDetailResponse(
            node=GraphNode(id=node_id, type=node_type, label="Not found"),
            connected_nodes=[],
            connected_edges=[],
        )

    with neo4j_driver.session() as session:
        result = session.run(verification_cypher, patient_id=patient_id_str, raw_id=raw_id)
        verification = result.single()

    if not verification or not verification.get("reachable"):
        # Node not found or not owned by this patient
        # Return same response as nonexistent node — no information leakage
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
    # ═══════════════════════════════════════════════════════════════════════

    if node_type == "body_structure":
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

        // Get documents through patient's observations only
        OPTIONAL MATCH (p)-[:HAS_OBSERVATION]->(o2:Observation)-[:SOURCE_DOCUMENT]->(d:Document)
        WHERE o2 IN patient_obs
        WITH p, target, patient_obs, collect(DISTINCT d) AS patient_docs

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
        # For patient-specific nodes: safe to return all connections
        cypher = """
        MATCH (target {id: $raw_id})
        OPTIONAL MATCH (target)-[r]-(connected)
        WHERE r IS NOT NULL
        RETURN target,
               collect(DISTINCT connected) AS connected_nodes,
               collect(DISTINCT {source: startNode(r).id, target: endNode(r).id, type: type(r)}) AS rels
        LIMIT 1
        """

    with neo4j_driver.session() as session:
        result = session.run(cypher, patient_id=patient_id_str, raw_id=raw_id)
        record = result.single()

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

    return GraphNodeDetailResponse(
        node=main_node,
        connected_nodes=connected_nodes,
        connected_edges=connected_edges,
    )
