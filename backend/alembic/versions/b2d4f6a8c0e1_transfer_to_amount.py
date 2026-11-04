"""transactions.to_amount: what arrived in the receiving place when a transfer crosses two currencies (F-09)

Revision ID: b2d4f6a8c0e1
Revises: a1c3e5f7b9d2
Create Date: 2026-11-04 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b2d4f6a8c0e1'
down_revision: Union[str, Sequence[str], None] = 'a1c3e5f7b9d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    cols = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('transactions')}
    if 'to_amount' not in cols:
        op.add_column('transactions', sa.Column('to_amount', sa.DECIMAL(12, 2), nullable=True))


def downgrade() -> None:
    op.drop_column('transactions', 'to_amount')
