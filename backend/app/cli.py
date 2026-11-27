"""只接受受控子命令；密码仅从真正的交互终端读取，审计校验、签名与密钥轮换不泄漏凭据。"""

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

from app.core.audit_sink import flush_audit_spool
from app.core.config import Settings
from app.core.encryption import DecryptionError, EncryptionService
from app.core.export_crypto import ExportDecryptionError, decrypt_export_file
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
    verify_audit_checkpoint,
)
from app.services.auth import AUTH_LOCK
from app.services.key_rotation import rotate_data_keys, verify_data_keys


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
    try:
        key = signing_key_file.read_bytes()
    except OSError:
        raise ValueError("无法读取审计签名密钥文件，请检查路径与权限") from None
    with Session(engine) as db:
        status = verify_audit_chain(db)
    return sign_audit_checkpoint(status, key)


def verify_checkpoint_cli(checkpoint_file: Path, key_file: Path) -> dict:
    try:
        checkpoint = json.loads(checkpoint_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise ValueError("无法读取或解析审计检查点 JSON 文件") from None
    try:
        key_bytes = key_file.read_bytes()
    except OSError:
        raise ValueError("无法读取审计验签密钥文件，请检查路径与权限") from None
    valid = isinstance(checkpoint, dict) and verify_audit_checkpoint(checkpoint, key_bytes)
    return {
        "valid": valid,
        "version": checkpoint.get("version") if isinstance(checkpoint, dict) else None,
        "algorithm": checkpoint.get("algorithm") if isinstance(checkpoint, dict) else None,
        "latest_seq": checkpoint.get("latest_seq") if isinstance(checkpoint, dict) else None,
    }


def rotate_keys_cli(
    engine,
    settings: Settings,
    *,
    target_version: int | None = None,
    batch_size: int = 200,
    dry_run: bool = False,
) -> dict:
    encryption = EncryptionService(settings.data_key_directory, settings.active_data_key_version)
    return rotate_data_keys(
        engine,
        encryption,
        target_version=target_version,
        batch_size=batch_size,
        dry_run=dry_run,
    )


def verify_keys_cli(engine, settings: Settings, *, require_version: int | None = None) -> dict:
    encryption = EncryptionService(settings.data_key_directory, settings.active_data_key_version)
    return verify_data_keys(engine, encryption, require_version=require_version)


def decrypt_export_cli(
    input_path: Path, output_path: Path, *, read_password=getpass.getpass
) -> dict:
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        raise ValueError("必须在交互式终端运行，不接受管道口令")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            passphrase = read_password("导出加密口令：")
    except getpass.GetPassWarning:
        raise ValueError("无法安全读取口令，请检查终端回显控制") from None
    written = decrypt_export_file(input_path, output_path, passphrase)
    return {"ok": True, "bytes_written": written}


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        # argparse 默认会回显未知参数；误把凭据当参数时也不能再次泄漏。
        self.print_usage(sys.stderr)
        self.exit(
            2,
            "命令参数不正确；仅支持 create-admin、verify-audit、sign-audit-checkpoint、"
            "verify-audit-checkpoint、flush-audit-spool、rotate-keys、verify-keys、"
            "decrypt-export，密码与口令必须交互式输入。\n",
        )


def build_parser() -> SafeArgumentParser:
    parser = SafeArgumentParser(description="Gmail Account Manager 管理命令")
    subparsers = parser.add_subparsers(
        dest="command", required=True, parser_class=SafeArgumentParser
    )
    subparsers.add_parser("create-admin", help="交互式创建唯一管理员")
    subparsers.add_parser("verify-audit", help="校验防篡改审计日志哈希链")
    subparsers.add_parser(
        "sign-audit-checkpoint", help="签发审计检查点签名（支持 Ed25519 PEM 私钥与 HMAC）"
    )
    verify_cp_parser = subparsers.add_parser(
        "verify-audit-checkpoint", help="离线校验审计检查点签名（Ed25519 公钥或 HMAC 密钥）"
    )
    verify_cp_parser.add_argument(
        "--checkpoint", required=True, type=Path, help="检查点 JSON 文件路径"
    )
    verify_cp_parser.add_argument(
        "--key", required=True, type=Path, help="Ed25519 PEM 公钥或 HMAC 密钥文件路径"
    )
    subparsers.add_parser(
        "flush-audit-spool", help="将本地磁盘队列中积压的审计记录重放至远程 Syslog"
    )

    rotate_parser = subparsers.add_parser(
        "rotate-keys", help="分批将历史密文重加密至目标数据密钥版本"
    )
    rotate_parser.add_argument(
        "--target-version",
        type=int,
        default=None,
        help="目标数据密钥版本号（默认使用 ACTIVE_DATA_KEY_VERSION）",
    )
    rotate_parser.add_argument(
        "--batch-size",
        type=int,
        default=200,
        help="单事务重加密批大小（1~5000，默认 200）",
    )
    rotate_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="仅盘点当前各版本密文分布与待轮换数量，不写入数据库",
    )

    verify_keys_parser = subparsers.add_parser(
        "verify-keys", help="全量认证解密校验数据库密文及密钥版本"
    )
    verify_keys_parser.add_argument(
        "--require-version",
        type=int,
        default=None,
        help="可选要求全部密文已统一至指定密钥版本",
    )

    decrypt_parser = subparsers.add_parser(
        "decrypt-export", help="离线流式校验并解密 .gmenc 加密导出文件"
    )
    decrypt_parser.add_argument("--input", required=True, type=Path, help="输入 .gmenc 路径")
    decrypt_parser.add_argument("--output", required=True, type=Path, help="输出 CSV 路径（0600）")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "decrypt-export":
        try:
            result = decrypt_export_cli(args.input, args.output)
            print(json.dumps(result, ensure_ascii=False))
            return 0
        except (ValueError, ExportDecryptionError, OSError) as exc:
            print(str(exc), file=sys.stderr)
            return 1
    if args.command == "verify-audit-checkpoint":
        try:
            result = verify_checkpoint_cli(args.checkpoint, args.key)
            print(json.dumps(result, ensure_ascii=False))
            return 0 if result["valid"] else 1
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 1
    settings = Settings()
    if args.command == "flush-audit-spool":
        try:
            result = flush_audit_spool(settings)
            print(json.dumps(result, ensure_ascii=False))
            return 0 if result["remaining"] == 0 else 1
        except (ValueError, OSError) as exc:
            print(str(exc), file=sys.stderr)
            return 1
    engine = create_database_engine(settings)
    try:
        if args.command == "create-admin":
            create_admin(engine, denylist_file=settings.password_denylist_file)
            print("唯一管理员已创建；首次登录必须绑定 TOTP。")
        elif args.command == "verify-audit":
            result = verify_audit(engine)
            print(json.dumps(result, ensure_ascii=False))
            return 0 if result["valid"] else 1
        elif args.command == "sign-audit-checkpoint":
            checkpoint = sign_audit(engine, settings.audit_signing_key_file)
            print(json.dumps(checkpoint, ensure_ascii=False))
        elif args.command == "rotate-keys":
            result = rotate_keys_cli(
                engine,
                settings,
                target_version=args.target_version,
                batch_size=args.batch_size,
                dry_run=args.dry_run,
            )
            print(json.dumps(result, ensure_ascii=False))
            return 0 if result.get("dry_run") or result.get("verified") else 1
        elif args.command == "verify-keys":
            result = verify_keys_cli(engine, settings, require_version=args.require_version)
            print(json.dumps(result, ensure_ascii=False))
            return 0 if result["valid"] else 1
    except (ValueError, DecryptionError) as exc:
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
