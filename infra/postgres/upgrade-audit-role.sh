#!/usr/bin/env bash
# Run with `docker compose exec -T` after database-role change authorization.
# Creates dedicated INSERT-only audit role `gm_audit_writer` and revokes UPDATE/DELETE/TRUNCATE
# on `public.audit_events` from `gm_app` on existing databases.
set -euo pipefail
if (: </dev/tty) 2>/dev/null; then
  printf '请在无控制终端的 exec -T 环境运行，密码只从 Secret 文件传入。\n' >&2
  exit 1
fi
password="$(cat "${GM_AUDIT_PASSWORD_FILE:-/run/secrets/db_audit_password}")"
{
  printf '%s\n%s\n' "$password" "$password"
  cat <<'SQL'
\getenv db_name POSTGRES_DB
GRANT CONNECT ON DATABASE :"db_name" TO gm_audit_writer;
GRANT USAGE ON SCHEMA public TO gm_audit_writer;
REVOKE ALL ON TABLE public.audit_events FROM gm_audit_writer;
GRANT INSERT ON TABLE public.audit_events TO gm_audit_writer;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_events FROM gm_app;
GRANT SELECT, INSERT ON TABLE public.audit_events TO gm_app;
SQL
} | psql -X --single-transaction --username "${POSTGRES_USER:?set project bootstrap role}" \
  --dbname "${POSTGRES_DB:?set project database}" --set ON_ERROR_STOP=1 \
  -c 'CREATE ROLE gm_audit_writer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE' \
  -c '\password gm_audit_writer' -f -
unset password
