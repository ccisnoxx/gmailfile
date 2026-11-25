#!/usr/bin/env python3
"""Wave 2 真实前后端全栈 Playwright E2E 启动编排器（TC-P0-011 ~ TC-P0-013）。

自动拉起隔离 PostgreSQL（若外部传入 TEST_DATABASE_URL 则复用并隔离建库）、执行 Alembic 迁移、
初始化合成管理员、启动真实 FastAPI 与生产构建版 Vite Preview，运行 Playwright 实栈用例并清理。
严禁在标准输出或日志中回显任何合成密钥或密码。
"""

from __future__ import annotations

import os
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"

sys.path.insert(0, str(BACKEND))


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_http_ok(url: str, timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    last_err: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2.0) as resp:
                if resp.status == 200:
                    return
        except (urllib.error.URLError, OSError) as exc:
            last_err = exc
        time.sleep(0.25)
    raise RuntimeError(f"等待服务就绪超时：{url} ({last_err})")


def _with_dbname(database_url: str, dbname: str) -> str:
    parsed = urlsplit(database_url)
    return urlunsplit((parsed.scheme, parsed.netloc, f"/{dbname}", parsed.query, parsed.fragment))


def _psycopg_dsn(database_url: str) -> str:
    return database_url.replace("postgresql+psycopg://", "postgresql://", 1)


def _init_ephemeral_pg(pg_dir: Path, port: int) -> tuple[str, int, str, str, str]:
    initdb = shutil.which("initdb")
    pg_ctl = shutil.which("pg_ctl")
    createdb = shutil.which("createdb")
    if not (initdb and pg_ctl and createdb):
        raise RuntimeError(
            "未配置 TEST_DATABASE_URL 且本机缺少 initdb/pg_ctl/createdb，无法启动隔离 PostgreSQL"
        )
    db_password = f"E2eDb-{secrets.token_urlsafe(12)}"
    pw_file = pg_dir.parent / "init_pg_pw"
    pw_file.write_text(db_password + "\n", encoding="utf-8")
    pw_file.chmod(0o600)
    subprocess.run(
        [
            initdb,
            "-D",
            str(pg_dir),
            "--auth-local=trust",
            "--auth-host=scram-sha-256",
            "--username=gm_e2e",
            f"--pwfile={pw_file}",
            "--encoding=UTF8",
            "--no-locale",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    pw_file.unlink(missing_ok=True)
    subprocess.run(
        [
            pg_ctl,
            "-D",
            str(pg_dir),
            "-l",
            str(pg_dir / "pg.log"),
            "-o",
            f"-p {port} -k {pg_dir} -c listen_addresses=127.0.0.1",
            "start",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    dbname = f"gm_test_e2e_{secrets.token_hex(4)}"
    subprocess.run(
        [createdb, "-h", str(pg_dir), "-p", str(port), "-U", "gm_e2e", dbname],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    return "127.0.0.1", port, "gm_e2e", db_password, dbname


def _stop_ephemeral_pg(pg_dir: Path) -> None:
    pg_ctl = shutil.which("pg_ctl")
    if pg_ctl and (pg_dir / "postmaster.pid").exists():
        subprocess.run(
            [pg_ctl, "-D", str(pg_dir), "-m", "immediate", "stop"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def _terminate_process(proc: subprocess.Popen | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def main() -> int:
    os.umask(0o077)
    api_port = _free_port()
    web_port = _free_port()
    base_url = f"http://127.0.0.1:{web_port}"
    admin_password = f"LiveE2E-Pass-{secrets.token_urlsafe(12)}!9"

    tmp_root = Path(tempfile.mkdtemp(prefix="gm_live_e2e_"))
    pg_dir: Path | None = None
    external_base_url = os.environ.get("TEST_DATABASE_URL", "").strip()
    created_external_db: str | None = None
    api_proc: subprocess.Popen | None = None
    web_proc: subprocess.Popen | None = None

    try:
        # 1. 准备独立 PostgreSQL 数据库（优先使用外部 TEST_DATABASE_URL，否则拉起本机临时实例）
        if external_base_url:
            parsed = urlsplit(external_base_url)
            db_name_check = parsed.path.lstrip("/")
            if not db_name_check.startswith("gm_test"):
                raise RuntimeError("TEST_DATABASE_URL 必须指向 gm_test* 隔离测试库")
            created_external_db = f"gm_test_e2e_{secrets.token_hex(4)}"
            admin_dsn = _psycopg_dsn(_with_dbname(external_base_url, "postgres"))
            with psycopg.connect(admin_dsn, autocommit=True) as conn:
                conn.execute(
                    sql.SQL("CREATE DATABASE {}").format(sql.Identifier(created_external_db))
                )
            db_host = parsed.hostname or "127.0.0.1"
            db_port = parsed.port or 5432
            db_user = parsed.username or "postgres"
            db_password = parsed.password or ""
            db_name = created_external_db
        else:
            pg_dir = tmp_root / "pgdata"
            pg_dir.mkdir(mode=0o700)
            pg_port = _free_port()
            db_host, db_port, db_user, db_password, db_name = _init_ephemeral_pg(pg_dir, pg_port)

        # 2. 合成运行期密钥（v1 + v2 双版本加密密钥 + 数据库口令文件 + 审计签名密钥）
        keys_dir = tmp_root / "keys"
        keys_dir.mkdir(mode=0o700)
        for ver in (1, 2):
            key_file = keys_dir / f"data_key_v{ver}"
            key_file.write_bytes(os.urandom(32))
            key_file.chmod(0o600)
        db_pw_file = keys_dir / "db_password"
        db_pw_file.write_text(db_password, encoding="utf-8")
        db_pw_file.chmod(0o600)
        audit_sign_key = keys_dir / "audit_signing_key"
        audit_sign_key.write_bytes(os.urandom(32))
        audit_sign_key.chmod(0o600)

        # 3. 构造后端隔离环境变量（开启强制 TOTP + Step-Up TOTP）
        backend_env = {
            **os.environ,
            "APP_ENV": "test",
            "DATABASE_HOST": db_host,
            "DATABASE_PORT": str(db_port),
            "DATABASE_NAME": db_name,
            "DATABASE_USER": db_user,
            "DATABASE_PASSWORD_FILE": str(db_pw_file),
            "APP_BASE_URL": base_url,
            "ALLOWED_HOSTS": "127.0.0.1,localhost",
            "TOTP_REQUIRED": "true",
            "STEP_UP_TOTP_REQUIRED": "true",
            "SESSION_COOKIE_SECURE": "false",
            "DATA_KEY_DIRECTORY": str(keys_dir),
            "ACTIVE_DATA_KEY_VERSION": "2",
            "AUDIT_SIGNING_KEY_FILE": str(audit_sign_key),
            "PYTHONUNBUFFERED": "1",
        }

        # 4. 执行 Alembic 迁移与合成单管理员初始化
        subprocess.run(
            ["uv", "run", "--locked", "alembic", "upgrade", "head"],
            cwd=BACKEND,
            env=backend_env,
            check=True,
        )
        init_code = (
            "import os, sys; from app.cli import create_admin; "
            "from app.core.config import Settings; "
            "from app.db.session import create_database_engine; "
            "sys.stdin.isatty = lambda: True; sys.stderr.isatty = lambda: True; "
            "eng = create_database_engine(Settings()); "
            "create_admin(eng, lambda _p: os.environ['LIVE_E2E_INIT_PASS']); "
            "eng.dispose()"
        )
        subprocess.run(
            ["uv", "run", "--locked", "python", "-c", init_code],
            cwd=BACKEND,
            env={**backend_env, "LIVE_E2E_INIT_PASS": admin_password},
            check=True,
        )

        # 5. 启动真实 FastAPI 服务
        api_proc = subprocess.Popen(
            [
                "uv",
                "run",
                "--locked",
                "uvicorn",
                "app.main:create_app",
                "--factory",
                "--host",
                "127.0.0.1",
                "--port",
                str(api_port),
                "--log-level",
                "warning",
            ],
            cwd=BACKEND,
            env=backend_env,
        )
        _wait_http_ok(f"http://127.0.0.1:{api_port}/api/v1/health/ready", timeout=30.0)

        # 6. 构建生产前端产物并以 vite preview 提供真实同源站点 + /api 代理
        node_env = {
            **os.environ,
            "VITE_API_PROXY_TARGET": f"http://127.0.0.1:{api_port}",
        }
        subprocess.run(
            ["./node_modules/.bin/vite", "build"],
            cwd=FRONTEND,
            env=node_env,
            check=True,
            stdout=subprocess.DEVNULL,
        )
        web_proc = subprocess.Popen(
            [
                "./node_modules/.bin/vite",
                "preview",
                "--host",
                "127.0.0.1",
                "--port",
                str(web_port),
                "--strictPort",
            ],
            cwd=FRONTEND,
            env=node_env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        _wait_http_ok(base_url, timeout=30.0)

        # 7. 运行 Playwright 真实全栈 E2E 用例
        pw_env = {
            **os.environ,
            "LIVE_E2E_BASE_URL": base_url,
            "LIVE_E2E_ADMIN_PASSWORD": admin_password,
        }
        pw_args = [
            "./node_modules/.bin/playwright",
            "test",
            "--config",
            "playwright.live.config.ts",
            *sys.argv[1:],
        ]
        result = subprocess.run(pw_args, cwd=FRONTEND, env=pw_env)
        return result.returncode
    finally:
        _terminate_process(web_proc)
        _terminate_process(api_proc)
        if pg_dir is not None:
            _stop_ephemeral_pg(pg_dir)
        if created_external_db and external_base_url:
            try:
                admin_dsn = _psycopg_dsn(_with_dbname(external_base_url, "postgres"))
                with psycopg.connect(admin_dsn, autocommit=True) as conn:
                    conn.execute(
                        sql.SQL(
                            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                            "WHERE datname = %s AND pid <> pg_backend_pid()"
                        ),
                        (created_external_db,),
                    )
                    conn.execute(
                        sql.SQL("DROP DATABASE IF EXISTS {}").format(
                            sql.Identifier(created_external_db)
                        )
                    )
            except Exception:
                pass
        shutil.rmtree(tmp_root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
