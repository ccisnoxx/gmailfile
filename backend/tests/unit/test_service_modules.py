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
        "step_up_totp_required": False,
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


def test_account_query_statuses_parsing_and_validation():
    from pydantic import ValidationError

    from app.schemas.accounts import AccountQuery, DashboardSummary

    parsed_csv = AccountQuery(statuses="restricted,login_failed")
    assert parsed_csv.statuses == ["restricted", "login_failed"]

    parsed_list = AccountQuery(statuses=["restricted", "login_failed", "restricted"])
    assert parsed_list.statuses == ["restricted", "login_failed"]

    assert AccountQuery(statuses=" , ").statuses is None

    with pytest.raises(ValidationError):
        AccountQuery(statuses="restricted,not_a_status")

    summary = DashboardSummary(
        total=10,
        normal=4,
        pending_verification=1,
        abnormal=4,
        risk=3,
        disabled=1,
        archived=1,
        deleted_count=2,
        tag_counts={"tag-1": 3},
        added_this_month=2,
        unverified_over_30_days=1,
        timezone="UTC",
        month_from="2026-11-01T00:00:00Z",
        month_to="2026-12-01T00:00:00Z",
    )
    assert summary.risk == 3
    assert summary.disabled == 1
    assert summary.archived == 1
    assert summary.tag_counts == {"tag-1": 3}


def test_account_detail_unarchive_action_rules():
    assert "account_unarchived" in AUDIT_EVENTS
    assert "unarchive" in AUDIT_OPERATIONS

    account_id = uuid4()
    now = datetime(2026, 11, 26, 12, 0, tzinfo=UTC)
    cas_calls = []
    audit_calls = []

    def make_service(row):
        auth = SimpleNamespace(db=SimpleNamespace(), now=now)
        svc = AccountDetailService(auth, SimpleNamespace(), SimpleNamespace())
        svc.record = lambda _id: row
        svc.cas = lambda r, v, vals: cas_calls.append((r.id, v, vals))
        svc.audit = lambda ev, aid, operation=None: audit_calls.append((ev, aid, operation))
        svc.detail = lambda aid: SimpleNamespace(id=aid, status="normal", archived_at=None)
        return svc

    # 1. 已归档账号 -> 成功取消归档并写入 account_unarchived / unarchive 审计
    archived_row = SimpleNamespace(id=account_id, status="archived", deleted_at=None, row_version=3)
    res = make_service(archived_row).action(account_id, 3, "unarchive")
    assert res.status == "normal"
    assert cas_calls == [(account_id, 3, {"status": "normal", "archived_at": None})]
    assert audit_calls == [("account_unarchived", account_id, "unarchive")]

    # 2. 非归档账号 -> 409 ACCOUNT_NOT_ARCHIVED
    normal_row = SimpleNamespace(id=account_id, status="normal", deleted_at=None, row_version=1)
    with pytest.raises(AccountError) as not_archived:
        make_service(normal_row).action(account_id, 1, "unarchive")
    assert not_archived.value.status == 409
    assert not_archived.value.code == "ACCOUNT_NOT_ARCHIVED"

    # 3. 已软删除账号 -> 409 ACCOUNT_DELETED
    deleted_row = SimpleNamespace(id=account_id, status="archived", deleted_at=now, row_version=2)
    with pytest.raises(AccountError) as deleted_err:
        make_service(deleted_row).action(account_id, 2, "unarchive")
    assert deleted_err.value.status == 409
    assert deleted_err.value.code == "ACCOUNT_DELETED"


def test_csv_skip_empty_fields_preserves_existing_values_on_update():
    from app.schemas.operations import CsvOptions

    assert CsvOptions().skip_empty_fields is False
    opts_skip = CsvOptions(strategy="update", skip_empty_fields=True)
    opts_overwrite = CsvOptions(strategy="update", skip_empty_fields=False)

    existing = SimpleNamespace(
        id=uuid4(),
        gmail_email="alice@gmail.com",
        gmail_email_normalized="alice@gmail.com",
        recovery_account_id=None,
        recovery_email_external="existing.recovery@example.test",
        row_version=4,
        deleted_at=None,
    )
    stub_accounts = SimpleNamespace(
        db=SimpleNamespace(scalars=lambda *a, **k: [existing]),
        recovery=lambda *a, **k: None,
    )
    analyzer = CsvImportAnalyzer(stub_accounts)
    csv_content = (
        "gmail_email,password,recovery_email,phone,purpose,notes,status,two_factor_status,tags\n"
        "alice@gmail.com,,,,新用途,,,,\n"
    ).encode()
    now = datetime(2026, 11, 26, 12, 0, tzinfo=UTC)

    # skip_empty_fields=True: 空白列全部跳过，仅更新非空 purpose，且 tags 保持 None（不清空原标签）
    _, _, rows_skip, errors_skip, plans_skip, _ = analyzer.analyze(
        csv_content, opts_skip, default_time=now
    )
    assert errors_skip == []
    assert [r.action for r in rows_skip] == ["update"]
    _, _, patch_model, tag_names = plans_skip[0]
    assert patch_model.model_fields_set == {"row_version", "gmail_email", "purpose"}
    assert patch_model.purpose == "新用途"
    assert tag_names is None

    # skip_empty_fields=False: 空白必填字段（status/two_factor_status）应报错阻止清空，
    # 而已放宽为可选的 recovery_email 留空时允许清空（不再触发必填报错）
    _, _, rows_ow, errors_ow, plans_ow, _ = analyzer.analyze(
        csv_content, opts_overwrite, default_time=now
    )
    assert [r.action for r in rows_ow] == ["error"]
    assert plans_ow == []
    error_fields = {e.field for e in errors_ow}
    assert {"status", "two_factor_status"} <= error_fields
    assert "recovery_email" not in error_fields

    # 仅留空 recovery_email 且 skip_empty_fields=False 时，允许清空辅助邮箱；新建也可不填辅助邮箱
    clear_csv = (
        b"gmail_email,password,recovery_email\n"
        b"alice@gmail.com,,\n"
        b"brandnew@gmail.com,StrongPass#2026,\n"
    )
    _, _, rows_clear, errors_clear, plans_clear, _ = analyzer.analyze(
        clear_csv, opts_overwrite, default_time=now
    )
    assert errors_clear == []
    assert [r.action for r in rows_clear] == ["update", "create"]
    assert plans_clear[0][2].recovery_email_external is None
    assert plans_clear[0][2].recovery_account_id is None
    assert plans_clear[1][2].recovery_email_external is None
    assert plans_clear[1][2].recovery_account_id is None
