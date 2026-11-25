from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import auth_service
from app.schemas.auth import ActionResponse
from app.schemas.operations import (
    AuditPage,
    AuditQuery,
    BackupStatus,
    IdleSetting,
    SessionPage,
    SettingsState,
    VersionState,
)
from app.schemas.system import ErrorResponse
from app.services.auth import AuthService
from app.services.operations import OperationsService

router = APIRouter(
    tags=["operations"], responses={401: {"model": ErrorResponse}, 403: {"model": ErrorResponse}}
)
Service = Annotated[AuthService, Depends(auth_service, scope="function")]


@router.get("/auth/sessions", response_model=SessionPage, operation_id="sessionsList")
def sessions(
    service: Service,
    page: int = Query(1, ge=1, le=1000000),
    page_size: int = Query(30, ge=1, le=100),
):
    return OperationsService(service).sessions(page, page_size)


@router.delete(
    "/auth/sessions/others", response_model=ActionResponse, operation_id="sessionsRevokeOthers"
)
def revoke_others(service: Service):
    OperationsService(service).revoke()
    return ActionResponse()


@router.delete(
    "/auth/sessions/{session_id}", response_model=ActionResponse, operation_id="sessionsRevoke"
)
def revoke(service: Service, session_id: UUID):
    OperationsService(service).revoke(session_id)
    return ActionResponse()


@router.get("/audit-events", response_model=AuditPage, operation_id="auditsList")
def audits(service: Service, params: Annotated[AuditQuery, Query()]):
    return OperationsService(service).audits(params)


@router.get("/settings", response_model=SettingsState, operation_id="settingsGet")
def settings(service: Service):
    return OperationsService(service).settings()


@router.patch("/settings/idle", response_model=SettingsState, operation_id="settingsIdle")
def idle(service: Service, body: IdleSetting):
    return OperationsService(service).set_idle(body.idle_minutes)


@router.get("/system/version", response_model=VersionState, operation_id="systemVersion")
def version(service: Service):
    return OperationsService(service).version()


@router.get("/system/backup-status", response_model=BackupStatus, operation_id="backupStatus")
def backup(service: Service):
    return OperationsService(service).backup_status()
