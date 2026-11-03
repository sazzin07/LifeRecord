"""account_favorites: which place is the favourite of each main account, and which main account is the overall favourite

Revision ID: b3d5f7a9c1e4
Revises: a1c5e7b9d3f2
Create Date: 2026-11-03 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b3d5f7a9c1e4'
down_revision: Union[str, Sequence[str], None] = 'a1c5e7b9d3f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema. The table may already exist because the app creates missing tables on startup (which also gives every
    main account its Default place)."""
    if 'account_favorites' not in set(sa.inspect(op.get_bind()).get_table_names()):
        op.create_table(
            'account_favorites',
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('scope', sa.String(36), primary_key=True),
            sa.Column('account_id', sa.String(36), nullable=False),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('account_favorites')
