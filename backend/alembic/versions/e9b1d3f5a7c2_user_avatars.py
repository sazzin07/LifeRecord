"""user_avatars: a profile photo per person (the file lives under avatars/<user id>/)

Revision ID: e9b1d3f5a7c2
Revises: d7a9c1e3f5b8
Create Date: 2026-11-04 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e9b1d3f5a7c2'
down_revision: Union[str, Sequence[str], None] = 'd7a9c1e3f5b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema. The table may already exist because the app creates missing tables on startup."""
    if 'user_avatars' not in set(sa.inspect(op.get_bind()).get_table_names()):
        op.create_table(
            'user_avatars',
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('storage_path', sa.String(255), nullable=False),
            sa.Column('content_type', sa.String(30), nullable=False),
            sa.Column('updated_ms', sa.BigInteger(), nullable=False),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('user_avatars')
