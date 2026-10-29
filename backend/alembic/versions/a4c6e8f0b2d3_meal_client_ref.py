"""meals.client_ref: lets a client retry a request without creating a duplicate entry

Revision ID: a4c6e8f0b2d3
Revises: f3b5c7d9e1a2
Create Date: 2026-10-29 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a4c6e8f0b2d3'
down_revision: Union[str, Sequence[str], None] = 'f3b5c7d9e1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if 'client_ref' not in [c['name'] for c in insp.get_columns('meals')]:
        op.add_column('meals', sa.Column('client_ref', sa.String(64), nullable=True))
    if 'ix_meals_client_ref' not in [i['name'] for i in insp.get_indexes('meals')]:
        op.create_index('ix_meals_client_ref', 'meals', ['user_id', 'client_ref'])


def downgrade() -> None:
    op.drop_index('ix_meals_client_ref', table_name='meals')
    op.drop_column('meals', 'client_ref')
