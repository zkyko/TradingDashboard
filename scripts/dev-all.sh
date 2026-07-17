#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
./scripts/python-service.sh &
PY_PID=$!
trap 'kill $PY_PID 2>/dev/null || true' EXIT
PATH=/usr/local/bin:$PATH npm run dev
