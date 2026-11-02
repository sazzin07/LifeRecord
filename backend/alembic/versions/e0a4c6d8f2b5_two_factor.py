"""totp_credentials and totp_recovery_codes: the optional second step at sign-in

Revision ID: e0a4c6d8f2b5
Revises: d9f3b5c7e1a4
Create Date: 2026-11-02 22:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e0a4c6d8f2b5'
down_revision: Union[str, Sequence[str], None] = 'd9f3b5c7e1a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema. The tables may already exist because the app creates missing tables on startup."""
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if 'totp_credentials' not in existing:
        op.create_table(
            'totp_credentials',
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('secret_enc', sa.String(255), nullable=False),
            sa.Column('confirmed_ms', sa.BigInteger(), nullable=True),
            sa.Column('last_step', sa.BigInteger(), nullable=False, server_default='0'),
            sa.Column('created_ms', sa.BigInteger(), nullable=False),
        )
    if 'totp_recovery_codes' not in existing:
        op.create_table(
            'totp_recovery_codes',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('code_hash', sa.String(64), nullable=False),
            sa.Column('used_ms', sa.BigInteger(), nullable=True),
        )
        op.create_index('ix_totp_recovery_codes_user_id', 'totp_recovery_codes', ['user_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('totp_recovery_codes')
    op.drop_table('totp_credentials')
