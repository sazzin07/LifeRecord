"""nutrition: foods, profile, hydration, diary fields on meals, nutrients on recipes

Revision ID: f3b5c7d9e1a2
Revises: e2a4b6c8d0f1
Create Date: 2026-10-29 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f3b5c7d9e1a2'
down_revision: Union[str, Sequence[str], None] = 'e2a4b6c8d0f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cols(table):
    return [c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)]


def upgrade() -> None:
    """Idempotent: the app also creates missing tables on startup, so each step checks first."""
    have = _cols('meals')
    add = [
        sa.Column('meal_type', sa.String(20), nullable=False, server_default='other'),
        sa.Column('meal_label', sa.String(100), nullable=True),
        sa.Column('eaten_at', sa.String(5), nullable=True),
        sa.Column('food_id', sa.String(36), nullable=True),
        sa.Column('recipe_id', sa.String(36), nullable=True),
        sa.Column('quantity', sa.DECIMAL(10, 2), nullable=True),
        sa.Column('unit', sa.String(50), nullable=True),
        sa.Column('grams', sa.DECIMAL(10, 2), nullable=True),
        sa.Column('nutrients', sa.JSON(), nullable=True),
        sa.Column('quality', sa.String(16), nullable=True),
        sa.Column('entry_source', sa.String(16), nullable=True),
        sa.Column('updated_at', sa.String(32), nullable=True),
    ]
    for col in add:
        if col.name not in have:
            op.add_column('meals', col)
    if 'ix_meals_food_id' not in [i['name'] for i in sa.inspect(op.get_bind()).get_indexes('meals')]:
        op.create_index('ix_meals_food_id', 'meals', ['food_id'])
    rcols = _cols('recipes')
    if 'nutrients' not in rcols:
        op.add_column('recipes', sa.Column('nutrients', sa.JSON(), nullable=True))
    if 'quality' not in rcols:
        op.add_column('recipes', sa.Column('quality', sa.String(16), nullable=True))
    tables = sa.inspect(op.get_bind()).get_table_names()
    if 'foods' not in tables:
        op.create_table(
            'foods',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=True),
            sa.Column('source', sa.String(24), nullable=False),
            sa.Column('source_id', sa.String(64), nullable=True),
            sa.Column('name', sa.String(500), nullable=False),
            sa.Column('name_lower', sa.String(255), nullable=False),
            sa.Column('brand', sa.String(255), nullable=True),
            sa.Column('barcode', sa.String(32), nullable=True),
            sa.Column('category', sa.String(150), nullable=True),
            sa.Column('quality', sa.String(16), nullable=False),
            sa.Column('nutrients', sa.JSON(), nullable=False),
            sa.Column('portions', sa.JSON(), nullable=True),
            sa.Column('data_version', sa.String(80), nullable=True),
            sa.Column('created_at', sa.String(32), nullable=False),
            sa.Column('updated_at', sa.String(32), nullable=True),
        )
        op.create_index('ix_foods_user_id', 'foods', ['user_id'])
        op.create_index('ix_foods_source', 'foods', ['source'])
        op.create_index('ix_foods_name_lower', 'foods', ['name_lower'])
        op.create_index('ix_foods_barcode', 'foods', ['barcode'])
        op.create_index('ux_foods_source', 'foods', ['source', 'source_id', 'user_id'])
    if 'food_favorites' not in tables:
        op.create_table(
            'food_favorites',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('food_id', sa.String(36), sa.ForeignKey('foods.id', ondelete='CASCADE'), nullable=False),
            sa.Column('created_at', sa.String(32), nullable=False),
        )
        op.create_index('ix_food_favorites_user_id', 'food_favorites', ['user_id'])
        op.create_index('ux_food_favorites', 'food_favorites', ['user_id', 'food_id'], unique=True)
    if 'nutrition_profiles' not in tables:
        op.create_table(
            'nutrition_profiles',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, unique=True),
            sa.Column('birth_year', sa.Integer(), nullable=True),
            sa.Column('sex', sa.String(1), nullable=True),
            sa.Column('height_cm', sa.DECIMAL(5, 1), nullable=True),
            sa.Column('weight_kg', sa.DECIMAL(5, 1), nullable=True),
            sa.Column('activity', sa.String(16), nullable=True),
            sa.Column('pregnancy', sa.String(20), nullable=True),
            sa.Column('diet_tags', sa.JSON(), nullable=True),
            sa.Column('allergies', sa.JSON(), nullable=True),
            sa.Column('target_overrides', sa.JSON(), nullable=True),
            sa.Column('timezone', sa.String(64), nullable=True),
            sa.Column('updated_at', sa.String(32), nullable=True),
        )
    if 'hydration_entries' not in tables:
        op.create_table(
            'hydration_entries',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('date', sa.String(10), nullable=False),
            sa.Column('eaten_at', sa.String(5), nullable=True),
            sa.Column('amount_ml', sa.Integer(), nullable=False),
            sa.Column('beverage', sa.String(24), nullable=False),
            sa.Column('created_at', sa.String(32), nullable=False),
        )
        op.create_index('ix_hydration_entries_user_id', 'hydration_entries', ['user_id'])
        op.create_index('ix_hydration_entries_date', 'hydration_entries', ['date'])


def downgrade() -> None:
    for t in ('hydration_entries', 'nutrition_profiles', 'food_favorites', 'foods'):
        op.drop_table(t)
    op.drop_column('recipes', 'quality')
    op.drop_column('recipes', 'nutrients')
    op.drop_index('ix_meals_food_id', table_name='meals')
    for c in ('updated_at', 'entry_source', 'quality', 'nutrients', 'grams', 'unit', 'quantity', 'recipe_id', 'food_id', 'eaten_at', 'meal_label', 'meal_type'):
        op.drop_column('meals', c)
