"""防篡改审计哈希链校验、定期签名检查点与受控归档导出。"""

from __future__ import annotations

import hashlib
import hmac
import json
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from ipaddress import ip_address
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditEvent

GENESIS_HASH = b"\x00" * 32


@dataclass(frozen=True)
class AuditChainStatus:
    valid: bool
    total_events: int
    latest_seq: int | None
    latest_hash: str | None
    broken_seq: int | None = None
    reason: str | None = None


def _len_prefix(value: str) -> str:
    return f"{len(value.encode('utf-8'))}:{value}"


def _canonical_metadata(metadata: dict | None) -> str:
    if not metadata:
        return ""
    parts: list[str] = []
    for key in sorted(metadata.keys()):
        raw = metadata[key]
        if raw is None:
            text_value = ""
        elif isinstance(raw, bool):
            text_value = "true" if raw else "false"
        elif isinstance(raw, (dict, list)):
            text_value = json.dumps(raw, ensure_ascii=False, separators=(",", ":"))
        else:
            text_value = str(raw)
        parts.append(f"{_len_prefix(str(key))}={_len_prefix(text_value)}")
    return "\n".join(parts)


def _normalize_ip(value: object) -> str:
    if value is None or value == "":
        return ""
    raw = str(value).split("/", 1)[0]
    try:
        return str(ip_address(raw))
    except ValueError:
        return raw


def compute_audit_event_hash(
    *,
    seq: int,
    prev_hash: bytes,
    event_id: UUID | str,
    created_at: datetime,
    event_type: str,
    account_id: UUID | str | None,
    session_id: UUID | str | None,
    ip_addr: object,
    user_agent: str | None,
    metadata: dict | None,
) -> bytes:
    """按与 PostgreSQL 触发器字节一致的规范化格式计算 SHA-256 链哈希。"""
    created = created_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    fields = [
        str(seq),
        bytes(prev_hash).hex(),
        str(event_id).lower(),
        created,
        event_type,
        str(account_id).lower() if account_id is not None else "",
        str(session_id).lower() if session_id is not None else "",
        _normalize_ip(ip_addr),
        user_agent or "",
        _canonical_metadata(metadata),
    ]
    payload = "v1\n" + "\n".join(_len_prefix(item) for item in fields)
    return hashlib.sha256(payload.encode("utf-8")).digest()


def verify_audit_records(records: Iterable[tuple]) -> AuditChainStatus:
    """按 seq 递增顺序校验 (seq, prev_hash, event_hash, id, created_at, ...)。"""
    expected_seq = 1
    expected_prev = GENESIS_HASH
    latest_seq: int | None = None
    latest_hash: str | None = None
    total = 0
    for row in records:
        (
            seq,
            prev_hash,
            event_hash,
            event_id,
            created_at,
            event_type,
            account_id,
            session_id,
            ip_addr,
            user_agent,
            metadata,
        ) = row
        total += 1
        if seq != expected_seq:
            return AuditChainStatus(
                valid=False,
                total_events=total,
                latest_seq=latest_seq,
                latest_hash=latest_hash,
                broken_seq=seq,
                reason="SEQUENCE_GAP_OR_ORDER",
            )
        prev_bytes = bytes(prev_hash) if prev_hash is not None else b""
        hash_bytes = bytes(event_hash) if event_hash is not None else b""
        if len(prev_bytes) != 32 or not hmac.compare_digest(prev_bytes, expected_prev):
            return AuditChainStatus(
                valid=False,
                total_events=total,
                latest_seq=latest_seq,
                latest_hash=latest_hash,
                broken_seq=seq,
                reason="PREV_HASH_MISMATCH",
            )
        computed = compute_audit_event_hash(
            seq=seq,
            prev_hash=prev_bytes,
            event_id=event_id,
            created_at=created_at,
            event_type=event_type,
            account_id=account_id,
            session_id=session_id,
            ip_addr=ip_addr,
            user_agent=user_agent,
            metadata=metadata,
        )
        if len(hash_bytes) != 32 or not hmac.compare_digest(hash_bytes, computed):
            return AuditChainStatus(
                valid=False,
                total_events=total,
                latest_seq=latest_seq,
                latest_hash=latest_hash,
                broken_seq=seq,
                reason="EVENT_HASH_MISMATCH",
            )
        expected_prev = hash_bytes
        latest_seq = seq
        latest_hash = hash_bytes.hex()
        expected_seq += 1
    return AuditChainStatus(
        valid=True,
        total_events=total,
        latest_seq=latest_seq,
        latest_hash=latest_hash,
    )


def verify_audit_chain(db: Session, *, batch_size: int = 1000) -> AuditChainStatus:
    """流式校验数据库中的全部审计事件哈希链，不一次性载入全部记录。"""
    stmt = (
        select(
            AuditEvent.seq,
            AuditEvent.prev_hash,
            AuditEvent.event_hash,
            AuditEvent.id,
            AuditEvent.created_at,
            AuditEvent.event_type,
            AuditEvent.account_id,
            AuditEvent.session_id,
            AuditEvent.ip_address,
            AuditEvent.user_agent,
            AuditEvent.event_metadata,
        )
        .order_by(AuditEvent.seq.asc())
        .execution_options(stream_results=True, yield_per=batch_size)
    )
    result = db.execute(stmt)
    try:
        return verify_audit_records(result)
    finally:
        result.close()


def _checkpoint_payload(checkpoint: dict) -> bytes:
    canonical = {
        "version": checkpoint["version"],
        "signed_at": checkpoint["signed_at"],
        "total_events": checkpoint["total_events"],
        "latest_seq": checkpoint["latest_seq"],
        "latest_hash": checkpoint["latest_hash"],
    }
    if "key_id" in checkpoint:
        canonical["key_id"] = checkpoint["key_id"]
    return json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _load_ed25519_private_key(pem_bytes: bytes):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    try:
        key = serialization.load_pem_private_key(pem_bytes, password=None)
    except (ValueError, TypeError) as exc:
        raise ValueError("无效的 Ed25519 PEM 私钥文件") from exc
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("审计非对称签名密钥必须是 Ed25519 私钥")
    return key


def _load_ed25519_public_key(pem_bytes: bytes):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    try:
        key = serialization.load_pem_public_key(pem_bytes)
    except (ValueError, TypeError) as exc:
        raise ValueError("无效的 Ed25519 PEM 公钥文件") from exc
    if not isinstance(key, Ed25519PublicKey):
        raise ValueError("审计非对称校验密钥必须是 Ed25519 公钥")
    return key


def _ed25519_key_id(public_key) -> str:
    from cryptography.hazmat.primitives import serialization

    raw_pub = public_key.public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
    )
    return hashlib.sha256(raw_pub).hexdigest()[:16]


def sign_audit_checkpoint_ed25519(
    status: AuditChainStatus, private_key_pem: bytes, *, now: datetime | None = None
) -> dict:
    """使用 Ed25519 非对称私钥签发审计检查点，外部核验方仅需公钥即可验签且无法伪造。"""
    if not status.valid:
        raise ValueError("审计链完整性校验失败，拒绝签发检查点")
    private_key = _load_ed25519_private_key(private_key_pem)
    public_key = private_key.public_key()
    stamp = (now or datetime.now(UTC)).astimezone(UTC).isoformat()
    checkpoint = {
        "version": 2,
        "algorithm": "ed25519",
        "key_id": _ed25519_key_id(public_key),
        "signed_at": stamp,
        "total_events": status.total_events,
        "latest_seq": status.latest_seq,
        "latest_hash": status.latest_hash,
    }
    checkpoint["signature"] = private_key.sign(_checkpoint_payload(checkpoint)).hex()
    return checkpoint


def verify_audit_checkpoint_ed25519(checkpoint: dict, public_key_pem: bytes) -> bool:
    from cryptography.exceptions import InvalidSignature

    if checkpoint.get("version") != 2 or checkpoint.get("algorithm") != "ed25519":
        return False
    signature = checkpoint.get("signature")
    if not isinstance(signature, str):
        return False
    try:
        public_key = _load_ed25519_public_key(public_key_pem)
        if checkpoint.get("key_id") != _ed25519_key_id(public_key):
            return False
        sig_bytes = bytes.fromhex(signature)
        payload = _checkpoint_payload(checkpoint)
        public_key.verify(sig_bytes, payload)
        return True
    except (ValueError, KeyError, InvalidSignature):
        return False


def sign_audit_checkpoint(
    status: AuditChainStatus, signing_key: bytes, *, now: datetime | None = None
) -> dict:
    """签发可离线核验的审计检查点：PEM 私钥使用 Ed25519（推荐），原始随机字节兼容 HMAC-SHA256。"""
    if signing_key.lstrip().startswith(b"-----BEGIN "):
        return sign_audit_checkpoint_ed25519(status, signing_key, now=now)
    if not status.valid:
        raise ValueError("审计链完整性校验失败，拒绝签发检查点")
    if len(signing_key) < 32:
        raise ValueError("审计签名密钥长度必须至少 32 字节")
    stamp = (now or datetime.now(UTC)).astimezone(UTC).isoformat()
    checkpoint = {
        "version": 1,
        "algorithm": "hmac-sha256",
        "signed_at": stamp,
        "total_events": status.total_events,
        "latest_seq": status.latest_seq,
        "latest_hash": status.latest_hash,
    }
    checkpoint["signature"] = hmac.new(
        signing_key, _checkpoint_payload(checkpoint), hashlib.sha256
    ).hexdigest()
    return checkpoint


def verify_audit_checkpoint(checkpoint: dict, signing_key: bytes) -> bool:
    if checkpoint.get("algorithm") == "ed25519" or checkpoint.get("version") == 2:
        return verify_audit_checkpoint_ed25519(checkpoint, signing_key)
    if len(signing_key) < 32 or checkpoint.get("version") != 1:
        return False
    if checkpoint.get("algorithm") != "hmac-sha256":
        return False
    signature = checkpoint.get("signature")
    if not isinstance(signature, str):
        return False
    try:
        expected = hmac.new(
            signing_key, _checkpoint_payload(checkpoint), hashlib.sha256
        ).hexdigest()
    except KeyError:
        return False
    return hmac.compare_digest(signature, expected)
