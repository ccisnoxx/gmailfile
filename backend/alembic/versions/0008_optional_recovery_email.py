"""Allow accounts without a recovery email while keeping mutual exclusion.

Revision ID: 0008
Revises: 0007
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_gmail_accounts_recovery_xor", "gmail_accounts", type_="check")
    op.create_check_constraint(
        "ck_gmail_accounts_recovery_xor",
        "gmail_accounts",
        "NOT (recovery_account_id IS NOT NULL AND recovery_email_external IS NOT NULL)",
    )


def downgrade() -> None:
    bind = op.get_bind()
    missing_count = bind.execute(
        sa.text(
            "SELECT count(*) FROM gmail_accounts "
            "WHERE recovery_account_id IS NULL AND recovery_email_external IS NULL"
        )
    ).scalar_one()
    if missing_count > 0:
        raise RuntimeError(
            f"无法回退迁移 0008 -> 0007：gmail_accounts 中存在 {missing_count} 条未设置辅助邮箱的账号，"
            "请先为这些账号补齐辅助邮箱，或通过加密备份执行隔离恢复回退。"
        )
    op.drop_constraint("ck_gmail_accounts_recovery_xor", "gmail_accounts", type_="check")
    op.create_check_constraint(
        "ck_gmail_accounts_recovery_xor",
        "gmail_accounts",
        "(recovery_account_id IS NOT NULL) <> (recovery_email_external IS NOT NULL)",
    )
