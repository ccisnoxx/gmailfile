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
AppStatus = Literal["active", "restricted", "banned"]
MissingMetadataFilter = Literal["no_purpose", "no_tags", "no_purpose_or_tags"]
ConflictCheckFilter = Literal["inactive_with_active_apps"]


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


class AccountAppInput(Input):
    app_id: UUID
    status: AppStatus = "active"
    note: str | None = Field(default=None, max_length=200)

    @field_validator("note")
    @classmethod
    def clean_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


AccountApps = Annotated[list[AccountAppInput], Field(max_length=100)]


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
    apps: AccountApps = Field(default_factory=list)
    last_login_at: Timestamp | None = None
    last_verified_at: Timestamp | None = None
    password_changed_at: Timestamp | None = None
    notes: Notes | None = None

    @model_validator(mode="after")
    def recovery(self) -> Self:
        if self.recovery_account_id is not None and self.recovery_email_external is not None:
            raise ValueError("辅助邮箱不能同时填写外部地址和关联账号")
        if self.recovery_email_external is not None and normalize_email(
            self.recovery_email_external
        ) == normalize_email(self.gmail_email):
            raise ValueError("辅助邮箱不能与主邮箱相同")
        if len({item.app_id for item in self.apps}) != len(self.apps):
            raise ValueError("不能重复选择同一应用")
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
    apps: AccountApps | None = None
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
            "apps",
        ):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError("必填字段不能设为空")
        if self.apps is not None and len({item.app_id for item in self.apps}) != len(self.apps):
            raise ValueError("不能重复选择同一应用")
        return self


class TagInput(Input):
    name: str = Field(min_length=1, max_length=50, pattern=r"\S")


class TagResponse(BaseModel):
    id: UUID
    name: str
    created_at: Timestamp


class RegisteredAppInput(Input):
    name: str = Field(min_length=1, max_length=64, pattern=r"\S")
    domain: str | None = Field(default=None, max_length=255)
    icon_data: str | None = Field(default=None, max_length=98304)


class AppIconFetchInput(Input):
    domain: str = Field(min_length=3, max_length=255, pattern=r"\S")


class AppIconFetchResponse(BaseModel):
    domain: str
    icon_data: str


class RegisteredAppResponse(BaseModel):
    id: UUID
    name: str
    domain: str | None = None
    icon_data: str | None = None
    sort_order: int
    created_at: Timestamp


class RegisteredAppUsage(BaseModel):
    id: UUID
    name: str
    domain: str | None = None
    icon_data: str | None = None
    sort_order: int
    total_count: int
    active_count: int
    restricted_count: int
    banned_count: int
    created_at: Timestamp


class AccountAppItem(BaseModel):
    app_id: UUID
    app_name: str
    app_domain: str | None = None
    app_icon_data: str | None = None
    status: AppStatus
    note: str | None
    banned_at: Timestamp | None
    updated_at: Timestamp


class AccountSummary(BaseModel):
    id: UUID
    account_no: str
    gmail_email: str
    registered_at: Timestamp
    recovery_account_id: UUID | None
    recovery_email_external: str | None
    recovery_email: str | None = None
    status: Status
    two_factor_status: TwoFactor
    purpose: str | None
    tags: list[TagResponse]
    apps: list[AccountAppItem] = Field(default_factory=list)
    last_login_at: Timestamp | None
    last_verified_at: Timestamp | None
    password_changed_at: Timestamp | None
    archived_at: Timestamp | None
    deleted_at: Timestamp | None
    row_version: int
    created_at: Timestamp
    updated_at: Timestamp


class AccountDetail(AccountSummary):
    has_phone: bool = False
    has_notes: bool = False
    phone: str | None = None
    notes: str | None = None


class SensitiveFieldsResponse(BaseModel):
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
    statuses: list[Status] | None = Field(default=None, max_length=6)
    purpose: str | None = Field(default=None, max_length=100)
    tag: UUID | None = None
    app_id: UUID | None = None
    app_status: AppStatus | None = None
    app_statuses: list[AppStatus] | None = Field(default=None, max_length=3)
    exclude_app_id: UUID | None = None
    two_factor_status: TwoFactor | None = None
    registered_from: Timestamp | None = None
    registered_to: Timestamp | None = None
    archived: bool | None = None
    deleted: bool = False
    recovery_email: str | None = Field(default=None, max_length=254)
    has_recovery_email: bool | None = None
    unverified_over_days: int | None = Field(default=None, ge=1, le=3650)
    inactive_login_over_days: int | None = Field(default=None, ge=1, le=3650)
    password_stale_over_days: int | None = Field(default=None, ge=1, le=3650)
    missing_metadata: MissingMetadataFilter | None = None
    conflict_check: ConflictCheckFilter | None = None
    sort: Sort = "-account_no"
    page: int = Field(default=1, ge=1, le=1000000)
    page_size: int = Field(default=30, ge=1, le=100)

    @field_validator("statuses", "app_statuses", mode="before")
    @classmethod
    def parse_statuses(cls, value: object) -> object:
        if value is None or value == "":
            return None
        if isinstance(value, str):
            parts = list(dict.fromkeys(item.strip() for item in value.split(",") if item.strip()))
            return parts or None
        if isinstance(value, list):
            parts: list[str] = []
            for item in value:
                if isinstance(item, str):
                    parts.extend(part.strip() for part in item.split(",") if part.strip())
                else:
                    parts.append(item)
            return list(dict.fromkeys(parts)) or None
        return value

    @model_validator(mode="after")
    def date_range(self) -> Self:
        if (
            self.registered_from
            and self.registered_to
            and self.registered_from >= self.registered_to
        ):
            raise ValueError("结束边界必须晚于开始边界")
        if self.app_id and self.exclude_app_id and self.app_id == self.exclude_app_id:
            raise ValueError("包含与排除的应用不能相同")
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
    risk: int = 0
    disabled: int = 0
    archived: int = 0
    added_this_month: int
    unverified_over_30_days: int
    deleted_count: int = 0
    tag_counts: dict[str, int] = Field(default_factory=dict)
    timezone: str
    month_from: Timestamp
    month_to: Timestamp


class TrendQuery(SummaryQuery):
    months: int = Field(default=12, ge=3, le=24)


class RegistrationTrendPoint(BaseModel):
    month: str
    count: int
    cumulative: int


class RegistrationTrendResponse(BaseModel):
    timezone: str
    months: int
    items: list[RegistrationTrendPoint]


class StatusCountItem(BaseModel):
    status: Status
    count: int


class TwoFactorCountItem(BaseModel):
    two_factor_status: TwoFactor
    count: int


class TopTagItem(BaseModel):
    id: UUID
    name: str
    count: int


class StatusDistributionResponse(BaseModel):
    total: int
    statuses: list[StatusCountItem]
    two_factor: list[TwoFactorCountItem]
    top_tags: list[TopTagItem]


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


class BatchPermanentDeleteInput(BatchInput):
    confirmation: str = Field(min_length=1, max_length=32)


class BatchResult(BaseModel):
    updated_ids: list[UUID]


RecoverySort = Literal[
    "email",
    "-email",
    "account_count",
    "-account_count",
    "normal_count",
    "-normal_count",
    "abnormal_count",
    "-abnormal_count",
    "latest_registered_at",
    "-latest_registered_at",
]


class RecoveryUsage(BaseModel):
    email: str
    account_count: int
    normal_count: int
    abnormal_count: int
    latest_registered_at: Timestamp


class RecoveryPage(BaseModel):
    items: list[RecoveryUsage]
    total: int
    total_accounts: int = 0
    abnormal_recovery_emails: int = 0
    page: int
    page_size: int


class DashboardRecoveryUsageResponse(BaseModel):
    total_accounts: int
    total_recovery_emails: int
    items: list[RecoveryUsage]
    others_count: int


class DuplicateExternalRecoveryItem(BaseModel):
    email: str
    account_count: int
    matched_account_id: UUID
    matched_account_no: str


class DashboardInsightsResponse(BaseModel):
    disabled_2fa_count: int
    unknown_2fa_count: int
    pending_verification_count: int
    risk_status_count: int
    unverified_over_30_days: int
    inactive_login_over_90_days: int
    password_stale_over_180_days: int
    no_recovery_email_count: int
    app_risk_account_count: int
    concentrated_recovery_emails: list[RecoveryUsage] = Field(default_factory=list)
    no_purpose_count: int
    no_tags_count: int
    inactive_with_active_apps_count: int
    external_recovery_matches_internal: list[DuplicateExternalRecoveryItem] = Field(
        default_factory=list
    )
    backup_state: Literal["unconfigured", "never_run", "running", "success", "failed", "stale"]
    backup_offsite: Literal["unconfigured", "pending", "success", "failed"] = "unconfigured"
    backup_last_success_at: Timestamp | None = None
    recent_auth_failures_7d: int = 0
    generated_at: Timestamp
