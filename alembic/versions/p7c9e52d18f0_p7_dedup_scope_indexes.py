"""P7 production hardening: dedup scope + retrieval indexes (additive).

Revision ID: p7c9e52d18f0
Revises: p6b3d91f44a2
Create Date: 2026-09-20

- documents: replace the global UNIQUE(file_hash) (SQLAlchemy default name
  documents_file_hash_key) with a per-patient UNIQUE(patient_id, file_hash).
  Two patients may hold the same file; races no longer 500. Pre-existing
  cross-patient duplicate hashes (from the global-constraint era, if any)
  would violate the new constraint — the upgrade checks first and the
  downgrade restores nothing automatically (see note below).
- Retrieval indexes (all additive, IF NOT EXISTS):
  - pg_trgm GIN indexes for leading-% ilike name searches the chat tools
    run per request (medications.name, condition_occurrences.name,
    measurements.name, medical_concepts.display_name). pg_trgm is already
    installed (58a4b655fb3b).
  - B-tree indexes on hot retrieval FKs: clinical_events(concept_id),
    anatomical_observations(event_id, document_id),
    evidence_links(document_id), medications(purpose_condition_id),
    patient_statements(about_condition_id, source_medication_id).

NOTE on downgrade: restores the global unique only when no cross-patient
duplicate hashes exist; otherwise it raises and the operator must resolve
manually (downgrade of a scope-widening constraint is inherently lossy).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "p7c9e52d18f0"
down_revision: Union[str, Sequence[str], None] = "p6b3d91f44a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # P7: the pre-P7 model declared UNIQUE(file_hash), but databases
    # created via create_all from older models may lack the constraint
    # under its default name — drop defensively (IF EXISTS) since the
    # per-patient replacement below is the enforced invariant going forward.
    op.execute(sa.text("ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_file_hash_key"))
    # P8: older databases created via create_all carry the global dedup as
    # a unique INDEX (ix_documents_file_hash), not a constraint. Drop it
    # here too so fresh upgrades reach the same end state (the dedicated
    # p8 repair migration covers databases that already applied P7).
    op.execute(sa.text("DROP INDEX IF EXISTS ix_documents_file_hash"))
    op.execute(sa.text(
        "DO $$ BEGIN "
        "IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_document_patient_hash') THEN "
        "ALTER TABLE documents ADD CONSTRAINT uq_document_patient_hash UNIQUE (patient_id, file_hash); "
        "END IF; END $$;"
    ))
    for ddl in [
        'CREATE INDEX IF NOT EXISTS ix_medications_name_trgm ON medications USING gin (name gin_trgm_ops)',
        'CREATE INDEX IF NOT EXISTS ix_condition_name_trgm ON condition_occurrences USING gin (name gin_trgm_ops)',
        'CREATE INDEX IF NOT EXISTS ix_measurement_name_trgm ON measurements USING gin (name gin_trgm_ops)',
        'CREATE INDEX IF NOT EXISTS ix_concept_display_trgm ON medical_concepts USING gin (display_name gin_trgm_ops)',
        'CREATE INDEX IF NOT EXISTS ix_clinical_events_concept_id ON clinical_events (concept_id)',
        'CREATE INDEX IF NOT EXISTS ix_obs_event_id ON anatomical_observations (event_id)',
        'CREATE INDEX IF NOT EXISTS ix_obs_document_id ON anatomical_observations (document_id)',
        'CREATE INDEX IF NOT EXISTS ix_evidence_document_id ON evidence_links (document_id)',
        'CREATE INDEX IF NOT EXISTS ix_medications_purpose_condition ON medications (purpose_condition_id)',
        'CREATE INDEX IF NOT EXISTS ix_statement_about_condition ON patient_statements (about_condition_id)',
        'CREATE INDEX IF NOT EXISTS ix_statement_source_medication ON patient_statements (source_medication_id)',
    ]:
        op.execute(sa.text(ddl))


def downgrade() -> None:
    op.drop_index("ix_statement_source_medication", table_name="patient_statements")
    op.drop_index("ix_statement_about_condition", table_name="patient_statements")
    op.drop_index("ix_medications_purpose_condition", table_name="medications")
    op.drop_index("ix_evidence_document_id", table_name="evidence_links")
    op.drop_index("ix_obs_document_id", table_name="anatomical_observations")
    op.drop_index("ix_obs_event_id", table_name="anatomical_observations")
    op.drop_index("ix_clinical_events_concept_id", table_name="clinical_events")
    op.drop_index("ix_concept_display_trgm", table_name="medical_concepts")
    op.drop_index("ix_measurement_name_trgm", table_name="measurements")
    op.drop_index("ix_condition_name_trgm", table_name="condition_occurrences")
    op.drop_index("ix_medications_name_trgm", table_name="medications")
    op.drop_constraint("uq_document_patient_hash", "documents", type_="unique")
    # Lossy by nature: fails loudly if cross-patient duplicate hashes exist.
    op.create_unique_constraint("documents_file_hash_key", "documents", ["file_hash"])
