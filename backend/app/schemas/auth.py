from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from app.core.security import (
    MAX_ADMIN_PASSWORD_LENGTH,
    MIN_ADMIN_PASSWORD_LENGTH,
    validate_new_admin_password,
)


class AuthInput(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class Credentials(AuthInput):
    password: SecretStr = Field(min_length=1, max_length=MAX_ADMIN_PASSWORD_LENGTH)
    totp_code: SecretStr = Field(default=SecretStr(""), max_length=64)
    recovery_code: SecretStr = Field(default=SecretStr(""), max_length=128)


class SetupInput(AuthInput):
    password: SecretStr = Field(default=SecretStr(""), max_length=MAX_ADMIN_PASSWORD_LENGTH)
    totp_code: SecretStr = Field(default=SecretStr(""), max_length=64)
    recovery_code: SecretStr = Field(default=SecretStr(""), max_length=128)


class ConfirmInput(AuthInput):
    code: SecretStr = Field(min_length=1, max_length=64)


class ReverifyInput(AuthInput):
    password: SecretStr = Field(min_length=1, max_length=MAX_ADMIN_PASSWORD_LENGTH)
    totp_code: SecretStr = Field(default=SecretStr(""), max_length=64)


class ChangePasswordInput(AuthInput):
    password: SecretStr = Field(min_length=1, max_length=MAX_ADMIN_PASSWORD_LENGTH)
    new_password: SecretStr = Field(
        min_length=MIN_ADMIN_PASSWORD_LENGTH, max_length=MAX_ADMIN_PASSWORD_LENGTH
    )

    @field_validator("new_password")
    @classmethod
    def check_new_password_strength(cls, value: SecretStr) -> SecretStr:
        validate_new_admin_password(value.get_secret_value())
        return value


class SessionResponse(BaseModel):
    idle_timeout_seconds: int
    server_time: datetime
    state: Literal["anonymous", "mfa_pending", "authenticated"]
    csrf_token: str
    expires_at: datetime
    idle_expires_at: datetime
    reauthenticated_until: datetime | None = None
    mfa_reauthenticated_until: datetime | None = None
    step_up_totp_required: bool = False
    totp_enabled: bool = False
    webauthn_enabled: bool = False
    webauthn_count: int = 0
    can_passwordless_login: bool = False


class SetupResponse(BaseModel):
    session: SessionResponse
    secret: str
    qr_data_url: str
    expires_at: datetime


class RecoveryResponse(BaseModel):
    session: SessionResponse
    recovery_codes: list[str]


class ActionResponse(BaseModel):
    status: Literal["ok"] = "ok"


class WebAuthnCredentialItem(BaseModel):
    id: UUID
    label: str
    transports: list[str]
    discoverable: bool
    backup_eligible: bool
    backup_state: bool
    created_at: datetime
    last_used_at: datetime | None = None


class WebAuthnRegisterOptionsInput(AuthInput):
    label: str = Field(default="通行密钥", min_length=1, max_length=64)


class WebAuthnChallengeResponse(BaseModel):
    challenge_id: UUID
    options: dict[str, Any]
    expires_at: datetime


class WebAuthnRegisterVerifyInput(AuthInput):
    challenge_id: UUID
    label: str = Field(min_length=1, max_length=64, pattern=r"\S")
    credential: dict[str, Any]


class WebAuthnRegisterVerifyResponse(BaseModel):
    credential: WebAuthnCredentialItem
    session: SessionResponse
    recovery_codes: list[str] | None = None


class WebAuthnRenameInput(AuthInput):
    label: str = Field(min_length=1, max_length=64, pattern=r"\S")


class WebAuthnAuthVerifyInput(AuthInput):
    challenge_id: UUID
    credential: dict[str, Any]


class DisableTotpResponse(BaseModel):
    session: SessionResponse
