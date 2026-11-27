"""应用图标 SSRF 防护校验与回收站永久删除服务单元测试。"""

import base64
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.models import GmailAccount
from app.schemas.accounts import BatchInput, BatchItem
from app.services.accounts import app_icon
from app.services.accounts.detail import AccountDetailService
from app.services.accounts.errors import AccountError

PNG_SAMPLE = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
PNG_DATA_URI = "data:image/png;base64," + base64.b64encode(PNG_SAMPLE).decode("ascii")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("claude.ai", "claude.ai"),
        ("https://ChatGPT.com/path?a=1", "chatgpt.com"),
        ("http://sub.example.org.", "sub.example.org"),
        ("   ", None),
        (None, None),
    ],
)
def test_normalize_domain_accepts_public_hosts(raw, expected):
    assert app_icon.normalize_domain(raw) == expected


@pytest.mark.parametrize(
    "bad",
    [
        "localhost",
        "127.0.0.1",
        "169.254.169.254",
        "192.168.1.1",
        "[::1]",
        "service.internal",
        "printer.local",
        "user:pass@example.com",
        "ftp://example.com",
        "not a domain",
    ],
)
def test_normalize_domain_rejects_internal_ip_and_invalid_hosts(bad):
    with pytest.raises(AccountError) as exc_info:
        app_icon.normalize_domain(bad)
    assert exc_info.value.status == 422
    assert exc_info.value.code == "APP_DOMAIN_INVALID"


@pytest.mark.parametrize(
    "addr",
    [
        "127.0.0.1",
        "10.0.0.1",
        "172.16.0.5",
        "192.168.0.10",
        "169.254.169.254",
        "100.64.0.1",
        "::1",
        "::ffff:127.0.0.1",
    ],
)
def test_resolve_public_ips_blocks_non_public_targets(monkeypatch, addr):
    monkeypatch.setattr(
        app_icon.socket,
        "getaddrinfo",
        lambda host, port, type=0: [(0, 0, 0, "", (addr, port))],
    )
    with pytest.raises(AccountError) as exc_info:
        app_icon.resolve_public_ips("example.com")
    assert exc_info.value.code == "APP_DOMAIN_INVALID"


def test_validate_icon_data_accepts_raster_and_blocks_svg():
    assert app_icon.validate_icon_data(PNG_DATA_URI) == PNG_DATA_URI
    assert app_icon.validate_icon_data(None) is None

    svg_payload = base64.b64encode(b"<svg onload=alert(1)></svg>").decode("ascii")
    with pytest.raises(AccountError) as exc_svg:
        app_icon.validate_icon_data(f"data:image/svg+xml;base64,{svg_payload}")
    assert exc_svg.value.code == "APP_ICON_INVALID"

    # 即使伪装成 image/png，魔数不匹配也必须拒绝
    with pytest.raises(AccountError) as exc_spoof:
        app_icon.validate_icon_data(f"data:image/png;base64,{svg_payload}")
    assert exc_spoof.value.code == "APP_ICON_INVALID"

    # 超过 64KB 原始体积也必须拒绝
    oversized = "data:image/png;base64," + base64.b64encode(PNG_SAMPLE + b"\x00" * 70000).decode(
        "ascii"
    )
    with pytest.raises(AccountError) as exc_big:
        app_icon.validate_icon_data(oversized)
    assert exc_big.value.code == "APP_ICON_INVALID"


def test_detect_safe_raster_mime_rejects_oversized_dimensions_and_png_zip_bomb():
    import struct
    import zlib

    def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)

    # 1. 合法 1x1 PNG 与 GIF 通过
    assert app_icon.detect_safe_raster_mime(PNG_SAMPLE) == "image/png"
    valid_gif = b"GIF89a" + struct.pack("<HH", 64, 64) + b"\x00" * 8
    assert app_icon.detect_safe_raster_mime(valid_gif) == "image/gif"

    # 2. 畸形超大尺寸（5000x5000）拒绝
    huge_ihdr = struct.pack(">IIBBBBB", 5000, 5000, 8, 2, 0, 0, 0)
    huge_png = (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", huge_ihdr)
        + _png_chunk(b"IDAT", zlib.compress(b"\x00" * 16))
        + _png_chunk(b"IEND", b"")
    )
    assert app_icon.detect_safe_raster_mime(huge_png) is None

    # 3. PNG 压缩炸弹（合法 1024x1024 IHDR，但 IDAT 解压超过 4 MiB）必须拒绝
    bomb_ihdr = struct.pack(">IIBBBBB", 1024, 1024, 8, 6, 0, 0, 0)
    bomb_idat = zlib.compress(b"\x00" * (5 * 1024 * 1024), level=9)
    assert len(bomb_idat) < app_icon.MAX_ICON_BYTES
    bomb_png = (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", bomb_ihdr)
        + _png_chunk(b"IDAT", bomb_idat)
        + _png_chunk(b"IEND", b"")
    )
    assert app_icon.detect_safe_raster_mime(bomb_png) is None


def test_fetch_domain_icon_prefers_raster_and_skips_svg(monkeypatch):
    monkeypatch.setattr(app_icon, "resolve_public_ips", lambda host, port=443: ["93.184.216.34"])

    html = (
        b"<html><head>"
        b'<link rel="icon" type="image/svg+xml" href="/logo.svg">'
        b'<link rel="apple-touch-icon" sizes="180x180" href="/apple-icon.png">'
        b"</head></html>"
    )
    responses = {
        "https://perplexity.ai/": ("text/html", html),
        "https://perplexity.ai/apple-icon.png": ("image/png", PNG_SAMPLE),
    }

    def fake_fetch(url: str, *, max_bytes: int, deadline: float | None = None):
        return responses.get(url)

    monkeypatch.setattr(app_icon, "_fetch_https_bytes", fake_fetch)

    domain, data_uri = app_icon.fetch_domain_icon("https://Perplexity.ai/home")
    assert domain == "perplexity.ai"
    assert data_uri == PNG_DATA_URI


def test_fetch_domain_icon_enforces_total_budget_deadline(monkeypatch):
    clock = [100.0]

    def fake_monotonic() -> float:
        return clock[0]

    def slow_resolve(host: str, port: int = 443):
        clock[0] += 5.0
        return ["93.184.216.34"]

    fetch_calls = []

    def fake_fetch(url: str, *, max_bytes: int, deadline: float | None = None):
        fetch_calls.append((url, deadline))
        clock[0] += 4.0
        return None

    monkeypatch.setattr(app_icon.time, "monotonic", fake_monotonic)
    monkeypatch.setattr(app_icon, "resolve_public_ips", slow_resolve)
    monkeypatch.setattr(app_icon, "_fetch_https_bytes", fake_fetch)

    with pytest.raises(AccountError) as exc_info:
        app_icon.fetch_domain_icon("example.com", budget_seconds=8.0)
    assert exc_info.value.status == 422
    assert exc_info.value.code == "APP_ICON_FETCH_FAILED"
    assert "超时" in exc_info.value.message
    # 主页探测消耗完预算后，必须立即中止，不得继续抓取全部候选图标
    assert len(fetch_calls) == 1


def test_icon_fetch_slot_bounded_and_idempotent_release():
    import threading

    sem = threading.BoundedSemaphore(2)
    slot1 = app_icon.try_acquire_icon_fetch_slot(sem)
    slot2 = app_icon.try_acquire_icon_fetch_slot(sem)
    assert slot1 is not None and slot2 is not None
    assert app_icon.try_acquire_icon_fetch_slot(sem) is None

    slot1.release()
    slot1.release()
    slot3 = app_icon.try_acquire_icon_fetch_slot(sem)
    assert slot3 is not None
    assert app_icon.try_acquire_icon_fetch_slot(sem) is None
    slot2.release()
    slot3.release()


def _make_account(*, deleted: bool, version: int = 1, email: str = "demo@gmail.com"):
    now = datetime(2026, 11, 27, 12, 0, tzinfo=UTC)
    return GmailAccount(
        id=uuid4(),
        gmail_email=email,
        gmail_email_normalized=email.lower(),
        row_version=version,
        deleted_at=now if deleted else None,
        recovery_email_external="backup@example.com",
    )


def test_permanent_delete_and_batch_require_mfa_step_up():
    from app.services.auth import SecurityError

    now = datetime(2026, 11, 27, 12, 0, tzinfo=UTC)
    trashed = _make_account(deleted=True, version=2)
    db = MagicMock()
    require_recent = MagicMock(side_effect=SecurityError(403, "REAUTH_REQUIRED", "请先重新验证"))
    auth = SimpleNamespace(db=db, now=now, audit=MagicMock(), require_recent=require_recent)
    session = MagicMock()
    service = AccountDetailService(auth=auth, session=session, listing=MagicMock())

    with pytest.raises(SecurityError) as exc_single:
        service.permanent_delete(trashed.id, 2)
    assert exc_single.value.status == 403
    assert exc_single.value.code == "REAUTH_REQUIRED"
    require_recent.assert_called_with(session, require_mfa=True)
    db.get.assert_not_called()

    with pytest.raises(SecurityError) as exc_batch:
        service.batch_permanent_delete(
            BatchInput(accounts=[BatchItem(id=trashed.id, row_version=2)])
        )
    assert exc_batch.value.status == 403
    assert exc_batch.value.code == "REAUTH_REQUIRED"
    assert require_recent.call_count == 2
    db.get.assert_not_called()


def test_permanent_delete_rejects_active_account_and_version_conflict():
    now = datetime(2026, 11, 27, 12, 0, tzinfo=UTC)
    active = _make_account(deleted=False, version=1)
    trashed = _make_account(deleted=True, version=3)

    db = MagicMock()
    db.get.side_effect = [active, trashed]
    require_recent = MagicMock()
    auth = SimpleNamespace(db=db, now=now, audit=MagicMock(), require_recent=require_recent)
    session = MagicMock()
    service = AccountDetailService(auth=auth, session=session, listing=MagicMock())

    with pytest.raises(AccountError) as exc_active:
        service.permanent_delete(active.id, 1)
    assert exc_active.value.status == 409
    assert exc_active.value.code == "ACCOUNT_NOT_DELETED"

    with pytest.raises(AccountError) as exc_conflict:
        service.permanent_delete(trashed.id, 2)
    assert exc_conflict.value.status == 409
    assert exc_conflict.value.code == "ROW_VERSION_CONFLICT"
    assert require_recent.call_count == 2


def test_permanent_delete_unlinks_dependent_recovery_and_audits():
    now = datetime(2026, 11, 27, 12, 0, tzinfo=UTC)
    trashed = _make_account(deleted=True, version=2, email="old.recovery@gmail.com")
    dependent = _make_account(deleted=False, version=4, email="survivor@gmail.com")
    dependent.recovery_account_id = trashed.id
    dependent.recovery_email_external = None

    db = MagicMock()
    db.get.return_value = trashed
    db.scalars.return_value.all.return_value = [dependent]
    delete_result = SimpleNamespace(rowcount=1)
    db.execute.side_effect = [MagicMock(), MagicMock(), delete_result]

    audit = MagicMock()
    require_recent = MagicMock()
    auth = SimpleNamespace(db=db, now=now, audit=audit, require_recent=require_recent)
    session = MagicMock()
    service = AccountDetailService(auth=auth, session=session, listing=MagicMock())

    service.permanent_delete(trashed.id, 2)
    require_recent.assert_called_once_with(session, require_mfa=True)

    assert dependent.recovery_account_id is None
    assert dependent.recovery_email_external == "old.recovery@gmail.com"
    assert dependent.row_version == 5
    assert dependent.updated_at == now
    db.expunge.assert_called_once_with(trashed)

    audit_calls = [
        (call.args[0], call.kwargs.get("account_id"), call.kwargs.get("operation"))
        for call in audit.call_args_list
    ]
    assert audit_calls == [
        ("account_updated", dependent.id, "recovery-unlinked"),
        ("account_permanently_deleted", trashed.id, "permanent-delete"),
    ]


def test_batch_permanent_delete_attaches_item_details_on_failure():
    now = datetime(2026, 11, 27, 12, 0, tzinfo=UTC)
    trashed = _make_account(deleted=True, version=2, email="a@gmail.com")
    active = _make_account(deleted=False, version=1, email="b@gmail.com")
    ordered = sorted([trashed, active], key=lambda item: item.id)

    db = MagicMock()
    by_id = {trashed.id: trashed, active.id: active}
    db.get.side_effect = lambda _model, aid: by_id[aid]
    db.scalars.return_value.all.return_value = []
    db.execute.return_value = SimpleNamespace(rowcount=1)

    require_recent = MagicMock()
    auth = SimpleNamespace(db=db, now=now, audit=MagicMock(), require_recent=require_recent)
    session = MagicMock()
    service = AccountDetailService(auth=auth, session=session, listing=MagicMock())

    with pytest.raises(AccountError) as exc_info:
        service.batch_permanent_delete(
            BatchInput(
                accounts=[
                    BatchItem(id=ordered[0].id, row_version=ordered[0].row_version),
                    BatchItem(id=ordered[1].id, row_version=ordered[1].row_version),
                ]
            )
        )
    require_recent.assert_called_once_with(session, require_mfa=True)
    assert exc_info.value.code == "ACCOUNT_NOT_DELETED"
    assert exc_info.value.details["account_id"] == str(active.id)
