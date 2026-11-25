import importlib.util
import tarfile
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "gm_package", Path(__file__).resolve().parents[3] / "scripts/package-release.py"
)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def test_release_excludes_private_data_and_preserves_public_modes(tmp_path, monkeypatch):
    source = tmp_path / "source"
    for name in module.ROOT_FILES + module.FILES + ["frontend/dist/index.html"]:
        p = source / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("synthetic release file")
        p.chmod(0o600)
    monkeypatch.setattr(module, "ROOT", source)
    private = source / ".local/private-ops/production.env"
    private.parent.mkdir(parents=True)
    private.write_text("synthetic private deployment data")
    secret = source / "secrets/backup_ssh_identity"
    secret.parent.mkdir()
    secret.write_text("synthetic private identity")
    out = tmp_path / "output"
    module.package("synthetic-release", out)
    with tarfile.open(out / "synthetic-release.tar.gz") as archive:
        assert archive.getmember("frontend/dist/index.html").mode == 0o644
        assert archive.getmember("release.json").mode == 0o644
        assert all(p.isreg() and p.uid == 0 and p.gid == 0 for p in archive.getmembers())
        assert not any(name.startswith((".local/", "secrets/")) for name in archive.getnames())
