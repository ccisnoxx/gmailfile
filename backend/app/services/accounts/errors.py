"""账号与标签业务异常、写锁常量及唯一约束处理。"""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

ACCOUNT_WRITE_LOCK = 720241102


class AccountError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        self.status, self.code, self.message = status, code, message
        self.details = details or {}


def flush_unique(db: Session, *, tag: bool = False) -> None:
    try:
        db.flush()
    except IntegrityError as exc:
        if exc.orig.sqlstate == "23505":
            raise AccountError(
                409,
                "TAG_DUPLICATE" if tag else "ACCOUNT_EMAIL_DUPLICATE",
                "该标签已存在" if tag else "该邮箱已存在",
            ) from None
        raise
