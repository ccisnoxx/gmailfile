"""Project-only retention and failed publication contracts (synthetic artifacts)."""

import importlib.util
import json
from argparse import Namespace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "gm_backup", Path(__file__).resolve().parents[3] / "scripts/backup_tool.py"
)
ops = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ops)


def artifact(root, stamp, index):
    p = root / ("gmail-manager-" + stamp.strftime("%Y%m%dT%H%M%SZ") + f"-{index:08x}")
    p.mkdir()
    for f in (ops.DB_FILE, ops.CONFIG_FILE):
        (p / f).write_bytes(b"age-synthetic-ciphertext")
    meta = {
        "format": ops.MAGIC,
        "complete": True,
        "created_at": stamp.isoformat(),
        "counts": {t: 0 for t in ops.TABLES},
        "sha256": {f: ops.file_digest(p / f) for f in (ops.DB_FILE, ops.CONFIG_FILE)},
    }
    (p / "manifest.json").write_text(json.dumps(meta))
    return p


def test_retention_7_daily_8_weekly_12_monthly_only_managed(tmp_path):
    today = datetime(2026, 11, 24, 2, tzinfo=UTC)
    for day in range(400):
        artifact(tmp_path, today - timedelta(days=day), day)
    protected = tmp_path / "other-project"
    protected.mkdir()
    (protected / "important").write_text("preserve")
    invalid = tmp_path / "gmail-manager-20200101T000000Z-00000000"
    invalid.mkdir()
    (invalid / "manifest.json").write_text("bad")
    symlink = tmp_path / "gmail-manager-20200101T000000Z-ffffffff"
    symlink.symlink_to(protected, target_is_directory=True)
    removed = ops.retention(tmp_path, today)
    assert removed and protected.exists() and invalid.exists() and symlink.is_symlink()
    valid = [
        p
        for p in tmp_path.iterdir()
        if p.is_dir() and p.name not in [protected.name, invalid.name, symlink.name]
    ]
    stamps = [
        datetime.fromisoformat(json.loads((p / "manifest.json").read_text())["created_at"])
        for p in valid
    ]
    assert {today.date() - timedelta(days=i) for i in range(7)} <= {s.date() for s in stamps}
    assert (
        len(
            {
                s.isocalendar()[:2]
                for s in stamps
                if (
                    today.date()
                    - timedelta(days=today.weekday())
                    - (s.date() - timedelta(days=s.weekday()))
                ).days
                // 7
                < 8
            }
        )
        == 8
    )
    assert len({(s.year, s.month) for s in stamps}) == 12
    assert 12 <= len(valid) <= 27
    newest = max(stamps)
    assert newest == today


def test_unknown_directory_and_symlink_not_adopted(tmp_path):
    (tmp_path / "important").write_text("other")
    with pytest.raises(ops.OperationError):
        with ops.managed_root(tmp_path):
            pass
    assert (tmp_path / "important").read_text() == "other"


def test_manifest_requires_completed_ciphertext_and_transfer_integrity(tmp_path):
    p = artifact(tmp_path, datetime.now(UTC), 0)
    assert ops.read_manifest(p)["complete"]
    (p / ops.DB_FILE).write_bytes(b"truncated")
    with pytest.raises(ops.OperationError):
        ops.read_manifest(p)


@pytest.mark.parametrize("failure", ["credentials", "dump", "config", "offsite", "write"])
def test_failed_attempt_not_published_as_success(tmp_path, monkeypatch, failure):
    import contextlib

    root = tmp_path / "project-backups"
    args = Namespace(
        directory=str(root),
        database="gm_test",
        recipients="public-recipients",
        allow_pg17_test=True,
        config=[],
    )

    class Connection:
        info = Namespace(server_version=170011, dbname="gm_test")

        def execute(self, *a):
            return self

        def fetchone(self):
            return [ops.SCHEMA_VERSION]

        def __enter__(self):
            return self

        def __exit__(self, *a):
            pass

    monkeypatch.setattr(ops, "connect", lambda *a: Connection())
    monkeypatch.setattr(ops, "tool_versions", lambda *a, **kw: {"server_major": 17})
    monkeypatch.setattr(ops, "counts", lambda c: {t: 0 for t in ops.TABLES})

    @contextlib.contextmanager
    def credentials():
        if failure == "credentials":
            raise OSError
        yield

    monkeypatch.setattr(ops, "database_environment", credentials)

    def encrypt(path, *a):
        path.write_bytes(b"age-synthetic")
        if failure == "dump":
            raise ops.OperationError("dump failed")

    monkeypatch.setattr(ops, "encrypted_dump", encrypt)

    def config(path, *a):
        if failure == "config":
            raise ops.OperationError("compression failed")
        path.write_bytes(b"age-config")

    monkeypatch.setattr(ops, "encrypted_config", config)
    if failure == "offsite":
        monkeypatch.setenv("OFFSITE_HOST", "approved-host")
        monkeypatch.setattr(
            ops,
            "offsite_upload",
            lambda p: (_ for _ in ()).throw(ops.OperationError("transfer failed")),
        )
    if failure == "write":
        original = ops.atomic_json

        def write(path, value):
            if path.name == "manifest.json":
                raise OSError
            return original(path, value)

        monkeypatch.setattr(ops, "atomic_json", write)
    with pytest.raises((OSError, ops.OperationError)):
        ops.backup(args)
    status = json.loads((root / "status.json").read_text())
    assert status["state"] == "failed"
    assert not list(root.glob(".partial-*"))
    assert len(list(root.glob("gmail-manager-*"))) == (1 if failure == "offsite" else 0)


def test_retention_protects_last_drill_verified_copy(tmp_path):
    today = datetime(2026, 11, 24, tzinfo=UTC)
    old = artifact(tmp_path, today - timedelta(days=500), 1)
    newest = artifact(tmp_path, today, 2)
    (tmp_path / ".last-verified.json").write_text(json.dumps({"backup": old.name}))
    ops.retention(tmp_path, today)
    assert old.exists() and newest.exists()


def test_restore_sampler_accepts_v2_only_and_rejects_wrong_or_missing_key(
    tmp_path, monkeypatch, capsys
):
    import os
    from uuid import uuid4

    from app.core.encryption import DecryptionError, EncryptionService
    from app.ops.verify_restore import verify

    key = tmp_path / "data_key_v2"
    key.write_bytes(os.urandom(32))
    monkeypatch.setenv("ACTIVE_DATA_KEY_VERSION", "2")
    encryption = EncryptionService(tmp_path, 2)
    identifier = uuid4()
    value = encryption.encrypt("never-output-synthetic", "gmail_account", identifier, "password")

    class Connection:
        def execute(self, query):
            if query.startswith("SELECT gmail_email,"):
                return [("test@example.test", "test@example.test")]
            if query.startswith("SELECT count(*)"):
                return self
            if "password_ciphertext" in query:
                return [(identifier, value.ciphertext, value.nonce, 2)]
            return []

        def fetchone(self):
            return (0,)

    assert verify(Connection(), tmp_path) == 1
    key.write_bytes(os.urandom(32))
    with pytest.raises(DecryptionError):
        verify(Connection(), tmp_path)
    key.unlink()
    with pytest.raises(ValueError):
        verify(Connection(), tmp_path)
    assert not capsys.readouterr().out


def test_cli_argument_errors_never_echo_mistaken_credential(monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["backup_tool", "backup", "--password", "never-echo-argument"])
    with pytest.raises(SystemExit) as exc:
        ops.main()
    assert exc.value.code == 2
    assert "never-echo-argument" not in capsys.readouterr().err


def test_restore_verify_rejects_broken_audit_chain(tmp_path, monkeypatch):
    import os
    from uuid import uuid4

    from app.ops.verify_restore import verify

    (tmp_path / "data_key_v1").write_bytes(os.urandom(32))
    monkeypatch.setenv("ACTIVE_DATA_KEY_VERSION", "1")

    class Connection:
        def execute(self, query):
            if query.startswith("SELECT count(*)"):
                return self
            if "FROM public.audit_events" in query:
                return [
                    (
                        1,
                        b"\x00" * 32,
                        b"\xff" * 32,
                        uuid4(),
                        datetime.now(UTC),
                        "login_success",
                        None,
                        None,
                        None,
                        None,
                        {},
                    )
                ]
            return []

        def fetchone(self):
            return (0,)

    with pytest.raises(ValueError, match="审计日志哈希链"):
        verify(Connection(), tmp_path)


def test_switch_step_up_verifies_admin_password_and_totp(tmp_path, monkeypatch):
    import os
    from uuid import uuid4

    import pyotp

    from app.core.encryption import EncryptionService
    from app.core.security import passwords

    (tmp_path / "data_key_v1").write_bytes(os.urandom(32))
    monkeypatch.setenv("ACTIVE_DATA_KEY_VERSION", "1")
    enc = EncryptionService(tmp_path, 1)
    admin_id = uuid4()
    admin_password = "amber falcon velvet bridge 73"
    totp_secret = pyotp.random_base32()
    enc_totp = enc.encrypt(totp_secret, "admin_user", admin_id, "totp_secret")
    fixed_now = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)
    monkeypatch.setattr(ops, "now", lambda: fixed_now)

    class Connection:
        def __init__(self):
            self.last_step = None

        def execute(self, query, params=None):
            if "FROM public.admin_users" in query:
                self._row = (
                    admin_id,
                    passwords.hash(admin_password),
                    True,
                    enc_totp.ciphertext,
                    enc_totp.nonce,
                    enc_totp.key_version,
                    self.last_step,
                )
                return self
            if "UPDATE public.admin_users SET totp_last_accepted_step" in query:
                self.last_step = params[0]
            return self

        def fetchone(self):
            return self._row

    conn = Connection()
    code = pyotp.TOTP(totp_secret).at(fixed_now)
    with pytest.raises(ops.OperationError, match="二次验证失败"):
        ops.verify_admin_step_up(
            conn, tmp_path, read_password=lambda _: "wrong", read_code=lambda _: code
        )
    with pytest.raises(ops.OperationError, match="TOTP"):
        ops.verify_admin_step_up(
            conn, tmp_path, read_password=lambda _: admin_password, read_code=lambda _: "000000"
        )
    assert ops.verify_admin_step_up(
        conn, tmp_path, read_password=lambda _: admin_password, read_code=lambda _: code
    )
    # 同一时间步 TOTP 不得在切换中重放。
    with pytest.raises(ops.OperationError, match="TOTP"):
        ops.verify_admin_step_up(
            conn, tmp_path, read_password=lambda _: admin_password, read_code=lambda _: code
        )
