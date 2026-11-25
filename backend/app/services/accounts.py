"""账号事务复用认证锁；所有账号写入仍通过数据库 CAS 保护版本。"""

from datetime import UTC, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError

from app.core.encryption import EncryptedValue
from app.models import GmailAccount, Tag, gmail_account_tags
from app.repositories.accounts import AccountRepository
from app.schemas.accounts import (
    AccountCreate,
    AccountDetail,
    AccountOption,
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
    RecoveryUsage,
    TagResponse,
    normalize_email,
)
from app.services.auth import AuthService


class AccountError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        self.status, self.code, self.message = status, code, message
        self.details = details or {}


class AccountService:
    def __init__(self, auth: AuthService):
        self.auth, self.db = auth, auth.db
        self.session = auth.require_session(csrf=auth.request.method != "GET")
        self.repo = AccountRepository(self.db)

    def audit(self, event: str, account_id: UUID | None = None, *, operation: str | None = None):
        self.auth.audit(event, self.session, account_id=account_id, operation=operation)

    def flush(self, *, tag: bool = False):
        try:
            self.db.flush()
        except IntegrityError as exc:
            if exc.orig.sqlstate == "23505":
                raise AccountError(
                    409,
                    "TAG_DUPLICATE" if tag else "ACCOUNT_EMAIL_DUPLICATE",
                    "该标签已存在" if tag else "该邮箱已存在",
                ) from None
            raise

    def summaries(self, *, deleted: bool = False, account_id: UUID | None = None):
        records = self.repo.records(deleted=deleted, account_id=account_id)
        return self.serialize(records)

    def serialize(self, records):
        tags = {}
        for owner, tag in self.repo.tags([row.id for row, _ in records]):
            tags.setdefault(owner, []).append(self.tag_response(tag))
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

    def page_size(self, requested: int):
        size = (
            requested
            if "page_size" in self.auth.request.query_params
            else self.auth.settings.default_page_size
        )
        if size > self.auth.settings.max_page_size:
            raise AccountError(422, "PAGE_SIZE_INVALID", "每页条数超过系统上限")
        return size

    def page(self, params: AccountQuery):
        params.page_size = self.page_size(params.page_size)
        records, total = self.repo.page(params)
        return AccountPage(
            max_page_size=self.auth.settings.max_page_size,
            items=self.serialize(records),
            total=total,
            page=params.page,
            page_size=params.page_size,
        )

    def options(self, search: str, page: int, page_size: int, exclude_id: UUID | None):
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

    def summary(self, timezone: str):
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

    def recovery_usage(self, page: int, page_size: int):
        page_size = self.page_size(page_size)
        rows, total = self.repo.recovery_usage(page, page_size)
        return RecoveryPage(
            items=[RecoveryUsage(**row) for row in rows],
            total=total,
            page=page,
            page_size=page_size,
        )

    def batch(self, body: BatchStatus | BatchTags):
        # 每条 CAS 与审计共用请求事务；任一失败回滚整批。
        for item in sorted(body.accounts, key=lambda item: item.id):
            try:
                row = self.record(item.id)
                if row.deleted_at is not None:
                    raise AccountError(409, "ACCOUNT_DELETED", "请先恢复账号再操作")
                if isinstance(body, BatchStatus):
                    self.cas(row, item.row_version, self.status_values(row, body.status))
                    self.audit("account_updated", row.id, operation="batch-status")
                else:
                    self.cas(row, item.row_version, {})
                    existing = self.db.scalars(
                        select(gmail_account_tags.c.tag_id).where(
                            gmail_account_tags.c.account_id == row.id
                        )
                    ).all()
                    self.set_tags(row.id, list(set(existing) | set(body.tag_ids)))
                    self.audit("account_updated", row.id, operation="batch-tags")
            except AccountError as exc:
                exc.details = {
                    "account_id": str(item.id),
                    "expected_row_version": str(item.row_version),
                }
                raise
        return BatchResult(updated_ids=[item.id for item in body.accounts])

    def status_values(self, row: GmailAccount, status: str):
        return {
            "status": status,
            "archived_at": (row.archived_at or self.auth.now) if status == "archived" else None,
        }

    def record(self, account_id: UUID) -> GmailAccount:
        row = self.db.get(GmailAccount, account_id)
        if row is None:
            raise AccountError(404, "ACCOUNT_NOT_FOUND", "账号不存在")
        return row

    def detail(self, account_id: UUID) -> AccountDetail:
        row = self.record(account_id)
        summary = self.summaries(account_id=account_id)[0]
        values = {}
        for field in ("phone", "notes"):
            ciphertext = getattr(row, field + "_ciphertext")
            values[field] = (
                None
                if ciphertext is None
                else self.auth.encryption.decrypt(
                    EncryptedValue(
                        ciphertext,
                        getattr(row, field + "_nonce"),
                        getattr(row, field + "_key_version"),
                    ),
                    "gmail_account",
                    row.id,
                    field,
                )
            )
        return AccountDetail(**summary.model_dump(), **values)

    def recovery(
        self, account_id: UUID, email: str, recovery_id: UUID | None, external: str | None
    ):
        if (recovery_id is None) == (external is None):
            raise AccountError(422, "RECOVERY_INVALID", "辅助邮箱必须且只能填写一种")
        if recovery_id is not None:
            target = self.record(recovery_id)
            if recovery_id == account_id:
                raise AccountError(422, "RECOVERY_INVALID", "辅助邮箱不能关联自身")
            external = target.gmail_email
        if normalize_email(external) == normalize_email(email):
            raise AccountError(422, "RECOVERY_INVALID", "辅助邮箱不能与主邮箱相同")
        # 主邮箱改名也不能使已有反向关联变成同一邮箱。
        incoming = self.db.scalars(
            select(GmailAccount).where(GmailAccount.recovery_account_id == account_id)
        )
        if any(row.gmail_email_normalized == normalize_email(email) for row in incoming):
            raise AccountError(422, "RECOVERY_INVALID", "该地址与关联账号的主邮箱相同")

    def encrypted(self, account_id: UUID, values: dict):
        for field in ("password", "phone", "notes"):
            if field not in values:
                continue
            secret = values.pop(field)
            encrypted = (
                None
                if secret is None
                else self.auth.encryption.encrypt(
                    secret.get_secret_value(), "gmail_account", account_id, field
                )
            )
            for part in ("ciphertext", "nonce", "key_version"):
                values[f"{field}_{part}"] = getattr(encrypted, part) if encrypted else None

    def set_tags(self, account_id: UUID, tag_ids: list[UUID]):
        ids = set(tag_ids)
        found = set(self.db.scalars(select(Tag.id).where(Tag.id.in_(ids))))
        if ids != found:
            raise AccountError(422, "TAG_INVALID", "所选标签已不存在，请刷新后重试")
        self.db.execute(
            delete(gmail_account_tags).where(gmail_account_tags.c.account_id == account_id)
        )
        if ids:
            self.db.execute(
                gmail_account_tags.insert(),
                [{"account_id": account_id, "tag_id": tag_id} for tag_id in ids],
            )

    def create(self, body: AccountCreate):
        account_id = uuid4()
        self.recovery(
            account_id, body.gmail_email, body.recovery_account_id, body.recovery_email_external
        )
        values = {key: getattr(body, key) for key in type(body).model_fields}
        tag_ids = values.pop("tag_ids")
        values["gmail_email_normalized"] = normalize_email(body.gmail_email)
        values["archived_at"] = self.auth.now if body.status == "archived" else None
        self.encrypted(account_id, values)
        row = GmailAccount(id=account_id, **values)
        self.db.add(row)
        self.flush()
        self.set_tags(account_id, tag_ids)
        self.audit("account_created", account_id)
        return self.detail(account_id)

    def cas(self, row: GmailAccount, version: int, values: dict):
        changed = self.db.execute(
            update(GmailAccount)
            .where(GmailAccount.id == row.id, GmailAccount.row_version == version)
            .values(**values, row_version=GmailAccount.row_version + 1, updated_at=self.auth.now)
            .returning(GmailAccount.id)
        ).scalar_one_or_none()
        if changed is None:
            raise AccountError(
                409, "ROW_VERSION_CONFLICT", "账号已在其他页面修改，请重新加载后再操作"
            )

    def patch(self, account_id: UUID, body: AccountPatch):
        row = self.record(account_id)
        if row.deleted_at is not None:
            raise AccountError(409, "ACCOUNT_DELETED", "请先恢复账号再编辑")
        values = {key: getattr(body, key) for key in body.model_fields_set if key != "row_version"}
        self.recovery(
            account_id,
            values.get("gmail_email", row.gmail_email),
            values.get("recovery_account_id", row.recovery_account_id),
            values.get("recovery_email_external", row.recovery_email_external),
        )
        if "gmail_email" in values:
            values["gmail_email_normalized"] = normalize_email(values["gmail_email"])
        if "status" in values:
            values.update(self.status_values(row, values["status"]))
        tag_ids = values.pop("tag_ids", None)
        self.encrypted(account_id, values)
        try:
            self.cas(row, body.row_version, values)
            if tag_ids is not None:
                self.set_tags(account_id, tag_ids)
            self.flush()
        except IntegrityError as exc:
            if exc.orig.sqlstate == "23505":
                raise AccountError(409, "ACCOUNT_EMAIL_DUPLICATE", "该邮箱已存在") from None
            raise
        self.audit("account_updated", account_id)
        return self.detail(account_id)

    def action(self, account_id: UUID, version: int, action: str):
        row = self.record(account_id)
        if action == "restore":
            if row.deleted_at is None:
                raise AccountError(409, "ACCOUNT_NOT_DELETED", "该账号未被删除")
            values, event = {"deleted_at": None}, "account_restored"
        else:
            if row.deleted_at is not None:
                raise AccountError(409, "ACCOUNT_DELETED", "请先恢复账号再操作")
            values, event = {
                "archive": (
                    {"status": "archived", "archived_at": row.archived_at or self.auth.now},
                    "account_archived",
                ),
                "delete": ({"deleted_at": self.auth.now}, "account_deleted"),
                "mark-verified": ({"last_verified_at": self.auth.now}, "account_updated"),
                "mark-logged-in": ({"last_login_at": self.auth.now}, "account_updated"),
            }[action]
        self.cas(row, version, values)
        self.audit(event, account_id, operation=action)
        return self.detail(account_id)

    def reveal(self, account_id: UUID):
        self.auth.require_recent(self.session)
        row = self.record(account_id)
        if row.deleted_at is not None:
            raise AccountError(409, "ACCOUNT_DELETED", "请先恢复账号再查看密码")
        password = self.auth.encryption.decrypt(
            EncryptedValue(row.password_ciphertext, row.password_nonce, row.password_key_version),
            "gmail_account",
            row.id,
            "password",
        )
        self.audit("password_revealed", account_id)
        return PasswordResponse(password=password)

    def copied(self, account_id: UUID):
        self.auth.require_recent(self.session)
        row = self.record(account_id)
        if row.deleted_at is not None:
            raise AccountError(409, "ACCOUNT_DELETED", "请先恢复账号再操作")
        self.audit("password_copied", account_id)

    @staticmethod
    def tag_response(row: Tag):
        return TagResponse(id=row.id, name=row.name, created_at=row.created_at)

    def tags(self):
        return [self.tag_response(row) for row in self.db.scalars(select(Tag).order_by(Tag.name))]

    def save_tag(self, name: str, tag_id: UUID | None = None):
        row = self.db.get(Tag, tag_id) if tag_id else Tag()
        if row is None:
            raise AccountError(404, "TAG_NOT_FOUND", "标签不存在")
        row.name = name.strip()
        self.db.add(row)
        self.flush(tag=True)
        self.audit("tag_updated" if tag_id else "tag_created")
        return self.tag_response(row)

    def delete_tag(self, tag_id: UUID):
        row = self.db.get(Tag, tag_id)
        if row is None:
            raise AccountError(404, "TAG_NOT_FOUND", "标签不存在")
        owners = select(gmail_account_tags.c.account_id).where(
            gmail_account_tags.c.tag_id == tag_id
        )
        changed = self.db.scalars(
            update(GmailAccount)
            .where(GmailAccount.id.in_(owners))
            .values(row_version=GmailAccount.row_version + 1, updated_at=self.auth.now)
            .returning(GmailAccount.id)
        ).all()
        self.db.delete(row)
        self.flush()
        for account_id in changed:
            self.audit("account_updated", account_id, operation="tag-deleted")
        self.audit("tag_deleted")
