"""标签管理服务：查询、创建/重命名与删除（联动递增账号版本）。"""

from uuid import UUID

from sqlalchemy import select, update

from app.models import GmailAccount, Tag, UserSession, gmail_account_tags
from app.schemas.accounts import TagResponse
from app.services.accounts.errors import AccountError, flush_unique
from app.services.auth import AuthService


class TagService:
    def __init__(self, auth: AuthService, session: UserSession):
        self.auth = auth
        self.db = auth.db
        self.session = session

    @staticmethod
    def tag_response(row: Tag) -> TagResponse:
        return TagResponse(id=row.id, name=row.name, created_at=row.created_at)

    def list_tags(self) -> list[TagResponse]:
        return [self.tag_response(row) for row in self.db.scalars(select(Tag).order_by(Tag.name))]

    def save_tag(self, name: str, tag_id: UUID | None = None) -> TagResponse:
        row = self.db.get(Tag, tag_id) if tag_id else Tag()
        if row is None:
            raise AccountError(404, "TAG_NOT_FOUND", "标签不存在")
        row.name = name.strip()
        self.db.add(row)
        flush_unique(self.db, tag=True)
        self.auth.audit("tag_updated" if tag_id else "tag_created", self.session)
        return self.tag_response(row)

    def delete_tag(self, tag_id: UUID) -> None:
        row = self.db.get(Tag, tag_id)
        if row is None:
            raise AccountError(404, "TAG_NOT_FOUND", "标签不存在")
        owners = select(gmail_account_tags.c.account_id).where(
            gmail_account_tags.c.tag_id == tag_id
        )
        changed = self.db.scalars(
            update(GmailAccount)
            .where(GmailAccount.id.in_(owners))
            .values(row_version=GmailAccount.row_version + 1, updated_at=self.auth.now)
            .returning(GmailAccount.id)
        ).all()
        self.db.delete(row)
        flush_unique(self.db)
        for account_id in changed:
            self.auth.audit(
                "account_updated", self.session, account_id=account_id, operation="tag-deleted"
            )
        self.auth.audit("tag_deleted", self.session)
