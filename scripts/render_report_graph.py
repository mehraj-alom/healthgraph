"""P8: render report_graph.png from the LIVE Neo4j subgraph for one patient.

Usage: venv/bin/python scripts/render_report_graph.py <patient_uuid>
Writes report_graph.png in the repo root. Read-only (MATCH queries only).
"""
import sys
import uuid

sys.path.insert(0, "/home/opticpulse/healthgraph")
from dotenv import load_dotenv
load_dotenv("/home/opticpulse/healthgraph/.env")

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import networkx as nx

from core.neo4j_client import neo4j_driver

PATIENT_ID = sys.argv[1]
uuid.UUID(PATIENT_ID)  # fail fast on bad input
OUT_PATH = sys.argv[2] if len(sys.argv) > 2 else "/home/opticpulse/healthgraph/report_graph.png"

CYPHER = """
MATCH (p:Patient {id: $pid})-[r]->(n)
RETURN labels(p)[0] AS sl, type(r) AS rel, labels(n)[0] AS tl,
       p.id AS sid, n.id AS tid,
       coalesce(n.name, n.finding_code, n.visit_type, n.event_type, '') AS tname
LIMIT 200
"""

recs = list(neo4j_driver.session().run(CYPHER, pid=PATIENT_ID))
print(f"edges found: {len(recs)}")
if not recs:
    raise SystemExit("no patient subgraph in Neo4j; drain the outbox first")

G = nx.MultiDiGraph()
def _short(v) -> str:
    return str(v)[:8]
G.add_node(f"Patient\n{_short(PATIENT_ID)}", kind="root")
for rec in recs:
    tgt = f"{rec['tl']}\n{rec['tname'][:28]}\n{_short(rec['tid'])}"
    G.add_node(tgt, kind="node")
    G.add_edge(f"Patient\n{_short(PATIENT_ID)}", tgt, label=rec["rel"])

pos = nx.spring_layout(G, seed=7, k=1.2)
plt.figure(figsize=(14, 10))
colors = ["#c0392b" if d == 0 else "#2980b9" for _, d in G.in_degree(G.nodes)]
nx.draw(G, pos, with_labels=True, node_color=colors, node_size=2600,
        font_size=7, font_weight="bold", edge_color="#7f8c8d",
        arrowsize=14, width=1.2)
nx.draw_networkx_edge_labels(
    G, pos,
    edge_labels={(u, v): d["label"] for u, v, d in G.edges(data=True)},
    font_size=6,
)
plt.title(f"HealthGraph report_graph — patient {_short(PATIENT_ID)} (live Neo4j, {G.number_of_nodes()} nodes / {G.number_of_edges()} edges)")
plt.tight_layout()
plt.savefig(OUT_PATH, dpi=130)
print(f"wrote {OUT_PATH}")
