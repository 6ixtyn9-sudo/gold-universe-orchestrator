#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

PYTHON_BIN="${PYTHON_BIN:-python3}"
PORT="${PORT:-5050}"

if [ ! -d ".venv" ]; then
  "$PYTHON_BIN" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

python -m pip install -U pip >/dev/null

# Install deps from pyproject.toml ([project].dependencies)
DEPS="$(python - <<'PY'
import tomllib
from pathlib import Path
data = tomllib.loads(Path("pyproject.toml").read_text(encoding="utf-8"))
deps = data.get("project", {}).get("dependencies", []) or []
print(" ".join(deps))
PY
)"
if [ -n "$DEPS" ]; then
  python -m pip install $DEPS >/dev/null
fi

# Convenience for local dev: if service_account.json exists and env isn't set, use it
if [ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ] && [ -f "$REPO_ROOT/service_account.json" ]; then
  export GOOGLE_APPLICATION_CREDENTIALS="$REPO_ROOT/service_account.json"
fi

export PORT
exec python app.py
