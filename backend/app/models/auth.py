from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import CreatedMixin, IdentityMixin, UpdatedMixin


class AdminUser(IdentityMixin, UpdatedMixin, Base):
    __tablename__ = "admin_users"
    __table_args__ = (
        CheckConstraint("singleton = true", name="single_admin"),
        CheckConstraint(
            "session_idle_minutes IS NULL OR session_idle_minutes BETWEEN 1 AND 720",
            name="idle_minutes_range",
        ),
        CheckConstraint(
            "(totp_secret_ciphertext IS NULL AND totp_secret_nonce IS NULL "
            "AND totp_secret_key_version IS NULL) OR "
            "(totp_secret_ciphertext IS NOT NULL AND octet_length(totp_secret_ciphertext) >= 16 "
            "AND totp_secret_nonce IS NOT NULL AND octet_length(totp_secret_nonce) = 12 "
            "AND totp_secret_key_version IS NOT NULL AND totp_secret_key_version >= 1)",
            name="totp_cipher_bundle",
        ),
        CheckConstraint(
            "NOT totp_enabled OR totp_secret_ciphertext IS NOT NULL", name="totp_enabled"
        ),
    )

    session_idle_minutes: Mapped[int | None] = mapped_column(Integer)
    singleton: Mapped[bool] = mapped_column(unique=True, server_default=text("true"))
    password_hash: Mapped[str] = mapped_column(Text)
    totp_secret_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    totp_secret_nonce: Mapped[bytes | None] = mapped_column(LargeBinary)
    totp_secret_key_version: Mapped[int | None] = mapped_column(SmallInteger)
    totp_enabled: Mapped[bool] = mapped_column(server_default=text("false"))
    totp_last_accepted_step: Mapped[int | None] = mapped_column(BigInteger)
    password_changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AdminRecoveryCode(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "admin_recovery_codes"

    admin_user_id: Mapped[UUID] = mapped_column(ForeignKey("admin_users.id"), index=True)
    code_hash: Mapped[str] = mapped_column(Text)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UserSession(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "user_sessions"
    __table_args__ = (
        CheckConstraint("octet_length(token_hash) = 32", name="token_hash_length"),
        CheckConstraint("octet_length(csrf_token_hash) = 32", name="csrf_hash_length"),
        CheckConstraint("expires_at > created_at", name="expires_after_creation"),
        CheckConstraint(
            "(pending_totp_ciphertext IS NULL AND pending_totp_nonce IS NULL "
            "AND pending_totp_key_version IS NULL AND pending_totp_expires_at IS NULL) OR "
            "(pending_totp_ciphertext IS NOT NULL AND octet_length(pending_totp_ciphertext) >= 16 "
            "AND pending_totp_nonce IS NOT NULL AND octet_length(pending_totp_nonce) = 12 "
            "AND pending_totp_key_version IS NOT NULL AND pending_totp_key_version >= 1 "
            "AND pending_totp_expires_at IS NOT NULL)",
            name="pending_totp_bundle",
        ),
        CheckConstraint("auth_level IN ('mfa_pending', 'authenticated')", name="auth_level"),
    )

    pending_totp_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    pending_totp_nonce: Mapped[bytes | None] = mapped_column(LargeBinary)
    pending_totp_key_version: Mapped[int | None] = mapped_column(SmallInteger)
    pending_totp_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    admin_user_id: Mapped[UUID] = mapped_column(ForeignKey("admin_users.id"), index=True)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    csrf_token_hash: Mapped[bytes] = mapped_column(LargeBinary)
    auth_level: Mapped[str] = mapped_column(String(16), server_default="mfa_pending")
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    reauthenticated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    mfa_reauthenticated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ip_address: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(Text)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PreAuthSession(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "pre_auth_sessions"
    __table_args__ = (
        CheckConstraint("octet_length(token_hash) = 32", name="token_hash_length"),
        CheckConstraint("octet_length(csrf_token_hash) = 32", name="csrf_hash_length"),
    )

    token_hash: Mapped[bytes] = mapped_column(LargeBinary)
    csrf_token_hash: Mapped[bytes] = mapped_column(LargeBinary)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class AuthThrottle(Base):
    __tablename__ = "auth_throttles"
    __table_args__ = (CheckConstraint("failures >= 0", name="failures_nonnegative"),)

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    failures: Mapped[int]
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    blocked_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AdminWebAuthnCredential(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "admin_webauthn_credentials"
    __table_args__ = (
        CheckConstraint("sign_count >= 0", name="sign_count_nonnegative"),
        CheckConstraint(
            "octet_length(credential_id) BETWEEN 16 AND 1024", name="credential_id_length"
        ),
        CheckConstraint("octet_length(public_key) >= 16", name="public_key_length"),
    )

    admin_user_id: Mapped[UUID] = mapped_column(ForeignKey("admin_users.id"), index=True)
    credential_id: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    public_key: Mapped[bytes] = mapped_column(LargeBinary)
    sign_count: Mapped[int] = mapped_column(BigInteger, server_default=text("0"))
    label: Mapped[str] = mapped_column(String(64))
    transports: Mapped[list[str]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    aaguid: Mapped[str | None] = mapped_column(String(36))
    discoverable: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    backup_eligible: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    backup_state: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WebAuthnChallenge(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "webauthn_challenges"
    __table_args__ = (
        CheckConstraint(
            "purpose IN ('register', 'login', 'mfa_login', 'step_up')", name="purpose_valid"
        ),
        CheckConstraint("octet_length(challenge) = 32", name="challenge_length"),
        CheckConstraint(
            "(pre_auth_session_id IS NOT NULL) <> (user_session_id IS NOT NULL)",
            name="session_binding_xor",
        ),
    )

    purpose: Mapped[str] = mapped_column(String(24))
    challenge: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    pre_auth_session_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("pre_auth_sessions.id", ondelete="CASCADE"), index=True
    )
    user_session_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("user_sessions.id", ondelete="CASCADE"), index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
