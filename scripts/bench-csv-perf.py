"""Wave 4 (TC-P2-001 / TC-P2-002): 10,000 行 CSV 导入与 20,000 行流式导出性能及内存基线脚本。

默认在临时 PostgreSQL 实例的隔离 gm_test_<uuid> schema 中运行（也可通过 --database-url 或
TEST_DATABASE_URL 指定独立 PG18 测试库），绝不触碰生产库。
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import resource
import shutil
import subprocess
import sys
import tempfile
import tracemalloc
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from types import SimpleNamespace
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from alembic.config import Config  # noqa: E402
from fastapi import Response  # noqa: E402
from sqlalchemy import create_engine, func, select, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from alembic import command  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.core.encryption import EncryptionService  # noqa: E402
from app.core.security import passwords, random_token, token_hash  # noqa: E402
from app.models import AdminUser, GmailAccount, Tag, UserSession, gmail_account_tags  # noqa: E402
from app.schemas.accounts import AccountQuery  # noqa: E402
from app.schemas.operations import CsvOptions  # noqa: E402
from app.services.auth import AuthService  # noqa: E402
from app.services.csv_transfer import CsvService, stream_export_csv  # noqa: E402


def _rss_mib() -> float:
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # macOS ru_maxrss 单位为字节；Linux 单位为 KiB。
    if sys.platform == "darwin":
        return usage / (1024 * 1024)
    return usage / 1024


def generate_synthetic_csv(row_count: int) -> bytes:
    """生成受控大小的合成 UTF-8 CSV（含标签与中文备注，确保 10,000 行仍在 10 MiB 内）。"""
    buf = io.StringIO(newline="")
    writer = csv.writer(buf)
    writer.writerow(
        [
            "gmail_email",
            "password",
            "recovery_email",
            "status",
            "two_factor_status",
            "purpose",
            "tags",
            "notes",
        ]
    )
    statuses = ("normal", "pending_verification", "restricted", "normal")
    tfa = ("enabled", "disabled", "unknown")
    for idx in range(row_count):
        writer.writerow(
            [
                f"bench.import.{idx:05d}@gmail.com",
                f"SynthBenchPwd-{idx:05d}!",
                f"rec.bench.{idx % 200:03d}@example.test",
                statuses[idx % len(statuses)],
                tfa[idx % len(tfa)],
                f"基准用途-{idx % 25:02d}",
                f"bench-tag-{idx % 12:02d}|bench-group-{idx % 4}",
                f"合成性能基线中文备注 #{idx:05d}（自动化压测样本）",
            ]
        )
    return buf.getvalue().encode("utf-8")


@contextmanager
def _ephemeral_postgres(port: int = 55439):
    pg_dir = Path(tempfile.mkdtemp(prefix="gm_bench_pg_", dir="/tmp"))
    try:
        subprocess.run(
            [
                "initdb",
                "-D",
                str(pg_dir),
                "--auth=trust",
                "--username=gm_tester",
                "--encoding=UTF8",
                "--no-locale",
            ],
            check=True,
            capture_output=True,
        )
        subprocess.run(
            [
                "pg_ctl",
                "-D",
                str(pg_dir),
                "-l",
                str(pg_dir / "pg.log"),
                "-o",
                f"-p {port} -k {pg_dir} -c listen_addresses=127.0.0.1",
                "start",
            ],
            check=True,
            capture_output=True,
        )
        subprocess.run(
            [
                "createdb",
                "-h",
                "127.0.0.1",
                "-p",
                str(port),
                "-U",
                "gm_tester",
                "gm_test_bench",
            ],
            check=True,
            capture_output=True,
        )
        yield f"postgresql+psycopg://gm_tester@127.0.0.1:{port}/gm_test_bench"
    finally:
        subprocess.run(
            ["pg_ctl", "-D", str(pg_dir), "-m", "immediate", "stop"],
            check=False,
            capture_output=True,
        )
        shutil.rmtree(pg_dir, ignore_errors=True)


def _make_schema_engine(base_url: str):
    parsed = make_url(base_url)
    if not (parsed.database or "").startswith("gm_test"):
        raise ValueError("基准测试仅允许连接以 gm_test 开头的隔离测试数据库")
    schema = f"gm_bench_{uuid4().hex}"
    admin_engine = create_engine(base_url)
    with admin_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    admin_engine.dispose()

    query = dict(parsed.query)
    query["options"] = f"-csearch_path={schema}"
    schema_url = parsed.set(query=query).render_as_string(hide_password=False)
    engine = create_engine(schema_url, pool_size=5, max_overflow=0, pool_pre_ping=True)

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
    return engine, schema


def _drop_schema(base_url: str, schema: str) -> None:
    admin_engine = create_engine(base_url)
    with admin_engine.begin() as conn:
        conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
    admin_engine.dispose()


def _seed_auth_context(engine, key_dir: Path):
    now = datetime.now(UTC)
    key_file = key_dir / "data_key_v1"
    key_file.write_bytes(os.urandom(32))
    os.chmod(key_file, 0o600)
    encryption = EncryptionService(key_dir, 1)
    settings = Settings(
        _env_file=None,
        app_env="test",
        data_key_directory=key_dir,
        active_data_key_version=1,
    )
    session_token = random_token()
    csrf_token = random_token()
    with Session(engine) as db, db.begin():
        admin_id = uuid4()
        totp_enc = encryption.encrypt(
            "ORSXG5BNMZ2GQZLSOJUXG5A", "admin_user", admin_id, "totp_secret"
        )
        admin = AdminUser(
            id=admin_id,
            password_hash=passwords.hash("Bench-Admin-Passphrase-2026!"),
            password_changed_at=now,
            totp_enabled=True,
            totp_secret_ciphertext=totp_enc.ciphertext,
            totp_secret_nonce=totp_enc.nonce,
            totp_secret_key_version=totp_enc.key_version,
        )
        db.add(admin)
        db.flush()
        sess = UserSession(
            id=uuid4(),
            admin_user_id=admin.id,
            token_hash=token_hash(session_token),
            csrf_token_hash=token_hash(csrf_token),
            auth_level="authenticated",
            created_at=now,
            last_seen_at=now,
            reauthenticated_at=now,
            mfa_reauthenticated_at=now,
            expires_at=now.replace(year=now.year + 1),
            ip_address="192.0.2.10",
            user_agent="bench",
        )
        db.add(sess)
        cookie_value = f"{sess.id}.{session_token}"
    return settings, encryption, cookie_value, csrf_token


def _fake_request(settings: Settings, encryption: EncryptionService, session_token: str, csrf: str):
    cookie_name = "__Host-gm_session" if settings.session_cookie_secure else "gm_dev_session"
    state = SimpleNamespace(settings=settings, encryption=encryption)
    return SimpleNamespace(
        method="POST",
        app=SimpleNamespace(state=state),
        cookies={cookie_name: session_token},
        headers={
            "x-csrf-token": csrf,
            "origin": settings.app_base_url,
            "sec-fetch-site": "same-origin",
            "user-agent": "bench",
        },
        client=SimpleNamespace(host="192.0.2.10"),
        url=SimpleNamespace(hostname="testserver", path="/api/v1/imports/csv"),
        query_params={},
    )


def _seed_extra_export_rows(engine, encryption: EncryptionService, existing: int, target: int):
    """快速批量补齐到目标行数（每条 3 标签），用于 20,000 行流式导出内存恒定性测试。"""
    needed = target - existing
    if needed <= 0:
        return
    now = datetime.now(UTC)
    with Session(engine) as db, db.begin():
        tag_rows = db.scalars(select(Tag).order_by(Tag.name)).all()
        if len(tag_rows) < 6:
            for idx in range(6):
                name = f"export-tag-{idx}"
                if not any(t.name == name for t in tag_rows):
                    t = Tag(name=name)
                    db.add(t)
                    tag_rows.append(t)
            db.flush()
        tag_ids = [t.id for t in tag_rows[:6]]

        batch_size = 2000
        for offset in range(0, needed, batch_size):
            chunk_n = min(batch_size, needed - offset)
            acct_dicts = []
            link_dicts = []
            for i in range(chunk_n):
                seq = existing + offset + i
                acct_id = uuid4()
                enc = encryption.encrypt(f"ExpPwd-{seq:05d}!", "gmail_account", acct_id, "password")
                email = f"bench.export.{seq:05d}@gmail.com"
                acct_dicts.append(
                    {
                        "id": acct_id,
                        "gmail_email": email,
                        "gmail_email_normalized": email,
                        "password_ciphertext": enc.ciphertext,
                        "password_nonce": enc.nonce,
                        "password_key_version": enc.key_version,
                        "registered_at": now,
                        "recovery_email_external": f"rec.exp.{seq % 300:03d}@example.test",
                        "status": "normal",
                        "two_factor_status": "enabled",
                        "purpose": f"导出压测用途-{seq % 20:02d}",
                        "created_at": now,
                        "updated_at": now,
                    }
                )
                for k in range(3):
                    link_dicts.append(
                        {"account_id": acct_id, "tag_id": tag_ids[(seq + k) % len(tag_ids)]}
                    )
            db.execute(GmailAccount.__table__.insert(), acct_dicts)
            db.execute(gmail_account_tags.insert(), link_dicts)


def run_benchmark(
    base_url: str,
    *,
    import_rows: int = 10000,
    export_rows: int = 20000,
    batch_size: int = 500,
) -> dict[str, float | int]:
    engine, schema = _make_schema_engine(base_url)
    try:
        with tempfile.TemporaryDirectory(prefix="gm_bench_keys_") as key_tmp:
            settings, encryption, sess_tok, csrf_tok = _seed_auth_context(engine, Path(key_tmp))
            csv_bytes = generate_synthetic_csv(import_rows)
            csv_mib = len(csv_bytes) / (1024 * 1024)

            # --- 1. TC-P2-001: 10,000 行 CSV 预览与事务提交 ---
            tracemalloc.start()
            t0 = perf_counter()
            with Session(engine) as db, db.begin():
                req = _fake_request(settings, encryption, sess_tok, csrf_tok)
                svc = CsvService(AuthService(db, settings, encryption, req, Response()))
                preview = svc.preview(csv_bytes, CsvOptions(strategy="skip"))
            preview_seconds = perf_counter() - t0
            _, preview_peak = tracemalloc.get_traced_memory()
            tracemalloc.stop()

            if preview.errors or preview.receipt_id is None:
                raise RuntimeError(f"CSV preview 失败: {preview.errors[:5]}")

            tracemalloc.start()
            t1 = perf_counter()
            with Session(engine) as db, db.begin():
                req = _fake_request(settings, encryption, sess_tok, csrf_tok)
                svc = CsvService(AuthService(db, settings, encryption, req, Response()))
                commit = svc.commit(csv_bytes, preview.receipt_id)
            commit_seconds = perf_counter() - t1
            _, commit_peak = tracemalloc.get_traced_memory()
            tracemalloc.stop()

            if commit.status != "committed" or commit.created != import_rows:
                raise RuntimeError(f"CSV commit 未达到预期行数: {commit}")

            with Session(engine) as db:
                db_count_after_import = int(db.scalar(select(func.count(GmailAccount.id))) or 0)
            if db_count_after_import != import_rows:
                raise RuntimeError(f"入库行数不一致: {db_count_after_import} != {import_rows}")

            # --- 2. TC-P2-002: 20,000 行流式 CSV 导出 ---
            _seed_extra_export_rows(engine, encryption, import_rows, export_rows)
            with Session(engine) as db:
                total_before_export = int(db.scalar(select(func.count(GmailAccount.id))) or 0)
            if total_before_export != export_rows:
                raise RuntimeError(f"导出前行数异常: {total_before_export} != {export_rows}")

            tracemalloc.start()
            base_cur, _ = tracemalloc.get_traced_memory()
            t2 = perf_counter()
            ttfb_seconds: float | None = None
            chunk_count = 0
            exported_lines = 0
            exported_bytes = 0
            for chunk in stream_export_csv(engine, AccountQuery(), batch_size=batch_size):
                if ttfb_seconds is None:
                    ttfb_seconds = perf_counter() - t2
                chunk_count += 1
                exported_bytes += len(chunk)
                exported_lines += chunk.count(b"\n")
            export_seconds = perf_counter() - t2
            _, export_peak = tracemalloc.get_traced_memory()
            tracemalloc.stop()

            export_data_rows = exported_lines - 1
            if export_data_rows != export_rows:
                raise RuntimeError(f"导出数据行数不匹配: {export_data_rows} != {export_rows}")

            return {
                "import_rows": import_rows,
                "csv_mib": round(csv_mib, 3),
                "preview_seconds": round(preview_seconds, 3),
                "commit_seconds": round(commit_seconds, 3),
                "import_total_seconds": round(preview_seconds + commit_seconds, 3),
                "preview_peak_mib": round(preview_peak / (1024 * 1024), 2),
                "commit_peak_mib": round(commit_peak / (1024 * 1024), 2),
                "export_rows": export_data_rows,
                "export_chunks": chunk_count,
                "export_mib": round(exported_bytes / (1024 * 1024), 3),
                "export_ttfb_seconds": round(ttfb_seconds or 0.0, 4),
                "export_total_seconds": round(export_seconds, 3),
                "export_peak_delta_mib": round(max(0, export_peak - base_cur) / (1024 * 1024), 2),
                "process_max_rss_mib": round(_rss_mib(), 2),
            }
    finally:
        engine.dispose()
        _drop_schema(base_url, schema)


def evaluate_budget(
    metrics: dict[str, float | int],
    *,
    max_import_seconds: float,
    max_rss_mib: float,
    max_ttfb_seconds: float,
    max_export_mem_delta_mib: float,
) -> list[str]:
    failures: list[str] = []
    if float(metrics["csv_mib"]) >= 10.0:
        failures.append(f"合成 CSV 体积 {metrics['csv_mib']} MiB 超过 10 MiB 上限")
    if float(metrics["import_total_seconds"]) > max_import_seconds:
        failures.append(
            f"导入总耗时 {metrics['import_total_seconds']}s 超过阈值 {max_import_seconds}s"
        )
    if float(metrics["process_max_rss_mib"]) > max_rss_mib:
        failures.append(
            f"进程峰值 RSS {metrics['process_max_rss_mib']} MiB 超过容器限额 {max_rss_mib} MiB"
        )
    if float(metrics["export_ttfb_seconds"]) > max_ttfb_seconds:
        failures.append(
            f"流式导出 TTFB {metrics['export_ttfb_seconds']}s 超过阈值 {max_ttfb_seconds}s"
        )
    if float(metrics["export_peak_delta_mib"]) > max_export_mem_delta_mib:
        failures.append(
            f"流式导出峰值内存增量 {metrics['export_peak_delta_mib']} MiB "
            f"超过恒定内存阈值 {max_export_mem_delta_mib} MiB"
        )
    return failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="10k CSV 导入 / 20k 流式导出性能与内存基准脚本")
    parser.add_argument("--database-url", default=os.environ.get("TEST_DATABASE_URL", ""))
    parser.add_argument("--import-rows", type=int, default=10000)
    parser.add_argument("--export-rows", type=int, default=20000)
    parser.add_argument("--max-import-seconds", type=float, default=30.0)
    parser.add_argument("--max-rss-mib", type=float, default=384.0)
    parser.add_argument("--max-ttfb-seconds", type=float, default=2.0)
    parser.add_argument("--max-export-mem-delta-mib", type=float, default=32.0)
    parser.add_argument("--json-out", type=Path, default=None)
    args = parser.parse_args(argv)

    if args.database_url:
        metrics = run_benchmark(
            args.database_url, import_rows=args.import_rows, export_rows=args.export_rows
        )
    else:
        with _ephemeral_postgres() as url:
            metrics = run_benchmark(url, import_rows=args.import_rows, export_rows=args.export_rows)

    print("=== CSV Performance & Memory Baseline (TC-P2-001 / TC-P2-002) ===")
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    if args.json_out is not None:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(
            json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    failures = evaluate_budget(
        metrics,
        max_import_seconds=args.max_import_seconds,
        max_rss_mib=args.max_rss_mib,
        max_ttfb_seconds=args.max_ttfb_seconds,
        max_export_mem_delta_mib=args.max_export_mem_delta_mib,
    )
    if failures:
        for msg in failures:
            print(f"FAIL: {msg}", file=sys.stderr)
        return 1
    print("PASS: 所有导入/导出性能与内存基线阈值达标")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
