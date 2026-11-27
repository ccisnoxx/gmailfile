from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import String, and_, cast, exists, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.models import (
    GmailAccount,
    GmailAccountApp,
    RegisteredApp,
    Tag,
    gmail_account_tags,
)
from app.schemas.accounts import AccountQuery


class AccountRepository:
    def __init__(self, db: Session):
        self.db = db

    def records(self, *, deleted: bool = False, account_id: UUID | None = None):
        recovery = aliased(GmailAccount)
        query = select(GmailAccount, recovery.gmail_email).outerjoin(
            recovery, recovery.id == GmailAccount.recovery_account_id
        )
        if account_id is not None:
            query = query.where(GmailAccount.id == account_id)
        else:
            query = query.where(
                GmailAccount.deleted_at.is_not(None)
                if deleted
                else GmailAccount.deleted_at.is_(None)
            )
        return self.db.execute(query.order_by(GmailAccount.account_no.desc())).all()

    def tags(self, account_ids: list[UUID]):
        return self.db.execute(
            select(gmail_account_tags.c.account_id, Tag)
            .join(Tag, Tag.id == gmail_account_tags.c.tag_id)
            .where(gmail_account_tags.c.account_id.in_(account_ids))
            .order_by(Tag.name)
        ).all()

    def apps(self, account_ids: list[UUID]):
        return self.db.execute(
            select(
                GmailAccountApp,
                RegisteredApp.name,
                RegisteredApp.domain,
                RegisteredApp.icon_data,
            )
            .join(RegisteredApp, RegisteredApp.id == GmailAccountApp.app_id)
            .where(GmailAccountApp.account_id.in_(account_ids))
            .order_by(RegisteredApp.sort_order.asc(), RegisteredApp.name.asc())
        ).all()

    def filtered(self, params: AccountQuery, *, now: datetime | None = None):
        ref_now = now or datetime.now(UTC)
        recovery = aliased(GmailAccount)
        email = func.lower(
            func.trim(func.coalesce(GmailAccount.recovery_email_external, recovery.gmail_email))
        )
        query = select(GmailAccount, recovery.gmail_email).outerjoin(
            recovery, recovery.id == GmailAccount.recovery_account_id
        )
        query = query.where(
            GmailAccount.deleted_at.is_not(None)
            if params.deleted
            else GmailAccount.deleted_at.is_(None)
        )
        if params.search.strip():
            # autoescape 将用户的 % 和 _ 作为字面量，而非 SQL 通配符。
            term = params.search.strip().lower()
            number = func.concat(
                "GM-",
                func.lpad(
                    cast(GmailAccount.account_no, String),
                    func.greatest(6, func.length(cast(GmailAccount.account_no, String))),
                    "0",
                ),
            )
            query = query.where(
                or_(
                    func.lower(GmailAccount.gmail_email).contains(term, autoescape=True),
                    email.contains(term, autoescape=True),
                    func.lower(number).contains(term, autoescape=True),
                )
            )
        for field in ("status", "purpose", "two_factor_status"):
            if (value := getattr(params, field)) is not None:
                query = query.where(getattr(GmailAccount, field) == value)
        if params.statuses:
            query = query.where(GmailAccount.status.in_(params.statuses))
        if params.tag is not None:
            query = query.where(
                GmailAccount.id.in_(
                    select(gmail_account_tags.c.account_id).where(
                        gmail_account_tags.c.tag_id == params.tag
                    )
                )
            )
        if params.app_id is not None or params.app_status is not None or params.app_statuses:
            app_subq = select(GmailAccountApp.account_id)
            if params.app_id is not None:
                app_subq = app_subq.where(GmailAccountApp.app_id == params.app_id)
            if params.app_status is not None:
                app_subq = app_subq.where(GmailAccountApp.status == params.app_status)
            if params.app_statuses:
                app_subq = app_subq.where(GmailAccountApp.status.in_(params.app_statuses))
            query = query.where(GmailAccount.id.in_(app_subq))
        if params.exclude_app_id is not None:
            query = query.where(
                ~exists(
                    select(1).where(
                        GmailAccountApp.account_id == GmailAccount.id,
                        GmailAccountApp.app_id == params.exclude_app_id,
                    )
                )
            )
        if params.archived is not None:
            query = query.where(
                (GmailAccount.status == "archived")
                if params.archived
                else (GmailAccount.status != "archived")
            )
        if params.registered_from is not None:
            query = query.where(GmailAccount.registered_at >= params.registered_from)
        if params.registered_to is not None:
            query = query.where(GmailAccount.registered_at < params.registered_to)
        if params.recovery_email is not None:
            query = query.where(email == params.recovery_email.strip().lower())
        if params.has_recovery_email is True:
            query = query.where(
                or_(
                    GmailAccount.recovery_account_id.is_not(None),
                    and_(
                        GmailAccount.recovery_email_external.is_not(None),
                        func.btrim(GmailAccount.recovery_email_external) != "",
                    ),
                )
            )
        elif params.has_recovery_email is False:
            query = query.where(
                GmailAccount.recovery_account_id.is_(None),
                or_(
                    GmailAccount.recovery_email_external.is_(None),
                    func.btrim(GmailAccount.recovery_email_external) == "",
                ),
            )
        if params.unverified_over_days is not None:
            cutoff = ref_now - timedelta(days=params.unverified_over_days)
            query = query.where(
                GmailAccount.status != "archived",
                func.coalesce(GmailAccount.last_verified_at, GmailAccount.registered_at) < cutoff,
            )
        if params.inactive_login_over_days is not None:
            cutoff = ref_now - timedelta(days=params.inactive_login_over_days)
            query = query.where(
                GmailAccount.status != "archived",
                func.coalesce(GmailAccount.last_login_at, GmailAccount.registered_at) < cutoff,
            )
        if params.password_stale_over_days is not None:
            cutoff = ref_now - timedelta(days=params.password_stale_over_days)
            query = query.where(
                GmailAccount.status != "archived",
                func.coalesce(GmailAccount.password_changed_at, GmailAccount.registered_at)
                < cutoff,
            )
        if params.missing_metadata is not None:
            no_purpose = or_(
                GmailAccount.purpose.is_(None),
                func.btrim(GmailAccount.purpose) == "",
            )
            no_tags = ~exists(select(1).where(gmail_account_tags.c.account_id == GmailAccount.id))
            if params.missing_metadata == "no_purpose":
                query = query.where(no_purpose)
            elif params.missing_metadata == "no_tags":
                query = query.where(no_tags)
            else:
                query = query.where(or_(no_purpose, no_tags))
        if params.conflict_check == "inactive_with_active_apps":
            query = query.where(
                GmailAccount.status.in_(["restricted", "login_failed", "disabled", "archived"]),
                exists(
                    select(1).where(
                        GmailAccountApp.account_id == GmailAccount.id,
                        GmailAccountApp.status == "active",
                    )
                ),
            )
        if params.upstream_recovery_risk is True:
            query = query.where(
                GmailAccount.status != "archived",
                GmailAccount.recovery_account_id.is_not(None),
                or_(
                    recovery.deleted_at.is_not(None),
                    recovery.status.in_(["restricted", "login_failed", "disabled"]),
                ),
            )
        elif params.upstream_recovery_risk is False:
            query = query.where(
                or_(
                    GmailAccount.recovery_account_id.is_(None),
                    and_(
                        recovery.deleted_at.is_(None),
                        recovery.status.not_in(["restricted", "login_failed", "disabled"]),
                    ),
                )
            )
        return query

    def page(self, params: AccountQuery, *, now: datetime | None = None):
        query = self.filtered(params, now=now)
        total = self.db.scalar(select(func.count()).select_from(query.subquery()))
        column = getattr(GmailAccount, params.sort.lstrip("-"))
        order = column.desc() if params.sort.startswith("-") else column.asc()
        records = self.db.execute(
            query.order_by(order.nulls_last(), GmailAccount.id.asc())
            .offset((params.page - 1) * params.page_size)
            .limit(params.page_size)
        ).all()
        return records, total

    def recovery_usage(
        self,
        page: int,
        page_size: int,
        *,
        search: str = "",
        sort: str = "-account_count",
    ):
        recovery = aliased(GmailAccount)
        email = func.lower(
            func.trim(func.coalesce(GmailAccount.recovery_email_external, recovery.gmail_email))
        )
        query = (
            select(
                email.label("email"),
                func.count().label("account_count"),
                func.count().filter(GmailAccount.status == "normal").label("normal_count"),
                func.count()
                .filter(GmailAccount.status.in_(["restricted", "login_failed", "disabled"]))
                .label("abnormal_count"),
                func.max(GmailAccount.registered_at).label("latest_registered_at"),
            )
            .outerjoin(recovery, recovery.id == GmailAccount.recovery_account_id)
            .where(GmailAccount.deleted_at.is_(None), email.is_not(None))
        )
        if search.strip():
            query = query.where(email.contains(search.strip().lower(), autoescape=True))
        grouped = query.group_by(email).subquery()
        agg = self.db.execute(
            select(
                func.count(),
                func.coalesce(func.sum(grouped.c.account_count), 0),
                func.count().filter(grouped.c.abnormal_count > 0),
            )
        ).one()
        total, total_accounts, abnormal_groups = int(agg[0]), int(agg[1]), int(agg[2])
        sort_field = sort.lstrip("-")
        sort_col = grouped.c[sort_field]
        order = sort_col.desc() if sort.startswith("-") else sort_col.asc()
        rows = (
            self.db.execute(
                select(grouped)
                .order_by(order, grouped.c.email.asc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
            .mappings()
            .all()
        )
        return rows, total, total_accounts, abnormal_groups
