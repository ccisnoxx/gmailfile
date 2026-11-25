"""Wave 1 (TC-P0-009): app.cli verify-audit 与 sign-audit-checkpoint 集成测试。"""

import json
import os
import sys

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import cli
from app.models import AuditEvent
from app.services.audit_integrity import verify_audit_checkpoint

pytestmark = pytest.mark.integration


def _seed_audit_events(db_engine, count: int = 5) -> None:
    with Session(db_engine) as db, db.begin():
        for i in range(count):
            db.add(
                AuditEvent(
                    event_type="account_created" if i % 2 == 0 else "account_updated",
                    event_metadata={"operation": f"seed-{i}"},
                )
            )


def _wire_cli(monkeypatch, db_engine, settings):
    class _NonDisposingEngine:
        def __getattr__(self, name):
            return getattr(db_engine, name)

        def dispose(self):
            return None

    monkeypatch.setattr(cli, "Settings", lambda: settings)
    monkeypatch.setattr(cli, "create_database_engine", lambda _s: _NonDisposingEngine())


def test_cli_verify_audit_and_sign_checkpoint_on_valid_chain(
    db_engine, settings, tmp_path, monkeypatch, capsys
):
    _seed_audit_events(db_engine, count=5)
    key = os.urandom(32)
    key_file = tmp_path / "audit_signing_key"
    key_file.write_bytes(key)
    settings.audit_signing_key_file = key_file
    _wire_cli(monkeypatch, db_engine, settings)

    # 1. verify-audit -> exit 0 & valid JSON
    monkeypatch.setattr(sys, "argv", ["app.cli", "verify-audit"])
    assert cli.main() == 0
    verify_out = json.loads(capsys.readouterr().out)
    assert verify_out["valid"] is True
    assert verify_out["total_events"] == 5
    assert verify_out["latest_seq"] == 5
    assert len(verify_out["latest_hash"]) == 64
    assert verify_out["broken_seq"] is None

    # 2. sign-audit-checkpoint -> exit 0 & verifiable HMAC checkpoint
    monkeypatch.setattr(sys, "argv", ["app.cli", "sign-audit-checkpoint"])
    assert cli.main() == 0
    checkpoint = json.loads(capsys.readouterr().out)
    assert checkpoint["version"] == 1
    assert checkpoint["algorithm"] == "hmac-sha256"
    assert checkpoint["total_events"] == 5
    assert checkpoint["latest_seq"] == 5
    assert checkpoint["latest_hash"] == verify_out["latest_hash"]
    assert verify_audit_checkpoint(checkpoint, key) is True
    assert verify_audit_checkpoint(checkpoint, os.urandom(32)) is False


def test_cli_sign_checkpoint_fails_with_unconfigured_missing_or_short_key(
    db_engine, settings, tmp_path, monkeypatch, capsys
):
    _seed_audit_events(db_engine, count=2)
    _wire_cli(monkeypatch, db_engine, settings)
    monkeypatch.setattr(sys, "argv", ["app.cli", "sign-audit-checkpoint"])

    # 未配置密钥文件
    settings.audit_signing_key_file = None
    assert cli.main() == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "AUDIT_SIGNING_KEY_FILE" in captured.err

    # 密钥路径不存在
    settings.audit_signing_key_file = tmp_path / "nonexistent.key"
    assert cli.main() == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "无法读取审计签名密钥文件" in captured.err

    # 密钥长度不足 32 字节
    short_key = tmp_path / "short.key"
    short_key.write_bytes(b"too-short-16byte")
    settings.audit_signing_key_file = short_key
    assert cli.main() == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "32" in captured.err


def test_cli_verify_and_sign_reject_tampered_audit_chain(
    db_engine, settings, tmp_path, monkeypatch, capsys
):
    _seed_audit_events(db_engine, count=5)
    key_file = tmp_path / "audit_signing_key"
    key_file.write_bytes(os.urandom(32))
    settings.audit_signing_key_file = key_file
    _wire_cli(monkeypatch, db_engine, settings)

    # 模拟特权账户绕过触发器篡改第 3 条记录后恢复触发器
    with db_engine.begin() as conn:
        conn.execute(
            text("ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_prevent_mutation")
        )
        conn.execute(text("UPDATE audit_events SET event_type = 'tampered_event' WHERE seq = 3"))
        conn.execute(
            text("ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_prevent_mutation")
        )

    monkeypatch.setattr(sys, "argv", ["app.cli", "verify-audit"])
    assert cli.main() == 1
    verify_out = json.loads(capsys.readouterr().out)
    assert verify_out["valid"] is False
    assert verify_out["broken_seq"] == 3
    assert verify_out["reason"] == "EVENT_HASH_MISMATCH"

    monkeypatch.setattr(sys, "argv", ["app.cli", "sign-audit-checkpoint"])
    assert cli.main() == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "拒绝签发检查点" in captured.err


def test_cli_safe_argument_parser_never_echoes_secret_argument(monkeypatch, capsys):
    secret_arg = "--password=never-echo-this-secret-value-2026"
    monkeypatch.setattr(sys, "argv", ["app.cli", secret_arg])
    with pytest.raises(SystemExit) as exc:
        cli.main()
    assert exc.value.code == 2
    captured = capsys.readouterr()
    assert secret_arg not in captured.out
    assert secret_arg not in captured.err
    assert "never-echo-this-secret-value-2026" not in captured.err
