"""webauthn_credentials, webauthn_challenges, sms_factors and sms_codes: passkeys and text-message codes as second steps

Revision ID: a1c5e7b9d3f2
Revises: f1b5d7a9c3e6
Create Date: 2026-11-03 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1c5e7b9d3f2'
down_revision: Union[str, Sequence[str], None] = 'f1b5d7a9c3e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema. The tables may already exist because the app creates missing tables on startup."""
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    user_fk = lambda: sa.ForeignKey('users.id', ondelete='CASCADE')  # noqa: E731
    if 'webauthn_credentials' not in existing:
        op.create_table(
            'webauthn_credentials',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('user_id', sa.String(36), user_fk(), nullable=False),
            sa.Column('credential_id', sa.String(512), nullable=False, unique=True),
            sa.Column('public_key', sa.Text(), nullable=False),
            sa.Column('sign_count', sa.BigInteger(), nullable=False, server_default='0'),
            sa.Column('name', sa.String(60), nullable=False),
            sa.Column('transports', sa.String(120), nullable=True),
            sa.Column('created_ms', sa.BigInteger(), nullable=False),
            sa.Column('last_used_ms', sa.BigInteger(), nullable=True),
        )
        op.create_index('ix_webauthn_credentials_user_id', 'webauthn_credentials', ['user_id'])
    if 'webauthn_challenges' not in existing:
        op.create_table(
            'webauthn_challenges',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('user_id', sa.String(36), user_fk(), nullable=False),
            sa.Column('purpose', sa.String(12), nullable=False),
            sa.Column('challenge', sa.String(120), nullable=False),
            sa.Column('rp_id', sa.String(255), nullable=False),
            sa.Column('origin', sa.String(255), nullable=False),
            sa.Column('expires_ms', sa.BigInteger(), nullable=False),
        )
        op.create_index('ix_webauthn_challenges_user_id', 'webauthn_challenges', ['user_id'])
    if 'sms_factors' not in existing:
        op.create_table(
            'sms_factors',
            sa.Column('user_id', sa.String(36), user_fk(), primary_key=True),
            sa.Column('phone_enc', sa.String(255), nullable=False),
            sa.Column('phone_hint', sa.String(24), nullable=False),
            sa.Column('confirmed_ms', sa.BigInteger(), nullable=True),
            sa.Column('created_ms', sa.BigInteger(), nullable=False),
        )
    if 'sms_codes' not in existing:
        op.create_table(
            'sms_codes',
            sa.Column('user_id', sa.String(36), user_fk(), primary_key=True),
            sa.Column('code_hash', sa.String(64), nullable=False),
            sa.Column('expires_ms', sa.BigInteger(), nullable=False),
            sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('sent_ms', sa.BigInteger(), nullable=False),
        )


def downgrade() -> None:
    """Downgrade schema."""
    for table in ('sms_codes', 'sms_factors', 'webauthn_challenges', 'webauthn_credentials'):
        op.drop_table(table)
