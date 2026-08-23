"""This module implements a Celery task to drain the GraphSyncOutbox table and project events into Neo4j.
It handles both transient and permanent failures, with exponential backoff for retries."""
import logging
import random
from datetime import datetime, timezone, timedelta
from celery import shared_task
from sqlalchemy.orm import Session
from sqlalchemy import select, or_, and_
from neo4j.exceptions import ServiceUnavailable, SessionExpired

from core.db import SessionLocal
from core.neo4j_client import neo4j_driver
from models.outbox import GraphSyncOutbox, OutboxStatus, OutboxEventType

from logger import logger

MAX_RETRIES = 5
BACKOFF_BASE_SECONDS = 10
STALE_LEASE_MINUTES = 5

REQUIRED_OBSERVATION_KEYS = {
    "patient_id", "observation_id", "structure_id", 
    "finding_code", "visual_severity_score", "recorded_at", "source_type"
}

class PermanentProjectionError(Exception):
    """Raised for malformed payloads or invalid routing."""
    pass



def _process_outbox_events(db: Session, driver, batch_size: int = 50):
    now = datetime.now(timezone.utc)
    stale_threshold = now - timedelta(minutes=STALE_LEASE_MINUTES)
    
    # 1. Claim pending OR recover stale leases safely
    query = select(GraphSyncOutbox).where(
        or_(
            and_(GraphSyncOutbox.status == OutboxStatus.PENDING, GraphSyncOutbox.next_attempt_at <= now),
            and_(
                GraphSyncOutbox.status == OutboxStatus.PROCESSING, 
                GraphSyncOutbox.locked_at < stale_threshold,
                GraphSyncOutbox.locked_at.is_not(None)
            )
        )
    ).order_by(GraphSyncOutbox.next_attempt_at).limit(batch_size).with_for_update(skip_locked=True)
    
    events = db.execute(query).scalars().all()
    if not events:
        return

    for event in events:
        event.status = OutboxStatus.PROCESSING
        event.locked_at = now
    db.commit()

    #Process against Neo4j
    with driver.session() as neo4j_session:
        for event in events:
            try:
                # Explicitly route event types (or fail permanently)
                if event.event_type == OutboxEventType.OBSERVATION_RECORDED:
                    neo4j_session.execute_write(_project_observation_tx, event.payload)
                else:
                    raise PermanentProjectionError(f"Unsupported outbox event type: {event.event_type}")
                
                # Success
                event.status = OutboxStatus.PROCESSED
                event.processed_at = datetime.now(timezone.utc)
                event.locked_at = None
                event.last_error = None

            except PermanentProjectionError as e:
                logger.error(f"Permanent projection failure for event {event.id}: {e}")
                event.status = OutboxStatus.DEAD_LETTER
                event.last_error = str(e)
                event.locked_at = None

            except (ServiceUnavailable, SessionExpired) as e:
                _handle_transient_failure(event, e, "Neo4j transient error")

            except Exception as e:
                logger.critical(f"Unknown exception during projection for event {event.id}: {e}. Defaulting to retry.")
                _handle_transient_failure(event, e, "Unknown exception")

        db.commit()

@shared_task(name="tasks.graph_sync.drain_graph_outbox")
def drain_graph_outbox():
    db = SessionLocal()
    try:
        _process_outbox_events(db, neo4j_driver)
    finally:
        db.close()


def _handle_transient_failure(event: GraphSyncOutbox, error: Exception, context: str):
    logger.warning(f"{context} for event {event.id}: {error}")
    event.attempt_count += 1
    event.last_error = str(error)
    event.locked_at = None
    
    if event.attempt_count >= MAX_RETRIES:
        event.status = OutboxStatus.DEAD_LETTER
    else:
        event.status = OutboxStatus.PENDING
        delay_seconds = BACKOFF_BASE_SECONDS * (2 ** (event.attempt_count - 1))
        jitter = random.uniform(0, 0.2 * delay_seconds)
        event.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=delay_seconds + jitter)


def _project_observation_tx(tx, payload: dict):
    # Strict validation before Cypher execution
    missing_keys = REQUIRED_OBSERVATION_KEYS - set(payload.keys())
    if missing_keys:
        raise PermanentProjectionError(f"Payload missing required keys: {missing_keys}")
        
    cypher = """
    MERGE (p:Patient {id: $patient_id})
    MERGE (s:AnatomicalStructure {id: $structure_id})
    MERGE (o:Observation {id: $observation_id})
    
    SET o.finding_code = $finding_code,
        o.visual_severity_score = $visual_severity_score,
        o.recorded_at = $recorded_at,
        o.source_type = $source_type

    MERGE (p)-[:HAS_OBSERVATION]->(o)
    MERGE (o)-[:AFFECTS]->(s)
    """
    
    parameters = payload.copy()
    if payload.get("document_id"):
        cypher += " MERGE (d:Document {id: $document_id}) MERGE (o)-[:SOURCE_DOCUMENT]->(d)"
    if payload.get("event_id"):
        cypher += " MERGE (t:TimelineEvent {id: $event_id}) MERGE (o)-[:LOGGED_ON]->(t)"

    result = tx.run(cypher, **parameters)
    result.consume() # Ensures the transaction fully executes