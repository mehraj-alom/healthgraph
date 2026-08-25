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


def init_neo4j_driver():
    """Initializes and verifies the Neo4j connection."""
    return neo4j_driver._ensure_driver()


def close_neo4j_driver():
    """Gracefully close the Neo4j connection pool (useful during app shutdown)."""
    neo4j_driver.close()