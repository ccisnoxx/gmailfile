"""本地发布质量门禁校验脚本（TC-P1-008/009/010）。

涵盖：
- check-openapi : 校验 docs/openapi.json 与应用实时契约逐字节一致
- check-docs    : 校验 README、开发/功能文档与安全决策文档中的迁移版本及关键能力声明与代码一致
- compose-all   : 校验全部 4 组 Docker Compose overlay 语法与安全基线
- nginx         : 校验 Nginx 安全头、限流范围与敏感路径拦截（安装 nginx 时同步运行 nginx -t）
- scan-dist     : 扫描 frontend/dist 产物与源码，确保零预览残留、零外链 CDN、零秘密泄露
- audit-deps    : 校验锁文件、精确版本固定与 Dockerfile 摘要固定（可选 --online 执行漏洞库审计）
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]

PINNED_POSTGRES_PREFIX = "postgres:18.7-bookworm@sha256:"

SECRET_MARKERS = (
    "AGE-SECRET-KEY-1",
    "-----BEGIN PRIVATE KEY-----",
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "-----BEGIN RSA PRIVATE KEY-----",
    "JBSWY3DPEHPK3PXP",
)

BLOCKED_EXTERNAL_HOSTS = (
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "cdn.jsdelivr.net",
    "unpkg.com",
    "cdnjs.cloudflare.com",
    "googletagmanager.com",
    "google-analytics.com",
    "analytics.google.com",
    "plausible.io",
    "sentry.io",
    "accounts.google.com",
)

SENSITIVE_AUTH_PATHS = (
    "/api/v1/auth/reverify",
    "/api/v1/auth/password",
    "/api/v1/auth/totp/setup",
    "/api/v1/auth/totp/confirm",
    "/api/v1/auth/totp/disable",
    "/api/v1/auth/totp/regenerate-recovery-codes",
    "/api/v1/auth/webauthn/login/options",
    "/api/v1/auth/webauthn/login/verify",
    "/api/v1/auth/webauthn/step-up/options",
    "/api/v1/auth/webauthn/step-up/verify",
    "/api/v1/auth/webauthn/register/options",
    "/api/v1/auth/webauthn/register/verify",
)

URL_RE = re.compile(r"https?://[^\s'\"`<>()]+", re.IGNORECASE)
CSS_COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)
ALLOWED_XML_NS_PREFIXES = ("http://www.w3.org/", "https://www.w3.org/")


@dataclass
class CheckResult:
    name: str
    ok: bool
    summary: str
    errors: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def check_openapi(root: Path = ROOT) -> CheckResult:
    backend_dir = str((root / "backend").resolve())
    inserted = False
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
        inserted = True
    try:
        from app.core.config import Settings
        from app.main import create_app

        app = create_app(Settings(_env_file=None))
        expected = json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n"
    finally:
        if inserted and backend_dir in sys.path:
            sys.path.remove(backend_dir)

    target = root / "docs" / "openapi.json"
    if not target.is_file():
        return CheckResult("check-openapi", False, "docs/openapi.json 不存在", [str(target)])
    actual = target.read_text(encoding="utf-8")
    if actual != expected:
        return CheckResult(
            "check-openapi",
            False,
            "docs/openapi.json 与当前 FastAPI 契约不一致，请运行 make generate-api",
            ["docs/openapi.json 内容漂移"],
        )
    return CheckResult("check-openapi", True, "docs/openapi.json 与实时契约完全一致")


def check_docs(root: Path = ROOT) -> CheckResult:
    """校验 README、功能文档、安全决策文档与 OpenAPI 及 release_meta 能力清单一致。"""
    errors: list[str] = []
    notes: list[str] = []

    backend_dir = str((root / "backend").resolve())
    inserted = False
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
        inserted = True
    try:
        from app.core.release_meta import (
            CAPABILITY_MANIFEST,
            SCHEMA_VERSION,
            resolve_schema_version,
        )

        resolved_head = resolve_schema_version(root / "backend" / "alembic" / "versions")
        expected_schema = SCHEMA_VERSION
    finally:
        if inserted and backend_dir in sys.path:
            sys.path.remove(backend_dir)

    if resolved_head != expected_schema:
        errors.append(
            f"release_meta.SCHEMA_VERSION ({expected_schema}) 与 Alembic head ({resolved_head})"
            " 不一致"
        )
    notes.append(f"schema baseline={expected_schema}")

    readme_path = root / "README.md"
    readme_text = ""
    if not readme_path.is_file() or readme_path.stat().st_size == 0:
        errors.append(f"缺少或空 README.md: {readme_path}")
    else:
        readme_text = readme_path.read_text(encoding="utf-8")

    dev_doc_path = root / "docs" / "development.md"
    if not dev_doc_path.is_file():
        errors.append(f"缺少 docs/development.md: {dev_doc_path}")
    else:
        dev_doc_text = dev_doc_path.read_text(encoding="utf-8")
        if f"当前迁移 head 为 `{expected_schema}`" not in dev_doc_text:
            errors.append(f"docs/development.md 未声明当前迁移 head 为 `{expected_schema}`")

    openapi_paths: set[str] | None = None
    openapi_file = root / "docs" / "openapi.json"
    if openapi_file.is_file():
        try:
            openapi_doc = json.loads(openapi_file.read_text(encoding="utf-8"))
            if isinstance(openapi_doc, dict) and isinstance(openapi_doc.get("paths"), dict):
                openapi_paths = set(openapi_doc["paths"].keys())
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"无法解析 docs/openapi.json: {exc}")

    for cap_name, spec in CAPABILITY_MANIFEST.items():
        if readme_text:
            for token in spec.get("readme_required", ()):
                if str(token) not in readme_text:
                    errors.append(f"README.md 缺少已交付能力 `{cap_name}` 必需说明: {token}")
            for token in spec.get("readme_forbidden", ()):
                if str(token) in readme_text:
                    errors.append(
                        f"README.md 仍残留过时声明（能力 `{cap_name}` 与当前实现冲突）: {token}"
                    )
        doc_rel = spec.get("doc_file")
        if isinstance(doc_rel, str):
            doc_path = root / doc_rel
            if not doc_path.is_file():
                errors.append(f"缺少能力文档 {doc_rel}")
            else:
                doc_text = doc_path.read_text(encoding="utf-8")
                for token in spec.get("doc_required", ()):
                    if str(token) not in doc_text:
                        errors.append(f"{doc_rel} 缺少已交付能力 `{cap_name}` 必需说明: {token}")
                for token in spec.get("doc_forbidden", ()):
                    if str(token) in doc_text:
                        errors.append(
                            f"{doc_rel} 仍残留过时声明（能力 `{cap_name}` 与当前实现冲突）: {token}"
                        )
        if openapi_paths is not None:
            for api_path in spec.get("openapi_paths", ()):
                if str(api_path) not in openapi_paths:
                    errors.append(f"docs/openapi.json 缺少能力 `{cap_name}` 声明端点: {api_path}")
            for forbidden_path in spec.get("forbidden_openapi_paths", ()):
                if str(forbidden_path) in openapi_paths:
                    errors.append(
                        f"docs/openapi.json 仍残留已弃用/禁用的路径端点 `{cap_name}`: "
                        f"{forbidden_path}"
                    )
    notes.append(f"verified {len(CAPABILITY_MANIFEST)} capability manifest entries")

    sec_doc_path = root / "docs" / "security-decisions.md"
    if not sec_doc_path.is_file():
        errors.append(f"缺少 docs/security-decisions.md: {sec_doc_path}")
    else:
        sec_text = sec_doc_path.read_text(encoding="utf-8")
        if f"`{expected_schema}`" not in sec_text:
            errors.append(f"docs/security-decisions.md 未记录迁移 `{expected_schema}` 的安全决策")

    for governance_file in ("LICENSE", "SECURITY.md", "CHANGELOG.md"):
        gov_path = root / governance_file
        if not gov_path.is_file() or gov_path.stat().st_size == 0:
            errors.append(f"仓库根目录缺少治理文档: {governance_file}")

    if errors:
        return CheckResult(
            "check-docs", False, f"文档一致性校验发现 {len(errors)} 项漂移", errors, notes
        )
    return CheckResult(
        "check-docs",
        True,
        f"README、开发/功能文档与安全文档与迁移基线 {expected_schema} 及能力清单一致",
        notes=notes,
    )


def _write_dummy_file(path: Path, content: str = "dummy-gate-placeholder\n") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    os.chmod(path, 0o600)


def _prepare_dummy_compose_env(base: Path) -> Path:
    secrets_dir = base / "secrets"
    for name in (
        "db_admin_password",
        "db_migrator_password",
        "db_password",
        "data_key_v1",
        "data_key_v2",
        "db_backup_password",
        "db_audit_password",
        "backup_recipients",
        "offsite/backup_ssh_config",
        "offsite/backup_ssh_identity",
        "offsite/backup_known_hosts",
    ):
        _write_dummy_file(secrets_dir / name)

    regression_secrets = base / "regression_secrets"
    _write_dummy_file(regression_secrets / "db_password")

    recovery_secrets = base / "recovery_secrets"
    _write_dummy_file(recovery_secrets / "backup_identity")
    _write_dummy_file(recovery_secrets / "wrong_backup_identity")

    offsite_secrets = base / "offsite_secrets"
    for name in ("backup_ssh_config", "backup_ssh_identity", "backup_known_hosts"):
        _write_dummy_file(offsite_secrets / name)

    deployment_root = base / "deployment"
    release_dir = deployment_root / "release"
    _write_dummy_file(deployment_root / "production.env", "APP_ENV=production\n")
    _write_dummy_file(release_dir / "release.json", "{}\n")
    _write_dummy_file(release_dir / "images.json", "{}\n")

    acceptance_dir = base / "acceptance"
    _write_dummy_file(acceptance_dir / "acceptance.env", "APP_ENV=test\n")
    _write_dummy_file(acceptance_dir / "evidence/effective-compose.json", "{}\n")

    env_file = base / "gate.env"
    env_file.write_text(
        "\n".join(
            [
                f"SECRETS_DIR={secrets_dir}",
                "RELEASE_ID=20260101-gatecheck",
                f"DEPLOYMENT_ROOT={deployment_root}",
                f"RELEASE_DIRECTORY={release_dir}",
                f"REGRESSION_SECRETS_DIR={regression_secrets}",
                "ACCEPTANCE_ID=gatecheck",
                "DATABASE_NAME=gm_accept_gatecheck",
                f"ACCEPTANCE_DIR={acceptance_dir}",
                f"RECOVERY_SECRETS_DIR={recovery_secrets}",
                f"OFFSITE_SECRETS_DIR={offsite_secrets}",
                "APP_BASE_URL=https://accounts.example.com",
                "ALLOWED_HOSTS=accounts.example.com",
                "SESSION_COOKIE_SECURE=true",
                "ACTIVE_DATA_KEY_VERSION=1",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    return env_file


def _is_loopback_port_entry(entry: Any) -> bool:
    if isinstance(entry, dict):
        return entry.get("host_ip") in {"127.0.0.1", "::1"}
    if isinstance(entry, str):
        return entry.startswith("127.0.0.1:") or entry.startswith("[::1]:")
    return False


def _assert_hardened_service(
    overlay: str, name: str, svc: dict[str, Any], errors: list[str]
) -> None:
    if svc.get("user") != "10001:10001":
        errors.append(f"{overlay}/{name}: user 必须为 10001:10001，实际为 {svc.get('user')!r}")
    if svc.get("read_only") is not True:
        errors.append(f"{overlay}/{name}: 必须启用 read_only: true")
    cap_drop = svc.get("cap_drop") or []
    if "ALL" not in cap_drop:
        errors.append(f"{overlay}/{name}: cap_drop 必须包含 ALL")
    sec_opt = svc.get("security_opt") or []
    if "no-new-privileges:true" not in sec_opt:
        errors.append(f"{overlay}/{name}: security_opt 必须包含 no-new-privileges:true")


def check_compose_all(root: Path = ROOT) -> CheckResult:
    docker_bin = shutil.which("docker")
    if docker_bin is None:
        return CheckResult("compose-all", False, "未找到 docker CLI，无法执行 Compose 校验")

    overlays: list[tuple[str, list[str], list[str]]] = [
        ("dev", ["infra/docker-compose.yml", "infra/docker-compose.dev.yml"], []),
        (
            "production+offsite",
            [
                "infra/docker-compose.yml",
                "infra/docker-compose.production.yml",
                "infra/docker-compose.offsite.yml",
            ],
            ["operations"],
        ),
        ("regression", ["infra/docker-compose.regression.yml"], []),
        (
            "acceptance",
            ["infra/docker-compose.yml", "infra/docker-compose.acceptance.yml"],
            ["acceptance", "operations"],
        ),
    ]

    errors: list[str] = []
    notes: list[str] = []

    with tempfile.TemporaryDirectory(prefix="gm_compose_gate_") as tmp:
        env_file = _prepare_dummy_compose_env(Path(tmp))
        for overlay_name, files, profiles in overlays:
            cmd = [docker_bin, "compose", "--env-file", str(env_file)]
            for profile in profiles:
                cmd.extend(["--profile", profile])
            for rel_file in files:
                cmd.extend(["-f", str(root / rel_file)])
            cmd.extend(["config", "--format", "yaml"])

            proc = subprocess.run(cmd, cwd=root, capture_output=True, text=True, check=False)
            if proc.returncode != 0:
                errors.append(
                    f"{overlay_name}: docker compose config 失败 (exit={proc.returncode}): "
                    f"{proc.stderr.strip()}"
                )
                continue

            config = yaml.safe_load(proc.stdout) or {}
            services: dict[str, dict[str, Any]] = config.get("services") or {}
            networks: dict[str, dict[str, Any]] = config.get("networks") or {}
            notes.append(f"{overlay_name}: {len(services)} services validated")

            for svc_name, svc in services.items():
                env_map = svc.get("environment") or {}
                if isinstance(env_map, dict):
                    for key in env_map:
                        if key.endswith("_PASSWORD"):
                            errors.append(
                                f"{overlay_name}/{svc_name}: 检测到明文密码环境变量 {key}"
                            )

            pg = services.get("postgres")
            if pg is None:
                errors.append(f"{overlay_name}: 缺少 postgres 服务")
            else:
                pg_image = str(pg.get("image", ""))
                if not pg_image.startswith(PINNED_POSTGRES_PREFIX):
                    errors.append(
                        f"{overlay_name}/postgres: 镜像必须固定为 {PINNED_POSTGRES_PREFIX}...，"
                        f"实际为 {pg_image!r}"
                    )
                if pg.get("ports"):
                    errors.append(f"{overlay_name}/postgres: 禁止向宿主机发布端口")

            if overlay_name == "production+offsite":
                for svc_name in ("api", "migrate", "backup"):
                    svc = services.get(svc_name)
                    if svc is None:
                        errors.append(f"{overlay_name}: 缺少 {svc_name} 服务")
                    else:
                        _assert_hardened_service(overlay_name, svc_name, svc, errors)
                api = services.get("api") or {}
                api_env = api.get("environment") or {}
                if api_env.get("APP_ENV") != "production":
                    errors.append(f"{overlay_name}/api: APP_ENV 必须为 production")
                if str(api_env.get("SESSION_COOKIE_SECURE")).lower() != "true":
                    errors.append(f"{overlay_name}/api: SESSION_COOKIE_SECURE 必须为 true")
                for port in api.get("ports") or []:
                    if not _is_loopback_port_entry(port):
                        errors.append(
                            f"{overlay_name}/api: 端口必须仅绑定回环地址，实际为 {port!r}"
                        )
                if not (networks.get("app_internal") or {}).get("internal"):
                    errors.append(f"{overlay_name}: app_internal 网络必须设置 internal: true")

            elif overlay_name == "regression":
                test_svc = services.get("test")
                if test_svc is None:
                    errors.append("regression: 缺少 test 服务")
                else:
                    _assert_hardened_service(overlay_name, "test", test_svc, errors)
                if pg is not None and str(pg.get("restart")) != "no":
                    errors.append("regression/postgres: restart 必须为 no")
                if not (networks.get("test_internal") or {}).get("internal"):
                    errors.append("regression: test_internal 网络必须设置 internal: true")

            elif overlay_name == "acceptance":
                api = services.get("api") or {}
                if api.get("ports"):
                    errors.append("acceptance/api: 验收环境禁止暴露宿主机端口")
                if str(api.get("restart")) != "no":
                    errors.append("acceptance/api: restart 必须为 no")
                if pg is not None and str(pg.get("restart")) != "no":
                    errors.append("acceptance/postgres: restart 必须为 no")
                restore_svc = services.get("restore")
                if restore_svc is None:
                    errors.append("acceptance: 缺少 restore 服务")
                else:
                    _assert_hardened_service(overlay_name, "restore", restore_svc, errors)

    if errors:
        return CheckResult(
            "compose-all", False, f"Compose 校验发现 {len(errors)} 项问题", errors, notes
        )
    return CheckResult(
        "compose-all", True, "全部 4 组 Compose overlay 语法与安全基线通过", notes=notes
    )


def _extract_location_blocks(conf_text: str) -> list[tuple[str, str]]:
    """提取 Nginx 配置中的全部 location 头部及块体（支持单行与多行块）。"""
    blocks: list[tuple[str, str]] = []
    pattern = re.compile(r"^\s*location\s+([^{]+?)\s*\{", re.MULTILINE)
    pos = 0
    while True:
        match = pattern.search(conf_text, pos)
        if match is None:
            break
        header = match.group(1).strip()
        depth = 1
        idx = match.end()
        while idx < len(conf_text) and depth > 0:
            ch = conf_text[idx]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
            idx += 1
        body = conf_text[match.end() : idx - 1]
        blocks.append((header, body))
        pos = idx
    return blocks


def check_nginx(root: Path = ROOT) -> CheckResult:
    nginx_dir = root / "infra" / "nginx"
    site_file = nginx_dir / "accounts.example.com.conf"
    proxy_file = nginx_dir / "proxy.conf"
    http_file = nginx_dir / "gmail-manager-http.conf"

    errors: list[str] = []
    notes: list[str] = []
    for path in (site_file, proxy_file, http_file):
        if not path.is_file():
            errors.append(f"缺少 Nginx 配置文件: {path}")
    if errors:
        return CheckResult("nginx", False, "Nginx 配置文件缺失", errors)

    site_text = site_file.read_text(encoding="utf-8")
    proxy_text = proxy_file.read_text(encoding="utf-8")
    http_text = http_file.read_text(encoding="utf-8")

    # 1. 限流区与基础安全配置
    for directive in (
        "zone=gm_login:",
        "zone=gm_icon_fetch:",
        "zone=gm_api:",
        "server_tokens off;",
        "ssl_protocols TLSv1.2 TLSv1.3;",
        "ssl_session_tickets off;",
        "client_max_body_size 10m;",
    ):
        if directive not in site_text:
            errors.append(f"site.conf 缺少必需指令: {directive}")

    # 2. 7 项 server 级安全响应头且全部带 always
    required_headers = (
        ("Strict-Transport-Security", "max-age=31536000"),
        ("X-Content-Type-Options", "nosniff"),
        ("X-Frame-Options", "DENY"),
        ("Referrer-Policy", "no-referrer"),
        ("Permissions-Policy", "camera=()"),
        ("Content-Security-Policy", "default-src 'self'"),
        ("Cache-Control", "no-store"),
    )
    for header_name, expected_fragment in required_headers:
        match = re.search(
            rf'^\s*add_header\s+{re.escape(header_name)}\s+"([^"]+)"\s+always;',
            site_text,
            re.MULTILINE,
        )
        if match is None:
            errors.append(f"site.conf 缺少带 always 的安全头: {header_name}")
            continue
        value = match.group(1)
        if expected_fragment not in value:
            errors.append(f"site.conf 安全头 {header_name} 缺少 {expected_fragment!r}")
        if header_name == "Content-Security-Policy":
            for csp_req in ("script-src 'self'", "object-src 'none'", "frame-ancestors 'none'"):
                if csp_req not in value:
                    errors.append(f"CSP 缺少必需约束: {csp_req}")
            if "unsafe-eval" in value or "http://" in value or "https://" in value:
                errors.append(f"CSP 不允许包含 unsafe-eval 或外链源: {value}")

    # 3. location 块检查：不得覆写 add_header，敏感端点 404，认证端点受 gm_login 保护
    locations = _extract_location_blocks(site_text)
    if not locations:
        errors.append("site.conf 未解析出任何 location 块")

    location_map = {header: body for header, body in locations}
    for header, body in locations:
        if "add_header" in body:
            errors.append(f"location {header!r} 内禁止出现 add_header（会覆盖 server 级安全头）")

    for blocked in (
        "= /api/v1/health/ready",
        "= /api/docs",
        "= /api/redoc",
        "= /api/openapi.json",
        "~ /\\.",
    ):
        body = location_map.get(blocked)
        if body is None or "return 404;" not in body:
            errors.append(f"site.conf 必须对 location {blocked} 返回 404")

    login_body = location_map.get("= /api/v1/auth/login", "")
    if "zone=gm_login" not in login_body or "limit_req_status 429;" not in login_body:
        errors.append(
            "location = /api/v1/auth/login 必须配置 zone=gm_login 与 limit_req_status 429;"
        )

    icon_fetch_body = location_map.get("= /api/v1/apps/fetch-icon", "")
    if (
        "zone=gm_icon_fetch" not in icon_fetch_body
        or "limit_req_status 429;" not in icon_fetch_body
    ):
        errors.append(
            "location = /api/v1/apps/fetch-icon 必须配置 zone=gm_icon_fetch "
            "与 limit_req_status 429;"
        )

    gm_login_regexes: list[re.Pattern[str]] = []
    for header, body in locations:
        if header.startswith("~ ") and "zone=gm_login" in body and "limit_req_status 429;" in body:
            gm_login_regexes.append(re.compile(header[2:].strip()))

    for auth_path in SENSITIVE_AUTH_PATHS:
        if not any(pattern.search(auth_path) for pattern in gm_login_regexes):
            errors.append(f"敏感认证端点 {auth_path} 未纳入 gm_login 限流规则")
    if any(pattern.search("/api/v1/auth/me") for pattern in gm_login_regexes):
        errors.append("/api/v1/auth/me 不应命中严格登录限流 gm_login")

    # 4. proxy.conf 与 HTTP-01 引导配置检查
    for proxy_req in (
        "proxy_pass http://127.0.0.1:8000;",
        "proxy_set_header X-Real-IP $remote_addr;",
        "proxy_set_header X-Forwarded-For $remote_addr;",
        'proxy_set_header Forwarded "";',
        "proxy_set_header X-Request-ID $request_id;",
        "proxy_hide_header Cache-Control;",
        "proxy_cache off;",
        "proxy_buffering off;",
        "proxy_request_buffering off;",
    ):
        if proxy_req not in proxy_text:
            errors.append(f"proxy.conf 缺少必需指令: {proxy_req}")

    if "server_tokens off;" not in http_text or "return 503;" not in http_text:
        errors.append("gmail-manager-http.conf 必须禁用 server_tokens 且非 ACME 路径返回 503")

    # 5. 若宿主机存在 nginx 可执行文件则追加 nginx -t；未安装时诚实注明仅完成静态契约校验
    nginx_bin = shutil.which("nginx")
    if nginx_bin is None:
        notes.append(
            "nginx binary not installed on host (static contract verified; run nginx -t on Linux)"
        )
    else:
        notes.append(f"nginx binary detected: {nginx_bin}")
        with tempfile.TemporaryDirectory(prefix="gm_nginx_check_") as tmp:
            tmp_path = Path(tmp)
            wrapper = tmp_path / "nginx.conf"
            # 替换示例路径为临时目录占位，避免依赖宿主机证书与日志目录权限。
            cert = tmp_path / "fullchain.pem"
            key = tmp_path / "privkey.pem"
            openssl_bin = shutil.which("openssl")
            if openssl_bin is not None:
                subprocess.run(
                    [
                        openssl_bin,
                        "req",
                        "-x509",
                        "-newkey",
                        "rsa:2048",
                        "-nodes",
                        "-keyout",
                        str(key),
                        "-out",
                        str(cert),
                        "-days",
                        "1",
                        "-subj",
                        "/CN=accounts.example.com",
                    ],
                    capture_output=True,
                    check=True,
                )
                patched_site = (
                    site_text.replace(
                        "/etc/letsencrypt/gmail-manager/live/accounts.example.com/fullchain.pem",
                        str(cert),
                    )
                    .replace(
                        "/etc/letsencrypt/gmail-manager/live/accounts.example.com/privkey.pem",
                        str(key),
                    )
                    .replace(
                        "/etc/nginx/gmail-manager/proxy.conf",
                        str(proxy_file),
                    )
                    .replace(
                        "/var/log/nginx/gmail-manager.access.log",
                        str(tmp_path / "access.log"),
                    )
                    .replace(
                        "/var/log/nginx/gmail-manager.error.log",
                        str(tmp_path / "error.log"),
                    )
                )
                test_site = tmp_path / "site.conf"
                test_site.write_text(patched_site, encoding="utf-8")
                wrapper.write_text(
                    "events {}\n"
                    f"pid {tmp_path / 'nginx.pid'};\n"
                    f"error_log {tmp_path / 'master-error.log'} warn;\n"
                    "http {\n"
                    f"    include {test_site};\n"
                    "}\n",
                    encoding="utf-8",
                )
                proc = subprocess.run(
                    [nginx_bin, "-t", "-c", str(wrapper)],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if proc.returncode != 0:
                    errors.append(f"nginx -t 失败: {proc.stderr.strip()}")
                else:
                    notes.append("nginx -t syntax check passed")

    if errors:
        return CheckResult(
            "nginx", False, f"Nginx 安全校验发现 {len(errors)} 项问题", errors, notes
        )
    return CheckResult("nginx", True, "Nginx 安全头、限流范围与敏感路径隔离校验通过", notes=notes)


def scan_dist(dist_dir: Path, *, src_dir: Path | None = None) -> CheckResult:
    errors: list[str] = []
    notes: list[str] = []

    if not dist_dir.is_dir():
        return CheckResult(
            "scan-dist",
            False,
            f"生产构建目录不存在: {dist_dir}（请先构建前端产物）",
            [str(dist_dir)],
        )

    index_html = dist_dir / "index.html"
    if not index_html.is_file():
        errors.append("frontend/dist 缺少 index.html")

    files = sorted(p for p in dist_dir.rglob("*") if p.is_file())
    js_files = [p for p in files if p.suffix in {".js", ".mjs"}]
    css_files = [p for p in files if p.suffix == ".css"]
    map_files = [p for p in files if p.suffix == ".map"]
    if not js_files:
        errors.append("frontend/dist 中未找到构建后的 JS 产物")
    if not css_files:
        errors.append("frontend/dist 中未找到构建后的 CSS 产物")
    if map_files:
        errors.append(
            "frontend/dist 不应包含 source map 文件: "
            + ", ".join(p.relative_to(dist_dir).as_posix() for p in map_files)
        )

    for path in files:
        rel = path.relative_to(dist_dir).as_posix()
        if "preview" in rel.lower():
            errors.append(f"生产构建目录存在预览产物文件: {rel}")
        if path.suffix not in {".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt"}:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")

        for forbidden in ("/_preview/", "PreviewShowcasePage"):
            if forbidden in text:
                errors.append(f"生产产物 {rel} 残留开发预览标识: {forbidden}")

        for marker in SECRET_MARKERS:
            if marker in text:
                errors.append(f"生产产物 {rel} 检测到疑似秘密标记: {marker}")

        if path.suffix in {".html", ".css"}:
            url_surface = CSS_COMMENT_RE.sub("", text) if path.suffix == ".css" else text
            for url in URL_RE.findall(url_surface):
                if not url.startswith(ALLOWED_XML_NS_PREFIXES):
                    errors.append(f"生产静态文件 {rel} 包含外部链接: {url}")
        elif path.suffix in {".js", ".mjs"}:
            lower = text.lower()
            for host in BLOCKED_EXTERNAL_HOSTS:
                if host in lower:
                    errors.append(f"生产脚本 {rel} 包含禁用外部 CDN/字体/统计域名: {host}")

    notes.append(f"scanned {len(files)} dist files ({len(js_files)} js, {len(css_files)} css)")

    if src_dir is not None and src_dir.is_dir():
        src_files = [
            p
            for p in sorted(src_dir.rglob("*"))
            if p.is_file() and p.suffix in {".ts", ".tsx", ".js", ".jsx", ".css", ".html"}
        ]
        for path in src_files:
            rel = path.relative_to(src_dir).as_posix()
            text = path.read_text(encoding="utf-8", errors="replace")
            if "dangerouslySetInnerHTML" in text:
                errors.append(f"前端源码 {rel} 禁止使用 dangerouslySetInnerHTML")
            for marker in SECRET_MARKERS:
                if marker in text:
                    errors.append(f"前端源码 {rel} 检测到疑似秘密标记: {marker}")
        notes.append(f"scanned {len(src_files)} frontend/src source files")

    if errors:
        return CheckResult(
            "scan-dist", False, f"产物安全扫描发现 {len(errors)} 项问题", errors, notes
        )
    return CheckResult(
        "scan-dist", True, "前端生产产物无预览残留、无外部 CDN、无敏感泄露", notes=notes
    )


def _check_dockerfile_digests(dockerfile: Path, errors: list[str]) -> None:
    if not dockerfile.is_file():
        errors.append(f"缺少 Dockerfile: {dockerfile}")
        return
    stages: set[str] = set()
    for lineno, raw in enumerate(dockerfile.read_text(encoding="utf-8").splitlines(), start=1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = re.match(
            r"^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?",
            stripped,
            re.IGNORECASE,
        )
        if match is None:
            continue
        image, stage = match.group(1), match.group(2)
        if image not in stages and "@sha256:" not in image:
            errors.append(
                f"{dockerfile.name}:{lineno} 外部基础镜像必须使用 @sha256: 固定摘要: {image}"
            )
        if stage:
            stages.add(stage)


def _run_online_python_audit(
    root: Path, errors: list[str], notes: list[str], *, strict: bool = True
) -> None:
    pip_audit = shutil.which("pip-audit")
    uv_bin = shutil.which("uv")
    if pip_audit is None:
        msg = "未安装 pip-audit，无法执行在线 Python CVE 漏洞库审计"
        if strict:
            errors.append(msg)
        else:
            notes.append(msg)
        return
    if uv_bin is None:
        msg = "未安装 uv，无法导出 backend/uv.lock 执行在线 Python CVE 漏洞库审计"
        if strict:
            errors.append(msg)
        else:
            notes.append(msg)
        return
    with tempfile.TemporaryDirectory(prefix="gm_pip_audit_") as tmp:
        req_file = Path(tmp) / "requirements.txt"
        try:
            export_proc = subprocess.run(
                [
                    uv_bin,
                    "export",
                    "--locked",
                    "--no-hashes",
                    "--no-emit-project",
                    "--format",
                    "requirements-txt",
                    "-o",
                    str(req_file),
                ],
                cwd=root / "backend",
                capture_output=True,
                text=True,
                check=False,
                timeout=120,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            errors.append(f"uv export 执行失败或超时: {exc}")
            return
        if export_proc.returncode != 0:
            errors.append(
                "uv export 导出锁定依赖失败: "
                + (export_proc.stderr.strip() or export_proc.stdout.strip())
            )
            return
        try:
            proc = subprocess.run(
                [pip_audit, "--no-deps", "-r", str(req_file)],
                capture_output=True,
                text=True,
                check=False,
                timeout=180,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            errors.append(f"pip-audit 漏洞库查询失败或不可达: {exc}")
            return
        notes.append(f"pip-audit exit={proc.returncode}")
        if proc.returncode != 0:
            errors.append(f"pip-audit 报告漏洞或失败: {proc.stderr.strip() or proc.stdout.strip()}")


def _run_online_frontend_audit(
    root: Path, errors: list[str], notes: list[str], *, strict: bool = True
) -> None:
    pnpm_bin = shutil.which("pnpm")
    if pnpm_bin is None:
        msg = "未安装 pnpm，无法执行在线前端依赖 CVE 漏洞库审计"
        if strict:
            errors.append(msg)
        else:
            notes.append(msg)
        return
    try:
        proc = subprocess.run(
            [pnpm_bin, "audit", "--prod", "--audit-level=high"],
            cwd=root / "frontend",
            capture_output=True,
            text=True,
            check=False,
            timeout=180,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        errors.append(f"pnpm audit 漏洞库查询失败或不可达: {exc}")
        return
    notes.append(f"pnpm-audit exit={proc.returncode}")
    if proc.returncode != 0:
        errors.append(
            f"pnpm audit 报告高危漏洞或失败: {proc.stderr.strip() or proc.stdout.strip()}"
        )


def _check_offline_dep_integrity(root: Path, errors: list[str], notes: list[str]) -> None:
    uv_lock = root / "backend" / "uv.lock"
    pnpm_lock = root / "frontend" / "pnpm-lock.yaml"
    pyproject_file = root / "backend" / "pyproject.toml"
    pkg_file = root / "frontend" / "package.json"

    for lock in (uv_lock, pnpm_lock):
        if not lock.is_file() or lock.stat().st_size == 0:
            errors.append(f"锁文件缺失或为空: {lock}")

    if pyproject_file.is_file():
        pyproject = tomllib.loads(pyproject_file.read_text(encoding="utf-8"))
        deps = list(pyproject.get("project", {}).get("dependencies", []))
        for group_deps in (pyproject.get("dependency-groups") or {}).values():
            if isinstance(group_deps, list):
                deps.extend(item for item in group_deps if isinstance(item, str))
        for spec in deps:
            if "==" not in spec or any(
                tok in spec for tok in ("git+", "http://", "https://", " @ ")
            ):
                errors.append(f"backend/pyproject.toml 依赖必须严格使用 == 固定版本: {spec}")
        notes.append(f"verified {len(deps)} pinned Python dependencies in pyproject.toml")
    else:
        errors.append("缺少 backend/pyproject.toml")

    if pkg_file.is_file():
        pkg = json.loads(pkg_file.read_text(encoding="utf-8"))
        if not pkg.get("packageManager"):
            errors.append("frontend/package.json 必须声明固定 packageManager")
        if not (pkg.get("engines") or {}).get("node"):
            errors.append("frontend/package.json 必须声明 engines.node")
        all_js_deps: dict[str, str] = {}
        all_js_deps.update(pkg.get("dependencies") or {})
        all_js_deps.update(pkg.get("devDependencies") or {})
        for dep_name, version in all_js_deps.items():
            if any(
                version.startswith(prefix) for prefix in ("git+", "http://", "https://", "file:")
            ) or version in {"*", "latest"}:
                errors.append(f"frontend/package.json 禁止非确定性依赖声明: {dep_name}={version}")
        notes.append(f"verified {len(all_js_deps)} frontend dependencies + pnpm-lock.yaml")
    else:
        errors.append("缺少 frontend/package.json")

    _check_dockerfile_digests(root / "backend" / "Dockerfile", errors)
    _check_dockerfile_digests(root / "infra" / "backup" / "Dockerfile", errors)


def audit_deps_offline_integrity(root: Path = ROOT) -> CheckResult:
    """离线供应链确定性校验：锁文件、精确版本固定与 Dockerfile 基础镜像摘要（不查询 CVE 库）。"""
    errors: list[str] = []
    notes: list[str] = []
    _check_offline_dep_integrity(root, errors, notes)
    notes.append("offline deterministic integrity check only (no CVE vulnerability DB query)")
    if errors:
        return CheckResult(
            "audit-deps-offline-integrity",
            False,
            f"离线供应链与锁文件校验发现 {len(errors)} 项问题",
            errors,
            notes,
        )
    return CheckResult(
        "audit-deps-offline-integrity",
        True,
        "锁文件完整性、依赖精确固定与镜像摘要校验通过（离线模式，未查 CVE 库）",
        notes=notes,
    )


def audit_deps_online_strict(root: Path = ROOT) -> CheckResult:
    """严格在线漏洞库审计：叠加离线校验与 pip-audit/pnpm audit；缺工具、断网或命中漏洞均失败。"""
    errors: list[str] = []
    notes: list[str] = []
    _check_offline_dep_integrity(root, errors, notes)
    _run_online_python_audit(root, errors, notes, strict=True)
    _run_online_frontend_audit(root, errors, notes, strict=True)
    if errors:
        return CheckResult(
            "audit-deps-online-strict",
            False,
            f"严格在线依赖与漏洞库审计发现 {len(errors)} 项问题",
            errors,
            notes,
        )
    return CheckResult(
        "audit-deps-online-strict",
        True,
        "离线供应链完整性与严格在线 Python/前端 CVE 漏洞库审计均通过",
        notes=notes,
    )


def audit_deps(root: Path = ROOT, *, run_online: bool = False) -> CheckResult:
    if run_online:
        return audit_deps_online_strict(root)
    return audit_deps_offline_integrity(root)


def _print_result(res: CheckResult) -> None:
    status = "PASS" if res.ok else "FAIL"
    print(f"[{status}] {res.name}: {res.summary}")
    for note in res.notes:
        print(f"       note: {note}")
    for err in res.errors:
        print(f"       error: {err}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="gmailfile 本地发布质量门禁检查工具")
    parser.add_argument(
        "command",
        choices=(
            "check-openapi",
            "check-docs",
            "compose-all",
            "nginx",
            "scan-dist",
            "audit-deps-offline-integrity",
            "audit-deps-online-strict",
            "audit-deps",
            "all",
        ),
        help="要执行的检查项",
    )
    parser.add_argument("--root", type=Path, default=ROOT, help="仓库根目录")
    parser.add_argument("--dist-dir", type=Path, default=None, help="前端构建产物目录")
    parser.add_argument(
        "--online",
        action="store_true",
        help="在 audit-deps / all 中启用严格在线依赖漏洞库扫描（缺工具或断网即失败）",
    )
    parser.add_argument("--json", action="store_true", dest="as_json", help="输出 JSON 格式结果")
    args = parser.parse_args(argv)

    root = args.root.resolve()
    dist_dir = (args.dist_dir or (root / "frontend" / "dist")).resolve()
    src_dir = root / "frontend" / "src"

    runners = {
        "check-openapi": lambda: check_openapi(root),
        "check-docs": lambda: check_docs(root),
        "compose-all": lambda: check_compose_all(root),
        "nginx": lambda: check_nginx(root),
        "scan-dist": lambda: scan_dist(dist_dir, src_dir=src_dir),
        "audit-deps-offline-integrity": lambda: audit_deps_offline_integrity(root),
        "audit-deps-online-strict": lambda: audit_deps_online_strict(root),
        "audit-deps": lambda: audit_deps(root, run_online=args.online),
    }

    if args.command == "all":
        selected = [
            "check-openapi",
            "check-docs",
            "compose-all",
            "nginx",
            "scan-dist",
            "audit-deps-online-strict" if args.online else "audit-deps-offline-integrity",
        ]
    else:
        selected = [args.command]
    results = [runners[name]() for name in selected]

    if args.as_json:
        print(
            json.dumps(
                [
                    {
                        "name": r.name,
                        "ok": r.ok,
                        "summary": r.summary,
                        "errors": r.errors,
                        "notes": r.notes,
                    }
                    for r in results
                ],
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        for res in results:
            _print_result(res)

    return 0 if all(r.ok for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
