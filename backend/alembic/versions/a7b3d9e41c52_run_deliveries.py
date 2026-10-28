"""per-recipient delivery results on scheduled runs

Revision ID: a7b3d9e41c52
Revises: f4c1a9b27d60
Create Date: 2026-10-23 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a7b3d9e41c52'
down_revision: Union[str, Sequence[str], None] = 'f4c1a9b27d60'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    cols = [c['name'] for c in sa.inspect(op.get_bind()).get_columns('scheduled_task_runs')]
    if 'deliveries' not in cols:
        op.add_column('scheduled_task_runs', sa.Column('deliveries', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('scheduled_task_runs', 'deliveries')
