from fastapi import Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.auth import AUTH_LOCK, AuthService, SecurityError


def auth_service(request: Request, response: Response):
    failure = None
    with Session(request.app.state.engine) as db:
        with db.begin():
            # 单管理员低并发：统一锁顺序，序列化恢复码消费、TOTP 防重放、轮换及撤销。
            db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": AUTH_LOCK})
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
