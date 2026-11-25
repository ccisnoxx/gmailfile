import hashlib
import secrets
from datetime import datetime

import pyotp
from pwdlib import PasswordHash

from app.core.password_policy import (
    MAX_ADMIN_PASSWORD_LENGTH,
    MIN_ADMIN_PASSWORD_LENGTH,
    validate_new_admin_password,
)

passwords = PasswordHash.recommended()
# 未初始化管理员也执行相同的密码验证成本；不保存可用的 Bootstrap 凭据。
_dummy_hash = passwords.hash(secrets.token_urlsafe(32))

__all__ = [
    "MAX_ADMIN_PASSWORD_LENGTH",
    "MIN_ADMIN_PASSWORD_LENGTH",
    "accepted_totp_step",
    "passwords",
    "random_token",
    "token_hash",
    "validate_new_admin_password",
    "verify_password",
]


def verify_password(password: str, password_hash: str | None) -> tuple[bool, str | None]:
    return passwords.verify_and_update(password, password_hash or _dummy_hash)


def random_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def accepted_totp_step(secret: str, code: str, now: datetime, last_step: int | None) -> int | None:
    try:
        step = pyotp.TOTP(secret).verify_and_get_timecode(code, for_time=now, valid_window=1)
    except pyotp.OTPVerificationError:
        return None
    return step if last_step is None or step > last_step else None
