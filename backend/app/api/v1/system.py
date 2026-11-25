from fastapi import APIRouter, HTTPException, Request
from sqlalchemy.exc import SQLAlchemyError

from app.db.schema import schema_is_current
from app.schemas.system import ErrorResponse, HealthResponse

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live", response_model=HealthResponse, operation_id="health_live")
def live() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get(
    "/ready",
    response_model=HealthResponse,
    responses={503: {"model": ErrorResponse}},
    operation_id="health_ready",
)
def ready(request: Request) -> HealthResponse:
    try:
        if not schema_is_current(request.app.state.engine):
            raise HTTPException(status_code=503)
    except SQLAlchemyError:
        raise HTTPException(status_code=503) from None
    return HealthResponse(status="ready")
