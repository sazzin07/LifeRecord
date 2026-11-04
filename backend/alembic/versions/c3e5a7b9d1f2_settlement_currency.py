"""settlements.currency: the ledger a payment counts in when it went through no account (F-19)

Revision ID: c3e5a7b9d1f2
Revises: b2d4f6a8c0e1
Create Date: 2026-11-04 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c3e5a7b9d1f2'
down_revision: Union[str, Sequence[str], None] = 'b2d4f6a8c0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    cols = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('settlements')}
    if 'currency' not in cols:
        op.add_column('settlements', sa.Column('currency', sa.String(3), nullable=True))


def downgrade() -> None:
    op.drop_column('settlements', 'currency')
