"""打包不含Secret的发布源与本机已构建静态文件，并记录锁文件完整性。"""

import argparse
import hashlib
import json
import re
import tarfile
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = [
    "README.md",
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


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def public_source_member(info):
    # 开发机可能使用umask077；发布白名单不含Secret，静态文件须让宿主Nginx可读。
    info.mode = 0o755 if info.mode & 0o111 else 0o644
    info.uid = info.gid = 0
    info.uname = info.gname = "root"
    return info


def package(release_id, directory):
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]+", release_id):
        raise ValueError("发布ID只能包含字母、数字、点和连字符")
    if not (ROOT / "frontend/dist/index.html").is_file():
        raise ValueError("先以锁文件执行前端生产构建")
    files = {ROOT / name for name in ROOT_FILES + FILES}
    for tree in TREES:
        files.update(path for path in (ROOT / tree).rglob("*") if path.is_file())
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
    directory.mkdir(parents=True, exist_ok=True)
    manifest = {
        "release_id": release_id,
        "app_version": "0.1.0",
        "schema_version": "0003",
        "created_at": datetime.now(UTC).isoformat(),
        "source_baseline": "workspace snapshot; repository has no commit yet",
        "locks": {
            name: digest(ROOT / name) for name in ("backend/uv.lock", "frontend/pnpm-lock.yaml")
        },
        "images": {
            "api": f"gmail-manager-api:{release_id}",
            "backup": f"gmail-manager-backup:{release_id}",
            "restore": f"gmail-manager-restore:{release_id}",
            "test": f"gmail-manager-test:{release_id}",
            "postgres": "postgres:18.7-bookworm",
        },
        "files": sorted(str(p.relative_to(ROOT)) for p in files),
    }
    metadata = directory / f"{release_id}.json"
    with metadata.open("x") as output:
        json.dump(manifest, output, ensure_ascii=False, indent=2)
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
        output.add(metadata, arcname="release.json", recursive=False, filter=public_source_member)
    (directory / f"{release_id}.tar.gz.sha256").write_text(f"{digest(archive)}  {archive.name}\n")
    print(
        json.dumps(
            {"archive": str(archive), "manifest": str(metadata), "release_id": release_id},
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    package(args.release_id, args.directory.resolve())
