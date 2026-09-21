"""P0 source-backed retrieval layer.

Contract (shared by the node-detail endpoint and chat tools):

    Node → relationships (Neo4j routing, IDs only)
         → source (PostgreSQL truth, always re-filtered by patient_id)
         → evidence (PG EvidenceLink quote + Qdrant ranked snippets)
         → provenance (citation object every answer carries)

Rules enforced here:
- Neo4j supplies routing IDs only; PostgreSQL is the source of truth.
- Qdrant supplies ranked snippets, never authoritative facts.
- Every traversal is allow-listed (ALLOWED_TRAVERSAL_RELS) and carries
  the patient binding `p` through every WITH (see health_graph.py).
- Shared labels (TERMINAL_LABELS) are never traversed *through*.
- AI_INFERRED content is never persisted as an authoritative edge and is
  never returned as a fact — only as explicitly labeled unverified overlays.
"""
