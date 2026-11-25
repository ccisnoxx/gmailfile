from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr

from app.core.security import MIN_ADMIN_PASSWORD_LENGTH


class AuthInput(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class Credentials(AuthInput):
    password: SecretStr = Field(min_length=1, max_length=1024)
    totp_code: SecretStr = Field(default=SecretStr(""), max_length=64)
    recovery_code: SecretStr = Field(default=SecretStr(""), max_length=128)


class SetupInput(AuthInput):
    password: SecretStr = Field(default=SecretStr(""), max_length=1024)
    totp_code: SecretStr = Field(default=SecretStr(""), max_length=64)
    recovery_code: SecretStr = Field(default=SecretStr(""), max_length=128)


class ConfirmInput(AuthInput):
    code: SecretStr = Field(min_length=1, max_length=64)


class ReverifyInput(AuthInput):
    password: SecretStr = Field(min_length=1, max_length=1024)


class ChangePasswordInput(ReverifyInput):
    new_password: SecretStr = Field(min_length=MIN_ADMIN_PASSWORD_LENGTH, max_length=1024)


class SessionResponse(BaseModel):
    idle_timeout_seconds: int
    server_time: datetime
    state: Literal["anonymous", "mfa_pending", "authenticated"]
    csrf_token: str
    expires_at: datetime
    idle_expires_at: datetime
    reauthenticated_until: datetime | None = None


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
