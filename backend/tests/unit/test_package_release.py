import hashlib
import importlib.util
import json
import subprocess
import tarfile
import tomllib
from pathlib import Path

import pytest

from app.core.release_meta import (
    APP_VERSION,
    BASE_IMAGES,
    POSTGRES_IMAGE,
    PYTHON_BASE_IMAGE,
    SCHEMA_VERSION,
    canonical_source_archive_sha256,
    resolve_schema_version,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "gm_package", REPO_ROOT / "scripts/package-release.py"
)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def _init_git_repo(source: Path, *, tag: str | None = None) -> tuple[str, str]:
    subprocess.run(["git", "-C", str(source), "init", "-q"], check=True)
    subprocess.run(
        ["git", "-C", str(source), "config", "user.email", "release@example.test"], check=True
    )
    subprocess.run(["git", "-C", str(source), "config", "user.name", "Release Bot"], check=True)
    subprocess.run(["git", "-C", str(source), "add", "-A"], check=True)
    subprocess.run(
        ["git", "-C", str(source), "commit", "-q", "-m", "synthetic baseline"], check=True
    )
    if tag:
        subprocess.run(
            ["git", "-C", str(source), "tag", "-a", tag, "-m", f"release {tag}"], check=True
        )
    commit = subprocess.run(
        ["git", "-C", str(source), "rev-parse", "HEAD"],
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()
    tree = subprocess.run(
        ["git", "-C", str(source), "rev-parse", "HEAD^{tree}"],
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()
    return commit, tree


def _populate_synthetic_source(source: Path) -> None:
    for name in module.ROOT_FILES + module.FILES + ["frontend/dist/index.html"]:
        p = source / name
        p.parent.mkdir(parents=True, exist_ok=True)
        if name == "backend/uv.lock":
            p.write_text('version = 1\n\n[[package]]\nname = "fastapi"\nversion = "0.165.0"\n')
        elif name == "frontend/pnpm-lock.yaml":
            p.write_text(
                "lockfileVersion: '9.0'\n\npackages:\n  react@19.3.1:\n    resolution: {}\n"
            )
        else:
            p.write_text("synthetic release file")
        p.chmod(0o600)
    migration = source / "backend/alembic/versions/0004_synthetic.py"
    migration.parent.mkdir(parents=True, exist_ok=True)
    migration.write_text('revision = "0004"\ndown_revision = "0003"\n')
    prev_migration = source / "backend/alembic/versions/0003_prev.py"
    prev_migration.write_text('revision = "0003"\ndown_revision = None\n')


def test_release_excludes_private_data_preserves_modes_and_records_provenance(
    tmp_path, monkeypatch
):
    source = tmp_path / "source"
    _populate_synthetic_source(source)
    commit, tree = _init_git_repo(source, tag="v0.1.0-rc1")
    # 未跟踪的私有/Secret目录必须加入 .gitignore，确保仓库本身干净且打包白名单排除它们。
    (source / ".gitignore").write_text(".local/\nsecrets/\n")
    subprocess.run(["git", "-C", str(source), "add", ".gitignore"], check=True)
    subprocess.run(
        ["git", "-C", str(source), "commit", "-q", "-m", "ignore private dirs"], check=True
    )
    subprocess.run(
        ["git", "-C", str(source), "tag", "-f", "-a", "v0.1.0-rc1", "-m", "release tag"],
        check=True,
    )
    commit = subprocess.run(
        ["git", "-C", str(source), "rev-parse", "HEAD"],
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()
    tree = subprocess.run(
        ["git", "-C", str(source), "rev-parse", "HEAD^{tree}"],
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()

    monkeypatch.setattr(module, "ROOT", source)
    private = source / ".local/private-ops/production.env"
    private.parent.mkdir(parents=True)
    private.write_text("synthetic private deployment data")
    secret = source / "secrets/backup_ssh_identity"
    secret.parent.mkdir()
    secret.write_text("synthetic private identity")

    out = tmp_path / "output"
    manifest = module.package("synthetic-release", out)
    assert manifest["app_version"] == APP_VERSION
    assert manifest["schema_version"] == "0004"
    assert manifest["git_commit"] == commit
    assert manifest["git_tree"] == tree
    assert manifest["git_tag"] == "v0.1.0-rc1"
    assert manifest["working_tree_clean"] is True
    assert manifest["base_images"] == BASE_IMAGES
    assert manifest["images"]["postgres"] == POSTGRES_IMAGE
    assert manifest["source_archive_sha256"] == canonical_source_archive_sha256(
        source, manifest["files"]
    )
    sbom_bytes = (out / "synthetic-release.sbom.json").read_bytes()
    assert manifest["sbom_sha256"] == hashlib.sha256(sbom_bytes).hexdigest()
    sbom = json.loads(sbom_bytes)
    assert sbom["bomFormat"] == "CycloneDX"
    names = {c["name"] for c in sbom["components"]}
    assert {"fastapi", "react", "python", "postgres"} <= names

    with tarfile.open(out / "synthetic-release.tar.gz") as archive:
        assert archive.getmember("frontend/dist/index.html").mode == 0o644
        assert archive.getmember("release.json").mode == 0o644
        assert archive.getmember("sbom.cdx.json").mode == 0o644
        assert all(p.isreg() and p.uid == 0 and p.gid == 0 for p in archive.getmembers())
        assert not any(name.startswith((".local/", "secrets/")) for name in archive.getnames())


def test_release_rejects_dirty_working_tree_unless_explicitly_allowed(tmp_path, monkeypatch):
    source = tmp_path / "source"
    _populate_synthetic_source(source)
    _init_git_repo(source)
    (source / "README.md").write_text("dirty change")
    monkeypatch.setattr(module, "ROOT", source)
    out = tmp_path / "output"
    with pytest.raises(ValueError, match="未提交改动"):
        module.package("dirty-release", out)
    manifest = module.package("dirty-release", out, allow_dirty=True)
    assert manifest["working_tree_clean"] is False


def test_single_source_of_truth_matches_repo_configs_and_pinned_digests():
    pyproject = tomllib.loads((REPO_ROOT / "backend/pyproject.toml").read_text(encoding="utf-8"))
    package_json = json.loads((REPO_ROOT / "frontend/package.json").read_text(encoding="utf-8"))
    assert pyproject["project"]["version"] == APP_VERSION
    assert package_json["version"] == APP_VERSION
    assert resolve_schema_version(REPO_ROOT / "backend/alembic/versions") == SCHEMA_VERSION
    for ref in BASE_IMAGES.values():
        assert "@sha256:" in ref
    assert PYTHON_BASE_IMAGE in (REPO_ROOT / "backend/Dockerfile").read_text(encoding="utf-8")
    backup_dockerfile = (REPO_ROOT / "infra/backup/Dockerfile").read_text(encoding="utf-8")
    assert PYTHON_BASE_IMAGE in backup_dockerfile
    assert POSTGRES_IMAGE in backup_dockerfile
    assert POSTGRES_IMAGE in (REPO_ROOT / "infra/docker-compose.yml").read_text(encoding="utf-8")
    assert POSTGRES_IMAGE in (REPO_ROOT / "infra/docker-compose.regression.yml").read_text(
        encoding="utf-8"
    )
