"""CSV 两阶段导入服务：签发内容绑定凭据并在事务保存点内原子提交。"""

import hashlib
import secrets
from datetime import timedelta

from sqlalchemy import delete, select

from app.models import CsvReceipt, Tag
from app.schemas.operations import CsvCommit, CsvOptions, CsvPreview
from app.services.accounts import AccountError, AccountService
from app.services.csv_transfer.analyzer import CsvImportAnalyzer
from app.services.csv_transfer.parser import issue


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
                options=CsvOptions(mapping=mapping, strategy=options.strategy).model_dump(),
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
                for plan in plans:
                    line, existing, model, tag_names = plan
                    if tag_names is not None:
                        ids = []
                        for name in tag_names:
                            tag = self.db.scalar(select(Tag).where(Tag.name == name))
                            ids.append(tag.id if tag else self.accounts.save_tag(name).id)
                        model.tag_ids = ids
                    if existing:
                        self.accounts.patch(existing.id, model)
                    else:
                        self.accounts.create(model)
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
