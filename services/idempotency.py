"""
Idempotency service for safe offline synchronization.

Provides database-backed idempotency guarantees for client mutations.
Uses a unique constraint on (patient_id, key) to prevent duplicates.
"""

import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from models.idempotency import IdempotencyKey


def compute_request_hash(payload: Any) -> str:
    """Compute a SHA-256 hash of the request payload for comparison."""
    if payload is None:
        return hashlib.sha256(b"").hexdigest()
    serialized = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode()).hexdigest()


def check_idempotency(
    db: Session,
    patient_id: uuid.UUID,
    key: str,
    request_hash: str,
) -> Optional[dict]:
    """
    Check if an idempotency key already exists.

    Returns:
        - None if key does not exist (proceed with mutation)
        - dict with status/response if key exists (replay or conflict)
    """
    stmt = select(IdempotencyKey).where(
        IdempotencyKey.patient_id == patient_id,
        IdempotencyKey.key == key,
    )
    existing = db.execute(stmt).scalar_one_or_none()

    if existing is None:
        return None

    # Check if expired
    if existing.expires_at < datetime.now(timezone.utc):
        # Expired key - treat as new
        return None

    # Check if request hash matches
    if existing.request_hash != request_hash:
        # Same key, different payload - conflict
        return {
            "status": "conflict",
            "error": "Idempotency key reused with different payload",
        }

    # Same key, same payload - replay
    return {
        "status": "replay",
        "http_status": existing.http_status,
        "response": json.loads(existing.response_json) if existing.response_json else None,
    }


def store_idempotency_key(
    db: Session,
    patient_id: uuid.UUID,
    key: str,
    operation: str,
    request_hash: str,
    http_status: int,
    response: Any,
    ttl_hours: int = 72,
) -> None:
    """
    Store an idempotency key after successful mutation.

    Uses PostgreSQL INSERT ... ON CONFLICT DO NOTHING to handle race conditions.
    """
    stmt = pg_insert(IdempotencyKey).values(
        patient_id=patient_id,
        key=key,
        operation=operation,
        request_hash=request_hash,
        http_status=http_status,
        response_json=json.dumps(response, default=str) if response else None,
        status="completed",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=ttl_hours),
    )
    stmt = stmt.on_conflict_do_nothing(
        index_elements=["patient_id", "key"]
    )
    db.execute(stmt)


def cleanup_expired_keys(db: Session) -> int:
    """Remove expired idempotency keys. Returns count of deleted rows."""
    stmt = (
        update(IdempotencyKey)
        .where(IdempotencyKey.expires_at < datetime.now(timezone.utc))
        .values(status="expired")
    )
    result = db.execute(stmt)
    return result.rowcount
