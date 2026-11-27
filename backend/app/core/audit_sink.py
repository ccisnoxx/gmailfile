"""提交后审计事件外发通道：结构化 JSON 审计日志与可选远程 Syslog 转发。

仅在数据库事务成功提交后外发已落盘的哈希链审计记录，确保回滚事务不会产生幽灵日志，
且外发字段严格白名单化，绝不包含凭据、明文密码、Cookie、CSRF 或任意请求体。
"""

from __future__ import annotations

import json
import logging
import logging.handlers
import os
import socket
import sys
import tempfile
import threading
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


def _append_spool_record(spool_file: Path, payload: dict[str, object]) -> None:
    line = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    with _SPOOL_LOCK:
        spool_file.parent.mkdir(parents=True, exist_ok=True)
        current_size = spool_file.stat().st_size if spool_file.exists() else 0
        if current_size + len(line) > MAX_SPOOL_BYTES:
            logging.getLogger("gmail_manager").error(
                "audit_spool_full",
                extra={"safe_fields": {"max_bytes": MAX_SPOOL_BYTES}},
            )
            return
        fd = os.open(spool_file, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            os.chmod(spool_file, 0o600)
            os.write(fd, line)
        finally:
            os.close(fd)


def _rewrite_spool_lines(spool_file: Path, lines: list[str]) -> None:
    if not lines:
        spool_file.unlink(missing_ok=True)
        return
    spool_file.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".audit_spool_", dir=str(spool_file.parent))
    try:
        os.chmod(tmp_name, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            for item in lines:
                handle.write(item.rstrip("\n") + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, spool_file)
    except OSError:
        Path(tmp_name).unlink(missing_ok=True)
        raise


class _ResilientSysLogHandler(logging.handlers.SysLogHandler):
    """远程 Syslog 写入异常时转为安全告警日志并写入可选持久化队列，不阻断事务。"""

    def __init__(self, *args, spool_file: Path | None = None, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._spool_file = spool_file
        self.last_emit_failed = False

    def emit(self, record: logging.LogRecord) -> None:
        self.last_emit_failed = False
        super().emit(record)

    def handleError(self, record: logging.LogRecord) -> None:
        self.last_emit_failed = True
        _, exc, _ = sys.exc_info()
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


def _drain_spool_with_handler(handler: _ResilientSysLogHandler) -> tuple[int, int]:
    spool_file = handler._spool_file
    if spool_file is None or not spool_file.is_file():
        return 0, 0
    with _SPOOL_LOCK:
        if not spool_file.is_file():
            return 0, 0
        raw_lines = [
            line for line in spool_file.read_text(encoding="utf-8").splitlines() if line.strip()
        ]
        if not raw_lines:
            spool_file.unlink(missing_ok=True)
            return 0, 0
        flushed = 0
        remaining: list[str] = []
        for idx, line in enumerate(raw_lines):
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
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
        _rewrite_spool_lines(spool_file, remaining)
        return flushed, len(remaining)


def flush_audit_spool(settings: Settings) -> dict[str, int]:
    """将持久化磁盘队列中的待发审计记录重放至远程 Syslog。"""
    if not settings.audit_syslog_address:
        raise ValueError("未配置 AUDIT_SYSLOG_ADDRESS，无法重放远程 Syslog 队列")
    if settings.audit_syslog_spool_file is None:
        raise ValueError("未配置 AUDIT_SYSLOG_SPOOL_FILE，没有可重放的持久化队列")
    target, socktype = parse_syslog_target(settings.audit_syslog_address)
    facility = _FACILITY_MAP[settings.audit_syslog_facility]
    kwargs: dict = {
        "address": target,
        "facility": facility,
        "spool_file": settings.audit_syslog_spool_file,
    }
    if socktype is not None:
        kwargs["socktype"] = socktype
    handler = _ResilientSysLogHandler(**kwargs)
    handler.ident = "gmail-manager-audit: "
    handler.setFormatter(AuditJsonFormatter())
    try:
        flushed, remaining = _drain_spool_with_handler(handler)
        return {"flushed": flushed, "remaining": remaining}
    finally:
        handler.close()


def configure_audit_sink(settings: Settings) -> logging.Logger:
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
        if not previous_transaction.nested:
            buckets.clear()

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
        buckets: dict[int, list[dict[str, object]]] = sess.info.pop(_PENDING_KEY, {})
        records = [item for bucket in buckets.values() for item in bucket]
        emit_audit_records(records)

    @event.listens_for(session, "after_rollback")
    def _discard_all(sess: Session) -> None:
        sess.info.pop(_PENDING_KEY, None)
