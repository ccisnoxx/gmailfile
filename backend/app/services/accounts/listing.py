"""账号列表、分页筛选、可选辅助账号、全局统计与辅助邮箱使用统计服务。"""

from datetime import UTC, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from app.models import GmailAccount, Tag, gmail_account_tags
from app.repositories.accounts import AccountRepository
from app.schemas.accounts import (
    AccountOption,
    AccountPage,
    AccountQuery,
    AccountSummary,
    DashboardRecoveryUsageResponse,
    DashboardSummary,
    OptionPage,
    RecoveryPage,
    RecoveryUsage,
    RegistrationTrendPoint,
    RegistrationTrendResponse,
    StatusCountItem,
    StatusDistributionResponse,
    TopTagItem,
    TwoFactorCountItem,
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
        tz = ZoneInfo(timezone)
        local = self.auth.now.astimezone(tz)
        # 显式构造 fold=0 本地月初零点，避免子夜切换夏令时区因继承 fold=1 偏移 1 小时。
        start = datetime(local.year, local.month, 1, tzinfo=tz, fold=0)
        end = (
            datetime(local.year + 1, 1, 1, tzinfo=tz, fold=0)
            if local.month == 12
            else datetime(local.year, local.month + 1, 1, tzinfo=tz, fold=0)
        )
        start, end = start.astimezone(UTC), end.astimezone(UTC)
        active = GmailAccount.deleted_at.is_(None)
        row = self.db.execute(
            select(
                func.count().filter(active),
                func.count().filter(active, GmailAccount.status == "normal"),
                func.count().filter(active, GmailAccount.status == "pending_verification"),
                func.count().filter(
                    active,
                    GmailAccount.status.in_(["restricted", "login_failed", "disabled"]),
                ),
                func.count().filter(
                    active,
                    GmailAccount.status.in_(["restricted", "login_failed"]),
                ),
                func.count().filter(active, GmailAccount.status == "disabled"),
                func.count().filter(active, GmailAccount.status == "archived"),
                func.count().filter(
                    active,
                    GmailAccount.registered_at >= start,
                    GmailAccount.registered_at < end,
                ),
                func.count().filter(
                    active,
                    GmailAccount.status != "archived",
                    func.coalesce(GmailAccount.last_verified_at, GmailAccount.registered_at)
                    < self.auth.now - timedelta(days=30),
                ),
                func.count().filter(GmailAccount.deleted_at.is_not(None)),
            )
        ).one()
        tag_count_rows = self.db.execute(
            select(
                gmail_account_tags.c.tag_id,
                func.count(gmail_account_tags.c.account_id),
            )
            .join(GmailAccount, GmailAccount.id == gmail_account_tags.c.account_id)
            .where(active)
            .group_by(gmail_account_tags.c.tag_id)
        ).all()
        tag_counts = {str(tag_id): int(cnt) for tag_id, cnt in tag_count_rows}
        return DashboardSummary(
            **dict(
                zip(
                    [
                        "total",
                        "normal",
                        "pending_verification",
                        "abnormal",
                        "risk",
                        "disabled",
                        "archived",
                        "added_this_month",
                        "unverified_over_30_days",
                        "deleted_count",
                    ],
                    row,
                    strict=True,
                )
            ),
            tag_counts=tag_counts,
            timezone=timezone,
            month_from=start,
            month_to=end,
        )

    def recovery_usage(
        self,
        page: int,
        page_size: int,
        *,
        search: str = "",
        sort: str = "-account_count",
    ) -> RecoveryPage:
        page_size = self.page_size(page_size)
        rows, total, total_accounts, abnormal_groups = self.repo.recovery_usage(
            page, page_size, search=search, sort=sort
        )
        return RecoveryPage(
            items=[RecoveryUsage(**row) for row in rows],
            total=total,
            total_accounts=total_accounts,
            abnormal_recovery_emails=abnormal_groups,
            page=page,
            page_size=page_size,
        )

    def recovery_email_accounts(
        self, email: str, *, page: int = 1, page_size: int = 30, sort: str = "-account_no"
    ) -> AccountPage:
        cleaned = email.strip()
        if not cleaned or len(cleaned) > 254:
            raise AccountError(422, "RECOVERY_EMAIL_INVALID", "辅助邮箱参数无效")
        params = AccountQuery(
            recovery_email=cleaned,
            page=page,
            page_size=page_size,
            sort=sort,
        )
        return self.page(params)

    def registration_trend(self, timezone: str, months: int) -> RegistrationTrendResponse:
        tz = ZoneInfo(timezone)
        local = self.auth.now.astimezone(tz)
        # 计算含当前月在内最近 months 个自然月（本地零点 fold=0 -> UTC，与 summary 口径一致）。
        start_total_months = local.year * 12 + (local.month - 1) - (months - 1)
        boundaries: list[tuple[str, datetime, datetime]] = []
        for offset in range(months):
            m_index = start_total_months + offset
            year, month0 = divmod(m_index, 12)
            month = month0 + 1
            next_year, next_month0 = divmod(m_index + 1, 12)
            next_month = next_month0 + 1
            b_start = datetime(year, month, 1, tzinfo=tz, fold=0).astimezone(UTC)
            b_end = datetime(next_year, next_month, 1, tzinfo=tz, fold=0).astimezone(UTC)
            boundaries.append((f"{year:04d}-{month:02d}", b_start, b_end))

        active = GmailAccount.deleted_at.is_(None)
        window_start = boundaries[0][1]
        select_cols = [
            func.count().filter(active, GmailAccount.registered_at < window_start),
            *[
                func.count().filter(
                    active,
                    GmailAccount.registered_at >= b_start,
                    GmailAccount.registered_at < b_end,
                )
                for _, b_start, b_end in boundaries
            ],
        ]
        counts = self.db.execute(select(*select_cols)).one()
        cumulative = int(counts[0])
        points: list[RegistrationTrendPoint] = []
        for idx, (label, _, _) in enumerate(boundaries):
            month_count = int(counts[idx + 1])
            cumulative += month_count
            points.append(
                RegistrationTrendPoint(month=label, count=month_count, cumulative=cumulative)
            )
        return RegistrationTrendResponse(timezone=timezone, months=months, items=points)

    def status_distribution(self) -> StatusDistributionResponse:
        active = GmailAccount.deleted_at.is_(None)
        status_order = (
            "normal",
            "pending_verification",
            "restricted",
            "login_failed",
            "disabled",
            "archived",
        )
        factor_order = ("enabled", "disabled", "unknown")
        row = self.db.execute(
            select(
                func.count().filter(active),
                *[func.count().filter(active, GmailAccount.status == s) for s in status_order],
                *[
                    func.count().filter(active, GmailAccount.two_factor_status == f)
                    for f in factor_order
                ],
            )
        ).one()
        total = int(row[0])
        statuses = [
            StatusCountItem(status=status, count=int(row[1 + i]))
            for i, status in enumerate(status_order)
        ]
        two_factor = [
            TwoFactorCountItem(two_factor_status=factor, count=int(row[1 + len(status_order) + i]))
            for i, factor in enumerate(factor_order)
        ]
        tag_rows = self.db.execute(
            select(Tag.id, Tag.name, func.count(gmail_account_tags.c.account_id).label("cnt"))
            .join(gmail_account_tags, gmail_account_tags.c.tag_id == Tag.id)
            .join(GmailAccount, GmailAccount.id == gmail_account_tags.c.account_id)
            .where(GmailAccount.deleted_at.is_(None))
            .group_by(Tag.id, Tag.name)
            .order_by(func.count(gmail_account_tags.c.account_id).desc(), Tag.name.asc())
            .limit(10)
        ).all()
        top_tags = [TopTagItem(id=r.id, name=r.name, count=int(r.cnt)) for r in tag_rows]
        return StatusDistributionResponse(
            total=total,
            statuses=statuses,
            two_factor=two_factor,
            top_tags=top_tags,
        )

    def dashboard_recovery_usage(self, limit: int = 10) -> DashboardRecoveryUsageResponse:
        rows, total_recovery, total_accounts, _ = self.repo.recovery_usage(
            1, limit, search="", sort="-account_count"
        )
        items = [RecoveryUsage(**row) for row in rows]
        shown = sum(item.account_count for item in items)
        return DashboardRecoveryUsageResponse(
            total_accounts=total_accounts,
            total_recovery_emails=total_recovery,
            items=items,
            others_count=max(0, total_accounts - shown),
        )
