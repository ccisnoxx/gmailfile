#!/usr/bin/env python3
"""PG18隔离验收探针；仅允许gm_test_accept_*库，不输出合成凭据或密文。"""

import argparse
import json
import os
import secrets
import stat
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, "/app")


class CheckError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise CheckError(code)


def database():
    from app.core.config import Settings
    from app.db.session import create_database_engine

    settings = Settings()
    require(settings.database_name.startswith("gm_test_accept_"), "NOT_ACCEPTANCE_DATABASE")
    return create_database_engine(settings)


def migrations():
    from alembic.config import Config
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from alembic import command
    from app.core.release_meta import SCHEMA_VERSION
    from app.models import GmailAccount

    engine = database()
    config = Config("/app/alembic.ini")
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0002")
    identifier = uuid4()
    nonce = os.urandom(12)
    encrypted = AESGCM(os.urandom(32)).encrypt(nonce, os.urandom(32), b"acceptance-upgrade")
    with Session(engine) as db, db.begin():
        db.add(
            GmailAccount(
                id=identifier,
                gmail_email="upgrade-fixture@gmail.com",
                gmail_email_normalized="upgrade-fixture@gmail.com",
                registered_at=datetime.now(UTC),
                recovery_email_external="recovery@example.test",
                password_ciphertext=encrypted,
                password_nonce=nonce,
                password_key_version=1,
                row_version=7,
                purpose="preserve-existing",
            )
        )
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
        command.check(config)
    with Session(engine) as db, db.begin():
        row = db.scalar(select(GmailAccount).where(GmailAccount.id == identifier))
        require(
            row is not None
            and row.row_version == 7
            and row.password_ciphertext == encrypted
            and row.password_nonce == nonce
            and row.purpose == "preserve-existing",
            "UPGRADE_CHANGED_EXISTING_ACCOUNT",
        )
        db.delete(row)  # Remove only this probe before seeding decryptable fixture data.
    engine.dispose()
    return {
        "empty_upgrade": "0002",
        "upgrade_to": SCHEMA_VERSION,
        "existing_values_preserved": True,
    }


def seed():
    import pyotp
    from pwdlib import PasswordHash
    from sqlalchemy import func, select
    from sqlalchemy.orm import Session

    from app.core.encryption import EncryptionService
    from app.models import AdminUser, GmailAccount, Tag, UserSession, gmail_account_tags

    engine = database()
    now = datetime.now(UTC)
    encryptors = {v: EncryptionService(Path("/run/secrets"), v) for v in (1, 2)}

    def bundle(values, entity, identifier, field, version):
        plaintext = (
            pyotp.random_base32()
            if field in {"totp_secret", "pending_totp"}
            else secrets.token_urlsafe(32)
        )
        if field == "phone":
            plaintext = str(10**10 + secrets.randbelow(9 * 10**10))
        value = encryptors[version].encrypt(plaintext, entity, identifier, field)
        values.update(
            {
                field + "_ciphertext": value.ciphertext,
                field + "_nonce": value.nonce,
                field + "_key_version": value.key_version,
            }
        )

    with Session(engine) as db, db.begin():
        require(db.scalar(select(func.count()).select_from(GmailAccount)) == 0, "FIXTURE_NOT_EMPTY")
        require(
            db.scalar(select(func.count()).select_from(AdminUser)) == 0, "ADMIN_ALREADY_PRESENT"
        )
        admin_id = uuid4()
        values = {
            "id": admin_id,
            "password_hash": PasswordHash.recommended().hash(secrets.token_urlsafe(32)),
            "password_changed_at": now,
            "totp_enabled": True,
        }
        bundle(values, "admin_user", admin_id, "totp_secret", 2)
        db.add(AdminUser(**values))
        db.flush()
        session_id = uuid4()
        values = {
            "id": session_id,
            "admin_user_id": admin_id,
            "token_hash": os.urandom(32),
            "csrf_token_hash": os.urandom(32),
            "auth_level": "mfa_pending",
            "created_at": now,
            "last_seen_at": now,
            "expires_at": now + timedelta(hours=12),
            "pending_totp_expires_at": now + timedelta(minutes=10),
        }
        bundle(values, "user_session", session_id, "pending_totp", 1)
        db.add(UserSession(**values))
        tag = Tag(name="pg18-synthetic")
        db.add(tag)
        db.flush()
        parent_id = None
        for index in range(42):
            identifier = uuid4()
            values = {
                "id": identifier,
                "gmail_email": f"pg18-fixture-{index}@gmail.com",
                "gmail_email_normalized": f"pg18-fixture-{index}@gmail.com",
                "registered_at": now,
                "recovery_email_external": "recovery@example.test" if index == 0 else None,
                "recovery_account_id": parent_id,
                "row_version": 1,
            }
            for field in ("password", "phone", "notes"):
                bundle(values, "gmail_account", identifier, field, 1 + index % 2)
            db.add(GmailAccount(**values))
            db.flush()
            db.execute(gmail_account_tags.insert().values(account_id=identifier, tag_id=tag.id))
            if parent_id is None:
                parent_id = identifier
    engine.dispose()
    return {"accounts": 42, "data_key_versions": [1, 2], "expected_decryption_groups": 8}


def secret_permissions(role):
    expected = {
        "migrate": {"db_migrator_password"},
        "api": {"db_password", "data_key_v1", "data_key_v2"},
        "backup": {
            "db_backup_password",
            "backup_recipients",
            "backup_ssh_config",
            "backup_ssh_identity",
            "backup_known_hosts",
        },
        "restore": {
            "db_admin_password",
            "data_key_v1",
            "data_key_v2",
            "backup_identity",
            "wrong_backup_identity",
        },
    }[role]
    require(os.getuid() == 10001 and os.getgid() == 10001, "WRONG_RUNTIME_UID")
    directory = Path("/run/secrets")
    require({p.name for p in directory.iterdir()} == expected, "SECRET_SCOPE_MISMATCH")
    for name in expected:
        path = directory / name
        info = path.stat()
        require(stat.S_ISREG(info.st_mode) and os.access(path, os.R_OK), "SECRET_UNREADABLE")
        require(not os.access(path, os.W_OK), "SECRET_WRITABLE")
        if name == "backup_ssh_identity":
            require(
                info.st_uid == 10001
                and info.st_gid == 10001
                and stat.S_IMODE(info.st_mode) == 0o600,
                "SSH_KEY_MODE_MISMATCH",
            )
    return {
        "role": role,
        "uid": os.getuid(),
        "allowed_secret_names": sorted(expected),
        "read_only": True,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("migrations", "seed", "secrets"))
    parser.add_argument("--role", choices=("migrate", "api", "backup", "restore"))
    args = parser.parse_args()
    try:
        if args.action == "secrets":
            require(args.role is not None, "ROLE_REQUIRED")
            result = secret_permissions(args.role)
        else:
            result = {"migrations": migrations, "seed": seed}[args.action]()
        print(json.dumps({"result": "passed", **result}))
    except Exception as exc:
        code = str(exc) if isinstance(exc, CheckError) else type(exc).__name__
        print("ACCEPTANCE_CHECK_FAILED: " + code, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
