#!/usr/bin/env python3
"""Project-scoped encrypted backup/restore. Secrets are files, never command arguments."""

import argparse
import contextlib
import datetime as dt
import fcntl
import getpass
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
import warnings
from pathlib import Path

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
# Shared on-wire contract; receiver is stdlib-only and also installed on backup-host.
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))
from infra.backup.receiver import (  # noqa: E402
    CONFIG_FILE,
    COUNTS_VERSION,
    DB_FILE,
    FILES,
    LEGACY_TABLES,
    MAGIC,
    MANIFEST_LIMIT,
    TABLES,
    ReceiverError,
    manifest_value,
    read_bundle,
    read_metadata,
    write_bundle,
)
from infra.backup.receiver import (  # noqa: E402
    ROOT as OFFSITE_ROOT,
)

from app.core.release_meta import APP_VERSION, SCHEMA_VERSION  # noqa: E402

MANAGED = re.compile(r"gmail-manager-\d{8}T\d{6}Z-[a-f0-9]{8}")


class OperationError(Exception):
    pass


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        self.print_usage(sys.stderr)
        self.exit(2, "命令参数不正确；凭据仅通过Secret文件传入，不接受密码参数。\n")


def require(condition, message):
    if not condition:
        raise OperationError(message)


def now():
    return dt.datetime.now(dt.UTC)


def atomic_json(path, value):
    temporary = path.with_name(path.name + ".tmp-" + uuid.uuid4().hex)
    try:
        with temporary.open("x") as stream:
            json.dump(value, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        temporary.unlink(missing_ok=True)


@contextlib.contextmanager
def database_environment():
    """A private, short-lived libpq password file; no password in argv or log."""
    require(
        not os.environ.get("PGPASSWORD"),
        "请用 PGPASSFILE 或 BACKUP_DB_PASSWORD_FILE，不使用 PGPASSWORD",
    )
    secret = os.environ.get("BACKUP_DB_PASSWORD_FILE")
    old = os.environ.get("PGPASSFILE")
    with tempfile.TemporaryDirectory(prefix="gm-credentials-") as directory:
        if secret:
            password = Path(secret).read_text().strip()
            require(password and "\n" not in password, "数据库凭证文件无效")
            escaped = password.replace("\\", "\\\\").replace(":", "\\:")
            path = Path(directory) / "pgpass"
            path.write_text("*:*:*:*:" + escaped + "\n")
            path.chmod(0o600)
            os.environ["PGPASSFILE"] = str(path)
        try:
            yield
        finally:
            if old is None:
                os.environ.pop("PGPASSFILE", None)
            else:
                os.environ["PGPASSFILE"] = old


def tool_versions(connection=None, *, allow_test=False):
    versions = {}
    for tool in ("pg_dump", "pg_restore", "age"):
        require(shutil.which(tool), "缺少备份工具：" + tool)
        result = subprocess.run([tool, "--version"], capture_output=True, check=True, text=True)
        match = re.search(r"(\d+)\.(\d+)(?:\.(\d+))?", result.stdout)
        require(match, "无法识别工具版本：" + tool)
        versions[tool] = match.group()
    require(
        versions["pg_dump"].split(".")[0] == versions["pg_restore"].split(".")[0],
        "pg_dump/pg_restore 主版本必须一致",
    )
    require(
        tuple(map(int, versions["age"].split("."))) >= (1, 2, 1), "age 至少为1.2.1（包含安全修复）"
    )
    if connection:
        major = connection.info.server_version // 10000
        require(int(versions["pg_dump"].split(".")[0]) == major, "客户端工具必须与数据库主版本一致")
        require(
            major == 18
            or (
                allow_test
                and major == 17
                and connection.info.dbname.startswith(("gm_test", "gm_restore"))
            ),
            "生产基线为PG18；PG17仅可显式用于独立测试库",
        )
        versions["server_major"] = major
    return versions


def connect(database, **kwargs):
    require(re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", database or ""), "必须明确指定安全的数据库名")
    return psycopg.connect(dbname=database, **kwargs)


def counts(connection, tables=TABLES):
    result = {}
    for table in tables:
        result[table] = connection.execute(
            sql.SQL("SELECT count(*) FROM public.{}").format(sql.Identifier(table))
        ).fetchone()[0]
    return result


def encrypted_dump(destination, database, snapshot, recipients):
    with destination.open("xb") as output:
        dump = subprocess.Popen(
            [
                "pg_dump",
                "--dbname=" + database,
                "--format=custom",
                "--compress=gzip:6",
                "--no-owner",
                "--no-privileges",
                "--snapshot=" + snapshot,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        age = None
        try:
            age = subprocess.Popen(
                ["age", "--encrypt", "--recipients-file", str(recipients)],
                stdin=dump.stdout,
                stdout=output,
                stderr=subprocess.DEVNULL,
            )
            dump.stdout.close()
            age_status = age.wait()
            dump_status = dump.wait()
            require(dump_status == 0 and age_status == 0, "数据库dump或压缩/age加密失败")
            output.flush()
            os.fsync(output.fileno())
        finally:
            dump.stdout.close()
            if age is not None and age.poll() is None:
                age.terminate()
                age.wait()
            if dump.poll() is None:
                dump.terminate()
                dump.wait()


def encrypted_config(destination, recipients, extra):
    relative = [
        "infra",
        "Makefile",
        ".dockerignore",
        ".gitignore",
        ".node-version",
        "gmail-account-manager-spec.md",
        "frontend/public",
        "frontend/openapi-ts.config.ts",
        "frontend/components.json",
        "backend/app",
        "backend/Dockerfile",
        "frontend/src",
        "frontend/index.html",
        "frontend/vite.config.ts",
        "frontend/tsconfig.json",
        "backend/alembic",
        "backend/alembic.ini",
        "backend/pyproject.toml",
        "backend/uv.lock",
        "frontend/package.json",
        "frontend/pnpm-lock.yaml",
        "frontend/pnpm-workspace.yaml",
        ".env.example",
        "scripts",
        "docs",
        "README.md",
    ]
    with destination.open("xb") as output:
        age = subprocess.Popen(
            ["age", "--encrypt", "--recipients-file", str(recipients)],
            stdin=subprocess.PIPE,
            stdout=output,
            stderr=subprocess.DEVNULL,
        )
        try:
            with tarfile.open(fileobj=age.stdin, mode="w|gz") as archive:
                for relative_path in relative:
                    path = ROOT / relative_path
                    require(path.exists(), "部署配置不完整")
                    archive.add(
                        path,
                        arcname=relative_path,
                        filter=lambda info: None if "__pycache__" in info.name else info,
                    )
                for index, filename in enumerate(extra):
                    path = Path(filename)
                    require(path.is_file() and not path.is_symlink(), "额外部署配置必须是普通文件")
                    archive.add(path, arcname=f"site-config/{index}-{path.name}", recursive=False)
            age.stdin.close()
            require(age.wait() == 0, "部署配置压缩或加密失败")
            output.flush()
            os.fsync(output.fileno())
        finally:
            if age.poll() is None:
                age.terminate()
                age.wait()


def file_digest(path):
    # Transfer-integrity check of ciphertext, not a repeated source-content check.
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def read_manifest(directory):
    require(directory.is_dir() and not directory.is_symlink(), "备份目录无效")
    for filename in FILES:
        require(
            (directory / filename).is_file() and not (directory / filename).is_symlink(),
            "备份文件不完整",
        )
    manifest = json.loads((directory / "manifest.json").read_text())
    require(
        manifest.get("format") == MAGIC and manifest.get("complete") is True,
        "备份格式或完成标记无效",
    )
    counts_version = manifest.get("counts_version", 1)
    require(type(counts_version) is int and counts_version in {1, 2}, "备份清单版本无效")
    allowed_table_sets = (
        (set(TABLES),) if counts_version >= 2 else (set(TABLES), set(LEGACY_TABLES))
    )
    require(
        isinstance(manifest.get("counts"), dict) and set(manifest["counts"]) in allowed_table_sets,
        "备份表清单不完整",
    )
    for filename in (DB_FILE, CONFIG_FILE):
        require(
            file_digest(directory / filename) == manifest["sha256"][filename],
            "加密备份传输完整性校验失败",
        )
    return manifest


def retention(root, current_time):
    """7 daily, 8 ISO-weekly, 12 monthly representatives; always protect newest."""
    candidates = []
    for path in root.iterdir():
        if not MANAGED.fullmatch(path.name) or path.is_symlink() or not path.is_dir():
            continue
        try:
            meta = json.loads((path / "manifest.json").read_text())
            if (
                meta.get("format") == MAGIC
                and meta.get("complete") is True
                and all((path / f).is_file() for f in FILES)
            ):
                candidates.append((dt.datetime.fromisoformat(meta["created_at"]), path))
        except (OSError, ValueError, KeyError):
            continue  # Never delete unrecognized/incomplete/user files.
    candidates.sort(reverse=True)
    if not candidates:
        return []
    keep = {candidates[0][1]}
    proof = root / ".last-verified.json"
    if proof.is_file() and not proof.is_symlink():
        verified = json.loads(proof.read_text()).get("backup", "")
        if MANAGED.fullmatch(verified):
            keep.add(root / verified)
    days, weeks, months = set(), set(), set()
    current_month = current_time.year * 12 + current_time.month
    week_start = current_time.date() - dt.timedelta(days=current_time.weekday())
    for stamp, path in candidates:
        day_age = (current_time.date() - stamp.date()).days
        week_age = (week_start - (stamp.date() - dt.timedelta(days=stamp.weekday()))).days // 7
        month_age = current_month - (stamp.year * 12 + stamp.month)
        for age, limit, bucket, key in (
            (day_age, 7, days, stamp.date()),
            (week_age, 8, weeks, stamp.isocalendar()[:2]),
            (month_age, 12, months, (stamp.year, stamp.month)),
        ):
            if age < 0:
                keep.add(path)
            elif age < limit and key not in bucket:
                keep.add(path)
                bucket.add(key)
    removed = []
    for _, path in candidates:
        if path not in keep:
            # Only directories consisting of exactly our three files are owned here.
            if {p.name for p in path.iterdir()} == set(FILES):
                shutil.rmtree(path)
                removed.append(path.name)
    return removed


@contextlib.contextmanager
def managed_root(path):
    require(path.is_absolute() and not path.is_symlink(), "备份根目录必须为独立绝对路径")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    marker = path / ".gmail-manager-backups"
    if not marker.exists():
        require(not any(path.iterdir()), "已有非本项目文件，拒绝接管备份目录")
        marker.write_text(MAGIC)
    require(marker.read_text() == MAGIC, "备份目录标记不匹配")
    with (path / ".backup.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise OperationError("已有本项目备份正在运行") from None
        yield


def ssh_options():
    options = [
        "-oBatchMode=yes",
        "-oStrictHostKeyChecking=yes",
        "-oConnectTimeout=15",
        "-oIdentitiesOnly=yes",
        "-oForwardAgent=no",
        "-oClearAllForwardings=yes",
        "-oRequestTTY=no",
        "-oServerAliveInterval=30",
        "-oServerAliveCountMax=3",
    ]
    if os.environ.get("OFFSITE_SSH_CONFIG"):
        options += ["-F", os.environ["OFFSITE_SSH_CONFIG"]]
    return options


def ssh_command(action):
    host = os.environ.get("OFFSITE_HOST", "")
    require(
        re.fullmatch(r"[A-Za-z0-9_.@-]+", host) and not host.startswith("-"), "异地主机未配置或无效"
    )
    require(
        os.environ.get("OFFSITE_DIRECTORY", str(OFFSITE_ROOT)) == str(OFFSITE_ROOT),
        "异地目录必须与接收端固定目录一致，不接受客户端路径",
    )
    require(action in {"upload", "status", "fetch"}, "不支持的异地操作")
    return ["ssh", "-T", *ssh_options(), host, "gmail-backup " + action]


def decode_receipt(content):
    require(len(content) <= MANIFEST_LIMIT + 1024, "异地响应格式无效")
    try:
        value = json.loads(content)
        require(
            isinstance(value, dict)
            and value.get("status") in {"published", "unchanged", "ready", "missing"},
            "异地响应格式无效",
        )
        if value["status"] == "missing":
            require(set(value) == {"status"}, "异地响应格式无效")
        else:
            require(set(value) == {"status", "manifest"}, "异地响应格式无效")
            manifest_value(value["manifest"])
        return value
    except (ValueError, ReceiverError, UnicodeError):
        raise OperationError("异地响应格式无效，结果未确认") from None


def offsite_status(args=None):
    result = subprocess.run(
        ssh_command("status"), input=b"", stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    )
    require(result.returncode == 0, "无法查询异地状态；不要自动重放上传")
    value = decode_receipt(result.stdout)
    require(value["status"] in {"ready", "missing"}, "异地状态响应无效")
    if args is not None:
        print(json.dumps(value))
    return value


def close_transfer(process):
    if process.poll() is None:
        process.terminate()
        process.wait()
    for stream in (process.stdin, process.stdout):
        if stream is not None:
            try:
                stream.close()
            except BrokenPipeError:
                pass


def offsite_upload(directory):
    try:
        expected = read_metadata(directory / "manifest.json")
    except (ReceiverError, OSError):
        raise OperationError("本地备份不符合异地文件合同") from None
    process = subprocess.Popen(
        ssh_command("upload"),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    try:
        write_bundle(directory, process.stdin)
        process.stdin.close()
        content = process.stdout.read(MANIFEST_LIMIT + 1025)
        require(len(content) <= MANIFEST_LIMIT + 1024, "异地响应超限，结果未知")
        require(process.wait() == 0, "异地上传未确认成功；结果可能未知，请查询状态，不自动重试")
        receipt = decode_receipt(content)
        require(
            receipt["status"] in {"published", "unchanged"} and receipt.get("manifest") == expected,
            "异地发布确认不匹配，结果未知，请查询状态",
        )
    except (BrokenPipeError, ReceiverError):
        raise OperationError("异地上传未确认成功；请查询状态，不自动重放") from None
    finally:
        close_transfer(process)


def backup(args):
    root = Path(args.directory)
    with managed_root(root):
        status_path = root / "status.json"
        status = {
            "state": "running",
            "last_attempt_at": now().isoformat(),
            "last_success_at": None,
            "offsite": "pending" if os.environ.get("OFFSITE_HOST") else "unconfigured",
        }
        if status_path.exists():
            status["last_success_at"] = json.loads(status_path.read_text()).get("last_success_at")
        atomic_json(status_path, status)
        stage = root / (".partial-" + uuid.uuid4().hex)
        stage.mkdir(mode=0o700)
        try:
            with database_environment(), connect(args.database) as connection:
                versions = tool_versions(connection, allow_test=args.allow_pg17_test)
                connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                snapshot = connection.execute("SELECT pg_export_snapshot()").fetchone()[0]
                table_counts = counts(connection)
                schema = connection.execute(
                    "SELECT version_num FROM public.alembic_version"
                ).fetchone()[0]
                require(schema == SCHEMA_VERSION, "备份数据库迁移版本与应用不一致")
                encrypted_dump(stage / DB_FILE, args.database, snapshot, Path(args.recipients))
            encrypted_config(stage / CONFIG_FILE, Path(args.recipients), args.config)
            stamp = now()
            manifest = {
                "format": MAGIC,
                "counts_version": COUNTS_VERSION,
                "complete": True,
                "created_at": stamp.isoformat(),
                "app_version": APP_VERSION,
                "schema_version": schema,
                "tools": versions,
                "counts": table_counts,
                "compression": "pg-custom-gzip:6",
                "sha256": {f: file_digest(stage / f) for f in (DB_FILE, CONFIG_FILE)},
            }
            atomic_json(stage / "manifest.json", manifest)
            destination = root / (
                "gmail-manager-" + stamp.strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
            )
            stage.rename(destination)
            # Persist local success even when an offsite transfer subsequently fails.
            status["last_success_at"] = stamp.isoformat()
            if os.environ.get("OFFSITE_HOST"):
                try:
                    offsite_upload(destination)
                    status["offsite"] = "success"
                except BaseException:
                    status["offsite"] = "failed"
                    raise
            retention(root, stamp)
            status["state"] = "success"
            atomic_json(status_path, status)
            print(
                json.dumps(
                    {"result": "success", "backup": str(destination), "offsite": status["offsite"]}
                )
            )
        except BaseException:
            status["state"] = "failed"
            atomic_json(status_path, status)
            raise
        finally:
            if stage.exists():
                shutil.rmtree(stage)


def decrypted_pipeline(archive, identity, consumer):
    """Drain the ENTIRE authenticated age stream, even if pg_restore exits early."""
    producer = subprocess.Popen(
        ["age", "--decrypt", "--identity", str(identity), str(archive)],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    process = subprocess.Popen(
        consumer, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    broken = False
    try:
        while chunk := producer.stdout.read(65536):
            if not broken:
                try:
                    process.stdin.write(chunk)
                except BrokenPipeError:
                    broken = True
        try:
            process.stdin.close()
        except BrokenPipeError:
            pass
        require(producer.wait() == 0 and process.wait() == 0, "解密、dump检查或恢复失败")
    finally:
        producer.stdout.close()
        for child in (producer, process):
            if child.poll() is None:
                child.terminate()
                child.wait()


def verify_restored(database, manifest, *, connection=None):
    sys.path.insert(0, str(ROOT / "backend"))
    from app.ops.verify_restore import verify

    with contextlib.nullcontext(connection) if connection else connect(database) as connection:
        expected_tables = tuple(t for t in TABLES if t in manifest["counts"])
        require(
            counts(connection, expected_tables) == manifest["counts"],
            "恢复行数与快照清单不一致",
        )
        require(
            connection.execute("SELECT version_num FROM public.alembic_version").fetchone()[0]
            == manifest["schema_version"],
            "恢复迁移版本不一致",
        )
        checked = verify(connection, Path(os.environ.get("DATA_KEY_DIRECTORY", "/run/secrets")))
    return checked


def writers_stopped(connection, databases):
    busy = connection.execute(
        "SELECT count(*) FROM pg_stat_activity WHERE datname = ANY(%s) AND pid <> pg_backend_pid()",
        (databases,),
    ).fetchone()[0]
    require(busy == 0, "目标仍有连接；请停止API/写入进程后再操作，脚本不会擅自终止会话")


def restore(args):
    directory = Path(args.backup)
    manifest = read_manifest(directory)
    require(Path(args.identity).is_file(), "缺少备份解密私钥")
    with connect("postgres", autocommit=True) as admin:
        with connect(args.source_database) as source:
            tool_versions(source, allow_test=args.allow_pg17_test)
        require(
            args.target_database.startswith("gm_restore_")
            and args.target_database != args.source_database,
            "必须明确指定新的gm_restore_临时数据库，不能覆盖源库",
        )
        require(re.fullmatch(r"gm_restore_[A-Za-z0-9_]+", args.target_database), "临时数据库名无效")
        require(
            not admin.execute(
                "SELECT 1 FROM pg_database WHERE datname=%s", (args.target_database,)
            ).fetchone(),
            "目标数据库已存在，拒绝覆盖",
        )
        require(not args.allow_pg17_test or args.isolated, "PG17例外仅限隔离演练")
        if args.isolated:
            require(args.source_database.startswith("gm_test"), "隔离演练只能使用gm_test源库")
        else:
            require(args.writers_stopped, "恢复前必须显式确认已停止写入")
        decrypted_pipeline(directory / DB_FILE, args.identity, ["pg_restore", "--list"])
        # Verify site-config archive is also fully decryptable, without unpacking it.
        decrypted_pipeline(directory / CONFIG_FILE, args.identity, ["tar", "-tzf", "-"])
        writers_stopped(admin, [args.source_database])
        admin.execute(
            sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(
                sql.Identifier(args.target_database)
            )
        )
        admin.execute(
            sql.SQL("REVOKE ALL ON DATABASE {} FROM PUBLIC").format(
                sql.Identifier(args.target_database)
            )
        )
    # Failure leaves the explicit temporary database for diagnosis, never promotes it.
    decrypted_pipeline(
        directory / DB_FILE,
        args.identity,
        [
            "pg_restore",
            "--single-transaction",
            "--exit-on-error",
            "--no-owner",
            "--no-privileges",
            "--dbname=" + args.target_database,
        ],
    )
    checked = verify_restored(args.target_database, manifest)
    if args.record_verification:
        require(
            MANAGED.fullmatch(directory.name)
            and (directory.parent / ".gmail-manager-backups").read_text() == MAGIC,
            "恢复证明只能写入本项目管理的备份根目录",
        )
        atomic_json(
            directory.parent / ".last-verified.json",
            {"backup": directory.name, "verified_at": now().isoformat()},
        )
    print(
        json.dumps(
            {
                "result": "verified",
                "target_database": args.target_database,
                "decrypted_samples": checked,
                "switched": False,
            }
        )
    )


def verify_admin_step_up(connection, keys: Path, *, read_password=getpass.getpass, read_code=input):
    """高风险切换前要求已初始化的管理员通过密码 + TOTP 二次验证。"""
    row = connection.execute(
        "SELECT id, password_hash, totp_enabled, totp_secret_ciphertext, "
        "totp_secret_nonce, totp_secret_key_version, totp_last_accepted_step "
        "FROM public.admin_users LIMIT 1"
    ).fetchone()
    if row is None:
        return False
    from app.core.encryption import EncryptedValue, EncryptionService
    from app.core.security import accepted_totp_step, verify_password

    (
        admin_id,
        password_hash,
        totp_enabled,
        totp_ciphertext,
        totp_nonce,
        totp_key_version,
        last_step,
    ) = row
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            password = read_password("高风险切换二次验证 — 管理员密码：")
    except getpass.GetPassWarning:
        raise OperationError("无法安全读取管理员密码，切换已取消") from None
    valid, _ = verify_password(password, password_hash)
    require(valid, "管理员身份二次验证失败，切换已取消")
    if totp_enabled:
        encryption = EncryptionService(keys, int(os.environ.get("ACTIVE_DATA_KEY_VERSION", "1")))
        secret = encryption.decrypt(
            EncryptedValue(totp_ciphertext, totp_nonce, totp_key_version),
            "admin_user",
            admin_id,
            "totp_secret",
        )
        code = read_code("高风险切换二次验证 — 当前 6 位 TOTP 验证码：").strip()
        step = accepted_totp_step(secret, code, now(), last_step)
        require(step is not None, "管理员 TOTP 二次验证失败，切换已取消")
        connection.execute(
            "UPDATE public.admin_users SET totp_last_accepted_step=%s WHERE id=%s",
            (step, admin_id),
        )
    else:
        # 当管理员已绑定 WebAuthn 且停用 TOTP 时，CLI 切换使用一次性恢复码作为离线二步验证兜底；
        # 兼容 < 0005 的早期历史备份恢复库（尚未包含 admin_webauthn_credentials 表）。
        try:
            has_webauthn = connection.execute(
                "SELECT count(*) FROM public.admin_webauthn_credentials "
                "WHERE admin_user_id=%s AND revoked_at IS NULL",
                (admin_id,),
            ).fetchone()[0]
        except psycopg.errors.UndefinedTable:
            has_webauthn = 0
        if has_webauthn > 0:
            from app.core.security import token_hash

            recovery_code = read_code(
                "高风险切换二次验证 — 当前 TOTP 已停用，请输入一次性恢复码："
            ).strip()
            used = connection.execute(
                "UPDATE public.admin_recovery_codes SET used_at=%s "
                "WHERE admin_user_id=%s AND code_hash=%s AND used_at IS NULL RETURNING id",
                (now(), admin_id, token_hash(recovery_code).hex()),
            ).fetchone()
            require(used is not None, "管理员一次性恢复码验证失败，切换已取消")
    return True


def switch(args):
    """Switch the application configuration, never rename/drop either database."""
    require(args.writers_stopped and sys.stdin.isatty(), "切换必须停写并在交互终端确认")
    require(
        args.target_database.startswith("gm_restore_")
        and args.target_database != args.source_database,
        "必须明确选择新的恢复临时库",
    )
    manifest = read_manifest(Path(args.backup))
    env_file = Path(args.env_file)
    require(
        env_file.is_absolute() and env_file.is_file() and not env_file.is_symlink(),
        "必须指定真实部署的普通配置文件绝对路径",
    )
    original = env_file.read_bytes()
    text = original.decode("utf-8")
    pattern = r"(?m)^DATABASE_NAME=([A-Za-z_][A-Za-z_0-9]*)$"
    matches = re.findall(pattern, text)
    require(matches == [args.source_database], "配置必须只有一个与源库匹配的DATABASE_NAME")
    require(
        input(
            f"确认应用从 {args.source_database} 改为 {args.target_database}；"
            "旧库和原配置均保留。输入 SWITCH："
        )
        == "SWITCH",
        "切换已取消",
    )
    with connect("postgres", autocommit=True) as admin:
        # Open exactly one validation connection before closing the admission gate.
        with connect(args.target_database) as target:
            for role in (args.migrator_role, args.app_role, args.backup_role):
                require(re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", role), "角色名无效")
                flags = admin.execute(
                    "SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=%s",
                    (role,),
                ).fetchone()
                require(flags is not None and not any(flags), "必须提供既有的最小权限角色")
            require(
                len({args.migrator_role, args.app_role, args.backup_role}) == 3,
                "迁移、应用、备份角色必须独立",
            )
            audit_role = getattr(args, "audit_role", None)
            if audit_role:
                require(re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", audit_role), "审计角色名无效")
                audit_flags = admin.execute(
                    "SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=%s",
                    (audit_role,),
                ).fetchone()
                require(
                    audit_flags is not None and not any(audit_flags),
                    "审计角色必须是既有的最小权限角色",
                )
                require(
                    audit_role not in {args.migrator_role, args.app_role, args.backup_role},
                    "审计角色必须与迁移、应用、备份角色独立",
                )
            verify_admin_step_up(target, Path(os.environ.get("DATA_KEY_DIRECTORY", "/run/secrets")))
            disabled = []
            try:
                for name in (args.source_database, args.target_database):
                    # Record intent BEFORE execution, so an unknown SQL result is still repaired.
                    disabled.append(name)
                    admin.execute(
                        sql.SQL("ALTER DATABASE {} ALLOW_CONNECTIONS false").format(
                            sql.Identifier(name)
                        )
                    )
                busy = admin.execute(
                    "SELECT count(*) FROM pg_stat_activity WHERE datname=ANY(%s) AND pid <> %s",
                    ([args.source_database, args.target_database], target.info.backend_pid),
                ).fetchone()[0]
                require(busy == 0, "仍有写入连接，切换取消；不会终止其他会话")
                # The final validation runs AFTER confirmation under the closed gate.
                verify_restored(args.target_database, manifest, connection=target)
                prepare_permissions(target, args)
                target.execute(
                    "UPDATE public.user_sessions SET revoked_at=now(), "
                    "pending_totp_ciphertext=NULL, pending_totp_nonce=NULL, "
                    "pending_totp_key_version=NULL, pending_totp_expires_at=NULL"
                )
                if str(manifest.get("schema_version", SCHEMA_VERSION)) >= "0005":
                    target.execute("DELETE FROM public.webauthn_challenges")
                target.execute("DELETE FROM public.pre_auth_sessions")
                target.execute("DELETE FROM public.csv_receipts")
                target.execute(
                    "INSERT INTO public.audit_events (id,event_type,metadata) "
                    "VALUES (%s,'settings_changed','{\"operation\":\"restore\"}'::jsonb)",
                    (uuid.uuid4(),),
                )
                target.commit()
                require(env_file.read_bytes() == original, "确认期间配置已改变，切换取消")
                rollback = env_file.with_name(env_file.name + ".before-switch-" + uuid.uuid4().hex)
                with rollback.open("xb") as output:
                    output.write(original)
                    output.flush()
                    os.fsync(output.fileno())
                temporary = env_file.with_name(env_file.name + ".switch-" + uuid.uuid4().hex)
                try:
                    with temporary.open("xb") as output:
                        output.write(
                            re.sub(pattern, "DATABASE_NAME=" + args.target_database, text).encode()
                        )
                        output.flush()
                        os.fsync(output.fileno())
                    os.replace(temporary, env_file)
                    fd = os.open(env_file.parent, os.O_RDONLY)
                    try:
                        os.fsync(fd)
                    finally:
                        os.close(fd)
                finally:
                    temporary.unlink(missing_ok=True)
            finally:
                # Names never change. Independent connection repairs even an unknown ALTER result.
                with connect("postgres", autocommit=True) as recovery:
                    for name in disabled:
                        recovery.execute(
                            sql.SQL("ALTER DATABASE {} ALLOW_CONNECTIONS true").format(
                                sql.Identifier(name)
                            )
                        )
    print("配置已切换；旧库及原配置保留。应用尚未启动，必须检查健康后手工恢复服务。")


def prepare_permissions(connection, args):
    """Restore only this database's objects; never REASSIGN OWNED across a cluster."""
    connection.execute(
        sql.SQL("REVOKE ALL ON DATABASE {} FROM PUBLIC").format(
            sql.Identifier(args.target_database)
        )
    )
    for role in (args.migrator_role, args.app_role, args.backup_role):
        connection.execute(
            sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                sql.Identifier(args.target_database), sql.Identifier(role)
            )
        )
    connection.execute(
        sql.SQL("ALTER DATABASE {} OWNER TO {}").format(
            sql.Identifier(args.target_database), sql.Identifier(args.migrator_role)
        )
    )
    connection.execute("REVOKE ALL ON SCHEMA public FROM PUBLIC")
    connection.execute(
        sql.SQL("ALTER SCHEMA public OWNER TO {}").format(sql.Identifier(args.migrator_role))
    )
    for role in (args.app_role, args.backup_role):
        connection.execute(
            sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(sql.Identifier(role))
        )
    for name, kind in connection.execute(
        "SELECT relname,relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname='public' AND relkind IN ('r','S') ORDER BY relkind DESC"
    ).fetchall():
        connection.execute(
            sql.SQL("ALTER {} public.{} OWNER TO {}").format(
                sql.SQL("SEQUENCE" if kind == "S" else "TABLE"),
                sql.Identifier(name),
                sql.Identifier(args.migrator_role),
            )
        )
    connection.execute(
        sql.SQL("GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO {}").format(
            sql.Identifier(args.app_role)
        )
    )
    connection.execute(
        sql.SQL("REVOKE UPDATE,DELETE,TRUNCATE ON TABLE public.audit_events FROM {}").format(
            sql.Identifier(args.app_role)
        )
    )
    connection.execute(
        sql.SQL("GRANT SELECT,INSERT ON TABLE public.audit_events TO {}").format(
            sql.Identifier(args.app_role)
        )
    )
    audit_role = getattr(args, "audit_role", None)
    if audit_role:
        connection.execute(
            sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                sql.Identifier(args.target_database), sql.Identifier(audit_role)
            )
        )
        connection.execute(
            sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(sql.Identifier(audit_role))
        )
        connection.execute(
            sql.SQL("REVOKE ALL ON TABLE public.audit_events FROM {}").format(
                sql.Identifier(audit_role)
            )
        )
        connection.execute(
            sql.SQL("GRANT INSERT ON TABLE public.audit_events TO {}").format(
                sql.Identifier(audit_role)
            )
        )
    connection.execute(
        sql.SQL("GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO {}").format(
            sql.Identifier(args.app_role)
        )
    )
    connection.execute(
        sql.SQL("GRANT SELECT ON ALL TABLES IN SCHEMA public TO {}").format(
            sql.Identifier(args.backup_role)
        )
    )
    connection.execute(
        sql.SQL("GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO {}").format(
            sql.Identifier(args.backup_role)
        )
    )
    for privileges, objects, role in (
        ("SELECT,INSERT,UPDATE,DELETE", "TABLES", args.app_role),
        ("USAGE,SELECT", "SEQUENCES", args.app_role),
        ("SELECT", "TABLES", args.backup_role),
        ("SELECT", "SEQUENCES", args.backup_role),
    ):
        connection.execute(
            sql.SQL(
                "ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT {} ON {} TO {}"
            ).format(
                sql.Identifier(args.migrator_role),
                sql.SQL(privileges),
                sql.SQL(objects),
                sql.Identifier(role),
            )
        )


def fetch(args):
    destination = Path(args.directory)
    require(
        destination.is_absolute() and not destination.exists(), "取回目录必须是尚不存在的绝对路径"
    )
    destination.mkdir(mode=0o700, parents=True)
    process = None
    try:
        process = subprocess.Popen(
            ssh_command("fetch"),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        read_bundle(destination, process.stdout)
        require(process.wait() == 0, "取回未确认成功，请检查连接后重新取回")
    except BaseException:
        shutil.rmtree(destination)
        raise
    finally:
        if process is not None:
            close_transfer(process)
    print(json.dumps({"result": "retrieved", "directory": str(destination)}))


def schedule(args):
    # One owner: this dedicated service, no host cron/systemd timer in parallel.
    require(re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", args.at), "调度时间必须为UTC HH:MM")
    hour, minute = map(int, args.at.split(":"))
    while True:
        current = now()
        next_run = current.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if next_run <= current:
            next_run += dt.timedelta(days=1)
        time.sleep((next_run - current).total_seconds())
        try:
            backup(args)
        except Exception:
            # Failed attempt already persisted, keep scheduler alive for tomorrow.
            print("每日备份失败；检查认证后的备份状态并人工处理。", file=sys.stderr, flush=True)


def health(args):
    data = json.loads((Path(args.directory) / "status.json").read_text())
    require(data["state"] == "success" and data.get("last_success_at"), "最近备份未成功")
    require(
        now() - dt.datetime.fromisoformat(data["last_success_at"]) <= dt.timedelta(hours=36),
        "最近备份已过期",
    )


def main():
    os.umask(0o077)
    parser = SafeArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="command", required=True)
    for command in ("backup", "schedule"):
        p = subs.add_parser(command)
        p.add_argument("--database", required=True)
        p.add_argument("--directory", required=True)
        p.add_argument("--recipients", required=True)
        p.add_argument("--config", action="append", default=[])
        p.add_argument("--allow-pg17-test", action="store_true")
        if command == "schedule":
            p.add_argument("--at", default="02:00")
    p = subs.add_parser("restore")
    p.add_argument("--backup", required=True)
    p.add_argument("--identity", required=True)
    p.add_argument("--record-verification", action="store_true")
    p.add_argument("--source-database", required=True)
    p.add_argument("--target-database", required=True)
    p.add_argument("--isolated", action="store_true")
    p.add_argument("--writers-stopped", action="store_true")
    p.add_argument("--allow-pg17-test", action="store_true")
    p = subs.add_parser("switch")
    for name in (
        "backup",
        "source-database",
        "target-database",
        "env-file",
        "migrator-role",
        "app-role",
        "backup-role",
    ):
        p.add_argument("--" + name, required=True)
    p.add_argument("--audit-role", default=None)
    p.add_argument("--writers-stopped", action="store_true")
    subs.add_parser("offsite-status")
    p = subs.add_parser("health")
    p.add_argument("--directory", required=True)
    p = subs.add_parser("fetch")
    p.add_argument("--directory", required=True)
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        if args.command == "offsite-status":
            offsite_status(args)
        elif args.command in {"backup", "schedule", "health", "fetch"}:
            globals()[args.command](args)
        else:
            with database_environment():
                globals()[args.command](args)
    except (Exception, KeyboardInterrupt) as exc:
        # SQL, tool stderr and sampled plaintext never enter logs.
        print(
            str(exc)
            if isinstance(exc, OperationError)
            else "操作失败或中断；未确认成功，请检查目标状态和运维恢复步骤。",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
