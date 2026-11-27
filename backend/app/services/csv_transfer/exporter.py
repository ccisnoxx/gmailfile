"""非敏感白名单 CSV 分批流式导出服务（数据库游标 + 按批加载标签 + StreamingResponse）。"""

from __future__ import annotations

import csv
import io
import threading
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Engine, select, text
from sqlalchemy.orm import Session, load_only

from app.core.encryption import EncryptedValue, EncryptionService
from app.core.export_crypto import encrypt_stream
from app.models import GmailAccount, Tag, gmail_account_tags
from app.repositories.accounts import AccountRepository
from app.schemas.accounts import AccountQuery
from app.schemas.operations import ExportInput
from app.services.accounts import AccountService
from app.services.csv_transfer.parser import (
    ENCRYPTED_EXPORT_FIELDS,
    EXPORT_FIELDS,
    encode_csv_tags,
    spreadsheet_safe,
)

EXPORT_BATCH_SIZE = 500
# 数据库连接池默认 pool_size=5, max_overflow=0；将并发流式导出限制为 2，
# 为健康检查、认证与日常读写始终保留至少 3 条可用连接，防止慢客户端占满连接池。
DEFAULT_MAX_CONCURRENT_EXPORTS = 2


class ExportSlot:
    """线程安全且幂等释放的并发导出槽位句柄。"""

    def __init__(self, semaphore: threading.BoundedSemaphore) -> None:
        self._semaphore = semaphore
        self._lock = threading.Lock()
        self._released = False

    def release(self) -> None:
        with self._lock:
            if self._released:
                return
            self._released = True
        self._semaphore.release()

    def __del__(self) -> None:
        self.release()


def try_acquire_export_slot(semaphore: threading.BoundedSemaphore) -> ExportSlot | None:
    """非阻塞申请一个流式导出并发槽位；满载时立即返回 None。"""
    if not semaphore.acquire(blocking=False):
        return None
    return ExportSlot(semaphore)


_EXPORT_ACCOUNT_COLUMNS = (
    GmailAccount.id,
    GmailAccount.account_no,
    GmailAccount.gmail_email,
    GmailAccount.registered_at,
    GmailAccount.recovery_account_id,
    GmailAccount.recovery_email_external,
    GmailAccount.status,
    GmailAccount.two_factor_status,
    GmailAccount.last_login_at,
    GmailAccount.last_verified_at,
    GmailAccount.password_changed_at,
    GmailAccount.purpose,
    GmailAccount.archived_at,
    GmailAccount.deleted_at,
    GmailAccount.created_at,
    GmailAccount.updated_at,
)


def _format_timestamp(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def resolve_export_query(body: ExportInput) -> AccountQuery:
    return body.filters if body.scope == "filtered" else AccountQuery()


def _format_row(row: GmailAccount, recovery_email: str | None, tag_names: list[str]) -> list[str]:
    values = {
        "account_no": f"GM-{row.account_no:06d}",
        "gmail_email": row.gmail_email,
        "registered_at": _format_timestamp(row.registered_at),
        "recovery_email": row.recovery_email_external or recovery_email,
        "status": row.status,
        "two_factor_status": row.two_factor_status,
        "last_login_at": _format_timestamp(row.last_login_at),
        "last_verified_at": _format_timestamp(row.last_verified_at),
        "password_changed_at": _format_timestamp(row.password_changed_at),
        "purpose": row.purpose,
        "tags": encode_csv_tags(tag_names),
        "archived_at": _format_timestamp(row.archived_at),
        "deleted_at": _format_timestamp(row.deleted_at),
        "created_at": _format_timestamp(row.created_at),
        "updated_at": _format_timestamp(row.updated_at),
    }
    return [spreadsheet_safe(values[name]) for name in EXPORT_FIELDS]


def iter_export_csv_chunks(
    db: Session,
    params: AccountQuery,
    *,
    batch_size: int = EXPORT_BATCH_SIZE,
) -> Iterator[bytes]:
    """按游标分批读取非敏感列与标签并逐批输出 UTF-8 CSV 块，避免全量驻留内存。"""
    if batch_size < 1:
        raise ValueError("导出批次大小必须大于 0")
    repo = AccountRepository(db)
    column = getattr(GmailAccount, params.sort.lstrip("-"))
    order = column.desc() if params.sort.startswith("-") else column.asc()
    # 不加载任何密文字段，且不限制 LIMIT/OFFSET（导出全部匹配结果）。
    statement = (
        repo.filtered(params)
        .options(load_only(*_EXPORT_ACCOUNT_COLUMNS))
        .order_by(order.nulls_last(), GmailAccount.id)
        .execution_options(stream_results=True, yield_per=batch_size)
    )

    header_buffer = io.StringIO(newline="")
    csv.writer(header_buffer).writerow(EXPORT_FIELDS)
    yield ("\ufeff" + header_buffer.getvalue()).encode("utf-8")

    result = db.execute(statement)
    try:
        for batch in result.partitions(batch_size):
            if not batch:
                continue
            account_ids = [row.id for row, _ in batch]
            tags_by_account: dict[UUID, list[str]] = {}
            tag_rows = db.execute(
                select(gmail_account_tags.c.account_id, Tag.name)
                .join(Tag, Tag.id == gmail_account_tags.c.tag_id)
                .where(gmail_account_tags.c.account_id.in_(account_ids))
                .order_by(Tag.name)
            ).all()
            for owner_id, tag_name in tag_rows:
                tags_by_account.setdefault(owner_id, []).append(tag_name)
            chunk_buffer = io.StringIO(newline="")
            writer = csv.writer(chunk_buffer)
            for row, recovery in batch:
                writer.writerow(_format_row(row, recovery, tags_by_account.get(row.id, [])))
                # 逐条移出 identity map（不能调用 expunge_all 替换正在流式读取的 map）。
                db.expunge(row)
            yield chunk_buffer.getvalue().encode("utf-8")
    finally:
        result.close()


def stream_export_csv(
    engine: Engine,
    params: AccountQuery,
    *,
    batch_size: int = EXPORT_BATCH_SIZE,
    on_close: Callable[[], None] | None = None,
) -> Iterator[bytes]:
    """在独立只读 REPEATABLE READ 快照事务中流式导出 CSV，供 StreamingResponse 使用。"""
    try:
        with Session(engine) as db, db.begin():
            db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
            yield from iter_export_csv_chunks(db, params, batch_size=batch_size)
    finally:
        if on_close is not None:
            on_close()


def export_csv(auth, body: ExportInput, *, batch_size: int = EXPORT_BATCH_SIZE) -> bytes:
    """兼容辅助入口：认证、记录审计并聚合流式导出结果。"""
    service = AccountService(auth)
    params = resolve_export_query(body)
    data = b"".join(iter_export_csv_chunks(service.db, params, batch_size=batch_size))
    service.audit("csv_exported", operation="csv")
    return data


def _decrypt_optional_field(
    encryption: EncryptionService,
    row: GmailAccount,
    field: str,
) -> str:
    ciphertext = getattr(row, f"{field}_ciphertext")
    if ciphertext is None:
        return ""
    return encryption.decrypt(
        EncryptedValue(
            ciphertext,
            getattr(row, f"{field}_nonce"),
            getattr(row, f"{field}_key_version"),
        ),
        "gmail_account",
        row.id,
        field,
    )


def _format_encrypted_row(
    row: GmailAccount,
    recovery_email: str | None,
    tag_names: list[str],
    encryption: EncryptionService,
) -> list[str]:
    password = encryption.decrypt(
        EncryptedValue(row.password_ciphertext, row.password_nonce, row.password_key_version),
        "gmail_account",
        row.id,
        "password",
    )
    phone = _decrypt_optional_field(encryption, row, "phone")
    notes = _decrypt_optional_field(encryption, row, "notes")
    values = {
        "account_no": f"GM-{row.account_no:06d}",
        "gmail_email": row.gmail_email,
        "password": password,
        "registered_at": _format_timestamp(row.registered_at),
        "recovery_email": row.recovery_email_external or recovery_email,
        "phone": phone,
        "status": row.status,
        "two_factor_status": row.two_factor_status,
        "last_login_at": _format_timestamp(row.last_login_at),
        "last_verified_at": _format_timestamp(row.last_verified_at),
        "password_changed_at": _format_timestamp(row.password_changed_at),
        "purpose": row.purpose,
        "tags": encode_csv_tags(tag_names),
        "notes": notes,
        "archived_at": _format_timestamp(row.archived_at),
        "deleted_at": _format_timestamp(row.deleted_at),
        "created_at": _format_timestamp(row.created_at),
        "updated_at": _format_timestamp(row.updated_at),
    }
    # 加密导出面向离线凭据还原/重导入，保留密码/手机号/备注原始字节，不做公式单引号篡改。
    return [
        str(values[name]) if values[name] is not None else "" for name in ENCRYPTED_EXPORT_FIELDS
    ]


def iter_encrypted_export_csv_chunks(
    db: Session,
    encryption: EncryptionService,
    params: AccountQuery,
    *,
    batch_size: int = EXPORT_BATCH_SIZE,
) -> Iterator[bytes]:
    """按游标分批解密并生成完整 CSV 明文块（仅存内存，供外层流式加密器实时消费）。"""
    if batch_size < 1:
        raise ValueError("导出批次大小必须大于 0")
    repo = AccountRepository(db)
    column = getattr(GmailAccount, params.sort.lstrip("-"))
    order = column.desc() if params.sort.startswith("-") else column.asc()
    statement = (
        repo.filtered(params)
        .order_by(order.nulls_last(), GmailAccount.id)
        .execution_options(stream_results=True, yield_per=batch_size)
    )

    header_buffer = io.StringIO(newline="")
    csv.writer(header_buffer).writerow(ENCRYPTED_EXPORT_FIELDS)
    yield ("\ufeff" + header_buffer.getvalue()).encode("utf-8")

    result = db.execute(statement)
    try:
        for batch in result.partitions(batch_size):
            if not batch:
                continue
            account_ids = [row.id for row, _ in batch]
            tags_by_account: dict[UUID, list[str]] = {}
            tag_rows = db.execute(
                select(gmail_account_tags.c.account_id, Tag.name)
                .join(Tag, Tag.id == gmail_account_tags.c.tag_id)
                .where(gmail_account_tags.c.account_id.in_(account_ids))
                .order_by(Tag.name)
            ).all()
            for owner_id, tag_name in tag_rows:
                tags_by_account.setdefault(owner_id, []).append(tag_name)
            chunk_buffer = io.StringIO(newline="")
            writer = csv.writer(chunk_buffer)
            for row, recovery in batch:
                writer.writerow(
                    _format_encrypted_row(
                        row, recovery, tags_by_account.get(row.id, []), encryption
                    )
                )
                db.expunge(row)
            yield chunk_buffer.getvalue().encode("utf-8")
    finally:
        result.close()


def stream_export_encrypted_csv(
    engine: Engine,
    encryption: EncryptionService,
    params: AccountQuery,
    passphrase: str,
    *,
    batch_size: int = EXPORT_BATCH_SIZE,
    on_close: Callable[[], None] | None = None,
) -> Iterator[bytes]:
    """在独立 REPEATABLE READ 只读快照事务中分批解密并流式输出 GME1 加密包（零明文落盘）。"""
    try:
        with Session(engine) as db, db.begin():
            db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
            plaintext_stream = iter_encrypted_export_csv_chunks(
                db, encryption, params, batch_size=batch_size
            )
            yield from encrypt_stream(plaintext_stream, passphrase)
    finally:
        if on_close is not None:
            on_close()
