"""Wave 1 P1 集成测试：回收站批量恢复、辅助邮箱增强、Session 设备识别与密钥轮换 CLI。"""

import os
from urllib.parse import quote

import pyotp
import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from test_accounts import create, request, version
from test_accounts import signed as signed
from test_auth import advance, enroll, login, post

from app.cli import main as cli_main
from app.cli import rotate_keys_cli, verify_keys_cli
from app.core.encryption import EncryptionService
from app.models import AdminUser, AuditEvent, GmailAccount, UserSession
from app.services.key_rotation import rotate_data_keys, verify_data_keys

pytestmark = pytest.mark.integration


def test_batch_restore_atomic_and_deleted_count(env, signed):
    client, _ = signed
    rows = [create(signed, gmail_email=f"trash{i}@example.test") for i in range(3)]
    deleted = [request(signed, "DELETE", "/" + r["id"], version(r)).json() for r in rows[:2]]

    summary = client.get("/api/v1/dashboard/summary", params={"timezone": "UTC"}).json()
    assert summary["total"] == 1 and summary["deleted_count"] == 2

    # 混入一条未删除账号时整批回滚（原子性）
    mixed = request(
        signed,
        "POST",
        "/batch-restore",
        {
            "accounts": [
                {"id": deleted[0]["id"], "row_version": deleted[0]["row_version"]},
                {"id": rows[2]["id"], "row_version": rows[2]["row_version"]},
            ]
        },
    )
    assert mixed.status_code == 409
    assert mixed.json()["error"]["code"] == "ACCOUNT_NOT_DELETED"
    assert mixed.json()["error"]["details"]["account_id"] == rows[2]["id"]
    assert client.get("/api/v1/accounts", params={"deleted": True}).json()["total"] == 2

    # 版本号过期时整批回滚
    stale = request(
        signed,
        "POST",
        "/batch-restore",
        {
            "accounts": [
                {"id": deleted[0]["id"], "row_version": deleted[0]["row_version"]},
                {"id": deleted[1]["id"], "row_version": 1},
            ]
        },
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "ROW_VERSION_CONFLICT"
    assert stale.json()["error"]["details"]["account_id"] == deleted[1]["id"]
    assert client.get("/api/v1/accounts", params={"deleted": True}).json()["total"] == 2

    # 正常批量恢复
    ok = request(
        signed,
        "POST",
        "/batch-restore",
        {
            "accounts": [
                {"id": deleted[0]["id"], "row_version": deleted[0]["row_version"]},
                {"id": deleted[1]["id"], "row_version": deleted[1]["row_version"]},
            ]
        },
    )
    assert ok.status_code == 200
    assert set(ok.json()["updated_ids"]) == {deleted[0]["id"], deleted[1]["id"]}

    summary_after = client.get("/api/v1/dashboard/summary", params={"timezone": "UTC"}).json()
    assert summary_after["total"] == 3 and summary_after["deleted_count"] == 0

    with Session(env["engine"]) as db:
        events = db.scalars(
            select(AuditEvent).where(AuditEvent.event_type == "account_restored")
        ).all()
        assert len(events) == 2
        assert all(e.event_metadata.get("operation") == "batch-restore" for e in events)


def test_recovery_emails_search_sort_and_linked_accounts_endpoint(signed):
    client, _ = signed
    for i in range(3):
        create(
            signed,
            gmail_email=f"alpha{i}@example.test",
            recovery_email_external="hub-heavy@example.test",
            status="restricted" if i == 0 else "normal",
        )
    create(
        signed,
        gmail_email="beta@example.test",
        recovery_email_external="hub-light@example.test",
        status="normal",
    )

    # 默认按关联账号数降序，并返回全局统计字段
    page = client.get("/api/v1/recovery-emails").json()
    assert page["total"] == 2
    assert page["total_accounts"] == 4
    assert page["abnormal_recovery_emails"] == 1
    assert [item["email"] for item in page["items"]] == [
        "hub-heavy@example.test",
        "hub-light@example.test",
    ]

    # 按邮箱升序 / 搜索转义
    asc = client.get("/api/v1/recovery-emails", params={"sort": "email"}).json()
    assert [item["email"] for item in asc["items"]] == [
        "hub-heavy@example.test",
        "hub-light@example.test",
    ]
    searched = client.get("/api/v1/recovery-emails", params={"search": "LIGHT"}).json()
    assert searched["total"] == 1 and searched["items"][0]["email"] == "hub-light@example.test"
    assert client.get("/api/v1/recovery-emails", params={"search": "%"}).json()["total"] == 0

    # 独立关联账号列表端点改为查询参数（无密码/密文，且辅助邮箱不进入应用日志）
    import io
    import logging

    from app.core.logging import JsonFormatter

    stream = io.StringIO()
    log_handler = logging.StreamHandler(stream)
    log_handler.setFormatter(JsonFormatter())
    app_logger = logging.getLogger("gmail_manager")
    app_logger.addHandler(log_handler)
    try:
        linked = client.get(
            "/api/v1/recovery-email-accounts", params={"email": "hub-heavy@example.test"}
        )
        assert linked.status_code == 200
        assert linked.headers["cache-control"] == "no-store"
        body = linked.json()
        assert body["total"] == 3
        for item in body["items"]:
            assert "password" not in item and "password_ciphertext" not in item

        assert (
            client.get("/api/v1/recovery-email-accounts", params={"email": " "}).status_code == 422
        )
        encoded = quote("hub-heavy@example.test", safe="")
        assert client.get(f"/api/v1/recovery-emails/{encoded}/accounts").status_code == 404
    finally:
        app_logger.removeHandler(log_handler)

    application_logs = stream.getvalue()
    assert "hub-heavy@example.test" not in application_logs
    assert "hub-heavy%40example.test" not in application_logs


def test_sessions_device_label_and_active_only_filter(env):
    c1 = env["client"]("192.0.2.10")
    secret, _ = enroll(env, c1)
    advance(env, seconds=35)
    # 第二个客户端携带 macOS Safari UA 登录
    c2 = env["client"]("192.0.2.20")
    c2.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
            )
        }
    )
    r2 = login(env, c2, totp_code=pyotp.TOTP(secret).at(env["clock"][0]))
    assert r2.status_code == 200
    s2 = r2.json()

    # 确认数据库仅保存受控短标签而非原始 UA
    with Session(env["engine"]) as db:
        stored_uas = list(db.scalars(select(UserSession.user_agent)))
        assert "desktop|macOS|Safari" in stored_uas
        assert all(ua is None or "AppleWebKit" not in ua for ua in stored_uas)

    # 撤销 c1 会话，验证 active_only 过滤
    advance(env, seconds=35)
    reauth = post(
        c2,
        "reverify",
        s2,
        {
            "password": env["password"],
            "totp_code": pyotp.TOTP(secret).at(env["clock"][0]),
        },
    )
    assert reauth.status_code == 200
    s2 = reauth.json()
    advance(env, seconds=60)
    all_sessions = c2.get("/api/v1/auth/sessions").json()
    assert all_sessions["total"] == 2
    current_row = next(item for item in all_sessions["items"] if item["current"])
    assert current_row["device_label"] == "macOS · Safari"
    assert current_row["os"] == "macOS"
    assert current_row["browser"] == "Safari"
    assert current_row["device_type"] == "desktop"
    assert current_row["mfa_reauthenticated"] is True

    other_row = next(item for item in all_sessions["items"] if not item["current"])
    revoked = c2.delete(
        f"/api/v1/auth/sessions/{other_row['id']}",
        headers={"X-CSRF-Token": s2["csrf_token"]},
    )
    assert revoked.status_code == 200

    all_after = c2.get("/api/v1/auth/sessions").json()
    active_after = c2.get("/api/v1/auth/sessions", params={"active_only": True}).json()
    assert all_after["total"] == 2
    assert active_after["total"] == 1
    assert active_after["items"][0]["id"] == current_row["id"]


def test_key_rotation_dry_run_execute_verify_and_rollback_safety(env, signed, monkeypatch, capsys):
    client, state = signed
    # 创建含 password/phone/notes 的账号以及 pending_totp 会话
    acc1 = create(
        signed,
        gmail_email="rotate1@example.test",
        password="synthetic-rotate-pass-1",
        phone="+12025550199",
        notes="sensitive-rotate-note-1",
    )
    acc2 = create(
        signed,
        gmail_email="rotate2@example.test",
        password="synthetic-rotate-pass-2",
        phone=None,
        notes=None,
    )
    # 触发一个带 pending_totp 的会话
    reauth = post(client, "reverify", state, {"password": env["password"]})
    assert reauth.status_code == 200
    state.update(reauth.json())
    with Session(env["engine"]) as db:
        admin = db.scalar(select(AdminUser))
        admin_totp_secret = admin.totp_secret_ciphertext
        assert admin_totp_secret is not None

    # 挂载第二版密钥 data_key_v2，保留 v1
    key_dir = env["settings"].data_key_directory
    (key_dir / "data_key_v2").write_bytes(os.urandom(32))
    env["settings"].active_data_key_version = 2
    encryption = EncryptionService(key_dir, 2)

    # 1. dry-run 不改数据库
    dry = rotate_data_keys(env["engine"], encryption, dry_run=True)
    assert dry["dry_run"] is True
    assert dry["target_version"] == 2
    assert dry["pending_fields"] >= 5  # 2 passwords + 1 phone + 1 notes + 1 totp_secret
    assert dry["rotated_fields"] == 0

    # 2. 实际小批次轮换（batch_size=1 验证多批次游标）
    result = rotate_data_keys(env["engine"], encryption, batch_size=1)
    assert result["verified"] is True
    assert result["target_version"] == 2
    assert result["rotated_fields"] >= 5
    assert result["version_counts"] == {"v2": result["checked_fields"]}

    # 3. 核对业务 row_version 未被篡改、所有数据用 v2 解密还原一致、旧密钥文件保留未被删除
    assert (key_dir / "data_key_v1").is_file()
    with Session(env["engine"]) as db:
        row1 = db.get(GmailAccount, acc1["id"])
        row2 = db.get(GmailAccount, acc2["id"])
        assert row1.row_version == acc1["row_version"]
        assert row2.row_version == acc2["row_version"]
        assert row1.password_key_version == 2
        assert row1.phone_key_version == 2
        assert row1.notes_key_version == 2
        assert row2.password_key_version == 2
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditEvent)
                .where(AuditEvent.event_type == "data_keys_rotated")
            )
            == 1
        )

    # 4. verify-keys 校验通过；要求旧版本 v1 时检测到版本不匹配
    v_ok = verify_data_keys(env["engine"], encryption, require_version=2)
    assert v_ok["valid"] is True and v_ok["failed_fields"] == 0
    v_mismatch = verify_data_keys(env["engine"], encryption, require_version=1)
    assert (
        v_mismatch["valid"] is False and v_mismatch["mismatched_fields"] == v_ok["checked_fields"]
    )

    # 5. CLI 封装入口（rotate-keys 幂等 + verify-keys + 错误退出码）
    assert rotate_keys_cli(env["engine"], env["settings"], dry_run=True)["pending_fields"] == 0
    assert verify_keys_cli(env["engine"], env["settings"], require_version=2)["valid"] is True

    monkeypatch.setattr("app.cli.Settings", lambda: env["settings"])
    monkeypatch.setattr("app.cli.create_database_engine", lambda _s: env["engine"])
    monkeypatch.setattr(env["engine"], "dispose", lambda: None)
    assert cli_main(["rotate-keys", "--dry-run"]) == 0
    assert cli_main(["verify-keys", "--require-version", "2"]) == 0
    assert cli_main(["verify-keys", "--require-version", "1"]) == 1
    out = capsys.readouterr().out
    assert "synthetic-rotate-pass-1" not in out
    assert "sensitive-rotate-note-1" not in out
