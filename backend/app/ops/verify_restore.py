"""Restore acceptance: business invariants and one authenticated sample per key/field."""

import os
from pathlib import Path

from app.core.encryption import EncryptedValue, EncryptionService
from app.schemas.accounts import normalize_email


def verify(connection, keys: Path):
    encryption = EncryptionService(keys, int(os.environ.get("ACTIVE_DATA_KEY_VERSION", "1")))
    # DB restore already validates unique/FK/CHECK constraints. Check business normalization too.
    for email, normalized in connection.execute(
        "SELECT gmail_email, gmail_email_normalized FROM public.gmail_accounts"
    ):
        if normalize_email(email) != normalized:
            raise ValueError("恢复数据规范化不一致")
    invalid = connection.execute(
        "SELECT count(*) FROM public.gmail_accounts a JOIN public.gmail_accounts b "
        "ON a.recovery_account_id=b.id "
        "WHERE a.gmail_email_normalized=b.gmail_email_normalized"
    ).fetchone()[0]
    if invalid:
        raise ValueError("恢复数据辅助关联不一致")
    checked = 0
    for table, entity, fields in [
        ("gmail_accounts", "gmail_account", ("password", "phone", "notes")),
        ("admin_users", "admin_user", ("totp_secret",)),
        ("user_sessions", "user_session", ("pending_totp",)),
    ]:
        for field in fields:
            # Names are internal constants; no CSV/request input enters SQL.
            query = (
                f"SELECT DISTINCT ON ({field}_key_version) id, {field}_ciphertext, "
                f"{field}_nonce, {field}_key_version "
                f"FROM public.{table} WHERE {field}_ciphertext IS NOT NULL "
                f"ORDER BY {field}_key_version, id"
            )
            for entity_id, ciphertext, nonce, version in connection.execute(query):
                encryption.decrypt(
                    EncryptedValue(ciphertext, nonce, version), entity, entity_id, field
                )
                checked += 1
    return checked
