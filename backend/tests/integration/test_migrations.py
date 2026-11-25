import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.db.schema import schema_is_current
from app.models import AdminUser, GmailAccount, Tag, gmail_account_tags

pytestmark = pytest.mark.integration


def account(**overrides):
    account_id = uuid4()
    nonce = os.urandom(12)
    encrypted = AESGCM(AESGCM.generate_key(bit_length=256)).encrypt(
        nonce, b"synthetic-fixture-only", f"gmail_account:{account_id}:password:v1".encode()
    )
    values = {
        "id": account_id,
        "gmail_email": f"{account_id.hex}@gmail.com",
        "gmail_email_normalized": f"{account_id.hex}@gmail.com",
        "password_ciphertext": encrypted,
        "password_nonce": nonce,
        "password_key_version": 1,
        "registered_at": datetime.now(UTC),
        "recovery_email_external": "fixture@example.test",
    }
    values.update(overrides)
    return GmailAccount(**values)


def test_empty_database_upgrade_and_downgrade(db_engine, migration_config):
    expected = {
        "admin_users",
        "admin_recovery_codes",
        "user_sessions",
        "gmail_accounts",
        "tags",
        "gmail_account_tags",
        "audit_events",
        "alembic_version",
        "pre_auth_sessions",
        "auth_throttles",
        "csv_receipts",
    }
    assert set(inspect(db_engine).get_table_names()) == expected
    assert schema_is_current(db_engine)
    with db_engine.begin() as connection:
        migration_config.attributes["connection"] = connection
        command.check(migration_config)
        command.downgrade(migration_config, "base")
    assert set(inspect(db_engine).get_table_names()) == {"alembic_version"}
    assert not schema_is_current(db_engine)
    with db_engine.begin() as connection:
        migration_config.attributes["connection"] = connection
        command.upgrade(migration_config, "head")
    assert schema_is_current(db_engine)


@pytest.mark.parametrize(
    "changes",
    [
        {"recovery_email_external": None},
        {"row_version": 0},
        {"status": "invented"},
        {"two_factor_status": "invented"},
        {"password_nonce": b"invalid"},
        {"password_ciphertext": b"plaintext"},
        {"password_key_version": 0},
        {"phone_ciphertext": b"x" * 16},
        {"notes_nonce": b"n" * 12},
        {"status": "archived", "archived_at": None},
    ],
)
def test_database_rejects_invalid_records(db_engine, changes):
    with Session(db_engine) as session:
        session.add(account(**changes))
        with pytest.raises(IntegrityError):
            session.commit()


def test_unique_address_remains_reserved_after_soft_delete(db_engine):
    email = "reserved@gmail.com"
    with Session(db_engine) as session:
        session.add(account(gmail_email_normalized=email, deleted_at=datetime.now(UTC)))
        session.commit()
        session.add(account(gmail_email_normalized=email))
        with pytest.raises(IntegrityError):
            session.commit()


def test_recovery_self_and_xor_constraints(db_engine):
    row = account()
    row.recovery_account_id = row.id
    row.recovery_email_external = None
    with Session(db_engine) as session:
        session.add(row)
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        recovery = account()
        session.add(recovery)
        session.commit()
        session.add(account(recovery_account_id=recovery.id))
        with pytest.raises(IntegrityError):
            session.commit()


def test_only_one_administrator(db_engine):
    with Session(db_engine) as session:
        session.add(
            AdminUser(password_hash="synthetic-hash", password_changed_at=datetime.now(UTC))
        )
        session.commit()
        session.add(
            AdminUser(password_hash="synthetic-hash", password_changed_at=datetime.now(UTC))
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_deleting_tag_only_removes_association(db_engine):
    with Session(db_engine) as session:
        row, tag = account(), Tag(name="测试标签")
        session.add_all([row, tag])
        session.flush()
        session.execute(gmail_account_tags.insert().values(account_id=row.id, tag_id=tag.id))
        session.commit()
        session.delete(tag)
        session.commit()
        assert session.get(GmailAccount, row.id) is not None
        assert session.execute(text("SELECT count(*) FROM gmail_account_tags")).scalar_one() == 0


def test_phase4_upgrade_preserves_existing_account_versions_and_ciphertext(
    db_engine, migration_config
):
    with db_engine.begin() as connection:
        migration_config.attributes["connection"] = connection
        command.downgrade(migration_config, "0002")
    row = account(row_version=7, purpose="preserve-existing")
    with Session(db_engine) as db, db.begin():
        db.add(row)
        db.flush()
        identifier = row.id
        ciphertext = row.password_ciphertext
    with db_engine.begin() as connection:
        migration_config.attributes["connection"] = connection
        command.upgrade(migration_config, "head")
    with Session(db_engine) as db:
        restored = db.get(GmailAccount, identifier)
        assert restored.row_version == 7 and restored.password_ciphertext == ciphertext
        assert restored.purpose == "preserve-existing"
