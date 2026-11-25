from alembic import context
from app import models  # noqa: F401
from app.core.config import Settings
from app.db.base import Base
from app.db.session import create_database_engine

target_metadata = Base.metadata


def run_migrations() -> None:
    if context.is_offline_mode():
        context.configure(
            dialect_name="postgresql",
            target_metadata=target_metadata,
            literal_binds=True,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()
        return

    supplied_connection = context.config.attributes.get("connection")
    if supplied_connection is not None:
        context.configure(connection=supplied_connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
        return

    engine = create_database_engine(Settings())
    try:
        with engine.connect() as connection:
            context.configure(
                connection=connection, target_metadata=target_metadata, compare_type=True
            )
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


run_migrations()
