"""拆分后的后端服务模块单元测试（不依赖外部 PostgreSQL）。"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import Response

from app.services.accounts import (
    ACCOUNT_WRITE_LOCK,
    AccountDetailService,
    AccountError,
    AccountQueryService,
    AccountService,
    TagService,
)
from app.services.auth import (
    AUDIT_EVENTS,
    AUDIT_OPERATIONS,
    AUTH_LOCK,
    AuthContext,
    AuthService,
    AuthStateMachine,
    SecurityError,
    SessionManager,
    TotpManager,
)
from app.services.csv_transfer import (
    EXPORT_FIELDS,
    FIELDS,
    CsvImportAnalyzer,
    CsvService,
    export_csv,
    parse_csv,
    spreadsheet_safe,
)


def make_request(*, method="POST", headers=None, cookies=None, query_params=None, host="127.0.0.1"):
    return SimpleNamespace(
        method=method,
        headers=headers or {},
        cookies=cookies or {},
        query_params=query_params or {},
        client=SimpleNamespace(host=host),
    )


def make_settings(**overrides):
    defaults = {
        "session_cookie_secure": True,
        "app_base_url": "https://vault.example.test",
        "session_idle_minutes": 15,
        "session_absolute_hours": 12,
        "reauth_window_minutes": 5,
        "totp_required": True,
        "default_page_size": 30,
        "max_page_size": 100,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_split_packages_export_expected_symbols_and_distinct_locks():
    assert AUTH_LOCK != ACCOUNT_WRITE_LOCK
    assert AuthService and AuthContext and SessionManager and TotpManager and AuthStateMachine
    assert AccountService and AccountQueryService and AccountDetailService and TagService
    assert CsvService and CsvImportAnalyzer and export_csv
    assert "gmail_email" in FIELDS and "gmail_email" in EXPORT_FIELDS
    assert "password" not in EXPORT_FIELDS


def test_auth_service_clock_monkeypatch_propagates_to_context(monkeypatch):
    fixed = datetime(2026, 11, 25, 10, 0, tzinfo=UTC)

    class FixedClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed

    monkeypatch.setattr("app.services.auth.datetime", FixedClock)
    service = AuthService(
        db=SimpleNamespace(),
        settings=make_settings(),
        encryption=SimpleNamespace(),
        request=make_request(method="GET"),
        response=Response(),
    )
    assert service.now == fixed
    assert service.ctx.now == fixed


@pytest.mark.parametrize(
    "headers",
    [
        {"sec-fetch-site": "cross-site"},
        {"sec-fetch-site": "same-site"},
        {"origin": "https://evil.example.test"},
    ],
)
def test_session_manager_rejects_untrusted_origin_or_fetch_metadata(headers):
    ctx = AuthContext(
        db=SimpleNamespace(),
        settings=make_settings(),
        encryption=SimpleNamespace(),
        request=make_request(headers=headers),
        response=Response(),
        now=datetime.now(UTC),
    )
    with pytest.raises(SecurityError) as exc_info:
        SessionManager(ctx).check_origin()
    assert exc_info.value.status == 403
    assert exc_info.value.code == "CSRF_INVALID"


def test_auth_context_audit_rejects_unknown_event_or_operation():
    added = []
    ctx = AuthContext(
        db=SimpleNamespace(add=added.append),
        settings=make_settings(),
        encryption=SimpleNamespace(),
        request=make_request(),
        response=Response(),
        now=datetime.now(UTC),
    )
    with pytest.raises(ValueError):
        ctx.audit("unregistered_event")
    with pytest.raises(ValueError):
        ctx.audit(next(iter(AUDIT_EVENTS)), operation="unregistered_operation")
    ctx.audit("login_success", operation=next(iter(AUDIT_OPERATIONS)))
    assert len(added) == 1


def test_session_manager_defers_activity_persist_and_clears_pending():
    now = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)
    executed = []
    session_row = SimpleNamespace(
        id=uuid4(),
        auth_level="authenticated",
        last_seen_at=now - timedelta(minutes=5),
        expires_at=now + timedelta(hours=10),
        reauthenticated_at=None,
        pending_totp_ciphertext=b"cipher",
        pending_totp_nonce=b"nonce",
        pending_totp_key_version=1,
        pending_totp_expires_at=now + timedelta(minutes=10),
    )
    ctx = AuthContext(
        db=SimpleNamespace(execute=executed.append, scalar=lambda *_: None),
        settings=make_settings(),
        encryption=SimpleNamespace(),
        request=make_request(method="POST"),
        response=Response(),
        now=now,
    )
    manager = SessionManager(ctx)
    ctx.touched_session_id = session_row.id
    manager.persist_activity()
    assert len(executed) == 1
    assert ctx.touched_session_id is None
    manager.clear_pending(session_row)
    assert session_row.pending_totp_ciphertext is None
    assert session_row.pending_totp_nonce is None
    assert session_row.pending_totp_key_version is None
    assert session_row.pending_totp_expires_at is None


def test_account_query_service_enforces_page_size_limit():
    auth = SimpleNamespace(
        db=SimpleNamespace(),
        settings=make_settings(default_page_size=25, max_page_size=50),
        request=make_request(method="GET", query_params={"page_size": "51"}),
    )
    service = AccountQueryService(auth, repo=SimpleNamespace())
    with pytest.raises(AccountError) as exc_info:
        service.page_size(51)
    assert exc_info.value.code == "PAGE_SIZE_INVALID"

    default_auth = SimpleNamespace(
        db=SimpleNamespace(),
        settings=make_settings(default_page_size=25, max_page_size=50),
        request=make_request(method="GET", query_params={}),
    )
    assert AccountQueryService(default_auth, repo=SimpleNamespace()).page_size(30) == 25


def test_csv_parser_and_spreadsheet_formula_neutralization():
    headers, rows = parse_csv("\ufeffgmail_email,purpose\nalice@gmail.com,work\n".encode())
    assert headers == ["gmail_email", "purpose"]
    assert rows == [["alice@gmail.com", "work"]]

    with pytest.raises(AccountError) as too_wide:
        wide_header = ",".join(f"c{i}" for i in range(257))
        parse_csv(f"{wide_header}\n{','.join(['x'] * 257)}\n".encode())
    assert too_wide.value.code == "CSV_COLUMNS_EXCEEDED"

    with pytest.raises(AccountError) as too_many:
        body = "gmail_email\n" + ("a@gmail.com\n" * 10001)
        parse_csv(body.encode())
    assert too_many.value.code == "CSV_ROWS_EXCEEDED"

    for payload in ("=1+1", " =HYPERLINK()", "+cmd", "-2+3", "@SUM(A1)", "\t=1", "\rabc", "\nabc"):
        assert spreadsheet_safe(payload) == "'" + payload
    assert spreadsheet_safe("normal-value") == "normal-value"
    assert spreadsheet_safe(None) == ""


def test_csv_analyzer_mapping_and_tag_validation():
    analyzer = CsvImportAnalyzer(SimpleNamespace(db=SimpleNamespace()))
    columns, mapping = analyzer._resolve_mapping(["gmail_email", "custom", "purpose"], None)
    assert [c.suggested_field for c in columns] == ["gmail_email", None, "purpose"]
    assert mapping == {"gmail_email": 0, "purpose": 2}

    with pytest.raises(AccountError) as invalid_map:
        analyzer._resolve_mapping(["gmail_email"], {"gmail_email": 5})
    assert invalid_map.value.code == "CSV_MAPPING_INVALID"

    errors = []
    assert analyzer._parse_tags(2, "work | team | work", errors) == ["work", "team"]
    assert errors == []

    too_many_errors = []
    analyzer._parse_tags(3, "|".join(f"t{i}" for i in range(101)), too_many_errors)
    assert len(too_many_errors) == 1
    assert too_many_errors[0].field == "tags"
