"""只接受受控子命令；密码仅从真正的交互终端读取，审计校验与签名不泄漏凭据。"""

import argparse
import getpass
import json
import sys
import warnings
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import (
    MIN_ADMIN_PASSWORD_LENGTH,
    passwords,
    validate_new_admin_password,
)
from app.db.schema import schema_is_current
from app.db.session import create_database_engine
from app.models import AdminUser, AuditEvent
from app.services.audit_integrity import (
    sign_audit_checkpoint,
    verify_audit_chain,
)
from app.services.auth import AUTH_LOCK


def create_admin(
    engine, read_password=getpass.getpass, *, denylist_file: Path | None = None
) -> None:
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
                password = read_password(
                    f"管理员密码（至少 {MIN_ADMIN_PASSWORD_LENGTH} 个字符，"
                    "建议使用多词长密码短语）："
                )
                confirmation = read_password("再次输入密码：")
        except getpass.GetPassWarning:
            raise ValueError("无法安全读取密码，请检查终端回显控制") from None
        if password != confirmation:
            raise ValueError("两次输入的密码不一致")
        validate_new_admin_password(password, denylist_file=denylist_file)
        db.add(
            AdminUser(password_hash=passwords.hash(password), password_changed_at=datetime.now(UTC))
        )
        db.add(AuditEvent(event_type="admin_initialized", event_metadata={}))


def verify_audit(engine) -> dict:
    with Session(engine) as db:
        status = verify_audit_chain(db)
    return {
        "valid": status.valid,
        "total_events": status.total_events,
        "latest_seq": status.latest_seq,
        "latest_hash": status.latest_hash,
        "broken_seq": status.broken_seq,
        "reason": status.reason,
    }


def sign_audit(engine, signing_key_file: Path | None) -> dict:
    if signing_key_file is None:
        raise ValueError("请配置 AUDIT_SIGNING_KEY_FILE 后再签发审计检查点")
    key = signing_key_file.read_bytes()
    with Session(engine) as db:
        status = verify_audit_chain(db)
    return sign_audit_checkpoint(status, key)


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        # argparse 默认会回显未知参数；误把凭据当参数时也不能再次泄漏。
        self.print_usage(sys.stderr)
        self.exit(
            2,
            "命令参数不正确；仅支持 create-admin、verify-audit、sign-audit-checkpoint，"
            "密码必须交互式输入。\n",
        )


def main() -> int:
    parser = SafeArgumentParser(description="Gmail Account Manager 管理命令")
    parser.add_argument(
        "command", choices=["create-admin", "verify-audit", "sign-audit-checkpoint"]
    )
    args = parser.parse_args()
    settings = Settings()
    engine = create_database_engine(settings)
    try:
        if args.command == "create-admin":
            create_admin(engine, denylist_file=settings.password_denylist_file)
            print("唯一管理员已创建；首次登录必须绑定 TOTP。")
        elif args.command == "verify-audit":
            result = verify_audit(engine)
            print(json.dumps(result, ensure_ascii=False))
            return 0 if result["valid"] else 1
        else:
            checkpoint = sign_audit(engine, settings.audit_signing_key_file)
            print(json.dumps(checkpoint, ensure_ascii=False))
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except (IntegrityError, SQLAlchemyError):
        print("操作失败，请检查数据库连接、权限和迁移状态", file=sys.stderr)
        return 1
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
