"""add product subcategory, tags and icon

Revision ID: d3a7c5e91b24
Revises: b66bb47b38c7
Create Date: 2026-10-22 12:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3a7c5e91b24'
down_revision: Union[str, Sequence[str], None] = 'b66bb47b38c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('products', sa.Column('subcategory', sa.String(length=100), nullable=True))
    op.add_column('products', sa.Column('tags', sa.JSON(), nullable=True))
    op.add_column('products', sa.Column('icon', sa.String(length=16), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('products', 'icon')
    op.drop_column('products', 'tags')
    op.drop_column('products', 'subcategory')
