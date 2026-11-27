"""Wave 3 单元测试：流式导出槽位保护、发布质量门禁脚本与零依赖覆盖率门禁。"""

from __future__ import annotations

import importlib.util
import shutil
import sys
import threading
from pathlib import Path

import pytest

from app.services.csv_transfer import try_acquire_export_slot

ROOT = Path(__file__).resolve().parents[3]


def _load_script(name: str):
    path = ROOT / "scripts" / name
    mod_name = name.replace("-", "_").removesuffix(".py")
    spec = importlib.util.spec_from_file_location(mod_name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = module
    spec.loader.exec_module(module)
    return module


gates = _load_script("check-release-gates.py")
cov = _load_script("check-coverage.py")
bench = _load_script("bench-csv-perf.py")


def test_export_slot_bounded_and_idempotent_release():
    sem = threading.BoundedSemaphore(2)
    s1 = try_acquire_export_slot(sem)
    s2 = try_acquire_export_slot(sem)
    assert s1 is not None and s2 is not None
    assert try_acquire_export_slot(sem) is None

    # 重复释放同一个槽位必须幂等，不得破坏 BoundedSemaphore 上界。
    s1.release()
    s1.release()
    s3 = try_acquire_export_slot(sem)
    assert s3 is not None
    assert try_acquire_export_slot(sem) is None

    s2.release()
    s3.release()


def test_release_gate_openapi_nginx_and_deps_pass_on_repo():
    assert gates.check_openapi(ROOT).ok is True
    docs_res = gates.check_docs(ROOT)
    assert docs_res.ok is True, docs_res.errors
    nginx_res = gates.check_nginx(ROOT)
    assert nginx_res.ok is True, nginx_res.errors
    deps_res = gates.audit_deps(ROOT, run_online=False)
    assert deps_res.ok is True, deps_res.errors


def test_release_gate_check_docs_detects_stale_schema_and_delete_claim(tmp_path):
    shutil.copytree(ROOT / "backend" / "app" / "core", tmp_path / "backend" / "app" / "core")
    shutil.copytree(
        ROOT / "backend" / "alembic" / "versions", tmp_path / "backend" / "alembic" / "versions"
    )
    (tmp_path / "docs").mkdir()
    (tmp_path / "README.md").write_text(
        "当前迁移版本为 `0005`。\n当前 head 为 `0005`。\n不提供永久删除。\n",
        encoding="utf-8",
    )
    (tmp_path / "docs" / "security-decisions.md").write_text(
        "# 安全决策\n仅记录 `0005`\n", encoding="utf-8"
    )

    res = gates.check_docs(tmp_path)
    assert res.ok is False
    joined = "\n".join(res.errors)
    assert "0007" in joined
    assert "不提供永久删除" in joined
    assert "LICENSE" in joined
    assert "SECURITY.md" in joined
    assert "CHANGELOG.md" in joined


@pytest.mark.skipif(shutil.which("docker") is None, reason="host has no docker CLI")
def test_release_gate_compose_all_overlays_pass_on_repo():
    res = gates.check_compose_all(ROOT)
    assert res.ok is True, res.errors
    assert len(res.notes) == 4


def test_release_gate_nginx_detects_missing_rate_limit_and_location_add_header(tmp_path):
    nginx_dir = tmp_path / "infra" / "nginx"
    nginx_dir.mkdir(parents=True)
    for filename in ("accounts.example.com.conf", "proxy.conf", "gmail-manager-http.conf"):
        shutil.copy2(ROOT / "infra" / "nginx" / filename, nginx_dir / filename)

    site_file = nginx_dir / "accounts.example.com.conf"
    broken = site_file.read_text(encoding="utf-8")
    broken = broken.replace("reverify|password|", "password|")
    broken = broken.replace("zone=gm_icon_fetch burst=5 nodelay;", "")
    broken = broken.replace(
        "location /assets/ { try_files $uri =404; }",
        'location /assets/ { add_header X-Bad "1"; try_files $uri =404; }',
    )
    site_file.write_text(broken, encoding="utf-8")

    res = gates.check_nginx(tmp_path)
    assert res.ok is False
    joined = "\n".join(res.errors)
    assert "/api/v1/auth/reverify" in joined
    assert "/api/v1/apps/fetch-icon" in joined
    assert "add_header" in joined


def test_release_gate_scan_dist_clean_and_violation_detection(tmp_path):
    dist = tmp_path / "dist"
    assets = dist / "assets"
    assets.mkdir(parents=True)
    src = tmp_path / "src"
    src.mkdir()

    (dist / "index.html").write_text(
        '<!doctype html><html><head><link rel="stylesheet" href="/assets/app.css"></head>'
        '<body><div id="root"></div>'
        '<script type="module" src="/assets/app.js"></script></body></html>',
        encoding="utf-8",
    )
    (assets / "app.css").write_text(
        "/*! tailwindcss v4 | MIT | https://tailwindcss.com */\nbody { color: #111; }\n",
        encoding="utf-8",
    )
    (assets / "app.js").write_text('console.log("ok");\n', encoding="utf-8")
    (src / "App.tsx").write_text("export function App() { return null; }\n", encoding="utf-8")

    clean = gates.scan_dist(dist, src_dir=src)
    assert clean.ok is True, clean.errors

    # 注入预览分包、外部字体 CDN、CSS 外链、秘密标记、source map 与 dangerouslySetInnerHTML
    (assets / "preview-showcase.js").write_text(
        'const r="/_preview/showcase"; const cdn="https://cdn.jsdelivr.net/pkg.js";\n',
        encoding="utf-8",
    )
    (assets / "app.css").write_text(
        '@import url("https://fonts.googleapis.com/css2?family=Roboto");\n',
        encoding="utf-8",
    )
    (assets / "app.js.map").write_text("{}\n", encoding="utf-8")
    (dist / "index.html").write_text(
        '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">'
        "<!-- AGE-SECRET-KEY-1TEST -->",
        encoding="utf-8",
    )
    (src / "Unsafe.tsx").write_text(
        "export const X = () => <div dangerouslySetInnerHTML={{ __html: 'x' }} />;\n",
        encoding="utf-8",
    )

    bad = gates.scan_dist(dist, src_dir=src)
    assert bad.ok is False
    joined = "\n".join(bad.errors)
    assert "preview-showcase.js" in joined
    assert "/_preview/" in joined
    assert "cdn.jsdelivr.net" in joined
    assert "fonts.googleapis.com" in joined
    assert "AGE-SECRET-KEY-1" in joined
    assert "source map" in joined
    assert "dangerouslySetInnerHTML" in joined


def test_release_gate_audit_deps_detects_unpinned_specs(tmp_path):
    (tmp_path / "backend").mkdir()
    (tmp_path / "frontend").mkdir()
    (tmp_path / "infra" / "backup").mkdir(parents=True)

    (tmp_path / "backend" / "uv.lock").write_text("version = 1\n", encoding="utf-8")
    (tmp_path / "frontend" / "pnpm-lock.yaml").write_text(
        "lockfileVersion: '9.0'\n", encoding="utf-8"
    )
    (tmp_path / "backend" / "pyproject.toml").write_text(
        '[project]\ndependencies = ["fastapi>=0.100"]\n',
        encoding="utf-8",
    )
    (tmp_path / "frontend" / "package.json").write_text(
        '{"packageManager":"pnpm@11.25.0","engines":{"node":">=24"},"dependencies":{"x":"latest"}}',
        encoding="utf-8",
    )
    (tmp_path / "backend" / "Dockerfile").write_text("FROM python:3.12-slim\n", encoding="utf-8")
    (tmp_path / "infra" / "backup" / "Dockerfile").write_text(
        "FROM postgres:18.7-bookworm@sha256:abc AS base\nFROM base AS final\n",
        encoding="utf-8",
    )

    res = gates.audit_deps(tmp_path, run_online=False)
    assert res.ok is False
    joined = "\n".join(res.errors)
    assert "fastapi>=0.100" in joined
    assert "x=latest" in joined
    assert "python:3.12-slim" in joined


def test_release_gate_audit_deps_online_uses_uv_export_and_pnpm_audit(monkeypatch):
    from types import SimpleNamespace

    commands: list[list[str]] = []

    monkeypatch.setattr(
        gates.shutil,
        "which",
        lambda name: f"/usr/bin/{name}" if name in {"pip-audit", "uv", "pnpm"} else None,
    )

    def fake_run(cmd, **kwargs):
        commands.append(list(cmd))
        if cmd[0].endswith("/uv") and "-o" in cmd:
            out_path = Path(cmd[cmd.index("-o") + 1])
            out_path.write_text("fastapi==0.135.3\n", encoding="utf-8")
        return SimpleNamespace(returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(gates.subprocess, "run", fake_run)

    res = gates.audit_deps(ROOT, run_online=True)
    assert res.ok is True, res.errors
    assert any(cmd[0].endswith("/uv") and "export" in cmd for cmd in commands)
    pip_audit_cmd = next(cmd for cmd in commands if cmd[0].endswith("/pip-audit"))
    assert "--no-deps" in pip_audit_cmd
    assert not any(arg.endswith("uv.lock") for arg in pip_audit_cmd)
    assert any(cmd[0].endswith("/pnpm") and "audit" in cmd for cmd in commands)


def test_coverage_script_line_extraction_and_thresholds(tmp_path):
    sample = tmp_path / "sample.py"
    sample.write_text(
        "\n".join(
            [
                "from typing import TYPE_CHECKING",
                "",
                "if TYPE_CHECKING:",
                "    import os",
                "",
                "def add(a: int, b: int) -> int:",
                "    if a < 0:  # pragma: no cover",
                "        return -1",
                "    return a + b",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    executable = cov.collect_executable_lines(sample)
    assert 1 in executable
    assert 6 in executable
    assert 9 in executable
    # TYPE_CHECKING 分支和 pragma: no cover 分支均被排除
    assert 4 not in executable
    assert 7 not in executable
    assert 8 not in executable

    assert cov.is_core_security_module("app/core/encryption.py") is True
    assert cov.is_core_security_module("app/services/auth/session.py") is True
    assert cov.is_core_security_module("app/services/audit_integrity.py") is True
    assert cov.is_core_security_module("app/schemas/system.py") is False

    assert cov.evaluate_thresholds(88.5, 92.0, min_total=80.0, min_core=85.0) == []
    failures = cov.evaluate_thresholds(75.0, 81.0, min_total=80.0, min_core=85.0)
    assert len(failures) == 2


def test_csv_benchmark_generator_and_budget_evaluator():
    sample_csv = bench.generate_synthetic_csv(50)
    lines = sample_csv.decode("utf-8").splitlines()
    assert len(lines) == 51
    assert lines[0].startswith("gmail_email,password,recovery_email,")

    good_metrics = {
        "csv_mib": 2.0,
        "import_total_seconds": 12.5,
        "process_max_rss_mib": 210.0,
        "export_ttfb_seconds": 0.01,
        "export_peak_delta_mib": 5.0,
    }
    assert (
        bench.evaluate_budget(
            good_metrics,
            max_import_seconds=30.0,
            max_rss_mib=384.0,
            max_ttfb_seconds=2.0,
            max_export_mem_delta_mib=32.0,
        )
        == []
    )

    bad_metrics = {
        "csv_mib": 10.5,
        "import_total_seconds": 45.0,
        "process_max_rss_mib": 420.0,
        "export_ttfb_seconds": 3.5,
        "export_peak_delta_mib": 64.0,
    }
    bad_failures = bench.evaluate_budget(
        bad_metrics,
        max_import_seconds=30.0,
        max_rss_mib=384.0,
        max_ttfb_seconds=2.0,
        max_export_mem_delta_mib=32.0,
    )
    assert len(bad_failures) == 5


def test_audit_checkpoint_ed25519_asymmetric_sign_and_public_key_verify():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from app.services.audit_integrity import (
        AuditChainStatus,
        sign_audit_checkpoint,
        verify_audit_checkpoint,
    )

    priv = Ed25519PrivateKey.generate()
    other_priv = Ed25519PrivateKey.generate()
    priv_pem = priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pub_pem = priv.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    other_pub_pem = other_priv.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    status = AuditChainStatus(valid=True, total_events=42, latest_seq=42, latest_hash="a" * 64)
    checkpoint = sign_audit_checkpoint(status, priv_pem)
    assert checkpoint["version"] == 2
    assert checkpoint["algorithm"] == "ed25519"
    assert len(checkpoint["key_id"]) == 16
    assert verify_audit_checkpoint(checkpoint, pub_pem) is True
    assert verify_audit_checkpoint(checkpoint, other_pub_pem) is False

    tampered = dict(checkpoint, latest_seq=41)
    assert verify_audit_checkpoint(tampered, pub_pem) is False
