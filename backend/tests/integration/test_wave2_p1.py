"""Wave 2 P1 集成测试：带密码流式加密导出（Step-Up/槽位/零落盘/离线解密）与多维安全聚合接口。"""

import csv
import io
import tempfile
from pathlib import Path

import pyotp
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_accounts import create, request
from test_accounts import signed as signed
from test_auth import advance, enroll, post

from app.cli import decrypt_export_cli
from app.core.export_crypto import MAGIC, decrypt_stream
from app.models import AuditEvent

pytestmark = pytest.mark.integration

EXPORT_PASSPHRASE = "ocean velvet lantern compass 2026!"


def _reverify_with_totp(env, client, state, secret):
    advance(env, seconds=35)
    res = post(
        client,
        "reverify",
        state,
        {
            "password": env["password"],
            "totp_code": pyotp.TOTP(secret).at(env["clock"][0]),
        },
    )
    assert res.status_code == 200, res.text
    state.update(res.json())
    return state


def test_encrypted_export_requires_step_up_mfa_and_streams_cleanly(env, tmp_path, monkeypatch):
    client = env["client"]("192.0.2.30")
    secret, confirmed = enroll(env, client)
    state = confirmed["session"]

    def headers():
        return {"X-CSRF-Token": state["csrf_token"]}

    # 创建含敏感密码、手机号与备注的账号（包含公式字符 = / + 验证不被篡改）
    created = client.post(
        "/api/v1/accounts",
        json={
            "gmail_email": "vault.secret@gmail.com",
            "password": "=RawPass+123@Vault!",
            "recovery_email_external": "backup@example.test",
            "phone": "+86 13900008888",
            "notes": "+private note line",
            "status": "normal",
            "two_factor_status": "enabled",
        },
        headers=headers(),
    )
    assert created.status_code == 201, created.text

    # 1. 未完成最近 Step-Up 拒绝导出
    no_reauth = client.post(
        "/api/v1/exports/encrypted",
        json={"scope": "all", "passphrase": EXPORT_PASSPHRASE},
        headers=headers(),
    )
    assert no_reauth.status_code == 403
    assert no_reauth.json()["error"]["code"] == "REAUTH_REQUIRED"

    # 2. 仅密码 reverify（无 TOTP）仍拒绝加密导出（强制 MFA Step-Up）
    pwd_only = post(client, "reverify", state, {"password": env["password"]})
    assert pwd_only.status_code == 200
    state.update(pwd_only.json())
    no_mfa = client.post(
        "/api/v1/exports/encrypted",
        json={"scope": "all", "passphrase": EXPORT_PASSPHRASE},
        headers=headers(),
    )
    assert no_mfa.status_code == 403
    assert no_mfa.json()["error"]["code"] == "REAUTH_REQUIRED"

    # 3. 完成密码 + TOTP Step-Up
    _reverify_with_totp(env, client, state, secret)

    # 4. 禁止复用管理员登录密码作为导出加密口令 / 拒绝弱口令
    reuse = client.post(
        "/api/v1/exports/encrypted",
        json={"scope": "all", "passphrase": env["password"]},
        headers=headers(),
    )
    assert reuse.status_code == 422
    weak = client.post(
        "/api/v1/exports/encrypted",
        json={"scope": "all", "passphrase": "short"},
        headers=headers(),
    )
    assert weak.status_code == 422

    # 5. 并发导出槽位满载返回 429 EXPORT_BUSY
    app_sem = client.app.state.export_semaphore
    assert app_sem.acquire(blocking=False)
    assert app_sem.acquire(blocking=False)
    try:
        busy = client.post(
            "/api/v1/exports/encrypted",
            json={"scope": "all", "passphrase": EXPORT_PASSPHRASE},
            headers=headers(),
        )
        assert busy.status_code == 429
        assert busy.json()["error"]["code"] == "EXPORT_BUSY"
    finally:
        app_sem.release()
        app_sem.release()

    # 6. 正常流式加密导出：零明文落盘、Cache-Control: no-store、响应体不含明文
    before_tmp = set(Path(tempfile.gettempdir()).glob("*"))
    resp = client.post(
        "/api/v1/exports/encrypted",
        json={"scope": "all", "passphrase": EXPORT_PASSPHRASE},
        headers=headers(),
    )
    after_tmp = set(Path(tempfile.gettempdir()).glob("*"))
    assert resp.status_code == 200
    assert resp.headers["cache-control"] == "no-store"
    assert ".gmenc" in resp.headers["content-disposition"]
    assert resp.content.startswith(MAGIC)
    assert b"=RawPass+123@Vault!" not in resp.content
    assert b"+86 13900008888" not in resp.content
    assert before_tmp == after_tmp

    # 7. 流式解密校验全部字段字节级还原
    plain = b"".join(decrypt_stream([resp.content], EXPORT_PASSPHRASE))
    rows = list(csv.DictReader(io.StringIO(plain.decode("utf-8-sig"))))
    assert len(rows) == 1
    assert rows[0]["gmail_email"] == "vault.secret@gmail.com"
    assert rows[0]["password"] == "=RawPass+123@Vault!"
    assert rows[0]["phone"] == "+86 13900008888"
    assert rows[0]["notes"] == "+private note line"

    # 8. CLI decrypt-export 离线解密验证
    enc_path = tmp_path / "vault.gmenc"
    out_path = tmp_path / "vault.csv"
    enc_path.write_bytes(resp.content)
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    monkeypatch.setattr("sys.stderr.isatty", lambda: True)
    cli_res = decrypt_export_cli(enc_path, out_path, read_password=lambda _: EXPORT_PASSPHRASE)
    assert cli_res["ok"] is True
    assert out_path.read_bytes() == plain

    # 9. 审计记录写入 sensitive_exported（不含密码或导出口令）
    with Session(env["engine"]) as db:
        events = db.scalars(
            select(AuditEvent).where(AuditEvent.event_type == "sensitive_exported")
        ).all()
        assert len(events) == 1
        assert events[0].event_metadata == {"operation": "encrypted-csv"}


def test_dashboard_analytics_endpoints_global_aggregates(env, signed):
    client, state = signed
    t1 = client.post(
        "/api/v1/tags", json={"name": "主力"}, headers={"X-CSRF-Token": state["csrf_token"]}
    ).json()
    t2 = client.post(
        "/api/v1/tags", json={"name": "备用"}, headers={"X-CSRF-Token": state["csrf_token"]}
    ).json()

    now = env["clock"][0]
    prev_month = (now.replace(day=15) - __import__("datetime").timedelta(days=35)).isoformat()
    old_year = (now.replace(day=15) - __import__("datetime").timedelta(days=400)).isoformat()

    create(
        signed,
        gmail_email="a1@gmail.com",
        status="normal",
        two_factor_status="enabled",
        tag_ids=[t1["id"], t2["id"]],
        registered_at=now.isoformat(),
        recovery_email_external="r1@example.test",
    )
    create(
        signed,
        gmail_email="a2@gmail.com",
        status="restricted",
        two_factor_status="disabled",
        tag_ids=[t1["id"]],
        registered_at=prev_month,
        recovery_email_external="r1@example.test",
    )
    create(
        signed,
        gmail_email="a3@gmail.com",
        status="archived",
        two_factor_status="unknown",
        registered_at=old_year,
        recovery_email_external="r2@example.test",
    )
    deleted = create(
        signed,
        gmail_email="a4@gmail.com",
        status="normal",
        two_factor_status="enabled",
        tag_ids=[t1["id"]],
        registered_at=now.isoformat(),
        recovery_email_external="r3@example.test",
    )
    request(signed, "DELETE", "/" + deleted["id"], {"row_version": deleted["row_version"]})

    # 1. 注册趋势（含窗口之前历史基数累计，排除软删除）
    trend = client.get(
        "/api/v1/dashboard/registration-trend",
        params={"timezone": "Asia/Shanghai", "months": 6},
    )
    assert trend.status_code == 200
    assert trend.headers["cache-control"] == "no-store"
    tdata = trend.json()
    assert len(tdata["items"]) == 6
    assert tdata["items"][-1]["cumulative"] == 3
    assert sum(p["count"] for p in tdata["items"]) == 2  # old_year 计入前置累计基数

    # 2. 状态、2FA 与高频标签全局分布
    dist = client.get("/api/v1/dashboard/status-distribution")
    assert dist.status_code == 200
    ddata = dist.json()
    assert ddata["total"] == 3
    status_map = {item["status"]: item["count"] for item in ddata["statuses"]}
    assert status_map == {
        "normal": 1,
        "pending_verification": 0,
        "restricted": 1,
        "login_failed": 0,
        "disabled": 0,
        "archived": 1,
    }
    factor_map = {item["two_factor_status"]: item["count"] for item in ddata["two_factor"]}
    assert factor_map == {"enabled": 1, "disabled": 1, "unknown": 1}
    assert [(t["name"], t["count"]) for t in ddata["top_tags"]] == [("主力", 2), ("备用", 1)]

    # 3. 辅助邮箱 Top N 聚合 + 长尾 others_count
    rec = client.get("/api/v1/dashboard/recovery-email-usage", params={"limit": 1})
    assert rec.status_code == 200
    rdata = rec.json()
    assert rdata["total_accounts"] == 3
    assert rdata["total_recovery_emails"] == 2
    assert len(rdata["items"]) == 1
    assert rdata["items"][0]["email"] == "r1@example.test"
    assert rdata["items"][0]["account_count"] == 2
    assert rdata["others_count"] == 1
