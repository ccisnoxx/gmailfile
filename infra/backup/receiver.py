#!/usr/bin/python3 -I
"""固定 SSH 接收端：只处理本项目三个备份文件，不执行客户端命令或通用解包。"""

import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import stat
import sys
import tarfile
import uuid
from pathlib import Path

ROOT = Path("/srv/example/gmail-manager-backups")
MAGIC = "gmail-account-manager-backup-v1"
COUNTS_VERSION = 2
PROTOCOL = "gmail-backup"
DB_FILE = "database.dump.age"
CONFIG_FILE = "deployment.tar.gz.age"
# Manifest first bounds and validates metadata before accepting ciphertext.
FILES = ("manifest.json", DB_FILE, CONFIG_FILE)
LEGACY_TABLES = (
    "admin_users",
    "admin_recovery_codes",
    "user_sessions",
    "pre_auth_sessions",
    "auth_throttles",
    "gmail_accounts",
    "tags",
    "gmail_account_tags",
    "audit_events",
    "csv_receipts",
)
TABLES = (
    *LEGACY_TABLES,
    "admin_webauthn_credentials",
    "webauthn_challenges",
    "registered_apps",
    "gmail_account_apps",
)
MANIFEST_LIMIT = 16384
# Shared system disk: one request cannot consume arbitrary space with an untrusted tar size.
MAX_BUNDLE_BYTES = 2 * 1024**3
DISK_RESERVE = 256 * 1024**2
AGE_HEADER = b"age-encryption.org/v1\n"


class ReceiverError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise ReceiverError(code)


def sync_directory(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def regular(path):
    info = path.lstat()
    return stat.S_ISREG(info.st_mode) and info.st_nlink == 1


def manifest_value(data):
    required_keys = {
        "format",
        "complete",
        "created_at",
        "app_version",
        "schema_version",
        "tools",
        "counts",
        "compression",
        "sha256",
    }
    require(
        isinstance(data, dict)
        and required_keys <= set(data)
        and set(data) <= (required_keys | {"counts_version"}),
        "MANIFEST_FIELDS_INVALID",
    )
    counts_version = data.get("counts_version", 1)
    require(type(counts_version) is int and counts_version in {1, 2}, "MANIFEST_FIELDS_INVALID")
    require(data["format"] == MAGIC and data["complete"] is True, "MANIFEST_INCOMPLETE")
    require(isinstance(data["created_at"], str), "MANIFEST_TIME_INVALID")
    try:
        stamp = dt.datetime.fromisoformat(data["created_at"])
        require(stamp.tzinfo is not None, "MANIFEST_TIME_INVALID")
    except ValueError:
        raise ReceiverError("MANIFEST_TIME_INVALID") from None
    require(
        isinstance(data["app_version"], str)
        and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", data["app_version"]),
        "MANIFEST_VERSION_INVALID",
    )
    require(
        isinstance(data["schema_version"], str)
        and re.fullmatch(r"[0-9]{4}", data["schema_version"]),
        "MANIFEST_SCHEMA_INVALID",
    )
    tools = data["tools"]
    require(
        isinstance(tools, dict) and set(tools) == {"pg_dump", "pg_restore", "age", "server_major"},
        "MANIFEST_TOOLS_INVALID",
    )
    require(
        type(tools["server_major"]) is int and tools["server_major"] >= 17, "MANIFEST_TOOLS_INVALID"
    )
    for tool in ("pg_dump", "pg_restore", "age"):
        require(
            isinstance(tools[tool], str)
            and re.fullmatch(r"[0-9]+\.[0-9]+(?:\.[0-9]+)?", tools[tool]),
            "MANIFEST_TOOLS_INVALID",
        )
    counts = data["counts"]
    allowed_table_sets = (
        (set(TABLES),) if counts_version >= 2 else (set(TABLES), set(LEGACY_TABLES))
    )
    require(
        isinstance(counts, dict)
        and set(counts) in allowed_table_sets
        and all(type(n) is int and n >= 0 for n in counts.values()),
        "MANIFEST_COUNTS_INVALID",
    )
    require(data["compression"] == "pg-custom-gzip:6", "MANIFEST_COMPRESSION_INVALID")
    digests = data["sha256"]
    require(
        isinstance(digests, dict)
        and set(digests) == {DB_FILE, CONFIG_FILE}
        and all(isinstance(v, str) and re.fullmatch(r"[a-f0-9]{64}", v) for v in digests.values()),
        "MANIFEST_DIGEST_INVALID",
    )
    return data


def read_metadata(path):
    require(regular(path) and path.stat().st_size <= MANIFEST_LIMIT, "MANIFEST_FILE_INVALID")
    try:
        return manifest_value(json.loads(path.read_bytes()))
    except (ValueError, UnicodeError):
        raise ReceiverError("MANIFEST_JSON_INVALID") from None


def validate_bundle(directory):
    require(stat.S_ISDIR(directory.lstat().st_mode), "BUNDLE_DIRECTORY_INVALID")
    require({p.name for p in directory.iterdir()} == set(FILES), "BUNDLE_FILES_INVALID")
    data = read_metadata(directory / "manifest.json")
    total = 0
    for name in (DB_FILE, CONFIG_FILE):
        path = directory / name
        require(regular(path), "BUNDLE_FILE_TYPE_INVALID")
        total += path.stat().st_size
        require(total <= MAX_BUNDLE_BYTES, "BUNDLE_SIZE_EXCEEDED")
        with path.open("rb") as stream:
            require(stream.read(len(AGE_HEADER)) == AGE_HEADER, "BUNDLE_NOT_AGE")
            stream.seek(0)
            # Only ciphertext transfer integrity; no application plaintext is loaded.
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        require(digest == data["sha256"][name], "BUNDLE_DIGEST_MISMATCH")
    return data


def write_bundle(directory, stream):
    """Write fixed regular USTAR entries with a deterministic 1024-byte EOF trailer."""
    for name in FILES:
        path = directory / name
        require(regular(path), "BUNDLE_FILE_TYPE_INVALID")
        size = path.stat().st_size
        info = tarfile.TarInfo(name)
        info.size = size
        info.mode = 0o600
        stream.write(info.tobuf(format=tarfile.USTAR_FORMAT))
        remaining = size
        with path.open("rb") as source:
            while remaining:
                chunk = source.read(min(65536, remaining))
                require(bool(chunk), "BUNDLE_SIZE_CHANGED")
                stream.write(chunk)
                remaining -= len(chunk)
            require(not source.read(1), "BUNDLE_SIZE_CHANGED")
        padding = (-size) % 512
        if padding:
            stream.write(b"\x00" * padding)
    stream.write(b"\x00" * 1024)
    stream.flush()


def read_bundle(directory, stream, *, reserve=DISK_RESERVE):
    """Reject links, sparse/PAX/GNU extensions, duplicates, paths and missing bytes."""
    total = 0
    # Raw fixed-size TarInfo parsing avoids unbounded extension-header processing in older tarfile.
    for expected in FILES:
        header = stream.read(512)
        require(len(header) == 512 and any(header), "TAR_TRUNCATED")
        try:
            info = tarfile.TarInfo.frombuf(header, "utf-8", "strict")
        except (tarfile.TarError, UnicodeError):
            raise ReceiverError("TAR_HEADER_INVALID") from None
        require(
            info.name == expected and info.type == tarfile.REGTYPE and not info.linkname,
            "TAR_ENTRY_DENIED",
        )
        require(header[257:263] == b"ustar\x00", "TAR_FORMAT_DENIED")
        require(
            0 < info.size <= (MANIFEST_LIMIT if expected == "manifest.json" else MAX_BUNDLE_BYTES),
            "TAR_SIZE_INVALID",
        )
        total += info.size
        require(
            total <= MAX_BUNDLE_BYTES and shutil.disk_usage(directory).free - info.size >= reserve,
            "BUNDLE_SPACE_INSUFFICIENT",
        )
        fd = os.open(
            directory / expected, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
        )
        with os.fdopen(fd, "wb") as output:
            remaining = info.size
            while remaining:
                chunk = stream.read(min(65536, remaining))
                require(bool(chunk), "TAR_TRUNCATED")
                output.write(chunk)
                remaining -= len(chunk)
            output.flush()
            os.fsync(output.fileno())
        padding = (-info.size) % 512
        require(stream.read(padding) == b"\x00" * padding, "TAR_PADDING_INVALID")
        if expected == "manifest.json":
            read_metadata(directory / expected)
    # The producer closes SSH stdin after tar EOF. Bound and validate the entire trailing padding.
    # Legacy tarfile(w|) appends 1024 EOF bytes then pads to 10240-byte records, reaching 10752
    # bytes when the archive body ends 512 bytes before a 10240-byte boundary.
    tail = stream.read(10753)
    require(1024 <= len(tail) <= 10752 and not any(tail), "TAR_TRAILER_INVALID")
    data = validate_bundle(directory)
    sync_directory(directory)
    return data


def remove_transient(directory):
    require(
        directory.name == ".previous" or re.fullmatch(r"\.incoming-[a-f0-9]{32}", directory.name),
        "STAGING_NAME_INVALID",
    )
    require(
        stat.S_ISDIR(directory.lstat().st_mode)
        and {p.name for p in directory.iterdir()} <= set(FILES)
        and all(regular(p) for p in directory.iterdir()),
        "STAGING_CONTENT_INVALID",
    )
    shutil.rmtree(directory)


def recover(root):
    current, previous = root / "current", root / ".previous"
    if previous.exists() or previous.is_symlink():
        if current.exists() or current.is_symlink():
            # Never delete the old copy without validating the installed new copy.
            validate_bundle(current)
            remove_transient(previous)
        else:
            validate_bundle(previous)
            previous.rename(current)
        sync_directory(root)
    for path in root.iterdir():
        if path.name.startswith(".incoming-"):
            remove_transient(path)
            sync_directory(root)


@contextlib.contextmanager
def receiver_lock(root):
    require(root.is_absolute() and stat.S_ISDIR(root.lstat().st_mode), "ROOT_INVALID")
    marker = root / ".gmail-manager-backups"
    require(regular(marker) and marker.read_text() == MAGIC, "ROOT_MARKER_INVALID")
    fd = os.open(root / ".receiver.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "a+b") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ReceiverError("RECEIVER_BUSY") from None
        recover(root)
        yield


def upload(root, stream):
    stage = root / (".incoming-" + uuid.uuid4().hex)
    stage.mkdir(mode=0o700)
    current, previous = root / "current", root / ".previous"
    moved_old = False
    installed = False
    try:
        incoming = read_bundle(stage, stream)
        old = validate_bundle(current) if current.exists() or current.is_symlink() else None
        if old == incoming:
            return {"status": "unchanged", "manifest": incoming}
        if old is not None:
            require(
                dt.datetime.fromisoformat(incoming["created_at"])
                > dt.datetime.fromisoformat(old["created_at"]),
                "BACKUP_NOT_NEWER",
            )
            current.rename(previous)
            moved_old = True
        try:
            stage.rename(current)
            installed = True
            sync_directory(root)
            confirmed = validate_bundle(current)
            require(confirmed == incoming, "PUBLISHED_MANIFEST_CHANGED")
        except BaseException:
            # No old copy is deleted on a failed publication/confirmation.
            if installed:
                current.rename(stage)
            if moved_old:
                previous.rename(current)
            sync_directory(root)
            raise
        if moved_old:
            remove_transient(previous)
            sync_directory(root)
        return {"status": "published", "manifest": confirmed}
    finally:
        if stage.exists():
            remove_transient(stage)


def dispatch(command, root, source, destination):
    # No shell splitting/eval, caller-supplied paths, SFTP or arbitrary Python commands.
    require(
        command in {f"{PROTOCOL} upload", f"{PROTOCOL} status", f"{PROTOCOL} fetch"},
        "COMMAND_DENIED",
    )
    with receiver_lock(root):
        if command == f"{PROTOCOL} upload":
            response = upload(root, source)
        elif command == f"{PROTOCOL} status":
            current = root / "current"
            response = (
                {"status": "ready", "manifest": validate_bundle(current)}
                if current.exists()
                else {"status": "missing"}
            )
        else:
            validate_bundle(root / "current")
            write_bundle(root / "current", destination)
            return
        destination.write((json.dumps(response, separators=(",", ":")) + "\n").encode())


def main():
    os.umask(0o077)
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))

    def expired(*_):
        raise ReceiverError("RECEIVER_TIMEOUT")

    signal.signal(signal.SIGALRM, expired)
    signal.alarm(900)  # A disconnected/stalled authenticated peer cannot hold the lock forever.
    try:
        require(len(sys.argv) == 1, "ARGUMENTS_DENIED")
        dispatch(
            os.environ.get("SSH_ORIGINAL_COMMAND", ""), ROOT, sys.stdin.buffer, sys.stdout.buffer
        )
        sys.stdout.buffer.flush()
    except (Exception, KeyboardInterrupt) as exc:
        # Never echo client commands, archive headers, data, paths or exception contents.
        code = str(exc) if isinstance(exc, ReceiverError) else "RECEIVER_FAILED"
        print(code, file=sys.stderr)
        return 1
    finally:
        signal.alarm(0)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
