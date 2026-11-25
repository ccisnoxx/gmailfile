"""单管理员认证服务门面；所有入口在同一 PostgreSQL 事务锁下执行。"""

from datetime import UTC, datetime
from uuid import UUID

from fastapi import Request, Response
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.encryption import EncryptionService
from app.models import AdminUser, AuthThrottle, UserSession
from app.schemas.auth import RecoveryResponse, SessionResponse, SetupResponse
from app.services.auth.constants import (
    AUDIT_EVENTS,
    AUDIT_OPERATIONS,
    AUTH_LOCK,
    SecurityError,
)
from app.services.auth.context import AuthContext
from app.services.auth.session_manager import SessionManager
from app.services.auth.state_machine import AuthStateMachine
from app.services.auth.totp_manager import TotpManager

__all__ = [
    "AUDIT_EVENTS",
    "AUDIT_OPERATIONS",
    "AUTH_LOCK",
    "AuthContext",
    "AuthService",
    "AuthStateMachine",
    "SecurityError",
    "SessionManager",
    "TotpManager",
]


class AuthService:
    """组合认证上下文、Session 管理、TOTP 管理与认证状态机的对外服务。"""

    def __init__(
        self,
        db: Session,
        settings: Settings,
        encryption: EncryptionService,
        request: Request,
        response: Response,
    ):
        self.ctx = AuthContext(db, settings, encryption, request, response, datetime.now(UTC))
        self.sessions = SessionManager(self.ctx)
        self.totp = TotpManager(self.ctx, self.sessions)
        self.machine = AuthStateMachine(self.ctx, self.sessions, self.totp)
        self.db, self.settings, self.encryption = db, settings, encryption
        self.request, self.response = request, response
        self.now, self.ip, self.cookie_name = self.ctx.now, self.ctx.ip, self.ctx.cookie_name

    def check_origin(self) -> None:
        self.sessions.check_origin()

    def cookie(self, row, secret: str) -> None:
        self.sessions.cookie(row, secret)

    def lookup(self, model):
        return self.sessions.lookup(model)

    def check_csrf(self, row) -> None:
        self.sessions.check_csrf(row)

    def require_session(
        self, *, full: bool = True, csrf: bool = True, touch: bool = True
    ) -> UserSession:
        return self.sessions.require_session(full=full, csrf=csrf, touch=touch)

    def persist_activity(self) -> None:
        self.sessions.persist_activity()

    def require_recent(self, row: UserSession, *, require_mfa: bool = False) -> None:
        self.sessions.require_recent(row, require_mfa=require_mfa)

    def audit(
        self,
        event: str,
        row: UserSession | None = None,
        *,
        operation: str | None = None,
        account_id: UUID | None = None,
    ) -> None:
        self.ctx.audit(event, row, operation=operation, account_id=account_id)

    def buckets(self) -> list[AuthThrottle]:
        return self.ctx.buckets()

    def check_throttle(self, operation: str) -> None:
        self.ctx.check_throttle(operation)

    def fail(self, operation: str, *, mfa: bool = False):
        self.ctx.fail(operation, mfa=mfa)

    def clear_failures(self) -> None:
        self.ctx.clear_failures()

    def idle_minutes(self) -> int:
        return self.ctx.idle_minutes()

    def admin(self) -> AdminUser | None:
        return self.ctx.admin()

    def check_password(self, admin: AdminUser | None, password: str) -> bool:
        return self.ctx.check_password(admin, password)

    def factor(self, admin: AdminUser, code: str, recovery: str) -> bool:
        return self.totp.verify_factor(admin, code, recovery)

    def state(self, row, csrf: str) -> SessionResponse:
        return self.sessions.state(row, csrf)

    def rotate(
        self,
        row: UserSession,
        *,
        reauthenticated: bool = False,
        mfa_reauthenticated: bool = False,
    ) -> SessionResponse:
        return self.sessions.rotate(
            row, reauthenticated=reauthenticated, mfa_reauthenticated=mfa_reauthenticated
        )

    def session(self) -> SessionResponse:
        return self.sessions.bootstrap()

    def revoke_others(self, row: UserSession | None = None) -> None:
        self.sessions.revoke_others(row)

    def login(self, password: str, code: str, recovery: str) -> SessionResponse:
        return self.machine.login(password, code, recovery)

    def logout(self) -> None:
        self.machine.logout()

    def reverify(self, password: str, totp_code: str = "") -> SessionResponse:
        return self.machine.reverify(password, totp_code)

    def setup(self, password: str, code: str, recovery: str) -> SetupResponse:
        return self.totp.setup(password, code, recovery)

    @staticmethod
    def clear_pending(row: UserSession) -> None:
        SessionManager.clear_pending(row)

    def recovery_codes(self, admin: AdminUser) -> list[str]:
        return self.totp.generate_recovery_codes(admin)

    def confirm(self, code: str) -> RecoveryResponse:
        return self.totp.confirm(code)

    def regenerate(self, password: str, code: str, recovery: str) -> RecoveryResponse:
        return self.totp.regenerate(password, code, recovery)

    def change_password(self, password: str, new_password: str) -> None:
        self.machine.change_password(password, new_password)
