"""打包不含 Secret 的发布源、确定性 SBOM 与 Git 溯源清单，并记录锁文件完整性。"""

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tarfile
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.core.release_attestation import (  # noqa: E402
    ARCHIVE_ATTESTATION_KIND,
    SOURCE_ATTESTATION_KIND,
    build_archive_attestation_payload,
    build_source_attestation_payload,
    collect_build_tool_versions,
    load_gate_report,
    sign_attestation,
)
from app.core.release_meta import (  # noqa: E402
    APP_VERSION,
    BASE_IMAGES,
    canonical_source_archive_sha256,
    generate_cyclonedx_sbom,
    normalize_tar_member,
    release_images,
    resolve_schema_version,
)

ROOT_FILES = [
    "README.md",
    "LICENSE",
    "SECURITY.md",
    "CHANGELOG.md",
    "Makefile",
    ".env.example",
    ".dockerignore",
    ".gitignore",
    ".node-version",
    "gmail-account-manager-spec.md",
]
TREES = [
    "backend/app",
    "backend/alembic",
    "backend/tests",
    "frontend/src",
    "frontend/public",
    "frontend/dist",
    "infra",
    "scripts",
    "docs",
]
FILES = [
    "backend/Dockerfile",
    "backend/pyproject.toml",
    "backend/uv.lock",
    "backend/alembic.ini",
    "frontend/package.json",
    "frontend/pnpm-lock.yaml",
    "frontend/pnpm-workspace.yaml",
    "frontend/index.html",
    "frontend/tsconfig.json",
    "frontend/vite.config.ts",
    "frontend/openapi-ts.config.ts",
    "frontend/components.json",
]


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def public_source_member(info: tarfile.TarInfo) -> tarfile.TarInfo:
    # 开发机可能使用 umask 077；发布白名单不含 Secret，静态文件须让宿主 Nginx 可读。
    return normalize_tar_member(info, deterministic_mtime=False)


def _git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *args],
        check=True,
        text=True,
        capture_output=True,
    )
    return result.stdout.strip()


def git_provenance(root: Path) -> dict[str, object]:
    """从当前 Git 仓库读取真实提交、树对象、标签、签名与工作区洁净度。"""
    try:
        commit = _git(root, "rev-parse", "--verify", "HEAD")
        tree = _git(root, "rev-parse", "--verify", "HEAD^{tree}")
        tags_raw = _git(root, "tag", "--points-at", "HEAD", "--sort=-creatordate")
        status = _git(root, "status", "--porcelain", "--untracked-files=normal")
    except (OSError, subprocess.CalledProcessError) as exc:
        raise ValueError("发布目录必须是包含有效提交的 Git 仓库") from exc
    if not re.fullmatch(r"[0-9a-f]{40}", commit) or not re.fullmatch(r"[0-9a-f]{40}", tree):
        raise ValueError("无法解析有效的 Git commit 或 tree 摘要")
    tags = [line.strip() for line in tags_raw.splitlines() if line.strip()]
    tag = tags[0] if tags else None
    tag_has_signature_block = False
    tag_verified = False
    if tag is not None:
        try:
            if _git(root, "cat-file", "-t", f"refs/tags/{tag}") == "tag":
                tag_object = _git(root, "cat-file", "-p", f"refs/tags/{tag}")
                tag_has_signature_block = (
                    "-----BEGIN PGP SIGNATURE-----" in tag_object
                    or "-----BEGIN SSH SIGNATURE-----" in tag_object
                )
                if tag_has_signature_block:
                    verify_proc = subprocess.run(
                        ["git", "-C", str(root), "verify-tag", tag],
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    tag_verified = verify_proc.returncode == 0
        except (OSError, subprocess.CalledProcessError):
            tag_has_signature_block = False
            tag_verified = False
    return {
        "git_commit": commit,
        "git_tree": tree,
        "git_tag": tag,
        "git_tag_has_signature_block": tag_has_signature_block,
        "git_tag_verified": tag_verified,
        "git_tag_signed": tag_verified,
        "working_tree_clean": status == "",
    }


def package(
    release_id: str,
    directory: Path,
    *,
    allow_dirty: bool = False,
    signing_key: Path | None = None,
    audit_public_key: Path | None = None,
    gate_report: Path | None = None,
) -> dict:
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]+", release_id):
        raise ValueError("发布ID只能包含字母、数字、点和连字符")
    if not (ROOT / "frontend/dist/index.html").is_file():
        raise ValueError("先以锁文件执行前端生产构建")
    provenance = git_provenance(ROOT)
    if not provenance["working_tree_clean"] and not allow_dirty:
        raise ValueError("工作区存在未提交改动；请先提交，或仅在非正式构建显式传入 --allow-dirty")

    gate_results = load_gate_report(gate_report) if gate_report is not None else []
    build_tools = collect_build_tool_versions()

    files = {ROOT / name for name in ROOT_FILES + FILES}
    for tree in TREES:
        base = ROOT / tree
        if base.exists():
            files.update(path for path in base.rglob("*") if path.is_file())
    files = {
        p
        for p in files
        if not {"__pycache__", ".pytest_cache", ".ruff_cache"}.intersection(p.parts)
        and p.suffix not in {".pyc", ".log"}
    }
    for path in files:
        if path.is_symlink() or not path.is_file():
            raise ValueError("发布只能包含白名单普通文件")
        if re.search(
            rb"AGE-SECRET-KEY-1[0-9A-Z]{50,}|-----BEGIN [A-Z ]*PRIVATE KEY-----", path.read_bytes()
        ):
            raise ValueError("发布文件含私钥格式，停止打包")

    relative_files = sorted(str(p.relative_to(ROOT)) for p in files)
    source_archive_sha256 = canonical_source_archive_sha256(ROOT, relative_files)
    schema_version = resolve_schema_version(ROOT / "backend/alembic/versions")

    directory.mkdir(parents=True, exist_ok=True)
    sbom_document = generate_cyclonedx_sbom(
        ROOT,
        release_id=release_id,
        app_version=APP_VERSION,
        git_commit=str(provenance["git_commit"]),
    )
    sbom_path = directory / f"{release_id}.sbom.json"
    with sbom_path.open("x", encoding="utf-8") as output:
        json.dump(sbom_document, output, ensure_ascii=False, indent=2, sort_keys=True)
        output.write("\n")
    sbom_sha256 = digest(sbom_path)

    manifest = {
        "release_id": release_id,
        "app_version": APP_VERSION,
        "schema_version": schema_version,
        "created_at": datetime.now(UTC).isoformat(),
        **provenance,
        "source_archive_sha256": source_archive_sha256,
        "sbom_sha256": sbom_sha256,
        "base_images": dict(BASE_IMAGES),
        "locks": {
            name: digest(ROOT / name) for name in ("backend/uv.lock", "frontend/pnpm-lock.yaml")
        },
        "images": release_images(release_id),
        "gate_results": gate_results,
        "build_tools": build_tools,
        "files": relative_files,
    }
    metadata = directory / f"{release_id}.json"
    with metadata.open("x", encoding="utf-8") as output:
        json.dump(manifest, output, ensure_ascii=False, indent=2)
        output.write("\n")

    source_attestation_path: Path | None = None
    signing_key_bytes: bytes | None = None
    audit_key_bytes: bytes | None = (
        audit_public_key.read_bytes() if audit_public_key is not None else None
    )
    if signing_key is not None:
        signing_key_bytes = signing_key.read_bytes()
        source_att = sign_attestation(
            SOURCE_ATTESTATION_KIND,
            build_source_attestation_payload(
                manifest, gate_results=gate_results, build_tools=build_tools
            ),
            signing_key_bytes,
            audit_key_pem=audit_key_bytes,
        )
        source_attestation_path = directory / f"{release_id}.attestation.json"
        with source_attestation_path.open("x", encoding="utf-8") as output:
            json.dump(source_att, output, ensure_ascii=False, indent=2)
            output.write("\n")

    archive = directory / f"{release_id}.tar.gz"
    with tarfile.open(archive, "x:gz") as output:
        for path in sorted(files):
            output.add(
                path,
                arcname=str(path.relative_to(ROOT)),
                recursive=False,
                filter=public_source_member,
            )
        output.add(sbom_path, arcname="sbom.cdx.json", recursive=False, filter=public_source_member)
        output.add(metadata, arcname="release.json", recursive=False, filter=public_source_member)
        if source_attestation_path is not None:
            output.add(
                source_attestation_path,
                arcname="release.attestation.json",
                recursive=False,
                filter=public_source_member,
            )
    archive_sha256 = digest(archive)
    (directory / f"{release_id}.tar.gz.sha256").write_text(f"{archive_sha256}  {archive.name}\n")

    archive_attestation_path: Path | None = None
    if signing_key_bytes is not None:
        archive_att = sign_attestation(
            ARCHIVE_ATTESTATION_KIND,
            build_archive_attestation_payload(
                manifest, archive_name=archive.name, archive_sha256=archive_sha256
            ),
            signing_key_bytes,
            audit_key_pem=audit_key_bytes,
        )
        archive_attestation_path = directory / f"{release_id}.tar.gz.attestation.json"
        with archive_attestation_path.open("x", encoding="utf-8") as output:
            json.dump(archive_att, output, ensure_ascii=False, indent=2)
            output.write("\n")

    summary: dict[str, object] = {
        "archive": str(archive),
        "archive_sha256": archive_sha256,
        "manifest": str(metadata),
        "sbom": str(sbom_path),
        "release_id": release_id,
        "git_commit": provenance["git_commit"],
        "source_archive_sha256": source_archive_sha256,
        "sbom_sha256": sbom_sha256,
        "signed": source_attestation_path is not None,
    }
    if source_attestation_path is not None:
        summary["attestation"] = str(source_attestation_path)
    if archive_attestation_path is not None:
        summary["archive_attestation"] = str(archive_attestation_path)
    print(json.dumps(summary, ensure_ascii=False))
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument(
        "--signing-key",
        type=Path,
        default=None,
        help="独立 Ed25519 发布签名私钥 PEM 路径（须与审计检查点密钥分离）",
    )
    parser.add_argument(
        "--audit-public-key",
        type=Path,
        default=None,
        help="可选审计检查点公钥/私钥路径，用于强制校验发布密钥与审计密钥分离",
    )
    parser.add_argument(
        "--gate-report",
        type=Path,
        default=None,
        help="可选 check-release-gates.py --json 输出文件，写入发布签名证明并要求全部 PASS",
    )
    parser.add_argument(
        "--allow-unsigned",
        action="store_true",
        help="仅限本地非正式调试允许跳过发布签名（生产部署会拒绝无签名发布包）",
    )
    parser.add_argument(
        "--allow-dirty",
        action="store_true",
        help="允许在工作区未提交时打包（仅限本地验证；生产部署会拒绝 dirty 清单）",
    )
    args = parser.parse_args()
    if args.signing_key is None and not args.allow_unsigned:
        parser.error(
            "正式打包必须提供 --signing-key（独立 Ed25519 发布私钥），"
            "或仅本地调试使用 --allow-unsigned"
        )
    package(
        args.release_id,
        args.directory.resolve(),
        allow_dirty=args.allow_dirty,
        signing_key=args.signing_key.resolve() if args.signing_key else None,
        audit_public_key=args.audit_public_key.resolve() if args.audit_public_key else None,
        gate_report=args.gate_report.resolve() if args.gate_report else None,
    )
