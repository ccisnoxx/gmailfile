"""提交后审计事件外发通道：结构化 JSON 审计日志与可选远程 Syslog 转发。

仅在数据库事务成功提交后外发已落盘的哈希链审计记录，确保回滚事务不会产生幽灵日志，
且外发字段严格白名单化，绝不包含凭据、明文密码、Cookie、CSRF 或任意请求体。
"""

from __future__ import annotations

import fcntl
import json
import logging
import logging.handlers
import os
import socket
import sys
import tempfile
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import AuditEvent

AUDIT_LOGGER_NAME = "gmail_manager.audit"
_PENDING_KEY = "pending_audit_records"
MAX_SPOOL_BYTES = 10 * 1024 * 1024
MAX_QUARANTINE_BYTES = 10 * 1024 * 1024
AUDIT_SYSLOG_TIMEOUT_SECONDS = 2.0
_SPOOL_LOCK = threading.Lock()

_FACILITY_MAP: dict[str, int] = {
    "auth": logging.handlers.SysLogHandler.LOG_AUTH,
    "authpriv": logging.handlers.SysLogHandler.LOG_AUTHPRIV,
    "local0": logging.handlers.SysLogHandler.LOG_LOCAL0,
    "local1": logging.handlers.SysLogHandler.LOG_LOCAL1,
    "local2": logging.handlers.SysLogHandler.LOG_LOCAL2,
    "local3": logging.handlers.SysLogHandler.LOG_LOCAL3,
    "local4": logging.handlers.SysLogHandler.LOG_LOCAL4,
    "local5": logging.handlers.SysLogHandler.LOG_LOCAL5,
    "local6": logging.handlers.SysLogHandler.LOG_LOCAL6,
    "local7": logging.handlers.SysLogHandler.LOG_LOCAL7,
}


class AuditJsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = getattr(record, "audit_payload", None)
        if isinstance(payload, dict):
            return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        return json.dumps({"event_type": record.getMessage()}, ensure_ascii=False)


def parse_syslog_target(address: str) -> tuple[str | tuple[str, int], socket.SocketKind | None]:
    raw = address.strip()
    if raw.startswith("/"):
        return raw, None
    parsed = urlsplit(raw)
    if parsed.scheme not in {"udp", "tcp"} or not parsed.hostname:
        raise ValueError(
            "AUDIT_SYSLOG_ADDRESS 必须是 udp://host:port、tcp://host:port 或绝对 Unix 套接字路径"
        )
    port = parsed.port or 514
    socktype = socket.SOCK_DGRAM if parsed.scheme == "udp" else socket.SOCK_STREAM
    return (parsed.hostname, port), socktype


def _spool_lock_path(spool_file: Path) -> Path:
    return spool_file.with_name(f"{spool_file.name}.lock")


def spool_quarantine_path(spool_file: Path) -> Path:
    return spool_file.with_name(f"{spool_file.name}.quarantine")


@contextmanager
def _spool_process_lock(spool_file: Path) -> Iterator[None]:
    """进程内线程锁叠加独立锁文件的 fcntl.flock，保证 API 与 CLI 跨进程访问 spool 互斥。"""
    spool_file.parent.mkdir(parents=True, exist_ok=True)
    lock_path = _spool_lock_path(spool_file)
    with _SPOOL_LOCK:
        lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            os.fchmod(lock_fd, 0o600)
            fcntl.flock(lock_fd, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_fd, fcntl.LOCK_UN)
        finally:
            os.close(lock_fd)


def _write_all_and_sync(fd: int, data: bytes) -> None:
    view = memoryview(data)
    written_total = 0
    while written_total < len(view):
        written = os.write(fd, view[written_total:])
        if written <= 0:
            raise OSError("short write to audit spool file")
        written_total += written
    os.fsync(fd)


def _append_quarantine_lines_locked(spool_file: Path, corrupt_lines: list[bytes]) -> None:
    if not corrupt_lines:
        return
    q_path = spool_quarantine_path(spool_file)
    payload = b"".join(line.rstrip(b"\r\n") + b"\n" for line in corrupt_lines)
    current_size = q_path.stat().st_size if q_path.exists() else 0
    if current_size + len(payload) > MAX_QUARANTINE_BYTES:
        logging.getLogger("gmail_manager").error(
            "audit_spool_quarantine_full",
            extra={"safe_fields": {"max_bytes": MAX_QUARANTINE_BYTES}},
        )
        return
    fd = os.open(q_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.fchmod(fd, 0o600)
        _write_all_and_sync(fd, payload)
    finally:
        os.close(fd)
    logging.getLogger("gmail_manager").error(
        "audit_spool_corrupt_quarantined",
        extra={"safe_fields": {"count": len(corrupt_lines)}},
    )


def _append_spool_record(spool_file: Path, payload: dict[str, object]) -> None:
    line = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    with _spool_process_lock(spool_file):
        current_size = spool_file.stat().st_size if spool_file.exists() else 0
        if current_size + len(line) > MAX_SPOOL_BYTES:
            logging.getLogger("gmail_manager").error(
                "audit_spool_full",
                extra={"safe_fields": {"max_bytes": MAX_SPOOL_BYTES}},
            )
            return
        fd = os.open(spool_file, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            os.fchmod(fd, 0o600)
            _write_all_and_sync(fd, line)
        finally:
            os.close(fd)


def _rewrite_spool_lines_locked(spool_file: Path, lines: list[bytes]) -> None:
    if not lines:
        spool_file.unlink(missing_ok=True)
        return
    spool_file.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".audit_spool_", dir=str(spool_file.parent))
    try:
        os.fchmod(fd, 0o600)
        data = b"".join(item.rstrip(b"\r\n") + b"\n" for item in lines)
        try:
            _write_all_and_sync(fd, data)
        finally:
            os.close(fd)
        os.replace(tmp_name, spool_file)
    except OSError:
        Path(tmp_name).unlink(missing_ok=True)
        raise


class _ResilientSysLogHandler(logging.handlers.SysLogHandler):
    """Syslog 容错处理器：有限连接/发送超时、启动不可达不阻断 API、失败自动写入磁盘队列。"""

    def __init__(
        self,
        *args,
        spool_file: Path | None = None,
        timeout: float = AUDIT_SYSLOG_TIMEOUT_SECONDS,
        **kwargs,
    ) -> None:
        self._spool_file = spool_file
        self._timeout = timeout
        self.last_emit_failed = False

        logging.Handler.__init__(self)
        address = kwargs.get(
            "address", args[0] if args else ("localhost", logging.handlers.SYSLOG_UDP_PORT)
        )
        facility = kwargs.get("facility", args[1] if len(args) > 1 else self.LOG_USER)
        socktype = kwargs.get("socktype", args[2] if len(args) > 2 else None)
        self.address = address
        self.facility = facility
        self.socktype = socktype
        self.socket = None
        self.unixsocket = isinstance(address, str)
        try:
            self.createSocket()
        except OSError as exc:
            self._reset_socket()
            logging.getLogger("gmail_manager").error(
                "audit_sink_init_failed",
                extra={"safe_fields": {"exception_type": type(exc).__name__}},
            )

    def _reset_socket(self) -> None:
        sock = getattr(self, "socket", None)
        self.socket = None
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass

    def _connect_unixsocket(self, address) -> None:
        super()._connect_unixsocket(address)
        if self.socket is not None:
            self.socket.settimeout(self._timeout)

    def createSocket(self) -> None:
        address = self.address
        socktype = self.socktype
        if isinstance(address, str):
            self.unixsocket = True
            try:
                self._connect_unixsocket(address)
            except OSError:
                self._reset_socket()
            return
        self.unixsocket = False
        if socktype is None:
            socktype = socket.SOCK_DGRAM
        host, port = address
        ress = socket.getaddrinfo(host, port, 0, socktype)
        if not ress:
            raise OSError("getaddrinfo returns an empty list")
        err: OSError | None = None
        sock: socket.socket | None = None
        for af, res_socktype, proto, _, sa in ress:
            err = None
            sock = None
            try:
                sock = socket.socket(af, res_socktype, proto)
                sock.settimeout(self._timeout)
                if res_socktype == socket.SOCK_STREAM:
                    sock.connect(sa)
                socktype = res_socktype
                break
            except OSError as exc:
                err = exc
                if sock is not None:
                    sock.close()
                    sock = None
        if err is not None or sock is None:
            raise err or OSError("failed to create syslog socket")
        self.socket = sock
        self.socktype = socktype

    def emit(self, record: logging.LogRecord) -> None:
        self.last_emit_failed = False
        try:
            if self.socket is None:
                self.createSocket()
            if self.socket is None:
                raise FileNotFoundError("syslog socket unavailable")
        except Exception:
            self.handleError(record)
            return
        super().emit(record)

    def handleError(self, record: logging.LogRecord) -> None:
        self.last_emit_failed = True
        _, exc, _ = sys.exc_info()
        if self.unixsocket or self.socktype == socket.SOCK_STREAM:
            self._reset_socket()
        logging.getLogger("gmail_manager").error(
            "audit_sink_failed",
            extra={"safe_fields": {"exception_type": type(exc).__name__ if exc else "OSError"}},
        )
        if self._spool_file is not None and not getattr(record, "_from_spool", False):
            payload = getattr(record, "audit_payload", None)
            if isinstance(payload, dict):
                try:
                    _append_spool_record(self._spool_file, payload)
                except OSError as spool_exc:
                    logging.getLogger("gmail_manager").error(
                        "audit_spool_write_failed",
                        extra={"safe_fields": {"exception_type": type(spool_exc).__name__}},
                    )


def _drain_spool_with_handler(handler: _ResilientSysLogHandler) -> tuple[int, int, int]:
    spool_file = handler._spool_file
    if spool_file is None or not spool_file.is_file():
        return 0, 0, 0
    with _spool_process_lock(spool_file):
        if not spool_file.is_file():
            return 0, 0, 0
        raw_lines = [line for line in spool_file.read_bytes().splitlines() if line.strip()]
        if not raw_lines:
            spool_file.unlink(missing_ok=True)
            return 0, 0, 0
        flushed = 0
        remaining: list[bytes] = []
        corrupt: list[bytes] = []
        for idx, raw_line in enumerate(raw_lines):
            try:
                payload = json.loads(raw_line.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                corrupt.append(raw_line)
                continue
            if not isinstance(payload, dict):
                corrupt.append(raw_line)
                continue
            rec = logging.LogRecord(
                name=AUDIT_LOGGER_NAME,
                level=logging.INFO,
                pathname=__file__,
                lineno=0,
                msg=str(payload.get("event_type", "audit")),
                args=(),
                exc_info=None,
            )
            rec.audit_payload = payload
            rec._from_spool = True
            handler.emit(rec)
            if handler.last_emit_failed:
                remaining = raw_lines[idx:]
                break
            flushed += 1
        _append_quarantine_lines_locked(spool_file, corrupt)
        _rewrite_spool_lines_locked(spool_file, remaining)
        return flushed, len(remaining), len(corrupt)


def flush_audit_spool(
    settings: Settings, *, timeout: float = AUDIT_SYSLOG_TIMEOUT_SECONDS
) -> dict[str, int]:
    """将持久化磁盘队列中的待发审计记录重放至 Syslog，损坏行隔离至 .quarantine 文件。"""
    if not settings.audit_syslog_address:
        raise ValueError("未配置 AUDIT_SYSLOG_ADDRESS，无法重放 Syslog 队列")
    if settings.audit_syslog_spool_file is None:
        raise ValueError("未配置 AUDIT_SYSLOG_SPOOL_FILE，没有可重放的持久化队列")
    target, socktype = parse_syslog_target(settings.audit_syslog_address)
    facility = _FACILITY_MAP[settings.audit_syslog_facility]
    kwargs: dict = {
        "address": target,
        "facility": facility,
        "spool_file": settings.audit_syslog_spool_file,
        "timeout": timeout,
    }
    if socktype is not None:
        kwargs["socktype"] = socktype
    handler = _ResilientSysLogHandler(**kwargs)
    handler.ident = "gmail-manager-audit: "
    handler.setFormatter(AuditJsonFormatter())
    try:
        flushed, remaining, quarantined = _drain_spool_with_handler(handler)
        return {"flushed": flushed, "remaining": remaining, "quarantined": quarantined}
    finally:
        handler.close()


def configure_audit_sink(
    settings: Settings, *, timeout: float = AUDIT_SYSLOG_TIMEOUT_SECONDS
) -> logging.Logger:
    logger = logging.getLogger(AUDIT_LOGGER_NAME)
    for existing in list(logger.handlers):
        logger.removeHandler(existing)
        try:
            existing.close()
        except OSError:
            pass

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(AuditJsonFormatter())
    logger.addHandler(stream_handler)

    if settings.audit_syslog_address:
        target, socktype = parse_syslog_target(settings.audit_syslog_address)
        facility = _FACILITY_MAP[settings.audit_syslog_facility]
        kwargs: dict = {
            "address": target,
            "facility": facility,
            "spool_file": settings.audit_syslog_spool_file,
            "timeout": timeout,
        }
        if socktype is not None:
            kwargs["socktype"] = socktype
        syslog_handler = _ResilientSysLogHandler(**kwargs)
        syslog_handler.ident = "gmail-manager-audit: "
        syslog_handler.setFormatter(AuditJsonFormatter())
        logger.addHandler(syslog_handler)

    logger.setLevel(logging.INFO)
    logger.propagate = False
    return logger


def _serialize_audit_event(row: AuditEvent) -> dict[str, object]:
    created_at = row.created_at.astimezone(UTC).isoformat() if row.created_at else None
    operation = (
        row.event_metadata.get("operation") if isinstance(row.event_metadata, dict) else None
    )
    return {
        "stream": "audit",
        "seq": row.seq,
        "id": str(row.id),
        "created_at": created_at,
        "event_type": row.event_type,
        "operation": operation,
        "account_id": str(row.account_id) if row.account_id else None,
        "session_id": str(row.session_id) if row.session_id else None,
        "ip_address": str(row.ip_address).split("/", 1)[0] if row.ip_address else None,
        "prev_hash": bytes(row.prev_hash).hex() if row.prev_hash is not None else None,
        "event_hash": bytes(row.event_hash).hex() if row.event_hash is not None else None,
    }


def emit_audit_records(records: list[dict[str, object]]) -> None:
    if not records:
        return
    audit_logger = logging.getLogger(AUDIT_LOGGER_NAME)
    app_logger = logging.getLogger("gmail_manager")
    # 投递新记录前，若已配置 Syslog 磁盘补偿队列则优先尝试按 FIFO 重放历史积压。
    for handler in list(audit_logger.handlers):
        if isinstance(handler, _ResilientSysLogHandler) and handler._spool_file is not None:
            try:
                _drain_spool_with_handler(handler)
            except OSError as exc:
                app_logger.error(
                    "audit_spool_drain_failed",
                    extra={"safe_fields": {"exception_type": type(exc).__name__}},
                )
    for payload in records:
        try:
            audit_logger.info(str(payload["event_type"]), extra={"audit_payload": payload})
        except OSError as exc:
            # 远程 syslog 瞬时不可达不得阻断已提交事务，但须留下安全告警。
            app_logger.error(
                "audit_sink_failed",
                extra={"safe_fields": {"exception_type": type(exc).__name__}},
            )


def attach_audit_session_hooks(session: Session) -> None:
    """挂接会话钩子：按事务/保存点层级采集哈希链记录，回滚即丢弃，仅在顶层 commit 后外发。"""

    @event.listens_for(session, "after_flush")
    def _collect(sess: Session, _flush_context) -> None:
        tx = sess.get_nested_transaction() or sess.get_transaction()
        if tx is None:
            return
        buckets: dict[int, list[dict[str, object]]] = sess.info.setdefault(_PENDING_KEY, {})
        bucket = buckets.setdefault(id(tx), [])
        for obj in sess.new:
            if isinstance(obj, AuditEvent):
                bucket.append(_serialize_audit_event(obj))

    @event.listens_for(session, "after_soft_rollback")
    def _discard_tx(sess: Session, previous_transaction) -> None:
        buckets: dict[int, list[dict[str, object]]] | None = sess.info.get(_PENDING_KEY)
        if not buckets:
            return
        buckets.pop(id(previous_transaction), None)
        # flush() 内部子事务 nested 为 False 但 parent 非空；仅根事务回滚才清空全部待发桶。
        if previous_transaction.parent is None:
            sess.info.pop(_PENDING_KEY, None)

    @event.listens_for(session, "after_transaction_end")
    def _promote_nested(sess: Session, transaction) -> None:
        buckets: dict[int, list[dict[str, object]]] | None = sess.info.get(_PENDING_KEY)
        if not buckets or not transaction.nested:
            return
        records = buckets.pop(id(transaction), None)
        if records and transaction.parent is not None:
            buckets.setdefault(id(transaction.parent), []).extend(records)

    @event.listens_for(session, "after_commit")
    def _publish(sess: Session) -> None:
        # SAVEPOINT 释放时 SQLAlchemy 也会触发 after_commit；仅顶层事务提交后才真正外发。
        if sess.in_nested_transaction():
            return
        buckets: dict[int, list[dict[str, object]]] = sess.info.pop(_PENDING_KEY, {})
        records = [item for bucket in buckets.values() for item in bucket]
        emit_audit_records(records)

    @event.listens_for(session, "after_rollback")
    def _discard_all(sess: Session) -> None:
        # SAVEPOINT 回滚时 after_rollback 早于 after_transaction_end 触发，仅清理当前保存点桶。
        if sess.in_nested_transaction():
            nested_tx = sess.get_nested_transaction()
            buckets: dict[int, list[dict[str, object]]] | None = sess.info.get(_PENDING_KEY)
            if buckets and nested_tx is not None:
                buckets.pop(id(nested_tx), None)
            return
        sess.info.pop(_PENDING_KEY, None)
