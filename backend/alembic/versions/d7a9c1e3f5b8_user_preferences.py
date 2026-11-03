"""user_preferences: the choices a person saved (theme, animations, week start, what Money opens on)

Revision ID: d7a9c1e3f5b8
Revises: c5f7a9b1d3e6
Create Date: 2026-11-04 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd7a9c1e3f5b8'
down_revision: Union[str, Sequence[str], None] = 'c5f7a9b1d3e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema. The tables may already exist because the app creates missing tables on startup."""
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if 'user_preferences' not in existing:
        op.create_table(
            'user_preferences',
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('theme', sa.String(10), nullable=False),
            sa.Column('animations', sa.Boolean(), nullable=False),
            sa.Column('week_start', sa.String(10), nullable=False),
            sa.Column('money_period', sa.String(10), nullable=False),
            sa.Column('updated_at', sa.String(32), nullable=False),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('user_preferences')
