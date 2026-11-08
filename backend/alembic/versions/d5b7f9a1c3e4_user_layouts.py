"""user_layouts: how a person arranged a page (the Groceries Today widgets and the space it is focused on)

Revision ID: d5b7f9a1c3e4
Revises: c3e5a7b9d1f2
Create Date: 2026-11-07 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd5b7f9a1c3e4'
down_revision: Union[str, Sequence[str], None] = 'c3e5a7b9d1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema. The table may already exist because the app creates missing tables on startup."""
    if 'user_layouts' not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            'user_layouts',
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('page', sa.String(32), primary_key=True),
            sa.Column('layout', sa.JSON(), nullable=False),
            sa.Column('updated_at', sa.String(32), nullable=False),
        )


def downgrade() -> None:
    """Downgrade schema."""
    if 'user_layouts' in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table('user_layouts')
