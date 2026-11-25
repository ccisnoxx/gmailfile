"""Wave 1 (TC-P0-003/015, TC-P1-001): 离线密码黑名单、Step-Up 一致性与 CSV 中间件集成测试。"""

import hashlib
import json

import pyotp
import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from test_accounts import create
from test_accounts import signed as signed
from test_auth import advance, enroll, post
from test_auth import env as env
from test_operations import csv_bytes, reverify

from app.cli import create_admin
from app.core.security import passwords, random_token
from app.models import AdminUser, UserSession

pytestmark = pytest.mark.integration


def test_password_denylist_file_enforced_in_api_password_change(env, tmp_path):
    plain_banned = "Glacier-Lantern-Compass-Plain9"
    sha1_banned = "Velvet-Timber-Harbor-ShaOne7"
    sha256_banned = "Copper-Falcon-Meadow-ShaTwo5"
    clean_password = "Aurora-Quartz-Summit-Clean2026!"

    denylist = tmp_path / "offline-denylist.txt"
    denylist.write_text(
        "\n".join(
            [
                "# synthetic offline breached password list",
                plain_banned,
                f"{hashlib.sha1(sha1_banned.encode()).hexdigest().upper()}:128",
                hashlib.sha256(sha256_banned.encode()).hexdigest(),
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    # 1. API 路径：POST /api/v1/auth/password 必须拦截明文/SHA-1/SHA-256 三种格式且不回显候选密码
    env["settings"].password_denylist_file = denylist
    client = env["client"]()
    _, initial = enroll(env, client)
    state = post(client, "reverify", initial["session"], {"password": env["password"]}).json()

    for banned in (plain_banned, sha1_banned, sha256_banned):
        res = post(
            client,
            "password",
            state,
            {"password": env["password"], "new_password": banned},
        )
        assert res.status_code == 422
        assert res.json()["error"]["code"] == "WEAK_PASSWORD"
        assert banned not in res.text
        # 被拒绝不得撤销当前会话或更改密码
        assert client.get("/protected").status_code == 200

    with Session(env["engine"]) as db:
        assert passwords.verify(env["password"], db.scalar(select(AdminUser)).password_hash)

    # 非黑名单强短语改密成功
    ok = post(
        client,
        "password",
        state,
        {"password": env["password"], "new_password": clean_password},
    )
    assert ok.status_code == 200
    assert client.get("/protected").status_code == 401
    with Session(env["engine"]) as db:
        assert passwords.verify(clean_password, db.scalar(select(AdminUser)).password_hash)


def test_password_denylist_file_enforced_in_cli_create_admin(db_engine, tmp_path, monkeypatch):
    plain_banned = "Glacier-Lantern-Compass-Plain9"
    sha1_banned = "Velvet-Timber-Harbor-ShaOne7"
    sha256_banned = "Copper-Falcon-Meadow-ShaTwo5"
    clean_password = "Aurora-Quartz-Summit-Clean2026!"

    denylist = tmp_path / "offline-denylist.txt"
    denylist.write_text(
        "\n".join(
            [
                "# synthetic offline breached password list",
                plain_banned,
                f"{hashlib.sha1(sha1_banned.encode()).hexdigest().upper()}:128",
                hashlib.sha256(sha256_banned.encode()).hexdigest(),
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    monkeypatch.setattr("sys.stderr.isatty", lambda: True)

    for banned in (plain_banned, sha1_banned, sha256_banned):
        with pytest.raises(ValueError, match="离线泄露密码黑名单"):
            create_admin(db_engine, lambda _prompt, p=banned: p, denylist_file=denylist)

    missing_denylist = tmp_path / "missing-denylist.txt"
    with pytest.raises(ValueError, match="密码黑名单"):
        create_admin(db_engine, lambda _prompt: clean_password, denylist_file=missing_denylist)

    create_admin(db_engine, lambda _prompt: clean_password, denylist_file=denylist)
    with Session(db_engine) as db:
        assert passwords.verify(clean_password, db.scalar(select(AdminUser)).password_hash)


def test_step_up_consistency_across_password_change_reveal_and_copy(env):
    env["settings"].step_up_totp_required = True
    client = env["client"]()
    secret, initial = enroll(env, client)
    state = initial["session"]
    assert state["step_up_totp_required"] is True

    account = create((client, state), gmail_email="stepup-all@gmail.com")
    reveal_url = f"/api/v1/accounts/{account['id']}/reveal-password"
    copy_url = f"/api/v1/accounts/{account['id']}/copy-password-event"

    # 完成带 TOTP 的 step-up reverify
    advance(env)
    code = pyotp.TOTP(secret).at(env["clock"][0])
    reverified = post(client, "reverify", state, {"password": env["password"], "totp_code": code})
    assert reverified.status_code == 200
    state = reverified.json()
    assert state["mfa_reauthenticated_until"] is not None

    # 降级会话：仅保留密码级 reauthenticated_at，清除 mfa_reauthenticated_at
    with Session(env["engine"]) as db, db.begin():
        db.execute(update(UserSession).values(mfa_reauthenticated_at=None))

    headers = {"X-CSRF-Token": state["csrf_token"]}
    new_password = "Aurora-Quartz-Summit-StepUp2026!"
    for path, body in (
        (reveal_url, {}),
        (copy_url, {}),
        ("/api/v1/auth/password", {"password": env["password"], "new_password": new_password}),
    ):
        denied = client.post(path, json=body, headers=headers)
        assert denied.status_code == 403, path
        assert denied.json()["error"]["code"] == "REAUTH_REQUIRED"

    # 重新执行带新时间步 TOTP 的 step-up reverify 后，三项高风险操作均可正常放行
    advance(env)
    fresh_code = pyotp.TOTP(secret).at(env["clock"][0])
    reverified2 = post(
        client, "reverify", state, {"password": env["password"], "totp_code": fresh_code}
    )
    assert reverified2.status_code == 200
    state = reverified2.json()
    headers = {"X-CSRF-Token": state["csrf_token"]}
    assert client.post(reveal_url, json={}, headers=headers).status_code == 200
    assert client.post(copy_url, json={}, headers=headers).status_code == 200
    assert (
        post(
            client,
            "password",
            state,
            {"password": env["password"], "new_password": new_password},
        ).status_code
        == 200
    )


def test_csv_upload_middleware_full_integration_boundaries(env, signed):
    reverify(env, signed)
    client, state = signed
    csv_data = csv_bytes(
        [
            ["gmail_email", "password", "recovery_email"],
            ["spaced.mime@example.test", random_token(), "rec-spaced@example.test"],
        ]
    )

    # 1. 恶意 Host 在 CsvUploadLimit 之前即被拦截（400 INVALID_HOST），且带 X-Request-ID 与 no-store
    bad_host = client.post(
        "/api/v1/imports/csv/preview",
        content=csv_data,
        headers={
            "host": "evil.example",
            "Content-Type": "application/octet-stream",
            "X-CSRF-Token": state["csrf_token"],
        },
    )
    assert bad_host.status_code == 400
    assert bad_host.json()["error"]["code"] == "INVALID_HOST"
    assert bad_host.headers["X-Request-ID"] == bad_host.json()["request_id"]
    assert bad_host.headers["Cache-Control"] == "no-store"

    # 2. 未登录超大包在读取 10 MiB 前被 401 AUTH_REQUIRED 拒绝
    anon = env["client"]()
    unauth = anon.post(
        "/api/v1/imports/csv/preview",
        content=b"a" * (10 * 1024 * 1024 + 64),
        headers={"Content-Type": "text/csv"},
    )
    assert unauth.status_code == 401
    assert unauth.json()["error"]["code"] == "AUTH_REQUIRED"
    assert unauth.headers["X-Request-ID"] == unauth.json()["request_id"]
    assert unauth.headers["Cache-Control"] == "no-store"

    # 3. 已登录但错误 MIME 与超限 10 MiB 均保留一致 X-Request-ID 与 Cache-Control: no-store
    bad_mime = client.post(
        "/api/v1/imports/csv/preview",
        content=csv_data,
        headers={
            "Content-Type": "application/octet-stream",
            "X-CSRF-Token": state["csrf_token"],
        },
    )
    assert bad_mime.status_code == 415
    assert bad_mime.headers["X-Request-ID"] == bad_mime.json()["request_id"]
    assert bad_mime.headers["Cache-Control"] == "no-store"

    too_big = client.post(
        "/api/v1/imports/csv/preview",
        content=b"x" * (10 * 1024 * 1024 + 1),
        headers={"Content-Type": "text/csv", "X-CSRF-Token": state["csrf_token"]},
    )
    assert too_big.status_code == 413
    assert too_big.headers["X-Request-ID"] == too_big.json()["request_id"]
    assert too_big.headers["Cache-Control"] == "no-store"

    # 4. 带空白分隔的 Content-Type: text/csv ; charset=utf-8 完整走通 preview -> commit
    spaced_headers = {
        "Content-Type": "text/csv ; charset=utf-8",
        "X-CSRF-Token": state["csrf_token"],
    }
    preview_resp = client.post(
        "/api/v1/imports/csv/preview",
        content=csv_data,
        params={"options": json.dumps({"strategy": "skip"})},
        headers=spaced_headers,
    )
    assert preview_resp.status_code == 200
    receipt_id = preview_resp.json()["receipt_id"]
    assert receipt_id

    commit_resp = client.post(
        "/api/v1/imports/csv/commit",
        content=csv_data,
        params={"receipt_id": receipt_id},
        headers=spaced_headers,
    )
    assert commit_resp.status_code == 200
    assert commit_resp.json()["status"] == "committed"
    assert commit_resp.json()["created"] == 1
