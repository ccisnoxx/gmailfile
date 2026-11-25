from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.schemas.system import ErrorDetail, ErrorResponse


def error_response(
    request: Request,
    status: int,
    code: str,
    message: str,
    headers: dict[str, str] | None = None,
    details: dict | None = None,
) -> JSONResponse:
    payload = ErrorResponse(
        error=ErrorDetail(code=code, message=message, details=details or {}),
        request_id=request.state.request_id,
    )
    return JSONResponse(status_code=status, content=payload.model_dump(), headers=headers)


async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
    messages = {
        401: ("AUTH_REQUIRED", "请先登录"),
        403: ("FORBIDDEN", "请求未获授权"),
        404: ("NOT_FOUND", "请求的资源不存在"),
        405: ("METHOD_NOT_ALLOWED", "不支持该请求方法"),
        503: ("SERVICE_UNAVAILABLE", "服务尚未就绪"),
    }
    code, message = messages.get(exc.status_code, ("REQUEST_FAILED", "请求失败"))
    return error_response(request, exc.status_code, code, message, headers=exc.headers)


async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Pydantic 的原始错误可能携带密码等 input，不能直接返回或记录。
    details = {}
    if request.url.path in {"/api/v1/accounts/batch-status", "/api/v1/accounts/batch-tags"}:
        # 只返回已知字段路径和行索引，不返回 input、任意字段名或原始异常。
        location = exc.errors()[0]["loc"]
        fields = {"accounts", "id", "row_version", "status", "tag_ids"}
        details["field"] = (
            ".".join(str(part) for part in location if isinstance(part, int) or part in fields)
            or "accounts"
        )
        if len(location) > 2 and location[1] == "accounts" and isinstance(location[2], int):
            details["account_index"] = str(location[2])
    return error_response(request, 422, "VALIDATION_ERROR", "请求参数格式不正确", details=details)
