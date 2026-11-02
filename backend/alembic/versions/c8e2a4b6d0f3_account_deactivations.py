"""account_deactivations: switching an account off without deleting it

Revision ID: c8e2a4b6d0f3
Revises: a7c3e9f1b5d2
Create Date: 2026-11-02 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c8e2a4b6d0f3'
down_revision: Union[str, Sequence[str], None] = 'a7c3e9f1b5d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema. The table may already exist because the app creates missing tables on startup."""
    if 'account_deactivations' in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        'account_deactivations',
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('deactivated_ms', sa.BigInteger(), nullable=False),
        sa.Column('deactivated_by', sa.String(16), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('account_deactivations')
