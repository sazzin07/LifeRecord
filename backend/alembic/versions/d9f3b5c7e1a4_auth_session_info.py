"""auth_session_info: one row per session with its current refresh token generation and what the session list shows

Revision ID: d9f3b5c7e1a4
Revises: c8e2a4b6d0f3
Create Date: 2026-11-02 21:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd9f3b5c7e1a4'
down_revision: Union[str, Sequence[str], None] = 'c8e2a4b6d0f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema. The table may already exist because the app creates missing tables on startup."""
    if 'auth_session_info' in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        'auth_session_info',
        sa.Column('session_id', sa.String(36), sa.ForeignKey('auth_sessions.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('refresh_jti', sa.String(36), nullable=False),
        sa.Column('previous_jti', sa.String(36), nullable=True),
        sa.Column('rotated_ms', sa.BigInteger(), nullable=False),
        sa.Column('rotation_key', sa.String(64), nullable=True),
        sa.Column('device', sa.String(80), nullable=False),
        sa.Column('last_seen_ms', sa.BigInteger(), nullable=False),
    )
    op.create_index('ix_auth_session_info_user_id', 'auth_session_info', ['user_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('auth_session_info')
