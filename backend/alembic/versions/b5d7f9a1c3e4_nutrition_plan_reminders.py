"""nutrition delivery 2: meal plan entries, profile reminders, recipe nutrition metadata

Revision ID: b5d7f9a1c3e4
Revises: a4c6e8f0b2d3
Create Date: 2026-10-30 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b5d7f9a1c3e4'
down_revision: Union[str, Sequence[str], None] = 'a4c6e8f0b2d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(insp, table: str, column: str) -> bool:
    return column in [c['name'] for c in insp.get_columns(table)]


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if not _has_column(insp, 'recipes', 'nutrition_meta'):
        op.add_column('recipes', sa.Column('nutrition_meta', sa.JSON(), nullable=True))
    if not _has_column(insp, 'nutrition_profiles', 'reminders'):
        op.add_column('nutrition_profiles', sa.Column('reminders', sa.JSON(), nullable=True))
    if 'meal_plan_entries' not in insp.get_table_names():
        op.create_table(
            'meal_plan_entries',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('date', sa.String(10), nullable=False),
            sa.Column('meal_type', sa.String(20), nullable=False, server_default='other'),
            sa.Column('eaten_at', sa.String(5), nullable=True),
            sa.Column('description', sa.String(500), nullable=False),
            sa.Column('food_id', sa.String(36), nullable=True),
            sa.Column('recipe_id', sa.String(36), nullable=True),
            sa.Column('quantity', sa.DECIMAL(10, 2), nullable=True),
            sa.Column('unit', sa.String(50), nullable=True),
            sa.Column('grams', sa.DECIMAL(10, 2), nullable=True),
            sa.Column('nutrients', sa.JSON(), nullable=True),
            sa.Column('quality', sa.String(16), nullable=True),
            sa.Column('entry_source', sa.String(16), nullable=True),
            sa.Column('note', sa.String(500), nullable=True),
            sa.Column('status', sa.String(12), nullable=False, server_default='planned'),
            sa.Column('meal_id', sa.String(36), nullable=True),
            sa.Column('created_at', sa.String(32), nullable=False),
            sa.Column('updated_at', sa.String(32), nullable=True),
        )
        op.create_index('ix_meal_plan_user_date', 'meal_plan_entries', ['user_id', 'date'])


def downgrade() -> None:
    op.drop_index('ix_meal_plan_user_date', table_name='meal_plan_entries')
    op.drop_table('meal_plan_entries')
    op.drop_column('nutrition_profiles', 'reminders')
    op.drop_column('recipes', 'nutrition_meta')
