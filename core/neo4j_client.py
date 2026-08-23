import os
import logging
from neo4j import GraphDatabase
from neo4j.exceptions import ServiceUnavailable, AuthError

from logger import logger

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password")

def init_neo4j_driver():
    """Initializes and verifies the Neo4j connection."""
    try:
        # The GraphDatabase.driver creates a thread-safe connection pool
        driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
        
        # Verify connectivity on startup
        driver.verify_connectivity()
        logger.info(f"Successfully connected to Neo4j at {NEO4J_URI}")
        
        return driver
    
    except AuthError as e:
        logger.critical(f"Neo4j Authentication failed: {e}")
        raise
    except ServiceUnavailable as e:
        logger.critical(f"Neo4j Service unavailable at {NEO4J_URI}: {e}")
        raise
    except Exception as e:
        logger.critical(f"Failed to initialize Neo4j driver: {e}")
        raise

# Instantiate the singleton driver
neo4j_driver = init_neo4j_driver()

def close_neo4j_driver():
    """Gracefully close the Neo4j connection pool (useful during app shutdown)."""
    if neo4j_driver:
        neo4j_driver.close()
        logger.info("Neo4j driver connection closed.")