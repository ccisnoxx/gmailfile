"""账号服务门面；所有账号写入均通过数据库 CAS 保护版本。"""

from uuid import UUID

from app.models import GmailAccount, Tag
from app.repositories.accounts import AccountRepository
from app.schemas.accounts import (
    AccountCreate,
    AccountDetail,
    AccountPage,
    AccountPatch,
    AccountQuery,
    AccountSummary,
    BatchResult,
    BatchStatus,
    BatchTags,
    DashboardSummary,
    OptionPage,
    PasswordResponse,
    RecoveryPage,
    TagResponse,
)
from app.services.accounts.detail import AccountDetailService
from app.services.accounts.errors import ACCOUNT_WRITE_LOCK, AccountError, flush_unique
from app.services.accounts.listing import AccountQueryService
from app.services.accounts.tags import TagService
from app.services.auth import AuthService

__all__ = [
    "ACCOUNT_WRITE_LOCK",
    "AccountDetailService",
    "AccountError",
    "AccountQueryService",
    "AccountService",
    "TagService",
]


class AccountService:
    """组合账号列表查询、账号详情写入与标签管理服务的门面。"""

    def __init__(self, auth: AuthService):
        self.auth, self.db = auth, auth.db
        self.session = auth.require_session(csrf=auth.request.method != "GET")
        self.repo = AccountRepository(self.db)
        self.listing = AccountQueryService(auth, self.repo)
        self.details = AccountDetailService(auth, self.session, self.listing)
        self.tag_service = TagService(auth, self.session)

    def audit(
        self, event: str, account_id: UUID | None = None, *, operation: str | None = None
    ) -> None:
        self.auth.audit(event, self.session, account_id=account_id, operation=operation)

    def flush(self, *, tag: bool = False) -> None:
        flush_unique(self.db, tag=tag)

    def summaries(
        self, *, deleted: bool = False, account_id: UUID | None = None
    ) -> list[AccountSummary]:
        return self.listing.summaries(deleted=deleted, account_id=account_id)

    def serialize(self, records) -> list[AccountSummary]:
        return self.listing.serialize(records)

    def page_size(self, requested: int) -> int:
        return self.listing.page_size(requested)

    def page(self, params: AccountQuery) -> AccountPage:
        return self.listing.page(params)

    def options(
        self, search: str, page: int, page_size: int, exclude_id: UUID | None
    ) -> OptionPage:
        return self.listing.options(search, page, page_size, exclude_id)

    def summary(self, timezone: str) -> DashboardSummary:
        return self.listing.summary(timezone)

    def recovery_usage(self, page: int, page_size: int) -> RecoveryPage:
        return self.listing.recovery_usage(page, page_size)

    def batch(self, body: BatchStatus | BatchTags) -> BatchResult:
        return self.details.batch(body)

    def status_values(self, row: GmailAccount, status: str) -> dict:
        return self.details.status_values(row, status)

    def record(self, account_id: UUID) -> GmailAccount:
        return self.details.record(account_id)

    def detail(self, account_id: UUID) -> AccountDetail:
        return self.details.detail(account_id)

    def recovery(
        self, account_id: UUID, email: str, recovery_id: UUID | None, external: str | None
    ) -> None:
        self.details.recovery(account_id, email, recovery_id, external)

    def encrypted(self, account_id: UUID, values: dict) -> None:
        self.details.encrypted(account_id, values)

    def set_tags(self, account_id: UUID, tag_ids: list[UUID]) -> None:
        self.details.set_tags(account_id, tag_ids)

    def create(self, body: AccountCreate) -> AccountDetail:
        return self.details.create(body)

    def cas(self, row: GmailAccount, version: int, values: dict) -> None:
        self.details.cas(row, version, values)

    def patch(self, account_id: UUID, body: AccountPatch) -> AccountDetail:
        return self.details.patch(account_id, body)

    def action(self, account_id: UUID, version: int, action: str) -> AccountDetail:
        return self.details.action(account_id, version, action)

    def reveal(self, account_id: UUID) -> PasswordResponse:
        return self.details.reveal(account_id)

    def copied(self, account_id: UUID) -> None:
        self.details.copied(account_id)

    @staticmethod
    def tag_response(row: Tag) -> TagResponse:
        return TagService.tag_response(row)

    def tags(self) -> list[TagResponse]:
        return self.tag_service.list_tags()

    def save_tag(self, name: str, tag_id: UUID | None = None) -> TagResponse:
        return self.tag_service.save_tag(name, tag_id)

    def delete_tag(self, tag_id: UUID) -> None:
        self.tag_service.delete_tag(tag_id)
