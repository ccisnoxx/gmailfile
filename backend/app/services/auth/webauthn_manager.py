"""WebAuthn/FIDO2 凭证注册、无密码/二步登录、高风险 Step-Up 与 TOTP 可替代边界管理。"""

from __future__ import annotations

import json
import secrets
from datetime import timedelta
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from sqlalchemy import delete, select, update
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.exceptions import WebAuthnException
from webauthn.helpers.structs import (
    AttestationConveyancePreference,
    AuthenticatorSelectionCriteria,
    AuthenticatorTransport,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.models import (
    AdminUser,
    AdminWebAuthnCredential,
    PreAuthSession,
    UserSession,
    WebAuthnChallenge,
)
from app.schemas.auth import (
    DisableTotpResponse,
    SessionResponse,
    WebAuthnChallengeResponse,
    WebAuthnCredentialItem,
    WebAuthnRegisterVerifyResponse,
)
from app.services.auth.constants import SecurityError
from app.services.auth.context import AuthContext
from app.services.auth.session_manager import SessionManager
from app.services.auth.totp_manager import TotpManager

CHALLENGE_TTL_MINUTES = 5
MAX_WEBAUTHN_CREDENTIALS = 16
ALLOWED_TRANSPORTS: frozenset[str] = frozenset(
    {"usb", "nfc", "ble", "smart-card", "hybrid", "internal"}
)


class WebAuthnManager:
    def __init__(self, ctx: AuthContext, sessions: SessionManager, totp: TotpManager):
        self.ctx = ctx
        self.sessions = sessions
        self.totp = totp

    @property
    def rp_id(self) -> str:
        parsed = urlsplit(self.ctx.settings.app_base_url)
        if not parsed.hostname:
            raise SecurityError(500, "CONFIG_INVALID", "站点主机配置无效")
        return parsed.hostname

    @property
    def expected_origin(self) -> str:
        return self.ctx.settings.app_base_url.rstrip("/")

    @staticmethod
    def _serialize_item(row: AdminWebAuthnCredential) -> WebAuthnCredentialItem:
        return WebAuthnCredentialItem(
            id=row.id,
            label=row.label,
            transports=list(row.transports or []),
            discoverable=row.discoverable,
            backup_eligible=row.backup_eligible,
            backup_state=row.backup_state,
            created_at=row.created_at,
            last_used_at=row.last_used_at,
        )

    def _cleanup_expired_challenges(self) -> None:
        self.ctx.db.execute(
            delete(WebAuthnChallenge).where(WebAuthnChallenge.expires_at <= self.ctx.now)
        )

    def _descriptors(
        self, credentials: list[AdminWebAuthnCredential]
    ) -> list[PublicKeyCredentialDescriptor]:
        result: list[PublicKeyCredentialDescriptor] = []
        for cred in credentials:
            transports: list[AuthenticatorTransport] = []
            for t in cred.transports or []:
                if t in ALLOWED_TRANSPORTS:
                    try:
                        transports.append(AuthenticatorTransport(t))
                    except ValueError:
                        continue
            result.append(
                PublicKeyCredentialDescriptor(
                    id=bytes(cred.credential_id),
                    transports=transports or None,
                )
            )
        return result

    def _consume_challenge(
        self,
        challenge_id: UUID,
        purpose: str,
        *,
        pre_auth_session_id: UUID | None = None,
        user_session_id: UUID | None = None,
    ) -> bytes:
        stmt = (
            update(WebAuthnChallenge)
            .where(
                WebAuthnChallenge.id == challenge_id,
                WebAuthnChallenge.purpose == purpose,
                WebAuthnChallenge.consumed_at.is_(None),
                WebAuthnChallenge.expires_at > self.ctx.now,
            )
            .values(consumed_at=self.ctx.now)
            .returning(WebAuthnChallenge.challenge)
        )
        if pre_auth_session_id is not None:
            stmt = stmt.where(WebAuthnChallenge.pre_auth_session_id == pre_auth_session_id)
        if user_session_id is not None:
            stmt = stmt.where(WebAuthnChallenge.user_session_id == user_session_id)
        raw = self.ctx.db.execute(stmt).scalar_one_or_none()
        if raw is None:
            raise SecurityError(403, "CHALLENGE_INVALID", "验证挑战已过期或已被使用，请重试")
        return bytes(raw)

    def list_credentials(self) -> list[WebAuthnCredentialItem]:
        self.sessions.require_session(csrf=False, touch=False)
        admin = self.ctx.admin()
        if admin is None:
            return []
        return [self._serialize_item(row) for row in self.ctx.active_webauthn_credentials(admin.id)]

    def register_options(self) -> WebAuthnChallengeResponse:
        row = self.sessions.require_session(full=False)
        admin = self.ctx.admin()
        if admin is None:
            raise SecurityError(401, "AUTH_REQUIRED", "管理员未初始化")
        existing = self.ctx.active_webauthn_credentials(admin.id)
        if len(existing) >= MAX_WEBAUTHN_CREDENTIALS:
            raise SecurityError(409, "WEBAUTHN_LIMIT_REACHED", "通行密钥数量已达上限")
        if row.auth_level == "authenticated":
            self.sessions.require_recent(row, require_mfa=self.ctx.settings.step_up_totp_required)

        self._cleanup_expired_challenges()
        challenge_bytes = secrets.token_bytes(32)
        expires_at = self.ctx.now + timedelta(minutes=CHALLENGE_TTL_MINUTES)
        challenge_row = WebAuthnChallenge(
            id=uuid4(),
            purpose="register",
            challenge=challenge_bytes,
            user_session_id=row.id,
            expires_at=expires_at,
        )
        self.ctx.db.add(challenge_row)

        options = generate_registration_options(
            rp_id=self.rp_id,
            rp_name=self.ctx.settings.app_name,
            user_name="Administrator",
            user_display_name="Administrator",
            user_id=admin.id.bytes,
            challenge=challenge_bytes,
            timeout=CHALLENGE_TTL_MINUTES * 60 * 1000,
            attestation=AttestationConveyancePreference.NONE,
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.REQUIRED,
                user_verification=UserVerificationRequirement.REQUIRED,
            ),
            exclude_credentials=self._descriptors(existing),
        )
        return WebAuthnChallengeResponse(
            challenge_id=challenge_row.id,
            options=json.loads(options_to_json(options)),
            expires_at=expires_at,
        )

    def register_verify(
        self, challenge_id: UUID, label: str, credential: dict
    ) -> WebAuthnRegisterVerifyResponse:
        row = self.sessions.require_session(full=False)
        self.ctx.check_throttle("webauthn_register")
        admin = self.ctx.admin()
        if admin is None:
            raise SecurityError(401, "AUTH_REQUIRED", "管理员未初始化")
        if row.auth_level == "authenticated":
            self.sessions.require_recent(row, require_mfa=self.ctx.settings.step_up_totp_required)
        existing = self.ctx.active_webauthn_credentials(admin.id)
        if len(existing) >= MAX_WEBAUTHN_CREDENTIALS:
            raise SecurityError(409, "WEBAUTHN_LIMIT_REACHED", "通行密钥数量已达上限")

        expected_challenge = self._consume_challenge(
            challenge_id, "register", user_session_id=row.id
        )
        try:
            verified = verify_registration_response(
                credential=credential,
                expected_challenge=expected_challenge,
                expected_rp_id=self.rp_id,
                expected_origin=self.expected_origin,
                require_user_presence=True,
                require_user_verification=True,
            )
        except (WebAuthnException, ValueError, KeyError, TypeError):
            self.ctx.fail("webauthn_register", mfa=True)

        duplicate = self.ctx.db.scalar(
            select(AdminWebAuthnCredential.id).where(
                AdminWebAuthnCredential.credential_id == verified.credential_id
            )
        )
        if duplicate is not None:
            raise SecurityError(409, "WEBAUTHN_DUPLICATE", "该通行密钥已绑定")

        raw_transports = (credential.get("response") or {}).get("transports") or []
        clean_transports = sorted(
            {t for t in raw_transports if isinstance(t, str) and t in ALLOWED_TRANSPORTS}
        )
        aaguid = str(verified.aaguid)[:36] if verified.aaguid else None

        cred_row = AdminWebAuthnCredential(
            id=uuid4(),
            admin_user_id=admin.id,
            credential_id=bytes(verified.credential_id),
            public_key=bytes(verified.credential_public_key),
            sign_count=verified.sign_count,
            label=label.strip(),
            transports=clean_transports,
            aaguid=aaguid,
            discoverable=True,
            backup_eligible=verified.credential_device_type.value == "multi_device",
            backup_state=bool(verified.credential_backed_up),
            created_at=self.ctx.now,
        )
        self.ctx.db.add(cred_row)
        self.ctx.db.flush()

        recovery_codes: list[str] | None = None
        if row.auth_level != "authenticated":
            row.auth_level = "authenticated"
            self.sessions.revoke_others(row)
            recovery_codes = self.totp.generate_recovery_codes(admin)
            self.ctx.audit("recovery_codes_regenerated", row)
            session_resp = self.sessions.rotate(row)
        else:
            session_resp = self.sessions.state(row, self.ctx.request.headers["x-csrf-token"])

        self.ctx.clear_failures()
        self.ctx.audit("webauthn_registered", row, operation="webauthn_register")
        return WebAuthnRegisterVerifyResponse(
            credential=self._serialize_item(cred_row),
            session=session_resp,
            recovery_codes=recovery_codes,
        )

    def rename_credential(self, credential_id: UUID, label: str) -> WebAuthnCredentialItem:
        row = self.sessions.require_session()
        admin = self.ctx.admin()
        cred = self.ctx.db.get(AdminWebAuthnCredential, credential_id)
        if cred is None or admin is None or cred.admin_user_id != admin.id or cred.revoked_at:
            raise SecurityError(404, "WEBAUTHN_NOT_FOUND", "通行密钥不存在")
        cred.label = label.strip()
        self.ctx.audit("webauthn_renamed", row, operation="webauthn_rename")
        return self._serialize_item(cred)

    def delete_credential(self, credential_id: UUID) -> None:
        row = self.sessions.require_session()
        self.sessions.require_recent(row, require_mfa=self.ctx.settings.step_up_totp_required)
        admin = self.ctx.admin()
        cred = self.ctx.db.get(AdminWebAuthnCredential, credential_id)
        if cred is None or admin is None or cred.admin_user_id != admin.id or cred.revoked_at:
            raise SecurityError(404, "WEBAUTHN_NOT_FOUND", "通行密钥不存在")
        active = self.ctx.active_webauthn_credentials(admin.id)
        if not admin.totp_enabled and len(active) <= 1:
            raise SecurityError(
                409,
                "LAST_MFA_FACTOR",
                "至少需保留一种二步验证方式；删除最后一个通行密钥前请先重新启用 TOTP",
            )
        cred.revoked_at = self.ctx.now
        self.ctx.audit("webauthn_revoked", row, operation="webauthn_revoke")

    def _find_and_verify_assertion(
        self,
        admin: AdminUser,
        expected_challenge: bytes,
        credential: dict,
        operation: str,
        session_row: UserSession | None = None,
    ) -> AdminWebAuthnCredential:
        raw_id = credential.get("rawId") or credential.get("id")
        if not isinstance(raw_id, str) or not raw_id or len(raw_id) > 2048:
            self.ctx.fail(operation, mfa=True)
        try:
            cred_id_bytes = base64url_to_bytes(raw_id)
        except Exception:
            self.ctx.fail(operation, mfa=True)

        cred_row = self.ctx.db.scalar(
            select(AdminWebAuthnCredential).where(
                AdminWebAuthnCredential.admin_user_id == admin.id,
                AdminWebAuthnCredential.credential_id == cred_id_bytes,
                AdminWebAuthnCredential.revoked_at.is_(None),
            )
        )
        if cred_row is None:
            self.ctx.fail(operation, mfa=True)

        try:
            # 传入 0 让库先完成密码学验签/origin/rp_id/UV 校验，
            # 再由下方统一执行防克隆计数检查与审计落库。
            verified = verify_authentication_response(
                credential=credential,
                expected_challenge=expected_challenge,
                expected_rp_id=self.rp_id,
                expected_origin=self.expected_origin,
                credential_public_key=bytes(cred_row.public_key),
                credential_current_sign_count=0,
                require_user_verification=True,
            )
        except (WebAuthnException, ValueError, KeyError, TypeError):
            self.ctx.fail(operation, mfa=True)

        # 防克隆回滚检查：若已记录非零 sign_count 且认证器未单调递增，标记克隆嫌疑并拒绝。
        if cred_row.sign_count > 0 and verified.new_sign_count <= cred_row.sign_count:
            self.ctx.audit("webauthn_clone_suspected", session_row, operation=operation)
            self.ctx.fail(operation, mfa=True)

        cred_row.sign_count = verified.new_sign_count
        cred_row.backup_state = bool(verified.credential_backed_up)
        cred_row.last_used_at = self.ctx.now
        return cred_row

    def login_options(self) -> WebAuthnChallengeResponse:
        pre = self.sessions.lookup(PreAuthSession)
        if pre is None:
            raise SecurityError(403, "CSRF_INVALID", "请刷新页面后重试")
        self.sessions.check_csrf(pre)
        self.ctx.check_throttle("webauthn_login")
        admin = self.ctx.admin()
        creds = self.ctx.active_webauthn_credentials(admin.id) if admin else []
        if not creds:
            raise SecurityError(404, "WEBAUTHN_NOT_CONFIGURED", "尚未绑定通行密钥")

        self._cleanup_expired_challenges()
        challenge_bytes = secrets.token_bytes(32)
        expires_at = self.ctx.now + timedelta(minutes=CHALLENGE_TTL_MINUTES)
        challenge_row = WebAuthnChallenge(
            id=uuid4(),
            purpose="login",
            challenge=challenge_bytes,
            pre_auth_session_id=pre.id,
            expires_at=expires_at,
        )
        self.ctx.db.add(challenge_row)

        options = generate_authentication_options(
            rp_id=self.rp_id,
            challenge=challenge_bytes,
            timeout=CHALLENGE_TTL_MINUTES * 60 * 1000,
            allow_credentials=self._descriptors(creds),
            user_verification=UserVerificationRequirement.REQUIRED,
        )
        return WebAuthnChallengeResponse(
            challenge_id=challenge_row.id,
            options=json.loads(options_to_json(options)),
            expires_at=expires_at,
        )

    def login_verify(self, challenge_id: UUID, credential: dict) -> SessionResponse:
        pre = self.sessions.lookup(PreAuthSession)
        if pre is None:
            raise SecurityError(403, "CSRF_INVALID", "请刷新页面后重试")
        self.sessions.check_csrf(pre)
        self.ctx.check_throttle("webauthn_login")
        admin = self.ctx.admin()
        if admin is None:
            self.ctx.fail("webauthn_login", mfa=True)

        expected_challenge = self._consume_challenge(
            challenge_id, "login", pre_auth_session_id=pre.id
        )
        self._find_and_verify_assertion(admin, expected_challenge, credential, "webauthn_login")

        self.ctx.db.delete(pre)
        row = UserSession(
            id=uuid4(),
            admin_user_id=admin.id,
            auth_level="authenticated",
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
        self.ctx.audit("login_success", row, operation="webauthn_login")
        return result

    def step_up_options(self) -> WebAuthnChallengeResponse:
        row = self.sessions.require_session()
        self.ctx.check_throttle("webauthn_step_up")
        admin = self.ctx.admin()
        creds = self.ctx.active_webauthn_credentials(admin.id) if admin else []
        if not creds:
            raise SecurityError(404, "WEBAUTHN_NOT_CONFIGURED", "尚未绑定通行密钥")

        self._cleanup_expired_challenges()
        challenge_bytes = secrets.token_bytes(32)
        expires_at = self.ctx.now + timedelta(minutes=CHALLENGE_TTL_MINUTES)
        challenge_row = WebAuthnChallenge(
            id=uuid4(),
            purpose="step_up",
            challenge=challenge_bytes,
            user_session_id=row.id,
            expires_at=expires_at,
        )
        self.ctx.db.add(challenge_row)

        options = generate_authentication_options(
            rp_id=self.rp_id,
            challenge=challenge_bytes,
            timeout=CHALLENGE_TTL_MINUTES * 60 * 1000,
            allow_credentials=self._descriptors(creds),
            user_verification=UserVerificationRequirement.REQUIRED,
        )
        return WebAuthnChallengeResponse(
            challenge_id=challenge_row.id,
            options=json.loads(options_to_json(options)),
            expires_at=expires_at,
        )

    def step_up_verify(self, challenge_id: UUID, credential: dict) -> SessionResponse:
        row = self.sessions.require_session()
        self.ctx.check_throttle("webauthn_step_up")
        admin = self.ctx.admin()
        if admin is None:
            self.ctx.fail("webauthn_step_up", mfa=True)

        expected_challenge = self._consume_challenge(
            challenge_id, "step_up", user_session_id=row.id
        )
        self._find_and_verify_assertion(
            admin, expected_challenge, credential, "webauthn_step_up", session_row=row
        )
        self.ctx.clear_failures()
        self.ctx.audit("password_reverified", row, operation="webauthn_step_up")
        return self.sessions.rotate(row, reauthenticated=True, mfa_reauthenticated=True)

    def disable_totp(self) -> DisableTotpResponse:
        row = self.sessions.require_session()
        self.sessions.require_recent(row, require_mfa=True)
        admin = self.ctx.admin()
        if admin is None or not admin.totp_enabled:
            raise SecurityError(409, "TOTP_NOT_ENABLED", "当前未启用 TOTP")
        if len(self.ctx.active_webauthn_credentials(admin.id)) < 1:
            raise SecurityError(
                409,
                "LAST_MFA_FACTOR",
                "停用 TOTP 前必须至少绑定一个通行密钥（Passkey）",
            )
        admin.totp_enabled = False
        admin.totp_secret_ciphertext = None
        admin.totp_secret_nonce = None
        admin.totp_secret_key_version = None
        admin.totp_last_accepted_step = None
        self.sessions.revoke_others(row)
        self.ctx.audit("totp_disabled", row, operation="totp_disable")
        return DisableTotpResponse(session=self.sessions.rotate(row))


__all__ = ["WebAuthnManager", "bytes_to_base64url"]
