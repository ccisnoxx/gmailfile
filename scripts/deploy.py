"""发布器示例；固定实例值在私有库定制，默认只显示计划，不生成 Secret。"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.core.release_meta import (  # noqa: E402
    APP_VERSION,
    BUILDKIT_IMAGE,
    IMAGE_NAMES,
    POSTGRES_IMAGE,
    PROVENANCE_LABEL_KEYS,
    SCHEMA_VERSION,
    canonical_source_archive_sha256,
)

ROOT = Path("/opt/example/gmail-manager")
PROJECT = "gmail-manager-production"
BUILDER = "gmail-manager-production-build"
FILES = ("docker-compose.yml", "docker-compose.production.yml", "docker-compose.offsite.yml")
BUILT_IMAGE_NAMES = ("api", "backup", "restore", "test")
_HEX40_RE = re.compile(r"[0-9a-f]{40}")
_HEX64_RE = re.compile(r"[0-9a-f]{64}")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(command, *, capture=False):
    if not capture:
        print("执行：" + " ".join(command), flush=True)
    result = subprocess.run(command, check=True, text=True, capture_output=capture)
    return result.stdout.strip() if capture else ""


def file_sha256(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def expected_image_labels(manifest: dict) -> dict[str, str]:
    return {
        PROVENANCE_LABEL_KEYS["app_version"]: manifest["app_version"],
        PROVENANCE_LABEL_KEYS["git_commit"]: manifest["git_commit"],
        PROVENANCE_LABEL_KEYS["release_id"]: manifest["release_id"],
        PROVENANCE_LABEL_KEYS["git_tree"]: manifest["git_tree"],
        PROVENANCE_LABEL_KEYS["source_archive_sha256"]: manifest["source_archive_sha256"],
        PROVENANCE_LABEL_KEYS["sbom_sha256"]: manifest["sbom_sha256"],
    }


def verify_release_provenance(release: Path, manifest: dict) -> None:
    """核对发布清单的 Git 溯源、工作区洁净度、SBOM 摘要及源码归档摘要。"""
    require(
        manifest.get("release_id") == release.name
        and manifest.get("app_version") == APP_VERSION
        and manifest.get("schema_version") == SCHEMA_VERSION,
        "发布基线不匹配；版本或 schema 升级需先更新和审核发布合同",
    )
    require(
        isinstance(manifest.get("git_commit"), str) and _HEX40_RE.fullmatch(manifest["git_commit"]),
        "发布清单缺少有效的 git_commit",
    )
    require(
        isinstance(manifest.get("git_tree"), str) and _HEX40_RE.fullmatch(manifest["git_tree"]),
        "发布清单缺少有效的 git_tree",
    )
    require(manifest.get("working_tree_clean") is True, "禁止部署工作区不洁净的发布包")
    require(
        isinstance(manifest.get("source_archive_sha256"), str)
        and _HEX64_RE.fullmatch(manifest["source_archive_sha256"]),
        "发布清单缺少有效的 source_archive_sha256",
    )
    require(
        isinstance(manifest.get("sbom_sha256"), str)
        and _HEX64_RE.fullmatch(manifest["sbom_sha256"]),
        "发布清单缺少有效的 sbom_sha256",
    )
    sbom_file = release / "sbom.cdx.json"
    require(
        sbom_file.is_file() and not sbom_file.is_symlink(),
        "发布目录缺少 sbom.cdx.json",
    )
    require(file_sha256(sbom_file) == manifest["sbom_sha256"], "SBOM 摘要校验失败")
    files = manifest.get("files")
    if files is not None:
        require(isinstance(files, list) and bool(files), "发布文件清单为空")
        require(
            canonical_source_archive_sha256(release, files) == manifest["source_archive_sha256"],
            "源码归档摘要校验失败，发布目录内容与清单不一致",
        )


def compose(release):
    command = [
        "docker",
        "compose",
        "--project-name",
        PROJECT,
        "--env-file",
        str(ROOT / "production.env"),
    ]
    for filename in FILES:
        command += ["-f", str(release / "infra" / filename)]
    return command + ["--profile", "operations"]


def validate_config(value, release_id):
    services = value["services"]
    require(
        set(services) == {"postgres", "migrate", "api", "backup", "backup-init"},
        "生产服务清单不匹配，禁止 development/acceptance 服务",
    )
    api, pg, backup = (services[name] for name in ("api", "postgres", "backup"))
    env = api["environment"]
    require(
        env["APP_ENV"] == "production"
        and env["TOTP_REQUIRED"] == "true"
        and env.get("STEP_UP_TOTP_REQUIRED") == "true"
        and env["SESSION_COOKIE_SECURE"] == "true"
        and env["DEBUG"] == "false"
        and env["EXPOSE_API_DOCS"] == "false"
        and not env["CORS_ORIGINS"],
        "生产认证或调试配置不安全",
    )
    require(
        env["APP_BASE_URL"] == "https://accounts.example.com"
        and env["ALLOWED_HOSTS"] == "accounts.example.com",
        "生产域名不匹配",
    )
    require(env["DATABASE_NAME"] == "gmail_manager", "禁止复用验收数据库")
    ports = api.get("ports", [])
    require(
        len(ports) == 1
        and ports[0]["host_ip"] == "127.0.0.1"
        and str(ports[0]["published"]) == "8000"
        and ports[0]["target"] == 8000,
        "API只能发布到127.0.0.1:8000",
    )
    require(
        not pg.get("ports") and pg["image"] == POSTGRES_IMAGE,
        "PostgreSQL端口或固定摘要版本不匹配",
    )
    for name in ("api", "postgres", "backup"):
        require(services[name]["restart"] == "unless-stopped", "生产服务必须自动重启")
    for name in ("api", "migrate", "backup-init"):
        require(services[name]["image"] == f"{IMAGE_NAMES['api']}:{release_id}", "API版本不匹配")
    require(backup["image"] == f"{IMAGE_NAMES['backup']}:{release_id}", "备份版本不匹配")
    require(
        api["command"][-3:] == ["--proxy-headers", "--forwarded-allow-ips", "10.203.1.1"],
        "代理只可信任固定宿主网关",
    )
    network = value["networks"]["app_internal"]
    require(
        network["internal"]
        and network["ipam"]["config"] == [{"subnet": "10.203.0.0/28", "gateway": "10.203.0.1"}],
        "内部网络不匹配",
    )
    require(set(api["networks"]) == {"app_internal", "api_ingress"}, "API入口网络不匹配")
    require(set(pg["networks"]) == {"app_internal"}, "数据库只能加入内部网络")
    require(
        value["networks"]["api_ingress"]["ipam"]["config"]
        == [{"subnet": "10.203.1.0/28", "gateway": "10.203.1.1"}],
        "入口网关不匹配",
    )
    command = backup["command"]
    require(
        command[0] == "schedule" and command[command.index("--at") + 1] == "02:00",
        "正式调度必须为02:00 UTC",
    )
    require(backup["environment"]["OFFSITE_HOST"] == "backup-receiver", "异地身份未配置")
    require(
        {secret["source"] for secret in backup["secrets"]}
        == {
            "db_backup_password",
            "backup_recipients",
            "backup_ssh_config",
            "backup_ssh_identity",
            "backup_known_hosts",
        },
        "备份Secret白名单不匹配",
    )


def atomic_json(path, value):
    temporary = path.with_suffix(".next")
    with temporary.open("x") as output:
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


def activate(release):
    temporary = ROOT / "current.next"
    temporary.symlink_to(release)
    os.replace(temporary, ROOT / "current")


def schema_version(command):
    return run(
        command
        + [
            "exec",
            "-T",
            "postgres",
            "psql",
            "-U",
            "gm_bootstrap",
            "-d",
            "gmail_manager",
            "-Atqc",
            "SELECT version_num FROM alembic_version",
        ],
        capture=True,
    )


def loopback_ready():
    request = urllib.request.Request(
        "http://127.0.0.1:8000/api/v1/health/ready", headers={"Host": "accounts.example.com"}
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        require(
            response.status == 200 and json.load(response) == {"status": "ready"},
            "宿主机回环API未就绪",
        )


def deploy(command, release, *, rollback=False, compatible=False):
    manifest = json.loads((release / "release.json").read_text())
    verify_release_provenance(release, manifest)
    images = json.loads((release / "images.json").read_text())
    expected_labels = expected_image_labels(manifest)
    for name, record in images.items():
        require(
            run(["docker", "image", "inspect", "--format", "{{.Id}}", record["tag"]], capture=True)
            == record["id"],
            f"镜像标签漂移：{name}",
        )
        if name in BUILT_IMAGE_NAMES:
            raw_labels = run(
                [
                    "docker",
                    "image",
                    "inspect",
                    "--format",
                    "{{json .Config.Labels}}",
                    record["tag"],
                ],
                capture=True,
            )
            labels = json.loads(raw_labels) if raw_labels and raw_labels != "null" else {}
            require(
                all(labels.get(k) == v for k, v in expected_labels.items()),
                f"镜像源码溯源标签不匹配：{name}",
            )
    require(set(images) == {"api", "backup", "postgres", "restore", "test"}, "实际镜像记录不完整")
    run(["nginx", "-t"])
    if rollback:
        require(
            compatible and schema_version(command) == manifest["schema_version"],
            "回退必须确认兼容，且schema与旧发布完全一致；不自动降级数据库",
        )
    # up可能因挂载/镜像变更重建PG，先停止本项目写入与调度。
    run(command + ["stop", "api", "backup"])
    run(
        command
        + ["up", "-d", "--no-build", "--no-deps", "--wait", "--wait-timeout", "120", "postgres"]
    )
    # 同项目升级前停写。迁移失败保留数据库/旧发布，绝不启动候选API。
    if not rollback:
        run(command + ["run", "--rm", "--no-deps", "migrate"])
    require(schema_version(command) == manifest["schema_version"], "迁移后版本不匹配")
    run(command + ["run", "--rm", "--no-deps", "backup-init"])
    try:
        run(
            command
            + ["up", "-d", "--no-build", "--no-deps", "--wait", "--wait-timeout", "90", "api"]
        )
        loopback_ready()
        activate(release)
    except (ValueError, OSError, subprocess.CalledProcessError):
        # --wait失败并不自动停止容器，不能让固定上游继续访问失败候选。
        run(command + ["stop", "api"])
        raise
    # Nginx站点路径不变，无需每次发布都reload共享Nginx。
    atomic_json(
        ROOT / "active-release.json",
        {
            "release_id": manifest["release_id"],
            "app_version": manifest["app_version"],
            "directory": str(release),
            "schema_version": manifest["schema_version"],
            "git_commit": manifest["git_commit"],
            "git_tree": manifest["git_tree"],
            "git_tag": manifest.get("git_tag"),
            "source_archive_sha256": manifest["source_archive_sha256"],
            "sbom_sha256": manifest["sbom_sha256"],
            "images": images,
            "activated_at": datetime.now(UTC).isoformat(),
            "scheduler": "not_started_by_deploy",
        },
    )


def build(release):
    manifest = json.loads((release / "release.json").read_text())
    verify_release_provenance(release, manifest)
    require(not (release / "images.json").exists(), "发布镜像记录已存在，禁止覆盖或重打同名标签")
    require(
        int(Path("/proc/meminfo").read_text().split("MemAvailable:")[1].split()[0])
        >= 2 * 1024 * 1024,
        "构建前可用内存必须至少2GiB",
    )
    require(
        os.statvfs(ROOT).f_bavail * os.statvfs(ROOT).f_frsize >= 8 * 1024**3,
        "构建前可用磁盘必须至少8GiB",
    )
    names = run(["docker", "buildx", "ls", "--format", "{{.Name}}"], capture=True).splitlines()
    require(BUILDER not in names, "专属builder已存在；先核对上次失败状态，不覆盖共享对象")
    tags = {name: f"{IMAGE_NAMES[name]}:{manifest['release_id']}" for name in BUILT_IMAGE_NAMES}
    existing = set(
        run(
            ["docker", "image", "ls", "--format", "{{.Repository}}:{{.Tag}}"], capture=True
        ).splitlines()
    )
    require(not existing.intersection(tags.values()), "候选镜像标签已存在，先核对失败状态")
    run(["docker", "pull", POSTGRES_IMAGE])
    run(
        [
            "docker",
            "buildx",
            "create",
            "--name",
            BUILDER,
            "--driver",
            "docker-container",
            "--driver-opt",
            f"image={BUILDKIT_IMAGE},memory=1g,cpu-period=100000,cpu-quota=100000",
        ]
    )
    label_args = []
    for key, value in expected_image_labels(manifest).items():
        label_args += ["--label", f"{key}={value}"]
    try:
        for name, dockerfile, context, target in (
            ("api", release / "backend/Dockerfile", release / "backend", None),
            ("backup", release / "infra/backup/Dockerfile", release, "backup"),
            ("restore", release / "infra/backup/Dockerfile", release, "restore"),
            ("test", release / "infra/backup/Dockerfile", release, "test"),
        ):
            command = [
                "docker",
                "buildx",
                "build",
                "--builder",
                BUILDER,
                "--load",
                "--file",
                str(dockerfile),
                "--tag",
                tags[name],
                *label_args,
            ]
            if target:
                command += ["--target", target]
            run(command + [str(context)])
        tags["postgres"] = POSTGRES_IMAGE
        records = {}
        for name, tag in tags.items():
            info = json.loads(run(["docker", "image", "inspect", tag], capture=True))[0]
            records[name] = {
                "tag": tag,
                "id": info["Id"],
                "repo_digests": info["RepoDigests"],
                "labels": (info.get("Config") or {}).get("Labels") or {},
            }
        atomic_json(release / "images.json", records)
    finally:
        run(["docker", "buildx", "stop", BUILDER])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action", choices=["plan", "build", "deploy", "backup-once", "enable-backup", "rollback"]
    )
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--schema-compatible", action="store_true")
    args = parser.parse_args()
    release = args.release.resolve()
    require(
        release.parent == ROOT / "releases"
        and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]+", release.name),
        "发布目录不合法",
    )
    manifest = json.loads((release / "release.json").read_text())
    verify_release_provenance(release, manifest)
    os.environ.update(
        RELEASE_ID=release.name, RELEASE_DIRECTORY=str(release), DEPLOYMENT_ROOT=str(ROOT)
    )
    command = compose(release)
    value = json.loads(run(command + ["config", "--format", "json"], capture=True))
    validate_config(value, release.name)
    if args.action == "plan" or not args.execute:
        print(
            json.dumps(
                {
                    "action": args.action,
                    "execute": False,
                    "project": PROJECT,
                    "release": str(release),
                    "git_commit": manifest["git_commit"],
                    "source_archive_sha256": manifest["source_archive_sha256"],
                    "sbom_sha256": manifest["sbom_sha256"],
                    "compose": command,
                },
                ensure_ascii=False,
            )
        )
        return
    require(sys.platform == "linux" and os.geteuid() == 0, "只能由app-host的root执行")
    route = json.loads(run(["ip", "-j", "-4", "route", "get", "192.0.2.10"], capture=True))[0]
    require(route["dev"] == "wg0" and route["prefsrc"] == "192.0.2.20", "不是获准的源机")
    import fcntl

    lock = (ROOT / ".deployment.lock").open("a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if args.action == "build":
        build(release)
    elif args.action in {"deploy", "rollback"}:
        deploy(
            command, release, rollback=args.action == "rollback", compatible=args.schema_compatible
        )
    else:
        require((ROOT / "current").resolve() == release, "仅允许操作当前实际发布的备份服务")
        if args.action == "backup-once":
            backup = list(value["services"]["backup"]["command"])
            index = backup.index("--at")
            del backup[index : index + 2]
            backup[0] = "backup"
            run(command + ["run", "--rm", "--no-deps", "backup"] + backup)
        else:
            # 先有当前正式库的手工成功，再持续启用同一个调度服务。
            run(
                command
                + ["run", "--rm", "--no-deps", "backup", "health", "--directory", "/backups"]
            )
            run(command + ["up", "-d", "--no-build", "--no-deps", "backup"])


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        # Docker自身错误保留；不打印配置、环境或Secret值。无自动重放/自动数据库回退。
        print(f"发布停止：{exc}；保留当前数据、发布和配置，按故障步骤核对。", file=sys.stderr)
        sys.exit(1)
