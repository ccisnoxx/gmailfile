"""Wave 4 P1 集成测试：真实 ECDSA P-256 软件认证器覆盖 WebAuthn 全链路与 CLI 恢复码回退。"""

from __future__ import annotations

import hashlib
import json
import os
import struct
from dataclasses import dataclass, field

import cbor2
import pyotp
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from test_auth import advance, bootstrap, enroll, login, post
from webauthn.helpers import bytes_to_base64url

from app.models import AdminWebAuthnCredential, AuditEvent, WebAuthnChallenge

pytestmark = pytest.mark.integration


@dataclass
class SoftwareAuthenticator:
    """严格遵循 WebAuthn L2/L3 规范的纯软件 P-256 认证器（用于真实密码学验证测试）。"""

    rp_id: str = "testserver"
    origin: str = "http://testserver"
    credential_id: bytes = field(default_factory=lambda: os.urandom(32))
    sign_count: int = 0
    private_key: ec.EllipticCurvePrivateKey = field(
        default_factory=lambda: ec.generate_private_key(ec.SECP256R1())
    )

    def _cose_public_key(self) -> bytes:
        numbers = self.private_key.public_key().public_numbers()
        x = numbers.x.to_bytes(32, "big")
        y = numbers.y.to_bytes(32, "big")
        # COSE Key: kty=2 (EC2), alg=-7 (ES256), crv=1 (P-256), x=-2, y=-3
        return cbor2.dumps({1: 2, 3: -7, -1: 1, -2: x, -3: y})

    def make_registration(self, challenge_b64: str, *, uv: bool = True) -> dict:
        client_data = json.dumps(
            {
                "type": "webauthn.create",
                "challenge": challenge_b64,
                "origin": self.origin,
                "crossOrigin": False,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        rp_hash = hashlib.sha256(self.rp_id.encode("utf-8")).digest()
        # flags: UP(0x01) | UV(0x04 if uv) | BE(0x08) | BS(0x10) | AT(0x40)
        flags = 0x01 | (0x04 if uv else 0x00) | 0x08 | 0x10 | 0x40
        aaguid = b"\x00" * 16
        cose_key = self._cose_public_key()
        attested_cred_data = (
            aaguid + struct.pack(">H", len(self.credential_id)) + self.credential_id + cose_key
        )
        auth_data = rp_hash + struct.pack(">BI", flags, self.sign_count) + attested_cred_data
        attestation_obj = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        cred_id_b64 = bytes_to_base64url(self.credential_id)
        return {
            "id": cred_id_b64,
            "rawId": cred_id_b64,
            "type": "public-key",
            "response": {
                "clientDataJSON": bytes_to_base64url(client_data),
                "attestationObject": bytes_to_base64url(attestation_obj),
                "transports": ["internal", "hybrid"],
            },
        }

    def make_assertion(
        self, challenge_b64: str, *, uv: bool = True, next_count: int | None = None
    ) -> dict:
        self.sign_count = self.sign_count + 1 if next_count is None else next_count
        client_data = json.dumps(
            {
                "type": "webauthn.get",
                "challenge": challenge_b64,
                "origin": self.origin,
                "crossOrigin": False,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        rp_hash = hashlib.sha256(self.rp_id.encode("utf-8")).digest()
        flags = 0x01 | (0x04 if uv else 0x00) | 0x08 | 0x10
        auth_data = rp_hash + struct.pack(">BI", flags, self.sign_count)
        client_hash = hashlib.sha256(client_data).digest()
        signature = self.private_key.sign(auth_data + client_hash, ec.ECDSA(hashes.SHA256()))
        cred_id_b64 = bytes_to_base64url(self.credential_id)
        return {
            "id": cred_id_b64,
            "rawId": cred_id_b64,
            "type": "public-key",
            "response": {
                "clientDataJSON": bytes_to_base64url(client_data),
                "authenticatorData": bytes_to_base64url(auth_data),
                "signature": bytes_to_base64url(signature),
                "userHandle": None,
            },
        }


def test_first_login_passkey_enrollment_passwordless_login_step_up_and_replay_block(env):
    client = env["client"]("192.0.2.40")
    auth = SoftwareAuthenticator()

    # 1. 首次密码登录进入 mfa_pending，不绑定 TOTP 直接绑定首个 Passkey
    state = login(env, client).json()
    assert state["state"] == "mfa_pending"

    reg_opt = post(client, "webauthn/register/options", state)
    assert reg_opt.status_code == 200, reg_opt.text
    challenge_id = reg_opt.json()["challenge_id"]
    challenge_b64 = reg_opt.json()["options"]["challenge"]

    cred_payload = auth.make_registration(challenge_b64, uv=True)
    reg_ver = post(
        client,
        "webauthn/register/verify",
        state,
        {"challenge_id": challenge_id, "label": "MacBook Touch ID", "credential": cred_payload},
    )
    assert reg_ver.status_code == 200, reg_ver.text
    reg_body = reg_ver.json()
    assert reg_body["session"]["state"] == "authenticated"
    assert reg_body["session"]["webauthn_enabled"] is True
    assert reg_body["session"]["webauthn_count"] == 1
    assert reg_body["session"]["can_passwordless_login"] is True
    assert reg_body["credential"]["label"] == "MacBook Touch ID"
    assert len(reg_body["recovery_codes"]) == 10
    recovery_codes = reg_body["recovery_codes"]
    cred_uuid = reg_body["credential"]["id"]
    state = reg_body["session"]

    # 2. 升级为 authenticated 后再次调用注册需重新验证（防未授权追加密钥）
    replay_reg = post(
        client,
        "webauthn/register/verify",
        state,
        {"challenge_id": challenge_id, "label": "Replay", "credential": cred_payload},
    )
    assert replay_reg.status_code == 403
    assert replay_reg.json()["error"]["code"] == "REAUTH_REQUIRED"

    # 3. 列表查询与重命名
    listed = client.get("/api/v1/auth/webauthn/credentials").json()
    assert len(listed) == 1 and listed[0]["id"] == cred_uuid
    renamed = client.patch(
        f"/api/v1/auth/webauthn/credentials/{cred_uuid}",
        json={"label": "主力 MacBook"},
        headers={"X-CSRF-Token": state["csrf_token"]},
    )
    assert renamed.status_code == 200 and renamed.json()["label"] == "主力 MacBook"

    # 4. 新客户端无密码 Passkey 一步登录（Discoverable + UV）
    c2 = env["client"]("192.0.2.41")
    anon = bootstrap(c2)
    assert anon["state"] == "anonymous"
    assert anon["can_passwordless_login"] is True

    login_opt = post(c2, "webauthn/login/options", anon)
    assert login_opt.status_code == 200
    l_cid = login_opt.json()["challenge_id"]
    l_challenge = login_opt.json()["options"]["challenge"]

    # UV=False 必须被拒绝
    no_uv = post(
        c2,
        "webauthn/login/verify",
        anon,
        {"challenge_id": l_cid, "credential": auth.make_assertion(l_challenge, uv=False)},
    )
    assert no_uv.status_code == 401

    # 等待防暴力退避窗口后重新申请挑战并以 UV=True 完成无密码登录
    advance(env, seconds=2)
    login_opt2 = post(c2, "webauthn/login/options", anon)
    assert login_opt2.status_code == 200, login_opt2.text
    l_cid2 = login_opt2.json()["challenge_id"]
    l_ch2 = login_opt2.json()["options"]["challenge"]
    login_ok = post(
        c2,
        "webauthn/login/verify",
        anon,
        {"challenge_id": l_cid2, "credential": auth.make_assertion(l_ch2, uv=True)},
    )
    assert login_ok.status_code == 200, login_ok.text
    s2 = login_ok.json()
    assert s2["state"] == "authenticated"

    # 5. Passkey UV Step-Up 认证 -> 可执行高敏密码查看与导出
    acc = c2.post(
        "/api/v1/accounts",
        json={
            "gmail_email": "passkey.protected@gmail.com",
            "password": "PasskeyProtected#2026",
            "recovery_email_external": "r@example.test",
        },
        headers={"X-CSRF-Token": s2["csrf_token"]},
    ).json()
    # 未 Step-Up 拒绝查看密码
    assert (
        c2.post(
            f"/api/v1/accounts/{acc['id']}/reveal-password",
            json={},
            headers={"X-CSRF-Token": s2["csrf_token"]},
        ).status_code
        == 403
    )
    su_opt = post(c2, "webauthn/step-up/options", s2)
    assert su_opt.status_code == 200
    su_cid = su_opt.json()["challenge_id"]
    su_ch = su_opt.json()["options"]["challenge"]
    su_ok = post(
        c2,
        "webauthn/step-up/verify",
        s2,
        {"challenge_id": su_cid, "credential": auth.make_assertion(su_ch, uv=True)},
    )
    assert su_ok.status_code == 200
    s2 = su_ok.json()
    assert s2["reauthenticated_until"] and s2["mfa_reauthenticated_until"]

    # 重放已消费的 step-up 挑战必须被单次消费机制拒绝（CHALLENGE_INVALID）
    replay_su = post(
        c2,
        "webauthn/step-up/verify",
        s2,
        {"challenge_id": su_cid, "credential": auth.make_assertion(su_ch, uv=True)},
    )
    assert replay_su.status_code == 403
    assert replay_su.json()["error"]["code"] == "CHALLENGE_INVALID"

    revealed = c2.post(
        f"/api/v1/accounts/{acc['id']}/reveal-password",
        json={},
        headers={"X-CSRF-Token": s2["csrf_token"]},
    )
    assert revealed.status_code == 200 and revealed.json()["password"] == "PasskeyProtected#2026"

    # 6. 保护最后一个 MFA 因子：TOTP 未启用时禁止删除唯一 Passkey
    del_last = c2.delete(
        f"/api/v1/auth/webauthn/credentials/{cred_uuid}",
        headers={"X-CSRF-Token": s2["csrf_token"]},
    )
    assert del_last.status_code == 409
    assert del_last.json()["error"]["code"] == "LAST_MFA_FACTOR"

    # 7. 反克隆检测：sign_count 未递增时拒绝并写入 webauthn_clone_suspected 审计
    clone_opt = post(c2, "webauthn/step-up/options", s2)
    clone_ver = post(
        c2,
        "webauthn/step-up/verify",
        s2,
        {
            "challenge_id": clone_opt.json()["challenge_id"],
            "credential": auth.make_assertion(
                clone_opt.json()["options"]["challenge"], uv=True, next_count=3
            ),
        },
    )
    assert clone_ver.status_code == 401
    with Session(env["engine"]) as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditEvent)
                .where(AuditEvent.event_type == "webauthn_clone_suspected")
            )
            == 1
        )

    # 8. 恢复码离线切换兜底（backup_tool.verify_admin_step_up 在 TOTP 停用时消费一次性恢复码）
    import importlib.util
    from pathlib import Path

    spec = importlib.util.spec_from_file_location(
        "backup_tool_mod", Path(__file__).resolve().parents[3] / "scripts" / "backup_tool.py"
    )
    backup_tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backup_tool)
    with env["engine"].connect() as conn:
        raw = conn.connection.driver_connection

        class _TestSchemaConn:
            """测试库使用独立 schema（search_path），将生产硬编码 public. 映射到当前测试 schema。"""

            def execute(self, query, params=None):
                return raw.execute(query.replace("public.", ""), params)

        proxy = _TestSchemaConn()
        assert (
            backup_tool.verify_admin_step_up(
                proxy,
                env["settings"].data_key_directory,
                read_password=lambda _: env["password"],
                read_code=lambda _: recovery_codes[0],
            )
            is True
        )
        raw.commit()
        # 同一恢复码不能二次复用
        with pytest.raises(backup_tool.OperationError):
            backup_tool.verify_admin_step_up(
                proxy,
                env["settings"].data_key_directory,
                read_password=lambda _: env["password"],
                read_code=lambda _: recovery_codes[0],
            )


def test_totp_coexistence_disable_totp_and_delete_secondary_passkey(env):
    client = env["client"]("192.0.2.50")
    secret, confirmed = enroll(env, client)
    state = confirmed["session"]

    # 尚无 Passkey 时禁止停用 TOTP
    advance(env, seconds=35)
    reauth = post(
        client,
        "reverify",
        state,
        {"password": env["password"], "totp_code": pyotp.TOTP(secret).at(env["clock"][0])},
    )
    assert reauth.status_code == 200
    state = reauth.json()
    cant_disable = post(client, "totp/disable", state)
    assert cant_disable.status_code == 409
    assert cant_disable.json()["error"]["code"] == "LAST_MFA_FACTOR"

    # 绑定两把 Passkey 后可停用 TOTP，并允许删除其中一把
    auth1 = SoftwareAuthenticator()
    auth2 = SoftwareAuthenticator()
    ids = []
    for idx, auth in enumerate((auth1, auth2), start=1):
        opt = post(client, "webauthn/register/options", state)
        assert opt.status_code == 200
        ver = post(
            client,
            "webauthn/register/verify",
            state,
            {
                "challenge_id": opt.json()["challenge_id"],
                "label": f"Key-{idx}",
                "credential": auth.make_registration(opt.json()["options"]["challenge"]),
            },
        )
        assert ver.status_code == 200
        ids.append(ver.json()["credential"]["id"])

    disabled = post(client, "totp/disable", state)
    assert disabled.status_code == 200
    state = disabled.json()["session"]
    assert state["totp_enabled"] is False
    assert state["webauthn_enabled"] is True and state["webauthn_count"] == 2

    # 删除第二把密钥成功，剩余 1 把时再删则被 LAST_MFA_FACTOR 阻止
    del1 = client.delete(
        f"/api/v1/auth/webauthn/credentials/{ids[1]}",
        headers={"X-CSRF-Token": state["csrf_token"]},
    )
    assert del1.status_code == 200
    del2 = client.delete(
        f"/api/v1/auth/webauthn/credentials/{ids[0]}",
        headers={"X-CSRF-Token": state["csrf_token"]},
    )
    assert del2.status_code == 409
    assert del2.json()["error"]["code"] == "LAST_MFA_FACTOR"

    with Session(env["engine"]) as db:
        assert db.scalar(select(func.count()).select_from(AdminWebAuthnCredential)) == 2
        assert db.scalar(select(func.count()).select_from(WebAuthnChallenge)) >= 2


def test_webauthn_error_branches_and_recovery_code_login_when_totp_disabled(env):
    from uuid import uuid4

    # 1. 未绑定 Passkey 时 login/options 返回 404 WEBAUTHN_NOT_CONFIGURED
    c_anon = env["client"]("192.0.2.60")
    anon = bootstrap(c_anon)
    assert anon["can_passwordless_login"] is False
    missing_login = post(c_anon, "webauthn/login/options", anon)
    assert missing_login.status_code == 404
    assert missing_login.json()["error"]["code"] == "WEBAUTHN_NOT_CONFIGURED"

    # 2. 登录后未绑定 Passkey 时 step-up/options 返回 404
    c1 = env["client"]("192.0.2.61")
    state = login(env, c1).json()
    assert state["state"] == "mfa_pending"

    # 注册：过期挑战 -> 403 CHALLENGE_INVALID
    opt_exp = post(c1, "webauthn/register/options", state)
    assert opt_exp.status_code == 200
    auth1 = SoftwareAuthenticator()
    advance(env, seconds=310)
    expired_ver = post(
        c1,
        "webauthn/register/verify",
        state,
        {
            "challenge_id": opt_exp.json()["challenge_id"],
            "label": "Expired",
            "credential": auth1.make_registration(opt_exp.json()["options"]["challenge"]),
        },
    )
    assert expired_ver.status_code == 403
    assert expired_ver.json()["error"]["code"] == "CHALLENGE_INVALID"

    # 注册：非法 origin -> 401
    opt_bad = post(c1, "webauthn/register/options", state)
    bad_auth = SoftwareAuthenticator(origin="https://evil.example")
    bad_reg = post(
        c1,
        "webauthn/register/verify",
        state,
        {
            "challenge_id": opt_bad.json()["challenge_id"],
            "label": "EvilOrigin",
            "credential": bad_auth.make_registration(opt_bad.json()["options"]["challenge"]),
        },
    )
    assert bad_reg.status_code == 401
    advance(env, seconds=2)

    # 正常注册首个 Passkey -> 进入 authenticated 并拿到恢复码
    opt_ok = post(c1, "webauthn/register/options", state)
    reg_ok = post(
        c1,
        "webauthn/register/verify",
        state,
        {
            "challenge_id": opt_ok.json()["challenge_id"],
            "label": "PrimaryKey",
            "credential": auth1.make_registration(opt_ok.json()["options"]["challenge"]),
        },
    )
    assert reg_ok.status_code == 200
    state = reg_ok.json()["session"]
    recovery_codes = reg_ok.json()["recovery_codes"]

    # Step-Up 先验证，再测试重复绑定同一 credential_id -> 409 WEBAUTHN_DUPLICATE
    su_opt = post(c1, "webauthn/step-up/options", state)
    su_ok = post(
        c1,
        "webauthn/step-up/verify",
        state,
        {
            "challenge_id": su_opt.json()["challenge_id"],
            "credential": auth1.make_assertion(su_opt.json()["options"]["challenge"], uv=True),
        },
    )
    assert su_ok.status_code == 200
    state = su_ok.json()

    dup_opt = post(c1, "webauthn/register/options", state)
    dup_res = post(
        c1,
        "webauthn/register/verify",
        state,
        {
            "challenge_id": dup_opt.json()["challenge_id"],
            "label": "Duplicate",
            "credential": auth1.make_registration(dup_opt.json()["options"]["challenge"]),
        },
    )
    assert dup_res.status_code == 409
    assert dup_res.json()["error"]["code"] == "WEBAUTHN_DUPLICATE"

    # 重命名/删除不存在的凭证 -> 404 WEBAUTHN_NOT_FOUND
    missing_id = str(uuid4())
    assert (
        c1.patch(
            f"/api/v1/auth/webauthn/credentials/{missing_id}",
            json={"label": "Ghost"},
            headers={"X-CSRF-Token": state["csrf_token"]},
        ).status_code
        == 404
    )
    assert (
        c1.delete(
            f"/api/v1/auth/webauthn/credentials/{missing_id}",
            headers={"X-CSRF-Token": state["csrf_token"]},
        ).status_code
        == 404
    )

    # TOTP 本身未启用时再次停用 -> 409 TOTP_NOT_ENABLED
    already_off = post(c1, "totp/disable", state)
    assert already_off.status_code == 409
    assert already_off.json()["error"]["code"] == "TOTP_NOT_ENABLED"

    # 未知 credential_id / 非法 rawId 断言 -> 401
    unknown_auth = SoftwareAuthenticator()
    u_opt = post(c1, "webauthn/step-up/options", state)
    u_res = post(
        c1,
        "webauthn/step-up/verify",
        state,
        {
            "challenge_id": u_opt.json()["challenge_id"],
            "credential": unknown_auth.make_assertion(u_opt.json()["options"]["challenge"]),
        },
    )
    assert u_res.status_code == 401
    advance(env, seconds=2)

    bad_id_opt = post(c1, "webauthn/step-up/options", state)
    bad_id_res = post(
        c1,
        "webauthn/step-up/verify",
        state,
        {"challenge_id": bad_id_opt.json()["challenge_id"], "credential": {"rawId": ""}},
    )
    assert bad_id_res.status_code == 401
    advance(env, seconds=5)

    # 3. TOTP 停用且仅 Passkey 启用时：密码登录无恢复码被拒，凭恢复码可进入 mfa_pending 重新绑定
    c_rec = env["client"]("192.0.2.62")
    anon_rec = bootstrap(c_rec)
    no_code_login = post(c_rec, "login", anon_rec, {"password": env["password"]})
    assert no_code_login.status_code == 401
    advance(env, seconds=10)
    with_recovery = post(
        c_rec,
        "login",
        anon_rec,
        {"password": env["password"], "recovery_code": recovery_codes[1]},
    )
    assert with_recovery.status_code == 200
    assert with_recovery.json()["state"] == "mfa_pending"
