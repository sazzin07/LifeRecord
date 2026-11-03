"""debt_entries and idempotency_keys: the append-only debt ledger and the remembered answers of requests that change money

Revision ID: c5f7a9b1d3e6
Revises: b3d5f7a9c1e4
Create Date: 2026-11-03 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c5f7a9b1d3e6'
down_revision: Union[str, Sequence[str], None] = 'b3d5f7a9c1e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema. The tables may already exist because the app creates missing tables on startup."""
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if 'debt_entries' not in existing:
        op.create_table(
            'debt_entries',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('person_id', sa.String(36), nullable=False),
            sa.Column('person_name', sa.String(255), nullable=False),
            sa.Column('direction', sa.String(10), nullable=False),
            sa.Column('kind', sa.String(12), nullable=False),
            sa.Column('amount_cents', sa.BigInteger(), nullable=False),
            sa.Column('currency', sa.String(3), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('origin', sa.String(12), nullable=False),
            sa.Column('target_type', sa.String(8), nullable=True),
            sa.Column('target_id', sa.String(36), nullable=True),
            sa.Column('settlement_id', sa.String(36), nullable=True),
            sa.Column('created_ms', sa.BigInteger(), nullable=False),
            sa.Column('created_at', sa.String(32), nullable=False),
        )
        op.create_index('ix_debt_entries_user_id', 'debt_entries', ['user_id'])
        op.create_index('ix_debt_entries_person_id', 'debt_entries', ['person_id'])
        op.create_index('ix_debt_entries_created_ms', 'debt_entries', ['created_ms'])
    if 'idempotency_keys' not in existing:
        op.create_table(
            'idempotency_keys',
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('key', sa.String(120), primary_key=True),
            sa.Column('response', sa.Text(), nullable=False),
            sa.Column('created_ms', sa.BigInteger(), nullable=False),
        )
        op.create_index('ix_idempotency_keys_created_ms', 'idempotency_keys', ['created_ms'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('idempotency_keys')
    op.drop_table('debt_entries')
