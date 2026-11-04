"""recurring_transactions: rules that become real transactions on their due day (F-11), and transactions.recurring_id

Revision ID: a1c3e5f7b9d2
Revises: e9b1d3f5a7c2
Create Date: 2026-11-04 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1c3e5f7b9d2'
down_revision: Union[str, Sequence[str], None] = 'e9b1d3f5a7c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """The table may already exist because the app creates missing tables on startup; the column and index never are."""
    insp = sa.inspect(op.get_bind())
    if 'recurring_transactions' not in set(insp.get_table_names()):
        op.create_table(
            'recurring_transactions',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('kind', sa.String(10), nullable=False),
            sa.Column('amount', sa.DECIMAL(12, 2), nullable=False),
            sa.Column('account', sa.String(50), nullable=False),
            sa.Column('category', sa.String(255), nullable=True),
            sa.Column('merchant', sa.String(255), nullable=True),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('repeat', sa.String(10), nullable=False),
            sa.Column('anchor_day', sa.Integer(), nullable=False),
            sa.Column('next_due', sa.String(10), nullable=False, index=True),
            sa.Column('end_date', sa.String(10), nullable=True),
            sa.Column('status', sa.String(10), nullable=False, server_default='active'),
            sa.Column('note', sa.String(255), nullable=True),
            sa.Column('last_created', sa.String(10), nullable=True),
            sa.Column('seen_through', sa.String(10), nullable=True),
            sa.Column('created_at', sa.String(32), nullable=False),
        )
    cols = {c['name'] for c in insp.get_columns('transactions')}
    if 'recurring_id' not in cols:
        op.add_column('transactions', sa.Column('recurring_id', sa.String(36), nullable=True))
    if 'uq_transactions_recurring_day' not in {i['name'] for i in insp.get_indexes('transactions')}:
        op.create_index('uq_transactions_recurring_day', 'transactions', ['recurring_id', 'date'], unique=True)


def downgrade() -> None:
    op.drop_index('uq_transactions_recurring_day', table_name='transactions')
    op.drop_column('transactions', 'recurring_id')
    op.drop_table('recurring_transactions')
