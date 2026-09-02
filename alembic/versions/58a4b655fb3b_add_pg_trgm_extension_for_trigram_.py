"""add pg_trgm extension for trigram similarity

Revision ID: 58a4b655fb3b
Revises:
Create Date: 2026-09-02 17:40:26.370411

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '58a4b655fb3b'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Install the pg_trgm PostgreSQL extension (idempotent)."""
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")


def downgrade() -> None:
    """Remove the pg_trgm extension.

    Note: this will fail if any trigram indexes or similarity queries
    depend on it.  In practice you never want to downgrade this.
    """
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
