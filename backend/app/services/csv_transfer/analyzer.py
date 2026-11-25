"""CSV 导入映射解析、逐行校验、快照构建与写入计划生成。"""

import re
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import select

from app.models import GmailAccount
from app.schemas.accounts import (
    AccountCreate,
    AccountPatch,
    TagInput,
    email_value,
    normalize_email,
)
from app.schemas.operations import CsvColumn, CsvRow
from app.services.accounts import AccountError, AccountService
from app.services.csv_transfer.parser import FIELDS, issue, parse_csv


class CsvImportAnalyzer:
    def __init__(self, accounts: AccountService):
        self.accounts = accounts
        self.db = accounts.db

    def _resolve_mapping(
        self, headers: list[str], requested: dict[str, int] | None
    ) -> tuple[list[CsvColumn], dict[str, int]]:
        columns = [
            CsvColumn(index=i, suggested_field=h.strip() if h.strip() in FIELDS else None)
            for i, h in enumerate(headers)
        ]
        mapping = requested
        if mapping is None:
            mapping = {}
            for column in columns:
                if column.suggested_field and column.suggested_field not in mapping:
                    mapping[column.suggested_field] = column.index
        if any(i >= len(headers) for i in mapping.values()):
            raise AccountError(422, "CSV_MAPPING_INVALID", "映射列必须存在")
        return columns, mapping

    def _collect_scalar_fields(
        self, line: int, values: dict[str, str], existing: GmailAccount | None, row_errors: list
    ) -> dict:
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
        return data

    def _resolve_recovery(
        self,
        line: int,
        values: dict[str, str],
        mapping: dict[str, int],
        data: dict,
        snapshot: list,
        row_errors: list,
    ) -> None:
        if "recovery_email" not in mapping and "recovery_account" not in mapping:
            return
        recovery = values.get("recovery_email", "").strip()
        link = values.get("recovery_account", "").strip()
        data.update(recovery_account_id=None, recovery_email_external=recovery or None)
        if link:
            target = None
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
                    issue(line, "recovery_account", "关联目标必须是数据库中未删除的账号")
                )
            else:
                data["recovery_account_id"] = target.id
                snapshot.append([line, "recovery", str(target.id), target.row_version])
        if not recovery and not link:
            row_errors.append(issue(line, "recovery_email", "辅助邮箱不能为空"))

    @staticmethod
    def _parse_tags(line: int, raw: str, row_errors: list) -> list[str]:
        tag_names = list(dict.fromkeys(n.strip() for n in raw.split("|") if n.strip()))
        try:
            if len(tag_names) > 100:
                raise ValueError
            for name in tag_names:
                TagInput(name=name)
        except (ValidationError, ValueError):
            row_errors.append(issue(line, "tags", "标签最多100个，每个1至50字符"))
        return tag_names

    def _build_model(
        self, line: int, existing: GmailAccount | None, data: dict, default_time, row_errors: list
    ):
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
            return model
        except ValidationError as exc:
            for error in exc.errors(include_input=False, include_context=False, include_url=False):
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
        return None

    def analyze(self, content: bytes, options, *, default_time):
        headers, rows = parse_csv(content)
        columns, mapping = self._resolve_mapping(headers, options.mapping)
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
                data = self._collect_scalar_fields(line, values, existing, row_errors)
                self._resolve_recovery(line, values, mapping, data, snapshot, row_errors)
                tag_names = (
                    self._parse_tags(line, values["tags"], row_errors)
                    if "tags" in mapping
                    else None
                )
                model = self._build_model(line, existing, data, default_time, row_errors)
                if not row_errors and model is not None:
                    plans.append((line, existing, model, tag_names))
            results.append(CsvRow(row=line, action="error" if row_errors else action))
            errors.extend(row_errors)
        return mapping, columns, results, errors, plans, snapshot
