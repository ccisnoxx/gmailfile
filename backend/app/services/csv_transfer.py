"""CSV confirmation is content-bound; only non-sensitive receipts survive a request."""

import csv
import hashlib
import io
import re
import secrets
from datetime import timedelta
from typing import get_args
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import delete, select

from app.models import CsvReceipt, GmailAccount, Tag
from app.schemas.accounts import (
    AccountCreate,
    AccountPatch,
    AccountQuery,
    TagInput,
    email_value,
    normalize_email,
)
from app.schemas.operations import (
    CsvColumn,
    CsvCommit,
    CsvField,
    CsvIssue,
    CsvOptions,
    CsvPreview,
    CsvRow,
    ExportInput,
)
from app.services.accounts import AccountError, AccountService

FIELDS = set(get_args(CsvField))
EXPORT_FIELDS = (
    "account_no",
    "gmail_email",
    "registered_at",
    "recovery_email",
    "status",
    "two_factor_status",
    "last_login_at",
    "last_verified_at",
    "password_changed_at",
    "purpose",
    "tags",
    "archived_at",
    "deleted_at",
    "created_at",
    "updated_at",
)


def issue(row, field, reason):
    return CsvIssue(row=row, field=field, reason=reason)


def parse_csv(content: bytes):
    # Size alone does not bound row/column objects: a 10 MiB file can contain millions.
    # Bound the confirmation transaction and per-row response at this untrusted boundary.
    try:
        text = content.decode("utf-8-sig")
        if "\x00" in text:
            raise ValueError
        reader = csv.reader(io.StringIO(text, newline=""), strict=True)
        header = next(reader)
        if not header or not any(header):
            raise ValueError
        if len(header) > 256:
            raise AccountError(422, "CSV_COLUMNS_EXCEEDED", "单个CSV最多256列，请移除无关列")
        rows = []
        for row in reader:
            if len(rows) >= 10000:
                raise AccountError(422, "CSV_ROWS_EXCEEDED", "单次最多10000条记录，请拆分文件导入")
            if len(row) != len(header):
                raise ValueError
            rows.append(row)
        if not rows:
            raise ValueError
        return header, rows
    except (UnicodeError, csv.Error, ValueError, StopIteration):
        raise AccountError(
            422, "CSV_INVALID", "文件必须是可解析的 UTF-8 CSV，且每行列数一致"
        ) from None


class CsvService:
    def __init__(self, auth):
        self.accounts = AccountService(auth)
        self.auth, self.db = auth, auth.db
        auth.require_recent(self.accounts.session)

    def analyze(self, content, options, *, default_time):
        headers, rows = parse_csv(content)
        columns = [
            CsvColumn(index=i, suggested_field=h.strip() if h.strip() in FIELDS else None)
            for i, h in enumerate(headers)
        ]
        mapping = options.mapping
        if mapping is None:
            mapping = {}
            for column in columns:
                if column.suggested_field and column.suggested_field not in mapping:
                    mapping[column.suggested_field] = column.index
        if any(i >= len(headers) for i in mapping.values()):
            raise AccountError(422, "CSV_MAPPING_INVALID", "映射列必须存在")
        if "gmail_email" not in mapping:
            return mapping, columns, [], [issue(0, "gmail_email", "请先映射 Gmail 地址列")], [], []
        results, errors, plans, snapshot = [], [], [], []
        seen = set()
        for line, cells in enumerate(rows, 2):
            values = {field: cells[index] for field, index in mapping.items()}
            row_errors = []
            try:
                email_value(values["gmail_email"])
                email = normalize_email(values["gmail_email"])
            except ValueError:
                errors.append(issue(line, "gmail_email", "邮箱格式不正确"))
                results.append(CsvRow(row=line, action="error"))
                continue
            if email in seen:
                action = "error" if options.strategy == "error" else "skip"
                if action == "error":
                    errors.append(issue(line, "gmail_email", "文件内规范化地址重复"))
                results.append(CsvRow(row=line, action=action))
                continue
            seen.add(email)
            existing = self.db.scalar(
                select(GmailAccount).where(GmailAccount.gmail_email_normalized == email)
            )
            target = None
            snapshot.append(
                [
                    line,
                    "account",
                    str(existing.id) if existing else None,
                    existing.row_version if existing else None,
                ]
            )
            if existing and options.strategy == "error":
                row_errors.append(
                    issue(line, "gmail_email", "数据库中已有该规范化地址（含软删除）")
                )
            action = "update" if existing else "create"
            if existing and options.strategy == "skip":
                action = "skip"
            if action != "skip":
                if existing and existing.deleted_at:
                    row_errors.append(
                        issue(line, "gmail_email", "已软删除账号不能由导入更新，请先恢复")
                    )
                account_no = values.pop("account_no", "").strip()
                if account_no and (not existing or account_no != f"GM-{existing.account_no:06d}"):
                    row_errors.append(
                        issue(line, "account_no", "编号只可留空或匹配已有账号，不能指定新编号")
                    )
                data = {}
                for field, value in values.items():
                    if field in {"recovery_email", "recovery_account", "tags"}:
                        continue
                    if field == "password" and not value:
                        continue  # Update preserves password; create validation requires it.
                    if not value and field in {"registered_at", "status", "two_factor_status"}:
                        if existing:
                            row_errors.append(issue(line, field, "必填字段不能清空"))
                        continue  # Create uses documented defaults.
                    data[field] = value if value else None
                recovery = values.get("recovery_email", "").strip()
                link = values.get("recovery_account", "").strip()
                if "recovery_email" in mapping or "recovery_account" in mapping:
                    data.update(recovery_account_id=None, recovery_email_external=recovery or None)
                    if link:
                        if re.fullmatch(r"GM-[0-9]+", link):
                            target = self.db.scalar(
                                select(GmailAccount).where(GmailAccount.account_no == int(link[3:]))
                            )
                        else:
                            try:
                                email_value(link)
                                target = self.db.scalar(
                                    select(GmailAccount).where(
                                        GmailAccount.gmail_email_normalized == normalize_email(link)
                                    )
                                )
                            except ValueError:
                                pass
                        if target is None or target.deleted_at:
                            row_errors.append(
                                issue(
                                    line, "recovery_account", "关联目标必须是数据库中未删除的账号"
                                )
                            )
                        else:
                            data["recovery_account_id"] = target.id
                            snapshot.append([line, "recovery", str(target.id), target.row_version])
                    if not recovery and not link:
                        row_errors.append(issue(line, "recovery_email", "辅助邮箱不能为空"))
                tag_names = None
                if "tags" in mapping:
                    tag_names = list(
                        dict.fromkeys(n.strip() for n in values["tags"].split("|") if n.strip())
                    )
                    try:
                        if len(tag_names) > 100:
                            raise ValueError
                        for name in tag_names:
                            TagInput(name=name)
                    except (ValidationError, ValueError):
                        row_errors.append(issue(line, "tags", "标签最多100个，每个1至50字符"))
                try:
                    if existing:
                        model = AccountPatch(row_version=existing.row_version, **data)
                    else:
                        data.setdefault("registered_at", default_time)
                        model = AccountCreate(**data)
                    self.accounts.recovery(
                        existing.id if existing else uuid4(),
                        model.gmail_email or existing.gmail_email,
                        data.get(
                            "recovery_account_id",
                            existing.recovery_account_id if existing else None,
                        ),
                        data.get(
                            "recovery_email_external",
                            existing.recovery_email_external if existing else None,
                        ),
                    )
                except ValidationError as exc:
                    for error in exc.errors(
                        include_input=False, include_context=False, include_url=False
                    ):
                        field = error["loc"][0] if error["loc"] else "recovery_email"
                        row_errors.append(
                            issue(
                                line,
                                field if field in FIELDS else "row",
                                "字段格式不正确或不符合必填规则",
                            )
                        )
                except AccountError:
                    row_errors.append(issue(line, "recovery_email", "辅助邮箱关联不符合业务规则"))
                if not row_errors:
                    plans.append((line, existing, model, tag_names))
            results.append(CsvRow(row=line, action="error" if row_errors else action))
            errors.extend(row_errors)
        return mapping, columns, results, errors, plans, snapshot

    def preview(self, content, options):
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

    def commit(self, content, receipt_id):
        receipt = self.db.get(CsvReceipt, receipt_id)
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


def spreadsheet_safe(value):
    text = str(value) if value is not None else ""
    # Excel also ignores leading whitespace/control characters before formula prefixes.
    if text.lstrip().startswith(("=", "+", "-", "@")) or text.startswith(("\t", "\r", "\n")):
        return "'" + text
    return text


def export_csv(auth, body: ExportInput):
    service = AccountService(auth)
    params = body.filters if body.scope == "filtered" else AccountQuery()
    column = getattr(GmailAccount, params.sort.lstrip("-"))
    order = column.desc() if params.sort.startswith("-") else column.asc()
    # No LIMIT/OFFSET: exports all matching rows, not only the current page.
    records = service.db.execute(
        service.repo.filtered(params).order_by(order.nulls_last(), GmailAccount.id)
    ).all()
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(EXPORT_FIELDS)
    for record in service.serialize(records):
        values = record.model_dump(mode="json")
        values["tags"] = "|".join(t.name for t in record.tags)
        writer.writerow([spreadsheet_safe(values[name]) for name in EXPORT_FIELDS])
    service.audit("csv_exported", operation="csv")
    return ("\ufeff" + output.getvalue()).encode("utf-8")
