import hashlib
import os
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pyotp
import pytest
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from app.core.audit_sink import parse_syslog_target
from app.core.encryption import DecryptionError, EncryptionService
from app.core.security import (
    MIN_ADMIN_PASSWORD_LENGTH,
    accepted_totp_step,
    passwords,
    random_token,
    token_hash,
    validate_new_admin_password,
    verify_password,
)
from app.services.audit_integrity import (
    GENESIS_HASH,
    compute_audit_event_hash,
    sign_audit_checkpoint,
    verify_audit_checkpoint,
    verify_audit_records,
)


def test_argon2id_and_upgrade():
    password = random_token()
    hashed = passwords.hash(password)
    assert hashed.startswith("$argon2id$")
    assert verify_password(password, hashed) == (True, None)
    assert verify_password(random_token(), hashed) == (False, None)
    old = PasswordHash((Argon2Hasher(time_cost=1, memory_cost=8192, parallelism=1),)).hash(password)
    valid, upgraded = verify_password(password, old)
    assert valid and upgraded and upgraded.startswith("$argon2id$")
    assert passwords.verify(password, upgraded)
    assert not verify_password(password, None)[0]


def test_totp_replay_and_window():
    secret = pyotp.random_base32()
    now = datetime.now(UTC)
    code = pyotp.TOTP(secret).at(now)
    step = accepted_totp_step(secret, code, now, None)
    assert step is not None
    assert accepted_totp_step(secret, code, now, step) is None
    assert accepted_totp_step(secret, "invalid", now, None) is None
    assert accepted_totp_step(secret, code, now + timedelta(minutes=5), None) is None


def test_versioned_encryption_and_independent_nonce(settings):
    record = uuid4()
    service = EncryptionService(settings.data_key_directory, 1)
    value = service.encrypt("合成敏感值", "gmail_account", record, "password")
    second = service.encrypt("合成敏感值", "gmail_account", record, "password")
    assert len(value.nonce) == 12 and value.nonce != second.nonce
    assert value.ciphertext != second.ciphertext
    assert service.decrypt(value, "gmail_account", record, "password") == "合成敏感值"
    (settings.data_key_directory / "data_key_v2").write_bytes(os.urandom(32))
    service = EncryptionService(settings.data_key_directory, 2)
    assert service.decrypt(value, "gmail_account", record, "password") == "合成敏感值"
    assert service.encrypt("new", "gmail_account", record, "password").key_version == 2


@pytest.mark.parametrize("change", ["id", "entity", "field", "version", "nonce", "tag", "key"])
def test_decryption_failure_is_generic(settings, change):
    service = EncryptionService(settings.data_key_directory, 1)
    record, entity, field = uuid4(), "gmail_account", "password"
    value = service.encrypt(random_token(), entity, record, field)
    if change == "id":
        record = uuid4()
    elif change == "entity":
        entity = "admin_user"
    elif change == "field":
        field = "phone"
    elif change == "version":
        value = replace(value, key_version=2)
    elif change == "nonce":
        value = replace(value, nonce=os.urandom(12))
    elif change == "tag":
        value = replace(value, ciphertext=value.ciphertext[:-1] + bytes([value.ciphertext[-1] ^ 1]))
    else:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        service.keys[1] = AESGCM(os.urandom(32))
    with pytest.raises(DecryptionError, match="^无法解密敏感数据$"):
        service.decrypt(value, entity, record, field)


def test_production_cannot_disable_secure_cookie(settings):
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(_env_file=None, session_cookie_secure=False)


def test_only_hashes_not_raw_tokens():
    one, two = random_token(), random_token()
    assert len(one) >= 43 and one != two
    assert len(token_hash(one)) == 32


@pytest.mark.parametrize("length,valid", [(15, False), (16, True), (24, True)])
def test_new_admin_password_enforces_sixteen_character_minimum(length, valid):
    from pydantic import ValidationError

    from app.schemas.auth import ChangePasswordInput

    assert MIN_ADMIN_PASSWORD_LENGTH == 16
    value = random_token()[:length]
    if valid:
        assert ChangePasswordInput(password=random_token(), new_password=value).new_password
    else:
        with pytest.raises(ValidationError) as exc_info:
            ChangePasswordInput(password=random_token(), new_password=value)
        assert value not in str(exc_info.value)


@pytest.mark.parametrize(
    "weak",
    [
        "password12345678",
        "Correct Horse Battery Staple",
        "GmailManager2026!",
        "1234567890123456",
        "qwertyuiopasdfgh",
        "aaaaaaaaaaaaaaaa",
        "abcd1234abcd1234",
        "short-pass      ",
    ],
)
def test_new_admin_password_rejects_common_leaked_and_weak_patterns(weak):
    from pydantic import ValidationError

    from app.schemas.auth import ChangePasswordInput

    with pytest.raises(ValidationError) as exc_info:
        ChangePasswordInput(password=random_token(), new_password=weak)
    assert weak not in str(exc_info.value)


def test_new_admin_password_allows_passphrase_and_checks_offline_denylist(tmp_path):
    passphrase = "amber falcon velvet bridge 73"
    assert validate_new_admin_password(passphrase) == passphrase

    denylist = tmp_path / "breached.txt"
    sha1 = hashlib.sha1(passphrase.encode("utf-8")).hexdigest().upper()
    denylist.write_text(f"# offline breach sample\n{sha1}:42\n", encoding="utf-8")
    with pytest.raises(ValueError, match="离线泄露密码黑名单"):
        validate_new_admin_password(passphrase, denylist_file=denylist)


def test_audit_hash_chain_verification_and_checkpoint_signing():
    now = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)
    id1, id2 = uuid4(), uuid4()
    h1 = compute_audit_event_hash(
        seq=1,
        prev_hash=GENESIS_HASH,
        event_id=id1,
        created_at=now,
        event_type="admin_initialized",
        account_id=None,
        session_id=None,
        ip_addr="192.0.2.10",
        user_agent=None,
        metadata={},
    )
    h2 = compute_audit_event_hash(
        seq=2,
        prev_hash=h1,
        event_id=id2,
        created_at=now + timedelta(seconds=5),
        event_type="login_success",
        account_id=None,
        session_id=uuid4(),
        ip_addr="192.0.2.10",
        user_agent=None,
        metadata={"operation": "login"},
    )
    rows = [
        (1, GENESIS_HASH, h1, id1, now, "admin_initialized", None, None, "192.0.2.10", None, {}),
        (
            2,
            h1,
            h2,
            id2,
            now + timedelta(seconds=5),
            "login_success",
            None,
            None,
            "192.0.2.10",
            None,
            {"operation": "login"},
        ),
    ]
    # Note: session_id mismatch on row 2 must be detected immediately.
    bad = verify_audit_records(rows)
    assert not bad.valid and bad.broken_seq == 2 and bad.reason == "EVENT_HASH_MISMATCH"

    rows[1] = (
        2,
        h1,
        compute_audit_event_hash(
            seq=2,
            prev_hash=h1,
            event_id=id2,
            created_at=now + timedelta(seconds=5),
            event_type="login_success",
            account_id=None,
            session_id=None,
            ip_addr="192.0.2.10",
            user_agent=None,
            metadata={"operation": "login"},
        ),
        id2,
        now + timedelta(seconds=5),
        "login_success",
        None,
        None,
        "192.0.2.10",
        None,
        {"operation": "login"},
    )
    ok = verify_audit_records(rows)
    assert ok.valid and ok.total_events == 2 and ok.latest_seq == 2

    key = os.urandom(32)
    checkpoint = sign_audit_checkpoint(ok, key, now=now)
    assert verify_audit_checkpoint(checkpoint, key)
    tampered = {**checkpoint, "total_events": 1}
    assert not verify_audit_checkpoint(tampered, key)
    assert not verify_audit_checkpoint(checkpoint, os.urandom(32))


def test_syslog_target_parsing():
    assert parse_syslog_target("/dev/log") == ("/dev/log", None)
    host_port, socktype = parse_syslog_target("tcp://syslog.internal:6514")
    assert host_port == ("syslog.internal", 6514) and socktype is not None
    with pytest.raises(ValueError):
        parse_syslog_target("http://syslog.internal:80")


@pytest.mark.parametrize("arguments", [["create-admin", "--password"], ["unknown-command"]])
def test_cli_invalid_arguments_do_not_echo_possible_credentials(monkeypatch, capsys, arguments):
    from app.cli import main

    credential = random_token()
    monkeypatch.setattr("sys.argv", ["gm", *arguments, credential])
    with pytest.raises(SystemExit) as exit_info:
        main()
    assert exit_info.value.code == 2
    captured = capsys.readouterr()
    assert credential not in captured.err and credential not in captured.out
