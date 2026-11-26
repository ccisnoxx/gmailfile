"""发布元数据单一来源：应用版本、迁移基线、镜像坐标、源码归档摘要与 CycloneDX SBOM。

本模块仅使用 Python 标准库，确保 API 容器、备份/恢复容器与发布/部署脚本均可直接导入。
"""

from __future__ import annotations

import hashlib
import io
import re
import tarfile
import tomllib
from collections.abc import Iterable
from pathlib import Path

APP_VERSION = "0.1.0"
SCHEMA_VERSION = "0005"

IMAGE_NAMES: dict[str, str] = {
    "api": "gmail-manager-api",
    "backup": "gmail-manager-backup",
    "restore": "gmail-manager-restore",
    "test": "gmail-manager-test",
}

PYTHON_BASE_IMAGE = (
    "python:3.12.13-slim-bookworm"
    "@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2"
)
POSTGRES_IMAGE = (
    "postgres:18.7-bookworm@sha256:e742a2668255221388004f3a42b6150a2103f5054ab3a4a93ae9e4f01e551c35"
)
BUILDKIT_IMAGE = (
    "moby/buildkit:v0.29.0@sha256:0039c1d47e8748b5afea56f4e85f14febaf34452bd99d9552d2daa82262b5cc5"
)

BASE_IMAGES: dict[str, str] = {
    "python": PYTHON_BASE_IMAGE,
    "postgres": POSTGRES_IMAGE,
    "buildkit": BUILDKIT_IMAGE,
}

PROVENANCE_LABEL_KEYS: dict[str, str] = {
    "app_version": "org.opencontainers.image.version",
    "git_commit": "org.opencontainers.image.revision",
    "release_id": "io.gmailmanager.release-id",
    "git_tree": "io.gmailmanager.git-tree",
    "source_archive_sha256": "io.gmailmanager.source-archive-sha256",
    "sbom_sha256": "io.gmailmanager.sbom-sha256",
}

_REVISION_RE = re.compile(r'^\s*revision(?:\s*:\s*[^=]+)?\s*=\s*["\']([^"\']+)["\']', re.M)
_DOWN_REVISION_RE = re.compile(
    r'^\s*down_revision(?:\s*:\s*[^=]+)?\s*=\s*(None|["\']([^"\']+)["\'])', re.M
)
_PNPM_PKG_LINE_RE = re.compile(r"^  (['\"]?)(.+?)\1:\s*$")


def release_images(release_id: str) -> dict[str, str]:
    return {
        **{name: f"{repo}:{release_id}" for name, repo in IMAGE_NAMES.items()},
        "postgres": POSTGRES_IMAGE,
    }


def resolve_schema_version(alembic_versions_dir: Path) -> str:
    """仅用标准库从 Alembic 迁移脚本解析唯一 head 版本号。"""
    if not alembic_versions_dir.is_dir():
        return SCHEMA_VERSION
    revisions: set[str] = set()
    parents: set[str] = set()
    for path in sorted(alembic_versions_dir.glob("*.py")):
        if path.name == "__init__.py":
            continue
        source = path.read_text(encoding="utf-8")
        rev_match = _REVISION_RE.search(source)
        if not rev_match:
            continue
        revisions.add(rev_match.group(1))
        down_match = _DOWN_REVISION_RE.search(source)
        if down_match and down_match.group(2):
            parents.add(down_match.group(2))
    if not revisions:
        return SCHEMA_VERSION
    heads = sorted(revisions - parents)
    if len(heads) != 1:
        raise ValueError(f"Alembic 迁移必须存在唯一 head，当前发现：{heads}")
    return heads[0]


def normalize_tar_member(
    info: tarfile.TarInfo, *, deterministic_mtime: bool = False
) -> tarfile.TarInfo:
    """规范化归档成员权限与属主；启用 deterministic_mtime 时保证可复现摘要。"""
    info.mode = 0o755 if info.mode & 0o111 else 0o644
    info.uid = info.gid = 0
    info.uname = info.gname = "root"
    if deterministic_mtime:
        info.mtime = 0
    return info


class _HashStream(io.RawIOBase):
    def __init__(self, hasher: hashlib._Hash):
        self._hasher = hasher

    def writable(self) -> bool:
        return True

    def write(self, data: bytes | bytearray | memoryview) -> int:
        self._hasher.update(data)
        return len(data)


def canonical_source_archive_sha256(root: Path, relative_files: Iterable[str]) -> str:
    """对白名单源码文件流式构建确定性 USTAR 归档并返回 SHA-256（不落盘临时文件）。"""
    hasher = hashlib.sha256()
    sink = _HashStream(hasher)
    with tarfile.open(fileobj=sink, mode="w|", format=tarfile.USTAR_FORMAT) as archive:
        for rel in sorted(relative_files):
            path = root / rel
            if path.is_symlink() or not path.is_file():
                raise ValueError(f"源码白名单文件缺失或非法：{rel}")
            info = archive.gettarinfo(str(path), arcname=rel)
            normalize_tar_member(info, deterministic_mtime=True)
            with path.open("rb") as source:
                archive.addfile(info, source)
    return hasher.hexdigest()


def _parse_uv_lock_components(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        return []
    raw = path.read_bytes()
    try:
        data = tomllib.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, tomllib.TOMLDecodeError):
        return []
    components: list[dict[str, str]] = []
    for pkg in data.get("package", []):
        name = pkg.get("name")
        version = pkg.get("version")
        if isinstance(name, str) and isinstance(version, str):
            components.append(
                {
                    "type": "library",
                    "name": name,
                    "version": version,
                    "purl": f"pkg:pypi/{name}@{version}",
                }
            )
    return components


def _parse_pnpm_lock_components(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        return []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except UnicodeDecodeError:
        return []
    components: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    in_packages = False
    for line in lines:
        if not line.startswith(" ") and line.strip():
            in_packages = line.strip() == "packages:"
            continue
        if not in_packages:
            continue
        match = _PNPM_PKG_LINE_RE.match(line)
        if not match:
            continue
        spec = match.group(2).split("(", 1)[0]
        if "@" not in spec.lstrip("@"):
            continue
        name, version = spec.rsplit("@", 1)
        if not name or not version or (name, version) in seen:
            continue
        seen.add((name, version))
        encoded_name = name.replace("@", "%40") if name.startswith("@") else name
        components.append(
            {
                "type": "library",
                "name": name,
                "version": version,
                "purl": f"pkg:npm/{encoded_name}@{version}",
            }
        )
    return components


def _base_image_components() -> list[dict[str, str]]:
    components: list[dict[str, str]] = []
    for key in sorted(BASE_IMAGES):
        ref = BASE_IMAGES[key]
        name_tag, _, digest = ref.partition("@")
        repo, _, tag = name_tag.partition(":")
        components.append(
            {
                "type": "container",
                "name": repo,
                "version": f"{tag}@{digest}" if digest else tag,
                "purl": f"pkg:oci/{repo.split('/')[-1]}@{digest}"
                if digest
                else f"pkg:oci/{repo}:{tag}",
            }
        )
    return components


def generate_cyclonedx_sbom(
    root: Path,
    *,
    release_id: str,
    app_version: str = APP_VERSION,
    git_commit: str | None = None,
) -> dict:
    """生成确定性的 CycloneDX 1.5 JSON SBOM，覆盖 Python/Node 锁文件与固定摘要基础镜像。"""
    components = (
        _parse_uv_lock_components(root / "backend/uv.lock")
        + _parse_pnpm_lock_components(root / "frontend/pnpm-lock.yaml")
        + _base_image_components()
    )
    components.sort(key=lambda item: (item["type"], item["name"], item["version"]))
    properties = [{"name": "gmail-manager:release-id", "value": release_id}]
    if git_commit:
        properties.append({"name": "gmail-manager:git-commit", "value": git_commit})
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "version": 1,
        "metadata": {
            "component": {
                "type": "application",
                "name": "gmail-account-manager",
                "version": app_version,
                "properties": properties,
            }
        },
        "components": components,
    }
