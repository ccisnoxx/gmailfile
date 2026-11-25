"""单管理员认证状态机；所有入口在同一 PostgreSQL 事务锁下执行。"""

import base64
import io
import secrets
from datetime import UTC, datetime, timedelta
from ipaddress import ip_address
from uuid import UUID, uuid4

import pyotp
import qrcode
import qrcode.image.svg
from fastapi import Request, Response
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.encryption import EncryptedValue, EncryptionService
from app.core.security import (
    accepted_totp_step,
    passwords,
    random_token,
    token_hash,
    verify_password,
)
from app.models import (
    AdminRecoveryCode,
    AdminUser,
    AuditEvent,
    AuthThrottle,
    PreAuthSession,
    UserSession,
)
from app.schemas.auth import RecoveryResponse, SessionResponse, SetupResponse

AUTH_LOCK = 720241101


class SecurityError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


AUDIT_EVENTS = {
    "admin_initialized",
    "login_failed",
    "mfa_failed",
    "login_success",
    "password_verified",
    "recovery_code_used",
    "logout",
    "password_reverified",
    "totp_setup_started",
    "totp_bound",
    "recovery_codes_regenerated",
    "admin_password_changed",
    "account_created",
    "account_updated",
    "account_archived",
    "account_deleted",
    "account_restored",
    "password_revealed",
    "password_copied",
    "tag_created",
    "tag_updated",
    "tag_deleted",
    "csv_imported",
    "csv_exported",
    "session_revoked",
    "settings_changed",
}
AUDIT_OPERATIONS = {
    "login",
    "reverify",
    "totp_setup",
    "totp_confirm",
    "recovery_regenerate",
    "password_change",
    "archive",
    "delete",
    "restore",
    "mark-verified",
    "mark-logged-in",
    "tag-deleted",
    "batch-status",
    "batch-tags",
    "csv",
    "revoke-session",
    "revoke-others",
    "idle-timeout",
}


class AuthService:
    def __init__(
        self,
        db: Session,
        settings: Settings,
        encryption: EncryptionService,
        request: Request,
        response: Response,
    ):
        self.db, self.settings, self.encryption = db, settings, encryption
        self.request, self.response = request, response
        self.now = datetime.now(UTC)
        try:
            self.ip = str(ip_address(request.client.host)) if request.client else None
        except ValueError:
            self.ip = None
        self.cookie_name = (
            "__Host-gm_session" if settings.session_cookie_secure else "gm_dev_session"
        )

    def check_origin(self) -> None:
        origin = self.request.headers.get("origin")
        if self.request.headers.get("sec-fetch-site") in {"cross-site", "same-site"} or (
            origin is not None and origin != self.settings.app_base_url.rstrip("/")
        ):
            raise SecurityError(403, "CSRF_INVALID", "请求校验失败，请刷新页面后重试")

    def cookie(self, row, secret: str) -> None:
        self.response.set_cookie(
            self.cookie_name,
            f"{row.id}.{secret}",
            httponly=True,
            secure=self.settings.session_cookie_secure,
            samesite="strict",
            path="/",
            max_age=max(0, int((row.expires_at - self.now).total_seconds())),
        )

    def lookup(self, model):
        value = self.request.cookies.get(self.cookie_name, "")
        if len(value) > 128:
            return None
        try:
            selector, secret = value.split(".", 1)
            selector = UUID(selector)
        except (ValueError, AttributeError):
            return None
        row = self.db.get(model, selector)
        if row is None or not secrets.compare_digest(row.token_hash, token_hash(secret)):
            return None
        if row.expires_at <= self.now:
            return None
        if isinstance(row, UserSession) and (
            row.revoked_at is not None
            or row.last_seen_at + timedelta(minutes=self.idle_minutes()) <= self.now
        ):
            return None
        if (
            isinstance(row, UserSession)
            and self.settings.totp_required
            and row.auth_level == "authenticated"
            and not self.admin().totp_enabled
        ):
            row.auth_level = "mfa_pending"
            row.reauthenticated_at = None
        return row

    def check_csrf(self, row) -> None:
        self.check_origin()
        token = self.request.headers.get("x-csrf-token", "")
        if (
            not token
            or len(token) > 128
            or not secrets.compare_digest(row.csrf_token_hash, token_hash(token))
        ):
            raise SecurityError(403, "CSRF_INVALID", "请求校验失败，请刷新页面后重试")

    def require_session(
        self, *, full: bool = True, csrf: bool = True, touch: bool = True
    ) -> UserSession:
        row = self.lookup(UserSession)
        if row is None:
            raise SecurityError(401, "AUTH_REQUIRED", "会话已失效，请重新登录")
        if csrf:
            self.check_csrf(row)
        if full and row.auth_level != "authenticated":
            raise SecurityError(403, "MFA_REQUIRED", "请先完成二步验证绑定")
        if touch and self.request.method != "GET":
            row.last_seen_at = self.now
        return row

    def require_recent(self, row: UserSession) -> None:
        if row.reauthenticated_at is None or (
            row.reauthenticated_at + timedelta(minutes=self.settings.reauth_window_minutes)
            <= self.now
        ):
            raise SecurityError(403, "REAUTH_REQUIRED", "请先重新验证管理员密码")

    def audit(
        self,
        event: str,
        row: UserSession | None = None,
        *,
        operation: str | None = None,
        account_id: UUID | None = None,
    ):
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

    def clear_failures(self):
        for row in self.buckets():
            row.failures, row.window_started_at, row.blocked_until = 0, self.now, self.now

    def idle_minutes(self) -> int:
        admin = self.admin()
        return (admin.session_idle_minutes if admin else None) or self.settings.session_idle_minutes

    def admin(self) -> AdminUser | None:
        return self.db.scalar(select(AdminUser))

    def check_password(self, admin: AdminUser | None, password: str) -> bool:
        valid, upgraded = verify_password(password, admin.password_hash if admin else None)
        if admin is None:
            return False
        if valid and upgraded:
            admin.password_hash = upgraded
        return valid

    def factor(self, admin: AdminUser, code: str, recovery: str) -> bool:
        if bool(code) == bool(recovery):
            return False
        if recovery:
            # 恢复码拥有 128 bit 随机熵；快速 SHA-256 不削弱低熵密码的 Argon2 策略。
            used = self.db.execute(
                update(AdminRecoveryCode)
                .where(
                    AdminRecoveryCode.admin_user_id == admin.id,
                    AdminRecoveryCode.code_hash == token_hash(recovery).hex(),
                    AdminRecoveryCode.used_at.is_(None),
                )
                .values(used_at=self.now)
                .returning(AdminRecoveryCode.id)
            ).scalar_one_or_none()
            if used is not None:
                self.audit("recovery_code_used")
            return used is not None
        value = EncryptedValue(
            admin.totp_secret_ciphertext, admin.totp_secret_nonce, admin.totp_secret_key_version
        )
        secret = self.encryption.decrypt(value, "admin_user", admin.id, "totp_secret")
        step = accepted_totp_step(secret, code, self.now, admin.totp_last_accepted_step)
        if step is None:
            return False
        admin.totp_last_accepted_step = step
        return True

    def state(self, row, csrf: str) -> SessionResponse:
        authenticated = isinstance(row, UserSession)
        return SessionResponse(
            idle_timeout_seconds=self.idle_minutes() * 60,
            server_time=self.now,
            state=row.auth_level if authenticated else "anonymous",
            csrf_token=csrf,
            expires_at=row.expires_at,
            idle_expires_at=min(
                row.expires_at,
                row.last_seen_at + timedelta(minutes=self.idle_minutes()),
            )
            if authenticated
            else row.expires_at,
            reauthenticated_until=row.reauthenticated_at
            + timedelta(minutes=self.settings.reauth_window_minutes)
            if authenticated and row.reauthenticated_at
            else None,
        )

    def rotate(self, row: UserSession, *, reauthenticated: bool = False) -> SessionResponse:
        secret, csrf = random_token(), random_token()
        row.token_hash, row.csrf_token_hash = token_hash(secret), token_hash(csrf)
        if reauthenticated:
            row.reauthenticated_at = self.now
        self.cookie(row, secret)
        return self.state(row, csrf)

    def session(self) -> SessionResponse:
        self.check_origin()
        row = self.lookup(UserSession)
        if row:
            # 刷新轮换 CSRF 不延长闲置或绝对寿命。
            csrf = random_token()
            row.csrf_token_hash = token_hash(csrf)
            return self.state(row, csrf)
        row = self.lookup(PreAuthSession)
        # 清理短期预会话，不删除关联审计的认证会话。
        self.db.execute(delete(PreAuthSession).where(PreAuthSession.expires_at <= self.now))
        csrf = random_token()
        if row:
            row.csrf_token_hash = token_hash(csrf)
        else:
            secret = random_token()
            row = PreAuthSession(
                id=uuid4(),
                token_hash=token_hash(secret),
                csrf_token_hash=token_hash(csrf),
                expires_at=self.now + timedelta(minutes=10),
            )
            self.db.add(row)
            self.cookie(row, secret)
        return self.state(row, csrf)

    def revoke_others(self, row: UserSession | None = None):
        query = update(UserSession).where(UserSession.revoked_at.is_(None))
        if row:
            query = query.where(UserSession.id != row.id)
        self.db.execute(
            query.values(
                revoked_at=self.now,
                pending_totp_ciphertext=None,
                pending_totp_nonce=None,
                pending_totp_key_version=None,
                pending_totp_expires_at=None,
            )
        )

    def login(self, password: str, code: str, recovery: str) -> SessionResponse:
        pre = self.lookup(PreAuthSession)
        if pre is None:
            raise SecurityError(403, "CSRF_INVALID", "请刷新页面后重试")
        self.check_csrf(pre)
        self.check_throttle("login")
        admin = self.admin()
        if not self.check_password(admin, password):
            self.fail("login")
        level = "mfa_pending"
        if admin.totp_enabled:
            if not self.factor(admin, code, recovery):
                self.fail("login", mfa=True)
            if recovery:
                self.revoke_others()
            else:
                level = "authenticated"
        elif not self.settings.totp_required:
            level = "authenticated"
        self.db.delete(pre)
        row = UserSession(
            id=uuid4(),
            admin_user_id=admin.id,
            auth_level=level,
            last_seen_at=self.now,
            created_at=self.now,
            expires_at=self.now + timedelta(hours=self.settings.session_absolute_hours),
            ip_address=self.ip,
        )
        self.db.add(row)
        result = self.rotate(row)
        self.db.flush()
        self.clear_failures()
        self.audit("login_success" if level == "authenticated" else "password_verified", row)
        return result

    def logout(self):
        row = self.require_session(full=False)
        row.revoked_at = self.now
        self.clear_pending(row)
        self.audit("logout", row)
        self.response.delete_cookie(
            self.cookie_name,
            secure=self.settings.session_cookie_secure,
            httponly=True,
            samesite="strict",
            path="/",
        )

    def reverify(self, password: str) -> SessionResponse:
        row = self.require_session()
        self.check_throttle("reverify")
        if not self.check_password(self.admin(), password):
            self.fail("reverify")
        self.clear_failures()
        self.audit("password_reverified", row)
        return self.rotate(row, reauthenticated=True)

    def setup(self, password: str, code: str, recovery: str) -> SetupResponse:
        row = self.require_session(full=False)
        self.check_throttle("totp_setup")
        admin = self.admin()
        if row.auth_level == "authenticated":
            self.require_recent(row)
            if not self.check_password(admin, password):
                self.fail("totp_setup")
            if admin.totp_enabled and not self.factor(admin, code, recovery):
                self.fail("totp_setup", mfa=True)
            self.clear_failures()
        secret = pyotp.random_base32()
        encrypted = self.encryption.encrypt(secret, "user_session", row.id, "pending_totp")
        row.pending_totp_ciphertext, row.pending_totp_nonce = encrypted.ciphertext, encrypted.nonce
        row.pending_totp_key_version = encrypted.key_version
        row.pending_totp_expires_at = self.now + timedelta(minutes=10)
        uri = pyotp.TOTP(secret).provisioning_uri(
            name="Administrator", issuer_name=self.settings.app_name
        )
        output = io.BytesIO()
        qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage).save(output)
        self.audit("totp_setup_started", row)
        return SetupResponse(
            session=self.state(row, self.request.headers["x-csrf-token"]),
            secret=secret,
            expires_at=row.pending_totp_expires_at,
            qr_data_url="data:image/svg+xml;base64," + base64.b64encode(output.getvalue()).decode(),
        )

    @staticmethod
    def clear_pending(row: UserSession):
        row.pending_totp_ciphertext = row.pending_totp_nonce = None
        row.pending_totp_key_version = row.pending_totp_expires_at = None

    def recovery_codes(self, admin: AdminUser) -> list[str]:
        self.db.execute(
            delete(AdminRecoveryCode).where(AdminRecoveryCode.admin_user_id == admin.id)
        )
        codes = [secrets.token_hex(16) for _ in range(10)]
        self.db.add_all(
            [
                AdminRecoveryCode(admin_user_id=admin.id, code_hash=token_hash(code).hex())
                for code in codes
            ]
        )
        return codes

    def confirm(self, code: str) -> RecoveryResponse:
        row = self.require_session(full=False)
        if row.auth_level == "authenticated":
            self.require_recent(row)
        self.check_throttle("totp_confirm")
        if row.pending_totp_expires_at is None or row.pending_totp_expires_at <= self.now:
            raise SecurityError(403, "SETUP_REQUIRED", "绑定已过期，请重新开始绑定")
        secret = self.encryption.decrypt(
            EncryptedValue(
                row.pending_totp_ciphertext, row.pending_totp_nonce, row.pending_totp_key_version
            ),
            "user_session",
            row.id,
            "pending_totp",
        )
        step = accepted_totp_step(secret, code, self.now, None)
        if step is None:
            self.fail("totp_confirm", mfa=True)
        admin = self.admin()
        encrypted = self.encryption.encrypt(secret, "admin_user", admin.id, "totp_secret")
        admin.totp_secret_ciphertext, admin.totp_secret_nonce = (
            encrypted.ciphertext,
            encrypted.nonce,
        )
        admin.totp_secret_key_version = encrypted.key_version
        admin.totp_enabled, admin.totp_last_accepted_step = True, step
        self.clear_pending(row)
        self.revoke_others(row)
        row.auth_level = "authenticated"
        codes = self.recovery_codes(admin)
        self.clear_failures()
        self.audit("totp_bound", row)
        self.audit("recovery_codes_regenerated", row)
        return RecoveryResponse(session=self.rotate(row), recovery_codes=codes)

    def regenerate(self, password: str, code: str, recovery: str) -> RecoveryResponse:
        row = self.require_session()
        self.require_recent(row)
        self.check_throttle("recovery_regenerate")
        admin = self.admin()
        if not self.check_password(admin, password):
            self.fail("recovery_regenerate")
        if admin.totp_enabled and not self.factor(admin, code, recovery):
            self.fail("recovery_regenerate", mfa=True)
        codes = self.recovery_codes(admin)
        self.revoke_others(row)
        self.clear_failures()
        self.audit("recovery_codes_regenerated", row)
        return RecoveryResponse(
            session=self.rotate(row, reauthenticated=True), recovery_codes=codes
        )

    def change_password(self, password: str, new_password: str):
        row = self.require_session()
        self.require_recent(row)
        self.check_throttle("password_change")
        admin = self.admin()
        if not self.check_password(admin, password):
            self.fail("password_change")
        admin.password_hash = passwords.hash(new_password)
        admin.password_changed_at = self.now
        self.revoke_others()
        self.clear_failures()
        self.audit("admin_password_changed", row)
        self.response.delete_cookie(
            self.cookie_name,
            secure=self.settings.session_cookie_secure,
            httponly=True,
            samesite="strict",
            path="/",
        )
