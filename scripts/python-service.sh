#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/python"
PYTHON_BIN="${PYTHON_BIN:-python3}"
if [[ ! -d .venv ]]; then
  "$PYTHON_BIN" -m venv .venv
  .venv/bin/pip install --no-cache-dir -r requirements.txt
fi
export PYTHONPATH="$ROOT/python"
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "${ZK_PYTHON_PORT:-8765}"
