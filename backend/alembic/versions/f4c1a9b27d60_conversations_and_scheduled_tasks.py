"""saved conversations and scheduled AI tasks

Revision ID: f4c1a9b27d60
Revises: d3a7c5e91b24
Create Date: 2026-10-23 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f4c1a9b27d60'
down_revision: Union[str, Sequence[str], None] = 'd3a7c5e91b24'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    """Upgrade schema. Tables may already exist because the app creates missing tables on startup."""
    cols = [c['name'] for c in sa.inspect(op.get_bind()).get_columns('ai_messages')]
    if 'meta' not in cols:
        op.add_column('ai_messages', sa.Column('meta', sa.JSON(), nullable=True))

    if not _has_table('ai_conversations'):
        op.create_table(
            'ai_conversations',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('title', sa.String(255), nullable=False),
            sa.Column('title_source', sa.String(16), nullable=False),
            sa.Column('archived', sa.Boolean(), nullable=False),
            sa.Column('preview', sa.String(300), nullable=False),
            sa.Column('message_count', sa.Integer(), nullable=False),
            sa.Column('created_at', sa.String(32), nullable=False),
            sa.Column('updated_at', sa.String(32), nullable=False),
        )
        op.create_index('ix_ai_conversations_user_id', 'ai_conversations', ['user_id'])
        op.create_index('ix_ai_conversations_user_updated', 'ai_conversations', ['user_id', 'updated_at'])

    if not _has_table('scheduled_tasks'):
        op.create_table(
            'scheduled_tasks',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('title', sa.String(255), nullable=False),
            sa.Column('instruction', sa.Text(), nullable=False),
            sa.Column('schedule', sa.JSON(), nullable=False),
            sa.Column('timezone', sa.String(64), nullable=False),
            sa.Column('data_sources', sa.JSON(), nullable=True),
            sa.Column('recipients', sa.JSON(), nullable=True),
            sa.Column('status', sa.String(16), nullable=False),
            sa.Column('next_run_at', sa.String(32), nullable=True),
            sa.Column('last_run_at', sa.String(32), nullable=True),
            sa.Column('last_status', sa.String(16), nullable=True),
            sa.Column('confirmed_at', sa.String(32), nullable=True),
            sa.Column('created_at', sa.String(32), nullable=False),
            sa.Column('updated_at', sa.String(32), nullable=False),
        )
        op.create_index('ix_scheduled_tasks_user_id', 'scheduled_tasks', ['user_id'])
        op.create_index('ix_scheduled_tasks_next_run_at', 'scheduled_tasks', ['next_run_at'])

    if not _has_table('scheduled_task_runs'):
        op.create_table(
            'scheduled_task_runs',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('task_id', sa.String(36), sa.ForeignKey('scheduled_tasks.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('run_key', sa.String(80), nullable=False),
            sa.Column('trigger', sa.String(16), nullable=False),
            sa.Column('scheduled_for', sa.String(32), nullable=False),
            sa.Column('status', sa.String(16), nullable=False),
            sa.Column('started_at', sa.String(32), nullable=True),
            sa.Column('finished_at', sa.String(32), nullable=True),
            sa.Column('duration_ms', sa.Integer(), nullable=True),
            sa.Column('output', sa.Text(), nullable=True),
            sa.Column('error', sa.Text(), nullable=True),
            sa.Column('tools_used', sa.JSON(), nullable=True),
            sa.Column('data_errors', sa.JSON(), nullable=True),
            sa.Column('delivery_status', sa.String(16), nullable=False),
            sa.Column('delivery_detail', sa.String(500), nullable=True),
            sa.Column('delivered_at', sa.String(32), nullable=True),
            sa.Column('created_at', sa.String(32), nullable=False),
        )
        op.create_index('ix_scheduled_task_runs_task_id', 'scheduled_task_runs', ['task_id'])
        op.create_index('ix_scheduled_task_runs_user_id', 'scheduled_task_runs', ['user_id'])
        op.create_index('uq_task_run_key', 'scheduled_task_runs', ['task_id', 'run_key'], unique=True)

    if not _has_table('report_recipients'):
        op.create_table(
            'report_recipients',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('email', sa.String(255), nullable=False),
            sa.Column('verified', sa.Boolean(), nullable=False),
            sa.Column('code_hash', sa.String(128), nullable=True),
            sa.Column('code_expires_at', sa.String(32), nullable=True),
            sa.Column('attempts', sa.Integer(), nullable=False),
            sa.Column('last_sent_at', sa.String(32), nullable=True),
            sa.Column('created_at', sa.String(32), nullable=False),
        )
        op.create_index('ix_report_recipients_user_id', 'report_recipients', ['user_id'])
        op.create_index('uq_report_recipient', 'report_recipients', ['user_id', 'email'], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    for t in ('report_recipients', 'scheduled_task_runs', 'scheduled_tasks', 'ai_conversations'):
        if _has_table(t):
            op.drop_table(t)
    op.drop_column('ai_messages', 'meta')
