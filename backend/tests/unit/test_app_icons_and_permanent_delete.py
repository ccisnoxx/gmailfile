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

PNG_SAMPLE = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
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
    oversized = "data:image/png;base64," + base64.b64encode(
        b"\x89PNG\r\n\x1a\n" + b"\x00" * 70000
    ).decode("ascii")
    with pytest.raises(AccountError) as exc_big:
        app_icon.validate_icon_data(oversized)
    assert exc_big.value.code == "APP_ICON_INVALID"


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

    def fake_fetch(url: str, *, max_bytes: int):
        return responses.get(url)

    monkeypatch.setattr(app_icon, "_fetch_https_bytes", fake_fetch)

    domain, data_uri = app_icon.fetch_domain_icon("https://Perplexity.ai/home")
    assert domain == "perplexity.ai"
    assert data_uri == PNG_DATA_URI


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


def test_permanent_delete_rejects_active_account_and_version_conflict():
    now = datetime(2026, 11, 27, 12, 0, tzinfo=UTC)
    active = _make_account(deleted=False, version=1)
    trashed = _make_account(deleted=True, version=3)

    db = MagicMock()
    db.get.side_effect = [active, trashed]
    auth = SimpleNamespace(db=db, now=now, audit=MagicMock())
    service = AccountDetailService(auth=auth, session=MagicMock(), listing=MagicMock())

    with pytest.raises(AccountError) as exc_active:
        service.permanent_delete(active.id, 1)
    assert exc_active.value.status == 409
    assert exc_active.value.code == "ACCOUNT_NOT_DELETED"

    with pytest.raises(AccountError) as exc_conflict:
        service.permanent_delete(trashed.id, 2)
    assert exc_conflict.value.status == 409
    assert exc_conflict.value.code == "ROW_VERSION_CONFLICT"


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
    auth = SimpleNamespace(db=db, now=now, audit=audit)
    session = MagicMock()
    service = AccountDetailService(auth=auth, session=session, listing=MagicMock())

    service.permanent_delete(trashed.id, 2)

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

    auth = SimpleNamespace(db=db, now=now, audit=MagicMock())
    service = AccountDetailService(auth=auth, session=MagicMock(), listing=MagicMock())

    with pytest.raises(AccountError) as exc_info:
        service.batch_permanent_delete(
            BatchInput(
                accounts=[
                    BatchItem(id=ordered[0].id, row_version=ordered[0].row_version),
                    BatchItem(id=ordered[1].id, row_version=ordered[1].row_version),
                ]
            )
        )
    assert exc_info.value.code == "ACCOUNT_NOT_DELETED"
    assert exc_info.value.details["account_id"] == str(active.id)
