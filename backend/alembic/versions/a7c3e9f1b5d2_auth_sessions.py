"""auth_sessions: server-side sessions, so signing out (or restarting the server) ends a session at once

Revision ID: a7c3e9f1b5d2
Revises: b5d7f9a1c3e4
Create Date: 2026-11-02 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a7c3e9f1b5d2'
down_revision: Union[str, Sequence[str], None] = 'b5d7f9a1c3e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema. The table may already exist because the app creates missing tables on startup."""
    if 'auth_sessions' in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        'auth_sessions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_ms', sa.BigInteger(), nullable=False),
        sa.Column('expires_ms', sa.BigInteger(), nullable=False),
    )
    op.create_index('ix_auth_sessions_user_id', 'auth_sessions', ['user_id'])
    op.create_index('ix_auth_sessions_expires_ms', 'auth_sessions', ['expires_ms'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('auth_sessions')
