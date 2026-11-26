"""多版本 AES-256-GCM 数据密钥重加密轮换与全量解密校验服务。

回退安全原则：
1. 轮换仅使用已配置且通过 32 字节校验的目标密钥版本重新生成 12 字节随机 nonce 与新版本 AAD。
2. 重加密不修改业务逻辑字段与 `gmail_accounts.row_version`，避免干扰打开页面的乐观锁。
3. 本服务绝不删除任何历史 `data_key_v*` 文件，且不向日志/标准输出打印明文、邮箱或密钥字节。
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from sqlalchemy import Engine, or_, select, text, update
from sqlalchemy.orm import Session

from app.api.dependencies import ACCOUNT_WRITE_LOCK
from app.core.encryption import DecryptionError, EncryptedValue, EncryptionService
from app.db.schema import schema_is_current
from app.models import AdminUser, AuditEvent, GmailAccount, UserSession
from app.services.auth import AUTH_LOCK


@dataclass(frozen=True)
class _EncryptedTableSpec:
    model: type
    entity: str
    fields: tuple[str, ...]


ENCRYPTED_SPECS: tuple[_EncryptedTableSpec, ...] = (
    _EncryptedTableSpec(GmailAccount, "gmail_account", ("password", "phone", "notes")),
    _EncryptedTableSpec(AdminUser, "admin_user", ("totp_secret",)),
    _EncryptedTableSpec(UserSession, "user_session", ("pending_totp",)),
)


def _version_col(model: type, field: str):
    return getattr(model, f"{field}_key_version")


def _cipher_col(model: type, field: str):
    return getattr(model, f"{field}_ciphertext")


def _nonce_col(model: type, field: str):
    return getattr(model, f"{field}_nonce")


def _needs_rotation_predicate(spec: _EncryptedTableSpec, target_version: int):
    clauses = []
    for field in spec.fields:
        vcol = _version_col(spec.model, field)
        clauses.append(vcol.is_not(None) & (vcol != target_version))
    return or_(*clauses)


def _table_columns(spec: _EncryptedTableSpec) -> list:
    cols = [spec.model.id]
    for field in spec.fields:
        cols.extend(
            [
                _cipher_col(spec.model, field),
                _nonce_col(spec.model, field),
                _version_col(spec.model, field),
            ]
        )
    return cols


def inspect_key_versions(engine: Engine, target_version: int) -> dict:
    """只读盘点全库加密字段的密钥版本分布与待轮换数量。"""
    version_counts: Counter[str] = Counter()
    pending_fields = 0
    pending_rows = 0

    with Session(engine) as db:
        for spec in ENCRYPTED_SPECS:
            vcols = [_version_col(spec.model, field) for field in spec.fields]
            stmt = select(spec.model.id, *vcols).order_by(spec.model.id.asc())
            for row in db.execute(stmt):
                row_needs = False
                for version in row[1:]:
                    if version is None:
                        continue
                    version_counts[f"v{version}"] += 1
                    if version != target_version:
                        pending_fields += 1
                        row_needs = True
                if row_needs:
                    pending_rows += 1

    return {
        "version_counts": dict(sorted(version_counts.items())),
        "pending_rows": pending_rows,
        "pending_fields": pending_fields,
    }


def verify_data_keys(
    engine: Engine,
    encryption: EncryptionService,
    *,
    require_version: int | None = None,
    batch_size: int = 500,
) -> dict:
    """逐行认证解密全库全部非空密文字段，验证完整性并可选要求统一到指定版本。"""
    if not schema_is_current(engine):
        raise ValueError("请先完成数据库迁移")
    if require_version is not None and require_version not in encryption.keys:
        raise ValueError(f"目标数据密钥版本 v{require_version} 未配置")

    checked_fields = 0
    mismatched_fields = 0
    failed_fields = 0
    version_counts: Counter[str] = Counter()

    with Session(engine) as db:
        for spec in ENCRYPTED_SPECS:
            stmt = (
                select(*_table_columns(spec))
                .order_by(spec.model.id.asc())
                .execution_options(stream_results=True, yield_per=batch_size)
            )
            result = db.execute(stmt)
            try:
                for partition in result.partitions(batch_size):
                    for row in partition:
                        record_id = row[0]
                        offset = 1
                        for field in spec.fields:
                            ciphertext, nonce, version = row[offset : offset + 3]
                            offset += 3
                            if ciphertext is None:
                                continue
                            checked_fields += 1
                            version_counts[f"v{version}"] += 1
                            if require_version is not None and version != require_version:
                                mismatched_fields += 1
                            try:
                                encryption.decrypt(
                                    EncryptedValue(ciphertext, nonce, version),
                                    spec.entity,
                                    record_id,
                                    field,
                                )
                            except DecryptionError:
                                failed_fields += 1
            finally:
                result.close()

    return {
        "valid": failed_fields == 0 and mismatched_fields == 0,
        "require_version": require_version,
        "available_versions": sorted(encryption.keys),
        "checked_fields": checked_fields,
        "mismatched_fields": mismatched_fields,
        "failed_fields": failed_fields,
        "version_counts": dict(sorted(version_counts.items())),
    }


def rotate_data_keys(
    engine: Engine,
    encryption: EncryptionService,
    *,
    target_version: int | None = None,
    batch_size: int = 200,
    dry_run: bool = False,
) -> dict:
    """将所有旧版本密文分批重加密至目标密钥版本，保持 row_version 不变并保留旧密钥回退能力。"""
    if not schema_is_current(engine):
        raise ValueError("请先完成数据库迁移")
    if batch_size < 1 or batch_size > 5000:
        raise ValueError("批次大小必须在 1 到 5000 之间")
    target = encryption.active_version if target_version is None else target_version
    if target not in encryption.keys:
        raise ValueError(f"目标数据密钥版本 v{target} 未配置")

    if dry_run:
        inventory = inspect_key_versions(engine, target)
        return {
            "dry_run": True,
            "target_version": target,
            "available_versions": sorted(encryption.keys),
            **inventory,
            "rotated_rows": 0,
            "rotated_fields": 0,
        }

    rotated_rows = 0
    rotated_fields = 0

    for spec in ENCRYPTED_SPECS:
        last_id = None
        while True:
            with Session(engine) as db, db.begin():
                # 固定锁序 AUTH_LOCK -> ACCOUNT_WRITE_LOCK，防止与在线认证或账号写操作交叉死锁。
                db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": AUTH_LOCK})
                db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": ACCOUNT_WRITE_LOCK})

                stmt = (
                    select(*_table_columns(spec))
                    .where(_needs_rotation_predicate(spec, target))
                    .order_by(spec.model.id.asc())
                    .limit(batch_size)
                )
                if last_id is not None:
                    stmt = stmt.where(spec.model.id > last_id)

                rows = db.execute(stmt).all()
                if not rows:
                    break

                for row in rows:
                    record_id = row[0]
                    last_id = record_id
                    updates: dict = {}
                    offset = 1
                    for field in spec.fields:
                        ciphertext, nonce, version = row[offset : offset + 3]
                        offset += 3
                        if ciphertext is None or version == target:
                            continue
                        plaintext = encryption.decrypt(
                            EncryptedValue(ciphertext, nonce, version),
                            spec.entity,
                            record_id,
                            field,
                        )
                        rewrapped = encryption.encrypt_with_version(
                            plaintext, spec.entity, record_id, field, target
                        )
                        updates[f"{field}_ciphertext"] = rewrapped.ciphertext
                        updates[f"{field}_nonce"] = rewrapped.nonce
                        updates[f"{field}_key_version"] = rewrapped.key_version
                        rotated_fields += 1

                    if updates:
                        db.execute(
                            update(spec.model).where(spec.model.id == record_id).values(**updates)
                        )
                        rotated_rows += 1

    if rotated_fields > 0:
        with Session(engine) as db, db.begin():
            db.add(
                AuditEvent(
                    event_type="data_keys_rotated",
                    event_metadata={"operation": "key-rotation"},
                )
            )

    verification = verify_data_keys(engine, encryption, require_version=target)
    return {
        "dry_run": False,
        "target_version": target,
        "available_versions": sorted(encryption.keys),
        "rotated_rows": rotated_rows,
        "rotated_fields": rotated_fields,
        "verified": verification["valid"],
        "checked_fields": verification["checked_fields"],
        "version_counts": verification["version_counts"],
    }
