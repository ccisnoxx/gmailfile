from pathlib import Path

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Engine

BACKEND = Path(__file__).resolve().parents[2]


def schema_is_current(engine: Engine) -> bool:
    config = Config()
    config.set_main_option("script_location", str(BACKEND / "alembic"))
    expected = set(ScriptDirectory.from_config(config).get_heads())
    with engine.connect() as connection:
        current = set(MigrationContext.configure(connection).get_current_heads())
    return bool(expected) and current == expected
