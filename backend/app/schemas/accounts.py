"""账号边界校验；普通响应采用字段白名单。"""

import re
from datetime import UTC, datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from email_validator import EmailNotValidError, validate_email
from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    field_validator,
    model_validator,
)

Status = Literal[
    "normal", "pending_verification", "restricted", "login_failed", "disabled", "archived"
]
TwoFactor = Literal["unknown", "disabled", "enabled"]


def email_value(value: str) -> str:
    try:
        validate_email(value.strip(), check_deliverability=False, test_environment=True)
    except EmailNotValidError:
        raise ValueError("邮箱格式不正确") from None
    local, domain = value.strip().lower().rsplit("@", 1)
    if domain in {"gmail.com", "googlemail.com"} and not local.split("+", 1)[0].replace(".", ""):
        raise ValueError("邮箱本地部分不能为空")
    return value


def normalize_email(value: str) -> str:
    local, domain = value.strip().lower().rsplit("@", 1)
    if domain in {"gmail.com", "googlemail.com"}:
        local, domain = local.split("+", 1)[0].replace(".", ""), "gmail.com"
    return f"{local}@{domain}"


def phone_value(value: SecretStr) -> SecretStr:
    phone = value.get_secret_value()
    digits = re.sub(r"[+ ()\-]", "", phone)
    if not re.fullmatch(r"\+?[0-9 ()\-]{5,31}", phone) or not 6 <= len(digits) <= 20:
        raise ValueError("手机号格式不正确")
    return value


Email = Annotated[str, Field(min_length=3, max_length=254), AfterValidator(email_value)]
Timestamp = Annotated[AwareDatetime, AfterValidator(lambda value: value.astimezone(UTC))]
Phone = Annotated[SecretStr, AfterValidator(phone_value)]
Password = Annotated[SecretStr, Field(min_length=1, max_length=1024)]
Notes = Annotated[SecretStr, Field(max_length=20000)]
TagIds = Annotated[list[UUID], Field(max_length=100)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class AccountCreate(Input):
    gmail_email: Email
    password: Password
    registered_at: Timestamp = Field(default_factory=lambda: datetime.now(UTC))
    recovery_account_id: UUID | None = None
    recovery_email_external: Email | None = None
    phone: Phone | None = None
    status: Status = "pending_verification"
    two_factor_status: TwoFactor = "unknown"
    purpose: str | None = Field(default=None, max_length=100)
    tag_ids: TagIds = Field(default_factory=list)
    last_login_at: Timestamp | None = None
    last_verified_at: Timestamp | None = None
    password_changed_at: Timestamp | None = None
    notes: Notes | None = None

    @model_validator(mode="after")
    def recovery(self) -> Self:
        if (self.recovery_account_id is None) == (self.recovery_email_external is None):
            raise ValueError("辅助邮箱必须且只能填写一种")
        if self.recovery_email_external is not None and normalize_email(
            self.recovery_email_external
        ) == normalize_email(self.gmail_email):
            raise ValueError("辅助邮箱不能与主邮箱相同")
        return self


class VersionInput(Input):
    row_version: int = Field(ge=1)


class AccountPatch(VersionInput):
    gmail_email: Email | None = None
    password: Password | None = None
    registered_at: Timestamp | None = None
    recovery_account_id: UUID | None = None
    recovery_email_external: Email | None = None
    phone: Phone | None = None
    status: Status | None = None
    two_factor_status: TwoFactor | None = None
    purpose: str | None = Field(default=None, max_length=100)
    tag_ids: TagIds | None = None
    last_login_at: Timestamp | None = None
    last_verified_at: Timestamp | None = None
    password_changed_at: Timestamp | None = None
    notes: Notes | None = None

    @model_validator(mode="after")
    def nonnull(self) -> Self:
        for field in (
            "gmail_email",
            "password",
            "registered_at",
            "status",
            "two_factor_status",
            "tag_ids",
        ):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError("必填字段不能设为空")
        return self


class TagInput(Input):
    name: str = Field(min_length=1, max_length=50, pattern=r"\S")


class TagResponse(BaseModel):
    id: UUID
    name: str
    created_at: Timestamp


class AccountSummary(BaseModel):
    id: UUID
    account_no: str
    gmail_email: str
    registered_at: Timestamp
    recovery_account_id: UUID | None
    recovery_email_external: str | None
    recovery_email: str
    status: Status
    two_factor_status: TwoFactor
    purpose: str | None
    tags: list[TagResponse]
    last_login_at: Timestamp | None
    last_verified_at: Timestamp | None
    password_changed_at: Timestamp | None
    archived_at: Timestamp | None
    deleted_at: Timestamp | None
    row_version: int
    created_at: Timestamp
    updated_at: Timestamp


class AccountDetail(AccountSummary):
    phone: str | None
    notes: str | None


class PasswordResponse(BaseModel):
    password: str


Sort = Literal[
    "account_no",
    "registered_at",
    "last_verified_at",
    "last_login_at",
    "created_at",
    "updated_at",
    "-account_no",
    "-registered_at",
    "-last_verified_at",
    "-last_login_at",
    "-created_at",
    "-updated_at",
]


class AccountQuery(Input):
    search: str = Field(default="", max_length=254)
    status: Status | None = None
    purpose: str | None = Field(default=None, max_length=100)
    tag: UUID | None = None
    two_factor_status: TwoFactor | None = None
    registered_from: Timestamp | None = None
    registered_to: Timestamp | None = None
    archived: bool | None = None
    deleted: bool = False
    recovery_email: str | None = Field(default=None, max_length=254)
    sort: Sort = "-account_no"
    page: int = Field(default=1, ge=1, le=1000000)
    page_size: int = Field(default=30, ge=1, le=100)

    @model_validator(mode="after")
    def date_range(self) -> Self:
        if (
            self.registered_from
            and self.registered_to
            and self.registered_from >= self.registered_to
        ):
            raise ValueError("结束边界必须晚于开始边界")
        return self


class AccountPage(BaseModel):
    max_page_size: int
    items: list[AccountSummary]
    total: int
    page: int
    page_size: int


class AccountOption(BaseModel):
    id: UUID
    gmail_email: str
    account_no: str


class OptionPage(BaseModel):
    items: list[AccountOption]
    total: int
    page: int
    page_size: int


class SummaryQuery(Input):
    timezone: str = Field(default="UTC", max_length=100)

    @field_validator("timezone")
    @classmethod
    def timezone_valid(cls, value: str) -> str:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("时区无效") from None
        return value


class DashboardSummary(BaseModel):
    total: int
    normal: int
    pending_verification: int
    abnormal: int
    added_this_month: int
    unverified_over_30_days: int
    timezone: str
    month_from: Timestamp
    month_to: Timestamp


class BatchItem(VersionInput):
    id: UUID


class BatchInput(Input):
    accounts: list[BatchItem] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique(self) -> Self:
        if len({item.id for item in self.accounts}) != len(self.accounts):
            raise ValueError("不能重复选择账号")
        return self


class BatchStatus(BatchInput):
    status: Status


class BatchTags(BatchInput):
    tag_ids: Annotated[list[UUID], Field(min_length=1, max_length=100)]


class BatchResult(BaseModel):
    updated_ids: list[UUID]


class RecoveryUsage(BaseModel):
    email: str
    account_count: int
    normal_count: int
    abnormal_count: int
    latest_registered_at: Timestamp


class RecoveryPage(BaseModel):
    items: list[RecoveryUsage]
    total: int
    page: int
    page_size: int
