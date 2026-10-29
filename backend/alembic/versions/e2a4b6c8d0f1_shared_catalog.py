"""products.user_id becomes nullable: NULL marks the shared built-in catalog

Revision ID: e2a4b6c8d0f1
Revises: d1f2a3b4c5e6
Create Date: 2026-10-29 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e2a4b6c8d0f1'
down_revision: Union[str, Sequence[str], None] = 'd1f2a3b4c5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('products', 'user_id', existing_type=sa.String(36), nullable=True)


def downgrade() -> None:
    # shared rows have no owner and cannot satisfy NOT NULL; remove them first
    op.execute("DELETE FROM products WHERE user_id IS NULL")
    op.alter_column('products', 'user_id', existing_type=sa.String(36), nullable=False)
