"""认证状态机：登录、登出、重新验证与管理员改密状态流转。"""

from datetime import timedelta
from uuid import uuid4

from app.core.security import passwords, validate_new_admin_password
from app.models import PreAuthSession, UserSession
from app.schemas.auth import SessionResponse
from app.services.auth.constants import SecurityError
from app.services.auth.context import AuthContext
from app.services.auth.session_manager import SessionManager
from app.services.auth.totp_manager import TotpManager


class AuthStateMachine:
    def __init__(self, ctx: AuthContext, sessions: SessionManager, totp: TotpManager):
        self.ctx = ctx
        self.sessions = sessions
        self.totp = totp

    def login(self, password: str, code: str, recovery: str) -> SessionResponse:
        pre = self.sessions.lookup(PreAuthSession)
        if pre is None:
            raise SecurityError(403, "CSRF_INVALID", "请刷新页面后重试")
        self.sessions.check_csrf(pre)
        self.ctx.check_throttle("login")
        admin = self.ctx.admin()
        if not self.ctx.check_password(admin, password):
            self.ctx.fail("login")
        level = "mfa_pending"
        webauthn_active = len(self.ctx.active_webauthn_credentials(admin.id)) > 0
        if admin.totp_enabled:
            if not self.totp.verify_factor(admin, code, recovery):
                self.ctx.fail("login", mfa=True)
            if recovery:
                self.sessions.revoke_others()
            else:
                level = "authenticated"
        elif webauthn_active:
            # 仅启用 Passkey 且停用 TOTP 时，密码表单仅允许凭一次性恢复码进入受限重绑态；
            # 日常无密码登录请使用 /api/v1/auth/webauthn/login/*。
            if not recovery or not self.totp.verify_factor(admin, "", recovery):
                self.ctx.fail("login", mfa=True)
            self.sessions.revoke_others()
        elif not self.ctx.settings.totp_required:
            level = "authenticated"
        self.ctx.db.delete(pre)
        row = UserSession(
            id=uuid4(),
            admin_user_id=admin.id,
            auth_level=level,
            last_seen_at=self.ctx.now,
            created_at=self.ctx.now,
            expires_at=self.ctx.now + timedelta(hours=self.ctx.settings.session_absolute_hours),
            ip_address=self.ctx.ip,
            user_agent=self.ctx.device_tag,
        )
        self.ctx.db.add(row)
        result = self.sessions.rotate(row)
        self.ctx.db.flush()
        self.ctx.clear_failures()
        self.ctx.audit("login_success" if level == "authenticated" else "password_verified", row)
        return result

    def logout(self) -> None:
        row = self.sessions.require_session(full=False)
        row.revoked_at = self.ctx.now
        self.sessions.clear_pending(row)
        self.ctx.audit("logout", row)
        self.sessions.clear_cookie()

    def reverify(self, password: str, totp_code: str = "") -> SessionResponse:
        row = self.sessions.require_session()
        self.ctx.check_throttle("reverify")
        admin = self.ctx.admin()
        if not self.ctx.check_password(admin, password):
            self.ctx.fail("reverify")
        mfa_verified = False
        need_mfa = bool(totp_code) or (
            self.ctx.settings.step_up_totp_required and admin.totp_enabled
        )
        if need_mfa:
            if (
                not admin.totp_enabled
                or not totp_code
                or not self.totp.verify_factor(admin, totp_code, "")
            ):
                self.ctx.fail("reverify", mfa=True)
            mfa_verified = True
        self.ctx.clear_failures()
        self.ctx.audit("password_reverified", row, operation="reverify")
        return self.sessions.rotate(row, reauthenticated=True, mfa_reauthenticated=mfa_verified)

    def change_password(self, password: str, new_password: str) -> None:
        row = self.sessions.require_session()
        self.sessions.require_recent(row, require_mfa=self.ctx.settings.step_up_totp_required)
        self.ctx.check_throttle("password_change")
        admin = self.ctx.admin()
        if not self.ctx.check_password(admin, password):
            self.ctx.fail("password_change")
        try:
            validate_new_admin_password(
                new_password, denylist_file=self.ctx.settings.password_denylist_file
            )
        except ValueError as exc:
            raise SecurityError(422, "WEAK_PASSWORD", str(exc)) from None
        if new_password == password:
            raise SecurityError(422, "WEAK_PASSWORD", "新密码不能与当前密码相同")
        admin.password_hash = passwords.hash(new_password)
        admin.password_changed_at = self.ctx.now
        self.sessions.revoke_others()
        self.ctx.clear_failures()
        self.ctx.audit("admin_password_changed", row, operation="password_change")
        self.sessions.clear_cookie()
