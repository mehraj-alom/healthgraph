"""P8 repair: drop legacy global file-hash unique index (additive-safe).

Revision ID: p8d4f02a17c9
Revises: p7c9e52d18f0
Create Date: 2026-09-20

Background (found by real-DB application in P8): databases created via
create_all from older models carry the global dedup as a unique INDEX
named ix_documents_file_hash, not as the documents_file_hash_key
constraint the P7 migration dropped. The per-patient constraint
uq_document_patient_hash (P7) is the enforced invariant; this repair
removes the leftover global index so same-file uploads by different
patients (and re-uploads after correction) work as designed.

Idempotent (IF EXISTS) and non-destructive: drops an index only.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "p8d4f02a17c9"
down_revision: Union[str, Sequence[str], None] = "p7c9e52d18f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS ix_documents_file_hash"))


def downgrade() -> None:
    op.execute(sa.text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_documents_file_hash "
        "ON documents (file_hash)"
    ))
