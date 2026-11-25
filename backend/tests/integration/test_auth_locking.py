from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import event, func, select, text
from sqlalchemy.orm import Session
from test_accounts import create, request
from test_accounts import signed as signed
from test_auth import advance, post
from test_operations import commit, preview, reverify, simple

from app.api.dependencies import ACCOUNT_WRITE_LOCK
from app.models import AuditEvent, CsvReceipt, UserSession
from app.services.auth import AUTH_LOCK
from app.services.csv_transfer import CsvService

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("lock_key", [AUTH_LOCK, ACCOUNT_WRITE_LOCK])
def test_queries_preview_and_export_do_not_wait_for_global_locks(env, signed, lock_key):
    reverify(env, signed)
    client, state = signed
    created = create(signed)

    def business_requests():
        for path in (
            "/accounts",
            "/dashboard/summary",
            "/tags",
            "/auth/sessions",
            "/audit-events",
            "/settings",
            "/system/version",
            "/system/backup-status",
        ):
            response = client.get("/api/v1" + path)
            assert response.status_code == 200, path
        assert post(client, "activity", state).status_code == 200
        assert client.get("/api/v1/accounts/" + created["id"]).status_code == 200
        exported = client.post(
            "/api/v1/exports/csv",
            json={"scope": "all"},
            headers={"X-CSRF-Token": state["csrf_token"]},
        )
        assert exported.status_code == 200
        content = simple()
        result = preview(signed, content)
        assert result.status_code == 200
        if lock_key == AUTH_LOCK:
            # 业务写入也不应等待认证锁。
            create(signed)
            assert commit(signed, content, result.json()["receipt_id"]).status_code == 200

    # 另一连接持有全局锁时，普通请求仍须完成；超时后先释放锁再回收线程。
    with ThreadPoolExecutor(max_workers=1) as pool:
        with env["engine"].begin() as connection:
            connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
            pool.submit(business_requests).result(timeout=10)


def test_auth_state_routes_lock_before_reading_state(env, signed):
    client, _ = signed
    statements = []

    def record(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    # 无效 CSRF 也须先取锁，避免任何入口在锁外读取后再带着旧状态等待锁。
    routes = [
        ("GET", "/auth/session", None),
        ("POST", "/auth/login", {"password": env["password"]}),
        ("POST", "/auth/logout", {}),
        ("POST", "/auth/reverify", {"password": env["password"]}),
        ("POST", "/auth/totp/setup", {}),
        ("POST", "/auth/totp/confirm", {"code": "000000"}),
        ("POST", "/auth/totp/regenerate-recovery-codes", {"password": env["password"]}),
        (
            "POST",
            "/auth/password",
            {"password": env["password"], "new_password": env["password"]},
        ),
        ("DELETE", "/auth/sessions/others", None),
        ("DELETE", "/auth/sessions/00000000-0000-0000-0000-000000000000", None),
        ("PATCH", "/settings/idle", {"idle_minutes": 30}),
    ]
    event.listen(env["engine"], "before_cursor_execute", record)
    try:
        for method, path, body in routes:
            statements.clear()
            response = client.request(method, "/api/v1" + path, json=body)
            assert response.status_code in {200, 403}, path
            assert "pg_advisory_xact_lock" in statements[0], path
            assert sum("pg_advisory_xact_lock" in item for item in statements) == 1, path
    finally:
        event.remove(env["engine"], "before_cursor_execute", record)


def test_slow_preview_allows_queries_auth_and_monotonic_activity(env, signed, monkeypatch):
    reverify(env, signed)
    advance(env, 10)
    analyzing, release = Event(), Event()
    original = CsvService.analyze

    def paused_analyze(self, *args, **kwargs):
        result = original(self, *args, **kwargs)
        analyzing.set()
        assert release.wait(timeout=10), "CSV 预览测试未释放"
        return result

    monkeypatch.setattr(CsvService, "analyze", paused_analyze)
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(preview, signed, simple())
        try:
            assert analyzing.wait(timeout=10)
            with env["engine"].begin() as connection:
                assert connection.scalar(
                    text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": AUTH_LOCK}
                )
            response = pool.submit(signed[0].get, "/api/v1/dashboard/summary").result(timeout=5)
            assert response.status_code == 200
            advance(env, 10)
            newer_activity = env["clock"][0]
            renewed = pool.submit(
                post, signed[0], "reverify", signed[1], {"password": env["password"]}
            ).result(timeout=5)
            assert renewed.status_code == 200
            assert not pending.done()
        finally:
            release.set()
        assert pending.result(timeout=10).status_code == 200
    with Session(env["engine"]) as db:
        row = db.scalar(select(UserSession))
        assert row.last_seen_at == newer_activity
        assert row.revoked_at is None


def test_concurrent_skip_only_csv_commit_consumes_receipt_once(env, signed, monkeypatch):
    reverify(env, signed)
    row = create(signed)
    content = simple(row["gmail_email"])
    result = preview(signed, content).json()
    assert [item["action"] for item in result["rows"]] == ["skip"]
    analyzing, release = Event(), Event()
    original = CsvService.analyze

    def paused_first_analyze(self, *args, **kwargs):
        result = original(self, *args, **kwargs)
        if not analyzing.is_set():
            analyzing.set()
            assert release.wait(timeout=10), "CSV 提交测试未释放"
        return result

    monkeypatch.setattr(CsvService, "analyze", paused_first_analyze)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(commit, signed, content, result["receipt_id"])
        try:
            assert analyzing.wait(timeout=10)
            second = pool.submit(commit, signed, content, result["receipt_id"])
            # 第一笔尚未消费凭据；第二笔必须等待，而非凭借旧快照重复成功。
            with pytest.raises(TimeoutError):
                second.result(timeout=1)
        finally:
            release.set()
        responses = [first.result(timeout=10), second.result(timeout=10)]
    assert sorted(response.status_code for response in responses) == [200, 409]
    with Session(env["engine"]) as db:
        assert db.get(CsvReceipt, result["receipt_id"]).consumed_at is not None
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditEvent)
                .where(AuditEvent.event_type == "csv_imported")
            )
            == 1
        )


def test_tag_deletion_after_concurrent_assignment_increments_account_version(
    env, signed, monkeypatch
):
    from app.services.accounts.detail import AccountDetailService

    client, state = signed
    headers = {"X-CSRF-Token": state["csrf_token"]}
    tag = client.post("/api/v1/tags", json={"name": "concurrent"}, headers=headers).json()
    row = create(signed)
    assigned, release = Event(), Event()
    original = AccountDetailService.set_tags

    def paused_set_tags(self, *args, **kwargs):
        original(self, *args, **kwargs)
        assigned.set()
        assert release.wait(timeout=10), "标签关联测试未释放"

    monkeypatch.setattr(AccountDetailService, "set_tags", paused_set_tags)
    with ThreadPoolExecutor(max_workers=2) as pool:
        assigning = pool.submit(
            request,
            signed,
            "PATCH",
            "/" + row["id"],
            {"row_version": row["row_version"], "tag_ids": [tag["id"]]},
        )
        try:
            assert assigned.wait(timeout=10)
            deleting = pool.submit(client.delete, "/api/v1/tags/" + tag["id"], headers=headers)
            with pytest.raises(TimeoutError):
                deleting.result(timeout=1)
        finally:
            release.set()
        assert assigning.result(timeout=10).status_code == 200
        assert deleting.result(timeout=10).status_code == 200
    current = client.get("/api/v1/accounts/" + row["id"]).json()
    assert current["tags"] == []
    assert current["row_version"] == row["row_version"] + 2
    assert (
        request(
            signed,
            "PATCH",
            "/" + row["id"],
            {"row_version": row["row_version"] + 1, "purpose": "stale"},
        ).status_code
        == 409
    )


def test_expired_receipt_cleanup_waits_for_inflight_commit(env, signed, monkeypatch):
    reverify(env, signed)
    content = simple()
    receipt = preview(signed, content).json()["receipt_id"]
    analyzing, release = Event(), Event()
    original = CsvService.analyze

    def paused_first_analyze(self, *args, **kwargs):
        result = original(self, *args, **kwargs)
        if not analyzing.is_set():
            analyzing.set()
            assert release.wait(timeout=10), "在途 CSV 提交测试未释放"
        return result

    monkeypatch.setattr(CsvService, "analyze", paused_first_analyze)
    with ThreadPoolExecutor(max_workers=2) as pool:
        committing = pool.submit(commit, signed, content, receipt)
        try:
            assert analyzing.wait(timeout=10)
            advance(env, 601)
            reverify(env, signed)
            cleaning = pool.submit(preview, signed, simple("other@example.test"))
            with pytest.raises(TimeoutError):
                cleaning.result(timeout=1)
        finally:
            release.set()
        assert committing.result(timeout=10).status_code == 200
        assert cleaning.result(timeout=10).status_code == 200
    rows = signed[0].get("/api/v1/accounts").json()["items"]
    assert len(rows) == 1 and rows[0]["gmail_email"] == "csv@example.test"
