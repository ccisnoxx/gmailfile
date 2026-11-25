from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query, Response
from pydantic import Json

from app.api.dependencies import account_write_auth, auth_service
from app.schemas.operations import CsvCommit, CsvOptions, CsvPreview, ExportInput
from app.schemas.system import ErrorResponse
from app.services.auth import AuthService
from app.services.csv_transfer import CsvService, export_csv

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
    response_class=Response,
    responses={200: {"content": {"text/csv": {"schema": {"type": "string", "format": "binary"}}}}},
    operation_id="csvExport",
)
def export(service: Service, body: ExportInput):
    data = export_csv(service, body)
    name = "gmail-accounts-" + service.now.strftime("%Y-%m-%dT%H%M%SZ") + ".csv"
    return Response(
        data,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )
