import pytest
from pydantic import ValidationError

from app.core.config import Settings


@pytest.mark.parametrize(
    "overrides",
    [
        {"totp_required": False},
        {"step_up_totp_required": False},
        {"debug": True},
        {"expose_api_docs": True},
        {"app_base_url": "http://accounts.example.com"},
        {"allowed_hosts": "*"},
        {"cors_origins": "*"},
        {"reauth_window_minutes": 6},
        {"default_page_size": 50, "max_page_size": 30},
        {"audit_syslog_address": "http://invalid-scheme"},
    ],
)
def test_production_rejects_unsafe_config(overrides):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **overrides)


def test_safe_production_defaults():
    settings = Settings(_env_file=None)
    assert settings.app_env == "production"
    assert settings.totp_required and settings.step_up_totp_required
    assert settings.audit_retention_days == 365
    assert not settings.debug and not settings.expose_api_docs


def test_instance_domain_overrides_public_example(monkeypatch):
    monkeypatch.setenv("APP_BASE_URL", "https://vault.example.net")
    monkeypatch.setenv("ALLOWED_HOSTS", "vault.example.net")
    settings = Settings(_env_file=None)
    assert settings.app_base_url == "https://vault.example.net"
    assert settings.hosts == ["vault.example.net"]


def test_invalid_data_key_rejected(settings):
    (settings.data_key_directory / "data_key_v1").write_bytes(b"invalid")
    with pytest.raises(ValueError, match="32"):
        settings.validate_secret_files()


def test_missing_password_denylist_file_rejected(settings, tmp_path):
    settings.password_denylist_file = tmp_path / "does-not-exist.txt"
    with pytest.raises(ValueError, match="密码黑名单"):
        settings.validate_secret_files()
    settings.password_denylist_file.write_text("weakpassword123456\n", encoding="utf-8")
    settings.validate_secret_files()
