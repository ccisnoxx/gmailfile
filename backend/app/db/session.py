from sqlalchemy import URL, Engine, create_engine

from app.core.config import Settings


def create_database_engine(settings: Settings) -> Engine:
    password = settings.database_password_file.read_text().strip()
    url = URL.create(
        "postgresql+psycopg",
        username=settings.database_user,
        password=password,
        host=settings.database_host,
        port=settings.database_port,
        database=settings.database_name,
    )
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=0,
        hide_parameters=True,
        connect_args={"connect_timeout": 3},
    )
