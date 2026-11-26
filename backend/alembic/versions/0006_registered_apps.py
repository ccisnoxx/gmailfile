"""Registered third-party apps catalog and per-account app status links.

Revision ID: 0006
Revises: 0005
"""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PRESET_APPS: tuple[tuple[str, str, int], ...] = (
    ("11111111-1111-4111-8111-000000000001", "Claude", 10),
    ("11111111-1111-4111-8111-000000000002", "ChatGPT", 20),
    ("11111111-1111-4111-8111-000000000003", "Cursor", 30),
    ("11111111-1111-4111-8111-000000000004", "Gemini", 40),
    ("11111111-1111-4111-8111-000000000005", "GitHub", 50),
    ("11111111-1111-4111-8111-000000000006", "Discord", 60),
    ("11111111-1111-4111-8111-000000000007", "X", 70),
)


def upgrade() -> None:
    op.create_table(
        "registered_apps",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("name_normalized", sa.String(length=64), nullable=False),
        sa.Column("sort_order", sa.SmallInteger(), server_default=sa.text("100"), nullable=False),
        sa.CheckConstraint("btrim(name) <> ''", name="ck_registered_apps_name_nonempty"),
        sa.CheckConstraint(
            "name_normalized = lower(btrim(name))",
            name="ck_registered_apps_name_normalized",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_registered_apps"),
        sa.UniqueConstraint("name_normalized", name="uq_registered_apps_name_normalized"),
    )

    op.create_table(
        "gmail_account_apps",
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("app_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=24),
            server_default="active",
            nullable=False,
        ),
        sa.Column("note", sa.String(length=200), nullable=True),
        sa.Column("banned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('active','restricted','banned')",
            name="ck_gmail_account_apps_status",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["gmail_accounts.id"],
            name="fk_gmail_account_apps_account_id_gmail_accounts",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["app_id"],
            ["registered_apps.id"],
            name="fk_gmail_account_apps_app_id_registered_apps",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("account_id", "app_id", name="pk_gmail_account_apps"),
    )
    op.create_index(
        "ix_gmail_account_apps_app_id_status",
        "gmail_account_apps",
        ["app_id", "status"],
        unique=False,
    )

    registered_apps_table = sa.table(
        "registered_apps",
        sa.column("id", sa.Uuid()),
        sa.column("name", sa.String()),
        sa.column("name_normalized", sa.String()),
        sa.column("sort_order", sa.SmallInteger()),
    )
    op.bulk_insert(
        registered_apps_table,
        [
            {
                "id": UUID(app_id),
                "name": name,
                "name_normalized": name.lower(),
                "sort_order": sort_order,
            }
            for app_id, name, sort_order in PRESET_APPS
        ],
    )

    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gm_app') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE registered_apps TO gm_app;
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE gmail_account_apps TO gm_app;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_gmail_account_apps_app_id_status", table_name="gmail_account_apps")
    op.drop_table("gmail_account_apps")
    op.drop_table("registered_apps")
