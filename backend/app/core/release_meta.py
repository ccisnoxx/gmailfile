"""发布元数据单一来源：应用版本、迁移基线、镜像坐标、源码归档摘要与 CycloneDX SBOM。

本模块仅使用 Python 标准库，确保 API 容器、备份/恢复容器与发布/部署脚本均可直接导入。
"""

from __future__ import annotations

import hashlib
import io
import os
import re
import tarfile
import tomllib
from collections.abc import Iterable
from pathlib import Path, PurePosixPath

APP_VERSION = "0.1.0"
SCHEMA_VERSION = "0008"

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

# 已交付核心能力清单：供 README、专项功能文档、OpenAPI 与 check_docs 门禁共同核验，防文档漂移。
CAPABILITY_MANIFEST: dict[str, dict[str, object]] = {
    "permanent_delete": {
        "status": "implemented",
        "openapi_paths": [
            "/api/v1/accounts/{account_id}/permanent",
            "/api/v1/accounts/batch-permanent-delete",
        ],
        "readme_required": [
            "/api/v1/accounts/{id}/permanent",
            "/api/v1/accounts/batch-permanent-delete",
        ],
        "readme_forbidden": ["不提供永久删除"],
    },
    "encrypted_export": {
        "status": "implemented",
        "openapi_paths": ["/api/v1/exports/encrypted"],
        "readme_required": ["/api/v1/exports/encrypted", "--spreadsheet-safe-copy"],
        "doc_file": "docs/csv-transfer.md",
        "doc_required": ["/api/v1/exports/encrypted", "--spreadsheet-safe-copy"],
        "doc_forbidden": ["带密码的加密导出仍属 P1"],
    },
    "recovery_email_accounts_query": {
        "status": "implemented",
        "openapi_paths": ["/api/v1/recovery-email-accounts"],
        "forbidden_openapi_paths": ["/api/v1/recovery-emails/{encoded_email}/accounts"],
        "readme_required": ["/api/v1/recovery-email-accounts"],
        "readme_forbidden": ["/api/v1/recovery-emails/{encoded_email}/accounts"],
    },
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


RELEASE_METADATA_FILES: frozenset[str] = frozenset(
    {
        "release.json",
        "sbom.cdx.json",
        "release.attestation.json",
        "images.json",
        "images.attestation.json",
    }
)


def normalize_release_file_list(declared_files: object) -> list[str]:
    """校验并规范化发布清单中的相对文件路径集合，拒绝缺失、空集合、重复、越界与元数据同名项。"""
    if not isinstance(declared_files, list) or not declared_files:
        raise ValueError("发布文件清单缺失或为空")
    seen: set[str] = set()
    normalized: list[str] = []
    for item in declared_files:
        if not isinstance(item, str) or not item or item != item.strip():
            raise ValueError("发布文件清单包含非法文件名")
        if "\x00" in item or "\\" in item or item.startswith("/"):
            raise ValueError(f"发布文件清单包含非法路径：{item}")
        parts = PurePosixPath(item).parts
        if not parts or any(part in {"", ".", ".."} for part in parts):
            raise ValueError(f"发布文件清单包含越界或非规范路径：{item}")
        canonical = "/".join(parts)
        if canonical != item:
            raise ValueError(f"发布文件清单路径未规范化：{item}")
        if canonical in RELEASE_METADATA_FILES:
            raise ValueError(f"发布文件清单不得包含部署元数据文件：{canonical}")
        if canonical in seen:
            raise ValueError(f"发布文件清单包含重复路径：{canonical}")
        seen.add(canonical)
        normalized.append(canonical)
    return sorted(normalized)


def release_files_sha256(declared_files: object) -> tuple[str, int]:
    """计算规范化文件清单自身的 SHA-256 摘要与条目数，供发布签名证明绑定。"""
    normalized = normalize_release_file_list(declared_files)
    digest = hashlib.sha256("\n".join(normalized).encode("utf-8")).hexdigest()
    return digest, len(normalized)


def verify_release_tree_files(root: Path, declared_files: object) -> list[str]:
    """核对发布目录中的实际普通文件全集与清单声明严格一致，阻断缺失清单、未列举文件注入或符号链接。"""
    expected = normalize_release_file_list(declared_files)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("发布目录不存在或为符号链接")
    actual: list[str] = []
    for current_dir, dirnames, filenames in os.walk(root, followlinks=False):
        current_path = Path(current_dir)
        for dirname in dirnames:
            if (current_path / dirname).is_symlink():
                raise ValueError(f"发布目录包含非法目录符号链接：{dirname}")
        for filename in filenames:
            candidate = current_path / filename
            if candidate.is_symlink() or not candidate.is_file():
                raise ValueError(f"发布目录包含非常规文件或符号链接：{filename}")
            rel = candidate.relative_to(root).as_posix()
            if rel in RELEASE_METADATA_FILES:
                continue
            actual.append(rel)
    actual_sorted = sorted(actual)
    if actual_sorted != expected:
        raise ValueError("发布目录实际文件集合与发布清单不一致")
    return expected


def canonical_source_archive_sha256(root: Path, relative_files: Iterable[str]) -> str:
    """对白名单源码文件流式构建确定性 USTAR 归档并返回 SHA-256（不落盘临时文件）。"""
    normalized = normalize_release_file_list(list(relative_files))
    if root.is_symlink() or not root.is_dir():
        raise ValueError("发布源码根目录不存在或为符号链接")
    resolved_root = root.resolve()
    hasher = hashlib.sha256()
    sink = _HashStream(hasher)
    with tarfile.open(fileobj=sink, mode="w|", format=tarfile.USTAR_FORMAT) as archive:
        for rel in normalized:
            cursor = root
            for part in PurePosixPath(rel).parts[:-1]:
                cursor = cursor / part
                if cursor.is_symlink():
                    raise ValueError(f"源码路径包含符号链接目录：{rel}")
            path = root / rel
            if path.is_symlink() or not path.is_file():
                raise ValueError(f"源码白名单文件缺失或非法：{rel}")
            if not path.resolve().is_relative_to(resolved_root):
                raise ValueError(f"源码文件路径越界：{rel}")
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
