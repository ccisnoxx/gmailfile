from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    LargeBinary,
    SmallInteger,
    String,
    Table,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import CreatedMixin, IdentityMixin, UpdatedMixin


def optional_cipher_constraint(field: str) -> CheckConstraint:
    return CheckConstraint(
        f"({field}_ciphertext IS NULL AND {field}_nonce IS NULL "
        f"AND {field}_key_version IS NULL) OR "
        f"({field}_ciphertext IS NOT NULL AND octet_length({field}_ciphertext) >= 16 "
        f"AND {field}_nonce IS NOT NULL AND octet_length({field}_nonce) = 12 "
        f"AND {field}_key_version IS NOT NULL AND {field}_key_version >= 1)",
        name=f"{field}_cipher_bundle",
    )


class GmailAccount(IdentityMixin, UpdatedMixin, Base):
    __tablename__ = "gmail_accounts"
    __table_args__ = (
        UniqueConstraint("gmail_email_normalized"),
        CheckConstraint(
            "NOT (recovery_account_id IS NOT NULL AND recovery_email_external IS NOT NULL)",
            name="recovery_xor",
        ),
        CheckConstraint("recovery_account_id <> id", name="recovery_not_self"),
        CheckConstraint("row_version >= 1", name="row_version"),
        CheckConstraint(
            "status IN ('normal','pending_verification','restricted',"
            "'login_failed','disabled','archived')",
            name="status",
        ),
        CheckConstraint("two_factor_status IN ('unknown','disabled','enabled')", name="two_factor"),
        CheckConstraint(
            "(status = 'archived') = (archived_at IS NOT NULL)", name="archive_consistency"
        ),
        CheckConstraint("octet_length(password_nonce) = 12", name="password_nonce_length"),
        CheckConstraint(
            "octet_length(password_ciphertext) >= 16", name="password_ciphertext_length"
        ),
        CheckConstraint("password_key_version >= 1", name="password_key_version"),
        optional_cipher_constraint("phone"),
        optional_cipher_constraint("notes"),
    )

    account_no: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    gmail_email: Mapped[str] = mapped_column(Text)
    gmail_email_normalized: Mapped[str] = mapped_column(Text)
    password_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    password_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    password_key_version: Mapped[int] = mapped_column(SmallInteger)
    registered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    recovery_account_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("gmail_accounts.id"), index=True
    )
    recovery_email_external: Mapped[str | None] = mapped_column(Text, index=True)
    phone_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    phone_nonce: Mapped[bytes | None] = mapped_column(LargeBinary)
    phone_key_version: Mapped[int | None] = mapped_column(SmallInteger)
    status: Mapped[str] = mapped_column(
        String(32), server_default="pending_verification", index=True
    )
    two_factor_status: Mapped[str] = mapped_column(String(16), server_default="unknown")
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    purpose: Mapped[str | None] = mapped_column(String(100))
    notes_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    notes_nonce: Mapped[bytes | None] = mapped_column(LargeBinary)
    notes_key_version: Mapped[int | None] = mapped_column(SmallInteger)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    row_version: Mapped[int] = mapped_column(server_default=text("1"))


class Tag(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "tags"

    name: Mapped[str] = mapped_column(String(50), unique=True)


gmail_account_tags = Table(
    "gmail_account_tags",
    Base.metadata,
    Column("account_id", ForeignKey("gmail_accounts.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class RegisteredApp(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "registered_apps"
    __table_args__ = (
        UniqueConstraint("name_normalized"),
        CheckConstraint("btrim(name) <> ''", name="name_nonempty"),
        CheckConstraint("name_normalized = lower(btrim(name))", name="name_normalized"),
        CheckConstraint("domain IS NULL OR btrim(domain) <> ''", name="domain_nonempty"),
        CheckConstraint(
            "icon_data IS NULL OR ("
            "octet_length(icon_data) <= 98304 "
            "AND icon_data ~ '^data:image/(png|jpeg|webp|gif|x-icon|"
            "vnd\\.microsoft\\.icon);base64,[A-Za-z0-9+/=]+$'"
            ")",
            name="icon_data_format",
        ),
    )

    name: Mapped[str] = mapped_column(String(64))
    name_normalized: Mapped[str] = mapped_column(String(64))
    domain: Mapped[str | None] = mapped_column(String(255))
    icon_data: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(SmallInteger, server_default=text("100"))


class GmailAccountApp(UpdatedMixin, Base):
    __tablename__ = "gmail_account_apps"
    __table_args__ = (
        CheckConstraint("status IN ('active','restricted','banned')", name="status"),
        Index("ix_gmail_account_apps_app_id_status", "app_id", "status"),
    )

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("gmail_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    app_id: Mapped[UUID] = mapped_column(
        ForeignKey("registered_apps.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[str] = mapped_column(String(24), server_default="active")
    note: Mapped[str | None] = mapped_column(String(200))
    banned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
