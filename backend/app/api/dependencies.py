from fastapi import Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.auth import AUTH_LOCK, AuthService, SecurityError

ACCOUNT_WRITE_LOCK = 720241102


def auth_service(request: Request, response: Response):
    yield from _auth_service(request, response, lock_key=None)


def auth_state_service(request: Request, response: Response):
    yield from _auth_service(request, response, lock_key=AUTH_LOCK)


def account_write_auth(request: Request, response: Response):
    yield from _auth_service(request, response, lock_key=ACCOUNT_WRITE_LOCK)


def _auth_service(request: Request, response: Response, *, lock_key: int | None):
    failure = None
    with Session(request.app.state.engine) as db:
        with db.begin():
            if lock_key is not None:
                # 各自先取锁再读状态；认证转换和业务写入不共用一把锁。
                db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
            service = AuthService(
                db, request.app.state.settings, request.app.state.encryption, request, response
            )
            try:
                yield service
            except SecurityError as exc:
                # 失败记录与锁定也必须提交；其他异常回滚整个事务。
                failure = exc
        if failure:
            raise failure
