from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import auth_service
from app.schemas.accounts import (
    AccountCreate,
    AccountDetail,
    AccountPage,
    AccountPatch,
    AccountQuery,
    BatchResult,
    BatchStatus,
    BatchTags,
    DashboardSummary,
    Input,
    OptionPage,
    PasswordResponse,
    RecoveryPage,
    SummaryQuery,
    TagInput,
    TagResponse,
    VersionInput,
)
from app.schemas.auth import ActionResponse
from app.schemas.system import ErrorResponse
from app.services.accounts import AccountService
from app.services.auth import AuthService

router = APIRouter(
    tags=["accounts"],
    responses={code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 500)},
)


def account_service(auth: Annotated[AuthService, Depends(auth_service, scope="function")]):
    return AccountService(auth)


Service = Annotated[AccountService, Depends(account_service)]


@router.get("/accounts", response_model=AccountPage, operation_id="accountsList")
def accounts(service: Service, params: Annotated[AccountQuery, Query()]):
    return service.page(params)


@router.get("/dashboard/summary", response_model=DashboardSummary, operation_id="dashboardSummary")
def summary(service: Service, params: Annotated[SummaryQuery, Query()]):
    return service.summary(params.timezone)


@router.get("/recovery-emails", response_model=RecoveryPage, operation_id="recoveryEmailsList")
def recovery_usage(
    service: Service, page: int = Query(1, ge=1), page_size: int = Query(30, ge=1, le=100)
):
    return service.recovery_usage(page, page_size)


@router.get("/accounts/options", response_model=OptionPage, operation_id="accountsOptions")
def options(
    service: Service,
    search: str = Query("", max_length=254),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    exclude_id: UUID | None = None,
):
    return service.options(search, page, page_size, exclude_id)


@router.post(
    "/accounts/batch-status", response_model=BatchResult, operation_id="accountsBatchStatus"
)
def batch_status(body: BatchStatus, service: Service):
    return service.batch(body)


@router.post("/accounts/batch-tags", response_model=BatchResult, operation_id="accountsBatchTags")
def batch_tags(body: BatchTags, service: Service):
    return service.batch(body)


@router.post(
    "/accounts", response_model=AccountDetail, status_code=201, operation_id="accountsCreate"
)
def create(body: AccountCreate, service: Service):
    return service.create(body)


@router.get("/accounts/{account_id}", response_model=AccountDetail, operation_id="accountsDetail")
def detail(account_id: UUID, service: Service):
    return service.detail(account_id)


@router.patch("/accounts/{account_id}", response_model=AccountDetail, operation_id="accountsPatch")
def patch(account_id: UUID, body: AccountPatch, service: Service):
    return service.patch(account_id, body)


@router.delete(
    "/accounts/{account_id}", response_model=AccountDetail, operation_id="accountsDelete"
)
def remove(account_id: UUID, body: VersionInput, service: Service):
    return service.action(account_id, body.row_version, "delete")


@router.post(
    "/accounts/{account_id}/archive", response_model=AccountDetail, operation_id="accountsArchive"
)
def archive(account_id: UUID, body: VersionInput, service: Service):
    return service.action(account_id, body.row_version, "archive")


@router.post(
    "/accounts/{account_id}/restore", response_model=AccountDetail, operation_id="accountsRestore"
)
def restore(account_id: UUID, body: VersionInput, service: Service):
    return service.action(account_id, body.row_version, "restore")


@router.post(
    "/accounts/{account_id}/mark-verified",
    response_model=AccountDetail,
    operation_id="accountsMarkVerified",
)
def verified(account_id: UUID, body: VersionInput, service: Service):
    return service.action(account_id, body.row_version, "mark-verified")


@router.post(
    "/accounts/{account_id}/mark-logged-in",
    response_model=AccountDetail,
    operation_id="accountsMarkLoggedIn",
)
def logged_in(account_id: UUID, body: VersionInput, service: Service):
    return service.action(account_id, body.row_version, "mark-logged-in")


@router.post(
    "/accounts/{account_id}/reveal-password",
    response_model=PasswordResponse,
    operation_id="accountsRevealPassword",
)
def reveal(account_id: UUID, body: Input, service: Service):
    return service.reveal(account_id)


@router.post(
    "/accounts/{account_id}/copy-password-event",
    response_model=ActionResponse,
    operation_id="accountsCopyPasswordEvent",
)
def copied(account_id: UUID, body: Input, service: Service):
    service.copied(account_id)
    return ActionResponse()


@router.get("/tags", response_model=list[TagResponse], operation_id="tagsList")
def tags(service: Service):
    return service.tags()


@router.post("/tags", response_model=TagResponse, status_code=201, operation_id="tagsCreate")
def tag_create(body: TagInput, service: Service):
    return service.save_tag(body.name)


@router.patch("/tags/{tag_id}", response_model=TagResponse, operation_id="tagsPatch")
def tag_patch(tag_id: UUID, body: TagInput, service: Service):
    return service.save_tag(body.name, tag_id)


@router.delete("/tags/{tag_id}", response_model=ActionResponse, operation_id="tagsDelete")
def tag_delete(tag_id: UUID, service: Service):
    service.delete_tag(tag_id)
    return ActionResponse()
