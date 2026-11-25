"""Wave 2 (TC-P0-010 & TC-P1-007): 真实 PostgreSQL 角色脚本与全链路备份恢复切换集成测试。

在每用例独立初始化的临时 PostgreSQL 集群中直接执行：
1. infra/postgres/init-roles.sh（全新库最小权限、非 TTY 要求、防重跑改密、四角色权限边界）；
2. infra/postgres/upgrade-backup-role.sh 与 upgrade-audit-role.sh（0003 旧库升级路径）；
3. scripts/backup_tool.py 全链路：真实 pg_dump + 加密归档 + 异地受限 USTAR 收发（receiver.py）+
   篡改/错误私钥/缺失旧密钥拒收 + 新库 pg_restore + 多版本密钥抽样解密 + 0004 审计链验证 +
   switch（SWITCH 确认 + 管理员密码与 TOTP Step-Up + 会话撤销 + 权限恢复 + 原子替换 .env 与回退）。

注：若环境已安装 age/age-keygen 则使用真实 age 二进制；否则在临时目录提供基于 AES-256-GCM 的
认证加密兼容包装，确保 pg_dump/pg_restore/PostgreSQL/receiver/switch 全链路 100% 实库运行。
按 docs/validation.md，本机 PG17 执行结果不能替代 PG18.7 Linux 容器正式验收。
"""

from __future__ import annotations

import importlib.util
import io
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
from argparse import Namespace
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import psycopg
import pyotp
import pytest
from alembic.config import Config
from sqlalchemy import create_engine

from alembic import command
from app.core.encryption import DecryptionError, EncryptionService
from app.core.security import passwords
from app.services.audit_integrity import verify_audit_records

pytestmark = pytest.mark.integration

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_DIR = REPO_ROOT / "backend"
POSTGRES_SCRIPTS = REPO_ROOT / "infra" / "postgres"


def _load_script_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@contextmanager
def ephemeral_pg_cluster(dbname: str):
    """独立 PG 集群：本地 socket 免密（模拟 initdb 容器），TCP 强制 scram-sha-256 密码校验。"""
    initdb = shutil.which("initdb")
    pg_ctl = shutil.which("pg_ctl")
    createdb = shutil.which("createdb")
    psql = shutil.which("psql")
    if not all((initdb, pg_ctl, createdb, psql)):
        pytest.fail(
            "缺少本地 PostgreSQL 工具（initdb/pg_ctl/createdb/psql），无法执行角色与恢复实库测试"
        )

    # macOS AF_UNIX 路径限长 104 字节，使用短临时目录
    with tempfile.TemporaryDirectory(dir="/tmp", prefix="gm_pg_") as raw_dir:
        pg_dir = Path(raw_dir) / "data"
        sock_dir = Path(raw_dir) / "sock"
        sock_dir.mkdir(mode=0o700)
        port = _free_port()
        subprocess.run(
            [
                initdb,
                "-D",
                str(pg_dir),
                "--username=postgres",
                "--auth-local=trust",
                "--auth-host=scram-sha-256",
                "--encoding=UTF8",
                "--no-locale",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        subprocess.run(
            [
                pg_ctl,
                "-D",
                str(pg_dir),
                "-l",
                str(Path(raw_dir) / "pg.log"),
                "-o",
                f"-p {port} -k {sock_dir} -c listen_addresses=127.0.0.1",
                "start",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        try:
            subprocess.run(
                [createdb, "-h", str(sock_dir), "-p", str(port), "-U", "postgres", dbname],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            yield {
                "sock_dir": sock_dir,
                "port": port,
                "dbname": dbname,
            }
        finally:
            subprocess.run(
                [pg_ctl, "-D", str(pg_dir), "-m", "immediate", "stop"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )


def _alembic_upgrade(dsn: str, revision: str = "head") -> None:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    engine = create_engine(dsn)
    try:
        with engine.connect() as conn:
            cfg.attributes["connection"] = conn
            command.upgrade(cfg, revision)
    finally:
        engine.dispose()


def _write_secret(directory: Path, name: str, value: str) -> Path:
    path = directory / name
    path.write_text(value, encoding="utf-8")
    path.chmod(0o600)
    return path


def _run_role_script(script_name: str, cluster: dict, extra_env: dict[str, str]):
    env = {
        **os.environ,
        "PGHOST": str(cluster["sock_dir"]),
        "PGPORT": str(cluster["port"]),
        "POSTGRES_USER": "postgres",
        "POSTGRES_DB": cluster["dbname"],
        **extra_env,
    }
    return subprocess.run(
        ["bash", str(POSTGRES_SCRIPTS / script_name)],
        env=env,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        start_new_session=True,
    )


def _tcp_connect(cluster: dict, user: str, password: str, dbname: str | None = None):
    return psycopg.connect(
        host="127.0.0.1",
        port=cluster["port"],
        user=user,
        password=password,
        dbname=dbname or cluster["dbname"],
    )


def _assert_four_role_boundaries(
    cluster: dict,
    *,
    app_pw: str,
    audit_pw: str,
    backup_pw: str,
    dbname: str | None = None,
) -> None:
    target_db = dbname or cluster["dbname"]

    # 1. gm_app：业务表正常读写，audit_events 仅可 SELECT/INSERT，禁止 UPDATE/DELETE/TRUNCATE
    with _tcp_connect(cluster, "gm_app", app_pw, target_db) as conn:
        tag_id = uuid4()
        conn.execute("INSERT INTO public.tags (id, name) VALUES (%s, %s)", (tag_id, "role-test"))
        assert conn.execute("SELECT name FROM public.tags WHERE id = %s", (tag_id,)).fetchone() == (
            "role-test",
        )
        conn.execute("DELETE FROM public.tags WHERE id = %s", (tag_id,))
        ev_id = uuid4()
        conn.execute(
            "INSERT INTO public.audit_events (id, event_type, metadata) VALUES (%s, %s, %s::jsonb)",
            (ev_id, "login_success", '{"operation":"role-check"}'),
        )
        conn.commit()
        assert (
            conn.execute(
                "SELECT event_type FROM public.audit_events WHERE id = %s", (ev_id,)
            ).fetchone()[0]
            == "login_success"
        )
        for forbidden_sql in (
            f"UPDATE public.audit_events SET event_type = 'x' WHERE id = '{ev_id}'",
            f"DELETE FROM public.audit_events WHERE id = '{ev_id}'",
            "TRUNCATE TABLE public.audit_events",
        ):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute(forbidden_sql)
            conn.rollback()

    # 2. gm_audit_writer：仅允许 INSERT public.audit_events，禁止读取/修改审计表及访问业务表
    with _tcp_connect(cluster, "gm_audit_writer", audit_pw, target_db) as conn:
        writer_ev = uuid4()
        conn.execute(
            "INSERT INTO public.audit_events (id, event_type, metadata) VALUES (%s, %s, %s::jsonb)",
            (writer_ev, "logout", '{"operation":"audit-writer"}'),
        )
        conn.commit()
        for forbidden_sql in (
            "SELECT count(*) FROM public.audit_events",
            f"UPDATE public.audit_events SET event_type = 'x' WHERE id = '{writer_ev}'",
            f"DELETE FROM public.audit_events WHERE id = '{writer_ev}'",
            "SELECT count(*) FROM public.gmail_accounts",
            "SELECT count(*) FROM public.admin_users",
        ):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute(forbidden_sql)
            conn.rollback()

    # 3. gm_backup：可只读查询全部表，禁止任何写入
    with _tcp_connect(cluster, "gm_backup", backup_pw, target_db) as conn:
        assert conn.execute("SELECT count(*) FROM public.audit_events").fetchone()[0] >= 2
        assert conn.execute("SELECT count(*) FROM public.gmail_accounts").fetchone()[0] >= 0
        for forbidden_sql in (
            f"INSERT INTO public.tags (id, name) VALUES ('{uuid4()}', 'forbidden')",
            f"INSERT INTO public.audit_events (id, event_type, metadata) "
            f"VALUES ('{uuid4()}', 'x', '{{}}'::jsonb)",
        ):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute(forbidden_sql)
            conn.rollback()


def test_init_roles_script_fresh_cluster_enforces_least_privilege_and_rejects_rerun(tmp_path):
    """TC-P0-010（全新库）：init-roles.sh + gm_migrator 迁移 + 四角色最小权限 + 防重跑改密。"""
    app_pw = f"App-{secrets.token_urlsafe(12)}"
    migrator_pw = f"Mig-{secrets.token_urlsafe(12)}"
    backup_pw = f"Bak-{secrets.token_urlsafe(12)}"
    audit_pw = f"Aud-{secrets.token_urlsafe(12)}"

    secret_env = {
        "GM_APP_PASSWORD_FILE": str(_write_secret(tmp_path, "db_password", app_pw)),
        "GM_MIGRATOR_PASSWORD_FILE": str(
            _write_secret(tmp_path, "db_migrator_password", migrator_pw)
        ),
        "GM_BACKUP_PASSWORD_FILE": str(_write_secret(tmp_path, "db_backup_password", backup_pw)),
        "GM_AUDIT_PASSWORD_FILE": str(_write_secret(tmp_path, "db_audit_password", audit_pw)),
    }

    with ephemeral_pg_cluster("gm_test_roles_fresh") as cluster:
        # 1. 首次执行 init-roles.sh 必须成功
        res = _run_role_script("init-roles.sh", cluster, secret_env)
        assert res.returncode == 0, res.stderr

        # 2. 使用 gm_migrator 执行全量 Alembic 迁移（0001..0004）
        migrator_dsn = (
            f"postgresql+psycopg://gm_migrator:{migrator_pw}"
            f"@127.0.0.1:{cluster['port']}/{cluster['dbname']}"
        )
        _alembic_upgrade(migrator_dsn, "head")

        # 3. 验证四角色最小权限边界
        _assert_four_role_boundaries(cluster, app_pw=app_pw, audit_pw=audit_pw, backup_pw=backup_pw)

        # 4. 换新密码重复执行 init-roles.sh 必须拒绝且不得更改原角色密码（单事务回滚）
        other_env = {
            "GM_APP_PASSWORD_FILE": str(_write_secret(tmp_path, "app2", "NewAppPass#2026!")),
            "GM_MIGRATOR_PASSWORD_FILE": str(_write_secret(tmp_path, "mig2", "NewMigPass#2026!")),
            "GM_BACKUP_PASSWORD_FILE": str(_write_secret(tmp_path, "bak2", "NewBakPass#2026!")),
            "GM_AUDIT_PASSWORD_FILE": str(_write_secret(tmp_path, "aud2", "NewAudPass#2026!")),
        }
        rerun = _run_role_script("init-roles.sh", cluster, other_env)
        assert rerun.returncode != 0
        # 原密码仍然有效，新密码被拒
        with _tcp_connect(cluster, "gm_app", app_pw) as conn:
            assert conn.execute("SELECT 1").fetchone() == (1,)
        with pytest.raises(psycopg.OperationalError):
            _tcp_connect(cluster, "gm_app", "NewAppPass#2026!")


def test_upgrade_backup_and_audit_role_scripts_on_0003_database(tmp_path):
    """TC-P0-010（0003 升级）：执行 upgrade-backup-role.sh、0004 迁移与 upgrade-audit-role.sh。"""
    app_pw = f"App-{secrets.token_urlsafe(12)}"
    migrator_pw = f"Mig-{secrets.token_urlsafe(12)}"
    backup_pw = f"Bak-{secrets.token_urlsafe(12)}"
    audit_pw = f"Aud-{secrets.token_urlsafe(12)}"

    with ephemeral_pg_cluster("gm_test_roles_upgrade") as cluster:
        # 构造模拟 0003 旧库：仅有 gm_migrator 与 gm_app（尚无 gm_backup 与 gm_audit_writer）
        with psycopg.connect(
            host=str(cluster["sock_dir"]),
            port=cluster["port"],
            user="postgres",
            dbname=cluster["dbname"],
            autocommit=True,
        ) as super_conn:
            super_conn.execute(
                f"CREATE ROLE gm_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE "
                f"PASSWORD '{migrator_pw}'"
            )
            super_conn.execute(
                f"CREATE ROLE gm_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '{app_pw}'"
            )
            super_conn.execute(f"ALTER DATABASE {cluster['dbname']} OWNER TO gm_migrator")
            super_conn.execute(f"REVOKE ALL ON DATABASE {cluster['dbname']} FROM PUBLIC")
            super_conn.execute(
                f"GRANT CONNECT ON DATABASE {cluster['dbname']} TO gm_migrator, gm_app"
            )
            super_conn.execute("REVOKE ALL ON SCHEMA public FROM PUBLIC")
            super_conn.execute("GRANT USAGE, CREATE ON SCHEMA public TO gm_migrator")
            super_conn.execute("GRANT USAGE ON SCHEMA public TO gm_app")
            super_conn.execute(
                "ALTER DEFAULT PRIVILEGES FOR ROLE gm_migrator IN SCHEMA public "
                "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gm_app"
            )
            super_conn.execute(
                "ALTER DEFAULT PRIVILEGES FOR ROLE gm_migrator IN SCHEMA public "
                "GRANT USAGE, SELECT ON SEQUENCES TO gm_app"
            )

        migrator_dsn = (
            f"postgresql+psycopg://gm_migrator:{migrator_pw}"
            f"@127.0.0.1:{cluster['port']}/{cluster['dbname']}"
        )
        _alembic_upgrade(migrator_dsn, "0003")

        # 写入一条 0003 存量审计事件
        with _tcp_connect(cluster, "gm_app", app_pw) as conn:
            conn.execute(
                "INSERT INTO public.audit_events (id, event_type, metadata) "
                "VALUES (%s, 'login_success', '{}'::jsonb)",
                (uuid4(),),
            )
            conn.commit()

        # 1. 执行 upgrade-backup-role.sh，并验证重复执行拒绝且不改密
        bak_env = {
            "GM_BACKUP_PASSWORD_FILE": str(_write_secret(tmp_path, "bak_pw", backup_pw)),
        }
        res_bak = _run_role_script("upgrade-backup-role.sh", cluster, bak_env)
        assert res_bak.returncode == 0, res_bak.stderr
        res_bak_rerun = _run_role_script(
            "upgrade-backup-role.sh",
            cluster,
            {"GM_BACKUP_PASSWORD_FILE": str(_write_secret(tmp_path, "bak_pw2", "OtherBak#2026"))},
        )
        assert res_bak_rerun.returncode != 0

        # 2. 升级 0003 -> head（0004 回填历史审计链），随后执行 upgrade-audit-role.sh
        _alembic_upgrade(migrator_dsn, "head")
        aud_env = {
            "GM_AUDIT_PASSWORD_FILE": str(_write_secret(tmp_path, "aud_pw", audit_pw)),
        }
        res_aud = _run_role_script("upgrade-audit-role.sh", cluster, aud_env)
        assert res_aud.returncode == 0, res_aud.stderr
        res_aud_rerun = _run_role_script(
            "upgrade-audit-role.sh",
            cluster,
            {"GM_AUDIT_PASSWORD_FILE": str(_write_secret(tmp_path, "aud_pw2", "OtherAud#2026"))},
        )
        assert res_aud_rerun.returncode != 0

        # 3. 验证升级后的完整四角色边界与历史审计链完整性
        _assert_four_role_boundaries(cluster, app_pw=app_pw, audit_pw=audit_pw, backup_pw=backup_pw)
        with _tcp_connect(cluster, "gm_backup", backup_pw) as conn:
            rows = conn.execute(
                "SELECT seq, prev_hash, event_hash, id, created_at, event_type, "
                "account_id, session_id, ip_address, user_agent, metadata "
                "FROM public.audit_events ORDER BY seq ASC"
            ).fetchall()
            status = verify_audit_records(rows)
            assert status.valid is True
            assert status.total_events >= 3


def _prepare_age_toolchain(work_dir: Path) -> tuple[dict[str, str], Path, Path, Path]:
    """优先使用真实 age/age-keygen；缺失时用 AES-256-GCM 构建严格认证加密兼容包装。"""
    real_age = shutil.which("age")
    real_keygen = shutil.which("age-keygen")
    recipients = work_dir / "recipients.txt"
    identity = work_dir / "identity.txt"
    wrong_identity = work_dir / "wrong_identity.txt"

    if real_age and real_keygen:
        out1 = subprocess.run([real_keygen], capture_output=True, text=True, check=True).stdout
        identity.write_text(out1, encoding="utf-8")
        identity.chmod(0o600)
        pub = next(
            line.split("public key: ", 1)[1].strip()
            for line in out1.splitlines()
            if "public key:" in line
        )
        recipients.write_text(pub + "\n", encoding="utf-8")

        out2 = subprocess.run([real_keygen], capture_output=True, text=True, check=True).stdout
        wrong_identity.write_text(out2, encoding="utf-8")
        wrong_identity.chmod(0o600)
        return {}, recipients, identity, wrong_identity

    # 无系统 age 时，用当前 Python + cryptography AES-256-GCM 构建认证加密 age 兼容包装
    bin_dir = work_dir / "age_bin"
    bin_dir.mkdir(mode=0o700)
    key1 = os.urandom(32).hex()
    key2 = os.urandom(32).hex()
    recipients.write_text(f"age1synthetic{key1}\n", encoding="utf-8")
    identity.write_text(f"AGE-SECRET-KEY-SYNTHETIC-{key1}\n", encoding="utf-8")
    identity.chmod(0o600)
    wrong_identity.write_text(f"AGE-SECRET-KEY-SYNTHETIC-{key2}\n", encoding="utf-8")
    wrong_identity.chmod(0o600)

    age_shim = bin_dir / "age"
    age_shim.write_text(
        f"""#!{sys.executable}
import os, sys
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"age-encryption.org/v1\\n"
args = sys.argv[1:]
if args == ["--version"]:
    print("v1.2.1")
    raise SystemExit(0)
if "--encrypt" in args and "--recipients-file" in args:
    rec = Path(args[args.index("--recipients-file") + 1]).read_text().strip()
    key = bytes.fromhex(rec.removeprefix("age1synthetic"))
    nonce = os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, sys.stdin.buffer.read(), MAGIC)
    sys.stdout.buffer.write(MAGIC + nonce + ct)
    raise SystemExit(0)
if "--decrypt" in args and "--identity" in args:
    ident = Path(args[args.index("--identity") + 1]).read_text().strip()
    key = bytes.fromhex(ident.removeprefix("AGE-SECRET-KEY-SYNTHETIC-"))
    raw = Path(args[-1]).read_bytes()
    if not raw.startswith(MAGIC) or len(raw) < len(MAGIC) + 12 + 16:
        raise SystemExit(1)
    nonce = raw[len(MAGIC):len(MAGIC) + 12]
    ct = raw[len(MAGIC) + 12:]
    try:
        pt = AESGCM(key).decrypt(nonce, ct, MAGIC)
    except Exception:
        raise SystemExit(1)
    sys.stdout.buffer.write(pt)
    raise SystemExit(0)
raise SystemExit(2)
""",
        encoding="utf-8",
    )
    age_shim.chmod(0o700)
    return {"PATH": f"{bin_dir}:{os.environ.get('PATH', '')}"}, recipients, identity, wrong_identity


def test_backup_restore_verify_and_switch_full_lifecycle(tmp_path, monkeypatch, capsys):
    """TC-P1-007：pg_dump -> 加密备份 -> 异地收发 -> 负面拒收 -> 恢复验签 -> Step-Up 切换回退。"""
    backup_tool = _load_script_module(
        "gm_backup_tool_wave2", REPO_ROOT / "scripts" / "backup_tool.py"
    )
    receiver = _load_script_module(
        "gm_receiver_wave2", REPO_ROOT / "infra" / "backup" / "receiver.py"
    )

    app_pw = f"App-{secrets.token_urlsafe(12)}"
    migrator_pw = f"Mig-{secrets.token_urlsafe(12)}"
    backup_pw = f"Bak-{secrets.token_urlsafe(12)}"
    audit_pw = f"Aud-{secrets.token_urlsafe(12)}"
    admin_password = f"SwitchAdminPass-{secrets.token_urlsafe(10)}!9"
    totp_secret = pyotp.random_base32()

    # 双版本加密密钥（v1 + v2 共存）
    keys_dir = tmp_path / "keys"
    keys_dir.mkdir(mode=0o700)
    for ver in (1, 2):
        kf = keys_dir / f"data_key_v{ver}"
        kf.write_bytes(os.urandom(32))
        kf.chmod(0o600)

    path_env, recipients, identity, wrong_identity = _prepare_age_toolchain(tmp_path)
    for k, v in path_env.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setenv("DATA_KEY_DIRECTORY", str(keys_dir))
    monkeypatch.setenv("ACTIVE_DATA_KEY_VERSION", "2")

    src_db = "gm_test_recovery_src"
    target_db = "gm_restore_wave2_target"
    backup_pw_file = _write_secret(tmp_path, "db_backup_password", backup_pw)

    secret_env = {
        "GM_APP_PASSWORD_FILE": str(_write_secret(tmp_path, "db_password", app_pw)),
        "GM_MIGRATOR_PASSWORD_FILE": str(
            _write_secret(tmp_path, "db_migrator_password", migrator_pw)
        ),
        "GM_BACKUP_PASSWORD_FILE": str(backup_pw_file),
        "GM_AUDIT_PASSWORD_FILE": str(_write_secret(tmp_path, "db_audit_password", audit_pw)),
    }

    with ephemeral_pg_cluster(src_db) as cluster:
        # 1. 初始化四角色并由 gm_migrator 迁移至 0004
        assert _run_role_script("init-roles.sh", cluster, secret_env).returncode == 0
        migrator_dsn = (
            f"postgresql+psycopg://gm_migrator:{migrator_pw}@127.0.0.1:{cluster['port']}/{src_db}"
        )
        _alembic_upgrade(migrator_dsn, "head")

        # 2. 写入 v1 + v2 双版本加密数据、TOTP、活跃会话、预会话、CSV 凭据、关联账号与 0004 审计链
        enc_v1 = EncryptionService(keys_dir, 1)
        enc_v2 = EncryptionService(keys_dir, 2)
        admin_id = uuid4()
        sess_id = uuid4()
        acc1_id = uuid4()
        acc2_id = uuid4()
        tag_id = uuid4()
        now_dt = datetime.now(UTC)

        with _tcp_connect(cluster, "gm_app", app_pw, src_db) as conn:
            totp_enc = enc_v1.encrypt(totp_secret, "admin_user", admin_id, "totp_secret")
            conn.execute(
                "INSERT INTO public.admin_users "
                "(id, password_hash, totp_secret_ciphertext, totp_secret_nonce, "
                "totp_secret_key_version, totp_enabled, password_changed_at) "
                "VALUES (%s, %s, %s, %s, %s, true, %s)",
                (
                    admin_id,
                    passwords.hash(admin_password),
                    totp_enc.ciphertext,
                    totp_enc.nonce,
                    totp_enc.key_version,
                    now_dt,
                ),
            )
            pt_enc = enc_v2.encrypt(pyotp.random_base32(), "user_session", sess_id, "pending_totp")
            conn.execute(
                "INSERT INTO public.user_sessions "
                "(id, admin_user_id, token_hash, csrf_token_hash, auth_level, last_seen_at, "
                "expires_at, pending_totp_ciphertext, pending_totp_nonce, "
                "pending_totp_key_version, pending_totp_expires_at) "
                "VALUES (%s, %s, %s, %s, 'authenticated', %s, %s, %s, %s, %s, %s)",
                (
                    sess_id,
                    admin_id,
                    secrets.token_bytes(32),
                    secrets.token_bytes(32),
                    now_dt,
                    now_dt + timedelta(hours=8),
                    pt_enc.ciphertext,
                    pt_enc.nonce,
                    pt_enc.key_version,
                    now_dt + timedelta(minutes=10),
                ),
            )
            conn.execute(
                "INSERT INTO public.pre_auth_sessions "
                "(id, token_hash, csrf_token_hash, expires_at) "
                "VALUES (%s, %s, %s, %s)",
                (
                    uuid4(),
                    secrets.token_bytes(32),
                    secrets.token_bytes(32),
                    now_dt + timedelta(minutes=10),
                ),
            )
            conn.execute(
                "INSERT INTO public.csv_receipts "
                "(id, session_id, file_digest, options, snapshot, expires_at) "
                "VALUES (%s, %s, %s, '{}'::jsonb, '[]'::jsonb, %s)",
                (uuid4(), sess_id, secrets.token_bytes(32), now_dt + timedelta(minutes=10)),
            )
            conn.execute(
                "INSERT INTO public.tags (id, name) VALUES (%s, '核心恢复测试')", (tag_id,)
            )

            # 账号 1 使用 v1 密钥，账号 2 使用 v2 密钥并关联账号 1
            for idx, (aid, enc, email, rec_id, rec_ext) in enumerate(
                [
                    (acc1_id, enc_v1, "restore.v1@gmail.com", None, "v1.bak@example.test"),
                    (acc2_id, enc_v2, "restore.v2@gmail.com", acc1_id, None),
                ],
                start=1,
            ):
                p_enc = enc.encrypt(f"SynthAccPass-v{idx}!2026", "gmail_account", aid, "password")
                ph_enc = enc.encrypt(f"+86 1380000000{idx}", "gmail_account", aid, "phone")
                nt_enc = enc.encrypt(f"多版本密钥加密备注 v{idx}", "gmail_account", aid, "notes")
                conn.execute(
                    "INSERT INTO public.gmail_accounts "
                    "(id, gmail_email, gmail_email_normalized, registered_at, "
                    "password_ciphertext, password_nonce, password_key_version, "
                    "phone_ciphertext, phone_nonce, phone_key_version, "
                    "notes_ciphertext, notes_nonce, notes_key_version, "
                    "recovery_account_id, recovery_email_external, status, two_factor_status) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
                    "%s, %s, %s, %s, %s, 'normal', 'enabled')",
                    (
                        aid,
                        email,
                        email.replace(".", "", 1),
                        now_dt,
                        p_enc.ciphertext,
                        p_enc.nonce,
                        p_enc.key_version,
                        ph_enc.ciphertext,
                        ph_enc.nonce,
                        ph_enc.key_version,
                        nt_enc.ciphertext,
                        nt_enc.nonce,
                        nt_enc.key_version,
                        rec_id,
                        rec_ext,
                    ),
                )
            conn.execute(
                "INSERT INTO public.gmail_account_tags (account_id, tag_id) VALUES (%s, %s)",
                (acc2_id, tag_id),
            )
            for ev_type in ("login_success", "account_created", "account_created"):
                conn.execute(
                    "INSERT INTO public.audit_events (id, event_type, session_id, metadata) "
                    "VALUES (%s, %s, %s, '{}'::jsonb)",
                    (uuid4(), ev_type, sess_id),
                )
            conn.commit()

        # 3. 使用 gm_backup 角色执行真实加密备份（pg_dump custom gzip + age + config + manifest）
        with psycopg.connect(
            host=str(cluster["sock_dir"]), port=cluster["port"], user="postgres", dbname=src_db
        ) as probe:
            allow_pg17 = (probe.info.server_version // 10000) == 17

        backup_root = tmp_path / "backups"
        monkeypatch.setenv("PGHOST", "127.0.0.1")
        monkeypatch.setenv("PGPORT", str(cluster["port"]))
        monkeypatch.setenv("PGUSER", "gm_backup")
        monkeypatch.setenv("BACKUP_DB_PASSWORD_FILE", str(backup_pw_file))
        monkeypatch.delenv("OFFSITE_HOST", raising=False)

        backup_tool.backup(
            Namespace(
                database=src_db,
                directory=str(backup_root),
                recipients=str(recipients),
                config=[],
                allow_pg17_test=allow_pg17,
            )
        )
        backup_out = json.loads(capsys.readouterr().out)
        assert backup_out["result"] == "success"
        backup_dir = Path(backup_out["backup"])
        assert (backup_root / "status.json").is_file()
        assert json.loads((backup_root / "status.json").read_text())["state"] == "success"

        # 4. 异地受限接收器 USTAR 流往返验证（upload -> status -> fetch -> 字节级校验）
        offsite_store = tmp_path / "offsite_store"
        offsite_store.mkdir(mode=0o700)
        (offsite_store / ".gmail-manager-backups").write_text(receiver.MAGIC, encoding="utf-8")
        bundle_buf = io.BytesIO()
        receiver.write_bundle(backup_dir, bundle_buf)
        bundle_buf.seek(0)
        upload_out = io.BytesIO()
        receiver.dispatch(f"{receiver.PROTOCOL} upload", offsite_store, bundle_buf, upload_out)
        receipt = json.loads(upload_out.getvalue().decode("utf-8"))
        assert receipt["status"] == "published"

        fetched_buf = io.BytesIO()
        receiver.dispatch(f"{receiver.PROTOCOL} fetch", offsite_store, io.BytesIO(), fetched_buf)
        fetched_buf.seek(0)
        fetched_dir = tmp_path / "fetched_backup"
        fetched_dir.mkdir(mode=0o700)
        receiver.read_bundle(fetched_dir, fetched_buf)
        assert (fetched_dir / "manifest.json").read_bytes() == (
            backup_dir / "manifest.json"
        ).read_bytes()

        # 5. 负面恢复演练：篡改密文、错误解密私钥、缺失 v1 历史密钥必须全部失败
        monkeypatch.setenv("PGHOST", str(cluster["sock_dir"]))
        monkeypatch.setenv("PGUSER", "postgres")
        monkeypatch.delenv("BACKUP_DB_PASSWORD_FILE", raising=False)

        tampered_dir = tmp_path / "tampered_backup"
        shutil.copytree(backup_dir, tampered_dir)
        db_age = tampered_dir / receiver.DB_FILE
        raw_bytes = bytearray(db_age.read_bytes())
        raw_bytes[-1] ^= 0xFF
        db_age.write_bytes(bytes(raw_bytes))
        with pytest.raises(backup_tool.OperationError, match="完整性校验失败"):
            backup_tool.restore(
                Namespace(
                    backup=str(tampered_dir),
                    identity=str(identity),
                    record_verification=False,
                    source_database=src_db,
                    target_database="gm_restore_tampered",
                    isolated=True,
                    writers_stopped=True,
                    allow_pg17_test=allow_pg17,
                )
            )

        with pytest.raises(backup_tool.OperationError, match="解密|恢复失败"):
            backup_tool.restore(
                Namespace(
                    backup=str(backup_dir),
                    identity=str(wrong_identity),
                    record_verification=False,
                    source_database=src_db,
                    target_database="gm_restore_wrong_key",
                    isolated=True,
                    writers_stopped=True,
                    allow_pg17_test=allow_pg17,
                )
            )

        # 缺失 data_key_v1（仅保留 v2）时，多版本密钥抽样解密必须失败
        partial_keys = tmp_path / "partial_keys"
        partial_keys.mkdir(mode=0o700)
        shutil.copy2(keys_dir / "data_key_v2", partial_keys / "data_key_v2")
        monkeypatch.setenv("DATA_KEY_DIRECTORY", str(partial_keys))
        with pytest.raises(
            (backup_tool.OperationError, DecryptionError, ValueError, KeyError, FileNotFoundError)
        ):
            backup_tool.restore(
                Namespace(
                    backup=str(backup_dir),
                    identity=str(identity),
                    record_verification=False,
                    source_database=src_db,
                    target_database="gm_restore_missing_v1",
                    isolated=True,
                    writers_stopped=True,
                    allow_pg17_test=allow_pg17,
                )
            )
        monkeypatch.setenv("DATA_KEY_DIRECTORY", str(keys_dir))

        # 6. 正常恢复到全新目标库 gm_restore_wave2_target（行数/约束/0004审计链/v1+v2 抽样解密）
        backup_tool.restore(
            Namespace(
                backup=str(backup_dir),
                identity=str(identity),
                record_verification=True,
                source_database=src_db,
                target_database=target_db,
                isolated=True,
                writers_stopped=True,
                allow_pg17_test=allow_pg17,
            )
        )
        restore_out = json.loads(capsys.readouterr().out)
        assert restore_out["result"] == "verified"
        assert restore_out["target_database"] == target_db
        assert restore_out["decrypted_samples"] >= 8
        assert restore_out["switched"] is False
        assert (backup_root / ".last-verified.json").is_file()

        # 7. 受控配置切换 switch：先验证错误密码被拒（不改 .env），再完成 SWITCH + 密码 + TOTP 切换
        env_file = tmp_path / ".env"
        original_env_text = f"APP_ENV=production\nDATABASE_NAME={src_db}\n"
        env_file.write_text(original_env_text, encoding="utf-8")

        switch_args = Namespace(
            backup=str(backup_dir),
            source_database=src_db,
            target_database=target_db,
            env_file=str(env_file),
            migrator_role="gm_migrator",
            app_role="gm_app",
            backup_role="gm_backup",
            audit_role="gm_audit_writer",
            writers_stopped=True,
        )
        monkeypatch.setattr(sys.stdin, "isatty", lambda: True)

        # 错误密码 -> 切换被拒且 .env 纹丝不动
        bad_inputs = iter(["SWITCH"])
        monkeypatch.setattr("builtins.input", lambda _p="": next(bad_inputs))
        monkeypatch.setitem(
            backup_tool.verify_admin_step_up.__kwdefaults__,
            "read_password",
            lambda _p="": "WrongSwitchPassword!",
        )
        with pytest.raises(backup_tool.OperationError, match="二次验证失败"):
            backup_tool.switch(switch_args)
        assert env_file.read_text(encoding="utf-8") == original_env_text

        # 正确 SWITCH + 管理员密码 + 实时 TOTP -> 完成切换
        live_code = pyotp.TOTP(totp_secret).now()
        monkeypatch.setattr("builtins.input", lambda _p="": "SWITCH")
        monkeypatch.setitem(
            backup_tool.verify_admin_step_up.__kwdefaults__,
            "read_password",
            lambda _p="": admin_password,
        )
        monkeypatch.setitem(
            backup_tool.verify_admin_step_up.__kwdefaults__,
            "read_code",
            lambda _p="": live_code,
        )
        backup_tool.switch(switch_args)
        assert "配置已切换" in capsys.readouterr().out

        # 验证 .env 原子切换与回退备份文件
        assert f"DATABASE_NAME={target_db}" in env_file.read_text(encoding="utf-8")
        rollback_files = list(tmp_path.glob(".env.before-switch-*"))
        assert len(rollback_files) == 1
        assert rollback_files[0].read_text(encoding="utf-8") == original_env_text

        # 验证切换后目标库：所有历史会话已撤销、预会话/CSV 凭据已清空、审计链完好且新增 restore 记录
        with _tcp_connect(cluster, "gm_backup", backup_pw, target_db) as conn:
            unrevoked = conn.execute(
                "SELECT count(*) FROM public.user_sessions WHERE revoked_at IS NULL"
            ).fetchone()[0]
            assert unrevoked == 0
            assert conn.execute("SELECT count(*) FROM public.pre_auth_sessions").fetchone()[0] == 0
            assert conn.execute("SELECT count(*) FROM public.csv_receipts").fetchone()[0] == 0
            audit_rows = conn.execute(
                "SELECT seq, prev_hash, event_hash, id, created_at, event_type, "
                "account_id, session_id, ip_address, user_agent, metadata "
                "FROM public.audit_events ORDER BY seq ASC"
            ).fetchall()
            chain = verify_audit_records(audit_rows)
            assert chain.valid is True
            assert any(
                r[5] == "settings_changed" and (r[10] or {}).get("operation") == "restore"
                for r in audit_rows
            )

        # 验证切换后目标库四角色最小权限恢复（gm_app 禁改 audit_events、audit_writer 仅 INSERT）
        _assert_four_role_boundaries(
            cluster, app_pw=app_pw, audit_pw=audit_pw, backup_pw=backup_pw, dbname=target_db
        )

        # 验证旧源库完好保留、回退操作可安全切回
        with _tcp_connect(cluster, "gm_backup", backup_pw, src_db) as conn:
            assert conn.execute("SELECT count(*) FROM public.gmail_accounts").fetchone()[0] == 2
        os.replace(rollback_files[0], env_file)
        assert f"DATABASE_NAME={src_db}" in env_file.read_text(encoding="utf-8")
