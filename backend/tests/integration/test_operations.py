import csv
import io
import json
from datetime import timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from test_accounts import create, request
from test_accounts import signed as signed
from test_auth import advance, login, post

from app.models import AuditEvent, CsvReceipt, GmailAccount, Tag, UserSession

pytestmark = pytest.mark.integration


def reverify(env, signed):
    client, state = signed
    result = post(client, "reverify", state, {"password": env["password"]})
    assert result.status_code == 200
    state.update(result.json())


def preview(signed, content, **options):
    client, state = signed
    return client.post(
        "/api/v1/imports/csv/preview",
        content=content,
        params={"options": json.dumps(options)},
        headers={"X-CSRF-Token": state["csrf_token"], "Content-Type": "text/csv"},
    )


def commit(signed, content, receipt):
    client, state = signed
    return client.post(
        "/api/v1/imports/csv/commit",
        content=content,
        params={"receipt_id": receipt},
        headers={"X-CSRF-Token": state["csrf_token"], "Content-Type": "text/csv"},
    )


def csv_bytes(rows):
    out = io.StringIO(newline="")
    csv.writer(out).writerows(rows)
    return ("\ufeff" + out.getvalue()).encode()


def simple(email="csv@example.test", **fields):
    values = dict(
        gmail_email=email,
        password="synthetic-import-value",
        recovery_email="other@example.test",
        **fields,
    )
    return csv_bytes([values.keys(), values.values()])


def test_preview_commit_binding_and_no_sensitive_values(env, signed):
    reverify(env, signed)
    data = simple(notes="private-notes", phone="+12025550123", purpose="中文,\n换行", tags="甲|乙")
    result = preview(signed, data)
    assert result.status_code == 200, result.text
    result = result.json()
    assert result["receipt_id"] and not result["errors"]
    assert all(
        secret not in str(result)
        for secret in ["synthetic-import-value", "private-notes", "+12025550123"]
    )
    with Session(env["engine"]) as db:
        receipt = db.scalar(select(CsvReceipt))
        assert all(
            secret not in str(receipt.options) + str(receipt.snapshot)
            for secret in ["private-notes", "+12025550123"]
        )
    bad = commit(signed, simple("other@example.test"), result["receipt_id"])
    assert bad.status_code == 409
    assert commit(signed, data, result["receipt_id"]).json()["created"] == 1
    assert commit(signed, data, result["receipt_id"]).status_code == 409
    row = signed[0].get("/api/v1/accounts").json()["items"][0]
    assert row["purpose"] == "中文,\n换行" and len(row["tags"]) == 2
    with Session(env["engine"]) as db:
        assert db.get(GmailAccount, row["id"]).password_ciphertext
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditEvent)
                .where(AuditEvent.event_type == "csv_imported")
            )
            == 1
        )


@pytest.mark.parametrize(
    "strategy,actions,valid",
    [
        ("skip", ["create", "skip"], True),
        ("update", ["create", "skip"], True),
        ("error", ["create", "error"], False),
    ],
)
def test_file_normalized_duplicates(env, signed, strategy, actions, valid):
    reverify(env, signed)
    data = csv_bytes(
        [
            ["gmail_email", "password", "recovery_email"],
            ["User.Name@gmail.com", "synthetic", "other@example.test"],
            ["username+tag@googlemail.com", "synthetic2", "other@example.test"],
        ]
    )
    result = preview(signed, data, strategy=strategy).json()
    assert [r["action"] for r in result["rows"]] == actions
    assert bool(result["receipt_id"]) == valid
    if valid:
        assert commit(signed, data, result["receipt_id"]).json()["created"] == 1


def test_update_uses_version_keeps_unmapped_and_empty_password(env, signed):
    row = create(signed, gmail_email="u.pdate@gmail.com", notes="keep-notes", purpose="old")
    reverify(env, signed)
    data = csv_bytes(
        [["gmail_email", "password", "purpose"], ["update+tag@googlemail.com", "", "changed"]]
    )
    p = preview(signed, data, strategy="update").json()
    assert p["receipt_id"], p
    request(signed, "PATCH", "/" + row["id"], {"row_version": 1, "purpose": "concurrent"})
    assert commit(signed, data, p["receipt_id"]).status_code == 409
    p = preview(signed, data, strategy="update").json()
    with Session(env["engine"]) as db:
        cipher = db.get(GmailAccount, row["id"]).password_ciphertext
    assert commit(signed, data, p["receipt_id"]).json()["updated"] == 1
    detail = signed[0].get("/api/v1/accounts/" + row["id"]).json()
    assert (
        detail["notes"] == "keep-notes"
        and detail["purpose"] == "changed"
        and detail["row_version"] == 3
    )
    with Session(env["engine"]) as db:
        assert db.get(GmailAccount, row["id"]).password_ciphertext == cipher


def test_mapping_validation_sensitive_errors_and_deleted(env, signed):
    row = create(signed, gmail_email="deleted@example.test")
    request(signed, "DELETE", "/" + row["id"], {"row_version": 1})
    reverify(env, signed)
    for strategy, action in [("skip", "skip"), ("update", "error"), ("error", "error")]:
        result = preview(signed, simple("deleted@example.test"), strategy=strategy).json()
        assert result["rows"][0]["action"] == action
    data = csv_bytes(
        [
            ["自定义1", "自定义2", "自定义3"],
            ["new@example.test", "synthetic", "recover@example.test"],
        ]
    )
    assert preview(signed, data).json()["columns"]
    assert preview(
        signed, data, mapping={"gmail_email": 0, "password": 1, "recovery_email": 2}
    ).json()["receipt_id"]
    bad = preview(
        signed,
        simple(
            "bad@example.test", phone="do-not-echo-sensitive", registered_at="private-invalid-date"
        ),
    ).json()
    assert not bad["receipt_id"] and len(bad["errors"]) == 2
    assert all(set(e) == {"row", "field", "reason"} for e in bad["errors"])
    assert "do-not-echo-sensitive" not in str(bad) and "private-invalid-date" not in str(bad)


def test_reference_binding_and_atomic_rollback(env, signed, monkeypatch):
    target = create(signed, gmail_email="recoverytarget@example.test")
    reverify(env, signed)
    data = csv_bytes(
        [
            ["gmail_email", "password", "recovery_account", "tags"],
            ["new1@example.test", "synthetic", target["account_no"], "created-tag"],
            ["new2@example.test", "synthetic", target["account_no"], "second-tag"],
        ]
    )
    p = preview(signed, data).json()
    assert p["receipt_id"], p
    request(signed, "PATCH", "/" + target["id"], {"row_version": 1, "purpose": "changed"})
    assert commit(signed, data, p["receipt_id"]).status_code == 409
    p = preview(signed, data).json()
    from app.services.accounts import AccountError, AccountService

    original = AccountService.create

    def fail_second(self, body):
        if body.gmail_email == "new2@example.test":
            raise AccountError(409, "CONFLICT", "safe")
        return original(self, body)

    monkeypatch.setattr(AccountService, "create", fail_second)
    assert commit(signed, data, p["receipt_id"]).status_code == 409
    with Session(env["engine"]) as db:
        assert db.scalar(select(func.count()).select_from(GmailAccount)) == 1
        assert db.scalar(select(func.count()).select_from(Tag)) == 0
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditEvent)
                .where(AuditEvent.event_type == "csv_imported")
            )
            == 0
        )


@pytest.mark.parametrize("content", [b"\xff\xfea", b'a,b\n"broken', b"a,b\nx", b"a\x00\nb", b""])
def test_invalid_csv(env, signed, content):
    reverify(env, signed)
    assert preview(signed, content).status_code == 422


def test_entry_upload_limit_and_type(env, signed, tmp_path):
    reverify(env, signed)
    assert preview(signed, b"x" * (10 * 1024 * 1024 + 1)).status_code == 413
    client, state = signed
    assert (
        client.post(
            "/api/v1/imports/csv/preview",
            content=b"a,b",
            headers={"Content-Type": "application/pdf", "X-CSRF-Token": state["csrf_token"]},
        ).status_code
        == 415
    )
    # Raw body path never creates a multipart temporary file.
    import tempfile

    before = set(__import__("pathlib").Path(tempfile.gettempdir()).glob("tmp*"))
    preview(signed, simple())
    preview(signed, b"bad")
    assert set(__import__("pathlib").Path(tempfile.gettempdir()).glob("tmp*")) == before


def test_export_all_filtered_whitelist_formula_and_audit(env, signed):
    for i in range(32):
        create(
            signed,
            gmail_email=f"export{i}@example.test",
            purpose=' =HYPERLINK("evil")' if i == 0 else "普通",
        )
    client, state = signed
    headers = {"X-CSRF-Token": state["csrf_token"]}
    result = client.post("/api/v1/exports/csv", json={"scope": "all"}, headers=headers)
    assert result.status_code == 200
    rows = list(csv.DictReader(io.StringIO(result.content.decode("utf-8-sig"))))
    assert len(rows) == 32 and rows[-1]["purpose"].startswith("' =")
    assert not set(rows[0]) & {
        "password",
        "phone",
        "notes",
        "token_hash",
        "csrf_token",
        "totp_secret",
    }
    assert result.headers["content-disposition"].endswith('Z.csv"')
    filtered = client.post(
        "/api/v1/exports/csv",
        json={"scope": "filtered", "filters": {"purpose": "普通", "page": 2, "page_size": 1}},
        headers=headers,
    )
    assert len(list(csv.DictReader(io.StringIO(filtered.content.decode("utf-8-sig"))))) == 31
    with Session(env["engine"]) as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditEvent)
                .where(AuditEvent.event_type == "csv_exported")
            )
            == 2
        )


def test_sessions_status_revoke_self_others_no_renew(env, signed):
    reverify(env, signed)
    client, state = signed
    with Session(env["engine"]) as db, db.begin():
        current = db.scalar(select(UserSession).where(UserSession.auth_level == "authenticated"))
        now = env["clock"][0]
        common = dict(
            admin_user_id=current.admin_user_id,
            token_hash=b"a" * 32,
            csrf_token_hash=b"b" * 32,
            last_seen_at=now - timedelta(minutes=16),
            expires_at=now + timedelta(hours=1),
            created_at=now - timedelta(hours=1),
        )
        other = UserSession(**common)
        db.add(other)
        db.flush()
        other_id = str(other.id)
        current_id = str(current.id)
        last = current.last_seen_at
        absolute = current.expires_at
    data = client.get("/api/v1/auth/sessions", params={"page_size": 1}).json()
    assert data["total"] == 2 and len(data["items"]) == 1
    states = client.get("/api/v1/auth/sessions").json()["items"]
    assert {r["state"] for r in states} == {"valid", "idle_expired"}
    assert all(not set(r) & {"csrf_token", "token_hash", "csrf_token_hash"} for r in states)
    advance(env, 30)
    assert (
        client.delete(
            "/api/v1/auth/sessions/" + other_id, headers={"X-CSRF-Token": state["csrf_token"]}
        ).status_code
        == 200
    )
    with Session(env["engine"]) as db:
        assert db.get(UserSession, current_id).last_seen_at == last
        assert db.get(UserSession, current_id).expires_at == absolute
    assert (
        client.delete(
            "/api/v1/auth/sessions/others", headers={"X-CSRF-Token": state["csrf_token"]}
        ).status_code
        == 200
    )
    assert (
        client.delete(
            "/api/v1/auth/sessions/" + current_id, headers={"X-CSRF-Token": state["csrf_token"]}
        ).status_code
        == 200
    )
    assert client.get("/api/v1/auth/sessions").status_code == 401


def test_idle_setting_applies_to_all_without_renewing(env, signed):
    reverify(env, signed)
    advance(env, 61)
    client, state = signed
    assert (
        client.patch(
            "/api/v1/settings/idle",
            json={"idle_minutes": 1},
            headers={"X-CSRF-Token": state["csrf_token"]},
        ).status_code
        == 200
    )
    assert client.get("/api/v1/auth/session").json()["state"] == "anonymous"


def test_audit_paging_filter_and_status_redaction(env, signed, tmp_path):
    create(signed)
    client, _ = signed
    result = client.get("/api/v1/audit-events", params={"page_size": 1}).json()
    assert result["total"] > 1 and len(result["items"]) == 1
    assert set(result["items"][0]) == {
        "id",
        "seq",
        "event_hash",
        "event_type",
        "account_id",
        "session_id",
        "ip_address",
        "operation",
        "created_at",
    }
    assert len(result["items"][0]["event_hash"]) == 64
    integrity = client.get("/api/v1/audit-events/integrity")
    assert integrity.status_code == 200
    integrity_data = integrity.json()
    assert integrity_data["valid"] is True
    assert integrity_data["total_events"] == result["total"]
    assert integrity_data["latest_seq"] == result["items"][0]["seq"]
    assert integrity_data["latest_hash"] == result["items"][0]["event_hash"]
    assert integrity_data["retention_days"] == 365
    assert (
        client.get("/api/v1/audit-events", params={"event_type": "account_created"}).json()["total"]
        == 1
    )
    assert (
        client.get("/api/v1/audit-events", params={"event_type": "not-allowed"}).status_code == 422
    )
    assert client.get("/api/v1/system/version").json()["schema_version"] == "0004"
    assert client.get("/api/v1/system/backup-status").json()["state"] == "unconfigured"
    status = tmp_path / "status.json"
    env["settings"].backup_status_file = status
    assert client.get("/api/v1/system/backup-status").json()["state"] == "never_run"
    status.write_text(
        json.dumps(
            {
                "state": "success",
                "last_success_at": (env["clock"][0] - timedelta(hours=40)).isoformat(),
                "internal": "do-not-return",
            }
        )
    )
    assert client.get("/api/v1/system/backup-status").json()["state"] == "stale"
    assert "do-not-return" not in client.get("/api/v1/system/backup-status").text
    status.write_text("bad secret")
    assert client.get("/api/v1/system/backup-status").json()["state"] == "failed"


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("GET", "/auth/sessions", None),
        ("GET", "/audit-events", None),
        ("GET", "/audit-events/integrity", None),
        ("GET", "/system/version", None),
        ("GET", "/system/backup-status", None),
        ("GET", "/settings", None),
        ("PATCH", "/settings/idle", {"idle_minutes": 5}),
        ("DELETE", "/auth/sessions/others", None),
        ("POST", "/exports/csv", {"scope": "all"}),
    ],
)
def test_operations_permissions_csrf(env, method, path, body):
    client = env["client"]()
    assert client.request(method, "/api/v1" + path, json=body).status_code == 401
    state = login(env, client).json()
    assert (
        client.request(
            method, "/api/v1" + path, json=body, headers={"X-CSRF-Token": state["csrf_token"]}
        ).status_code
        == 403
    )


def test_increasing_idle_does_not_resurrect_old_cookie(env, signed):
    from app.core.security import random_token, token_hash

    reverify(env, signed)
    client, state = signed
    expired = env["client"]()
    secret, csrf = random_token(), random_token()
    with Session(env["engine"]) as db, db.begin():
        current = db.scalar(select(UserSession).where(UserSession.auth_level == "authenticated"))
        row = UserSession(
            admin_user_id=current.admin_user_id,
            auth_level="authenticated",
            token_hash=token_hash(secret),
            csrf_token_hash=token_hash(csrf),
            last_seen_at=env["clock"][0] - timedelta(minutes=20),
            expires_at=env["clock"][0] + timedelta(hours=2),
            created_at=env["clock"][0] - timedelta(hours=1),
        )
        db.add(row)
        db.flush()
        identifier = row.id
    expired.cookies.set("__Host-gm_session", f"{identifier}.{secret}")
    assert expired.get("/api/v1/accounts").status_code == 401
    assert (
        client.patch(
            "/api/v1/settings/idle",
            json={"idle_minutes": 120},
            headers={"X-CSRF-Token": state["csrf_token"]},
        ).status_code
        == 200
    )
    assert expired.get("/api/v1/accounts").status_code == 401
    with Session(env["engine"]) as db:
        assert db.get(UserSession, identifier).revoked_at is not None


@pytest.mark.parametrize(
    "change",
    [
        {"password": None},
        {"account_no": "GM-999999"},
        {"recovery_email": ""},
        {"registered_at": "2026-11-01T00:00:00"},
        {"status": "invalid"},
        {"tags": "x" * 51},
    ],
)
def test_csv_create_required_and_optional_rules(env, signed, change):
    reverify(env, signed)
    values = {
        "gmail_email": "invalidrow@example.test",
        "password": "synthetic",
        "recovery_email": "external@example.test",
        **change,
    }
    if values.get("password") is None:
        values.pop("password")
    data = csv_bytes([values.keys(), values.values()])
    result = preview(signed, data).json()
    assert result["errors"] and not result["receipt_id"]


def test_csv_receipt_expiry_and_full_auth_csrf(env, signed):
    reverify(env, signed)
    data = simple()
    p = preview(signed, data).json()
    advance(env, 601)
    reverify(env, signed)
    assert commit(signed, data, p["receipt_id"]).status_code == 409
    client, state = signed
    for path in ["preview", "commit?receipt_id=" + p["receipt_id"]]:
        for headers in [{}, {"X-CSRF-Token": "incorrect"}]:
            assert (
                client.post(
                    "/api/v1/imports/csv/" + path,
                    content=data,
                    headers={"Content-Type": "text/csv", **headers},
                ).status_code
                == 403
            )
        assert (
            env["client"]()
            .post("/api/v1/imports/csv/" + path, content=data, headers={"Content-Type": "text/csv"})
            .status_code
            == 401
        )


def test_session_absolute_and_revoked_status(env, signed):
    client, _ = signed
    with Session(env["engine"]) as db, db.begin():
        current = db.scalar(select(UserSession))
        for i, revoked in [(1, False), (2, True)]:
            db.add(
                UserSession(
                    admin_user_id=current.admin_user_id,
                    token_hash=bytes([i]) * 32,
                    csrf_token_hash=bytes([i + 2]) * 32,
                    last_seen_at=env["clock"][0] - timedelta(hours=2),
                    created_at=env["clock"][0] - timedelta(hours=3),
                    expires_at=env["clock"][0] - timedelta(hours=1),
                    revoked_at=env["clock"][0] if revoked else None,
                )
            )
    result = client.get("/api/v1/auth/sessions").json()
    assert {r["state"] for r in result["items"]} == {"valid", "absolute_expired", "revoked"}


@pytest.mark.parametrize(
    "data",
    [
        b"gmail_email\n" + b"a@example.test\n" * 10001,
        b",".join([b"header"] * 257) + b"\n" + b",".join([b"value"] * 257),
    ],
)
def test_csv_bounds_confirmation_memory_at_parser(env, signed, data):
    reverify(env, signed)
    result = preview(signed, data)
    assert result.status_code == 422
    assert result.json()["error"]["code"] in {"CSV_ROWS_EXCEEDED", "CSV_COLUMNS_EXCEEDED"}


def test_csv_preview_default_options_can_be_omitted(env, signed):
    reverify(env, signed)
    client, state = signed
    result = client.post(
        "/api/v1/imports/csv/preview",
        content=simple(),
        headers={"Content-Type": "text/csv", "X-CSRF-Token": state["csrf_token"]},
    )
    assert result.status_code == 200
    assert result.json()["strategy"] == "skip" and result.json()["receipt_id"]


def test_streaming_csv_export_batches_cursor_and_tags_without_ciphertexts(env, signed, monkeypatch):
    from sqlalchemy import event

    from app.schemas.accounts import AccountQuery
    from app.services.csv_transfer import stream_export_csv

    client, state = signed
    headers = {"X-CSRF-Token": state["csrf_token"]}
    t1 = client.post("/api/v1/tags", json={"name": "甲"}, headers=headers).json()["id"]
    t2 = client.post("/api/v1/tags", json={"name": "乙"}, headers=headers).json()["id"]
    base = create(signed, gmail_email="base-recovery@example.test", tag_ids=[t1])
    for i in range(14):
        create(
            signed,
            gmail_email=f"stream{i}@example.test",
            recovery_account_id=base["id"] if i % 3 == 0 else None,
            recovery_email_external=None if i % 3 == 0 else f"ext{i}@example.test",
            tag_ids=[t1, t2] if i % 2 == 0 else [t2],
        )

    executed_sql: list[str] = []

    def capture_sql(connection, cursor, statement, parameters, context, executemany):
        executed_sql.append(statement)

    event.listen(env["engine"], "before_cursor_execute", capture_sql)
    try:
        chunks = list(stream_export_csv(env["engine"], AccountQuery(), batch_size=4))
    finally:
        event.remove(env["engine"], "before_cursor_execute", capture_sql)

    # 表头 1 块 + 15 条记录按每批 4 条拆分为 4 批 = 5 个流式块。
    assert len(chunks) == 5
    rows = list(csv.DictReader(io.StringIO(b"".join(chunks).decode("utf-8-sig"))))
    assert len(rows) == 15
    assert any(r["tags"] == "乙|甲" or r["tags"] == "甲|乙" for r in rows)
    assert any(r["recovery_email"] == "base-recovery@example.test" for r in rows)
    # 导出查询绝不加载任何敏感密文字段。
    account_selects = [s for s in executed_sql if "FROM gmail_accounts" in s]
    assert account_selects
    assert all(
        col not in sql_text
        for sql_text in account_selects
        for col in ("password_ciphertext", "phone_ciphertext", "notes_ciphertext")
    )
    # 标签按批查询（4 批），而非全表一次拉取。
    tag_selects = [s for s in executed_sql if "FROM gmail_account_tags" in s]
    assert len(tag_selects) == 4


def test_audit_integrity_endpoint_detects_offline_tampering(env, signed):
    from sqlalchemy import text

    client, _ = signed
    assert client.get("/api/v1/audit-events/integrity").json()["valid"] is True
    # 模拟离线/特权绕过触发器直接篡改单条审计记录。
    with env["engine"].begin() as conn:
        conn.execute(
            text("ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_prevent_mutation")
        )
        try:
            conn.execute(text("UPDATE audit_events SET event_type='logout' WHERE seq=1"))
        finally:
            conn.execute(
                text("ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_prevent_mutation")
            )
    broken = client.get("/api/v1/audit-events/integrity").json()
    assert broken["valid"] is False and broken["broken_seq"] == 1
