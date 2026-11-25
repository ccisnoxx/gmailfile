from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import auth_service, auth_state_service
from app.schemas.auth import (
    ActionResponse,
    ChangePasswordInput,
    ConfirmInput,
    Credentials,
    RecoveryResponse,
    ReverifyInput,
    SessionResponse,
    SetupInput,
    SetupResponse,
)
from app.schemas.system import ErrorResponse
from app.services.auth import AuthService

router = APIRouter(
    prefix="/auth",
    tags=["auth"],
    responses={
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
    },
)
Service = Annotated[AuthService, Depends(auth_state_service, scope="function")]
ActivityService = Annotated[AuthService, Depends(auth_service, scope="function")]


@router.get("/session", response_model=SessionResponse, operation_id="authSession")
def session(service: Service):
    return service.session()


@router.post("/activity", response_model=SessionResponse, operation_id="authActivity")
def activity(service: ActivityService):
    row = service.require_session(full=False)
    return service.state(row, service.request.headers["x-csrf-token"])


@router.post("/login", response_model=SessionResponse, operation_id="authLogin")
def login(body: Credentials, service: Service):
    return service.login(
        body.password.get_secret_value(),
        body.totp_code.get_secret_value(),
        body.recovery_code.get_secret_value(),
    )


@router.post("/logout", response_model=ActionResponse, operation_id="authLogout")
def logout(service: Service):
    service.logout()
    return ActionResponse()


@router.post("/reverify", response_model=SessionResponse, operation_id="authReverify")
def reverify(body: ReverifyInput, service: Service):
    return service.reverify(body.password.get_secret_value())


@router.post("/totp/setup", response_model=SetupResponse, operation_id="authTotpSetup")
def setup(body: SetupInput, service: Service):
    return service.setup(
        body.password.get_secret_value(),
        body.totp_code.get_secret_value(),
        body.recovery_code.get_secret_value(),
    )


@router.post("/totp/confirm", response_model=RecoveryResponse, operation_id="authTotpConfirm")
def confirm(body: ConfirmInput, service: Service):
    return service.confirm(body.code.get_secret_value())


@router.post(
    "/totp/regenerate-recovery-codes",
    response_model=RecoveryResponse,
    operation_id="authRegenerateRecoveryCodes",
)
def regenerate(body: Credentials, service: Service):
    return service.regenerate(
        body.password.get_secret_value(),
        body.totp_code.get_secret_value(),
        body.recovery_code.get_secret_value(),
    )


@router.post("/password", response_model=ActionResponse, operation_id="authChangePassword")
def password(body: ChangePasswordInput, service: Service):
    service.change_password(body.password.get_secret_value(), body.new_password.get_secret_value())
    return ActionResponse()
