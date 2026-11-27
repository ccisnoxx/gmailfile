"""审计 Syslog 容错连接、有限超时、跨进程 Spool 互斥锁、损坏行隔离与满容量恢复单元测试。"""

from __future__ import annotations

import json
import logging
import os
import socket
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from app.core import audit_sink
from app.core.audit_sink import (
    AUDIT_LOGGER_NAME,
    _append_spool_record,
    configure_audit_sink,
    emit_audit_records,
    flush_audit_spool,
    spool_quarantine_path,
)


def _find_free_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _sample_record(seq: int, event_type: str = "login_success") -> dict[str, object]:
    return {
        "stream": "audit",
        "seq": seq,
        "id": f"00000000-0000-0000-0000-{seq:012d}",
        "created_at": "2026-11-27T00:00:00+00:00",
        "event_type": event_type,
        "operation": "unit",
        "account_id": None,
        "session_id": None,
        "ip_address": "127.0.0.1",
        "prev_hash": "0" * 64,
        "event_hash": f"{seq:064x}",
    }


def test_tcp_syslog_unavailable_at_startup_spools_and_recovers(settings, tmp_path, caplog):
    port = _find_free_tcp_port()
    spool_file = tmp_path / "tcp-spool.jsonl"
    settings.audit_syslog_address = f"tcp://127.0.0.1:{port}"
    settings.audit_syslog_spool_file = spool_file
    try:
        with caplog.at_level(logging.ERROR, logger="gmail_manager"):
            configure_audit_sink(settings, timeout=0.2)
            emit_audit_records([_sample_record(1)])

        assert any(r.getMessage() == "audit_sink_init_failed" for r in caplog.records)
        assert any(r.getMessage() == "audit_sink_failed" for r in caplog.records)
        assert spool_file.is_file()
        assert stat.S_IMODE(spool_file.stat().st_mode) == 0o600

        # 启动本地 TCP 接收端，验证离线积压记录可成功重放并清空队列。
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(("127.0.0.1", port))
        server.listen(1)
        server.settimeout(2.0)
        try:
            result = flush_audit_spool(settings, timeout=0.5)
            assert result == {"flushed": 1, "remaining": 0, "quarantined": 0}
            assert not spool_file.exists()
            conn, _ = server.accept()
            with conn:
                conn.settimeout(2.0)
                data = conn.recv(4096).decode("utf-8")
            payload = json.loads(data.split("gmail-manager-audit: ", 1)[1].rstrip("\x00\n"))
            assert payload["seq"] == 1
        finally:
            server.close()
    finally:
        settings.audit_syslog_address = ""
        settings.audit_syslog_spool_file = None
        configure_audit_sink(settings)


def test_tcp_syslog_blackhole_timeout_does_not_hang(settings, tmp_path, monkeypatch):
    spool_file = tmp_path / "timeout-spool.jsonl"
    settings.audit_syslog_address = "tcp://127.0.0.1:51400"
    settings.audit_syslog_spool_file = spool_file

    def slow_connect(self, address):
        time.sleep(0.05)
        raise TimeoutError("simulated blackhole connect timeout")

    monkeypatch.setattr(socket.socket, "connect", slow_connect)
    try:
        started = time.monotonic()
        configure_audit_sink(settings, timeout=0.15)
        emit_audit_records([_sample_record(9)])
        elapsed = time.monotonic() - started
        assert elapsed < 1.5
        queued = [json.loads(line) for line in spool_file.read_text(encoding="utf-8").splitlines()]
        assert len(queued) == 1 and queued[0]["seq"] == 9
    finally:
        settings.audit_syslog_address = ""
        settings.audit_syslog_spool_file = None
        configure_audit_sink(settings)


def test_spool_quarantines_corrupt_and_truncated_lines(settings, tmp_path, caplog):
    spool_file = tmp_path / "corrupt-spool.jsonl"
    valid_1 = json.dumps(_sample_record(10), separators=(",", ":")).encode("utf-8")
    truncated = b'{"stream":"audit","seq":11,"event_type":"trun'
    bad_utf8 = b"\xff\xfe\x00broken-bytes"
    valid_2 = json.dumps(_sample_record(12), separators=(",", ":")).encode("utf-8")
    spool_file.write_bytes(b"\n".join([valid_1, truncated, bad_utf8, valid_2]) + b"\n")
    os.chmod(spool_file, 0o600)

    with tempfile.TemporaryDirectory(dir="/tmp", prefix="gm_q_") as short_dir:
        unix_path = Path(short_dir) / "s.sock"
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        try:
            sock.bind(str(unix_path))
            sock.settimeout(2.0)
            settings.audit_syslog_address = str(unix_path)
            settings.audit_syslog_spool_file = spool_file

            with caplog.at_level(logging.ERROR, logger="gmail_manager"):
                res = flush_audit_spool(settings)

            assert res == {"flushed": 2, "remaining": 0, "quarantined": 2}
            assert not spool_file.exists()

            q_file = spool_quarantine_path(spool_file)
            assert q_file.is_file()
            assert stat.S_IMODE(q_file.stat().st_mode) == 0o600
            q_lines = q_file.read_bytes().splitlines()
            assert q_lines == [truncated, bad_utf8]
            assert any(
                r.getMessage() == "audit_spool_corrupt_quarantined"
                and getattr(r, "safe_fields", {}).get("count") == 2
                for r in caplog.records
            )

            received_seqs = []
            for _ in range(2):
                pkt, _ = sock.recvfrom(4096)
                obj = json.loads(
                    pkt.decode("utf-8").split("gmail-manager-audit: ", 1)[1].rstrip("\x00\n")
                )
                received_seqs.append(obj["seq"])
            assert received_seqs == [10, 12]
        finally:
            sock.close()
            settings.audit_syslog_address = ""
            settings.audit_syslog_spool_file = None
            configure_audit_sink(settings)


def test_spool_full_capacity_recovers_after_drain(settings, tmp_path, monkeypatch, caplog):
    spool_file = tmp_path / "full-spool.jsonl"
    rec1 = _sample_record(100)
    one_size = len((json.dumps(rec1, separators=(",", ":")) + "\n").encode("utf-8"))
    monkeypatch.setattr(audit_sink, "MAX_SPOOL_BYTES", one_size + 10)

    with caplog.at_level(logging.ERROR, logger="gmail_manager"):
        _append_spool_record(spool_file, rec1)
        _append_spool_record(spool_file, _sample_record(101))

    assert any(r.getMessage() == "audit_spool_full" for r in caplog.records)
    assert len(spool_file.read_text(encoding="utf-8").splitlines()) == 1

    with tempfile.TemporaryDirectory(dir="/tmp", prefix="gm_full_") as short_dir:
        unix_path = Path(short_dir) / "s.sock"
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        try:
            sock.bind(str(unix_path))
            sock.settimeout(2.0)
            settings.audit_syslog_address = str(unix_path)
            settings.audit_syslog_spool_file = spool_file
            assert flush_audit_spool(settings) == {"flushed": 1, "remaining": 0, "quarantined": 0}
            assert not spool_file.exists()

            # 排空后容量恢复，新记录可再次成功写入并重放。
            _append_spool_record(spool_file, _sample_record(102))
            assert len(spool_file.read_text(encoding="utf-8").splitlines()) == 1
            assert flush_audit_spool(settings) == {"flushed": 1, "remaining": 0, "quarantined": 0}
        finally:
            sock.close()
            settings.audit_syslog_address = ""
            settings.audit_syslog_spool_file = None
            configure_audit_sink(settings)


def test_spool_cross_process_append_and_flush_loses_zero_records(settings, tmp_path):
    """验证独立进程并发追加与重放同一 spool 文件时，受 flock 保护不会覆盖丢失任何记录。"""
    import threading

    spool_file = tmp_path / "concurrent-spool.jsonl"
    backend_dir = Path(__file__).resolve().parents[2]
    total_records = 40

    with tempfile.TemporaryDirectory(dir="/tmp", prefix="gm_xproc_") as short_dir:
        unix_path = Path(short_dir) / "s.sock"
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        stop_event = threading.Event()
        received_seqs: set[int] = set()

        def _drain_receiver() -> None:
            while not stop_event.is_set() or True:
                try:
                    pkt, _ = sock.recvfrom(4096)
                except TimeoutError:
                    if stop_event.is_set():
                        return
                    continue
                except OSError:
                    return
                obj = json.loads(
                    pkt.decode("utf-8").split("gmail-manager-audit: ", 1)[1].rstrip("\x00\n")
                )
                received_seqs.add(int(obj["seq"]))

        try:
            sock.bind(str(unix_path))
            sock.settimeout(0.1)
            receiver = threading.Thread(target=_drain_receiver, daemon=True)
            receiver.start()

            settings.audit_syslog_address = str(unix_path)
            settings.audit_syslog_spool_file = spool_file

            child_code = "\n".join(
                [
                    "import sys",
                    "from pathlib import Path",
                    "from app.core.audit_sink import _append_spool_record",
                    "spool = Path(sys.argv[1])",
                    "n = int(sys.argv[2])",
                    "for seq in range(1, n + 1):",
                    "    _append_spool_record(",
                    "        spool, {'stream': 'audit', 'seq': seq, 'event_type': 'xproc'}",
                    "    )",
                ]
            )
            env = dict(os.environ)
            env["PYTHONPATH"] = str(backend_dir)
            proc = subprocess.Popen(
                [sys.executable, "-c", child_code, str(spool_file), str(total_records)],
                env=env,
            )

            while proc.poll() is None:
                flush_audit_spool(settings)
                time.sleep(0.005)
            assert proc.wait(timeout=10) == 0

            # 子进程结束后排空残余 spool 并等待后台接收线程读完套接字缓冲。
            for _ in range(5):
                res = flush_audit_spool(settings)
                if res["remaining"] == 0:
                    break
                time.sleep(0.02)
            stop_event.set()
            receiver.join(timeout=2.0)

            assert not spool_file.exists()
            assert received_seqs == set(range(1, total_records + 1))
            assert logging.getLogger(AUDIT_LOGGER_NAME) is not None
        finally:
            stop_event.set()
            sock.close()
            settings.audit_syslog_address = ""
            settings.audit_syslog_spool_file = None
            configure_audit_sink(settings)


def test_nested_savepoint_commit_defers_audit_emission_until_outer_commit(monkeypatch):
    """验证 begin_nested() 保存点释放不会提前外发审计，外层回滚零外发，外层提交仅外发已提交记录。"""
    from datetime import UTC, datetime
    from uuid import uuid4

    from sqlalchemy import create_engine, event, text
    from sqlalchemy.orm import Session
    from sqlalchemy.pool import StaticPool

    from app.core.audit_sink import attach_audit_session_hooks
    from app.models import AuditEvent

    emitted: list[dict[str, object]] = []
    monkeypatch.setattr(audit_sink, "emit_audit_records", lambda records: emitted.extend(records))

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _enable_sqlite_savepoints(dbapi_connection, _connection_record):
        dbapi_connection.isolation_level = None

    @event.listens_for(engine, "begin")
    def _begin_sqlite_tx(conn):
        conn.exec_driver_sql("BEGIN")

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE audit_events (
                    id VARCHAR(36) PRIMARY KEY,
                    seq INTEGER,
                    created_at TIMESTAMP NOT NULL,
                    event_type VARCHAR(64) NOT NULL,
                    account_id VARCHAR(36),
                    session_id VARCHAR(36),
                    ip_address VARCHAR(64),
                    user_agent TEXT,
                    metadata JSON NOT NULL,
                    prev_hash BLOB,
                    event_hash BLOB
                )
                """
            )
        )

    now = datetime(2026, 11, 27, 12, 0, tzinfo=UTC)

    # 场景 1：保存点成功提交，但外层事务回滚 -> 数据库与外部通道均为 0 条
    with Session(engine) as session:
        attach_audit_session_hooks(session)
        with session.begin_nested():
            session.add(
                AuditEvent(
                    id=uuid4(),
                    seq=1,
                    created_at=now,
                    event_type="csv_imported",
                    event_metadata={"operation": "csv"},
                    event_hash=b"\x01" * 32,
                )
            )
            session.flush()
        # 保存点已释放但外层未提交：此时绝不能提前外发
        assert emitted == []
        session.rollback()

    assert emitted == []
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM audit_events")).scalar_one() == 0

    # 场景 2：保存点 1 成功、保存点 2 回滚、外层提交 -> 仅保存点 1 与外层记录在顶层提交后一次性外发
    with Session(engine) as session:
        attach_audit_session_hooks(session)
        with session.begin_nested():
            session.add(
                AuditEvent(
                    id=uuid4(),
                    seq=2,
                    created_at=now,
                    event_type="csv_imported",
                    event_metadata={"operation": "csv"},
                    event_hash=b"\x02" * 32,
                )
            )
            session.flush()
        try:
            with session.begin_nested():
                session.add(
                    AuditEvent(
                        id=uuid4(),
                        seq=3,
                        created_at=now,
                        event_type="account_created",
                        event_metadata={},
                        event_hash=b"\x03" * 32,
                    )
                )
                session.flush()
                raise RuntimeError("abort nested savepoint")
        except RuntimeError:
            pass
        assert emitted == []
        session.commit()

    assert [item["seq"] for item in emitted] == [2]

    # 场景 3：内层保存点 flush() 触发唯一约束异常（子事务回滚）后外层提交，不得误删外层待发审计
    emitted.clear()
    import pytest
    from sqlalchemy.exc import IntegrityError

    with Session(engine) as session:
        attach_audit_session_hooks(session)
        dup_id = uuid4()
        session.add(
            AuditEvent(
                id=dup_id,
                seq=200,
                created_at=now,
                event_type="login_success",
                event_metadata={},
                event_hash=b"\x04" * 32,
            )
        )
        session.flush()
        with pytest.raises(IntegrityError), session.begin_nested():
            session.add(
                AuditEvent(
                    id=dup_id,
                    seq=201,
                    created_at=now,
                    event_type="account_created",
                    event_metadata={},
                    event_hash=b"\x05" * 32,
                )
            )
            session.flush()
        assert emitted == []
        session.commit()

    assert [item["seq"] for item in emitted] == [200]
