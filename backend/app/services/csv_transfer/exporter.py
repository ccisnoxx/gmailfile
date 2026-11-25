"""非敏感白名单 CSV 导出服务。"""

import csv
import io

from app.models import GmailAccount
from app.schemas.accounts import AccountQuery
from app.schemas.operations import ExportInput
from app.services.accounts import AccountService
from app.services.csv_transfer.parser import EXPORT_FIELDS, spreadsheet_safe


def export_csv(auth, body: ExportInput) -> bytes:
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
