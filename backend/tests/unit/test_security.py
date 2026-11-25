import os
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pyotp
import pytest
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from app.core.encryption import DecryptionError, EncryptionService
from app.core.security import (
    accepted_totp_step,
    passwords,
    random_token,
    token_hash,
    verify_password,
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


@pytest.mark.parametrize("length,valid", [(7, False), (8, True), (12, True)])
def test_new_admin_password_accepts_eight_character_minimum(length, valid):
    from pydantic import ValidationError

    from app.schemas.auth import ChangePasswordInput

    value = random_token()[:length]
    if valid:
        assert ChangePasswordInput(password=random_token(), new_password=value).new_password
    else:
        with pytest.raises(ValidationError):
            ChangePasswordInput(password=random_token(), new_password=value)


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
