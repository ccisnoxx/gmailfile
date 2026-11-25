"""认证状态机：登录、登出、重新验证与管理员改密状态流转。"""

from datetime import timedelta
from uuid import uuid4

from app.core.security import passwords
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
        if admin.totp_enabled:
            if not self.totp.verify_factor(admin, code, recovery):
                self.ctx.fail("login", mfa=True)
            if recovery:
                self.sessions.revoke_others()
            else:
                level = "authenticated"
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

    def reverify(self, password: str) -> SessionResponse:
        row = self.sessions.require_session()
        self.ctx.check_throttle("reverify")
        if not self.ctx.check_password(self.ctx.admin(), password):
            self.ctx.fail("reverify")
        self.ctx.clear_failures()
        self.ctx.audit("password_reverified", row)
        return self.sessions.rotate(row, reauthenticated=True)

    def change_password(self, password: str, new_password: str) -> None:
        row = self.sessions.require_session()
        self.sessions.require_recent(row)
        self.ctx.check_throttle("password_change")
        admin = self.ctx.admin()
        if not self.ctx.check_password(admin, password):
            self.ctx.fail("password_change")
        admin.password_hash = passwords.hash(new_password)
        admin.password_changed_at = self.ctx.now
        self.sessions.revoke_others()
        self.ctx.clear_failures()
        self.ctx.audit("admin_password_changed", row)
        self.sessions.clear_cookie()
