"""WebAuthn/FIDO2 credentials and single-use anti-replay challenges.

Revision ID: 0005
Revises: 0004
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "admin_webauthn_credentials",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("admin_user_id", sa.Uuid(), nullable=False),
        sa.Column("credential_id", sa.LargeBinary(), nullable=False),
        sa.Column("public_key", sa.LargeBinary(), nullable=False),
        sa.Column("sign_count", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("label", sa.String(length=64), nullable=False),
        sa.Column(
            "transports",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("aaguid", sa.String(length=36), nullable=True),
        sa.Column("discoverable", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("backup_eligible", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("backup_state", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "sign_count >= 0", name="ck_admin_webauthn_credentials_sign_count_nonnegative"
        ),
        sa.CheckConstraint(
            "octet_length(credential_id) BETWEEN 16 AND 1024",
            name="ck_admin_webauthn_credentials_credential_id_length",
        ),
        sa.CheckConstraint(
            "octet_length(public_key) >= 16",
            name="ck_admin_webauthn_credentials_public_key_length",
        ),
        sa.ForeignKeyConstraint(
            ["admin_user_id"],
            ["admin_users.id"],
            name="fk_admin_webauthn_credentials_admin_user_id_admin_users",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_admin_webauthn_credentials"),
        sa.UniqueConstraint("credential_id", name="uq_admin_webauthn_credentials_credential_id"),
    )
    op.create_index(
        "ix_admin_webauthn_credentials_admin_user_id",
        "admin_webauthn_credentials",
        ["admin_user_id"],
        unique=False,
    )

    op.create_table(
        "webauthn_challenges",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("purpose", sa.String(length=24), nullable=False),
        sa.Column("challenge", sa.LargeBinary(), nullable=False),
        sa.Column("pre_auth_session_id", sa.Uuid(), nullable=True),
        sa.Column("user_session_id", sa.Uuid(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "purpose IN ('register', 'login', 'mfa_login', 'step_up')",
            name="ck_webauthn_challenges_purpose_valid",
        ),
        sa.CheckConstraint(
            "octet_length(challenge) = 32",
            name="ck_webauthn_challenges_challenge_length",
        ),
        sa.CheckConstraint(
            "(pre_auth_session_id IS NOT NULL) <> (user_session_id IS NOT NULL)",
            name="ck_webauthn_challenges_session_binding_xor",
        ),
        sa.ForeignKeyConstraint(
            ["pre_auth_session_id"],
            ["pre_auth_sessions.id"],
            name="fk_webauthn_challenges_pre_auth_session_id_pre_auth_sessions",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_session_id"],
            ["user_sessions.id"],
            name="fk_webauthn_challenges_user_session_id_user_sessions",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_webauthn_challenges"),
        sa.UniqueConstraint("challenge", name="uq_webauthn_challenges_challenge"),
    )
    op.create_index(
        "ix_webauthn_challenges_pre_auth_session_id",
        "webauthn_challenges",
        ["pre_auth_session_id"],
        unique=False,
    )
    op.create_index(
        "ix_webauthn_challenges_user_session_id",
        "webauthn_challenges",
        ["user_session_id"],
        unique=False,
    )
    op.create_index(
        "ix_webauthn_challenges_expires_at",
        "webauthn_challenges",
        ["expires_at"],
        unique=False,
    )

    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gm_app') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE admin_webauthn_credentials TO gm_app;
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE webauthn_challenges TO gm_app;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_webauthn_challenges_expires_at", table_name="webauthn_challenges")
    op.drop_index("ix_webauthn_challenges_user_session_id", table_name="webauthn_challenges")
    op.drop_index("ix_webauthn_challenges_pre_auth_session_id", table_name="webauthn_challenges")
    op.drop_table("webauthn_challenges")
    op.drop_index(
        "ix_admin_webauthn_credentials_admin_user_id",
        table_name="admin_webauthn_credentials",
    )
    op.drop_table("admin_webauthn_credentials")
