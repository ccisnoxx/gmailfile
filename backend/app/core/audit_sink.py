"""提交后审计事件外发通道：结构化 JSON 审计日志与可选远程 Syslog 转发。

仅在数据库事务成功提交后外发已落盘的哈希链审计记录，确保回滚事务不会产生幽灵日志，
且外发字段严格白名单化，绝不包含凭据、明文密码、Cookie、CSRF 或任意请求体。
"""

from __future__ import annotations

import json
import logging
import logging.handlers
import socket
import sys
from datetime import UTC
from urllib.parse import urlsplit

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import AuditEvent

AUDIT_LOGGER_NAME = "gmail_manager.audit"
_PENDING_KEY = "pending_audit_records"

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


class _ResilientSysLogHandler(logging.handlers.SysLogHandler):
    """远程 Syslog 写入异常时转为安全告警日志，不向 stderr 倾倒堆栈且不阻断事务。"""

    def handleError(self, record: logging.LogRecord) -> None:
        _, exc, _ = sys.exc_info()
        logging.getLogger("gmail_manager").error(
            "audit_sink_failed",
            extra={"safe_fields": {"exception_type": type(exc).__name__ if exc else "OSError"}},
        )


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
        kwargs: dict = {"address": target, "facility": facility}
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
