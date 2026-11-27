from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import account_write_auth, auth_service
from app.schemas.accounts import (
    AccountCreate,
    AccountDetail,
    AccountPage,
    AccountPatch,
    AccountQuery,
    AppIconFetchInput,
    AppIconFetchResponse,
    BatchInput,
    BatchPermanentDeleteInput,
    BatchResult,
    BatchStatus,
    BatchTags,
    DashboardRecoveryUsageResponse,
    DashboardSummary,
    Input,
    OptionPage,
    PasswordResponse,
    RecoveryPage,
    RecoverySort,
    RegisteredAppInput,
    RegisteredAppResponse,
    RegisteredAppUsage,
    RegistrationTrendResponse,
    SensitiveFieldsResponse,
    Sort,
    StatusDistributionResponse,
    SummaryQuery,
    TagInput,
    TagResponse,
    TrendQuery,
    VersionInput,
)
from app.schemas.auth import ActionResponse
from app.schemas.system import ErrorResponse
from app.services.accounts import AccountError, AccountService
from app.services.accounts.app_icon import try_acquire_icon_fetch_slot
from app.services.auth import AuthService

router = APIRouter(
    tags=["accounts"],
    responses={code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 500)},
)


def account_service(auth: Annotated[AuthService, Depends(auth_service, scope="function")]):
    return AccountService(auth)


def account_write_service(
    auth: Annotated[AuthService, Depends(account_write_auth, scope="function")],
):
    return AccountService(auth)


Service = Annotated[AccountService, Depends(account_service)]
WriteService = Annotated[AccountService, Depends(account_write_service)]


@router.get("/accounts", response_model=AccountPage, operation_id="accountsList")
def accounts(service: Service, params: Annotated[AccountQuery, Query()]):
    return service.page(params)


@router.get("/dashboard/summary", response_model=DashboardSummary, operation_id="dashboardSummary")
def summary(service: Service, params: Annotated[SummaryQuery, Query()]):
    return service.summary(params.timezone)


@router.get(
    "/dashboard/registration-trend",
    response_model=RegistrationTrendResponse,
    operation_id="dashboardRegistrationTrend",
)
def registration_trend(service: Service, params: Annotated[TrendQuery, Query()]):
    return service.registration_trend(params.timezone, params.months)


@router.get(
    "/dashboard/status-distribution",
    response_model=StatusDistributionResponse,
    operation_id="dashboardStatusDistribution",
)
def status_distribution(service: Service):
    return service.status_distribution()


@router.get(
    "/dashboard/recovery-email-usage",
    response_model=DashboardRecoveryUsageResponse,
    operation_id="dashboardRecoveryEmailUsage",
)
def dashboard_recovery_usage(
    service: Service,
    limit: Annotated[int, Query(ge=1, le=20)] = 10,
):
    return service.dashboard_recovery_usage(limit)


@router.get("/recovery-emails", response_model=RecoveryPage, operation_id="recoveryEmailsList")
def recovery_usage(
    service: Service,
    page: Annotated[int, Query(ge=1, le=1000000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 30,
    search: Annotated[str, Query(max_length=254)] = "",
    sort: Annotated[RecoverySort, Query()] = "-account_count",
):
    return service.recovery_usage(page, page_size, search=search, sort=sort)


@router.get(
    "/recovery-emails/{encoded_email}/accounts",
    response_model=AccountPage,
    operation_id="recoveryEmailAccounts",
)
def recovery_email_accounts(
    encoded_email: str,
    service: Service,
    page: Annotated[int, Query(ge=1, le=1000000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 30,
    sort: Annotated[Sort, Query()] = "-account_no",
):
    return service.recovery_email_accounts(encoded_email, page=page, page_size=page_size, sort=sort)


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
def batch_status(body: BatchStatus, service: WriteService):
    return service.batch(body)


@router.post("/accounts/batch-tags", response_model=BatchResult, operation_id="accountsBatchTags")
def batch_tags(body: BatchTags, service: WriteService):
    return service.batch(body)


@router.post(
    "/accounts/batch-restore", response_model=BatchResult, operation_id="accountsBatchRestore"
)
def batch_restore(body: BatchInput, service: WriteService):
    return service.batch_restore(body)


@router.post(
    "/accounts/batch-permanent-delete",
    response_model=BatchResult,
    operation_id="accountsBatchPermanentDelete",
)
def batch_permanent_delete(body: BatchPermanentDeleteInput, service: WriteService):
    return service.batch_permanent_delete(body)


@router.post(
    "/accounts", response_model=AccountDetail, status_code=201, operation_id="accountsCreate"
)
def create(body: AccountCreate, service: WriteService):
    return service.create(body)


@router.get("/accounts/{account_id}", response_model=AccountDetail, operation_id="accountsDetail")
def detail(account_id: UUID, service: Service):
    return service.detail(account_id)


@router.patch("/accounts/{account_id}", response_model=AccountDetail, operation_id="accountsPatch")
def patch(account_id: UUID, body: AccountPatch, service: WriteService):
    return service.patch(account_id, body)


@router.delete(
    "/accounts/{account_id}", response_model=AccountDetail, operation_id="accountsDelete"
)
def remove(account_id: UUID, body: VersionInput, service: WriteService):
    return service.action(account_id, body.row_version, "delete")


@router.delete(
    "/accounts/{account_id}/permanent",
    response_model=ActionResponse,
    operation_id="accountsPermanentDelete",
)
def permanent_remove(account_id: UUID, body: VersionInput, service: WriteService):
    service.permanent_delete(account_id, body.row_version)
    return ActionResponse()


@router.post(
    "/accounts/{account_id}/archive", response_model=AccountDetail, operation_id="accountsArchive"
)
def archive(account_id: UUID, body: VersionInput, service: WriteService):
    return service.action(account_id, body.row_version, "archive")


@router.post(
    "/accounts/{account_id}/unarchive",
    response_model=AccountDetail,
    operation_id="accountsUnarchive",
)
def unarchive(account_id: UUID, body: VersionInput, service: WriteService):
    return service.action(account_id, body.row_version, "unarchive")


@router.post(
    "/accounts/{account_id}/restore", response_model=AccountDetail, operation_id="accountsRestore"
)
def restore(account_id: UUID, body: VersionInput, service: WriteService):
    return service.action(account_id, body.row_version, "restore")


@router.post(
    "/accounts/{account_id}/mark-verified",
    response_model=AccountDetail,
    operation_id="accountsMarkVerified",
)
def verified(account_id: UUID, body: VersionInput, service: WriteService):
    return service.action(account_id, body.row_version, "mark-verified")


@router.post(
    "/accounts/{account_id}/mark-logged-in",
    response_model=AccountDetail,
    operation_id="accountsMarkLoggedIn",
)
def logged_in(account_id: UUID, body: VersionInput, service: WriteService):
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


@router.post(
    "/accounts/{account_id}/reveal-sensitive",
    response_model=SensitiveFieldsResponse,
    operation_id="accountsRevealSensitive",
)
def reveal_sensitive(account_id: UUID, body: Input, service: Service):
    return service.reveal_sensitive(account_id)


@router.get("/tags", response_model=list[TagResponse], operation_id="tagsList")
def tags(service: Service):
    return service.tags()


@router.post("/tags", response_model=TagResponse, status_code=201, operation_id="tagsCreate")
def tag_create(body: TagInput, service: WriteService):
    return service.save_tag(body.name)


@router.patch("/tags/{tag_id}", response_model=TagResponse, operation_id="tagsPatch")
def tag_patch(tag_id: UUID, body: TagInput, service: WriteService):
    return service.save_tag(body.name, tag_id)


@router.delete("/tags/{tag_id}", response_model=ActionResponse, operation_id="tagsDelete")
def tag_delete(tag_id: UUID, service: WriteService):
    service.delete_tag(tag_id)
    return ActionResponse()


@router.get("/apps", response_model=list[RegisteredAppResponse], operation_id="appsList")
def apps(service: Service):
    return service.apps()


@router.get("/apps/usage", response_model=list[RegisteredAppUsage], operation_id="appsUsage")
def apps_usage(service: Service):
    return service.apps_usage()


@router.post(
    "/apps/fetch-icon",
    response_model=AppIconFetchResponse,
    responses={429: {"model": ErrorResponse}},
    operation_id="appsFetchIcon",
)
def app_fetch_icon(body: AppIconFetchInput, service: Service):
    slot = try_acquire_icon_fetch_slot(service.auth.request.app.state.icon_fetch_semaphore)
    if slot is None:
        raise AccountError(
            429, "APP_ICON_FETCH_BUSY", "当前已有多个应用图标抓取正在进行，请稍后重试"
        )
    try:
        return service.fetch_app_icon(body.domain)
    finally:
        slot.release()


@router.post(
    "/apps", response_model=RegisteredAppResponse, status_code=201, operation_id="appsCreate"
)
def app_create(body: RegisteredAppInput, service: WriteService):
    return service.save_app(body)


@router.patch("/apps/{app_id}", response_model=RegisteredAppResponse, operation_id="appsPatch")
def app_patch(app_id: UUID, body: RegisteredAppInput, service: WriteService):
    return service.save_app(body, app_id)


@router.delete("/apps/{app_id}", response_model=ActionResponse, operation_id="appsDelete")
def app_delete(app_id: UUID, service: WriteService):
    service.delete_app(app_id)
    return ActionResponse()
