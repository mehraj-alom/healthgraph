"""add GIN trigram index on medical_aliases.lexical_name

Revision ID: f7096a8be9f2
Revises: 58a4b655fb3b
Create Date: 2026-09-02 17:42:16.539905

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f7096a8be9f2'
down_revision: Union[str, Sequence[str], None] = '58a4b655fb3b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add a GIN trigram index on medical_aliases.lexical_name for fast similarity lookups."""
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_alias_lexical_name_trgm "
        "ON medical_aliases USING gin (lexical_name gin_trgm_ops)"
    )


def downgrade() -> None:
    """Remove the GIN trigram index."""
    op.execute("DROP INDEX IF EXISTS ix_alias_lexical_name_trgm")
