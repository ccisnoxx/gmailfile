"""Support permanent account deletion from trash and persisted app icons/domains.

Revision ID: 0007
Revises: 0006
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PRESET_DOMAINS: tuple[tuple[str, str], ...] = (
    ("claude", "claude.ai"),
    ("chatgpt", "chatgpt.com"),
    ("cursor", "cursor.com"),
    ("gemini", "gemini.google.com"),
    ("github", "github.com"),
    ("discord", "discord.com"),
    ("x", "x.com"),
)


def upgrade() -> None:
    op.add_column(
        "registered_apps",
        sa.Column("domain", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "registered_apps",
        sa.Column("icon_data", sa.Text(), nullable=True),
    )
    op.create_check_constraint(
        "ck_registered_apps_domain_nonempty",
        "registered_apps",
        "domain IS NULL OR btrim(domain) <> ''",
    )
    op.create_check_constraint(
        "ck_registered_apps_icon_data_format",
        "registered_apps",
        "icon_data IS NULL OR ("
        "octet_length(icon_data) <= 98304 "
        "AND icon_data ~ '^data:image/(png|jpeg|webp|gif|x-icon|vnd\\.microsoft\\.icon);base64,[A-Za-z0-9+/=]+$'"
        ")",
    )

    for normalized_name, domain in PRESET_DOMAINS:
        op.execute(
            sa.text(
                "UPDATE registered_apps SET domain = :domain "
                "WHERE name_normalized = :name AND domain IS NULL"
            ).bindparams(domain=domain, name=normalized_name)
        )

    # 审计表为防篡改追加链（触发器禁止 UPDATE/DELETE），移除 account_id 外键以允许永久删除已入回收站账号，
    # 同时完整保留历史审计记录中的 account_id UUID 与哈希链连续性。
    op.drop_constraint(
        "fk_audit_events_account_id_gmail_accounts",
        "audit_events",
        type_="foreignkey",
    )

    # 标签关联表补充 ON DELETE CASCADE，与 gmail_account_apps 保持一致。
    op.drop_constraint(
        "fk_gmail_account_tags_account_id_gmail_accounts",
        "gmail_account_tags",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "fk_gmail_account_tags_account_id_gmail_accounts",
        "gmail_account_tags",
        "gmail_accounts",
        ["account_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    bind = op.get_bind()
    orphan_count = bind.execute(
        sa.text(
            "SELECT count(*) FROM audit_events a "
            "WHERE a.account_id IS NOT NULL "
            "AND NOT EXISTS (SELECT 1 FROM gmail_accounts g WHERE g.id = a.account_id)"
        )
    ).scalar_one()
    if orphan_count > 0:
        raise RuntimeError(
            f"无法回退迁移 0007 -> 0006：audit_events 中存在 {orphan_count} 条引用已永久删除账号的防篡改审计记录，"
            "重建外键将破坏审计链完整性。该迁移在执行过永久删除的数据库上不可逆，请通过加密备份执行隔离恢复回退。"
        )
    op.drop_constraint(
        "fk_gmail_account_tags_account_id_gmail_accounts",
        "gmail_account_tags",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "fk_gmail_account_tags_account_id_gmail_accounts",
        "gmail_account_tags",
        "gmail_accounts",
        ["account_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_audit_events_account_id_gmail_accounts",
        "audit_events",
        "gmail_accounts",
        ["account_id"],
        ["id"],
    )
    op.drop_constraint("ck_registered_apps_icon_data_format", "registered_apps", type_="check")
    op.drop_constraint("ck_registered_apps_domain_nonempty", "registered_apps", type_="check")
    op.drop_column("registered_apps", "icon_data")
    op.drop_column("registered_apps", "domain")
