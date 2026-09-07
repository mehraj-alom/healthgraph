"""add document blobs table

Production change: document binaries must live in the durable managed
PostgreSQL, not the ephemeral container filesystem (which Voroa wipes on
every deploy). The web service and the Celery worker run in separate
containers without a shared filesystem, so the bytes are stored here and
materialized to a temp file only while OCR/extraction runs.

The table is created idempotently (`IF NOT EXISTS`) because the API also
runs ``Base.metadata.create_all`` at startup; either path may create the
table first. This mirrors the other idempotent operations in this chain
(e.g. the pg_trgm extension and the GIN index).

Revision ID: c2a1d3e4f5b6
Revises: b1c2d3e4f5a6
Create Date: 2026-09-07

"""

from alembic import op

# revision identifiers
revision = "c2a1d3e4f5b6"
down_revision = "b1c2d3e4f5a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS document_blobs (
            document_id  UUID PRIMARY KEY REFERENCES documents(document_id) ON DELETE CASCADE,
            filename     VARCHAR NOT NULL,
            content_type VARCHAR,
            data         BYTEA NOT NULL,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS document_blobs")