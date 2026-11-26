import json
from datetime import timedelta

from sqlalchemy import func, select, update

from app.core.release_meta import APP_VERSION
from app.core.user_agent import parse_stored_device
from app.models import AuditEvent, UserSession
from app.schemas.operations import (
    AuditIntegrityResponse,
    AuditItem,
    AuditPage,
    BackupStatus,
    SessionItem,
    SessionPage,
    SettingsState,
    VersionState,
)
from app.services.accounts import AccountError
from app.services.audit_integrity import verify_audit_chain
from app.services.auth import AUDIT_EVENTS, AUDIT_OPERATIONS


class OperationsService:
    def __init__(self, auth):
        self.auth, self.db = auth, auth.db
        # Viewing/revoking devices must not renew the caller's idle lease.
        self.session = auth.require_session(csrf=auth.request.method != "GET", touch=False)

    def sessions(self, page, page_size, *, active_only: bool = False):
        idle_minutes = self.auth.idle_minutes()
        reauth_window = timedelta(minutes=self.auth.settings.reauth_window_minutes)
        query = select(UserSession).where(UserSession.admin_user_id == self.session.admin_user_id)
        if active_only:
            query = query.where(
                UserSession.revoked_at.is_(None),
                UserSession.expires_at > self.auth.now,
                UserSession.last_seen_at > self.auth.now - timedelta(minutes=idle_minutes),
            )
        total = self.db.scalar(select(func.count()).select_from(query.subquery()))
        rows = self.db.scalars(
            query.order_by(UserSession.created_at.desc(), UserSession.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = []
        for row in rows:
            idle = min(row.expires_at, row.last_seen_at + timedelta(minutes=idle_minutes))
            state = (
                "revoked"
                if row.revoked_at
                else "absolute_expired"
                if row.expires_at <= self.auth.now
                else "idle_expired"
                if idle <= self.auth.now
                else "valid"
            )
            device = parse_stored_device(row.user_agent)
            mfa_active = bool(
                row.mfa_reauthenticated_at
                and row.mfa_reauthenticated_at + reauth_window > self.auth.now
            )
            items.append(
                SessionItem(
                    id=row.id,
                    current=row.id == self.session.id,
                    state=state,
                    auth_level=row.auth_level,
                    created_at=row.created_at,
                    last_seen_at=row.last_seen_at,
                    expires_at=row.expires_at,
                    idle_expires_at=idle,
                    revoked_at=row.revoked_at,
                    ip_address=str(row.ip_address) if row.ip_address else None,
                    device_label=device.label,
                    browser=device.browser,
                    os=device.os,
                    device_type=device.device_type,
                    mfa_reauthenticated=mfa_active,
                )
            )
        return SessionPage(items=items, total=total, page=page, page_size=page_size)

    def revoke(self, session_id=None):
        self.auth.require_recent(self.session)
        if session_id is None:
            self.auth.revoke_others(self.session)
        else:
            row = self.db.get(UserSession, session_id)
            if row is None or row.admin_user_id != self.session.admin_user_id:
                raise AccountError(404, "SESSION_NOT_FOUND", "会话不存在")
            row.revoked_at = row.revoked_at or self.auth.now
            self.auth.clear_pending(row)
            if row.id == self.session.id:
                self.auth.response.delete_cookie(
                    self.auth.cookie_name,
                    secure=self.auth.settings.session_cookie_secure,
                    httponly=True,
                    samesite="strict",
                    path="/",
                )
        self.auth.audit(
            "session_revoked",
            self.session,
            operation="revoke-others" if session_id is None else "revoke-session",
        )

    def audits(self, params):
        if params.event_type is not None and params.event_type not in AUDIT_EVENTS:
            raise AccountError(422, "AUDIT_FILTER_INVALID", "事件类型不在白名单中")
        query = select(AuditEvent).where(AuditEvent.event_type.in_(AUDIT_EVENTS))
        for field in ("event_type", "account_id", "session_id"):
            if (value := getattr(params, field)) is not None:
                query = query.where(getattr(AuditEvent, field) == value)
        if params.created_from:
            query = query.where(AuditEvent.created_at >= params.created_from)
        if params.created_to:
            query = query.where(AuditEvent.created_at < params.created_to)
        total = self.db.scalar(select(func.count()).select_from(query.subquery()))
        rows = self.db.scalars(
            query.order_by(AuditEvent.seq.desc())
            .offset((params.page - 1) * params.page_size)
            .limit(params.page_size)
        )
        return AuditPage(
            items=[
                AuditItem(
                    id=r.id,
                    seq=r.seq,
                    event_hash=bytes(r.event_hash).hex(),
                    event_type=r.event_type,
                    account_id=r.account_id,
                    session_id=r.session_id,
                    ip_address=str(r.ip_address) if r.ip_address else None,
                    created_at=r.created_at,
                    operation=r.event_metadata.get("operation")
                    if r.event_metadata.get("operation") in AUDIT_OPERATIONS
                    else None,
                )
                for r in rows
            ],
            total=total,
            page=params.page,
            page_size=params.page_size,
            event_types=sorted(AUDIT_EVENTS),
        )

    def audit_integrity(self) -> AuditIntegrityResponse:
        status = verify_audit_chain(self.db)
        return AuditIntegrityResponse(
            valid=status.valid,
            total_events=status.total_events,
            latest_seq=status.latest_seq,
            latest_hash=status.latest_hash,
            broken_seq=status.broken_seq,
            reason=status.reason,
            retention_days=self.auth.settings.audit_retention_days,
        )

    def settings(self):
        return SettingsState(idle_minutes=self.auth.idle_minutes())

    def set_idle(self, minutes):
        self.auth.require_recent(self.session)
        # Increasing the limit must not resurrect sessions already idle-expired under the old rule.
        self.db.execute(
            update(UserSession)
            .where(
                UserSession.revoked_at.is_(None),
                UserSession.last_seen_at
                <= self.auth.now - timedelta(minutes=self.auth.idle_minutes()),
            )
            .values(
                revoked_at=self.auth.now,
                pending_totp_ciphertext=None,
                pending_totp_nonce=None,
                pending_totp_key_version=None,
                pending_totp_expires_at=None,
            )
        )
        self.auth.admin().session_idle_minutes = minutes
        self.auth.audit("settings_changed", self.session, operation="idle-timeout")
        return self.settings()

    def version(self):
        # Build version is maintained source, schema version is read from the live connection.
        from sqlalchemy import text

        return VersionState(
            version=APP_VERSION,
            schema_version=self.db.scalar(text("SELECT version_num FROM alembic_version")),
        )

    def backup_status(self):
        path = self.auth.settings.backup_status_file
        if path is None:
            return BackupStatus(state="unconfigured")
        try:
            if not path.exists():
                return BackupStatus(state="never_run")
            if path.stat().st_size > 16384:
                raise ValueError
            data = json.loads(path.read_text())
            result = BackupStatus.model_validate(data)
            if (result.state == "success" and not result.last_success_at) or (
                result.state == "running" and not result.last_attempt_at
            ):
                raise ValueError
            last = result.last_attempt_at if result.state == "running" else result.last_success_at
            if last and self.auth.now - last > timedelta(hours=36) and result.state != "failed":
                result.state = "stale"
            return result
        except (OSError, ValueError):
            # An invalid operational status is a failure, never a fabricated success.
            return BackupStatus(state="failed")
