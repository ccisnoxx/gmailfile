from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT / ".env", extra="ignore", hide_input_in_errors=True
    )

    app_env: Literal["development", "test", "production"] = "production"
    app_name: str = "Gmail Account Manager"
    app_base_url: str = "https://accounts.example.com"
    allowed_hosts: str = "accounts.example.com"
    cors_origins: str = ""
    debug: bool = False
    expose_api_docs: bool = False
    totp_required: bool = True
    step_up_totp_required: bool = True
    session_cookie_secure: bool = True
    session_idle_minutes: int = Field(default=15, ge=1, le=720)
    session_absolute_hours: int = Field(default=12, ge=1, le=168)
    reauth_window_minutes: int = Field(default=5, ge=1, le=5)
    active_data_key_version: int = Field(default=1, ge=1, le=32767)
    data_key_directory: Path = Path("/run/secrets")
    database_host: str = "postgres"
    database_port: int = Field(default=5432, ge=1, le=65535)
    database_name: str = "gmail_manager"
    database_user: str = "gm_app"
    database_password_file: Path = Path("/run/secrets/db_password")
    default_page_size: int = Field(default=30, ge=1, le=100)
    max_page_size: int = Field(default=100, ge=1, le=100)
    backup_status_file: Path | None = None
    max_import_size_mb: int = Field(default=10, ge=1, le=10)
    audit_syslog_address: str = ""
    audit_syslog_facility: Literal[
        "auth",
        "authpriv",
        "local0",
        "local1",
        "local2",
        "local3",
        "local4",
        "local5",
        "local6",
        "local7",
    ] = "authpriv"
    audit_syslog_spool_file: Path | None = None
    audit_signing_key_file: Path | None = None
    audit_retention_days: int = Field(default=365, ge=90, le=3650)
    password_denylist_file: Path | None = None

    @property
    def hosts(self) -> list[str]:
        return [host.strip() for host in self.allowed_hosts.split(",") if host.strip()]

    @model_validator(mode="after")
    def secure_configuration(self) -> "Settings":
        if not self.hosts or any("*" in host for host in self.hosts):
            raise ValueError("ALLOWED_HOSTS 必须指定精确主机名")
        if self.default_page_size > self.max_page_size:
            raise ValueError("默认分页大小不能超过最大值")
        if self.cors_origins:
            raise ValueError("本系统采用同源部署，不开放跨域 API")
        base = urlsplit(self.app_base_url)
        if (
            base.scheme not in {"https", "http"}
            or not base.hostname
            or base.username
            or base.password
            or base.query
            or base.fragment
            or base.path not in {"", "/"}
        ):
            raise ValueError("APP_BASE_URL 必须是有效站点地址")
        if self.audit_syslog_address:
            raw = self.audit_syslog_address.strip()
            if not raw.startswith("/"):
                parsed = urlsplit(raw)
                if parsed.scheme not in {"udp", "tcp"} or not parsed.hostname:
                    raise ValueError(
                        "AUDIT_SYSLOG_ADDRESS 必须是 udp://host:port、"
                        "tcp://host:port 或 Unix 套接字路径"
                    )
        if self.app_env == "production":
            if base.scheme != "https" or base.hostname not in self.hosts:
                raise ValueError("生产地址必须使用 HTTPS 且位于 ALLOWED_HOSTS")
            if self.audit_syslog_address and not self.audit_syslog_address.strip().startswith("/"):
                raise ValueError(
                    "生产环境 AUDIT_SYSLOG_ADDRESS 仅允许本机绝对 Unix 套接字路径"
                    "（如 /dev/log 或本机 rsyslog/syslog-ng 套接字），禁止直连远程 TCP/UDP"
                )
            if (
                not self.totp_required
                or not self.step_up_totp_required
                or self.debug
                or self.expose_api_docs
                or not self.session_cookie_secure
            ):
                raise ValueError(
                    "生产环境必须启用 TOTP、高风险操作二步校验和安全 Cookie，关闭调试与公开文档"
                )
        return self

    def validate_secret_files(self) -> None:
        if not self.database_password_file.read_bytes().strip():
            raise ValueError("数据库密码文件不能为空")
        active_key = self.data_key_directory / f"data_key_v{self.active_data_key_version}"
        if len(active_key.read_bytes()) != 32:
            raise ValueError("数据密钥必须是 32 字节原始随机值")
        if self.audit_signing_key_file is not None:
            raw_key = self.audit_signing_key_file.read_bytes()
            if not raw_key.lstrip().startswith(b"-----BEGIN ") and len(raw_key) < 32:
                raise ValueError("审计签名密钥必须至少 32 字节或为有效 Ed25519 PEM 私钥")
        if self.password_denylist_file is not None and not self.password_denylist_file.is_file():
            raise ValueError("密码黑名单文件不存在或不可读")
