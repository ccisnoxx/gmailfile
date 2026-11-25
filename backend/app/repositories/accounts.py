from uuid import UUID

from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.models import GmailAccount, Tag, gmail_account_tags
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

    def filtered(self, params: AccountQuery):
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
        if params.tag is not None:
            query = query.where(
                GmailAccount.id.in_(
                    select(gmail_account_tags.c.account_id).where(
                        gmail_account_tags.c.tag_id == params.tag
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
        return query

    def page(self, params: AccountQuery):
        query = self.filtered(params)
        total = self.db.scalar(select(func.count()).select_from(query.subquery()))
        column = getattr(GmailAccount, params.sort.lstrip("-"))
        order = column.desc() if params.sort.startswith("-") else column.asc()
        records = self.db.execute(
            query.order_by(order.nulls_last(), GmailAccount.id.asc())
            .offset((params.page - 1) * params.page_size)
            .limit(params.page_size)
        ).all()
        return records, total

    def recovery_usage(self, page: int, page_size: int):
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
            .where(GmailAccount.deleted_at.is_(None))
            .group_by(email)
        )
        total = self.db.scalar(select(func.count()).select_from(query.subquery()))
        return self.db.execute(
            query.order_by(email).offset((page - 1) * page_size).limit(page_size)
        ).mappings().all(), total
