"""第三方已注册应用目录服务：查询、统计、增改与删除（联动递增关联账号版本）。"""

from uuid import UUID

from sqlalchemy import func, select, update

from app.models import GmailAccount, GmailAccountApp, RegisteredApp, UserSession
from app.schemas.accounts import (
    AppIconFetchResponse,
    RegisteredAppInput,
    RegisteredAppResponse,
    RegisteredAppUsage,
)
from app.services.accounts.app_icon import (
    fetch_domain_icon,
    normalize_domain,
    validate_icon_data,
)
from app.services.accounts.errors import AccountError, flush_unique
from app.services.auth import AuthService


class AppService:
    def __init__(self, auth: AuthService, session: UserSession):
        self.auth = auth
        self.db = auth.db
        self.session = session

    @staticmethod
    def app_response(row: RegisteredApp) -> RegisteredAppResponse:
        return RegisteredAppResponse(
            id=row.id,
            name=row.name,
            domain=row.domain,
            icon_data=row.icon_data,
            sort_order=row.sort_order,
            created_at=row.created_at,
        )

    def list_apps(self) -> list[RegisteredAppResponse]:
        rows = self.db.scalars(
            select(RegisteredApp).order_by(RegisteredApp.sort_order.asc(), RegisteredApp.name.asc())
        )
        return [self.app_response(row) for row in rows]

    def usage(self) -> list[RegisteredAppUsage]:
        active_account = GmailAccount.deleted_at.is_(None)
        counts = (
            select(
                GmailAccountApp.app_id.label("app_id"),
                func.count().label("total_count"),
                func.count().filter(GmailAccountApp.status == "active").label("active_count"),
                func.count()
                .filter(GmailAccountApp.status == "restricted")
                .label("restricted_count"),
                func.count().filter(GmailAccountApp.status == "banned").label("banned_count"),
            )
            .join(GmailAccount, GmailAccount.id == GmailAccountApp.account_id)
            .where(active_account)
            .group_by(GmailAccountApp.app_id)
            .subquery()
        )
        total_col = func.coalesce(counts.c.total_count, 0)
        rows = self.db.execute(
            select(
                RegisteredApp,
                total_col.label("total_count"),
                func.coalesce(counts.c.active_count, 0).label("active_count"),
                func.coalesce(counts.c.restricted_count, 0).label("restricted_count"),
                func.coalesce(counts.c.banned_count, 0).label("banned_count"),
            )
            .outerjoin(counts, counts.c.app_id == RegisteredApp.id)
            .order_by(RegisteredApp.sort_order.asc(), total_col.desc(), RegisteredApp.name.asc())
        ).all()
        return [
            RegisteredAppUsage(
                id=app.id,
                name=app.name,
                domain=app.domain,
                icon_data=app.icon_data,
                sort_order=app.sort_order,
                total_count=int(total_count),
                active_count=int(active_count),
                restricted_count=int(restricted_count),
                banned_count=int(banned_count),
                created_at=app.created_at,
            )
            for app, total_count, active_count, restricted_count, banned_count in rows
        ]

    def save_app(
        self, body: RegisteredAppInput, app_id: UUID | None = None
    ) -> RegisteredAppResponse:
        cleaned = body.name.strip()
        row = self.db.get(RegisteredApp, app_id) if app_id else RegisteredApp()
        if row is None:
            raise AccountError(404, "APP_NOT_FOUND", "应用不存在")
        row.name = cleaned
        row.name_normalized = cleaned.lower()
        if app_id is None or "domain" in body.model_fields_set:
            row.domain = normalize_domain(body.domain)
        if app_id is None or "icon_data" in body.model_fields_set:
            row.icon_data = validate_icon_data(body.icon_data)
        if body.sort_order is not None:
            row.sort_order = body.sort_order
        self.db.add(row)
        flush_unique(self.db, app=True)
        self.auth.audit("app_updated" if app_id else "app_created", self.session)
        return self.app_response(row)

    def fetch_icon(self, raw_domain: str) -> AppIconFetchResponse:
        domain, icon_data = fetch_domain_icon(raw_domain)
        return AppIconFetchResponse(domain=domain, icon_data=icon_data)

    def delete_app(self, app_id: UUID) -> None:
        row = self.db.get(RegisteredApp, app_id)
        if row is None:
            raise AccountError(404, "APP_NOT_FOUND", "应用不存在")
        owners = select(GmailAccountApp.account_id).where(GmailAccountApp.app_id == app_id)
        changed = self.db.scalars(
            update(GmailAccount)
            .where(GmailAccount.id.in_(owners))
            .values(row_version=GmailAccount.row_version + 1, updated_at=self.auth.now)
            .returning(GmailAccount.id)
        ).all()
        self.db.delete(row)
        flush_unique(self.db)
        for account_id in changed:
            self.auth.audit(
                "account_updated", self.session, account_id=account_id, operation="app-deleted"
            )
        self.auth.audit("app_deleted", self.session)
