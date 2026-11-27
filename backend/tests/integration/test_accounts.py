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
        ("DELETE", "/{id}/permanent", {"row_version": 1}),
        (
            "POST",
            "/batch-permanent-delete",
            {"accounts": [{"id": str(uuid4()), "row_version": 1}], "confirmation": "DELETE 1"},
        ),
        *[
            ("POST", "/{id}/" + action, {} if "password" in action else {"row_version": 1})
            for action in [
                "archive",
                "restore",
                "mark-verified",
                "mark-logged-in",
                "reveal-password",
                "copy-password-event",
                "reveal-sensitive",
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
        ("DELETE", "/{id}/permanent", {"row_version": 1}),
        (
            "POST",
            "/batch-permanent-delete",
            {"accounts": [{"id": str(uuid4()), "row_version": 1}], "confirmation": "DELETE 1"},
        ),
        *[
            ("POST", "/{id}/" + action, {} if "password" in action else {"row_version": 1})
            for action in [
                "archive",
                "restore",
                "mark-verified",
                "mark-logged-in",
                "reveal-password",
                "copy-password-event",
                "reveal-sensitive",
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
    # 默认详情不返回手机号与敏感备注原文，仅返回是否存在标记
    assert row["has_phone"] is True and row["has_notes"] is True
    assert row["phone"] is None and row["notes"] is None
    client, state = signed
    summary = client.get(ROOT).json()["items"][0]
    detail = client.get(ROOT + "/" + row["id"]).json()
    assert detail["registered_at"].startswith("2026-11-24T10:30:00")
    assert detail["has_phone"] is True and detail["has_notes"] is True
    for response in [row, summary, detail]:
        assert "password" not in response
        assert all(
            "ciphertext" not in field and "nonce" not in field and "key_version" not in field
            for field in response
        )
        assert password not in str(response)
        assert phone not in str(response)
        assert notes not in str(response)
    assert "phone" not in summary and "notes" not in summary

    # 按需敏感字段接口与覆盖已有密码均要求最近重新验证
    unverified_reveal = request(signed, "POST", "/" + row["id"] + "/reveal-sensitive", {})
    assert unverified_reveal.status_code == 403
    assert unverified_reveal.json()["error"]["code"] == "REAUTH_REQUIRED"
    unverified_pw_patch = request(
        signed, "PATCH", "/" + row["id"], {**version(row), "password": random_token()}
    )
    assert unverified_pw_patch.status_code == 403
    assert unverified_pw_patch.json()["error"]["code"] == "REAUTH_REQUIRED"

    state = post(client, "reverify", state, {"password": env["password"]}).json()
    signed = (client, state)
    sensitive = request(signed, "POST", "/" + row["id"] + "/reveal-sensitive", {})
    assert sensitive.status_code == 200
    assert sensitive.headers["Cache-Control"] == "no-store"
    assert sensitive.json() == {"phone": phone, "notes": notes}

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
        events = db.scalars(select(AuditEvent).where(AuditEvent.account_id == row["id"])).all()
        assert any(e.event_type == "sensitive_fields_revealed" for e in events)
    updated = request(
        signed,
        "PATCH",
        "/" + row["id"],
        {**version(row), "purpose": "订阅", "phone": None, "notes": None},
    )
    assert updated.status_code == 200
    row = updated.json()
    assert row["row_version"] == 2 and row["has_phone"] is False and row["has_notes"] is False
    assert row["phone"] is None and row["notes"] is None
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


def test_optional_recovery_email_create_clear_and_stats_exclusion(signed):
    created = create(signed, recovery_email_external=None, recovery_account_id=None)
    assert created["recovery_email"] is None
    assert created["recovery_email_external"] is None
    assert created["recovery_account_id"] is None

    # 为有辅助邮箱的账号清空辅助邮箱应成功
    with_recovery = create(signed, recovery_email_external="clearable@example.test")
    cleared = request(
        signed,
        "PATCH",
        "/" + with_recovery["id"],
        {**version(with_recovery), "recovery_email_external": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["recovery_email"] is None

    # 辅助邮箱统计与仪表盘不应把空辅助邮箱聚合成 null 组
    client, _ = signed
    usage = client.get("/api/v1/recovery-emails").json()
    assert all(item["email"] for item in usage["items"])
    dash = client.get("/api/v1/dashboard/recovery-email-usage").json()
    assert all(item["email"] for item in dash["items"])


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

    # 3. 修改密码（v3）需先重新验证，验证后修改并按需查看返回新密码
    denied_pw = request(signed, "PATCH", "/" + row["id"], {**version(row), "password": rotated_pw})
    assert denied_pw.status_code == 403 and denied_pw.json()["error"]["code"] == "REAUTH_REQUIRED"
    state = post(client, "reverify", state, {"password": env["password"]}).json()
    signed = (client, state)
    row = request(signed, "PATCH", "/" + row["id"], {**version(row), "password": rotated_pw}).json()
    assert row["row_version"] == 3
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


def test_permanent_delete_requires_mfa_step_up_unlinks_recovery_and_releases_email(env):
    import pyotp

    from app.services.audit_integrity import verify_audit_chain

    client = env["client"]()
    totp_secret, enrolled = enroll(env, client)
    state = enrolled["session"]
    auth_pair = (client, state)

    target_email = "purge.reusable@gmail.com"
    acc_a = create(auth_pair, gmail_email=target_email)
    acc_b = create(
        auth_pair,
        gmail_email="dependent.account@gmail.com",
        recovery_account_id=acc_a["id"],
        recovery_email_external=None,
    )
    acc_c = create(auth_pair, gmail_email="batch.purge@gmail.com")

    trashed_a = request(auth_pair, "DELETE", "/" + acc_a["id"], version(acc_a)).json()
    trashed_c = request(auth_pair, "DELETE", "/" + acc_c["id"], version(acc_c)).json()

    # 未完成最近重新验证时，单条与批量永久删除均被拒绝
    denied_single = request(
        auth_pair, "DELETE", f"/{trashed_a['id']}/permanent", version(trashed_a)
    )
    assert denied_single.status_code == 403
    assert denied_single.json()["error"]["code"] == "REAUTH_REQUIRED"

    denied_batch = request(
        auth_pair,
        "POST",
        "/batch-permanent-delete",
        {
            "accounts": [{"id": trashed_c["id"], "row_version": trashed_c["row_version"]}],
            "confirmation": "DELETE 1",
        },
    )
    assert denied_batch.status_code == 403
    assert denied_batch.json()["error"]["code"] == "REAUTH_REQUIRED"

    # 仅输入密码未提供 TOTP 时，因永久删除强制 require_mfa=True，依然拒绝
    state = post(client, "reverify", state, {"password": env["password"]}).json()
    auth_pair = (client, state)
    denied_pwd_only = request(
        auth_pair, "DELETE", f"/{trashed_a['id']}/permanent", version(trashed_a)
    )
    assert denied_pwd_only.status_code == 403
    assert denied_pwd_only.json()["error"]["code"] == "REAUTH_REQUIRED"

    # 使用密码 + TOTP 完成 MFA Step-Up 后允许执行单条永久删除
    advance(env, 31)
    code = pyotp.TOTP(totp_secret).at(env["clock"][0])
    state = post(client, "reverify", state, {"password": env["password"], "totp_code": code}).json()
    auth_pair = (client, state)

    ok_single = request(auth_pair, "DELETE", f"/{trashed_a['id']}/permanent", version(trashed_a))
    assert ok_single.status_code == 200

    # 依赖账号的站内辅助邮箱已自动转为外部文本，且版本号递增
    updated_b = client.get(ROOT + "/" + acc_b["id"]).json()
    assert updated_b["recovery_account_id"] is None
    assert updated_b["recovery_email_external"] == target_email
    assert updated_b["row_version"] == acc_b["row_version"] + 1

    # 邮箱唯一性已释放，允许重新创建同地址账号
    recreated = create(auth_pair, gmail_email=target_email)
    assert recreated["id"] != acc_a["id"]

    # 批量永久删除缺少或写错确认短语时被服务端拒绝，记录失败审计且不删除记录
    missing_phrase = request(
        auth_pair,
        "POST",
        "/batch-permanent-delete",
        {"accounts": [{"id": trashed_c["id"], "row_version": trashed_c["row_version"]}]},
    )
    assert missing_phrase.status_code == 422
    assert missing_phrase.json()["error"]["code"] == "VALIDATION_ERROR"
    assert missing_phrase.json()["error"]["details"].get("field") == "confirmation"

    wrong_phrase = request(
        auth_pair,
        "POST",
        "/batch-permanent-delete",
        {
            "accounts": [{"id": trashed_c["id"], "row_version": trashed_c["row_version"]}],
            "confirmation": "DELETE 2",
        },
    )
    assert wrong_phrase.status_code == 422
    assert wrong_phrase.json()["error"]["code"] == "INVALID_CONFIRMATION"
    assert client.get(ROOT + "/" + trashed_c["id"]).status_code == 200

    # 批量永久删除在同一 Step-Up 窗口内提供准确确认短语后成功执行
    ok_batch = request(
        auth_pair,
        "POST",
        "/batch-permanent-delete",
        {
            "accounts": [{"id": trashed_c["id"], "row_version": trashed_c["row_version"]}],
            "confirmation": "DELETE 1",
        },
    )
    assert ok_batch.status_code == 200
    assert ok_batch.json()["updated_ids"] == [trashed_c["id"]]

    # 审计哈希链完整，记录了确认短语失败事件，且仍保留已永久删除账号的 UUID 审计记录
    with Session(env["engine"]) as db:
        status = verify_audit_chain(db)
        assert status.valid is True
        purged_events = db.scalars(
            select(AuditEvent).where(AuditEvent.event_type == "account_permanently_deleted")
        ).all()
        assert {str(e.account_id) for e in purged_events} == {trashed_a["id"], trashed_c["id"]}
        failed_confirm = db.scalars(
            select(AuditEvent).where(
                AuditEvent.event_type == "permanent_delete_confirmation_failed"
            )
        ).all()
        assert len(failed_confirm) == 1
        assert failed_confirm[0].event_metadata == {"operation": "batch-permanent-delete"}

    # 超过 5 分钟 Step-Up 窗口后再次永久删除必须重新被拒绝
    trashed_recreated = request(
        auth_pair, "DELETE", "/" + recreated["id"], version(recreated)
    ).json()
    advance(env, 301)
    expired = request(
        auth_pair, "DELETE", f"/{trashed_recreated['id']}/permanent", version(trashed_recreated)
    )
    assert expired.status_code == 403
    assert expired.json()["error"]["code"] == "REAUTH_REQUIRED"
