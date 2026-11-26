"""TOTP 与一次性恢复码管理：二步验证、绑定确认与恢复码重生成。"""

import base64
import io
import secrets
from datetime import timedelta

import pyotp
import qrcode
import qrcode.image.svg
from sqlalchemy import delete, update

from app.core.encryption import EncryptedValue
from app.core.security import accepted_totp_step, token_hash
from app.models import AdminRecoveryCode, AdminUser
from app.schemas.auth import RecoveryResponse, SetupResponse
from app.services.auth.constants import SecurityError
from app.services.auth.context import AuthContext
from app.services.auth.session_manager import SessionManager


class TotpManager:
    def __init__(self, ctx: AuthContext, sessions: SessionManager):
        self.ctx = ctx
        self.sessions = sessions

    def verify_factor(self, admin: AdminUser, code: str, recovery: str) -> bool:
        if bool(code) == bool(recovery):
            return False
        if recovery:
            # 恢复码拥有 128 bit 随机熵；快速 SHA-256 不削弱低熵密码的 Argon2 策略。
            used = self.ctx.db.execute(
                update(AdminRecoveryCode)
                .where(
                    AdminRecoveryCode.admin_user_id == admin.id,
                    AdminRecoveryCode.code_hash == token_hash(recovery).hex(),
                    AdminRecoveryCode.used_at.is_(None),
                )
                .values(used_at=self.ctx.now)
                .returning(AdminRecoveryCode.id)
            ).scalar_one_or_none()
            if used is not None:
                self.ctx.audit("recovery_code_used")
            return used is not None
        value = EncryptedValue(
            admin.totp_secret_ciphertext, admin.totp_secret_nonce, admin.totp_secret_key_version
        )
        secret = self.ctx.encryption.decrypt(value, "admin_user", admin.id, "totp_secret")
        step = accepted_totp_step(secret, code, self.ctx.now, admin.totp_last_accepted_step)
        if step is None:
            return False
        admin.totp_last_accepted_step = step
        return True

    def generate_recovery_codes(self, admin: AdminUser) -> list[str]:
        self.ctx.db.execute(
            delete(AdminRecoveryCode).where(AdminRecoveryCode.admin_user_id == admin.id)
        )
        codes = [secrets.token_hex(16) for _ in range(10)]
        self.ctx.db.add_all(
            [
                AdminRecoveryCode(admin_user_id=admin.id, code_hash=token_hash(code).hex())
                for code in codes
            ]
        )
        return codes

    def setup(self, password: str, code: str, recovery: str) -> SetupResponse:
        row = self.sessions.require_session(full=False)
        self.ctx.check_throttle("totp_setup")
        admin = self.ctx.admin()
        if row.auth_level == "authenticated":
            self.sessions.require_recent(row)
            if not self.ctx.check_password(admin, password):
                self.ctx.fail("totp_setup")
            if admin.totp_enabled and not self.verify_factor(admin, code, recovery):
                self.ctx.fail("totp_setup", mfa=True)
            self.ctx.clear_failures()
        secret = pyotp.random_base32()
        encrypted = self.ctx.encryption.encrypt(secret, "user_session", row.id, "pending_totp")
        row.pending_totp_ciphertext, row.pending_totp_nonce = encrypted.ciphertext, encrypted.nonce
        row.pending_totp_key_version = encrypted.key_version
        row.pending_totp_expires_at = self.ctx.now + timedelta(minutes=10)
        uri = pyotp.TOTP(secret).provisioning_uri(
            name="Administrator", issuer_name=self.ctx.settings.app_name
        )
        output = io.BytesIO()
        qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage).save(output)
        self.ctx.audit("totp_setup_started", row)
        return SetupResponse(
            session=self.sessions.state(row, self.ctx.request.headers["x-csrf-token"]),
            secret=secret,
            expires_at=row.pending_totp_expires_at,
            qr_data_url="data:image/svg+xml;base64," + base64.b64encode(output.getvalue()).decode(),
        )

    def confirm(self, code: str) -> RecoveryResponse:
        row = self.sessions.require_session(full=False)
        if row.auth_level == "authenticated":
            self.sessions.require_recent(row)
        self.ctx.check_throttle("totp_confirm")
        if row.pending_totp_expires_at is None or row.pending_totp_expires_at <= self.ctx.now:
            raise SecurityError(403, "SETUP_REQUIRED", "绑定已过期，请重新开始绑定")
        secret = self.ctx.encryption.decrypt(
            EncryptedValue(
                row.pending_totp_ciphertext, row.pending_totp_nonce, row.pending_totp_key_version
            ),
            "user_session",
            row.id,
            "pending_totp",
        )
        step = accepted_totp_step(secret, code, self.ctx.now, None)
        if step is None:
            self.ctx.fail("totp_confirm", mfa=True)
        admin = self.ctx.admin()
        encrypted = self.ctx.encryption.encrypt(secret, "admin_user", admin.id, "totp_secret")
        admin.totp_secret_ciphertext, admin.totp_secret_nonce = (
            encrypted.ciphertext,
            encrypted.nonce,
        )
        admin.totp_secret_key_version = encrypted.key_version
        admin.totp_enabled, admin.totp_last_accepted_step = True, step
        self.sessions.clear_pending(row)
        self.sessions.revoke_others(row)
        row.auth_level = "authenticated"
        codes = self.generate_recovery_codes(admin)
        self.ctx.clear_failures()
        self.ctx.audit("totp_bound", row)
        self.ctx.audit("recovery_codes_regenerated", row)
        return RecoveryResponse(session=self.sessions.rotate(row), recovery_codes=codes)

    def regenerate(self, password: str, code: str, recovery: str) -> RecoveryResponse:
        row = self.sessions.require_session()
        self.sessions.require_recent(row)
        self.ctx.check_throttle("recovery_regenerate")
        admin = self.ctx.admin()
        if not self.ctx.check_password(admin, password):
            self.ctx.fail("recovery_regenerate")
        if admin.totp_enabled and not self.verify_factor(admin, code, recovery):
            self.ctx.fail("recovery_regenerate", mfa=True)
        if not admin.totp_enabled and self.ctx.has_any_mfa(admin):
            # 仅启用 WebAuthn 时，重生成恢复码要求最近完成 Passkey Step-Up（或提供有效恢复码）。
            if recovery:
                if not self.verify_factor(admin, "", recovery):
                    self.ctx.fail("recovery_regenerate", mfa=True)
            else:
                self.sessions.require_recent(row, require_mfa=True)
        codes = self.generate_recovery_codes(admin)
        self.sessions.revoke_others(row)
        self.ctx.clear_failures()
        self.ctx.audit("recovery_codes_regenerated", row)
        return RecoveryResponse(
            session=self.sessions.rotate(
                row,
                reauthenticated=True,
                mfa_reauthenticated=bool(
                    (code and admin.totp_enabled) or (not admin.totp_enabled and not recovery)
                ),
            ),
            recovery_codes=codes,
        )
