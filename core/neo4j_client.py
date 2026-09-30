import os

from neo4j import GraphDatabase
from neo4j.exceptions import AuthError, ServiceUnavailable

from logger import logger

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password")


class Neo4jDriverProxy:
    """Lazy-initialized Neo4j driver proxy to avoid import-time failures."""

    def __init__(self):
        self._driver = None

    def _ensure_driver(self):
        if self._driver is None:
            if NEO4J_PASSWORD == "password" and os.getenv("APP_ENV") == "production":
                raise RuntimeError(
                    "Production startup refused: NEO4J_PASSWORD is the "
                    "well-known development default. Set a strong, unique "
                    "NEO4J_PASSWORD in the production environment."
                )
            try:
                driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
                driver.verify_connectivity()
                logger.info(f"Successfully connected to Neo4j at {NEO4J_URI}")
                self._driver = driver
            except AuthError as e:
                logger.critical(f"Neo4j Authentication failed: {e}")
                raise
            except ServiceUnavailable as e:
                logger.critical(f"Neo4j Service unavailable at {NEO4J_URI}: {e}")
                raise
            except Exception as e:
                logger.critical(f"Failed to initialize Neo4j driver: {e}")
                raise
        return self._driver

    def __getattr__(self, name):
        return getattr(self._ensure_driver(), name)

    def close(self):
        if self._driver is not None:
            self._driver.close()
            self._driver = None
            logger.info("Neo4j driver connection closed.")


neo4j_driver = Neo4jDriverProxy()


def bump_patient_graph_rev(tx, patient_id) -> None:
    """Mint a fresh opaque revision key on the Patient node.

    Every mutation of patient graph data must call this in the SAME
    transaction as the write, so the key changes atomically with the data.
    randomUUID (not a counter) is deliberate: concurrent writers can never
    lose an update — each write yields a distinct key.
    Readers (GET /health-graph/revision) compare keys instead of
    re-running the full graph query on every screen open.
    """
    pid = str(patient_id or "").strip()
    if not pid:
        return
    tx.run(
        "MATCH (p:Patient {id: $pid}) SET p.graph_rev = randomUUID()",
        pid=pid,
    )


def read_patient_graph_rev(session, patient_id):
    """Return the patient's current graph revision key, or None.

    None means "unknown" (no Patient node yet, or pre-revision data):
    callers must treat it as a cache miss and fetch full.
    """
    record = session.run(
        "MATCH (p:Patient {id: $pid}) RETURN p.graph_rev AS rev",
        pid=str(patient_id),
    ).single()
    if not record:
        return None
    return record.get("rev") or None


def init_neo4j_driver():
    """Initializes and verifies the Neo4j connection."""
    return neo4j_driver._ensure_driver()


def close_neo4j_driver():
    """Gracefully close the Neo4j connection pool (useful during app shutdown)."""
    neo4j_driver.close()