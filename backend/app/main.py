import logging
from contextlib import asynccontextmanager
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException

from app.api.v1.accounts import router as accounts_router
from app.api.v1.auth import router as auth_router
from app.api.v1.operations import router as operations_router
from app.api.v1.system import router
from app.api.v1.transfers import router as transfers_router
from app.core.config import Settings
from app.core.encryption import DecryptionError, EncryptionService
from app.core.errors import error_response, http_error, validation_error
from app.core.logging import configure_logging
from app.core.upload import CsvUploadLimit
from app.db.schema import schema_is_current
from app.db.session import create_database_engine
from app.schemas.system import ErrorResponse
from app.services.accounts import AccountError
from app.services.auth import SecurityError


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.validate_secret_files()
        app.state.encryption = EncryptionService(
            settings.data_key_directory, settings.active_data_key_version
        )
        configure_logging()
        app.state.engine = create_database_engine(settings)
        try:
            if not schema_is_current(app.state.engine):
                raise RuntimeError("数据库迁移未完成，拒绝启动 API")
            yield
        finally:
            app.state.engine.dispose()

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        debug=settings.debug,
        docs_url="/api/docs" if settings.expose_api_docs else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.expose_api_docs else None,
        lifespan=lifespan,
        responses={422: {"model": ErrorResponse}},
    )
    app.state.settings = settings

    async def security_error(request: Request, exc: SecurityError):
        return error_response(
            request, exc.status, exc.code, exc.message, details=getattr(exc, "details", {})
        )

    async def decryption_error(request: Request, exc: DecryptionError):
        return error_response(request, 500, "DECRYPTION_FAILED", "无法读取敏感数据，请联系管理员")

    app.add_exception_handler(SecurityError, security_error)
    app.add_exception_handler(AccountError, security_error)
    app.add_exception_handler(DecryptionError, decryption_error)
    app.add_exception_handler(HTTPException, http_error)
    app.add_exception_handler(RequestValidationError, validation_error)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request.state.request_id = str(uuid4())
        started = perf_counter()
        try:
            if request.url.hostname not in settings.hosts:
                response = error_response(request, 400, "INVALID_HOST", "请求主机不受信任")
            else:
                response = await call_next(request)
        except Exception as exc:
            logging.getLogger("gmail_manager").error(
                "request_failed", extra={"safe_fields": {"exception_type": type(exc).__name__}}
            )
            response = error_response(request, 500, "INTERNAL_ERROR", "服务暂时无法处理请求")
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["Cache-Control"] = "no-store"
        logging.getLogger("gmail_manager").info(
            "request_completed",
            extra={
                "safe_fields": {
                    "request_id": request.state.request_id,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "duration_ms": round((perf_counter() - started) * 1000, 2),
                }
            },
        )
        return response

    app.add_middleware(CsvUploadLimit, max_bytes=settings.max_import_size_mb * 1024 * 1024)
    app.include_router(operations_router, prefix="/api/v1")
    app.include_router(transfers_router, prefix="/api/v1")
    app.include_router(router, prefix="/api/v1")
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(accounts_router, prefix="/api/v1")
    return app
