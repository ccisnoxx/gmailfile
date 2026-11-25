from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query, Response
from fastapi.responses import StreamingResponse
from pydantic import Json
from starlette.background import BackgroundTask

from app.api.dependencies import account_write_auth, auth_service
from app.schemas.operations import CsvCommit, CsvOptions, CsvPreview, ExportInput
from app.schemas.system import ErrorResponse
from app.services.accounts import AccountService
from app.services.auth import AuthService, SecurityError
from app.services.csv_transfer import (
    CsvService,
    resolve_export_query,
    stream_export_csv,
    try_acquire_export_slot,
)

router = APIRouter(
    tags=["transfers"],
    responses={
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        413: {"model": ErrorResponse},
        415: {"model": ErrorResponse},
    },
)
Service = Annotated[AuthService, Depends(auth_service, scope="function")]
WriteService = Annotated[AuthService, Depends(account_write_auth, scope="function")]
CsvBody = Annotated[bytes, Body(media_type="text/csv")]


@router.post("/imports/csv/preview", response_model=CsvPreview, operation_id="csvPreview")
def preview(
    service: Service,
    body: CsvBody,
    options: Annotated[Json[CsvOptions], Query(default_factory=CsvOptions)],
):
    return CsvService(service).preview(body, options)


@router.post(
    "/imports/csv/commit",
    response_model=CsvCommit,
    responses={409: {"model": CsvCommit}},
    operation_id="csvCommit",
)
def commit(service: WriteService, body: CsvBody, receipt_id: UUID, response: Response):
    result = CsvService(service).commit(body, receipt_id)
    if result.status == "rejected":
        response.status_code = 409
    return result


@router.post(
    "/exports/csv",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/csv": {"schema": {"type": "string", "format": "binary"}}}}},
    operation_id="csvExport",
)
def export(service: Service, body: ExportInput):
    # 在返回流式响应前先申请并发槽位，再于请求事务内完成认证/CSRF 校验与审计落盘。
    slot = try_acquire_export_slot(service.request.app.state.export_semaphore)
    if slot is None:
        raise SecurityError(429, "EXPORT_BUSY", "当前已有多个 CSV 导出正在进行，请稍后重试")
    try:
        account_service = AccountService(service)
        params = resolve_export_query(body)
        account_service.audit("csv_exported", operation="csv")
        name = "gmail-accounts-" + service.now.strftime("%Y-%m-%dT%H%M%SZ") + ".csv"
        return StreamingResponse(
            stream_export_csv(
                service.request.app.state.engine,
                params,
                on_close=slot.release,
            ),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
            background=BackgroundTask(slot.release),
        )
    except BaseException:
        slot.release()
        raise
