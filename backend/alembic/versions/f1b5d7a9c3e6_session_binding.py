"""auth_session_info.public_key: the key a session is bound to (session_binding.py)

Revision ID: f1b5d7a9c3e6
Revises: e0a4c6d8f2b5
Create Date: 2026-11-02 23:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f1b5d7a9c3e6'
down_revision: Union[str, Sequence[str], None] = 'e0a4c6d8f2b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema. The table may have been created already with this column (the app creates missing tables on start-up)."""
    columns = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('auth_session_info')}
    if 'public_key' not in columns:
        op.add_column('auth_session_info', sa.Column('public_key', sa.String(300), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('auth_session_info', 'public_key')
