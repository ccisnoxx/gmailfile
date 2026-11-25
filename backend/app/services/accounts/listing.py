"""账号列表、分页筛选、可选辅助账号、全局统计与辅助邮箱使用统计服务。"""

from datetime import UTC, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from app.models import GmailAccount
from app.repositories.accounts import AccountRepository
from app.schemas.accounts import (
    AccountOption,
    AccountPage,
    AccountQuery,
    AccountSummary,
    DashboardSummary,
    OptionPage,
    RecoveryPage,
    RecoveryUsage,
)
from app.services.accounts.errors import AccountError
from app.services.accounts.tags import TagService
from app.services.auth import AuthService


class AccountQueryService:
    def __init__(self, auth: AuthService, repo: AccountRepository):
        self.auth = auth
        self.db = auth.db
        self.repo = repo

    def summaries(
        self, *, deleted: bool = False, account_id: UUID | None = None
    ) -> list[AccountSummary]:
        records = self.repo.records(deleted=deleted, account_id=account_id)
        return self.serialize(records)

    def serialize(self, records) -> list[AccountSummary]:
        tags = {}
        for owner, tag in self.repo.tags([row.id for row, _ in records]):
            tags.setdefault(owner, []).append(TagService.tag_response(tag))
        result = []
        for row, recovery in records:
            fields = {
                name: getattr(row, name)
                for name in AccountSummary.model_fields
                if name not in {"account_no", "recovery_email", "tags"}
            }
            result.append(
                AccountSummary(
                    **fields,
                    account_no=f"GM-{row.account_no:06d}",
                    recovery_email=row.recovery_email_external or recovery,
                    tags=tags.get(row.id, []),
                )
            )
        return result

    def page_size(self, requested: int) -> int:
        size = (
            requested
            if "page_size" in self.auth.request.query_params
            else self.auth.settings.default_page_size
        )
        if size > self.auth.settings.max_page_size:
            raise AccountError(422, "PAGE_SIZE_INVALID", "每页条数超过系统上限")
        return size

    def page(self, params: AccountQuery) -> AccountPage:
        params.page_size = self.page_size(params.page_size)
        records, total = self.repo.page(params)
        return AccountPage(
            max_page_size=self.auth.settings.max_page_size,
            items=self.serialize(records),
            total=total,
            page=params.page,
            page_size=params.page_size,
        )

    def options(
        self, search: str, page: int, page_size: int, exclude_id: UUID | None
    ) -> OptionPage:
        page_size = self.page_size(page_size)
        query = self.repo.filtered(AccountQuery(search=search))
        if exclude_id:
            query = query.where(GmailAccount.id != exclude_id)
        total = self.db.scalar(select(func.count()).select_from(query.subquery()))
        records = self.db.execute(
            query.order_by(GmailAccount.account_no.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        return OptionPage(
            items=[
                AccountOption(
                    id=row.id, gmail_email=row.gmail_email, account_no=f"GM-{row.account_no:06d}"
                )
                for row, _ in records
            ],
            total=total,
            page=page,
            page_size=page_size,
        )

    def summary(self, timezone: str) -> DashboardSummary:
        local = self.auth.now.astimezone(ZoneInfo(timezone))
        start = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = (
            start.replace(year=start.year + 1, month=1)
            if start.month == 12
            else start.replace(month=start.month + 1)
        )
        start, end = start.astimezone(UTC), end.astimezone(UTC)
        row = self.db.execute(
            select(
                func.count(),
                func.count().filter(GmailAccount.status == "normal"),
                func.count().filter(GmailAccount.status == "pending_verification"),
                func.count().filter(
                    GmailAccount.status.in_(["restricted", "login_failed", "disabled"])
                ),
                func.count().filter(
                    GmailAccount.registered_at >= start, GmailAccount.registered_at < end
                ),
                func.count().filter(
                    GmailAccount.status != "archived",
                    func.coalesce(GmailAccount.last_verified_at, GmailAccount.registered_at)
                    < self.auth.now - timedelta(days=30),
                ),
            ).where(GmailAccount.deleted_at.is_(None))
        ).one()
        return DashboardSummary(
            **dict(
                zip(
                    [
                        "total",
                        "normal",
                        "pending_verification",
                        "abnormal",
                        "added_this_month",
                        "unverified_over_30_days",
                    ],
                    row,
                    strict=True,
                )
            ),
            timezone=timezone,
            month_from=start,
            month_to=end,
        )

    def recovery_usage(self, page: int, page_size: int) -> RecoveryPage:
        page_size = self.page_size(page_size)
        rows, total = self.repo.recovery_usage(page, page_size)
        return RecoveryPage(
            items=[RecoveryUsage(**row) for row in rows],
            total=total,
            page=page,
            page_size=page_size,
        )
