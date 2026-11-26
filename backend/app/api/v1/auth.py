from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from app.api.dependencies import auth_service, auth_state_service
from app.schemas.auth import (
    ActionResponse,
    ChangePasswordInput,
    ConfirmInput,
    Credentials,
    DisableTotpResponse,
    RecoveryResponse,
    ReverifyInput,
    SessionResponse,
    SetupInput,
    SetupResponse,
    WebAuthnAuthVerifyInput,
    WebAuthnChallengeResponse,
    WebAuthnCredentialItem,
    WebAuthnRegisterVerifyInput,
    WebAuthnRegisterVerifyResponse,
    WebAuthnRenameInput,
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
    return service.reverify(body.password.get_secret_value(), body.totp_code.get_secret_value())


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


@router.post(
    "/totp/disable",
    response_model=DisableTotpResponse,
    responses={409: {"model": ErrorResponse}},
    operation_id="authTotpDisable",
)
def totp_disable(service: Service):
    return service.disable_totp()


@router.get(
    "/webauthn/credentials",
    response_model=list[WebAuthnCredentialItem],
    operation_id="authWebauthnCredentialsList",
)
def webauthn_credentials(service: ActivityService):
    return service.webauthn_list()


@router.post(
    "/webauthn/register/options",
    response_model=WebAuthnChallengeResponse,
    responses={409: {"model": ErrorResponse}},
    operation_id="authWebauthnRegisterOptions",
)
def webauthn_register_options(service: Service):
    return service.webauthn_register_options()


@router.post(
    "/webauthn/register/verify",
    response_model=WebAuthnRegisterVerifyResponse,
    responses={409: {"model": ErrorResponse}},
    operation_id="authWebauthnRegisterVerify",
)
def webauthn_register_verify(body: WebAuthnRegisterVerifyInput, service: Service):
    return service.webauthn_register_verify(body.challenge_id, body.label, body.credential)


@router.patch(
    "/webauthn/credentials/{credential_id}",
    response_model=WebAuthnCredentialItem,
    responses={404: {"model": ErrorResponse}},
    operation_id="authWebauthnCredentialRename",
)
def webauthn_credential_rename(credential_id: UUID, body: WebAuthnRenameInput, service: Service):
    return service.webauthn_rename(credential_id, body.label)


@router.delete(
    "/webauthn/credentials/{credential_id}",
    response_model=ActionResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
    operation_id="authWebauthnCredentialDelete",
)
def webauthn_credential_delete(credential_id: UUID, service: Service):
    service.webauthn_delete(credential_id)
    return ActionResponse()


@router.post(
    "/webauthn/login/options",
    response_model=WebAuthnChallengeResponse,
    responses={404: {"model": ErrorResponse}},
    operation_id="authWebauthnLoginOptions",
)
def webauthn_login_options(service: Service):
    return service.webauthn_login_options()


@router.post(
    "/webauthn/login/verify",
    response_model=SessionResponse,
    operation_id="authWebauthnLoginVerify",
)
def webauthn_login_verify(body: WebAuthnAuthVerifyInput, service: Service):
    return service.webauthn_login_verify(body.challenge_id, body.credential)


@router.post(
    "/webauthn/step-up/options",
    response_model=WebAuthnChallengeResponse,
    responses={404: {"model": ErrorResponse}},
    operation_id="authWebauthnStepUpOptions",
)
def webauthn_step_up_options(service: Service):
    return service.webauthn_step_up_options()


@router.post(
    "/webauthn/step-up/verify",
    response_model=SessionResponse,
    operation_id="authWebauthnStepUpVerify",
)
def webauthn_step_up_verify(body: WebAuthnAuthVerifyInput, service: Service):
    return service.webauthn_step_up_verify(body.challenge_id, body.credential)
