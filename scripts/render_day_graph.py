"""P9: render p9_temporal_graph.png from the LIVE Day graph of one patient.

Usage: venv/bin/python scripts/render_day_graph.py <patient_uuid> [out.png]
Read-only (MATCH queries only). Layers: Patient -> Day -> events.
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
uuid.UUID(PATIENT_ID)
OUT = sys.argv[2] if len(sys.argv) > 2 else "/home/opticpulse/healthgraph/p9_temporal_graph.png"

DAYS = list(neo4j_driver.session().run(
    "MATCH (:Patient {id:$p})-[:HAS_DAY]->(d:Day) RETURN d.id, d.date ORDER BY d.date",
    p=PATIENT_ID))
print(f"days: {len(DAYS)}")
if not DAYS:
    raise SystemExit("no Day nodes for patient; project day-linked events first")

G = nx.DiGraph()
short = lambda v: str(v)[:8]  # noqa: E731 - render script convention
root = f"Patient\n{PATIENT_ID[:8]}"
G.add_node(root, layer=0)
for day_id, day_date in DAYS:
    dnode = f"Day\n{day_date}"
    G.add_node(dnode, layer=1)
    G.add_edge(root, dnode, label="HAS_DAY")
    for rec in neo4j_driver.session().run(
            "MATCH (:Day {id:$d})-[:HAS_EVENT]->(e) "
            "RETURN labels(e)[0] AS kind, e.id AS eid ORDER BY eid", d=day_id):
        enode = f"{rec['kind']}\n{rec['eid'][:8]}"
        G.add_node(enode, layer=2)
        G.add_edge(dnode, enode, label="HAS_EVENT")

layers = nx.get_node_attributes(G, "layer")
pos = {}
for layer in (0, 1, 2):
    nodes = sorted(n for n, L in layers.items() if L == layer)
    for i, n in enumerate(nodes):
        pos[n] = (layer * 4.0, -i * 1.1 + len(nodes) * 0.55)

plt.figure(figsize=(16, max(8, len(G.nodes) * 0.42)))
colors = ["#c0392b" if layers[n] == 0 else "#27ae60" if layers[n] == 1 else "#2980b9"
          for n in G.nodes]
nx.draw(G, pos, with_labels=True, node_color=colors, node_size=2400,
        font_size=7, font_weight="bold", edge_color="#7f8c8d",
        arrowsize=12, width=1.1)
nx.draw_networkx_edge_labels(
    G, pos, edge_labels={(u, v): d["label"] for u, v, d in G.edges(data=True)},
    font_size=6)
plt.title(f"HealthGraph P9 temporal graph — patient {PATIENT_ID[:8]} "
          f"({G.number_of_nodes()} nodes / {G.number_of_edges()} edges, live Neo4j)")
plt.tight_layout()
plt.savefig(OUT, dpi=130)
print(f"wrote {OUT}")
