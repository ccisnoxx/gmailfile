"""只接受子命令；密码仅从真正的交互终端读取。"""

import argparse
import getpass
import sys
import warnings
from datetime import UTC, datetime

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import MIN_ADMIN_PASSWORD_LENGTH, passwords
from app.db.schema import schema_is_current
from app.db.session import create_database_engine
from app.models import AdminUser, AuditEvent
from app.services.auth import AUTH_LOCK


def create_admin(engine, read_password=getpass.getpass) -> None:
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        raise ValueError("必须在交互式终端运行，不接受管道密码")
    if not schema_is_current(engine):
        raise ValueError("请先完成数据库迁移")
    with Session(engine) as db, db.begin():
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": AUTH_LOCK})
        if db.scalar(select(AdminUser.id)) is not None:
            raise ValueError("管理员已存在，不允许重复初始化")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", getpass.GetPassWarning)
                password = read_password(f"管理员密码（至少 {MIN_ADMIN_PASSWORD_LENGTH} 个字符）：")
                confirmation = read_password("再次输入密码：")
        except getpass.GetPassWarning:
            raise ValueError("无法安全读取密码，请检查终端回显控制") from None
        if not MIN_ADMIN_PASSWORD_LENGTH <= len(password) <= 1024 or password != confirmation:
            raise ValueError("密码长度不符合要求或两次输入不一致")
        db.add(
            AdminUser(password_hash=passwords.hash(password), password_changed_at=datetime.now(UTC))
        )
        db.add(AuditEvent(event_type="admin_initialized", event_metadata={}))


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        # argparse 默认会回显未知参数；误把凭据当参数时也不能再次泄漏。
        self.print_usage(sys.stderr)
        self.exit(2, "命令参数不正确；仅支持 create-admin，密码必须交互式输入。\n")


def main() -> int:
    parser = SafeArgumentParser(description="Gmail Account Manager 管理命令")
    parser.add_argument("command", choices=["create-admin"])
    parser.parse_args()
    engine = create_database_engine(Settings())
    try:
        create_admin(engine)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except (IntegrityError, SQLAlchemyError):
        print("初始化失败，请检查数据库连接、权限和迁移状态", file=sys.stderr)
        return 1
    finally:
        engine.dispose()
    print("唯一管理员已创建；首次登录必须绑定 TOTP。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
