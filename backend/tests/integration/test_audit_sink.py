"""Wave 1 (TC-P0-008): 防篡改审计外发、事务/保存点回滚零幽灵日志与 Syslog 容错集成测试。"""

import io
import json
import logging
import socket
import tempfile
from contextlib import contextmanager
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from test_accounts import create, request
from test_accounts import signed as signed
from test_auth import env as env
from test_auth import post
from test_operations import commit, csv_bytes, preview, reverify

from app.core.audit_sink import (
    AUDIT_LOGGER_NAME,
    AuditJsonFormatter,
    attach_audit_session_hooks,
    configure_audit_sink,
)
from app.core.security import random_token
from app.models import AuditEvent

pytestmark = pytest.mark.integration

EXPECTED_AUDIT_KEYS = {
    "stream",
    "seq",
    "id",
    "created_at",
    "event_type",
    "operation",
    "account_id",
    "session_id",
    "ip_address",
    "prev_hash",
    "event_hash",
}


@contextmanager
def capture_audit_stream():
    buf = io.StringIO()
    handler = logging.StreamHandler(buf)
    handler.setFormatter(AuditJsonFormatter())
    logger = logging.getLogger(AUDIT_LOGGER_NAME)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    try:
        yield buf
    finally:
        logger.removeHandler(handler)
        handler.close()


def _parse_json_lines(raw: str) -> list[dict]:
    return [json.loads(line) for line in raw.splitlines() if line.strip()]


def test_audit_sink_emits_whitelist_json_on_commit_without_secrets(env, signed):
    client, state = signed
    gmail_password = f"GmailSinkSecret-{random_token()}"
    secret_phone = "+86 139 9988 7766"
    secret_notes = f"private-audit-sink-note-{random_token()}"

    with capture_audit_stream() as stream:
        row = create(
            signed,
            gmail_email="auditsink@gmail.com",
            password=gmail_password,
            phone=secret_phone,
            notes=secret_notes,
            purpose="审计外发测试",
        )
        reverify_resp = post(client, "reverify", state, {"password": env["password"]})
        assert reverify_resp.status_code == 200
        state.update(reverify_resp.json())
        revealed = request(signed, "POST", "/" + row["id"] + "/reveal-password", {})
        assert revealed.status_code == 200

    raw_output = stream.getvalue()
    records = _parse_json_lines(raw_output)
    types = {item["event_type"] for item in records}
    assert {"account_created", "password_reverified", "password_revealed"} <= types

    with Session(env["engine"]) as db:
        db_by_seq = {ev.seq: ev for ev in db.scalars(select(AuditEvent)).all()}

    for item in records:
        assert set(item.keys()) == EXPECTED_AUDIT_KEYS
        assert item["stream"] == "audit"
        assert isinstance(item["seq"], int) and item["seq"] >= 1
        assert len(item["prev_hash"]) == 64 and len(item["event_hash"]) == 64
        db_row = db_by_seq[item["seq"]]
        assert item["event_hash"] == bytes(db_row.event_hash).hex()
        assert item["prev_hash"] == bytes(db_row.prev_hash).hex()

    for secret in [
        env["password"],
        gmail_password,
        secret_phone,
        secret_notes,
        state["csrf_token"],
    ]:
        assert secret not in raw_output


def test_audit_sink_emits_nothing_on_outer_rollback(db_engine):
    with capture_audit_stream() as stream:
        with pytest.raises(RuntimeError, match="forced-rollback"):
            with Session(db_engine) as db:
                attach_audit_session_hooks(db)
                with db.begin():
                    db.add(
                        AuditEvent(
                            event_type="account_created",
                            event_metadata={"operation": "rollback-check"},
                        )
                    )
                    db.flush()
                    raise RuntimeError("forced-rollback")

    assert _parse_json_lines(stream.getvalue()) == []
    with Session(db_engine) as db:
        assert db.scalar(select(func.count()).select_from(AuditEvent)) == 0


def test_audit_sink_discards_savepoint_rollback_ghost_events_on_csv_conflict(
    env, signed, monkeypatch
):
    from app.services.accounts import AccountError, AccountService

    reverify(env, signed)
    data = csv_bytes(
        [
            ["gmail_email", "password", "recovery_email"],
            ["savepoint.ok@example.test", "synthetic-pass-1", "rec1@example.test"],
            ["savepoint.boom@example.test", "synthetic-pass-2", "rec2@example.test"],
        ]
    )
    preview_res = preview(signed, data).json()
    assert preview_res["receipt_id"]

    original_create = AccountService.create

    def fail_on_second(self, body):
        if body.gmail_email == "savepoint.boom@example.test":
            raise AccountError(409, "CONFLICT", "synthetic-savepoint-conflict")
        return original_create(self, body)

    monkeypatch.setattr(AccountService, "create", fail_on_second)
    with capture_audit_stream() as failed_stream:
        rejected = commit(signed, data, preview_res["receipt_id"])
    assert rejected.status_code == 409

    # 保存点回滚的 account_created 与 csv_imported 绝不可产生幽灵外发日志。
    ghost_records = _parse_json_lines(failed_stream.getvalue())
    assert not any(r["event_type"] in {"account_created", "csv_imported"} for r in ghost_records)

    # 恢复正常后提交，保存点与外层事务均提交成功，应完整外发两条创建 + 一条 csv_imported。
    monkeypatch.setattr(AccountService, "create", original_create)
    preview_ok = preview(signed, data).json()
    with capture_audit_stream() as ok_stream:
        committed = commit(signed, data, preview_ok["receipt_id"])
    assert committed.status_code == 200
    emitted_types = [r["event_type"] for r in _parse_json_lines(ok_stream.getvalue())]
    assert emitted_types.count("account_created") == 2
    assert emitted_types.count("csv_imported") == 1


def test_audit_sink_syslog_udp_unix_and_resilient_failure_handling(db_engine, settings):
    audit_logger = logging.getLogger(AUDIT_LOGGER_NAME)
    app_logger = logging.getLogger("gmail_manager")
    try:
        # 1. UDP Syslog 转发
        udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        udp_sock.bind(("127.0.0.1", 0))
        udp_sock.settimeout(2.0)
        udp_port = udp_sock.getsockname()[1]
        try:
            settings.audit_syslog_address = f"udp://127.0.0.1:{udp_port}"
            configure_audit_sink(settings)
            with Session(db_engine) as db:
                attach_audit_session_hooks(db)
                with db.begin():
                    ev = AuditEvent(event_type="login_success", event_metadata={"operation": "udp"})
                    db.add(ev)
                    db.flush()
                    expected_seq = ev.seq
                    expected_hash = bytes(ev.event_hash).hex()
            packet, _ = udp_sock.recvfrom(4096)
            decoded = packet.decode("utf-8")
            assert "gmail-manager-audit: " in decoded
            payload = json.loads(decoded.split("gmail-manager-audit: ", 1)[1].rstrip("\x00\n"))
            assert payload["seq"] == expected_seq
            assert payload["event_hash"] == expected_hash
            assert payload["event_type"] == "login_success"
        finally:
            udp_sock.close()

        # 2. Unix DGRAM 套接字转发（macOS AF_UNIX 路径上限 104 字节，使用短临时目录）
        with tempfile.TemporaryDirectory(dir="/tmp", prefix="gm_sock_") as short_dir:
            unix_path = Path(short_dir) / "s.sock"
            unix_sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
            try:
                unix_sock.bind(str(unix_path))
                unix_sock.settimeout(2.0)
                settings.audit_syslog_address = str(unix_path)
                configure_audit_sink(settings)
                with Session(db_engine) as db:
                    attach_audit_session_hooks(db)
                    with db.begin():
                        ev2 = AuditEvent(event_type="logout", event_metadata={"operation": "unix"})
                        db.add(ev2)
                        db.flush()
                        expected_seq2 = ev2.seq
                        expected_hash2 = bytes(ev2.event_hash).hex()
                packet2, _ = unix_sock.recvfrom(4096)
                decoded2 = packet2.decode("utf-8")
                payload2 = json.loads(
                    decoded2.split("gmail-manager-audit: ", 1)[1].rstrip("\x00\n")
                )
                assert payload2["seq"] == expected_seq2
                assert payload2["event_hash"] == expected_hash2
                assert payload2["event_type"] == "logout"

                # 3. 模拟真实 Syslog 后端下线（关闭并移除套接字文件）：
                #    发送与重连均抛 OSError，但不得阻断主事务提交，且须记录 audit_sink_failed。
                syslog_handlers = [
                    h
                    for h in audit_logger.handlers
                    if isinstance(h, logging.handlers.SysLogHandler)
                ]
                assert len(syslog_handlers) == 1
                unix_sock.close()
                unix_path.unlink(missing_ok=True)

                captured_records: list[logging.LogRecord] = []

                class _CaptureHandler(logging.Handler):
                    def emit(self, record: logging.LogRecord) -> None:
                        captured_records.append(record)

                capture_handler = _CaptureHandler(level=logging.ERROR)
                app_logger.addHandler(capture_handler)
                try:
                    with Session(db_engine) as db:
                        attach_audit_session_hooks(db)
                        with db.begin():
                            ev3 = AuditEvent(
                                event_type="settings_updated",
                                event_metadata={"operation": "resilient"},
                            )
                            db.add(ev3)
                            db.flush()
                            ev3_id = ev3.id
                finally:
                    app_logger.removeHandler(capture_handler)

                # 数据库事务依然成功提交落盘
                with Session(db_engine) as db:
                    assert db.get(AuditEvent, ev3_id) is not None
                sink_errors = [
                    rec
                    for rec in captured_records
                    if rec.getMessage() == "audit_sink_failed" and hasattr(rec, "safe_fields")
                ]
                assert len(sink_errors) >= 1
                assert sink_errors[-1].safe_fields["exception_type"] in {
                    "OSError",
                    "FileNotFoundError",
                    "ConnectionRefusedError",
                }
            finally:
                unix_sock.close()
    finally:
        settings.audit_syslog_address = ""
        settings.audit_syslog_spool_file = None
        configure_audit_sink(settings)


def test_audit_sink_spools_failed_syslog_events_and_flushes_on_recovery(
    db_engine, settings, tmp_path
):
    from app.core.audit_sink import flush_audit_spool

    spool_file = tmp_path / "audit-spool.jsonl"
    try:
        with tempfile.TemporaryDirectory(dir="/tmp", prefix="gm_sp_") as short_dir:
            unix_path = Path(short_dir) / "s.sock"
            # 1. 先让套接字存在以初始化 handler，随后移除套接字模拟 Syslog 暂时宕机
            down_sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
            down_sock.bind(str(unix_path))
            settings.audit_syslog_address = str(unix_path)
            settings.audit_syslog_spool_file = spool_file
            configure_audit_sink(settings)
            down_sock.close()
            unix_path.unlink(missing_ok=True)

            with Session(db_engine) as db:
                attach_audit_session_hooks(db)
                with db.begin():
                    ev = AuditEvent(event_type="logout", event_metadata={"operation": "spool"})
                    db.add(ev)
                    db.flush()
                    expected_seq = ev.seq

            assert spool_file.is_file()
            assert (spool_file.stat().st_mode & 0o777) == 0o600
            queued = _parse_json_lines(spool_file.read_text(encoding="utf-8"))
            assert len(queued) == 1 and queued[0]["seq"] == expected_seq

            # 2. Syslog 恢复上线，执行 flush_audit_spool 重放并清空磁盘队列
            up_sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
            try:
                up_sock.bind(str(unix_path))
                up_sock.settimeout(2.0)
                result = flush_audit_spool(settings)
                assert result == {"flushed": 1, "remaining": 0}
                assert not spool_file.exists()
                packet, _ = up_sock.recvfrom(4096)
                replayed = json.loads(
                    packet.decode("utf-8").split("gmail-manager-audit: ", 1)[1].rstrip("\x00\n")
                )
                assert replayed["seq"] == expected_seq
                assert replayed["event_type"] == "logout"
            finally:
                up_sock.close()
    finally:
        settings.audit_syslog_address = ""
        settings.audit_syslog_spool_file = None
        configure_audit_sink(settings)
