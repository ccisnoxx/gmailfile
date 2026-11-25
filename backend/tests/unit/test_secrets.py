import importlib.util
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "generate_secrets", Path(__file__).resolve().parents[3] / "scripts/generate-secrets.py"
)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def test_generation_is_private_and_never_overwrites(tmp_path, capsys):
    target = tmp_path / "secrets"
    module.generate(target)
    assert target.stat().st_mode & 0o777 == 0o700
    key = (target / "data_key_v1").read_bytes()
    assert len(key) == 32
    assert len(list(target.iterdir())) == 6
    assert (target / "db_audit_password").is_file()
    assert capsys.readouterr().out == ""
    with pytest.raises(FileExistsError):
        module.generate(target)
    assert (target / "data_key_v1").read_bytes() == key


def test_insecure_directory_rejected(tmp_path):
    tmp_path.chmod(0o755)
    with pytest.raises(ValueError, match="0700"):
        module.generate(tmp_path)


def test_backup_only_upgrade_preserves_existing_data_key(tmp_path):
    target = tmp_path / "existing"
    target.mkdir(mode=0o700)
    original = b"x" * 32
    (target / "data_key_v1").write_bytes(original)
    module.generate(target, backup_only=True)
    assert (target / "data_key_v1").read_bytes() == original
    assert set(p.name for p in target.iterdir()) == {"data_key_v1", "db_backup_password"}


def test_audit_only_upgrade_preserves_existing_data_key(tmp_path):
    target = tmp_path / "existing-audit"
    target.mkdir(mode=0o700)
    original = b"y" * 32
    (target / "data_key_v1").write_bytes(original)
    module.generate(target, audit_only=True)
    assert (target / "data_key_v1").read_bytes() == original
    assert set(p.name for p in target.iterdir()) == {"data_key_v1", "db_audit_password"}
