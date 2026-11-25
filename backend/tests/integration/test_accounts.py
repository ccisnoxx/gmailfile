import io
import logging
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from test_auth import advance, enroll, login, post

from app.core.encryption import DecryptionError, EncryptedValue
from app.core.logging import JsonFormatter
from app.core.security import random_token
from app.models import AuditEvent, GmailAccount

pytestmark = pytest.mark.integration
ROOT = "/api/v1/accounts"


@pytest.fixture
def signed(env):
    client = env["client"]()
    _, result = enroll(env, client)
    return client, result["session"]


def request(signed, method, path="", body=None):
    client, state = signed
    return client.request(
        method, ROOT + path, json=body, headers={"X-CSRF-Token": state["csrf_token"]}
    )


def payload(**extra):
    return {
        "gmail_email": f"{uuid4().hex}@gmail.com",
        "password": random_token(),
        "recovery_email_external": "recovery@example.test",
        **extra,
    }


def create(signed, **extra):
    response = request(signed, "POST", body=payload(**extra))
    assert response.status_code == 201, response.status_code
    return response.json()


def version(row):
    return {"row_version": row["row_version"]}


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("GET", "", None),
        ("POST", "", payload()),
        ("GET", "/{id}", None),
        ("PATCH", "/{id}", {"row_version": 1, "purpose": "test"}),
        ("DELETE", "/{id}", {"row_version": 1}),
        *[
            ("POST", "/{id}/" + action, {} if "password" in action else {"row_version": 1})
            for action in [
                "archive",
                "restore",
                "mark-verified",
                "mark-logged-in",
                "reveal-password",
                "copy-password-event",
            ]
        ],
    ],
)
def test_all_account_endpoints_require_full_auth(env, method, path, body):
    path = path.replace("{id}", str(uuid4()))
    client = env["client"]()
    assert client.request(method, ROOT + path, json=body).status_code == 401
    pending = login(env, client).json()
    assert request((client, pending), method, path, body).status_code == 403


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("POST", "", payload()),
        ("PATCH", "/{id}", {"row_version": 1}),
        ("DELETE", "/{id}", {"row_version": 1}),
        *[
            ("POST", "/{id}/" + action, {} if "password" in action else {"row_version": 1})
            for action in [
                "archive",
                "restore",
                "mark-verified",
                "mark-logged-in",
                "reveal-password",
                "copy-password-event",
            ]
        ],
    ],
)
@pytest.mark.parametrize("token", [None, "incorrect"])
def test_all_account_mutations_require_csrf(signed, method, path, body, token):
    client, _ = signed
    response = client.request(
        method,
        ROOT + path.replace("{id}", str(uuid4())),
        json=body,
        headers={} if token is None else {"X-CSRF-Token": token},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CSRF_INVALID"


def test_complete_crud_encryption_and_response_whitelist(env, signed):
    phone, notes, password = "+1 (202) 555-0123", random_token(), random_token()
    body = payload(
        gmail_email=" User.Name+test@googlemail.com ",
        phone=phone,
        notes=notes,
        password=password,
        purpose="工作",
        status="normal",
        two_factor_status="enabled",
        registered_at="2026-11-24T18:30:00+08:00",
        last_login_at="2026-11-24T10:00:00Z",
        last_verified_at="2026-11-23T10:00:00Z",
        password_changed_at="2026-11-22T10:00:00Z",
    )
    row = request(signed, "POST", body=body).json()
    assert row["gmail_email"] == body["gmail_email"]
    assert row["registered_at"].startswith("2026-11-24T10:30:00")
    assert row["phone"] == phone and row["notes"] == notes
    client, _ = signed
    summary = client.get(ROOT).json()["items"][0]
    detail = client.get(ROOT + "/" + row["id"]).json()
    assert detail["registered_at"].startswith("2026-11-24T10:30:00")
    for response in [row, summary, detail]:
        assert "password" not in response
        assert all(
            "ciphertext" not in field and "nonce" not in field and "key_version" not in field
            for field in response
        )
        assert password not in str(response)
    assert "phone" not in summary and "notes" not in summary
    with Session(env["engine"]) as db:
        stored = db.get(GmailAccount, row["id"])
        original = stored.password_ciphertext
        assert stored.gmail_email_normalized == "username@gmail.com"
        for field, plain in [("password", password), ("phone", phone), ("notes", notes)]:
            cipher = EncryptedValue(
                getattr(stored, field + "_ciphertext"),
                getattr(stored, field + "_nonce"),
                getattr(stored, field + "_key_version"),
            )
            assert plain.encode() not in cipher.ciphertext
            assert (
                client.app.state.encryption.decrypt(cipher, "gmail_account", stored.id, field)
                == plain
            )
            with pytest.raises(DecryptionError):
                client.app.state.encryption.decrypt(cipher, "gmail_account", uuid4(), field)
    updated = request(
        signed,
        "PATCH",
        "/" + row["id"],
        {**version(row), "purpose": "订阅", "phone": None, "notes": None},
    )
    assert updated.status_code == 200
    row = updated.json()
    assert row["row_version"] == 2 and row["phone"] is None and row["notes"] is None
    with Session(env["engine"]) as db:
        assert db.get(GmailAccount, row["id"]).password_ciphertext == original
    assert (
        request(
            signed, "PATCH", "/" + row["id"], {**version(row), "password": random_token()}
        ).status_code
        == 200
    )


def test_normalized_duplicate_reserved_after_delete(env, signed):
    row = create(signed, gmail_email="User.Name+one@googlemail.com")
    assert (
        request(signed, "POST", body=payload(gmail_email="username@gmail.com")).status_code == 409
    )
    other = create(signed)
    response = request(
        signed,
        "PATCH",
        "/" + other["id"],
        {**version(other), "gmail_email": "user.name+two@gmail.com"},
    )
    assert (
        response.status_code == 409
        and response.json()["error"]["code"] == "ACCOUNT_EMAIL_DUPLICATE"
    )
    assert request(signed, "DELETE", "/" + row["id"], version(row)).status_code == 200
    assert (
        request(signed, "POST", body=payload(gmail_email="username@gmail.com")).status_code == 409
    )
    a = create(signed, gmail_email="User.Name+one@example.test")
    b = create(signed, gmail_email="username@example.test")
    assert a["id"] != b["id"]


@pytest.mark.parametrize(
    "extra",
    [
        {"recovery_email_external": None},
        {"recovery_account_id": str(uuid4())},
        {"recovery_email_external": "NAME@gmail.com", "gmail_email": "N.a.m.e+test@googlemail.com"},
        {"registered_at": "2026-11-24T18:00:00"},
        {"status": "invalid"},
        {"two_factor_status": "invalid"},
        {"password": ""},
        {"phone": "wrong"},
        {"gmail_email": "invalid"},
        {"gmail_totp_seed": "forbidden"},
    ],
)
def test_boundary_validation(signed, extra):
    assert request(signed, "POST", body=payload(**extra)).status_code == 422


def test_recovery_association_xor_self_and_rename(signed):
    target = create(signed)
    row = create(signed, recovery_account_id=target["id"], recovery_email_external=None)
    assert row["recovery_email"] == target["gmail_email"]
    assert (
        request(
            signed, "PATCH", "/" + row["id"], {**version(row), "recovery_account_id": row["id"]}
        ).status_code
        == 422
    )
    assert (
        request(
            signed,
            "PATCH",
            "/" + row["id"],
            {**version(row), "recovery_email_external": "other@example.test"},
        ).status_code
        == 422
    )
    assert (
        request(
            signed, "PATCH", "/" + row["id"], {**version(row), "gmail_email": target["gmail_email"]}
        ).status_code
        == 422
    )
    response = request(
        signed, "PATCH", "/" + target["id"], {**version(target), "gmail_email": row["gmail_email"]}
    )
    assert response.status_code == 422
    assert (
        request(
            signed,
            "PATCH",
            "/" + row["id"],
            {
                **version(row),
                "recovery_account_id": None,
                "recovery_email_external": "other@example.test",
            },
        ).status_code
        == 200
    )
    assert (
        request(
            signed,
            "PATCH",
            "/" + target["id"],
            {
                **version(target),
                "recovery_account_id": str(uuid4()),
                "recovery_email_external": None,
            },
        ).status_code
        == 404
    )


def test_state_transitions_restore_and_version_on_every_write(signed):
    row = create(signed)
    client, _ = signed
    for action in ["mark-logged-in", "mark-verified", "archive"]:
        path = "/" + row["id"] + "/" + action
        assert request(signed, "POST", path, {"row_version": 0}).status_code == 422
        assert (
            request(signed, "POST", path, {"row_version": row["row_version"] + 10}).status_code
            == 409
        )
        updated = request(signed, "POST", path, version(row))
        assert updated.status_code == 200
        row = updated.json()
    assert row["last_verified_at"] and row["last_login_at"]
    assert row["status"] == "archived" and row["archived_at"]
    updated = request(signed, "PATCH", "/" + row["id"], {**version(row), "status": "normal"}).json()
    assert updated["archived_at"] is None
    row = updated
    assert request(signed, "DELETE", "/" + row["id"], {"row_version": 1}).status_code == 409
    row = request(signed, "DELETE", "/" + row["id"], version(row)).json()
    assert row["deleted_at"] and not client.get(ROOT).json()["items"]
    assert client.get(ROOT + "?deleted=true").json()["items"][0]["id"] == row["id"]
    assert (
        request(signed, "PATCH", "/" + row["id"], {**version(row), "purpose": "test"}).status_code
        == 409
    )
    assert (
        request(signed, "POST", "/" + row["id"] + "/restore", {"row_version": 1}).status_code == 409
    )
    row = request(signed, "POST", "/" + row["id"] + "/restore", version(row)).json()
    assert row["deleted_at"] is None and client.get(ROOT).json()["items"]
    assert not client.get(ROOT + "?deleted=true").json()["items"]
    assert request(signed, "POST", "/" + row["id"] + "/restore", version(row)).status_code == 409
    assert request(signed, "PATCH", "/" + row["id"], {"purpose": "test"}).status_code == 422
    assert (
        request(signed, "PATCH", "/" + row["id"], {**version(row), "gmail_email": None}).status_code
        == 422
    )


def test_atomic_version_conflict_and_duplicate_creation(env, signed):
    row = create(signed)

    def patch(_):
        return request(
            signed, "PATCH", "/" + row["id"], {**version(row), "purpose": random_token()}
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(patch, range(2))) == [200, 409]
    body = payload()
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(
            pool.map(lambda _: request(signed, "POST", body=body).status_code, range(2))
        ) == [201, 409]


def test_password_recent_expired_session_nostore_audit_and_decryption_failure(env, signed):
    client, state = signed
    secret = random_token()
    row = create(signed, password=secret)
    reveal = "/" + row["id"] + "/reveal-password"
    copied = "/" + row["id"] + "/copy-password-event"
    for path in [reveal, copied]:
        response = request(signed, "POST", path, {})
        assert response.status_code == 403 and response.json()["error"]["code"] == "REAUTH_REQUIRED"
        assert response.headers["Cache-Control"] == "no-store"
    state = post(client, "reverify", state, {"password": env["password"]}).json()
    signed = (client, state)
    response = request(signed, "POST", reveal, {})
    assert response.status_code == 200 and response.json()["password"] == secret
    assert response.headers["Cache-Control"] == "no-store"
    assert request(signed, "POST", copied, {"password": secret}).status_code == 422
    assert request(signed, "POST", copied, {}).status_code == 200
    advance(env, 300)
    assert request(signed, "POST", reveal, {}).json()["error"]["code"] == "REAUTH_REQUIRED"
    state = post(client, "reverify", state, {"password": env["password"]}).json()
    signed = (client, state)
    with Session(env["engine"]) as db, db.begin():
        db.execute(update(GmailAccount).values(password_ciphertext=b"x" * 32))
    response = request(signed, "POST", reveal, {})
    assert response.status_code == 500 and response.json()["error"]["code"] == "DECRYPTION_FAILED"
    assert response.headers["Cache-Control"] == "no-store" and secret not in response.text
    with Session(env["engine"]) as db:
        events = db.scalars(select(AuditEvent).where(AuditEvent.account_id == row["id"])).all()
        assert [e.event_type for e in events].count("password_revealed") == 1
        assert [e.event_type for e in events].count("password_copied") == 1
    post(client, "logout", state)
    assert request(signed, "POST", reveal, {}).status_code == 401


def test_account_and_tag_audit_no_sensitive_plaintext(env, signed):
    client, state = signed
    password, notes = random_token(), random_token()
    phone = "+1 202 555 0123"
    log = io.StringIO()
    handler = logging.StreamHandler(log)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("gmail_manager")
    logger.addHandler(handler)
    try:
        row = create(signed, password=password, notes=notes, phone=phone)
        tag = client.post(
            "/api/v1/tags", json={"name": "合成标签"}, headers={"X-CSRF-Token": state["csrf_token"]}
        ).json()
        row = request(
            signed, "PATCH", "/" + row["id"], {**version(row), "tag_ids": [tag["id"]]}
        ).json()
        row = request(signed, "POST", "/" + row["id"] + "/archive", version(row)).json()
        row = request(signed, "DELETE", "/" + row["id"], version(row)).json()
        request(signed, "POST", "/" + row["id"] + "/restore", version(row))
    finally:
        logger.removeHandler(handler)
    with Session(env["engine"]) as db:
        events = db.scalars(select(AuditEvent).where(AuditEvent.account_id == row["id"])).all()
        assert {e.event_type for e in events} == {
            "account_created",
            "account_updated",
            "account_archived",
            "account_deleted",
            "account_restored",
        }
        audit_text = str([(e.event_type, e.event_metadata) for e in events])
        assert all(set(e.event_metadata) <= {"operation"} and e.user_agent is None for e in events)
    assert all(secret not in log.getvalue() + audit_text for secret in [password, notes, phone])


def test_tag_management_cascade_and_version_protection(signed):
    client, state = signed
    headers = {"X-CSRF-Token": state["csrf_token"]}
    assert client.post("/api/v1/tags", json={"name": "测试"}).status_code == 403
    tag = client.post("/api/v1/tags", json={"name": "测试"}, headers=headers).json()
    assert client.post("/api/v1/tags", json={"name": "测试"}, headers=headers).status_code == 409
    assert (
        client.patch(
            "/api/v1/tags/" + tag["id"], json={"name": "工作"}, headers=headers
        ).status_code
        == 200
    )
    row = create(signed, tag_ids=[tag["id"]])
    assert row["tags"][0]["name"] == "工作"
    assert (
        request(
            signed, "PATCH", "/" + row["id"], {**version(row), "tag_ids": [str(uuid4())]}
        ).status_code
        == 422
    )
    # 失败的标签关联写入必须回滚，包括已进行的 CAS 更新。
    assert client.get(ROOT + "/" + row["id"]).json()["row_version"] == row["row_version"]
    assert client.delete("/api/v1/tags/" + tag["id"], headers=headers).status_code == 200
    current = client.get(ROOT + "/" + row["id"]).json()
    assert current["tags"] == [] and current["row_version"] == row["row_version"] + 1
    assert (
        request(signed, "PATCH", "/" + row["id"], {**version(row), "purpose": "旧编辑"}).status_code
        == 409
    )
    assert client.get("/api/v1/tags").json() == []


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("GET", "", None),
        ("POST", "", {"name": "测试"}),
        ("PATCH", "/{id}", {"name": "测试"}),
        ("DELETE", "/{id}", None),
    ],
)
def test_tags_require_full_auth_and_csrf(env, method, path, body):
    client = env["client"]()
    path = "/api/v1/tags" + path.replace("{id}", str(uuid4()))
    assert client.request(method, path, json=body).status_code == 401
    state = login(env, client).json()
    assert (
        client.request(
            method, path, json=body, headers={"X-CSRF-Token": state["csrf_token"]}
        ).status_code
        == 403
    )


def test_full_account_lifecycle_versions_visibility_password_and_audit(env, signed):
    from app.services.audit_integrity import verify_audit_chain

    client, state = signed
    initial_pw = random_token()
    rotated_pw = random_token()
    tag = client.post(
        "/api/v1/tags", json={"name": "生命周期"}, headers={"X-CSRF-Token": state["csrf_token"]}
    ).json()

    # 1. 创建（v1）
    row = create(
        signed,
        gmail_email="Life.Cycle+init@googlemail.com",
        password=initial_pw,
        phone="+86 13800138000",
        notes="初始敏感备注",
        purpose="测试生命周期",
        status="pending_verification",
    )
    assert row["row_version"] == 1
    assert client.get("/api/v1/dashboard/summary").json()["total"] == 1

    # 2. 更新非密码字段并绑定标签（v2），密码密文保持不变
    with Session(env["engine"]) as db:
        cipher_v1 = db.get(GmailAccount, row["id"]).password_ciphertext
    row = request(
        signed,
        "PATCH",
        "/" + row["id"],
        {**version(row), "status": "normal", "tag_ids": [tag["id"]], "purpose": "已激活"},
    ).json()
    assert row["row_version"] == 2 and [t["id"] for t in row["tags"]] == [tag["id"]]
    with Session(env["engine"]) as db:
        assert db.get(GmailAccount, row["id"]).password_ciphertext == cipher_v1

    # 3. 修改密码（v3），重新验证后按需查看返回新密码
    row = request(signed, "PATCH", "/" + row["id"], {**version(row), "password": rotated_pw}).json()
    assert row["row_version"] == 3
    state = post(client, "reverify", state, {"password": env["password"]}).json()
    signed = (client, state)
    revealed = request(signed, "POST", "/" + row["id"] + "/reveal-password", {})
    assert revealed.status_code == 200 and revealed.json()["password"] == rotated_pw

    # 4. 标记登录（v4）与验证（v5）
    row = request(signed, "POST", "/" + row["id"] + "/mark-logged-in", version(row)).json()
    assert row["row_version"] == 4 and row["last_login_at"] is not None
    row = request(signed, "POST", "/" + row["id"] + "/mark-verified", version(row)).json()
    assert row["row_version"] == 5 and row["last_verified_at"] is not None

    # 5. 归档（v6）与取消归档（v7）
    row = request(signed, "POST", "/" + row["id"] + "/archive", version(row)).json()
    assert row["row_version"] == 6 and row["status"] == "archived" and row["archived_at"]
    assert client.get(ROOT, params={"archived": False}).json()["total"] == 0
    assert client.get(ROOT, params={"archived": True}).json()["total"] == 1
    row = request(signed, "PATCH", "/" + row["id"], {**version(row), "status": "normal"}).json()
    assert row["row_version"] == 7 and row["archived_at"] is None

    # 6. 软删除（v8）：从默认列表与统计消失，仅在 deleted=true 可见，写/查密码均返回 409
    row = request(signed, "DELETE", "/" + row["id"], version(row)).json()
    assert row["row_version"] == 8 and row["deleted_at"] is not None
    assert client.get(ROOT).json()["total"] == 0
    assert client.get(ROOT, params={"deleted": True}).json()["total"] == 1
    assert client.get("/api/v1/dashboard/summary").json()["total"] == 0
    for method, suffix, body in [
        ("PATCH", "", {**version(row), "purpose": "禁止"}),
        ("POST", "/archive", version(row)),
        ("POST", "/mark-verified", version(row)),
        ("POST", "/mark-logged-in", version(row)),
        ("POST", "/reveal-password", {}),
        ("POST", "/copy-password-event", {}),
    ]:
        blocked = request(signed, method, "/" + row["id"] + suffix, body)
        assert blocked.status_code == 409
        assert blocked.json()["error"]["code"] == "ACCOUNT_DELETED"
    # 软删除后规范化地址仍保留唯一性。
    dup = request(signed, "POST", body=payload(gmail_email="lifecycle@gmail.com"))
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "ACCOUNT_EMAIL_DUPLICATE"

    # 7. 恢复（v9）：回到列表与统计，密码仍可正常解密，审计链完整有效。
    row = request(signed, "POST", "/" + row["id"] + "/restore", version(row)).json()
    assert row["row_version"] == 9 and row["deleted_at"] is None
    assert client.get(ROOT).json()["total"] == 1
    assert client.get("/api/v1/dashboard/summary").json()["total"] == 1
    assert (
        request(signed, "POST", "/" + row["id"] + "/reveal-password", {}).json()["password"]
        == rotated_pw
    )
    with Session(env["engine"]) as db:
        assert verify_audit_chain(db).valid is True


@pytest.mark.parametrize(
    "other_method,other_suffix,other_body",
    [
        ("DELETE", "", {}),
        ("POST", "/archive", {}),
        ("POST", "/mark-verified", {}),
    ],
)
def test_concurrent_patch_vs_lifecycle_action_version_conflict(
    signed, other_method, other_suffix, other_body
):
    row = create(signed)
    base_ver = row["row_version"]

    def do_patch():
        return request(
            signed,
            "PATCH",
            "/" + row["id"],
            {"row_version": base_ver, "purpose": "并发更新"},
        )

    def do_other():
        return request(
            signed,
            other_method,
            "/" + row["id"] + other_suffix,
            {"row_version": base_ver, **other_body},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        f1, f2 = pool.submit(do_patch), pool.submit(do_other)
        responses = [f1.result(), f2.result()]
    assert sorted(r.status_code for r in responses) == [200, 409]
    loser = next(r for r in responses if r.status_code == 409)
    assert loser.json()["error"]["code"] in {"ROW_VERSION_CONFLICT", "ACCOUNT_DELETED"}
    latest = signed[0].get(ROOT + "/" + row["id"]).json()
    assert latest["row_version"] == base_ver + 1


def test_concurrent_restore_only_one_commits(signed):
    row = create(signed)
    deleted = request(signed, "DELETE", "/" + row["id"], version(row)).json()

    def do_restore(_):
        return request(signed, "POST", "/" + deleted["id"] + "/restore", version(deleted))

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(do_restore, range(2)))
    assert sorted(r.status_code for r in responses) == [200, 409]
    loser = next(r for r in responses if r.status_code == 409)
    assert loser.json()["error"]["code"] in {"ROW_VERSION_CONFLICT", "ACCOUNT_NOT_DELETED"}
