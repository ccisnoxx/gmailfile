#!/usr/bin/env bash
# Run with `docker compose exec -T` after database-role change authorization.
set -euo pipefail
if (: </dev/tty) 2>/dev/null; then
  printf '请在无控制终端的 exec -T 环境运行，密码只从 Secret 文件传入。\n' >&2
  exit 1
fi
password="$(cat "${GM_BACKUP_PASSWORD_FILE:-/run/secrets/db_backup_password}")"
{
  printf '%s\n%s\n' "$password" "$password"
  cat <<'SQL'
GRANT pg_read_all_data TO gm_backup;
\getenv db_name POSTGRES_DB
GRANT CONNECT ON DATABASE :"db_name" TO gm_backup;
SQL
} | psql -X --single-transaction --username "${POSTGRES_USER:?set project bootstrap role}" \
  --dbname "${POSTGRES_DB:?set project database}" --set ON_ERROR_STOP=1 \
  -c 'CREATE ROLE gm_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE' \
  -c '\password gm_backup' -f -
unset password
