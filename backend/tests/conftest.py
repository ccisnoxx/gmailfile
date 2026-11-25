import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from alembic import command
from app.core.config import Settings


@pytest.fixture
def settings(tmp_path):
    password = tmp_path / "db_password"
    password.write_text("synthetic-unit-test-password")
    (tmp_path / "data_key_v1").write_bytes(os.urandom(32))
    return Settings(
        _env_file=None,
        app_env="test",
        app_base_url="http://testserver",
        allowed_hosts="testserver",
        step_up_totp_required=False,
        database_password_file=password,
        data_key_directory=tmp_path,
    )


@pytest.fixture
def migration_config():
    return Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))


@pytest.fixture
def db_engine(migration_config):
    source = os.environ.get("TEST_DATABASE_URL")
    if not source:
        pytest.fail("集成测试必须设置 TEST_DATABASE_URL，不能把未执行误报为通过")
    url = make_url(source)
    if url.get_backend_name() != "postgresql" or not (url.database or "").startswith("gm_test"):
        pytest.fail("仅允许 gm_test 前缀的独立 PostgreSQL 测试数据库")
    admin = create_engine(url, hide_parameters=True)
    schema = "gm_test_" + uuid4().hex
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    options = dict(url.query)
    options["options"] = f"-csearch_path={schema}"
    engine = create_engine(url.set(query=options), hide_parameters=True)
    try:
        with engine.begin() as connection:
            migration_config.attributes["connection"] = connection
            command.upgrade(migration_config, "head")
        yield engine
    finally:
        migration_config.attributes.pop("connection", None)
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
