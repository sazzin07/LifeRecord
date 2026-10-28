"""persist AI pending confirmations (one per user and chat)

Revision ID: b5e2c8d17a43
Revises: a7b3d9e41c52
Create Date: 2026-10-28 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b5e2c8d17a43'
down_revision: Union[str, Sequence[str], None] = 'a7b3d9e41c52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The app also creates missing tables at startup, so the table may already exist.
    if 'ai_pending_confirmations' in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        'ai_pending_confirmations',
        sa.Column('user_id', sa.String(length=36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('session_id', sa.String(length=100), nullable=False),
        sa.Column('tool', sa.String(length=64), nullable=False),
        sa.Column('target_id', sa.String(length=255), nullable=False),
        sa.Column('expires_at', sa.String(length=32), nullable=False),
        sa.Column('created_at', sa.String(length=32), nullable=False),
        sa.PrimaryKeyConstraint('user_id', 'session_id'),
    )


def downgrade() -> None:
    op.drop_table('ai_pending_confirmations')
