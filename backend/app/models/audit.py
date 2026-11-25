from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    FetchedValue,
    ForeignKey,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import CreatedMixin, IdentityMixin


class AuditEvent(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        UniqueConstraint("seq"),
        CheckConstraint("seq >= 1", name="seq_positive"),
        CheckConstraint("octet_length(prev_hash) = 32", name="prev_hash_length"),
        CheckConstraint("octet_length(event_hash) = 32", name="event_hash_length"),
    )

    seq: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=FetchedValue())
    prev_hash: Mapped[bytes] = mapped_column(
        LargeBinary, nullable=False, server_default=FetchedValue()
    )
    event_hash: Mapped[bytes] = mapped_column(
        LargeBinary, nullable=False, server_default=FetchedValue()
    )
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    account_id: Mapped[UUID | None] = mapped_column(ForeignKey("gmail_accounts.id"), index=True)
    session_id: Mapped[UUID | None] = mapped_column(ForeignKey("user_sessions.id"))
    ip_address: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(Text)
    event_metadata: Mapped[dict] = mapped_column(
        "metadata", JSONB, server_default=text("'{}'::jsonb")
    )
