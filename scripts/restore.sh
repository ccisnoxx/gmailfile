#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="${PYTHON_BIN:-$ROOT/backend/.venv/bin/python}"
if [[ "${1:-}" == switch ]]; then
  shift
  exec "$PYTHON" "$ROOT/scripts/backup_tool.py" switch "$@"
fi
exec "$PYTHON" "$ROOT/scripts/backup_tool.py" restore "$@"
