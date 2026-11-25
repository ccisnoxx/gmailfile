"""认证请求上下文：管理员查询、密码校验、失败退避与审计记录。"""

from datetime import datetime, timedelta
from ipaddress import ip_address
from uuid import UUID

from fastapi import Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.encryption import EncryptionService
from app.core.security import token_hash, verify_password
from app.models import AdminUser, AuditEvent, AuthThrottle, UserSession
from app.services.auth.constants import AUDIT_EVENTS, AUDIT_OPERATIONS, SecurityError


class AuthContext:
    def __init__(
        self,
        db: Session,
        settings: Settings,
        encryption: EncryptionService,
        request: Request,
        response: Response,
        now: datetime,
    ):
        self.db, self.settings, self.encryption = db, settings, encryption
        self.request, self.response = request, response
        self.now = now
        self.touched_session_id: UUID | None = None
        try:
            self.ip = str(ip_address(request.client.host)) if request.client else None
        except ValueError:
            self.ip = None
        self.cookie_name = (
            "__Host-gm_session" if settings.session_cookie_secure else "gm_dev_session"
        )

    def admin(self) -> AdminUser | None:
        return self.db.scalar(select(AdminUser))

    def idle_minutes(self) -> int:
        admin = self.admin()
        return (admin.session_idle_minutes if admin else None) or self.settings.session_idle_minutes

    def check_password(self, admin: AdminUser | None, password: str) -> bool:
        valid, upgraded = verify_password(password, admin.password_hash if admin else None)
        if admin is None:
            return False
        if valid and upgraded:
            admin.password_hash = upgraded
        return valid

    def audit(
        self,
        event: str,
        row: UserSession | None = None,
        *,
        operation: str | None = None,
        account_id: UUID | None = None,
    ) -> None:
        # 不接受任意 metadata 或请求体；只写内部定义的事件与操作名称。
        if event not in AUDIT_EVENTS or (
            operation is not None and operation not in AUDIT_OPERATIONS
        ):
            raise ValueError("未定义的审计事件或操作")
        self.db.add(
            AuditEvent(
                event_type=event,
                account_id=account_id,
                session_id=row.id if row else None,
                ip_address=self.ip,
                event_metadata={"operation": operation} if operation else {},
            )
        )

    def buckets(self) -> list[AuthThrottle]:
        keys = ["admin", "ip:" + token_hash(self.ip or "unknown").hex()]
        rows = []
        for key in keys:
            row = self.db.get(AuthThrottle, key)
            if row is None:
                row = AuthThrottle(
                    key=key, failures=0, window_started_at=self.now, blocked_until=self.now
                )
                self.db.add(row)
            elif (
                self.now >= row.window_started_at + timedelta(minutes=15)
                and row.blocked_until <= self.now
            ):
                row.failures, row.window_started_at, row.blocked_until = 0, self.now, self.now
            rows.append(row)
        return rows

    def check_throttle(self, operation: str) -> None:
        if any(row.blocked_until > self.now for row in self.buckets()):
            self.audit("login_failed", operation=operation)
            raise SecurityError(429, "AUTH_FAILED", "验证失败或暂时受限，请稍后重试")

    def fail(self, operation: str, *, mfa: bool = False):
        for row in self.buckets():
            row.failures += 1
            seconds = 900 if row.failures >= 5 else 2 ** (row.failures - 1)
            row.blocked_until = self.now + timedelta(seconds=seconds)
        self.audit("mfa_failed" if mfa else "login_failed", operation=operation)
        raise SecurityError(401, "AUTH_FAILED", "验证失败或暂时受限，请稍后重试")

    def clear_failures(self) -> None:
        for row in self.buckets():
            row.failures, row.window_started_at, row.blocked_until = 0, self.now, self.now
