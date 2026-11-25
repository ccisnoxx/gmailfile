#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="${PYTHON_BIN:-$ROOT/backend/.venv/bin/python}"
exec "$PYTHON" "$ROOT/scripts/backup_tool.py" backup "$@"
