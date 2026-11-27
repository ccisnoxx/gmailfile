"""Passkey-only 状态下 TOTP 绑定与确认必须校验既有 MFA 的服务层回归测试。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pyotp
import pytest
from starlette.requests import Request
from starlette.responses import Response

from app.core.encryption import EncryptionService
from app.core.security import passwords, random_token, token_hash
from app.models import AdminUser, AdminWebAuthnCredential, AuthThrottle, UserSession
from app.services.auth.constants import SecurityError
from app.services.auth.context import AuthContext
from app.services.auth.session_manager import SessionManager
from app.services.auth.state_machine import AuthStateMachine
from app.services.auth.totp_manager import TotpManager


class _FakeAuthDB:
    """轻量内存仓储替身，仅承载认证状态机与 TOTP 绑定所需的对象查询和写入。"""

    def __init__(
        self,
        admin: AdminUser,
        session: UserSession,
        webauthn_creds: list[AdminWebAuthnCredential],
    ) -> None:
        self.admin = admin
        self.sessions = {session.id: session}
        self.webauthn_creds = list(webauthn_creds)
        self.throttles: dict[str, AuthThrottle] = {}
        self.added: list[object] = []

    def scalar(self, _stmt):
        return self.admin

    def scalars(self, _stmt):
        return [c for c in self.webauthn_creds if c.revoked_at is None]

    def get(self, model, key):
        if model is UserSession:
            return self.sessions.get(key)
        if model is AuthThrottle:
            return self.throttles.get(key)
        return None

    def add(self, obj: object) -> None:
        if isinstance(obj, AuthThrottle):
            self.throttles[obj.key] = obj
        elif isinstance(obj, UserSession):
            self.sessions[obj.id] = obj
        self.added.append(obj)

    def add_all(self, objs: list[object]) -> None:
        self.added.extend(objs)

    def execute(self, _stmt):
        return SimpleNamespace(scalar_one_or_none=lambda: None)

    def flush(self) -> None:
        return None

    def delete(self, _obj: object) -> None:
        return None


def _build_passkey_only_harness(settings, *, auth_level: str = "authenticated"):
    password = "AdminStrongPassword#2026!"
    now = datetime(2026, 11, 27, 12, 0, tzinfo=UTC)
    admin = AdminUser(
        id=uuid4(),
        singleton=True,
        password_hash=passwords.hash(password),
        totp_enabled=False,
        password_changed_at=now,
    )
    cred = AdminWebAuthnCredential(
        id=uuid4(),
        admin_user_id=admin.id,
        credential_id=b"passkey-credential-0001",
        public_key=b"cose-public-key-placeholder-bytes",
        sign_count=1,
        label="MacBook Touch ID",
        transports=["internal"],
        discoverable=True,
        backup_eligible=True,
        backup_state=True,
        created_at=now,
    )
    raw_secret = random_token()
    raw_csrf = random_token()
    session = UserSession(
        id=uuid4(),
        admin_user_id=admin.id,
        token_hash=token_hash(raw_secret),
        csrf_token_hash=token_hash(raw_csrf),
        auth_level=auth_level,
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(hours=12),
    )
    db = _FakeAuthDB(admin, session, [cred])
    encryption = EncryptionService(settings.data_key_directory, settings.active_data_key_version)

    state = {"cookie": f"{session.id}.{raw_secret}", "csrf": raw_csrf, "now": now}

    def make_services():
        cookie_name = "__Host-gm_session" if settings.session_cookie_secure else "gm_dev_session"
        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/auth/totp/setup",
            "client": ("198.51.100.10", 54321),
            "headers": [
                (b"cookie", f"{cookie_name}={state['cookie']}".encode()),
                (b"x-csrf-token", state["csrf"].encode()),
                (b"origin", settings.app_base_url.rstrip("/").encode()),
                (b"sec-fetch-site", b"same-origin"),
            ],
        }
        req = Request(scope)
        resp = Response()
        ctx = AuthContext(db, settings, encryption, req, resp, state["now"])
        sessions = SessionManager(ctx)
        totp = TotpManager(ctx, sessions)
        machine = AuthStateMachine(ctx, sessions, totp)

        def sync_tokens(session_resp) -> None:
            for header_name, header_val in resp.raw_headers:
                if header_name.lower() == b"set-cookie":
                    cookie_pair = header_val.decode().split(";", 1)[0]
                    state["cookie"] = cookie_pair.split("=", 1)[1]
            state["csrf"] = session_resp.csrf_token

        return ctx, sessions, totp, machine, sync_tokens

    return password, admin, session, state, make_services


def test_passkey_only_password_reverify_cannot_bind_totp_without_passkey_step_up(settings):
    settings.step_up_totp_required = True
    password, admin, session, state, make_services = _build_passkey_only_harness(settings)

    # 1. 仅凭管理员密码完成普通 reverify：更新 reauthenticated_at，但未完成 MFA Step-Up
    _, sessions, totp, machine, sync = make_services()
    reauth_resp = machine.reverify(password)
    sync(reauth_resp)
    assert reauth_resp.reauthenticated_until is not None
    assert reauth_resp.mfa_reauthenticated_until is None

    # 2. 同一会话调用强制 MFA 检查与 TOTP setup 均必须被 REAUTH_REQUIRED 拦截
    _, sessions, totp, _, _ = make_services()
    with pytest.raises(SecurityError) as mfa_check:
        sessions.require_recent(session, require_mfa=True)
    assert mfa_check.value.status == 403
    assert mfa_check.value.code == "REAUTH_REQUIRED"

    with pytest.raises(SecurityError) as setup_err:
        totp.setup(password, "", "")
    assert setup_err.value.status == 403
    assert setup_err.value.code == "REAUTH_REQUIRED"
    assert session.pending_totp_ciphertext is None
    assert admin.totp_enabled is False

    # 3. 完成 Passkey Step-Up 后可发起 setup；但若确认前 MFA 窗口过期，仅靠密码重验仍不能 confirm
    _, sessions, _, _, sync = make_services()
    step_up_resp = sessions.rotate(session, reauthenticated=True, mfa_reauthenticated=True)
    sync(step_up_resp)

    _, _, totp, _, _ = make_services()
    setup_ok = totp.setup(password, "", "")
    assert session.pending_totp_ciphertext is not None

    # 推进 6 分钟使 MFA Step-Up 过期（pending_totp 10 分钟尚未过期），再仅用密码 reverify
    state["now"] = state["now"] + timedelta(minutes=6)
    _, _, _, machine, sync = make_services()
    pwd_only_resp = machine.reverify(password)
    sync(pwd_only_resp)

    _, _, totp, _, _ = make_services()
    code = pyotp.TOTP(setup_ok.secret).at(state["now"])
    with pytest.raises(SecurityError) as confirm_err:
        totp.confirm(code)
    assert confirm_err.value.status == 403
    assert confirm_err.value.code == "REAUTH_REQUIRED"
    assert admin.totp_enabled is False

    # 4. 重新完成 Passkey Step-Up 后，setup + confirm 正常绑定并生成 10 个恢复码
    _, sessions, _, _, sync = make_services()
    step_up_resp2 = sessions.rotate(session, reauthenticated=True, mfa_reauthenticated=True)
    sync(step_up_resp2)

    _, _, totp, _, _ = make_services()
    setup_ok2 = totp.setup(password, "", "")
    code2 = pyotp.TOTP(setup_ok2.secret).at(state["now"])
    confirmed = totp.confirm(code2)
    assert admin.totp_enabled is True
    assert len(confirmed.recovery_codes) == 10


def test_mfa_pending_recovery_session_can_still_complete_totp_rebind(settings):
    settings.step_up_totp_required = True
    _, admin, _, state, make_services = _build_passkey_only_harness(
        settings, auth_level="mfa_pending"
    )
    _, _, totp, _, _ = make_services()
    setup_resp = totp.setup("", "", "")
    code = pyotp.TOTP(setup_resp.secret).at(state["now"])
    confirmed = totp.confirm(code)
    assert admin.totp_enabled is True
    assert confirmed.session.state == "authenticated"
    assert len(confirmed.recovery_codes) == 10
