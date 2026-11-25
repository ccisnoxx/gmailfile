"""CSV 严格解析、字段白名单与电子表格公式注入防护。"""

import csv
import io
from typing import get_args

from app.schemas.operations import CsvField, CsvIssue
from app.services.accounts import AccountError

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


def issue(row: int, field: str, reason: str) -> CsvIssue:
    return CsvIssue(row=row, field=field, reason=reason)


def parse_csv(content: bytes) -> tuple[list[str], list[list[str]]]:
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


def spreadsheet_safe(value) -> str:
    text = str(value) if value is not None else ""
    # Excel also ignores leading whitespace/control characters before formula prefixes.
    if text.lstrip().startswith(("=", "+", "-", "@")) or text.startswith(("\t", "\r", "\n")):
        return "'" + text
    return text
