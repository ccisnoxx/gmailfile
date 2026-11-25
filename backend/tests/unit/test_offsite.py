"""受限接收协议/发布状态机/客户端故障验证；不生成任何SSH私钥。"""

import importlib.util
import io
import json
import os
import subprocess
import sys
import tarfile
from argparse import Namespace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

PROJECT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PROJECT))
from infra.backup import receiver as r  # noqa: E402


def load_script(name):
    spec = importlib.util.spec_from_file_location(
        name.replace("-", "_"), PROJECT / "scripts" / name
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ops = load_script("backup_tool.py")
source_identity = load_script("prepare-offsite-identity.py")


def bundle(path, day=0):
    import hashlib

    path.mkdir()
    for name in (r.DB_FILE, r.CONFIG_FILE):
        (path / name).write_bytes(r.AGE_HEADER + f"synthetic-ciphertext-{day}-{name}".encode())
    data = {
        "format": r.MAGIC,
        "complete": True,
        "created_at": (datetime(2026, 11, 24, tzinfo=UTC) + timedelta(days=day)).isoformat(),
        "app_version": "0.1.0",
        "schema_version": "0003",
        "tools": {"pg_dump": "17.11", "pg_restore": "17.11", "age": "1.3.2", "server_major": 17},
        "counts": {t: 0 for t in r.TABLES},
        "compression": "pg-custom-gzip:6",
        "sha256": {
            n: hashlib.sha256((path / n).read_bytes()).hexdigest()
            for n in (r.DB_FILE, r.CONFIG_FILE)
        },
    }
    (path / "manifest.json").write_text(json.dumps(data))
    return data


def packet(path):
    stream = io.BytesIO()
    r.write_bundle(path, stream)
    stream.seek(0)
    return stream


@pytest.fixture
def target(tmp_path):
    root = tmp_path / "receiver"
    root.mkdir()
    (root / ".gmail-manager-backups").write_text(r.MAGIC)
    return root


def send(root, path):
    output = io.BytesIO()
    r.dispatch("gmail-backup upload", root, packet(path), output)
    return json.loads(output.getvalue())


def test_publish_then_confirm_then_delete_and_fetch(target, tmp_path):
    old = tmp_path / "old"
    before = bundle(old)
    assert send(target, old)["status"] == "published"
    newer = tmp_path / "new"
    after = bundle(newer, 1)
    assert send(target, newer)["manifest"] == after
    assert {p.name for p in target.iterdir()} == {
        "current",
        ".gmail-manager-backups",
        ".receiver.lock",
    }
    output = io.BytesIO()
    r.dispatch("gmail-backup fetch", target, io.BytesIO(), output)
    download = tmp_path / "download"
    download.mkdir()
    output.seek(0)
    assert r.read_bundle(download, output, reserve=0) == after
    assert before != after


def test_repeated_bundle_is_unchanged_and_older_bundle_rejected(target, tmp_path):
    old = tmp_path / "old"
    before = bundle(old)
    new = tmp_path / "new"
    after = bundle(new, 1)
    send(target, new)
    assert send(target, new)["status"] == "unchanged"
    with pytest.raises(r.ReceiverError, match="BACKUP_NOT_NEWER"):
        send(target, old)
    assert r.validate_bundle(target / "current") == after and before != after


@pytest.mark.parametrize(
    "failure",
    ["hash", "truncated", "extra_member", "path", "link", "pax", "oversize", "metadata", "padding"],
)
def test_rejected_upload_keeps_old_and_cleans_stage(target, tmp_path, failure):
    original = tmp_path / "old"
    expected = bundle(original)
    send(target, original)
    other = tmp_path / "new"
    bundle(other, 1)
    raw = packet(other).getvalue()
    if failure == "hash":
        (other / r.DB_FILE).write_bytes(r.AGE_HEADER + b"wrong")
        raw = packet(other).getvalue()
    elif failure == "truncated":
        raw = raw[:1000]
    elif failure == "metadata":
        data = json.loads((other / "manifest.json").read_text())
        data["password"] = "must-not-echo"
        (other / "manifest.json").write_text(json.dumps(data))
        raw = packet(other).getvalue()
    elif failure == "padding":
        raw = raw[:-1] + b"X"
    else:
        out = io.BytesIO()
        with tarfile.open(fileobj=out, mode="w", format=tarfile.USTAR_FORMAT) as tar:
            for index, name in enumerate(r.FILES):
                info = tarfile.TarInfo("../escape" if failure == "path" and index == 0 else name)
                value = (other / name).read_bytes()
                info.size = len(value)
                if index == 0 and failure == "link":
                    info.type = tarfile.SYMTYPE
                    info.linkname = "/etc/passwd"
                    info.size = 0
                if index == 0 and failure == "pax":
                    info.type = tarfile.XHDTYPE
                if index == 0 and failure == "oversize":
                    info.size = r.MAX_BUNDLE_BYTES + 1
                    out.write(info.tobuf(format=tarfile.USTAR_FORMAT))
                    break
                tar.addfile(info, io.BytesIO(value) if info.size else None)
            if failure == "extra_member":
                tar.addfile(tarfile.TarInfo("unwanted"))
        raw = out.getvalue()
    with pytest.raises((r.ReceiverError, tarfile.TarError, OSError)):
        r.dispatch("gmail-backup upload", target, io.BytesIO(raw), io.BytesIO())
    assert r.validate_bundle(target / "current") == expected
    assert not list(target.glob(".incoming-*")) and not (tmp_path / "escape").exists()


def test_postpublication_validation_failure_rolls_back_old(target, tmp_path, monkeypatch):
    old = tmp_path / "old"
    expected = bundle(old)
    send(target, old)
    new = tmp_path / "new"
    bundle(new, 1)
    original = r.validate_bundle

    def validate(path):
        if path == target / "current" and (target / ".previous").exists():
            raise r.ReceiverError("INJECTED_CONFIRMATION_FAILURE")
        return original(path)

    monkeypatch.setattr(r, "validate_bundle", validate)
    with pytest.raises(r.ReceiverError):
        send(target, new)
    assert original(target / "current") == expected and not (target / ".previous").exists()


def test_rename_failure_restores_previous(target, tmp_path, monkeypatch):
    old = tmp_path / "old"
    expected = bundle(old)
    send(target, old)
    new = tmp_path / "new"
    bundle(new, 1)
    rename = Path.rename

    def fail(path, destination):
        if path.name.startswith(".incoming-") and Path(destination).name == "current":
            raise OSError("injected")
        return rename(path, destination)

    monkeypatch.setattr(Path, "rename", fail)
    with pytest.raises(OSError):
        send(target, new)
    assert r.validate_bundle(target / "current") == expected


def test_recover_crash_before_new_install_and_partial_old_cleanup(target, tmp_path):
    expected = bundle(target / ".previous")
    stage = target / (".incoming-" + "a" * 32)
    stage.mkdir()
    (stage / r.DB_FILE).write_bytes(b"partial")
    output = io.BytesIO()
    r.dispatch("gmail-backup status", target, io.BytesIO(), output)
    assert json.loads(output.getvalue())["manifest"] == expected
    assert not stage.exists()
    previous = target / ".previous"
    bundle(previous, -1)
    (previous / r.CONFIG_FILE).unlink()
    r.dispatch("gmail-backup status", target, io.BytesIO(), io.BytesIO())
    assert not previous.exists() and r.validate_bundle(target / "current") == expected


def test_recovery_never_deletes_old_if_new_current_corrupt(target):
    old = bundle(target / ".previous")
    bundle(target / "current", 1)
    (target / "current" / r.DB_FILE).write_bytes(b"bad")
    with pytest.raises(r.ReceiverError):
        r.dispatch("gmail-backup status", target, io.BytesIO(), io.BytesIO())
    assert r.validate_bundle(target / ".previous") == old


def test_unknown_staging_and_links_never_deleted(target, tmp_path):
    bundle(target / "current")
    stage = target / (".incoming-" + "a" * 32)
    stage.mkdir()
    (stage / "foreign").write_text("preserve")
    with pytest.raises(r.ReceiverError):
        r.dispatch("gmail-backup status", target, io.BytesIO(), io.BytesIO())
    assert (stage / "foreign").read_text() == "preserve"
    other = tmp_path / "other"
    other.mkdir()
    (other / "important").write_text("preserve")
    link = target / (".incoming-" + "b" * 32)
    link.symlink_to(other, target_is_directory=True)
    with pytest.raises(r.ReceiverError):
        r.remove_transient(link)
    assert (other / "important").exists()


def test_busy_lock_rejects_second_request(target):
    with r.receiver_lock(target):
        with pytest.raises(r.ReceiverError, match="RECEIVER_BUSY"):
            r.dispatch("gmail-backup status", target, io.BytesIO(), io.BytesIO())


@pytest.mark.parametrize(
    "command",
    [
        "",
        "id",
        "internal-sftp",
        "/usr/lib/openssh/sftp-server",
        "gmail-backup upload /tmp/other",
        "gmail-backup status; id",
        "python3 -c private-value",
    ],
)
def test_forced_command_denies_shell_and_sftp(command):
    result = subprocess.run(
        [sys.executable, "-I", str(PROJECT / "infra/backup/receiver.py")],
        env={**os.environ, "SSH_ORIGINAL_COMMAND": command},
        capture_output=True,
    )
    assert result.returncode == 1 and result.stdout == b"" and result.stderr == b"COMMAND_DENIED\n"
    assert b"private-value" not in result.stderr


def test_source_guard_rejects_local_before_any_write_or_keygen(monkeypatch):
    monkeypatch.setattr(source_identity.sys, "platform", "darwin")

    def forbidden(*a, **kw):
        raise AssertionError("must not call key generation, ip, or mkdir")

    monkeypatch.setattr(source_identity.subprocess, "run", forbidden)
    monkeypatch.setattr(Path, "mkdir", forbidden)
    with pytest.raises(source_identity.PrepareError):
        source_identity.prepare(Path("/absent/public"))


def test_source_guard_rejects_receiver_wg_address(monkeypatch):
    monkeypatch.setattr(source_identity.sys, "platform", "linux")
    monkeypatch.setattr(source_identity.os, "geteuid", lambda: 0)
    monkeypatch.setattr(
        source_identity.subprocess,
        "run",
        lambda *a, **k: Namespace(stdout="192.0.2.10 dev wg0 src 192.0.2.10"),
    )
    with pytest.raises(source_identity.PrepareError):
        source_identity.check_source()


def test_source_guard_accepts_configured_example_route(monkeypatch):
    monkeypatch.setattr(source_identity.sys, "platform", "linux")
    monkeypatch.setattr(source_identity.os, "geteuid", lambda: 0)
    monkeypatch.setattr(
        source_identity.subprocess,
        "run",
        lambda *a, **k: Namespace(stdout="192.0.2.10 dev wg0 src 192.0.2.20"),
    )
    source_identity.check_source()


def local_transport(monkeypatch, target):
    # Real subprocesses, no SSH keys; only the transport is replaced.
    def command(action):
        code = (
            f"import sys;sys.path.insert(0,{str(PROJECT)!r});from pathlib import Path;"
            f"from infra.backup import receiver as r;r.ROOT=Path({str(target)!r});"
            f"import os;os.environ['SSH_ORIGINAL_COMMAND']='gmail-backup {action}';"
            "sys.exit(r.main())"
        )
        return [sys.executable, "-I", "-c", code]

    monkeypatch.setattr(ops, "ssh_command", command)


def test_cli_real_streaming_protocol_without_keys(target, tmp_path, monkeypatch, capsys):
    local_transport(monkeypatch, target)
    source = tmp_path / "source"
    expected = bundle(source)
    ops.offsite_upload(source)
    assert ops.offsite_status()["manifest"] == expected
    destination = tmp_path / "retrieved"
    ops.fetch(Namespace(directory=str(destination)))
    assert r.validate_bundle(destination) == expected
    assert "retrieved" in capsys.readouterr().out


def test_failed_fetch_removes_only_new_destination(target, tmp_path, monkeypatch):
    local_transport(monkeypatch, target)
    destination = tmp_path / "retrieved"
    with pytest.raises(r.ReceiverError):
        ops.fetch(Namespace(directory=str(destination)))
    assert not destination.exists() and (target / ".gmail-manager-backups").exists()


def test_ssh_uses_fixed_commands_and_no_client_path(monkeypatch):
    monkeypatch.setenv("OFFSITE_HOST", "backup-receiver")
    monkeypatch.setenv("OFFSITE_DIRECTORY", "/srv/example/gmail-manager-backups")
    command = ops.ssh_command("upload")
    assert command[-1] == "gmail-backup upload" and "-T" in command
    monkeypatch.setenv("OFFSITE_DIRECTORY", "/root/other")
    with pytest.raises(ops.OperationError):
        ops.ssh_command("upload")
