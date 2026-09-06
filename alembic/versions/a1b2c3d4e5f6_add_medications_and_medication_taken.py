"""add medications and medication taken events tables

Revision ID: a1b2c3d4e5f6
Revises: 9c3f2e1a7b4d
Create Date: 2026-09-05

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "9c3f2e1a7b4d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enum types
    medication_status = postgresql.ENUM('ACTIVE', 'SCHEDULED', 'COMPLETED', 'PAUSED', 'DISCONTINUED', name='medicationstatus', create_type=False)
    medication_frequency = postgresql.ENUM('ONCE_DAILY', 'TWICE_DAILY', 'THREE_TIMES_DAILY', 'FOUR_TIMES_DAILY', 'EVERY_MORNING', 'EVERY_EVENING', 'EVERY_NIGHT', 'EVERY_8_HOURS', 'EVERY_12_HOURS', 'WEEKLY', 'AS_NEEDED', 'CUSTOM', name='medicationfrequency', create_type=False)
    medication_route = postgresql.ENUM('ORAL', 'TOPICAL', 'INJECTION', 'INHALED', 'SUBLINGUAL', 'RECTAL', 'NASAL', 'OPHTHALMIC', 'OTHER', name='medicationroute', create_type=False)
    dose_taken_status = postgresql.ENUM('TAKEN', 'MISSED', 'SKIPPED', 'LATE', name='dosetakenstatus', create_type=False)

    # Create enums if they don't exist
    medication_status.create(op.get_bind(), checkfirst=True)
    medication_frequency.create(op.get_bind(), checkfirst=True)
    medication_route.create(op.get_bind(), checkfirst=True)
    dose_taken_status.create(op.get_bind(), checkfirst=True)

    # Create medications table
    op.create_table(
        'medications',
        sa.Column('medication_id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('patient_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('patients.patient_id'), index=True, nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('generic_name', sa.String(255), nullable=True),
        sa.Column('brand_name', sa.String(255), nullable=True),
        sa.Column('strength', sa.String(50), nullable=True),
        sa.Column('strength_unit', sa.String(50), nullable=True),
        sa.Column('dose_amount', sa.Float, nullable=True),
        sa.Column('dose_unit', sa.String(50), nullable=True),
        sa.Column('route', medication_route, nullable=True),
        sa.Column('frequency', medication_frequency, nullable=False),
        sa.Column('scheduled_times', postgresql.JSONB, nullable=True),
        sa.Column('scheduled_weekdays', postgresql.JSONB, nullable=True),
        sa.Column('start_date', sa.Date, nullable=True),
        sa.Column('end_date', sa.Date, nullable=True),
        sa.Column('status', medication_status, nullable=False, server_default='ACTIVE'),
        sa.Column('purpose', sa.String(500), nullable=True),
        sa.Column('instructions', sa.Text, nullable=True),
        sa.Column('prescriber', sa.String(255), nullable=True),
        sa.Column('prn', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('reminder_enabled', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column('source_document_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('documents.document_id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_medications_patient_status', 'medications', ['patient_id', 'status'])

    # Create medication_taken_events table
    op.create_table(
        'medication_taken_events',
        sa.Column('event_id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('medication_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('medications.medication_id'), index=True, nullable=False),
        sa.Column('patient_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('patients.patient_id'), index=True, nullable=False),
        sa.Column('taken_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('scheduled_for', sa.DateTime(timezone=True), nullable=True),
        sa.Column('dose_taken', sa.Float, nullable=True),
        sa.Column('dose_unit', sa.String(50), nullable=True),
        sa.Column('status', dose_taken_status, nullable=False, server_default='TAKEN'),
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column('clinical_event_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('clinical_events.event_id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_medication_taken_patient_time', 'medication_taken_events', ['patient_id', 'taken_at'])
    op.create_index('ix_medication_taken_medication', 'medication_taken_events', ['medication_id', 'taken_at'])


def downgrade() -> None:
    op.drop_table('medication_taken_events')
    op.drop_table('medications')
    
    # Drop enum types
    op.execute("DROP TYPE IF EXISTS dosetakenstatus")
    op.execute("DROP TYPE IF EXISTS medicationroute")
    op.execute("DROP TYPE IF EXISTS medicationfrequency")
    op.execute("DROP TYPE IF EXISTS medicationstatus")