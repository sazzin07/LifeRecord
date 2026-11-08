"""recipes.cook_minutes: an optional cooking time, so Groceries can offer "Under 20 min"

Revision ID: e6c8a0b2d4f1
Revises: d5b7f9a1c3e4
Create Date: 2026-11-08 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e6c8a0b2d4f1'
down_revision: Union[str, Sequence[str], None] = 'd5b7f9a1c3e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema. Existing recipes get no time (NULL), which the page treats as "not given"."""
    cols = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('recipes')}
    if 'cook_minutes' not in cols:
        op.add_column('recipes', sa.Column('cook_minutes', sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    cols = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('recipes')}
    if 'cook_minutes' in cols:
        op.drop_column('recipes', 'cook_minutes')
