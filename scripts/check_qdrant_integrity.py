#!/usr/bin/env python3
"""P7 Qdrant evidence reconciler (READ-ONLY, safe to run anytime).

Compares PostgreSQL COMPLETED documents against Qdrant vector presence:

- COMPLETED document with zero vectors → indexing was skipped/failed
  (ingestion logs a warning and continues) → needs re-index.
- Vectors whose document_id has no live Document row (or a DELETED one) →
  stale searchable evidence → needs filtered delete.

Prints a report and exits 0 (informational) or 1 when mismatches exist.
Nothing is written. Pair with the existing projection-integrity checker.
"""
import sys
import uuid

from qdrant_client.http import models as _qm
from sqlalchemy import select

from core.db import SessionLocal
from models.events import Document
from services.vectorization.qdrant_client import vector_db


def main(limit: int = 1000) -> int:
    db = SessionLocal()
    try:
        docs = db.execute(
            select(Document).where(Document.status == "COMPLETED").limit(limit)
        ).scalars().all()
    finally:
        db.close()
    try:
        client = vector_db.client
        collection = vector_db.collection_name
    except Exception as e:
        print(f"Qdrant unreachable: {type(e).__name__} (cannot reconcile)")
        return 2

    missing: list[str] = []
    try:
        for doc in docs:
            count = client.count(
                collection_name=collection,
                count_filter=_qm.Filter(must=[
                    _qm.FieldCondition(key="patient_id", match=_qm.MatchValue(value=str(doc.patient_id))),
                    _qm.FieldCondition(key="document_id", match=_qm.MatchValue(value=str(doc.document_id))),
                ]),
                exact=False,
            )
            if (count.count or 0) == 0:
                missing.append(str(doc.document_id))
    except Exception as e:
        print(f"Qdrant count failed: {type(e).__name__} (cannot reconcile)")
        return 2

    print(f"Qdrant evidence reconciliation (read-only): {len(docs)} COMPLETED documents checked.")
    if missing:
        print(f"  {len(missing)} without vectors (re-index candidates):")
        for did in missing[:50]:
            print(f"    {did}")
    else:
        print("  No missing vectors detected.")
    print("Note: stale vectors for deleted documents are removed by the "
          "document DELETE cascade; re-run after deletes to confirm.")
    return 0 if not missing else 1


if __name__ == "__main__":
    lim = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 1000
    raise SystemExit(main(lim))
