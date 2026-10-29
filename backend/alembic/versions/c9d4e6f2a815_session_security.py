"""session security: users.token_version, rate_limit_events

Revision ID: c9d4e6f2a815
Revises: b5e2c8d17a43
Create Date: 2026-10-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c9d4e6f2a815'
down_revision: Union[str, Sequence[str], None] = 'b5e2c8d17a43'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema. The rate-limit table may already exist because the app creates missing tables on startup."""
    inspector = sa.inspect(op.get_bind())
    if 'token_version' not in [c['name'] for c in inspector.get_columns('users')]:
        op.add_column('users', sa.Column('token_version', sa.Integer(), nullable=False, server_default='0'))
    if 'rate_limit_events' not in inspector.get_table_names():
        op.create_table(
            'rate_limit_events',
            sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column('bucket', sa.String(64), nullable=False),
            sa.Column('at_ms', sa.BigInteger(), nullable=False),
        )
        op.create_index('ix_rate_limit_events_bucket', 'rate_limit_events', ['bucket'])
        op.create_index('ix_rate_limit_events_at_ms', 'rate_limit_events', ['at_ms'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('rate_limit_events')
    op.drop_column('users', 'token_version')
