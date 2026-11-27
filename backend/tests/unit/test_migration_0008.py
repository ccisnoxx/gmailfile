"""校验迁移 0008 生成的 PostgreSQL DDL 约束名不发生命名约定双重前缀。"""

from pathlib import Path

import pytest
from alembic.config import Config

from alembic import command

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def test_migration_0008_upgrade_sql_uses_exact_constraint_name(
    capsys: pytest.CaptureFixture[str],
) -> None:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))

    command.upgrade(config, "0007:0008", sql=True)
    ddl = capsys.readouterr().out

    assert "ALTER TABLE gmail_accounts DROP CONSTRAINT ck_gmail_accounts_recovery_xor;" in ddl
    assert (
        "ALTER TABLE gmail_accounts ADD CONSTRAINT ck_gmail_accounts_recovery_xor "
        "CHECK (NOT (recovery_account_id IS NOT NULL AND recovery_email_external IS NOT NULL));"
        in ddl
    )
    assert "ck_gmail_accounts_ck_gmail_accounts_recovery_xor" not in ddl
