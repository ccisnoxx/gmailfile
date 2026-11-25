"""阶段3：真实 PostgreSQL 查询、事务及活动期限。"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_accounts import create, request, version
from test_accounts import signed as signed
from test_auth import advance, login, post

from app.models import AuditEvent, UserSession

pytestmark = pytest.mark.integration
ROOT = "/api/v1/accounts"


def test_combined_search_filters_and_timezone_range(signed):
    client, state = signed
    tag = client.post(
        "/api/v1/tags", json={"name": "组合"}, headers={"X-CSRF-Token": state["csrf_token"]}
    ).json()
    first = create(
        signed,
        gmail_email="Find.Me@gmail.com",
        status="normal",
        purpose="工作",
        two_factor_status="enabled",
        tag_ids=[tag["id"]],
        registered_at="2026-10-31T16:00:00Z",
        recovery_email_external="Shared@example.test",
    )
    create(signed, status="normal", registered_at="2026-11-01T16:00:00Z")
    query = {
        "search": "SHARED",
        "status": "normal",
        "purpose": "工作",
        "tag": tag["id"],
        "two_factor_status": "enabled",
        "registered_from": "2026-11-01T00:00:00+08:00",
        "registered_to": "2026-11-02T00:00:00+08:00",
        "archived": "false",
    }
    data = client.get(ROOT, params=query).json()
    assert data["total"] == 1 and data["items"][0]["id"] == first["id"]
    for search in [first["account_no"], "find.me", "shared"]:
        assert client.get(ROOT, params={"search": search}).json()["total"] == 1
    assert client.get(ROOT, params={"search": "%"}).json()["total"] == 0
    assert client.get(ROOT, params={"search": "_"}).json()["total"] == 0
    assert client.get(ROOT, params={"purpose": "不匹配"}).json()["total"] == 0


@pytest.mark.parametrize(
    "params",
    [
        {"sort": "gmail_email"},
        {"sort": "account_no;drop table"},
        {"page": 0},
        {"page_size": 101},
        {"page_size": 0},
        {"status": "other"},
        {"registered_from": "2026-11-01"},
        {"registered_from": "2026-11-02T00:00:00Z", "registered_to": "2026-11-01T00:00:00Z"},
    ],
)
def test_query_boundary_rejected(signed, params):
    assert signed[0].get(ROOT, params=params).status_code == 422


def test_paging_sort_stability_nulls_and_archived_deleted(signed):
    rows = [create(signed, registered_at="2026-11-01T00:00:00Z") for _ in range(5)]
    client, _ = signed
    for sort in [
        "account_no",
        "registered_at",
        "last_verified_at",
        "last_login_at",
        "created_at",
        "updated_at",
    ]:
        for direction in ["", "-"]:
            ids = []
            for page in [1, 2, 3]:
                data = client.get(
                    ROOT, params={"sort": direction + sort, "page": page, "page_size": 2}
                ).json()
                assert data["total"] == 5
                ids.extend(r["id"] for r in data["items"])
            assert len(set(ids)) == 5
            assert ids[:2] == [
                r["id"]
                for r in client.get(ROOT, params={"sort": direction + sort, "page_size": 2}).json()[
                    "items"
                ]
            ]
    assert client.get(ROOT, params={"page": 999}).json()["items"] == []
    assert client.get(ROOT).json()["page_size"] == 30
    archived = request(signed, "POST", "/" + rows[0]["id"] + "/archive", version(rows[0])).json()
    assert client.get(ROOT).json()["total"] == 5
    assert client.get(ROOT, params={"archived": True}).json()["items"][0]["id"] == archived["id"]
    request(signed, "DELETE", "/" + archived["id"], version(archived))
    assert client.get(ROOT).json()["total"] == 4
    assert client.get(ROOT, params={"deleted": True}).json()["total"] == 1


def test_summary_global_month_overdue_boundaries(env, signed):
    now = env["clock"][0]
    local = now.astimezone(__import__("zoneinfo").ZoneInfo("Asia/Shanghai"))
    start = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
    end = (
        (
            local.replace(year=local.year + 1, month=1, day=1)
            if local.month == 12
            else local.replace(month=local.month + 1, day=1)
        )
        .replace(hour=0, minute=0, second=0, microsecond=0)
        .astimezone(UTC)
    )
    cases = [
        {
            "status": "normal",
            "registered_at": start.isoformat(),
            "last_verified_at": (now - timedelta(days=30)).isoformat(),
        },
        {
            "status": "pending_verification",
            "registered_at": (now - timedelta(days=30, microseconds=1)).isoformat(),
        },
        {
            "status": "restricted",
            "registered_at": (start - timedelta(microseconds=1)).isoformat(),
            "last_verified_at": (now - timedelta(days=31)).isoformat(),
        },
        {
            "status": "login_failed",
            "registered_at": end.isoformat(),
            "last_verified_at": now.isoformat(),
        },
        {
            "status": "disabled",
            "registered_at": now.isoformat(),
            "last_verified_at": now.isoformat(),
        },
        {"status": "archived", "registered_at": start.isoformat()},
    ]
    for values in cases:
        create(signed, **values)
    deleted = create(signed, status="normal")
    request(signed, "DELETE", "/" + deleted["id"], version(deleted))
    result = signed[0].get("/api/v1/dashboard/summary", params={"timezone": "Asia/Shanghai"}).json()
    assert {
        k: result[k]
        for k in [
            "total",
            "normal",
            "pending_verification",
            "abnormal",
            "added_this_month",
            "unverified_over_30_days",
        ]
    } == {
        "total": 6,
        "normal": 1,
        "pending_verification": 1,
        "abnormal": 3,
        "added_this_month": 3,
        "unverified_over_30_days": 2,
    }
    assert datetime.fromisoformat(result["month_from"].replace("Z", "+00:00")) == start
    assert (
        signed[0].get("/api/v1/dashboard/summary", params={"timezone": "invalid/zone"}).status_code
        == 422
    )


def test_recovery_groups_and_last_registration_not_update(signed):
    target = create(signed, gmail_email="Shared@gmail.com")
    linked = create(
        signed,
        recovery_account_id=target["id"],
        recovery_email_external=None,
        registered_at="2026-01-01T00:00:00Z",
        status="normal",
    )
    create(
        signed,
        recovery_email_external=" shared@GMAIL.com ",
        registered_at="2026-02-01T00:00:00Z",
        status="disabled",
    )
    create(
        signed,
        recovery_email_external="shared@gmail.com",
        status="archived",
        registered_at="2026-01-15T00:00:00Z",
    )
    removed = create(signed, recovery_email_external="shared@gmail.com")
    request(signed, "DELETE", "/" + removed["id"], version(removed))
    request(signed, "DELETE", "/" + target["id"], version(target))
    request(
        signed,
        "PATCH",
        "/" + linked["id"],
        {"row_version": linked["row_version"], "purpose": "修改不改变最近关联"},
    )
    client, _ = signed
    result = client.get("/api/v1/recovery-emails").json()
    group = next(x for x in result["items"] if x["email"] == "shared@gmail.com")
    assert (
        group["account_count"] == 3 and group["normal_count"] == 1 and group["abnormal_count"] == 1
    )
    assert group["latest_registered_at"].startswith("2026-02-01")
    assert client.get(ROOT, params={"recovery_email": group["email"]}).json()["total"] == 3
    assert client.get(ROOT + "/" + linked["id"]).json()["recovery_email"] == "Shared@gmail.com"
    assert client.get("/api/v1/recovery-emails", params={"page": 999}).json()["items"] == []


def batch(signed, path, rows, **extra):
    return request(
        signed,
        "POST",
        "/batch-" + path,
        {"accounts": [{"id": r["id"], "row_version": r["row_version"]} for r in rows], **extra},
    )


def test_batch_status_tags_versions_audit_and_unselected(env, signed):
    rows = [create(signed) for _ in range(3)]
    client, state = signed
    tags = [
        client.post(
            "/api/v1/tags", json={"name": n}, headers={"X-CSRF-Token": state["csrf_token"]}
        ).json()
        for n in ["原有", "追加"]
    ]
    rows[0] = request(
        signed, "PATCH", "/" + rows[0]["id"], {"row_version": 1, "tag_ids": [tags[0]["id"]]}
    ).json()
    assert batch(signed, "tags", rows[:2], tag_ids=[tags[1]["id"]]).status_code == 200
    current = [client.get(ROOT + "/" + r["id"]).json() for r in rows]
    assert {t["id"] for t in current[0]["tags"]} == {t["id"] for t in tags}
    assert current[1]["tags"][0]["id"] == tags[1]["id"]
    assert current[2]["row_version"] == 1 and current[2]["tags"] == []
    assert batch(signed, "status", current[:2], status="archived").status_code == 200
    current = [client.get(ROOT + "/" + r["id"]).json() for r in rows]
    assert all(r["archived_at"] and r["status"] == "archived" for r in current[:2])
    assert batch(signed, "status", current[:2], status="normal").status_code == 200
    assert all(client.get(ROOT + "/" + r["id"]).json()["archived_at"] is None for r in current[:2])
    with Session(env["engine"]) as db:
        events = db.scalars(
            select(AuditEvent).where(
                AuditEvent.event_metadata["operation"].astext.in_(["batch-status", "batch-tags"])
            )
        ).all()
        assert len(events) == 6 and all(e.session_id and e.account_id for e in events)
        assert all(set(e.event_metadata) == {"operation"} for e in events)


@pytest.mark.parametrize(
    "kind,failure",
    [
        (kind, failure)
        for kind in ["status", "tags"]
        for failure in ["version", "deleted", "missing"]
    ]
    + [("tags", "tag")],
)
def test_batch_failure_rolls_back_entire_transaction(env, signed, kind, failure):
    rows = sorted([create(signed), create(signed)], key=lambda r: r["id"])
    client, state = signed
    tag = client.post(
        "/api/v1/tags", json={"name": "标签"}, headers={"X-CSRF-Token": state["csrf_token"]}
    ).json()
    selected = [dict(r) for r in rows]
    if failure == "version":
        selected[1]["row_version"] = 99
    if failure == "deleted":
        request(signed, "DELETE", "/" + rows[1]["id"], version(rows[1]))
    if failure == "missing":
        selected[1]["id"] = "ffffffff-ffff-ffff-ffff-ffffffffffff"
    before = [client.get(ROOT + "/" + r["id"]).json() for r in rows]
    result = batch(
        signed,
        kind,
        selected,
        **(
            {"status": "archived"}
            if kind == "status"
            else {"tag_ids": [str(uuid4()) if failure == "tag" else tag["id"]]}
        ),
    )
    assert result.status_code in [409, 404, 422]
    assert result.json()["error"]["details"]["account_id"] in [r["id"] for r in selected]
    assert [client.get(ROOT + "/" + r["id"]).json() for r in rows] == before
    with Session(env["engine"]) as db:
        assert not db.scalars(
            select(AuditEvent).where(
                AuditEvent.event_metadata["operation"].astext.in_(["batch-status", "batch-tags"])
            )
        ).all()


@pytest.mark.parametrize(
    "path,method,body",
    [
        ("/dashboard/summary", "GET", None),
        ("/recovery-emails", "GET", None),
        ("/accounts/options", "GET", None),
        (
            "/accounts/batch-status",
            "POST",
            {"accounts": [{"id": str(uuid4()), "row_version": 1}], "status": "normal"},
        ),
        (
            "/accounts/batch-tags",
            "POST",
            {"accounts": [{"id": str(uuid4()), "row_version": 1}], "tag_ids": [str(uuid4())]},
        ),
        ("/auth/activity", "POST", None),
    ],
)
def test_new_endpoints_auth_csrf(env, path, method, body):
    client = env["client"]()
    assert client.request(method, "/api/v1" + path, json=body).status_code == 401
    pending = login(env, client).json()
    response = client.request(
        method, "/api/v1" + path, json=body, headers={"X-CSRF-Token": pending["csrf_token"]}
    )
    assert response.status_code == (200 if path == "/auth/activity" else 403)
    if method == "POST":
        assert client.request(method, "/api/v1" + path, json=body).status_code == 403


def test_reads_do_not_keep_session_alive_activity_cannot_exceed_absolute(env, signed):
    client, state = signed
    with Session(env["engine"]) as db:
        row = db.scalar(select(UserSession).where(UserSession.auth_level == "authenticated"))
        original = row.last_seen_at
        absolute = row.expires_at
    advance(env, 60)
    for path in [
        ROOT,
        "/api/v1/tags",
        "/api/v1/dashboard/summary",
        "/api/v1/recovery-emails",
        ROOT + "/options",
    ]:
        assert client.get(path).status_code == 200
    with Session(env["engine"]) as db:
        assert db.get(UserSession, row.id).last_seen_at == original
    result = post(client, "activity", state).json()
    assert result["csrf_token"] == state["csrf_token"]
    assert datetime.fromisoformat(result["expires_at"].replace("Z", "+00:00")) == absolute
    advance(env, 901)
    assert post(client, "activity", state).status_code == 401


def test_options_not_limited_to_first_page_and_no_detail_secrets(signed):
    rows = [create(signed) for _ in range(32)]
    client, _ = signed
    first = client.get(ROOT + "/options").json()
    second = client.get(ROOT + "/options", params={"page": 2}).json()
    assert len(first["items"]) == 30 and len(second["items"]) == 2
    assert first["total"] == 32
    assert (
        client.get(ROOT + "/options", params={"search": rows[0]["gmail_email"]}).json()["items"][0][
            "id"
        ]
        == rows[0]["id"]
    )
    assert set(second["items"][0]) == {"id", "account_no", "gmail_email"}
    assert client.get(ROOT + "/options", params={"exclude_id": rows[0]["id"]}).json()["total"] == 31


@pytest.mark.parametrize(
    "accounts",
    [[], [{"id": str(uuid4()), "row_version": 0}], [{"id": "invalid", "row_version": 1}]],
)
def test_batch_boundary_inputs(signed, accounts):
    assert (
        request(
            signed, "POST", "/batch-status", {"accounts": accounts, "status": "normal"}
        ).status_code
        == 422
    )


def test_batch_duplicate_and_auth_csrf_signed(signed):
    row = create(signed)
    assert batch(signed, "status", [row, row], status="normal").status_code == 422
    for path, extra in [("status", {"status": "normal"}), ("tags", {"tag_ids": [str(uuid4())]})]:
        body = {"accounts": [{"id": row["id"], "row_version": 1}], **extra}
        for token in [None, "invalid"]:
            assert (
                signed[0]
                .post(
                    ROOT + "/batch-" + path,
                    json=body,
                    headers={} if token is None else {"X-CSRF-Token": token},
                )
                .status_code
                == 403
            )


def test_concurrent_batch_and_patch_only_one_commits(env, signed):
    from concurrent.futures import ThreadPoolExecutor

    rows = [create(signed) for _ in range(2)]

    def patch():
        return request(
            signed, "PATCH", "/" + rows[0]["id"], {"row_version": 1, "purpose": "竞争写入"}
        ).status_code

    def bulk():
        return batch(signed, "status", rows, status="archived").status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(patch), pool.submit(bulk)]
        outcomes = [f.result() for f in futures]
    assert sorted(outcomes) == [200, 409]
    current = [signed[0].get(ROOT + "/" + r["id"]).json() for r in rows]
    if outcomes[1] == 409:
        assert current[1]["row_version"] == 1 and current[1]["status"] != "archived"
    else:
        assert all(r["status"] == "archived" and r["row_version"] == 2 for r in current)


def test_configured_paging_defaults_and_limits(env, signed):
    env["settings"].default_page_size = 2
    env["settings"].max_page_size = 3
    for _ in range(4):
        create(signed)
    client, _ = signed
    result = client.get(ROOT).json()
    assert result["page_size"] == 2 and len(result["items"]) == 2 and result["max_page_size"] == 3
    for path in [ROOT, ROOT + "/options", "/api/v1/recovery-emails"]:
        assert client.get(path).json()["page_size"] == 2
        assert client.get(path, params={"page_size": 4}).status_code == 422


def test_batch_validation_locates_row_without_echoing_input(signed):
    rows = [create(signed), create(signed)]
    body = {
        "accounts": [
            {"id": rows[0]["id"], "row_version": 1},
            {"id": rows[1]["id"], "row_version": 0},
        ],
        "status": "normal",
    }
    result = request(signed, "POST", "/batch-status", body)
    assert result.status_code == 422
    assert result.json()["error"]["details"] == {
        "field": "accounts.1.row_version",
        "account_index": "1",
    }
    private = "must-not-echo-unknown-key"
    result = request(signed, "POST", "/batch-status", {**body, private: "must-not-echo-value"})
    assert private not in result.text and "must-not-echo-value" not in result.text
