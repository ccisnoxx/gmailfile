"""Session 生命周期管理：Cookie、CSRF/Origin 校验、轮换、预会话与撤销。"""

import secrets
from datetime import timedelta
from uuid import UUID, uuid4

from sqlalchemy import delete, func, update

from app.core.security import random_token, token_hash
from app.models import PreAuthSession, UserSession
from app.schemas.auth import SessionResponse
from app.services.auth.constants import SecurityError
from app.services.auth.context import AuthContext


class SessionManager:
    def __init__(self, ctx: AuthContext):
        self.ctx = ctx

    def check_origin(self) -> None:
        origin = self.ctx.request.headers.get("origin")
        if self.ctx.request.headers.get("sec-fetch-site") in {"cross-site", "same-site"} or (
            origin is not None and origin != self.ctx.settings.app_base_url.rstrip("/")
        ):
            raise SecurityError(403, "CSRF_INVALID", "请求校验失败，请刷新页面后重试")

    def cookie(self, row, secret: str) -> None:
        self.ctx.response.set_cookie(
            self.ctx.cookie_name,
            f"{row.id}.{secret}",
            httponly=True,
            secure=self.ctx.settings.session_cookie_secure,
            samesite="strict",
            path="/",
            max_age=max(0, int((row.expires_at - self.ctx.now).total_seconds())),
        )

    def clear_cookie(self) -> None:
        self.ctx.response.delete_cookie(
            self.ctx.cookie_name,
            secure=self.ctx.settings.session_cookie_secure,
            httponly=True,
            samesite="strict",
            path="/",
        )

    def lookup(self, model):
        value = self.ctx.request.cookies.get(self.ctx.cookie_name, "")
        if len(value) > 128:
            return None
        try:
            selector, secret = value.split(".", 1)
            selector = UUID(selector)
        except (ValueError, AttributeError):
            return None
        row = self.ctx.db.get(model, selector)
        if row is None or not secrets.compare_digest(row.token_hash, token_hash(secret)):
            return None
        if row.expires_at <= self.ctx.now:
            return None
        if isinstance(row, UserSession) and (
            row.revoked_at is not None
            or row.last_seen_at + timedelta(minutes=self.ctx.idle_minutes()) <= self.ctx.now
        ):
            return None
        if (
            isinstance(row, UserSession)
            and self.ctx.settings.totp_required
            and row.auth_level == "authenticated"
            and not self.ctx.has_any_mfa(self.ctx.admin())
        ):
            row.auth_level = "mfa_pending"
            row.reauthenticated_at = None
            row.mfa_reauthenticated_at = None
        return row

    def check_csrf(self, row) -> None:
        self.check_origin()
        token = self.ctx.request.headers.get("x-csrf-token", "")
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
        if touch and self.ctx.request.method != "GET":
            self.ctx.touched_session_id = row.id
        return row

    def persist_activity(self) -> None:
        if self.ctx.touched_session_id is None:
            return
        session_id = self.ctx.touched_session_id
        self.ctx.touched_session_id = None
        self.ctx.db.execute(
            update(UserSession)
            .where(UserSession.id == session_id, UserSession.revoked_at.is_(None))
            .values(last_seen_at=func.greatest(UserSession.last_seen_at, self.ctx.now))
        )

    def require_recent(self, row: UserSession, *, require_mfa: bool = False) -> None:
        window = timedelta(minutes=self.ctx.settings.reauth_window_minutes)
        if row.reauthenticated_at is None or row.reauthenticated_at + window <= self.ctx.now:
            raise SecurityError(403, "REAUTH_REQUIRED", "请先重新验证管理员身份")
        if require_mfa:
            admin = self.ctx.admin()
            if (
                admin is not None
                and self.ctx.has_any_mfa(admin)
                and (
                    row.mfa_reauthenticated_at is None
                    or row.mfa_reauthenticated_at + window <= self.ctx.now
                )
            ):
                raise SecurityError(
                    403,
                    "REAUTH_REQUIRED",
                    "请先使用管理员密码和 TOTP 验证码或通行密钥完成重新验证",
                )

    def state(self, row, csrf: str) -> SessionResponse:
        authenticated = isinstance(row, UserSession)
        idle_minutes = self.ctx.idle_minutes()
        window = timedelta(minutes=self.ctx.settings.reauth_window_minutes)
        last_seen = (
            max(row.last_seen_at, self.ctx.now)
            if authenticated and self.ctx.touched_session_id == row.id
            else row.last_seen_at
            if authenticated
            else None
        )
        admin = self.ctx.admin()
        webauthn_creds = self.ctx.active_webauthn_credentials(admin.id) if admin is not None else []
        webauthn_count = len(webauthn_creds)
        totp_enabled = bool(admin and admin.totp_enabled)
        has_mfa = totp_enabled or webauthn_count > 0
        step_up_totp = bool(authenticated and self.ctx.settings.step_up_totp_required and has_mfa)
        return SessionResponse(
            idle_timeout_seconds=idle_minutes * 60,
            server_time=self.ctx.now,
            state=row.auth_level if authenticated else "anonymous",
            csrf_token=csrf,
            expires_at=row.expires_at,
            idle_expires_at=min(
                row.expires_at,
                last_seen + timedelta(minutes=idle_minutes),
            )
            if authenticated
            else row.expires_at,
            reauthenticated_until=row.reauthenticated_at + window
            if authenticated and row.reauthenticated_at
            else None,
            mfa_reauthenticated_until=row.mfa_reauthenticated_at + window
            if authenticated and getattr(row, "mfa_reauthenticated_at", None)
            else None,
            step_up_totp_required=step_up_totp,
            totp_enabled=totp_enabled if authenticated else False,
            webauthn_enabled=webauthn_count > 0 if authenticated else False,
            webauthn_count=webauthn_count if authenticated else 0,
            can_passwordless_login=any(c.discoverable for c in webauthn_creds),
        )

    def rotate(
        self,
        row: UserSession,
        *,
        reauthenticated: bool = False,
        mfa_reauthenticated: bool = False,
    ) -> SessionResponse:
        secret, csrf = random_token(), random_token()
        row.token_hash, row.csrf_token_hash = token_hash(secret), token_hash(csrf)
        if reauthenticated:
            row.reauthenticated_at = self.ctx.now
        if mfa_reauthenticated:
            row.mfa_reauthenticated_at = self.ctx.now
        self.cookie(row, secret)
        return self.state(row, csrf)

    def bootstrap(self) -> SessionResponse:
        self.check_origin()
        row = self.lookup(UserSession)
        if row:
            # 刷新轮换 CSRF 不延长闲置或绝对寿命。
            csrf = random_token()
            row.csrf_token_hash = token_hash(csrf)
            return self.state(row, csrf)
        row = self.lookup(PreAuthSession)
        # 清理短期预会话，不删除关联审计的认证会话。
        self.ctx.db.execute(delete(PreAuthSession).where(PreAuthSession.expires_at <= self.ctx.now))
        csrf = random_token()
        if row:
            row.csrf_token_hash = token_hash(csrf)
        else:
            secret = random_token()
            row = PreAuthSession(
                id=uuid4(),
                token_hash=token_hash(secret),
                csrf_token_hash=token_hash(csrf),
                expires_at=self.ctx.now + timedelta(minutes=10),
            )
            self.ctx.db.add(row)
            self.cookie(row, secret)
        return self.state(row, csrf)

    def revoke_others(self, row: UserSession | None = None) -> None:
        query = update(UserSession).where(UserSession.revoked_at.is_(None))
        if row:
            query = query.where(UserSession.id != row.id)
        self.ctx.db.execute(
            query.values(
                revoked_at=self.ctx.now,
                pending_totp_ciphertext=None,
                pending_totp_nonce=None,
                pending_totp_key_version=None,
                pending_totp_expires_at=None,
            )
        )

    @staticmethod
    def clear_pending(row: UserSession) -> None:
        row.pending_totp_ciphertext = row.pending_totp_nonce = None
        row.pending_totp_key_version = row.pending_totp_expires_at = None
