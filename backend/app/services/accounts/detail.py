"""账号详情、加密字段读写、版本保护（CAS）、批量更新及密码按需查看服务。"""

from uuid import UUID, uuid4

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from app.core.encryption import EncryptedValue
from app.models import (
    GmailAccount,
    GmailAccountApp,
    RegisteredApp,
    Tag,
    UserSession,
    gmail_account_tags,
)
from app.schemas.accounts import (
    AccountAppInput,
    AccountCreate,
    AccountDetail,
    AccountPatch,
    BatchInput,
    BatchPermanentDeleteInput,
    BatchResult,
    BatchStatus,
    BatchTags,
    PasswordResponse,
    SensitiveFieldsResponse,
    normalize_email,
)
from app.services.accounts.errors import AccountError, flush_unique
from app.services.accounts.listing import AccountQueryService
from app.services.auth import AuthService, SecurityError


class AccountDetailService:
    def __init__(self, auth: AuthService, session: UserSession, listing: AccountQueryService):
        self.auth = auth
        self.db = auth.db
        self.session = session
        self.listing = listing

    def audit(
        self, event: str, account_id: UUID | None = None, *, operation: str | None = None
    ) -> None:
        self.auth.audit(event, self.session, account_id=account_id, operation=operation)

    def status_values(self, row: GmailAccount, status: str) -> dict:
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
        summary = self.listing.summaries(account_id=account_id)[0]
        # 普通详情仅返回敏感字段是否存在，不解密手机号或敏感备注；需经独立 Step-Up 接口按需查看。
        return AccountDetail(
            **summary.model_dump(),
            has_phone=row.phone_ciphertext is not None,
            has_notes=row.notes_ciphertext is not None,
            phone=None,
            notes=None,
        )

    def recovery(
        self,
        account_id: UUID,
        email: str,
        recovery_id: UUID | None,
        external: str | None,
        *,
        current_recovery_id: UUID | None = None,
        check_incoming: bool = True,
    ) -> None:
        if recovery_id is not None and external is not None:
            raise AccountError(422, "RECOVERY_INVALID", "辅助邮箱不能同时填写外部地址和关联账号")
        if recovery_id is not None:
            target = self.record(recovery_id)
            if recovery_id == account_id:
                raise AccountError(422, "RECOVERY_INVALID", "辅助邮箱不能关联自身")
            if target.deleted_at is not None and recovery_id != current_recovery_id:
                raise AccountError(422, "RECOVERY_INVALID", "不能新关联已删除的辅助账号")
            external = target.gmail_email
        if external is not None and normalize_email(external) == normalize_email(email):
            raise AccountError(422, "RECOVERY_INVALID", "辅助邮箱不能与主邮箱相同")
        if check_incoming:
            # 主邮箱改名也不能使已有反向关联变成同一邮箱。
            incoming = self.db.scalars(
                select(GmailAccount).where(GmailAccount.recovery_account_id == account_id)
            )
            if any(row.gmail_email_normalized == normalize_email(email) for row in incoming):
                raise AccountError(422, "RECOVERY_INVALID", "该地址与关联账号的主邮箱相同")

    def encrypted(self, account_id: UUID, values: dict) -> None:
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

    def set_tags(self, account_id: UUID, tag_ids: list[UUID], *, verified: bool = False) -> None:
        ids = set(tag_ids)
        if not verified:
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

    def set_apps(self, account_id: UUID, items: list[AccountAppInput]) -> None:
        ids = {item.app_id for item in items}
        if ids:
            found = set(self.db.scalars(select(RegisteredApp.id).where(RegisteredApp.id.in_(ids))))
            if ids != found:
                raise AccountError(422, "APP_INVALID", "所选应用已不存在，请刷新后重试")
        existing = {
            row.app_id: row
            for row in self.db.scalars(
                select(GmailAccountApp).where(GmailAccountApp.account_id == account_id)
            )
        }
        desired = {item.app_id: item for item in items}
        for removed_id in set(existing) - set(desired):
            self.db.delete(existing[removed_id])
        for app_id, item in desired.items():
            prev = existing.get(app_id)
            if prev is None:
                self.db.add(
                    GmailAccountApp(
                        account_id=account_id,
                        app_id=app_id,
                        status=item.status,
                        note=item.note,
                        banned_at=self.auth.now if item.status == "banned" else None,
                        created_at=self.auth.now,
                        updated_at=self.auth.now,
                    )
                )
            elif prev.status != item.status or prev.note != item.note:
                prev.status = item.status
                prev.note = item.note
                if item.status == "banned":
                    if prev.banned_at is None:
                        prev.banned_at = self.auth.now
                else:
                    prev.banned_at = None
                prev.updated_at = self.auth.now

    def cas(self, row: GmailAccount, version: int, values: dict) -> None:
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

    def stage_create(self, body: AccountCreate) -> tuple[UUID, list[UUID]]:
        """校验、加密并暂存新账号与审计记录（供单条创建与批量 CSV 事务分批刷盘共用）。"""
        account_id = uuid4()
        self.recovery(
            account_id,
            body.gmail_email,
            body.recovery_account_id,
            body.recovery_email_external,
            check_incoming=False,
        )
        values = {key: getattr(body, key) for key in type(body).model_fields}
        tag_ids = list(dict.fromkeys(values.pop("tag_ids")))
        values.pop("apps", None)
        values["gmail_email_normalized"] = normalize_email(body.gmail_email)
        values["archived_at"] = self.auth.now if body.status == "archived" else None
        self.encrypted(account_id, values)
        self.db.add(GmailAccount(id=account_id, **values))
        self.audit("account_created", account_id)
        return account_id, tag_ids

    def create(self, body: AccountCreate) -> AccountDetail:
        account_id, tag_ids = self.stage_create(body)
        flush_unique(self.db)
        self.set_tags(account_id, tag_ids)
        if body.apps:
            self.set_apps(account_id, body.apps)
            self.db.flush()
        return self.detail(account_id)

    def patch_row(
        self, account_id: UUID, body: AccountPatch, *, verified_tags: bool = False
    ) -> UUID:
        row = self.record(account_id)
        if row.deleted_at is not None:
            raise AccountError(409, "ACCOUNT_DELETED", "请先恢复账号再编辑")
        values = {key: getattr(body, key) for key in body.model_fields_set if key != "row_version"}
        if "password" in values:
            # 覆盖已有 Gmail 密码属于不可逆秘密修改，要求最近重新验证（生产强制 MFA Step-Up）。
            self.auth.require_recent(
                self.session, require_mfa=self.auth.settings.step_up_totp_required
            )
        self.recovery(
            account_id,
            values.get("gmail_email", row.gmail_email),
            values.get("recovery_account_id", row.recovery_account_id),
            values.get("recovery_email_external", row.recovery_email_external),
            current_recovery_id=row.recovery_account_id,
        )
        if "gmail_email" in values:
            values["gmail_email_normalized"] = normalize_email(values["gmail_email"])
        if "status" in values:
            values.update(self.status_values(row, values["status"]))
        tag_ids = values.pop("tag_ids", None)
        app_items = values.pop("apps", None)
        self.encrypted(account_id, values)
        try:
            self.cas(row, body.row_version, values)
            if tag_ids is not None:
                self.set_tags(account_id, tag_ids, verified=verified_tags)
            if app_items is not None:
                self.set_apps(account_id, app_items)
            flush_unique(self.db)
        except IntegrityError as exc:
            if exc.orig.sqlstate == "23505":
                raise AccountError(409, "ACCOUNT_EMAIL_DUPLICATE", "该邮箱已存在") from None
            raise
        self.audit("account_updated", account_id)
        return account_id

    def patch(self, account_id: UUID, body: AccountPatch) -> AccountDetail:
        return self.detail(self.patch_row(account_id, body))

    def action(self, account_id: UUID, version: int, action: str) -> AccountDetail:
        row = self.record(account_id)
        if action == "restore":
            if row.deleted_at is None:
                raise AccountError(409, "ACCOUNT_NOT_DELETED", "该账号未被删除")
            values, event = {"deleted_at": None}, "account_restored"
        elif action == "unarchive":
            if row.deleted_at is not None:
                raise AccountError(409, "ACCOUNT_DELETED", "请先恢复账号再操作")
            if row.status != "archived":
                raise AccountError(409, "ACCOUNT_NOT_ARCHIVED", "该账号未归档")
            values, event = {"status": "normal", "archived_at": None}, "account_unarchived"
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

    def batch(self, body: BatchStatus | BatchTags) -> BatchResult:
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

    def batch_restore(self, body: BatchInput) -> BatchResult:
        # 回收站批量恢复：每条 CAS 与审计共用请求事务，任一冲突/未删除整批回滚。
        for item in sorted(body.accounts, key=lambda entry: entry.id):
            try:
                row = self.record(item.id)
                if row.deleted_at is None:
                    raise AccountError(409, "ACCOUNT_NOT_DELETED", "该账号未被删除")
                self.cas(row, item.row_version, {"deleted_at": None})
                self.audit("account_restored", row.id, operation="batch-restore")
            except AccountError as exc:
                exc.details = {
                    "account_id": str(item.id),
                    "expected_row_version": str(item.row_version),
                }
                raise
        return BatchResult(updated_ids=[item.id for item in body.accounts])

    def _purge_one(
        self,
        row: GmailAccount,
        version: int,
        *,
        operation: str,
        batch_ids: set[UUID] | None = None,
    ) -> None:
        if row.deleted_at is None:
            raise AccountError(
                409, "ACCOUNT_NOT_DELETED", "仅回收站中的账号支持永久删除，请先删除至回收站"
            )
        if row.row_version != version:
            raise AccountError(
                409, "ROW_VERSION_CONFLICT", "账号已被其他页面修改，请刷新最新版本后重试"
            )
        account_id = row.id
        email = row.gmail_email
        # 若其他账号将该账号设为站内辅助邮箱，转为外部辅助邮箱文本，保全其资料与 recovery_xor 约束。
        dependents = self.db.scalars(
            select(GmailAccount)
            .where(GmailAccount.recovery_account_id == account_id)
            .order_by(GmailAccount.id.asc())
        ).all()
        surviving_dep_ids: list[UUID] = []
        for dep in dependents:
            dep.recovery_account_id = None
            dep.recovery_email_external = email
            if batch_ids is None or dep.id not in batch_ids:
                dep.row_version += 1
                dep.updated_at = self.auth.now
                surviving_dep_ids.append(dep.id)
        if dependents:
            self.db.flush()
        for dep_id in surviving_dep_ids:
            self.audit("account_updated", dep_id, operation="recovery-unlinked")
        self.db.execute(
            delete(gmail_account_tags).where(gmail_account_tags.c.account_id == account_id)
        )
        self.db.execute(delete(GmailAccountApp).where(GmailAccountApp.account_id == account_id))
        deleted = self.db.execute(
            delete(GmailAccount).where(
                GmailAccount.id == account_id,
                GmailAccount.row_version == version,
                GmailAccount.deleted_at.is_not(None),
            )
        )
        if deleted.rowcount != 1:
            raise AccountError(
                409, "ROW_VERSION_CONFLICT", "账号已被其他页面修改，请刷新最新版本后重试"
            )
        self.db.expunge(row)
        self.audit("account_permanently_deleted", account_id, operation=operation)

    def permanent_delete(self, account_id: UUID, version: int) -> None:
        self.auth.require_recent(self.session, require_mfa=True)
        row = self.record(account_id)
        self._purge_one(row, version, operation="permanent-delete")

    def batch_permanent_delete(self, body: BatchPermanentDeleteInput) -> BatchResult:
        # 回收站批量永久删除：强制最近 5 分钟内 MFA Step-Up 与服务端确认短语校验，
        # 每条 CAS 与审计共用请求事务，任一冲突/未删除整批回滚。
        self.auth.require_recent(self.session, require_mfa=True)
        expected = f"DELETE {len(body.accounts)}"
        if body.confirmation != expected:
            self.audit(
                "permanent_delete_confirmation_failed",
                operation="batch-permanent-delete",
            )
            raise SecurityError(
                422,
                "INVALID_CONFIRMATION",
                f"请输入确认短语 {expected} 后再提交永久删除",
            )
        batch_ids = {entry.id for entry in body.accounts}
        for item in sorted(body.accounts, key=lambda entry: entry.id):
            try:
                row = self.record(item.id)
                self._purge_one(
                    row,
                    item.row_version,
                    operation="batch-permanent-delete",
                    batch_ids=batch_ids,
                )
            except AccountError as exc:
                exc.details = {
                    "account_id": str(item.id),
                    "expected_row_version": str(item.row_version),
                }
                raise
        return BatchResult(updated_ids=[item.id for item in body.accounts])

    def reveal(self, account_id: UUID) -> PasswordResponse:
        self.auth.require_recent(self.session, require_mfa=self.auth.settings.step_up_totp_required)
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

    def copied(self, account_id: UUID) -> None:
        self.auth.require_recent(self.session, require_mfa=self.auth.settings.step_up_totp_required)
        row = self.record(account_id)
        if row.deleted_at is not None:
            raise AccountError(409, "ACCOUNT_DELETED", "请先恢复账号再操作")
        self.audit("password_copied", account_id)

    def reveal_sensitive(self, account_id: UUID) -> SensitiveFieldsResponse:
        self.auth.require_recent(self.session, require_mfa=self.auth.settings.step_up_totp_required)
        row = self.record(account_id)
        if row.deleted_at is not None:
            raise AccountError(409, "ACCOUNT_DELETED", "请先恢复账号再查看敏感资料")
        values: dict[str, str | None] = {}
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
        self.audit("sensitive_fields_revealed", account_id, operation="reveal-sensitive")
        return SensitiveFieldsResponse(phone=values["phone"], notes=values["notes"])
