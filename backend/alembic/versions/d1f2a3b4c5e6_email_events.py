"""email_events: outcome log for account emails

Revision ID: d1f2a3b4c5e6
Revises: c9d4e6f2a815
Create Date: 2026-10-29 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd1f2a3b4c5e6'
down_revision: Union[str, Sequence[str], None] = 'c9d4e6f2a815'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """The table may already exist because the app creates missing tables on startup."""
    if 'email_events' in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        'email_events',
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('purpose', sa.String(32), nullable=False),
        sa.Column('recipient_hash', sa.String(64), nullable=False),
        sa.Column('recipient_domain', sa.String(255), nullable=False),
        sa.Column('provider', sa.String(16), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('detail', sa.String(255), nullable=False),
        sa.Column('created_at', sa.String(32), nullable=False),
    )
    op.create_index('ix_email_events_purpose', 'email_events', ['purpose'])
    op.create_index('ix_email_events_recipient_hash', 'email_events', ['recipient_hash'])


def downgrade() -> None:
    op.drop_table('email_events')
