"""authentication state, encrypted enrollment and persistent throttles

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pre_auth_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("csrf_token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("octet_length(token_hash) = 32", name="token_hash_length"),
        sa.CheckConstraint("octet_length(csrf_token_hash) = 32", name="csrf_hash_length"),
    )
    op.create_index("ix_pre_auth_sessions_expires_at", "pre_auth_sessions", ["expires_at"])
    op.create_table(
        "auth_throttles",
        sa.Column("key", sa.String(80), primary_key=True),
        sa.Column("failures", sa.Integer(), nullable=False),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("blocked_until", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("failures >= 0", name="failures_nonnegative"),
    )
    op.add_column("user_sessions", sa.Column("pending_totp_ciphertext", sa.LargeBinary()))
    op.add_column("user_sessions", sa.Column("pending_totp_nonce", sa.LargeBinary()))
    op.add_column("user_sessions", sa.Column("pending_totp_key_version", sa.SmallInteger()))
    op.add_column("user_sessions", sa.Column("pending_totp_expires_at", sa.DateTime(timezone=True)))
    op.create_check_constraint(
        "pending_totp_bundle",
        "user_sessions",
        "(pending_totp_ciphertext IS NULL AND pending_totp_nonce IS NULL AND pending_totp_key_version IS NULL AND pending_totp_expires_at IS NULL) OR (pending_totp_ciphertext IS NOT NULL AND octet_length(pending_totp_ciphertext) >= 16 AND pending_totp_nonce IS NOT NULL AND octet_length(pending_totp_nonce) = 12 AND pending_totp_key_version IS NOT NULL AND pending_totp_key_version >= 1 AND pending_totp_expires_at IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint("pending_totp_bundle", "user_sessions", type_="check")
    for column in (
        "pending_totp_expires_at",
        "pending_totp_key_version",
        "pending_totp_nonce",
        "pending_totp_ciphertext",
    ):
        op.drop_column("user_sessions", column)
    op.drop_table("auth_throttles")
    op.drop_index("ix_pre_auth_sessions_expires_at", table_name="pre_auth_sessions")
    op.drop_table("pre_auth_sessions")
