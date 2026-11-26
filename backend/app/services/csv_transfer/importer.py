"""CSV 两阶段导入服务：签发内容绑定凭据并在事务保存点内原子提交。"""

import hashlib
import secrets
from datetime import timedelta

from sqlalchemy import delete, select

from app.models import CsvReceipt, Tag, gmail_account_tags
from app.schemas.operations import CsvCommit, CsvOptions, CsvPreview
from app.services.accounts import AccountError, AccountService
from app.services.accounts.errors import flush_unique
from app.services.csv_transfer.analyzer import CsvImportAnalyzer
from app.services.csv_transfer.parser import issue

COMMIT_BATCH_SIZE = 500
_DEFAULT_ACCOUNT_CREATE = AccountService.create
_DEFAULT_ACCOUNT_PATCH = AccountService.patch


class CsvService:
    def __init__(self, auth):
        self.accounts = AccountService(auth)
        self.auth, self.db = auth, auth.db
        auth.require_recent(self.accounts.session)
        self.analyzer = CsvImportAnalyzer(self.accounts)

    def analyze(self, content: bytes, options: CsvOptions, *, default_time):
        return self.analyzer.analyze(content, options, default_time=default_time)

    def preview(self, content: bytes, options: CsvOptions) -> CsvPreview:
        mapping, columns, rows, errors, _, snapshot = self.analyze(
            content, options, default_time=self.auth.now
        )
        receipt = None
        self.db.execute(delete(CsvReceipt).where(CsvReceipt.expires_at <= self.auth.now))
        if not errors:
            receipt = CsvReceipt(
                session_id=self.accounts.session.id,
                file_digest=hashlib.sha256(content).digest(),
                options=CsvOptions(
                    mapping=mapping,
                    strategy=options.strategy,
                    skip_empty_fields=options.skip_empty_fields,
                ).model_dump(),
                snapshot=snapshot,
                created_at=self.auth.now,
                expires_at=self.auth.now + timedelta(minutes=10),
            )
            self.db.add(receipt)
            self.db.flush()
        return CsvPreview(
            receipt_id=receipt.id if receipt else None,
            expires_at=receipt.expires_at if receipt else None,
            mapping=mapping,
            strategy=options.strategy,
            skip_empty_fields=options.skip_empty_fields,
            columns=columns,
            rows=rows,
            errors=errors,
        )

    def commit(self, content: bytes, receipt_id) -> CsvCommit:
        receipt = self.db.scalar(
            select(CsvReceipt).where(CsvReceipt.id == receipt_id).with_for_update()
        )
        if (
            receipt is None
            or receipt.session_id != self.accounts.session.id
            or receipt.consumed_at
            or receipt.expires_at <= self.auth.now
            or not secrets.compare_digest(receipt.file_digest, hashlib.sha256(content).digest())
        ):
            return CsvCommit(
                status="rejected",
                errors=[issue(0, "file", "确认已失效、已提交或文件已改变，请重新预览")],
            )
        _, _, rows, errors, plans, snapshot = self.analyze(
            content, CsvOptions.model_validate(receipt.options), default_time=receipt.created_at
        )
        if errors:
            return CsvCommit(status="rejected", errors=errors)
        if snapshot != receipt.snapshot:
            changed = [
                issue(item[0], "row_version", "预览后记录或关联目标已变化，请重新预览")
                for item in snapshot
                if item not in receipt.snapshot
            ]
            return CsvCommit(
                status="rejected",
                errors=changed or [issue(0, "row_version", "预览后数据已变化，请重新预览")],
            )
        line = 0
        try:
            # Savepoint rolls back accounts, new tags and success audit together.
            with self.db.begin_nested():
                tag_cache = {t.name: t.id for t in self.db.scalars(select(Tag))}
                pending_tag_links: list[dict] = []
                staged_count = 0

                def _flush_staged() -> None:
                    nonlocal staged_count
                    if staged_count == 0:
                        return
                    flush_unique(self.db)
                    if pending_tag_links:
                        self.db.execute(gmail_account_tags.insert(), pending_tag_links)
                        pending_tag_links.clear()
                    staged_count = 0

                use_fast_create = type(self.accounts).create is _DEFAULT_ACCOUNT_CREATE
                use_fast_patch = type(self.accounts).patch is _DEFAULT_ACCOUNT_PATCH

                for plan in plans:
                    line, existing, model, tag_names = plan
                    if tag_names is not None:
                        ids = []
                        for name in tag_names:
                            tag_id = tag_cache.get(name)
                            if tag_id is None:
                                tag_id = self.accounts.save_tag(name).id
                                tag_cache[name] = tag_id
                            ids.append(tag_id)
                        model.tag_ids = ids
                    if existing:
                        _flush_staged()
                        if use_fast_patch:
                            self.accounts.details.patch_row(existing.id, model, verified_tags=True)
                        else:
                            self.accounts.patch(existing.id, model)
                    elif use_fast_create:
                        account_id, tag_ids = self.accounts.details.stage_create(model)
                        for tag_id in tag_ids:
                            pending_tag_links.append({"account_id": account_id, "tag_id": tag_id})
                        staged_count += 1
                        if staged_count >= COMMIT_BATCH_SIZE:
                            _flush_staged()
                    else:
                        _flush_staged()
                        self.accounts.create(model)
                _flush_staged()
                receipt.consumed_at = self.auth.now
                self.accounts.audit("csv_imported", operation="csv")
                self.db.flush()
        except AccountError:
            return CsvCommit(
                status="rejected",
                errors=[issue(line, "row", "提交时业务冲突，整批已回滚，请重新预览")],
            )
        return CsvCommit(
            status="committed",
            created=sum(r.action == "create" for r in rows),
            updated=sum(r.action == "update" for r in rows),
            skipped=sum(r.action == "skip" for r in rows),
        )
