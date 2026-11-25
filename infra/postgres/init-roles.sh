#!/usr/bin/env bash
set -euo pipefail
if (: </dev/tty) 2>/dev/null; then
  printf '角色初始化只在无控制终端的数据库初始化进程运行。\n' >&2
  exit 1
fi
app_password="$(cat "${GM_APP_PASSWORD_FILE:-/run/secrets/db_password}")"
migrator_password="$(cat "${GM_MIGRATOR_PASSWORD_FILE:-/run/secrets/db_migrator_password}")"
backup_password="$(cat "${GM_BACKUP_PASSWORD_FILE:-/run/secrets/db_backup_password}")"
{
  printf '%s\n%s\n' "$migrator_password" "$migrator_password"
  printf '%s\n%s\n' "$app_password" "$app_password"
  printf '%s\n%s\n' "$backup_password" "$backup_password"
  cat <<'SQL'
\getenv db_name POSTGRES_DB
GRANT pg_read_all_data TO gm_backup;
ALTER DATABASE :"db_name" OWNER TO gm_migrator;
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO gm_migrator, gm_app, gm_backup;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO gm_migrator;
GRANT USAGE ON SCHEMA public TO gm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE gm_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE gm_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO gm_app;
SQL
} | psql -X --single-transaction --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set ON_ERROR_STOP=1 \
  -c 'CREATE ROLE gm_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE' -c '\password gm_migrator' \
  -c 'CREATE ROLE gm_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE' -c '\password gm_app' \
  -c 'CREATE ROLE gm_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE' -c '\password gm_backup' -f -
unset app_password migrator_password backup_password
