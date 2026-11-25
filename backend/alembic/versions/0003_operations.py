"""CSV confirmation bindings and administrator idle setting.

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("admin_users", sa.Column("session_idle_minutes", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "idle_minutes_range",
        "admin_users",
        "session_idle_minutes IS NULL OR session_idle_minutes BETWEEN 1 AND 720",
    )
    op.create_table(
        "csv_receipts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("user_sessions.id"), nullable=False),
        sa.Column("file_digest", sa.LargeBinary(), nullable=False),
        sa.Column("options", postgresql.JSONB(), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("octet_length(file_digest) = 32", name="file_digest_length"),
    )
    op.create_index("ix_csv_receipts_session_id", "csv_receipts", ["session_id"])
    op.create_index("ix_csv_receipts_expires_at", "csv_receipts", ["expires_at"])


def downgrade():
    op.drop_table("csv_receipts")
    op.drop_constraint("idle_minutes_range", "admin_users", type_="check")
    op.drop_column("admin_users", "session_idle_minutes")
