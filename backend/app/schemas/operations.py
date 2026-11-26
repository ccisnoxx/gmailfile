from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, Field, SecretStr, field_validator, model_validator

from app.core.security import (
    MAX_ADMIN_PASSWORD_LENGTH,
    MIN_ADMIN_PASSWORD_LENGTH,
    validate_new_admin_password,
)
from app.schemas.accounts import AccountQuery, Input, Timestamp

CsvField = Literal[
    "account_no",
    "gmail_email",
    "password",
    "registered_at",
    "recovery_email",
    "recovery_account",
    "phone",
    "status",
    "two_factor_status",
    "last_login_at",
    "last_verified_at",
    "password_changed_at",
    "purpose",
    "tags",
    "notes",
]


class CsvOptions(Input):
    mapping: dict[CsvField, int] | None = None
    strategy: Literal["skip", "update", "error"] = "skip"
    skip_empty_fields: bool = False

    @model_validator(mode="after")
    def valid_mapping(self) -> Self:
        if self.mapping is not None:
            values = list(self.mapping.values())
            if len(set(values)) != len(values) or any(v < 0 for v in values):
                raise ValueError("映射列不能重复或小于零")
        return self


class CsvIssue(BaseModel):
    row: int
    field: CsvField | Literal["file", "row", "row_version"]
    reason: str


class CsvRow(BaseModel):
    row: int
    action: Literal["create", "update", "skip", "error"]


class CsvColumn(BaseModel):
    index: int
    suggested_field: CsvField | None


class CsvPreview(BaseModel):
    receipt_id: UUID | None
    expires_at: datetime | None
    mapping: dict[CsvField, int]
    strategy: Literal["skip", "update", "error"]
    skip_empty_fields: bool = False
    columns: list[CsvColumn]
    rows: list[CsvRow]
    errors: list[CsvIssue]


class CsvCommit(BaseModel):
    status: Literal["committed", "rejected"]
    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[CsvIssue] = Field(default_factory=list)


class ExportInput(Input):
    scope: Literal["all", "filtered"]
    filters: AccountQuery | None = None

    @model_validator(mode="after")
    def scope_valid(self) -> Self:
        if (self.scope == "filtered") != (self.filters is not None):
            raise ValueError("筛选导出必须提供筛选，全部导出不接受筛选")
        return self


class EncryptedExportInput(ExportInput):
    passphrase: SecretStr = Field(
        min_length=MIN_ADMIN_PASSWORD_LENGTH, max_length=MAX_ADMIN_PASSWORD_LENGTH
    )

    @field_validator("passphrase")
    @classmethod
    def check_passphrase_strength(cls, value: SecretStr) -> SecretStr:
        validate_new_admin_password(value.get_secret_value())
        return value


class SessionItem(BaseModel):
    id: UUID
    current: bool
    state: Literal["valid", "idle_expired", "absolute_expired", "revoked"]
    auth_level: Literal["authenticated", "mfa_pending"]
    created_at: Timestamp
    last_seen_at: Timestamp
    expires_at: Timestamp
    idle_expires_at: Timestamp
    revoked_at: Timestamp | None
    ip_address: str | None
    device_label: str = "未知设备"
    browser: str = "Unknown"
    os: str = "Unknown"
    device_type: Literal["desktop", "mobile", "tablet", "unknown"] = "unknown"
    mfa_reauthenticated: bool = False


class SessionPage(BaseModel):
    items: list[SessionItem]
    total: int
    page: int
    page_size: int


class AuditQuery(Input):
    page: int = Field(default=1, ge=1, le=1000000)
    page_size: int = Field(default=30, ge=1, le=100)
    event_type: str | None = Field(default=None, max_length=64)
    account_id: UUID | None = None
    session_id: UUID | None = None
    created_from: Timestamp | None = None
    created_to: Timestamp | None = None

    @model_validator(mode="after")
    def dates(self) -> Self:
        if self.created_from and self.created_to and self.created_from >= self.created_to:
            raise ValueError("时间范围不正确")
        return self


class AuditItem(BaseModel):
    id: UUID
    seq: int
    event_hash: str
    event_type: str
    account_id: UUID | None
    session_id: UUID | None
    ip_address: str | None
    operation: str | None
    created_at: Timestamp


class AuditPage(BaseModel):
    items: list[AuditItem]
    total: int
    page: int
    page_size: int
    event_types: list[str]


class AuditIntegrityResponse(BaseModel):
    valid: bool
    total_events: int
    latest_seq: int | None
    latest_hash: str | None
    broken_seq: int | None = None
    reason: str | None = None
    retention_days: int


class IdleSetting(Input):
    idle_minutes: int = Field(ge=1, le=720)


class SettingsState(BaseModel):
    idle_minutes: int
    max_idle_minutes: int = 720


class VersionState(BaseModel):
    version: str
    schema_version: str


class BackupStatus(BaseModel):
    state: Literal["unconfigured", "never_run", "running", "success", "failed", "stale"]
    last_attempt_at: Timestamp | None = None
    last_success_at: Timestamp | None = None
    offsite: Literal["unconfigured", "pending", "success", "failed"] = "unconfigured"
