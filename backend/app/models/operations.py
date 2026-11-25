"""两阶段导入只保存确认绑定，不持久化原始 CSV 或敏感字段。"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, LargeBinary
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import CreatedMixin, IdentityMixin


class CsvReceipt(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "csv_receipts"
    __table_args__ = (CheckConstraint("octet_length(file_digest) = 32", name="file_digest_length"),)

    session_id: Mapped[UUID] = mapped_column(ForeignKey("user_sessions.id"), index=True)
    file_digest: Mapped[bytes] = mapped_column(LargeBinary)
    options: Mapped[dict] = mapped_column(JSONB)
    snapshot: Mapped[list] = mapped_column(JSONB)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
